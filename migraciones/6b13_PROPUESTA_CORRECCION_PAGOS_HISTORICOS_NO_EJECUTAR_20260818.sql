-- ============================================================
-- *** PROPUESTA DE MIGRACIÓN *** NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA
-- DE GUIDO.
-- ------------------------------------------------------------
-- Objetivo: corrección trazable y NO destructiva de pagos históricos con
-- importe incorrecto -- mejora #7, FASE 2, 20260818. Caso real de
-- referencia (Edesur agosto 2026): comprobante real de Mercado Pago por
-- $49.907,71, registrado históricamente como dos pagos vigentes
-- ($49.733,00 + $0,69 = $49.733,69) por una limitación antigua del
-- sistema que bloqueaba pagos superiores al importe de factura.
--
-- REGLA CENTRAL: el resultado NUNCA es "pago viejo + pago ficticio por la
-- diferencia" -- queda UN único pago económico vigente, con su
-- payment_id y su comprobante ORIGINAL intactos, y el importe corregido
-- registrado con trazabilidad completa. Un eventual pago auxiliar
-- histórico (creado solo para compensar la limitación vieja) se ANULA de
-- forma no destructiva (UPDATE vía public.void_payment(), ya existente
-- en Supabase) -- nunca se borra.
--
-- ALCANCE V1 (deliberadamente acotado, ver reporte de entrega): solo
-- permite corregir un payment que (a) existe y no está voided, (b) tiene
-- CERO allocations activas, (c) tiene EXACTAMENTE UNA payment_contribution
-- cuyo importe coincide exactamente con total_amount actual. Cualquier
-- otro caso se rechaza con un mensaje claro -- no se intenta resolver
-- redistribución de allocations ni múltiples contribuyentes en v1.
--
-- ESTADO: preparada, NO ejecutada. NO CREATE TABLE real. NO CREATE
-- FUNCTION real. NO ALTER TABLE real. Nada de este archivo corrió contra
-- Supabase. NO hace DML sobre datos existentes (sin backfill): la tabla
-- de auditoría nace vacía, y el RPC solo actúa cuando alguien lo invoca
-- explícitamente después de que esta migración se ejecute.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Tabla de auditoría -- append-only, columnas explícitas (no JSON
--    para los importes/fechas principales, siguiendo el mismo criterio
--    ya usado en documents.voided/voided_at/voided_by/void_reason de la
--    mejora #6, en vez del patrón JSON más antiguo de
--    credit_card_movements.notes.corrections[]).
-- ------------------------------------------------------------
-- REVISIÓN 20260818 (post-diagnóstico real): payment_id,
-- related_voided_payment_id Y obligation_id usan las TRES ON DELETE
-- RESTRICT a propósito (NUNCA CASCADE) -- el historial de auditoría de
-- una corrección NO puede desaparecer porque alguien, después, elimine
-- el payment corregido, el auxiliar anulado, o la obligation completa
-- (directamente, o en cascada desde un nivel superior como
-- deleteService()). Esto es una protección DELIBERADA: en cuanto un
-- payment/obligation tiene al menos una fila de payment_corrections que
-- lo referencia, cualquier DELETE que llegue a esa fila (por
-- annulPayment(), que sigue haciendo DELETE FROM payments sin chequear
-- historial, o por deleteService() en cascada) fallará con un error de
-- FK en vez de borrar silenciosamente el historial -- ver reporte de
-- entrega, punto 7.
--
-- CORRECCIÓN 20260818b -- obligation_id NO puede quedar en CASCADE:
-- la afirmación anterior ("el RESTRICT de payment_id ya bloquea la
-- cadena completa") quedó DESCARTADA por no estar demostrada. Postgres
-- NO garantiza el orden de ejecución entre triggers de FK
-- independientes que referencian la misma fila padre. Si
-- payment_corrections.obligation_id fuera CASCADE, un DELETE de
-- obligations podría disparar ese CASCADE (borrando la fila de
-- payment_corrections vía el camino DIRECTO obligation_id->obligations)
-- ANTES de que el CASCADE de payments.obligation_id intente borrar el
-- payment -- en ese orden, para cuando se evalúa el RESTRICT de
-- payment_corrections.payment_id, la fila que lo hubiera bloqueado ya no
-- existe (fue borrada por el otro camino), así que el payment SÍ se
-- borra y el historial desaparece igual. El único diseño que protege el
-- historial de forma determinística, sin depender de en qué orden
-- Postgres resuelve los triggers, es que las TRES FK relevantes de
-- payment_corrections sean RESTRICT: payment_id, related_voided_payment_id
-- Y obligation_id.
--
-- EFECTO COLATERAL ACEPTADO A PROPÓSITO: deleteService() (index.html,
-- DELETE real sobre public.services, que hoy cascada a través de
-- obligations->payments->documents) empezaría a FALLAR para cualquier
-- servicio que tenga, en cualquiera de sus obligaciones, al menos una
-- corrección histórica registrada -- ese servicio no podría eliminarse
-- hasta que se implemente, en el futuro, un mecanismo no destructivo
-- (anulación/estado) en vez del DELETE físico. Esto es exactamente el
-- comportamiento pedido explícitamente por Guido ("Es aceptable y
-- deseado que... un DELETE destructivo posterior falle por FK"), no un
-- defecto -- se documenta acá para que quede claro y visible, no
-- implícito.
CREATE TABLE public.payment_corrections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  obligation_id uuid NOT NULL REFERENCES public.obligations(id) ON DELETE RESTRICT,
  previous_total_amount numeric(14,2) NOT NULL,
  new_total_amount numeric(14,2) NOT NULL,
  previous_contribution_amount numeric(14,2) NOT NULL,
  new_contribution_amount numeric(14,2) NOT NULL,
  previous_applied_due_stage text NULL,
  new_applied_due_stage text NULL,
  previous_second_due_amount numeric(14,2) NULL,
  new_second_due_amount numeric(14,2) NULL,
  previous_second_due_date date NULL,
  new_second_due_date date NULL,
  related_voided_payment_id uuid NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  corrected_by uuid NOT NULL REFERENCES auth.users(id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_corrections_pkey PRIMARY KEY (id)
);

-- ------------------------------------------------------------
-- 2) Constraints razonables (defensa en profundidad -- el RPC de la
--    sección 5 ya valida todo esto ANTES de insertar, pero la tabla no
--    debe depender exclusivamente de la disciplina del RPC).
-- ------------------------------------------------------------
ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_amounts_positive
  CHECK (
    previous_total_amount > 0 AND new_total_amount > 0
    AND previous_contribution_amount > 0 AND new_contribution_amount > 0
  );

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_amount_changed
  CHECK (previous_total_amount <> new_total_amount);

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_contribution_matches_total
  -- Invariante de v1: la única contribution del pago SIEMPRE queda igual
  -- al nuevo total_amount (ver sección PAYMENT_CONTRIBUTIONS del pedido)
  -- -- se refuerza acá a nivel de esquema, no solo en el RPC.
  CHECK (
    previous_contribution_amount = previous_total_amount
    AND new_contribution_amount = new_total_amount
  );

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_reason_not_blank
  CHECK (btrim(reason) <> '');

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_reason_length
  CHECK (char_length(reason) <= 500);

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_applied_due_stage_valid
  CHECK (
    (previous_applied_due_stage IS NULL OR previous_applied_due_stage IN ('first','second'))
    AND (new_applied_due_stage IS NULL OR new_applied_due_stage IN ('first','second'))
  );

ALTER TABLE public.payment_corrections
  ADD CONSTRAINT chk_payment_corrections_voided_payment_distinct
  -- El pago auxiliar anulado (si lo hay) nunca puede ser el mismo pago
  -- que se está corrigiendo.
  CHECK (related_voided_payment_id IS NULL OR related_voided_payment_id <> payment_id);

-- ------------------------------------------------------------
-- 3) Índices -- consultas esperadas: historial por payment (detalle de
--    pago), por obligation (auditoría de una obligación completa), por
--    fecha (reportes).
-- ------------------------------------------------------------
CREATE INDEX idx_payment_corrections_payment_id ON public.payment_corrections(payment_id);
CREATE INDEX idx_payment_corrections_obligation_id ON public.payment_corrections(obligation_id);
CREATE INDEX idx_payment_corrections_corrected_at ON public.payment_corrections(corrected_at);

