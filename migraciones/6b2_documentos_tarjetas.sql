-- ============================================================
-- MEJORA 6B2 — Documentos de tarjetas (resumen original + comprobantes de pago)
-- CORRECCIÓN FINAL (post-verificación en Supabase real) — amplía
-- documents_check para que además de obligation_id/payment_id
-- (Servicios) también acepte card_id/statement_id/movement_id (Tarjetas).
-- ------------------------------------------------------------
-- Migración ADITIVA y REVERSIBLE. No borra columnas, no borra filas,
-- no borra políticas existentes. Solo agrega columnas nuevas (nullable),
-- relaja una restricción NOT NULL, AMPLÍA (no reemplaza el sentido de)
-- la restricción CHECK general de la tabla, y agrega políticas RLS
-- nuevas para que la tabla "documents" (ya usada por Servicios) pueda
-- vincularse también a tarjetas/resúmenes/pagos de tarjeta, sin tocar
-- su uso actual.
--
-- CONTEXTO CONFIRMADO EN SUPABASE (proyecto real "gestor-gastos"):
--   public.documents ya tiene estas restricciones CHECK:
--     - documents_check         (exige obligation_id IS NOT NULL OR
--                                 payment_id IS NOT NULL — bloquearía
--                                 hoy cualquier fila de tarjeta)
--     - documents_kind_check    (solo permite 'invoice'/'receipt')
--     - documents_size_bytes_check (sin relación con esta migración,
--                                    no se toca)
--
-- Ruta de Storage usada por el código (bucket "documents", ya existente):
--   credit-cards/{user_id}/{card_id}/{statement_id}/statement/{archivo}
--   credit-cards/{user_id}/{card_id}/{statement_id}/payments/{movement_id}/{archivo}
-- El segundo segmento de la ruta es el uid del usuario dueño de la tarjeta,
-- que es exactamente lo que valida la política de Storage de más abajo.
-- Esta ruta coincide exactamente con la que arma uploadCreditDocument()
-- en index.html/index_operator.html — no hace falta tocar el código.
--
-- ORDEN DE ESTE ARCHIVO (importa: cada paso depende del anterior):
--   1) Crear card_id, statement_id, movement_id.
--   2) Hacer group_id nullable.
--   3) Ampliar documents_check (para que acepte también card_id/
--      statement_id/movement_id, sin dejar de aceptar obligation_id/
--      payment_id).
--   4) Ampliar documents_kind_check (para permitir 'statement' y
--      'card_receipt', sin dejar de aceptar 'invoice'/'receipt').
--   5) Crear/recrear las políticas RLS de documents.
--   6) Crear/recrear las políticas RLS de storage.objects.
--
-- CÓMO APLICAR:
--   1) Abrir el SQL Editor del proyecto Supabase (panel web) o psql con
--      una conexión ya autorizada.
--   2) Pegar y ejecutar este archivo completo, en el orden en que está
--      escrito, una sola vez.
--   3) Es seguro volver a ejecutarlo completo (usa IF NOT EXISTS /
--      DROP...IF EXISTS antes de recrear en todos los pasos), así que
--      un reintento no rompe nada ni falla por "ya existe".
--
-- CÓMO REVERTIR (documentación únicamente — nada de esto se ejecuta
-- automáticamente, ni ahora ni después; es una referencia manual):
--   -- 1) Antes de nada, confirmar que no haya quedado ningún documento
--   --    de tarjeta que dependa de las columnas nuevas:
--   --      SELECT count(*) FROM public.documents
--   --      WHERE card_id IS NOT NULL OR statement_id IS NOT NULL
--   --         OR movement_id IS NOT NULL;
--   --    Si el resultado es mayor a 0, NO continuar con la reversión:
--   --    esos documentos quedarían con columnas inexistentes y/o violando
--   --    el CHECK anterior. Hay que decidir primero qué hacer con ellos
--   --    (migrarlos a otro esquema o aceptar que se pierda el vínculo).
--   --
--   -- 2) Volver documents_check a su forma original (solo Servicios):
--   --      ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_check;
--   --      ALTER TABLE public.documents ADD CONSTRAINT documents_check
--   --        CHECK (obligation_id IS NOT NULL OR payment_id IS NOT NULL);
--   --    (Fallará con "check constraint violated" si todavía queda algún
--   --    documento de tarjeta — ver paso 1.)
--   --
--   -- 3) Volver documents_kind_check a solo 'invoice'/'receipt':
--   --      ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_kind_check;
--   --      ALTER TABLE public.documents ADD CONSTRAINT documents_kind_check
--   --        CHECK (kind IN ('invoice','receipt'));
--   --    (Fallará si queda algún documento con kind='statement' o
--   --    'card_receipt' — mismo chequeo del paso 1.)
--   --
--   -- 4) Eliminar las políticas nuevas:
--   --      DROP POLICY IF EXISTS documents_credit_select ON public.documents;
--   --      DROP POLICY IF EXISTS documents_credit_insert ON public.documents;
--   --      DROP POLICY IF EXISTS documents_credit_update ON public.documents;
--   --      DROP POLICY IF EXISTS documents_credit_delete ON public.documents;
--   --      DROP POLICY IF EXISTS storage_credit_documents_select ON storage.objects;
--   --      DROP POLICY IF EXISTS storage_credit_documents_insert ON storage.objects;
--   --      DROP POLICY IF EXISTS storage_credit_documents_update ON storage.objects;
--   --      DROP POLICY IF EXISTS storage_credit_documents_delete ON storage.objects;
--   --
--   -- 5) Recién al final, si hiciera falta, quitar las columnas y volver
--   --    group_id a NOT NULL. OJO: "ALTER COLUMN group_id SET NOT NULL"
--   --    FALLARÁ si queda alguna fila con group_id NULL (exactamente las
--   --    filas de tarjeta que se crearon con esta migración aplicada). No
--   --    se puede ejecutar a ciegas; hay que revisar antes cuántas filas
--   --    tienen group_id NULL y decidir qué hacer con ellas:
--   --      SELECT count(*) FROM public.documents WHERE group_id IS NULL;
--   --      ALTER TABLE public.documents DROP COLUMN IF EXISTS card_id;
--   --      ALTER TABLE public.documents DROP COLUMN IF EXISTS statement_id;
--   --      ALTER TABLE public.documents DROP COLUMN IF EXISTS movement_id;
--   --      ALTER TABLE public.documents ALTER COLUMN group_id SET NOT NULL; -- solo si el conteo de arriba dio 0
-- ============================================================

