-- ============================================================
-- ENDURECIMIENTO — mutaciones de operador sobre public.documents
-- (Servicios) — 20260811
-- REVISIÓN 2 — corrige un hallazgo bloqueante en la versión anterior
-- (SHA-256 29335ce5f4cbb5721c4cbaec4c9c57befabd21bc2967a1d1c75b7e5114afd46e,
-- 449 líneas): la condición no verificaba coherencia entre obligation_id
-- y payment_id cuando ambos venían informados, y el aislamiento de
-- Tarjetas no cubría statement_id/movement_id ni el tipo documental
-- (kind). Ver "CORRECCIONES DE ESTA REVISIÓN" más abajo.
-- ------------------------------------------------------------
-- NO EJECUTADO. NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DE GUIDO.
-- ------------------------------------------------------------
-- HALLAZGO ORIGINAL (definiciones LIVE ya confirmadas por Guido contra
-- Supabase real, sin ejecutar nada en esta tarea):
--
--   operator_insert_documents (INSERT, PERMISSIVE, authenticated)
--     WITH CHECK: private.can_operate_group(group_id)
--
--   operator_update_documents (UPDATE, PERMISSIVE, authenticated)
--     USING:      private.can_operate_group(group_id)
--     WITH CHECK: private.can_operate_group(group_id)
--
--   operator_delete_documents (DELETE, PERMISSIVE, authenticated)
--     USING:      private.can_operate_group(group_id)
--
-- Las tres autorizan la mutación mirando ÚNICAMENTE el group_id que
-- llega en la fila -- nunca derivan el servicio real desde
-- obligation_id/payment_id, nunca comparan ese group_id contra el grupo
-- real de ese servicio, y nunca consultan is_private.
--
-- documents_select_member, en cambio, SÍ deriva el servicio real:
--   USING: private.can_view_service(private.document_service_id(obligation_id, payment_id))
-- ------------------------------------------------------------
-- CORRECCIONES DE ESTA REVISIÓN (motivadas por el hallazgo bloqueante
-- reportado por Guido, con evidencia de código verificada en esta
-- misma tarea):
--
-- 1) COHERENCIA obligation_id/payment_id cuando AMBOS vienen informados.
--    private.document_service_id(p_obligation, p_payment) real (ya
--    confirmada, NO modificada) es:
--      select coalesce(
--        private.obligation_service_id(p_obligation),
--        private.payment_service_id(p_payment)
--      );
--    Es decir: si obligation_id resuelve a un servicio, ese gana SIEMPRE
--    -- payment_service_id(payment_id) nunca se evalúa para decidir el
--    servicio, aunque payment_id apunte a un servicio DISTINTO (privado
--    o de otro grupo). La versión anterior de esta migración validaba
--    group_id/can_operate_service solo contra el servicio que
--    document_service_id() elegía (el de obligation_id), sin nunca
--    comprobar que payment_id, si también viene informado, resuelve al
--    MISMO servicio -- permitiendo fabricar una fila con
--    obligation_id de un servicio normal autorizado y payment_id de un
--    servicio privado/de otro grupo, sin que la policy lo note.
--
--    CONFIRMADO POR LECTURA DE CÓDIGO (index.html / index_operator.html,
--    idénticos byte a byte en estas líneas) que este NO es un caso
--    hipotético: es el flujo NORMAL y ya usado en producción para
--    comprobantes de pago ('receipt'):
--      uploadDoc(receiptFile, o.service_id, o.id, payment.id, 'receipt')  (línea ~20553/20556)
--      uploadDoc(retryFile,   o.service_id, o.id, savedPaymentId,'receipt') (línea ~20576/20579)
--    En ambos casos obligation_id (o.id) y payment_id (el pago de esa
--    misma obligación) se envían JUNTOS, apuntando por construcción al
--    MISMO servicio. La corrección agrega una verificación de
--    coherencia explícita para este caso (ver PASO 1) -- exige que, si
--    ambos IDs vienen informados, ambos resuelvan a un servicio
--    existente y AL MISMO servicio; si uno de los dos falta, no se
--    exige coherencia (comportamiento sin cambios para 'invoice', que
--    solo usa obligation_id, y para el caso de 'receipt' sin obligación
--    vinculada, que solo usa payment_id -- ver línea ~20938/20941:
--    uploadDoc(file, service.id, obligation?.id||null, paymentId,'receipt')).
--
-- 2) AISLAMIENTO DE TARJETAS incompleto: la versión anterior solo exigía
--    card_id IS NULL. public.documents también admite statement_id y
--    movement_id (agregadas en migraciones/6b2_documentos_tarjetas.sql,
--    confirmado por lectura de ese archivo en esta tarea), ambas
--    columnas de Tarjetas independientes de card_id. Se agrega
--    statement_id IS NULL AND movement_id IS NULL.
--
-- 3) SEPARACIÓN POR kind: confirmado por lectura de código (index.html /
--    index_operator.html, idénticos) que los documentos de Servicios
--    SIEMPRE usan kind IN ('invoice','receipt') -- únicos 3 call-sites
--    reales de uploadDoc() en todo el archivo, líneas ~20241/20238
--    ('invoice'), ~20553/20556 y ~20576/20579 ('receipt', con
--    obligation_id+payment_id), ~20938/20941 ('receipt', solo
--    payment_id) -- y que Tarjetas SIEMPRE usa kind IN
--    ('statement','card_receipt') vía uploadCreditDocument()/
--    reconcileCreditDocumentLink() (líneas ~7384/7389, ~11325,
--    ~11989/12042, ~17216, etc.), nunca 'invoice'/'receipt'. Se agrega
--    kind IN ('invoice','receipt') como exigencia explícita de las 3
--    policies de operador de Servicios -- cierra por completo cualquier
--    vía lateral de Tarjetas a través de estas policies, incluso si en
--    el futuro se agregara alguna columna nueva de Tarjetas sin
--    replicar ese aislamiento acá.
--
-- Las demás correcciones de la revisión anterior (group_id coherente
-- con service_group_id, can_operate_service reemplazando por completo
-- a can_operate_group) NO cambian -- ver PASO 1.
-- ------------------------------------------------------------
-- ESTE ES EL ÚNICO CAMBIO DE ESTA MIGRACIÓN: las 3 policies de operador
-- de public.documents listadas arriba. Ninguna otra policy, tabla, ni
-- helper se toca -- ni siquiera obligation_service_id/payment_service_id
-- (helpers reales ya existentes, REUTILIZADOS por document_service_id,
-- ahora también reutilizados directamente acá para la verificación de
-- coherencia -- ninguno de los dos se modifica).
-- ------------------------------------------------------------
-- REGLA FUNCIONAL NUEVA (para documentos de Servicios):
--   1. card_id IS NULL AND statement_id IS NULL AND movement_id IS NULL
--      -- aislamiento absoluto de Tarjetas.
--   2. kind IN ('invoice', 'receipt') -- tipo documental propio de
--      Servicios (confirmado por lectura de código, no asumido).
--   3. private.document_service_id(obligation_id, payment_id) IS NOT NULL
--      -- el documento debe resolver a un servicio real.
--   4. Si obligation_id Y payment_id vienen AMBOS informados, ambos
--      deben resolver a un servicio existente y AL MISMO servicio (si
--      falta alguno de los dos, esta condición no aplica).
--   5. group_id = private.service_group_id(serviceId) -- coherencia de
--      grupo entre la fila y el servicio real derivado.
--   6. private.can_operate_service(serviceId) -- ya incorpora
--      is_group_operator + can_view_service (titular O membership
--      activa, Y no privado O titular) -- is_private queda protegido
--      automáticamente, heredado, no reimplementado.
--
-- can_operate_group(group_id) queda completamente REEMPLAZADO (no
-- combinado) por can_operate_service(serviceId) -- mismo razonamiento
-- que la revisión anterior: una vez confirmada la coherencia de grupo
-- (5), exigir además can_operate_group(group_id) sería redundante.
--
-- Titular: mantiene sus permisos actuales -- esta migración NO toca
-- ninguna policy de titular/admin; can_operate_service ya incluye al
-- titular.
--
-- NO se agrega uploaded_by = auth.uid() -- igual que en la revisión
-- anterior, queda fuera de alcance, documentado como hallazgo de
-- trazabilidad separado para revisar después (imponerlo también sobre
-- UPDATE podría romper el flujo legítimo de un operador editando/
-- reemplazando un documento cargado por otro usuario).
-- ------------------------------------------------------------
-- NO TOCA (verificado explícitamente, ninguna de estas se menciona ni se
-- referencia en este archivo salvo en este comentario):
--   documents_select_member (ya correcta, no se toca)
--   documents_credit_select / documents_credit_insert /
--     documents_credit_update / documents_credit_delete
--   cualquier policy/guard RESTRICTIVE de Tarjetas
--   private_documents_credit_* / storage_credit_documents_* /
--     private_storage_credit_cards_*
--   storage_insert_service_documents_operator (corregida en la tarea
--     anterior, ya cerrada -- no se vuelve a tocar en esta tarea)
--   storage_select_group_member / storage_insert_group_admin /
--     storage_update_group_admin / storage_delete_group_admin
--   credit_card_access / credit_cards / statements / movimientos / pagos
--     de tarjeta / lógica contable de Tarjetas -- Tarjetas sigue 100%
--     titular-only, esta migración no habilita nada nuevo para operador
--   private.can_view_service / private.can_manage_service /
--     private.can_operate_service / private.document_service_id /
--     private.obligation_service_id / private.payment_service_id /
--     private.service_group_id / private.is_group_owner /
--     private.is_group_member / private.is_group_operator /
--     public.memberships (todos REUTILIZADOS, ninguno modificado)
--   frontend (index.html / index_operator.html) — no se toca ningún
--     archivo productivo, solo se agregan esta migración y su test local.
-- ------------------------------------------------------------
-- POR QUÉ ALTER POLICY (y no DROP+CREATE): igual que en la revisión
-- anterior -- nombre, tabla, comando, PERMISSIVE y rol authenticated no
-- cambian en ninguna de las 3 policies; ALTER POLICY cambia solo
-- USING/WITH CHECK, sin recrear nada y sin ninguna ventana en la que la
-- policy no exista.
-- ============================================================

