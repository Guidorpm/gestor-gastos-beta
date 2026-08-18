-- ============================================================
-- *** PROPUESTA DE MIGRACIÓN *** NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA
-- DE GUIDO.
-- ------------------------------------------------------------
-- Objetivo: anulación no destructiva de factura/comprobante para
-- documentos NORMALES de Servicios (kind IN ('invoice','receipt'), sin
-- vínculo a Tarjetas) -- mejora #6, FASE 2, 20260817.
--
-- Basada en el esquema REAL de public.documents ya auditado (consulta
-- consolidada ejecutada por Guido, resultado documentado en
-- respaldos_publicacion/antes_implementar_anulacion_documentos_20260817_102821/
-- hallazgos_reales_supabase_provistos_por_guido.txt):
--   - documents NO tiene hoy voided/voided_at/voided_by/void_reason ni
--     ninguna columna equivalente -- se agregan de cero.
--   - documents es una tabla COMPARTIDA con Tarjetas (card_id/
--     statement_id/movement_id) -- las columnas nuevas son ADITIVAS y
--     válidas para TODA la tabla, pero la lógica de anulación (CHECKs +
--     trigger) restringe su USO exclusivamente a documentos normales de
--     Servicios. Los 106 "statement" y 11 "card_receipt" existentes
--     quedan con voided=false por DEFAULT, sin ningún otro cambio.
--   - receipts reales tienen obligation_id Y payment_id simultáneamente
--     (64 filas) -- por eso esta migración NUNCA agrega una constraint
--     XOR entre esas dos columnas.
--   - documents.uploaded_by ya es "uuid NOT NULL REFERENCES auth.users(id)"
--     (confirmado real) -- voided_by sigue esa MISMA convención de la
--     MISMA tabla. Corroborado además por 6 archivos de propuesta ya
--     existentes en este repo (nunca ejecutados) que usan el mismo
--     patrón para "quién hizo X" (voided_by/edited_by/proposed_by/
--     confirmed_by/rejected_by/executed_by, todos
--     "uuid REFERENCES auth.users(id)") -- ver
--     migraciones/6b4_15_PENDIENTE_edicion_meses.sql,
--     migraciones/6b4_16_PENDIENTE_match_tarjeta_servicio.sql,
--     migraciones/6b4_8_PENDIENTE_push_tarjetas.sql,
--     migraciones/6b4_9_PENDIENTE_reprocesamiento_historico.sql. No hay
--     evidencia local de que payments tenga voided_by/voided_at/
--     void_reason como columnas reales (solo payments.voided, booleano,
--     confirmado en uso) -- esta propuesta NO asume esa tabla, se basa
--     en documents.uploaded_by (misma tabla) más la convención repetida.
--   - RLS: NO se agrega ninguna policy nueva -- documents_update_admin/
--     operator_update_documents/private_documents_credit_owner_only_update
--     ya cubren el UPDATE de documentos normales de Servicios (titular,
--     operador de Servicios, servicios privados) sin depender de las
--     columnas nuevas. Storage: NO se toca ninguna policy ni el bucket.
--
-- ESTADO: preparada, NO ejecutada. NO ALTER TABLE real. NO CREATE
-- FUNCTION real. NO CREATE TRIGGER real. Nada de este archivo corrió
-- contra Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas -- ADITIVAS, DEFAULT seguro para las 235 filas
--    históricas existentes (54 invoice + 64 receipt + 106 statement +
--    11 card_receipt), sin backfill, sin tocar ninguna fila real.
-- ------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS voided_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS void_reason text NULL;

-- ------------------------------------------------------------
-- 2) Invariante de estado -- ACTIVO (voided=false) exige las 3 columnas
--    de anulación en NULL; ANULADO (voided=true) exige las 3 completas,
--    con motivo no vacío (después de btrim).
-- ------------------------------------------------------------
ALTER TABLE public.documents
  ADD CONSTRAINT chk_documents_void_state
  CHECK (
    (voided = false AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR
    (voided = true AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(void_reason) <> '')
  );

-- ------------------------------------------------------------
-- 3) Largo razonable del motivo -- sin mínimo artificial además de "no
--    vacío" (ya exigido en el CHECK anterior).
-- ------------------------------------------------------------
ALTER TABLE public.documents
  ADD CONSTRAINT chk_documents_void_reason_length
  CHECK (void_reason IS NULL OR char_length(void_reason) <= 500);

-- ------------------------------------------------------------
-- 4) Alcance -- un documento anulado SOLO puede ser un documento normal
--    de Servicios (invoice/receipt, sin ningún vínculo a Tarjetas). Los
--    106 statement y 11 card_receipt actuales NUNCA podrán tener
--    voided=true (ni ningún documento futuro con card_id/statement_id/
--    movement_id). Sin XOR entre obligation_id/payment_id -- los
--    receipts reales tienen ambos.
-- ------------------------------------------------------------
ALTER TABLE public.documents
  ADD CONSTRAINT chk_documents_void_scope
  CHECK (
    voided = false
    OR (
      kind IN ('invoice','receipt')
      AND card_id IS NULL
      AND statement_id IS NULL
      AND movement_id IS NULL
    )
  );

