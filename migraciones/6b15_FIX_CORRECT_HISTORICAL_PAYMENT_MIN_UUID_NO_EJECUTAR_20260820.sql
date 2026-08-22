-- ============================================================
-- *** PROPUESTA DE MIGRACIÓN — FIX PUNTUAL *** NO EJECUTAR SIN
-- AUTORIZACIÓN EXPLÍCITA DE GUIDO.
-- ------------------------------------------------------------
-- Objetivo: corregir un único bug real y ya reproducido en producción --
-- bugfix #12, 20260820. "Corregir pago histórico" abre correctamente,
-- pero falla AL GUARDAR cualquier corrección (incluida la más simple:
-- solo cambiar el importe, sin segundo vencimiento ni auxiliar) con:
--
--   function min(uuid) does not exist
--
-- CAUSA REAL CONFIRMADA (no el formato del importe, no el frontend): la
-- definición actualmente desplegada de public.correct_historical_payment
-- (migraciones/6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql,
-- sección 6, línea con el comentario "-- 7) verificar exactamente una
-- contribution") contiene:
--
--   SELECT COUNT(*), MIN(id), MIN(amount) INTO v_contributions_count,
--     v_single_contribution_id, v_single_contribution_amount
--   FROM public.payment_contributions
--   WHERE payment_id = p_payment_id;
--
-- payment_contributions.id es uuid. PostgreSQL no tiene una función
-- agregada MIN(uuid) (ni MAX(uuid)) -- por eso CUALQUIER corrección,
-- incluida la más simple posible, fallaba siempre en este mismo punto,
-- antes incluso de llegar a tocar payment/contribution/obligation.
--
-- CORRECCIÓN: la función ya necesita exactamente UNA contribution (eso
-- ya se validaba correctamente con COUNT(*)). Como el conteo ya garantiza
-- una sola fila, alcanza con un SELECT normal (sin agregación) de esa
-- misma fila para obtener su id/amount -- se separa en dos pasos, cada
-- uno válido en PostgreSQL:
--
--   1) SELECT COUNT(*) INTO v_contributions_count ... (conteo, sin MIN/MAX)
--   2) IF v_contributions_count <> 1 THEN RAISE EXCEPTION ... END IF;
--      (mismo mensaje de error funcional que ya existía)
--   3) SELECT id, amount INTO v_single_contribution_id,
--      v_single_contribution_amount ... (sin agregación -- como el count
--      ya validó que hay exactamente 1 fila, este SELECT siempre
--      devuelve exactamente esa fila)
--
-- NO se castea uuid a text. NO se usa MIN(id::text)/MAX(id::text). NO se
-- ordena el uuid arbitrariamente. El lock existente (PERFORM ... FOR
-- UPDATE sobre TODAS las filas de payment_contributions de este payment,
-- ANTES del conteo) se preserva exactamente igual -- sigue evitando el
-- mismo TOCTOU que ya prevenía la versión anterior.
--
-- AUDITORÍA COMPLETA DEL RESTO DEL RPC (búsqueda de MIN(/MAX( en todo el
-- archivo 6b13): confirmado que esta es la ÚNICA ocurrencia de MIN/MAX en
-- toda la función. El bloque del pago auxiliar (SELECT COUNT(*),
-- COALESCE(SUM(amount),0) ...) usa SUM(amount) sobre una columna numeric
-- -- válido, correcto, y se deja intacto sin ningún cambio.
--
-- ESTE ARCHIVO NO MODIFICA:
--   - migraciones/6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql
--     (se conserva intacta, tal cual, como referencia histórica -- esa
--     migración ya fue ejecutada en producción; este archivo es una
--     migración NUEVA e independiente que reemplaza SOLO la función, vía
--     CREATE OR REPLACE FUNCTION, sin tocar la tabla payment_corrections,
--     sus constraints, índices, trigger de inmutabilidad, ni su policy);
--   - la tabla public.payment_corrections (sin ALTER TABLE);
--   - RLS/policies (sin cambios);
--   - grants (se re-declaran los MISMOS, ver el final del archivo, por
--     higiene tras un CREATE OR REPLACE -- no cambian de contenido);
--   - ningún dato real (sin DML, sin backfill, sin tocar el caso real de
--     Edesur agosto 2026).
--
-- Misma firma, mismos parámetros, mismos defaults, RETURNS jsonb, mismo
-- SECURITY DEFINER, mismo SET search_path, mismas validaciones, misma
-- semántica de negocio, mismo audit trail (payment_corrections), mismo
-- sync final (sync_obligation_payment_status) -- cambio estrictamente
-- mínimo para eliminar MIN(uuid)/MAX(uuid).
--
-- ESTADO: preparada, NO ejecutada. NO ejecutar sin autorización explícita
-- de Guido.
-- ============================================================

CREATE OR REPLACE FUNCTION public.correct_historical_payment(
  p_payment_id uuid,
  p_new_total_amount numeric(14,2),
  p_reason text,
  p_applied_due_stage text DEFAULT NULL,
  p_second_due_date date DEFAULT NULL,
  p_second_due_amount numeric(14,2) DEFAULT NULL,
  p_void_auxiliary_payment_id uuid DEFAULT NULL,
  p_void_auxiliary_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_obligation public.obligations%ROWTYPE;
  v_group_id uuid;
  v_active_allocations_count int;
  v_contributions_count int;
  v_single_contribution_id uuid;
  v_single_contribution_amount numeric(14,2);
  v_reason text;
  v_payment_meta jsonb;
  v_new_payment_meta jsonb;
  v_new_payment_notes text;
  v_previous_applied_due_stage text;
  v_obligation_notes text;
  v_obligation_match text[];
  v_obligation_meta jsonb;
  v_obligation_free_text text;
  v_previous_extra jsonb;
  v_new_extra jsonb;
  v_new_obligation_meta jsonb;
  v_new_obligation_notes text;
  v_previous_second_due_date date;
  v_previous_second_due_amount numeric(14,2);
  v_touch_second_due boolean;
  v_aux_payment public.payments%ROWTYPE;
  v_aux_active_allocations_count int;
  v_aux_documents_count int;
  v_aux_contributions_count int;
  v_aux_contributions_total numeric(14,2);
  v_correction_id uuid;
BEGIN
  -- 1) auth.uid() obligatorio.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No se pudo identificar al usuario autenticado';
  END IF;

  -- 3) bloquear payment principal FOR UPDATE (existencia + lock en un
  --    solo paso).
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago a corregir no existe';
  END IF;

  -- 4) bloquear obligation necesaria FOR UPDATE.
  SELECT * INTO v_obligation FROM public.obligations WHERE id = v_payment.obligation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La obligación del pago no existe';
  END IF;

  -- 2) verificar permiso: titular (owner del grupo), server-side, vía
  --    las funciones centrales reales confirmadas -- private.
  --    payment_group_id() resuelve el group_id del payment, private.
  --    is_group_owner() valida group.created_by=auth.uid(). Ninguna
  --    definición paralela/manual de titularidad.
  v_group_id := private.payment_group_id(p_payment_id);

  IF NOT private.is_group_owner(v_group_id) THEN
    RAISE EXCEPTION 'Solo el titular del espacio puede corregir un pago histórico';
  END IF;

  -- 5) verificar payment vigente.
  IF v_payment.voided IS TRUE THEN
    RAISE EXCEPTION 'No se puede corregir un pago anulado';
  END IF;

  -- 6) verificar cero allocations activas.
  SELECT COUNT(*) INTO v_active_allocations_count
  FROM public.payment_allocations
  WHERE payment_id = p_payment_id AND is_active;
  IF v_active_allocations_count > 0 THEN
    RAISE EXCEPTION 'No se puede corregir un pago con asignaciones (payment_allocations) activas -- fuera de alcance de la versión 1';
  END IF;

  -- 7) verificar exactamente una contribution. Se bloquean primero
  --    TODAS las filas de payment_contributions de este payment (FOR
  --    UPDATE no admite funciones de agregación en la misma sentencia en
  --    PL/pgSQL/Postgres, por eso el lock y el conteo van en dos pasos)
  --    para evitar que otra transacción inserte/modifique un aporte
  --    entre esta verificación y el UPDATE de más abajo (TOCTOU).
  PERFORM 1 FROM public.payment_contributions WHERE payment_id = p_payment_id FOR UPDATE;

  -- FIX bugfix #12 (20260820): payment_contributions.id es uuid --
  -- PostgreSQL no tiene MIN(uuid)/MAX(uuid) ("function min(uuid) does
  -- not exist", error real reproducido en producción). Se separa en dos
  -- pasos: primero el conteo (sin agregación sobre uuid), luego -- solo
  -- si el conteo ya confirmó exactamente 1 fila -- un SELECT simple (sin
  -- MIN/MAX) que necesariamente devuelve esa única fila.
  SELECT COUNT(*) INTO v_contributions_count
  FROM public.payment_contributions
  WHERE payment_id = p_payment_id;
  IF v_contributions_count <> 1 THEN
    RAISE EXCEPTION 'Solo se pueden corregir pagos con exactamente un aporte (payment_contributions) -- este pago tiene %', v_contributions_count;
  END IF;

  SELECT id, amount INTO v_single_contribution_id, v_single_contribution_amount
  FROM public.payment_contributions
  WHERE payment_id = p_payment_id;

  -- 8) verificar contribution total = total_amount anterior.
  IF v_single_contribution_amount IS DISTINCT FROM v_payment.total_amount THEN
    RAISE EXCEPTION 'El aporte registrado (%) no coincide con el importe actual del pago (%) -- inconsistencia previa, no se puede corregir en la versión 1', v_single_contribution_amount, v_payment.total_amount;
  END IF;

  -- 9) validar nuevo importe > 0.
  IF p_new_total_amount IS NULL OR p_new_total_amount <= 0 THEN
    RAISE EXCEPTION 'El importe corregido debe ser mayor a cero';
  END IF;

  -- Mismo importe anterior/nuevo -> rechazar (no-op sin sentido, evita
  -- una fila de auditoría vacía de contenido real).
  IF p_new_total_amount = v_payment.total_amount THEN
    RAISE EXCEPTION 'El importe corregido debe ser distinto del importe actual';
  END IF;

  -- 10) validar motivo obligatorio.
  v_reason := btrim(COALESCE(p_reason,''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'La corrección requiere un motivo';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'El motivo no puede superar 500 caracteres';
  END IF;

  -- appliedDueStage: en v1 solo se permite avanzar explícitamente a
  -- 'second' o no tocarlo (NULL) -- nunca forzar 'first' automáticamente
  -- (ver pedido: "si el importe corregido implica que la elección
  -- FIRST/SECOND cambia conceptualmente, NO cambiarla automáticamente").
  IF p_applied_due_stage IS NOT NULL AND p_applied_due_stage <> 'second' THEN
    RAISE EXCEPTION 'appliedDueStage solo puede corregirse explícitamente a ''second'' en esta versión (o dejarse sin cambios)';
  END IF;

  -- Segundo vencimiento: si se pide tocar el importe de 2do vencimiento,
  -- la fecha es obligatoria -- el modelo real (effectiveObligationAmount)
  -- ignora secondAmount sin secondDueDate, así que persistir uno sin el
  -- otro dejaría la corrección sin efecto real.
  v_touch_second_due := p_second_due_amount IS NOT NULL;
  IF v_touch_second_due THEN
    IF p_second_due_date IS NULL THEN
      RAISE EXCEPTION 'El importe de segundo vencimiento requiere una fecha de segundo vencimiento para tener efecto';
    END IF;
    IF p_second_due_amount <= 0 THEN
      RAISE EXCEPTION 'El importe de segundo vencimiento debe ser mayor a cero';
    END IF;
    IF v_obligation.due_date IS NOT NULL AND p_second_due_date < v_obligation.due_date THEN
      RAISE EXCEPTION 'El segundo vencimiento no puede ser anterior al primer vencimiento';
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- Pago auxiliar (opcional): validar ANTES de tocar nada.
  -- ------------------------------------------------------------
  IF p_void_auxiliary_payment_id IS NOT NULL THEN
    IF p_void_auxiliary_payment_id = p_payment_id THEN
      RAISE EXCEPTION 'El pago auxiliar a anular no puede ser el mismo pago que se está corrigiendo';
    END IF;

    SELECT * INTO v_aux_payment FROM public.payments WHERE id = p_void_auxiliary_payment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pago auxiliar seleccionado no existe';
    END IF;
    IF v_aux_payment.obligation_id <> v_payment.obligation_id THEN
      RAISE EXCEPTION 'El pago auxiliar debe pertenecer a la misma obligación que el pago corregido';
    END IF;
    IF v_aux_payment.voided IS TRUE THEN
      RAISE EXCEPTION 'El pago auxiliar seleccionado ya está anulado';
    END IF;

    SELECT COUNT(*) INTO v_aux_active_allocations_count
    FROM public.payment_allocations WHERE payment_id = p_void_auxiliary_payment_id AND is_active;
    IF v_aux_active_allocations_count > 0 THEN
      RAISE EXCEPTION 'No se puede anular automáticamente un pago auxiliar con asignaciones (payment_allocations) activas';
    END IF;

    SELECT COUNT(*) INTO v_aux_documents_count
    FROM public.documents WHERE payment_id = p_void_auxiliary_payment_id;
    IF v_aux_documents_count > 0 THEN
      RAISE EXCEPTION 'No se puede anular automáticamente un pago auxiliar con documentos/comprobantes asociados';
    END IF;

    -- Mismo criterio que la contribution principal: se bloquean las
    -- filas ANTES de leerlas (el lock del pago auxiliar en sí, más
    -- arriba, no alcanza a sus filas de payment_contributions, que son
    -- una tabla distinta). Este bloque usa SUM(amount) sobre una columna
    -- numeric -- válido en PostgreSQL, sin el bug de MIN/MAX(uuid). Se
    -- deja exactamente igual, sin ningún cambio.
    PERFORM 1 FROM public.payment_contributions WHERE payment_id = p_void_auxiliary_payment_id FOR UPDATE;

    SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_aux_contributions_count, v_aux_contributions_total
    FROM public.payment_contributions WHERE payment_id = p_void_auxiliary_payment_id;
    IF v_aux_contributions_count <> 1 OR v_aux_contributions_total IS DISTINCT FROM v_aux_payment.total_amount THEN
      RAISE EXCEPTION 'El pago auxiliar tiene aportes inconsistentes con su importe -- no se puede anular automáticamente en esta versión';
    END IF;

    IF btrim(COALESCE(p_void_auxiliary_reason,'')) = '' THEN
      RAISE EXCEPTION 'La anulación del pago auxiliar requiere su propio motivo';
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- A partir de acá, TODAS las validaciones pasaron -- se aplican los
  -- cambios. Cualquier error a partir de este punto revierte TODO
  -- (transacción única de la función).
  -- ------------------------------------------------------------

  v_previous_applied_due_stage := (regexp_match(COALESCE(v_payment.notes,''), '"appliedDueStage"\s*:\s*"(\w+)"'))[1];

  -- 14) actualizar appliedDueStage si corresponde (merge, nunca
  --     reemplaza notes entero -- mismo contrato que buildPaymentNotes()).
  BEGIN
    v_payment_meta := COALESCE(NULLIF(btrim(COALESCE(v_payment.notes,'')),''), '{}')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'No se pudo interpretar la metadata existente del pago (notes) de forma segura -- corrección cancelada';
  END;

  IF p_applied_due_stage = 'second' THEN
    v_new_payment_meta := v_payment_meta || jsonb_build_object('appliedDueStage','second');
  ELSE
    v_new_payment_meta := v_payment_meta;
  END IF;

  v_new_payment_notes := CASE WHEN v_new_payment_meta = '{}'::jsonb THEN NULL ELSE v_new_payment_meta::text END;

  -- 12) actualizar payment.total_amount (+ notes si corresponde).
  --     obligation_id/created_by/created_at/paid_at NUNCA se tocan.
  UPDATE public.payments
  SET total_amount = p_new_total_amount,
      notes = v_new_payment_notes
  WHERE id = p_payment_id;

  -- 13) actualizar la única payment_contribution al mismo valor nuevo
  --     (invariante: contribution siempre = total_amount en v1).
  UPDATE public.payment_contributions
  SET amount = p_new_total_amount
  WHERE id = v_single_contribution_id;

  -- 15) actualizar segundo vencimiento usando la metadata YA EXISTENTE,
  --     mismo formato [[OBLIGATION_META:{...}]] que updateObligationNotes()
  --     -- fusiona SIEMPRE, nunca reemplaza editHistory/voided/otros.
  v_previous_second_due_date := NULL;
  v_previous_second_due_amount := NULL;

  IF v_touch_second_due THEN
    v_obligation_notes := COALESCE(v_obligation.notes,'');
    v_obligation_match := regexp_match(v_obligation_notes, '^\[\[OBLIGATION_META:(\{.*?\})\]\][\r\n]*');

    IF v_obligation_match IS NOT NULL THEN
      BEGIN
        v_obligation_meta := v_obligation_match[1]::jsonb;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'No se pudo interpretar la metadata existente de la obligación (notes) de forma segura -- corrección cancelada';
      END;
      v_obligation_free_text := regexp_replace(v_obligation_notes, '^\[\[OBLIGATION_META:(\{.*?\})\]\][\r\n]*', '');
    ELSE
      v_obligation_meta := '{}'::jsonb;
      v_obligation_free_text := v_obligation_notes;
    END IF;

    v_previous_extra := COALESCE(v_obligation_meta->'extraFields', '{}'::jsonb);
    v_previous_second_due_date := NULLIF(v_previous_extra->>'secondDueDate','')::date;
    v_previous_second_due_amount := NULLIF(v_previous_extra->>'secondAmount','')::numeric(14,2);

    -- Solo se tocan secondDueDate/secondAmount -- currency/provider/
    -- invoiceNumber y cualquier otra clave de extraFields quedan intactos
    -- (merge, nunca reemplazo del objeto completo).
    v_new_extra := v_previous_extra || jsonb_build_object(
      'secondDueDate', to_jsonb(p_second_due_date),
      'secondAmount', to_jsonb(p_second_due_amount)
    );
    -- editHistory/voided/cualquier otra clave top-level de la metadata
    -- quedan intactos -- solo se reemplaza la clave 'extraFields'.
    v_new_obligation_meta := v_obligation_meta || jsonb_build_object('extraFields', v_new_extra);

    IF v_new_obligation_meta = '{}'::jsonb THEN
      v_new_obligation_notes := v_obligation_free_text;
    ELSE
      v_new_obligation_notes := '[[OBLIGATION_META:' || v_new_obligation_meta::text || ']]'
        || CASE WHEN btrim(v_obligation_free_text) <> '' THEN E'\n' || v_obligation_free_text ELSE '' END;
    END IF;

    UPDATE public.obligations
    SET notes = v_new_obligation_notes
    WHERE id = v_obligation.id;
  END IF;

  -- 16) opcionalmente anular payment auxiliar seleccionado -- reutiliza
  --     public.void_payment() ya existente (UPDATE no destructivo, misma
  --     transacción). Las validaciones específicas de v1 (misma
  --     obligación, sin documentos, sin allocations, aporte único
  --     consistente) ya se hicieron arriba, ANTES de cualquier mutación.
  IF p_void_auxiliary_payment_id IS NOT NULL THEN
    PERFORM public.void_payment(p_void_auxiliary_payment_id, btrim(p_void_auxiliary_reason));
  END IF;

  -- 11) registrar trazabilidad -- después de que todo lo anterior tuvo
  --     éxito, con los valores previos capturados ANTES de mutar.
  INSERT INTO public.payment_corrections (
    payment_id, obligation_id,
    previous_total_amount, new_total_amount,
    previous_contribution_amount, new_contribution_amount,
    previous_applied_due_stage, new_applied_due_stage,
    previous_second_due_amount, new_second_due_amount,
    previous_second_due_date, new_second_due_date,
    related_voided_payment_id,
    reason, corrected_by
  ) VALUES (
    p_payment_id, v_obligation.id,
    v_payment.total_amount, p_new_total_amount,
    v_single_contribution_amount, p_new_total_amount,
    v_previous_applied_due_stage, COALESCE(p_applied_due_stage, v_previous_applied_due_stage),
    v_previous_second_due_amount, COALESCE(p_second_due_amount, v_previous_second_due_amount),
    v_previous_second_due_date, COALESCE(p_second_due_date, v_previous_second_due_date),
    p_void_auxiliary_payment_id,
    v_reason, auth.uid()
  )
  RETURNING id INTO v_correction_id;

  -- 17) sincronizar obligation (cubre tanto el cambio de total_amount
  --     del pago principal como -- si corresponde -- la anulación del
  --     auxiliar, aunque void_payment() ya sincroniza por su cuenta;
  --     llamarlo de nuevo acá es idempotente y cubre el caso donde NO se
  --     anuló ningún auxiliar).
  PERFORM public.sync_obligation_payment_status(v_obligation.id);

  -- 18) devolver resumen final.
  RETURN jsonb_build_object(
    'correction_id', v_correction_id,
    'payment_id', p_payment_id,
    'obligation_id', v_obligation.id,
    'previous_total_amount', v_payment.total_amount,
    'new_total_amount', p_new_total_amount,
    'previous_applied_due_stage', v_previous_applied_due_stage,
    'new_applied_due_stage', COALESCE(p_applied_due_stage, v_previous_applied_due_stage),
    'second_due_updated', v_touch_second_due,
    'auxiliary_payment_voided', p_void_auxiliary_payment_id IS NOT NULL
  );