BEGIN;

-- ============================================================
-- PASO 0 — Precheck: confirma, contra catálogo real, que las 3 policies
-- siguen exactamente en el estado LIVE reportado ANTES de tocar nada.
-- Si cualquiera difiere, se aborta con RAISE EXCEPTION -- nunca se
-- sobrescribe a ciegas. Igual que la revisión anterior, más existencia
-- de obligation_service_id/payment_service_id (nuevos helpers
-- reutilizados en esta revisión).
-- ============================================================
DO $$
DECLARE
  v_using text;
  v_withcheck text;
  v_cmd text;
  v_permissive boolean;
  v_roles text[];
  v_count integer;
BEGIN
  -- ---------- operator_insert_documents (INSERT, solo WITH CHECK) ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_insert_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 0: se esperaba exactamente 1 policy operator_insert_documents en public.documents, se encontraron %. Se detiene.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_using, v_withcheck, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_insert_documents';

  IF v_cmd IS DISTINCT FROM 'INSERT' THEN
    RAISE EXCEPTION 'PASO 0: operator_insert_documents no es de comando INSERT (real: %). Se detiene.', v_cmd;
  END IF;
  IF v_permissive IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PASO 0: operator_insert_documents no es PERMISSIVE. Se detiene.';
  END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN
    RAISE EXCEPTION 'PASO 0: los roles reales de operator_insert_documents no son exactamente {authenticated} (real: %). Se detiene.', v_roles;
  END IF;
  IF v_withcheck IS NULL OR v_withcheck !~* 'can_operate_group' OR v_withcheck !~* 'group_id' THEN
    RAISE EXCEPTION 'PASO 0: el WITH CHECK real de operator_insert_documents no coincide con la forma reportada (can_operate_group(group_id)). Definición real: %', v_withcheck;
  END IF;
  IF v_withcheck ~* 'document_service_id' OR v_withcheck ~* 'can_operate_service' OR v_withcheck ~* 'service_group_id' THEN
    RAISE EXCEPTION 'PASO 0: operator_insert_documents YA referencia document_service_id/can_operate_service/service_group_id -- podría estar ya corregida. Se detiene, nunca se sobrescribe a ciegas. Definición real: %', v_withcheck;
  END IF;

  -- ---------- operator_update_documents (UPDATE, USING + WITH CHECK) ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_update_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 0: se esperaba exactamente 1 policy operator_update_documents en public.documents, se encontraron %. Se detiene.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_using, v_withcheck, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_update_documents';

  IF v_cmd IS DISTINCT FROM 'UPDATE' THEN
    RAISE EXCEPTION 'PASO 0: operator_update_documents no es de comando UPDATE (real: %). Se detiene.', v_cmd;
  END IF;
  IF v_permissive IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PASO 0: operator_update_documents no es PERMISSIVE. Se detiene.';
  END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN
    RAISE EXCEPTION 'PASO 0: los roles reales de operator_update_documents no son exactamente {authenticated} (real: %). Se detiene.', v_roles;
  END IF;
  IF v_using IS NULL OR v_using !~* 'can_operate_group' OR v_using !~* 'group_id' THEN
    RAISE EXCEPTION 'PASO 0: el USING real de operator_update_documents no coincide con la forma reportada. Definición real: %', v_using;
  END IF;
  IF v_withcheck IS NULL OR v_withcheck !~* 'can_operate_group' OR v_withcheck !~* 'group_id' THEN
    RAISE EXCEPTION 'PASO 0: el WITH CHECK real de operator_update_documents no coincide con la forma reportada. Definición real: %', v_withcheck;
  END IF;
  IF v_using ~* 'document_service_id' OR v_using ~* 'can_operate_service' OR v_using ~* 'service_group_id'
     OR v_withcheck ~* 'document_service_id' OR v_withcheck ~* 'can_operate_service' OR v_withcheck ~* 'service_group_id' THEN
    RAISE EXCEPTION 'PASO 0: operator_update_documents YA referencia la forma nueva -- podría estar ya corregida. Se detiene. USING real: % / WITH CHECK real: %', v_using, v_withcheck;
  END IF;

  -- ---------- operator_delete_documents (DELETE, solo USING) ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_delete_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 0: se esperaba exactamente 1 policy operator_delete_documents en public.documents, se encontraron %. Se detiene.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_using, v_withcheck, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_delete_documents';

  IF v_cmd IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'PASO 0: operator_delete_documents no es de comando DELETE (real: %). Se detiene.', v_cmd;
  END IF;
  IF v_permissive IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PASO 0: operator_delete_documents no es PERMISSIVE. Se detiene.';
  END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN
    RAISE EXCEPTION 'PASO 0: los roles reales de operator_delete_documents no son exactamente {authenticated} (real: %). Se detiene.', v_roles;
  END IF;
  IF v_using IS NULL OR v_using !~* 'can_operate_group' OR v_using !~* 'group_id' THEN
    RAISE EXCEPTION 'PASO 0: el USING real de operator_delete_documents no coincide con la forma reportada. Definición real: %', v_using;
  END IF;
  IF v_using ~* 'document_service_id' OR v_using ~* 'can_operate_service' OR v_using ~* 'service_group_id' THEN
    RAISE EXCEPTION 'PASO 0: operator_delete_documents YA referencia la forma nueva -- podría estar ya corregida. Se detiene. Definición real: %', v_using;
  END IF;

  -- ---------- helpers reutilizados: deben existir, no se modifican ----------
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='document_service_id') THEN
    RAISE EXCEPTION 'PASO 0: private.document_service_id no existe -- esta corrección depende de reutilizarlo tal cual. Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='obligation_service_id') THEN
    RAISE EXCEPTION 'PASO 0: private.obligation_service_id no existe -- esta revisión depende de reutilizarlo tal cual para la verificación de coherencia. Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='payment_service_id') THEN
    RAISE EXCEPTION 'PASO 0: private.payment_service_id no existe -- esta revisión depende de reutilizarlo tal cual para la verificación de coherencia. Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='service_group_id') THEN
    RAISE EXCEPTION 'PASO 0: private.service_group_id no existe -- esta corrección depende de reutilizarlo tal cual. Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='can_operate_service') THEN
    RAISE EXCEPTION 'PASO 0: private.can_operate_service no existe -- esta corrección depende de reutilizarlo tal cual. Se detiene.';
  END IF;

  -- ---------- columnas de Tarjetas: deben existir para poder aislarlas ----------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='statement_id') THEN
    RAISE EXCEPTION 'PASO 0: public.documents.statement_id no existe -- estado inesperado (confirmado en migraciones/6b2_documentos_tarjetas.sql). Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='movement_id') THEN
    RAISE EXCEPTION 'PASO 0: public.documents.movement_id no existe -- estado inesperado (confirmado en migraciones/6b2_documentos_tarjetas.sql). Se detiene.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='kind') THEN
    RAISE EXCEPTION 'PASO 0: public.documents.kind no existe -- estado inesperado. Se detiene.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'documents' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'PASO 0: public.documents no tiene RLS habilitada -- estado inesperado. Se detiene.';
  END IF;