-- ------------------------------------------------------------
-- 1) Columnas nuevas en public.documents para vincular documentos de
--    tarjeta. Todas nullable: no afectan las filas existentes (facturas/
--    comprobantes de servicios), que siguen usando group_id/obligation_id/
--    payment_id exactamente como hasta ahora.
-- ------------------------------------------------------------
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES public.credit_cards(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS statement_id uuid REFERENCES public.credit_card_statements(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS movement_id uuid REFERENCES public.credit_card_movements(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- 2) group_id pasa a ser opcional: los documentos de tarjeta no
--    pertenecen a un "group" (las tarjetas son del titular, no de un
--    espacio). Esto no borra ni modifica ningún group_id ya cargado en
--    filas existentes de Servicios.
-- ------------------------------------------------------------
ALTER TABLE public.documents ALTER COLUMN group_id DROP NOT NULL;

-- ------------------------------------------------------------
-- 3) Ampliar documents_check: hoy exige "obligation_id IS NOT NULL OR
--    payment_id IS NOT NULL" (así quedaría confirmado en el proyecto
--    real), lo que bloquea cualquier documento de tarjeta. Se reemplaza
--    por una versión que acepta CUALQUIERA de los cinco vínculos
--    posibles, sin quitarle ninguno de los dos que ya tenía. Debe
--    ejecutarse DESPUÉS del paso 1 (las columnas nuevas ya tienen que
--    existir) y es idempotente: DROP...IF EXISTS antes de recrear, así
--    que correr este archivo dos veces no falla.
-- ------------------------------------------------------------
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_check
  CHECK (
    obligation_id IS NOT NULL
    OR payment_id IS NOT NULL
    OR card_id IS NOT NULL
    OR statement_id IS NOT NULL
    OR movement_id IS NOT NULL
  );