-- ------------------------------------------------------------
-- 4) Inmutabilidad -- append-only real: después de INSERT, ningún UPDATE
--    ni DELETE por usuarios normales (mismo criterio que "documento
--    anulado inmutable" de la mejora #6, pero acá se aplica a TODA fila
--    desde su creación, sin estados intermedios).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_payment_corrections_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'El historial de correcciones de pagos es append-only: no se puede modificar una corrección ya registrada';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'El historial de correcciones de pagos es append-only: no se puede borrar una corrección ya registrada';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_enforce_payment_corrections_immutability
  BEFORE UPDATE OR DELETE ON public.payment_corrections
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payment_corrections_immutability();

-- ------------------------------------------------------------
-- 5) RLS -- lectura titular-only en v1 (ver reporte de entrega: se evita
--    exponer historial de corrección a operadores para no generar
--    confusión/riesgo, hasta que exista una necesidad operativa real).
--    Sin policy de INSERT/UPDATE/DELETE para "authenticated" -- la ÚNICA
--    vía de escritura es el RPC SECURITY DEFINER de la sección 6, que
--    escribe con los privilegios del owner de la función, no los del
--    usuario autenticado. Esto garantiza mecánicamente que ni titular ni
--    operador puedan insertar una fila de auditoría "a mano" sin pasar
--    por todas las validaciones del RPC.
--
--    REVISIÓN 20260818: reutiliza las funciones centrales REALES ya
--    confirmadas por diagnóstico read-only -- private.is_group_owner(
--    p_group_id uuid) y private.payment_group_id(p_payment_id uuid) --
--    en vez de una definición paralela de titularidad con JOIN manual.
--    Una sola fuente de verdad para "quién es titular de este pago",
--    compartida con el RPC de la sección 6.
-- ------------------------------------------------------------
ALTER TABLE public.payment_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_corrections_select_owner_only
  ON public.payment_corrections
  FOR SELECT
  TO authenticated
  USING (
    private.is_group_owner(private.payment_group_id(payment_corrections.payment_id))
  );