END $$;

-- ============================================================
-- PASO 1 — Corrección de las 3 policies vía ALTER POLICY. Nombre, tabla,
-- comando, PERMISSIVE y rol authenticated quedan intactos porque no se
-- mencionan.
--
-- Expresión reutilizada en las 4 cláusulas (INSERT WITH CHECK, UPDATE
-- USING, UPDATE WITH CHECK, DELETE USING) -- misma regla, aplicada según
-- corresponda a la fila vieja (USING) o a la fila resultante (WITH
-- CHECK):
--
--   card_id IS NULL
--   AND statement_id IS NULL
--   AND movement_id IS NULL
--   AND kind IN ('invoice', 'receipt')
--   AND private.document_service_id(obligation_id, payment_id) IS NOT NULL
--   AND (
--     obligation_id IS NULL
--     OR payment_id IS NULL
--     OR (
--       private.obligation_service_id(obligation_id) IS NOT NULL
--       AND private.payment_service_id(payment_id) IS NOT NULL
--       AND private.obligation_service_id(obligation_id) = private.payment_service_id(payment_id)
--     )
--   )
--   AND group_id = private.service_group_id(private.document_service_id(obligation_id, payment_id))
--   AND private.can_operate_service(private.document_service_id(obligation_id, payment_id))
-- ============================================================