-- ------------------------------------------------------------
-- 5) Trazabilidad server-side + inmutabilidad -- el cliente NUNCA envía
--    voided_by/voided_at (los completa la base); un documento ya
--    anulado queda TOTALMENTE INMUTABLE (ninguna columna, no solo la
--    metadata de anulación -- CORRECCIÓN B, 20260817); un documento
--    ACTIVO no puede llevar metadata de anulación mientras siga activo
--    (CORRECCIÓN C, 20260817); la transición false->true no puede
--    mezclarse con ningún cambio de archivo/relaciones -- exclusivamente
--    metadata de anulación; nunca depende solo del CHECK para el caso
--    de usuario no identificable (CORRECCIÓN A, 20260817). INSERT con
--    voided=true directo queda rechazado: anular es siempre un UPDATE
--    explícito sobre una fila existente, nunca parte de la carga
--    inicial.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.voided = true THEN
      RAISE EXCEPTION 'No se puede insertar un documento ya anulado -- la anulación es un UPDATE explícito sobre un documento existente';
    END IF;
    RETURN NEW;
  END IF;

  -- A partir de acá, TG_OP = 'UPDATE'.

  -- CORRECCIÓN B (20260817): una fila ya anulada queda TOTALMENTE
  -- inmutable -- se rechaza cualquier cambio real a CUALQUIER columna,
  -- no solo a la metadata de anulación. No existe desanular, no existe
  -- editar un documento anulado (archivo, relaciones o metadata). Si el
  -- UPDATE llega sin cambiar nada (no-op), se permite sin error.
  IF OLD.voided = true THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.group_id IS DISTINCT FROM OLD.group_id
      OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
      OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.file_path IS DISTINCT FROM OLD.file_path
      OR NEW.original_name IS DISTINCT FROM OLD.original_name
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.card_id IS DISTINCT FROM OLD.card_id
      OR NEW.statement_id IS DISTINCT FROM OLD.statement_id
      OR NEW.movement_id IS DISTINCT FROM OLD.movement_id
      OR NEW.voided IS DISTINCT FROM OLD.voided
      OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
      OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
      OR NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN
      RAISE EXCEPTION 'Un documento anulado es inmutable: no se puede modificar ninguna columna (ni desanularse, ni cambiar archivo, relaciones o metadata de anulación)';
    END IF;
    RETURN NEW;
  END IF;

  -- A partir de acá, OLD.voided = false.

  IF NEW.voided = false THEN
    -- CORRECCIÓN C (20260817): un documento ACTIVO (voided=false) no
    -- puede llevar metadata de anulación -- ni parcial ni completa --
    -- mientras siga activo. Esto evita que alguien "prepare" voided_at/
    -- voided_by/void_reason sin pasar por la transición real, o los deje
    -- pisados de un intento anterior.
    IF NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Un documento activo (voided=false) no puede tener metadata de anulación -- voided_at/voided_by/void_reason deben ser NULL';
    END IF;
    -- Cualquier otro UPDATE normal de un documento activo que no
    -- intenta anularlo (ni le agrega metadata de anulación) sigue
    -- permitido sin más validación -- no es responsabilidad de este
    -- trigger.
    RETURN NEW;
  END IF;

  -- Transición false -> true: ESTA es la operación real de anular.
  IF NEW.kind NOT IN ('invoice','receipt')
    OR NEW.card_id IS NOT NULL
    OR NEW.statement_id IS NOT NULL
    OR NEW.movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo se pueden anular documentos normales de Servicios (invoice/receipt, sin vínculo a Tarjetas)';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
    OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
    OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.file_path IS DISTINCT FROM OLD.file_path
    OR NEW.original_name IS DISTINCT FROM OLD.original_name
    OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.card_id IS DISTINCT FROM OLD.card_id
    OR NEW.statement_id IS DISTINCT FROM OLD.statement_id
    OR NEW.movement_id IS DISTINCT FROM OLD.movement_id THEN
    RAISE EXCEPTION 'La anulación solo puede modificar metadata de anulación (voided/voided_at/voided_by/void_reason), nunca el archivo ni las relaciones del documento';
  END IF;

  IF NEW.void_reason IS NULL OR btrim(NEW.void_reason) = '' THEN
    RAISE EXCEPTION 'La anulación requiere un motivo';
  END IF;
  IF char_length(btrim(NEW.void_reason)) > 500 THEN
    RAISE EXCEPTION 'El motivo de anulación no puede superar 500 caracteres';
  END IF;

  -- CORRECCIÓN A (20260817): nunca depender solamente del CHECK para
  -- este caso -- error explícito y claro si no hay usuario autenticado
  -- identificable, ANTES de asignar voided_by.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar al usuario autenticado';
  END IF;

  -- El cliente solo envía voided=true y void_reason -- la base completa
  -- el resto, siempre, sin confiar en lo que mande el cliente.
  NEW.void_reason := btrim(NEW.void_reason);
  NEW.voided_by := auth.uid();
  NEW.voided_at := now();

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_enforce_document_void_integrity
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_document_void_integrity();

-- ------------------------------------------------------------
-- NO incluido en esta propuesta, a propósito:
--   - Ninguna policy RLS nueva (las existentes ya alcanzan, ver
--     encabezado).
--   - Ningún UPDATE/backfill sobre filas existentes.
--   - Ningún índice UNIQUE nuevo (fuera de alcance de esta mejora, ver
--     PENDIENTES).
--   - Ninguna operación de Storage.
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK CONCEPTUAL (NO ejecutar salvo necesidad real):
--   DROP TRIGGER IF EXISTS trg_enforce_document_void_integrity ON public.documents;
--   DROP FUNCTION IF EXISTS public.enforce_document_void_integrity();
--   ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_void_scope;
--   ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_void_reason_length;
--   ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_void_state;
--   ALTER TABLE public.documents
--     DROP COLUMN IF EXISTS void_reason,
--     DROP COLUMN IF EXISTS voided_by,
--     DROP COLUMN IF EXISTS voided_at,
--     DROP COLUMN IF EXISTS voided;
-- Como ningún documento histórico llega a tener voided=true sin pasar
-- por este mismo mecanismo, un rollback antes de usarlo en producción no
-- pierde ningún dato real (las 235 filas actuales seguirían exactamente
-- igual, solo perderían columnas que hoy no existen).
-- ============================================================