-- ------------------------------------------------------------
-- 6) RPC server-side -- transacción atómica única. auth.uid() +
--    verificación de titularidad OBLIGATORIOS server-side (no alcanza
--    con ocultar el botón en el frontend). SECURITY DEFINER para poder
--    escribir en payment_corrections pese a que esa tabla no tiene
--    policy de INSERT para authenticated (ver sección 5).
--
--    VERIFICACIÓN DE TITULARIDAD (REVISIÓN 20260818): confirmada por
--    diagnóstico read-only real la existencia de
--    private.is_group_owner(p_group_id uuid) RETURNS boolean (STABLE
--    SECURITY DEFINER, valida group.created_by=auth.uid()) y de
--    private.payment_group_id(p_payment_id uuid), que resuelve el
--    group_id real de un payment. Se usan AMBAS -- ya no hay una
--    definición manual/paralela de titularidad acá (la versión anterior
--    de esta migración hacía el JOIN payments->obligations->services->
--    groups a mano porque el nombre de la función central era
--    tentativo; ya no lo es). NO se usa
--    public.has_edit_access_to_payment() porque esa función permite
--    también al operador -- la corrección histórica es titular-only.
-- ------------------------------------------------------------
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

  SELECT COUNT(*), MIN(id), MIN(amount) INTO v_contributions_count, v_single_contribution_id, v_single_contribution_amount
  FROM public.payment_contributions
  WHERE payment_id = p_payment_id;
  IF v_contributions_count <> 1 THEN
    RAISE EXCEPTION 'Solo se pueden corregir pagos con exactamente un aporte (payment_contributions) -- este pago tiene %', v_contributions_count;
  END IF;

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
    -- una tabla distinta).
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

-- El RPC se ejecuta con los privilegios de su owner (SECURITY DEFINER),
-- pero la verificación de titular server-side (sección "2" del cuerpo de
-- la función) sigue siendo obligatoria en cada llamada -- SECURITY
-- DEFINER NUNCA reemplaza esa verificación, solo permite que la función
-- pueda escribir en payment_corrections pese a que esa tabla no tiene
-- policy de INSERT para el rol "authenticated".
REVOKE ALL ON FUNCTION public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text) TO authenticated;

-- ============================================================
-- NO incluido en esta propuesta, a propósito:
--   - Ninguna redistribución automática de payment_allocations (v1
--     rechaza directamente cualquier pago con allocations activas).
--   - Ninguna corrección de paid_at (fuera de alcance v1, ver pedido).
--   - Ningún cambio a annulPayment() ni a void_payment() -- se REUTILIZA
--     void_payment() tal cual ya existe, sin modificarlo.
--   - Ningún backfill ni corrección de datos reales -- la tabla nace
--     vacía, el caso real de Edesur NO se toca en esta migración.
--   - Ninguna policy/función de Tarjetas (estas tablas son
--     estructuralmente exclusivas de Servicios).
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK CONCEPTUAL (NO ejecutar salvo necesidad real):
--   REVOKE EXECUTE ON FUNCTION public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text) FROM authenticated;
--   DROP FUNCTION IF EXISTS public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text);
--   DROP TRIGGER IF EXISTS trg_enforce_payment_corrections_immutability ON public.payment_corrections;
--   DROP FUNCTION IF EXISTS public.enforce_payment_corrections_immutability();
--   DROP POLICY IF EXISTS payment_corrections_select_owner_only ON public.payment_corrections;
--   DROP TABLE IF EXISTS public.payment_corrections;
-- Como el RPC nunca se ejecutó todavía (esta migración no fue aplicada),
-- un rollback antes de usarlo en producción no pierde ningún dato real
-- -- payments/payment_contributions/obligations quedan exactamente igual
-- que antes, ninguna fila de payment_corrections llegó a existir.
-- ============================================================