ALTER POLICY operator_insert_documents
ON public.documents
WITH CHECK (
  card_id IS NULL
  AND statement_id IS NULL
  AND movement_id IS NULL
  AND kind IN ('invoice', 'receipt')
  AND private.document_service_id(obligation_id, payment_id) IS NOT NULL
  AND (
    obligation_id IS NULL
    OR payment_id IS NULL
    OR (
      private.obligation_service_id(obligation_id) IS NOT NULL
      AND private.payment_service_id(payment_id) IS NOT NULL
      AND private.obligation_service_id(obligation_id) = private.payment_service_id(payment_id)
    )
  )
  AND group_id = private.service_group_id(private.document_service_id(obligation_id, payment_id))
  AND private.can_operate_service(private.document_service_id(obligation_id, payment_id))
);

ALTER POLICY operator_update_documents
ON public.documents
USING (
  card_id IS NULL
  AND statement_id IS NULL
  AND movement_id IS NULL
  AND kind IN ('invoice', 'receipt')
  AND private.document_service_id(obligation_id, payment_id) IS NOT NULL
  AND (
    obligation_id IS NULL
    OR payment_id IS NULL
    OR (
      private.obligation_service_id(obligation_id) IS NOT NULL
      AND private.payment_service_id(payment_id) IS NOT NULL
      AND private.obligation_service_id(obligation_id) = private.payment_service_id(payment_id)
    )
  )
  AND group_id = private.service_group_id(private.document_service_id(obligation_id, payment_id))
  AND private.can_operate_service(private.document_service_id(obligation_id, payment_id))
)
WITH CHECK (
  card_id IS NULL
  AND statement_id IS NULL
  AND movement_id IS NULL
  AND kind IN ('invoice', 'receipt')
  AND private.document_service_id(obligation_id, payment_id) IS NOT NULL
  AND (
    obligation_id IS NULL
    OR payment_id IS NULL
    OR (
      private.obligation_service_id(obligation_id) IS NOT NULL
      AND private.payment_service_id(payment_id) IS NOT NULL
      AND private.obligation_service_id(obligation_id) = private.payment_service_id(payment_id)
    )
  )
  AND group_id = private.service_group_id(private.document_service_id(obligation_id, payment_id))
  AND private.can_operate_service(private.document_service_id(obligation_id, payment_id))
);