END;
$function$;

-- Grants: SIN CAMBIOS, a propósito -- este archivo contiene SOLAMENTE el
-- CREATE OR REPLACE FUNCTION, tal como pidió Guido. No se agrega ningún
-- REVOKE/GRANT acá: PostgreSQL preserva automáticamente los privilegios
-- (ACL) ya otorgados sobre una función existente cuando se la reemplaza
-- vía CREATE OR REPLACE FUNCTION con la misma firma exacta -- el REVOKE
-- ALL FROM PUBLIC / GRANT EXECUTE TO authenticated que ya existe desde
-- 6b13 sigue vigente sin necesidad de re-declararlo, y sin que este
-- archivo lo modifique. El postcheck (6b15_POSTCHECK_...) verifica esto
-- mismo por lectura después de aplicar el fix.

-- ============================================================
-- NO incluido en este fix, a propósito (fuera de alcance de bugfix #12):
--   - Ninguna redistribución automática de payment_allocations.
--   - Ninguna corrección de paid_at.
--   - Ningún cambio a annulPayment()/openAnnulPaymentModal() ni a
--     void_payment() -- se sigue reutilizando void_payment() tal cual.
--   - Ningún backfill ni corrección de datos reales -- el caso real de
--     Edesur NO se toca en esta migración (solo se corrige la función;
--     la corrección real del pago la hará Guido manualmente después,
--     usando la UI, una vez que este fix esté aplicado).
--   - Ninguna tabla/columna/RLS/policy nueva.
--   - "Argentina Virtual no permite Dar de baja" -- bug pendiente
--     separado, registrado pero NO tocado en esta tarea (ver reporte de
--     entrega).
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK CONCEPTUAL (NO ejecutar salvo necesidad real): un CREATE OR
-- REPLACE FUNCTION no tiene "deshacer" automático -- si hiciera falta
-- revertir, habría que volver a ejecutar el CREATE OR REPLACE FUNCTION
-- completo de 6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql
-- (que reintroduciría el bug MIN(uuid), por lo que en la práctica no
-- tiene sentido revertir esto salvo que se descubra un problema nuevo).
-- No hay DROP TABLE ni pérdida de datos posible: esta migración no toca
-- ninguna fila existente de payments/payment_contributions/obligations/
-- payment_corrections.
-- ============================================================