-- ------------------------------------------------------------
-- 4) Ampliar documents_kind_check para incluir los documentos de
--    tarjeta ('statement','card_receipt'), sin tocar los valores
--    existentes ('invoice','receipt').
--
--    Se busca dinámicamente el nombre real de la restricción CHECK
--    sobre "kind" por si en algún entorno no se llama exactamente
--    "documents_kind_check". La búsqueda tiene DOS resguardos para
--    nunca tocar documents_check (que ahora también hace referencia a
--    varias columnas, pero nunca a "kind") por error:
--      a) se excluye explícitamente el nombre 'documents_check';
--      b) se exige que la restricción encontrada sea de UNA sola
--         columna (array_length(conkey,1) = 1) — documents_check
--         siempre involucra 5 columnas, así que jamás puede calzar acá.
--    Además se hace un DROP...IF EXISTS explícito de
--    "documents_kind_check" antes de recrearla, para que una segunda
--    ejecución de este archivo nunca falle con "ya existe".
-- ------------------------------------------------------------
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'documents'
    AND con.contype = 'c'
    AND att.attname = 'kind'
    AND con.conname <> 'documents_check'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', constraint_name);
  END IF;

  -- Resguardo adicional: si por algún motivo ya existe con el nombre
  -- estándar (por ejemplo, una segunda corrida de este mismo archivo),
  -- se elimina explícitamente antes de recrearla.
  ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_kind_check;

  ALTER TABLE public.documents ADD CONSTRAINT documents_kind_check
    CHECK (kind IN ('invoice','receipt','statement','card_receipt'));
END $$;

-- ------------------------------------------------------------
-- 5) Políticas RLS nuevas para documentos de tarjeta. Se basan en
--    "uploaded_by = auth.uid()" (columna que ya existe y ya se completa
--    hoy en cada insert de "documents"), igual que el dueño de una tarjeta
--    es siempre quien la creó. No se duplica ninguna lógica de permisos
--    nueva ni se depende de la política interna de credit_cards. No se
--    toca ninguna política existente de Servicios.
--    PostgreSQL no admite "CREATE POLICY IF NOT EXISTS": cada política se
--    recrea con DROP...IF EXISTS + CREATE (idempotente, seguro reintentar).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS documents_credit_select ON public.documents;
CREATE POLICY documents_credit_select ON public.documents
  FOR SELECT USING (
    card_id IS NOT NULL AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS documents_credit_insert ON public.documents;
CREATE POLICY documents_credit_insert ON public.documents
  FOR INSERT WITH CHECK (
    card_id IS NOT NULL AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS documents_credit_update ON public.documents;
CREATE POLICY documents_credit_update ON public.documents
  FOR UPDATE USING (
    card_id IS NOT NULL AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS documents_credit_delete ON public.documents;
CREATE POLICY documents_credit_delete ON public.documents
  FOR DELETE USING (
    card_id IS NOT NULL AND uploaded_by = auth.uid()
  );

-- ------------------------------------------------------------
-- 6) Políticas de Storage para el nuevo prefijo de ruta
--    "credit-cards/{user_id}/{card_id}/..." dentro del bucket "documents"
--    ya existente (mismo bucket que usan las facturas de servicios, no se
--    crea un bucket nuevo). El segundo segmento de la ruta es el uid del
--    dueño, igual que el patrón ya usado por el resto del Storage privado.
--    Esta ruta coincide exactamente con la que arma uploadCreditDocument()
--    en el código (credit-cards/{user_id}/{card_id}/{statement_id}/
--    statement|payments/.../{archivo}) — no hace falta cambiar el código.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS storage_credit_documents_select ON storage.objects;
CREATE POLICY storage_credit_documents_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'credit-cards'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS storage_credit_documents_insert ON storage.objects;
CREATE POLICY storage_credit_documents_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'credit-cards'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS storage_credit_documents_update ON storage.objects;
CREATE POLICY storage_credit_documents_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'credit-cards'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS storage_credit_documents_delete ON storage.objects;
CREATE POLICY storage_credit_documents_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'credit-cards'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