ALTER POLICY operator_delete_documents
ON public.documents
USING (
  card_id IS NULL
  AND statement_id IS NULL
  AND movement_id IS NULL
  AND kind IN ('invoice', 'receipt')
  AND private.document_service_id(obligation_id, payment_id) IS NOT NULL
  AND (
    obligation_id IS NULL
    OR payment_id IS NULL
    OR (
      private.obligation_service_id(obligation_id) IS NOT NULL
      AND private.payment_service_id(payment_id) IS NOT NULL
      AND private.obligation_service_id(obligation_id) = private.payment_service_id(payment_id)
    )
  )
  AND group_id = private.service_group_id(private.document_service_id(obligation_id, payment_id))
  AND private.can_operate_service(private.document_service_id(obligation_id, payment_id))
);

-- ============================================================
-- PASO 2 — Postcheck: confirma que las 3 policies quedaron con la forma
-- nueva esperada (incluyendo las correcciones de esta revisión) y que
-- ninguna otra policy/tabla fue tocada. Si algo no coincide: RAISE
-- EXCEPTION aborta TODA la transacción.
-- ============================================================
DO $$
DECLARE
  v_using text;
  v_withcheck text;
  v_cmd text;
  v_permissive boolean;
  v_roles text[];
  v_count integer;
BEGIN
  -- ---------- operator_insert_documents ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_insert_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 2: cantidad inesperada de operator_insert_documents tras la corrección (%). ABORTADO.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_withcheck, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_insert_documents';

  IF v_cmd IS DISTINCT FROM 'INSERT' THEN RAISE EXCEPTION 'PASO 2: operator_insert_documents cambió de comando (real: %). ABORTADO.', v_cmd; END IF;
  IF v_permissive IS DISTINCT FROM true THEN RAISE EXCEPTION 'PASO 2: operator_insert_documents dejó de ser PERMISSIVE. ABORTADO.'; END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN RAISE EXCEPTION 'PASO 2: operator_insert_documents cambió de roles (real: %). ABORTADO.', v_roles; END IF;
  IF v_withcheck !~* 'card_id' OR v_withcheck !~* 'statement_id' OR v_withcheck !~* 'movement_id' OR v_withcheck !~* 'kind'
     OR v_withcheck !~* 'document_service_id' OR v_withcheck !~* 'obligation_service_id' OR v_withcheck !~* 'payment_service_id'
     OR v_withcheck !~* 'service_group_id' OR v_withcheck !~* 'can_operate_service' THEN
    RAISE EXCEPTION 'PASO 2: operator_insert_documents no quedó con la forma nueva esperada. ABORTADO. Definición real: %', v_withcheck;
  END IF;
  IF v_withcheck ~* 'can_operate_group' THEN
    RAISE EXCEPTION 'PASO 2: operator_insert_documents todavía referencia can_operate_group -- debía quedar reemplazado por completo. ABORTADO.';
  END IF;

  -- ---------- operator_update_documents ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_update_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 2: cantidad inesperada de operator_update_documents tras la corrección (%). ABORTADO.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_using, v_withcheck, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_update_documents';

  IF v_cmd IS DISTINCT FROM 'UPDATE' THEN RAISE EXCEPTION 'PASO 2: operator_update_documents cambió de comando (real: %). ABORTADO.', v_cmd; END IF;
  IF v_permissive IS DISTINCT FROM true THEN RAISE EXCEPTION 'PASO 2: operator_update_documents dejó de ser PERMISSIVE. ABORTADO.'; END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN RAISE EXCEPTION 'PASO 2: operator_update_documents cambió de roles (real: %). ABORTADO.', v_roles; END IF;
  IF v_using !~* 'card_id' OR v_using !~* 'statement_id' OR v_using !~* 'movement_id' OR v_using !~* 'kind'
     OR v_using !~* 'document_service_id' OR v_using !~* 'obligation_service_id' OR v_using !~* 'payment_service_id'
     OR v_using !~* 'service_group_id' OR v_using !~* 'can_operate_service' THEN
    RAISE EXCEPTION 'PASO 2: el USING de operator_update_documents no quedó con la forma nueva esperada. ABORTADO. Definición real: %', v_using;
  END IF;
  IF v_withcheck !~* 'card_id' OR v_withcheck !~* 'statement_id' OR v_withcheck !~* 'movement_id' OR v_withcheck !~* 'kind'
     OR v_withcheck !~* 'document_service_id' OR v_withcheck !~* 'obligation_service_id' OR v_withcheck !~* 'payment_service_id'
     OR v_withcheck !~* 'service_group_id' OR v_withcheck !~* 'can_operate_service' THEN
    RAISE EXCEPTION 'PASO 2: el WITH CHECK de operator_update_documents no quedó con la forma nueva esperada. ABORTADO. Definición real: %', v_withcheck;
  END IF;
  IF v_using ~* 'can_operate_group' OR v_withcheck ~* 'can_operate_group' THEN
    RAISE EXCEPTION 'PASO 2: operator_update_documents todavía referencia can_operate_group en USING o WITH CHECK. ABORTADO.';
  END IF;

  -- ---------- operator_delete_documents ----------
  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname='public' AND tablename='documents' AND policyname='operator_delete_documents';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 2: cantidad inesperada de operator_delete_documents tras la corrección (%). ABORTADO.', v_count;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' ELSE pol.polcmd::text END,
         pol.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(pol.polroles))
  INTO v_using, v_cmd, v_permissive, v_roles
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'documents' AND pol.polname = 'operator_delete_documents';

  IF v_cmd IS DISTINCT FROM 'DELETE' THEN RAISE EXCEPTION 'PASO 2: operator_delete_documents cambió de comando (real: %). ABORTADO.', v_cmd; END IF;
  IF v_permissive IS DISTINCT FROM true THEN RAISE EXCEPTION 'PASO 2: operator_delete_documents dejó de ser PERMISSIVE. ABORTADO.'; END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated']::text[] THEN RAISE EXCEPTION 'PASO 2: operator_delete_documents cambió de roles (real: %). ABORTADO.', v_roles; END IF;
  IF v_using !~* 'card_id' OR v_using !~* 'statement_id' OR v_using !~* 'movement_id' OR v_using !~* 'kind'
     OR v_using !~* 'document_service_id' OR v_using !~* 'obligation_service_id' OR v_using !~* 'payment_service_id'
     OR v_using !~* 'service_group_id' OR v_using !~* 'can_operate_service' THEN
    RAISE EXCEPTION 'PASO 2: operator_delete_documents no quedó con la forma nueva esperada. ABORTADO. Definición real: %', v_using;
  END IF;
  IF v_using ~* 'can_operate_group' THEN
    RAISE EXCEPTION 'PASO 2: operator_delete_documents todavía referencia can_operate_group. ABORTADO.';
  END IF;

  -- ---------- confirma que documents_select_member no fue tocada ----------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='documents_select_member'
  ) THEN
    RAISE EXCEPTION 'PASO 2: documents_select_member ya no existe -- no debía tocarse. ABORTADO.';
  END IF;

  -- ---------- confirma que las 4 policies de Tarjetas siguen existiendo ----------
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='documents'
      AND policyname IN ('documents_credit_select','documents_credit_insert','documents_credit_update','documents_credit_delete')) <> 4 THEN
    RAISE EXCEPTION 'PASO 2: las 4 policies de Tarjetas sobre documents no están todas presentes -- no debían tocarse. ABORTADO.';
  END IF;

  -- ---------- confirma que storage_insert_service_documents_operator no fue tocada en esta tarea ----------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='storage_insert_service_documents_operator'
  ) THEN
    RAISE EXCEPTION 'PASO 2: storage_insert_service_documents_operator ya no existe -- no debía tocarse en esta tarea. ABORTADO.';
  END IF;
END $$;

-- Confirmación explícita de que esta migración es 100% DDL sobre TRES
-- policies (ALTER POLICY, sin DROP/CREATE): no existe ninguna sentencia
-- real de INSERT/UPDATE/DELETE de datos en todo este archivo.

COMMIT;

-- ============================================================
-- ROLLBACK — restaura, vía ALTER POLICY, EXACTAMENTE la definición live
-- anterior de las 3 policies (reportada por Guido, no modificada por
-- esta migración de referencia). Idéntico al rollback de la revisión
-- anterior -- la definición original nunca cambió entre revisiones, solo
-- la corrección propuesta. Ejecutar manualmente solo si hace falta
-- revertir después de un COMMIT real:
-- ============================================================
-- ALTER POLICY operator_insert_documents
-- ON public.documents
-- WITH CHECK (
--   private.can_operate_group(group_id)
-- );
--
-- ALTER POLICY operator_update_documents
-- ON public.documents
-- USING (
--   private.can_operate_group(group_id)
-- )
-- WITH CHECK (
--   private.can_operate_group(group_id)
-- );
--
-- ALTER POLICY operator_delete_documents
-- ON public.documents
-- USING (
--   private.can_operate_group(group_id)
-- );
-- -- NOTA: este rollback REABRE el hallazgo de autorización insuficiente
-- -- descripto en el diagnóstico previo (INSERT/UPDATE/DELETE de
-- -- operador sobre public.documents dejan de validar el servicio real,
-- -- la coherencia obligation_id/payment_id, la coherencia de group_id,
-- -- is_private, y el aislamiento de Tarjetas por kind/statement_id/
-- -- movement_id), pero restaura fielmente el estado previo confirmado
-- -- en Supabase real, para el caso de que revertir sea necesario por
-- -- otro motivo.
-- ============================================================
