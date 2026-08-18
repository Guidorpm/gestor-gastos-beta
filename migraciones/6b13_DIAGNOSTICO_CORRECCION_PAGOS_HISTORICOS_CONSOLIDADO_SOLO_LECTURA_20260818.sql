-- ============================================================
-- DIAGNÓSTICO CONSOLIDADO SOLO LECTURA -- mejora #7, FASE 1, 20260818
-- ------------------------------------------------------------
-- Versión de UNA SOLA sentencia (WITH ... SELECT jsonb_build_object(...))
-- del diagnóstico ya preparado en
-- migraciones/6b13_DIAGNOSTICO_CORRECCION_PAGOS_HISTORICOS_SOLO_LECTURA_20260818.sql
-- (27 SELECT, 30/30 tests) -- ese archivo NO fue reemplazado ni borrado,
-- sigue siendo la versión de referencia detallada. Este archivo consolida
-- la MISMA cobertura (y la amplía en payment_contributions y en el caso
-- Mercado Pago) en un único resultado JSON, para poder ejecutarse de una
-- sola vez en el SQL Editor de Supabase y compartir un solo bloque de
-- resultado.
--
-- 100% SOLO LECTURA. NINGUNA sentencia de este archivo modifica datos ni
-- esquema -- todo es SELECT/WITH...SELECT contra information_schema/
-- pg_catalog/pg_policies o SELECT de solo lectura contra las tablas
-- reales. Las palabras INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/
-- GRANT/REVOKE/POLICY que aparezcan en este archivo lo hacen SOLO como
-- texto dentro de pg_get_constraintdef()/pg_get_triggerdef()/
-- pg_get_functiondef() (definiciones ya existentes, devueltas tal cual
-- por funciones read-only), dentro de qual/with_check de pg_policies, o
-- como argumento string literal de has_table_privilege(cmd) -- nunca
-- como código SQL ejecutable real.
--
-- NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DE GUIDO. Preparado para que
-- Guido lo ejecute manualmente y comparta el JSON completo -- el
-- asistente no tiene acceso de ejecución en este entorno.
-- ============================================================

WITH

-- ------------------------------------------------------------
-- SECCIÓN 1: public.payments -- schema real completo
-- ------------------------------------------------------------
payments_columns AS (
  SELECT jsonb_agg(jsonb_build_object(
    'ordinal_position', c.ordinal_position,
    'column_name', c.column_name,
    'data_type', c.data_type,
    'udt_name', c.udt_name,
    'character_maximum_length', c.character_maximum_length,
    'numeric_precision', c.numeric_precision,
    'numeric_scale', c.numeric_scale,
    'is_nullable', c.is_nullable,
    'column_default', c.column_default
  ) ORDER BY c.ordinal_position) AS data
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='payments'
),
payments_focus_columns AS (
  -- Subconjunto explícito pedido: voided/voided_at/voided_by/void_reason/
  -- notes/total_amount -- para no tener que buscarlas dentro del array
  -- completo de arriba.
  SELECT jsonb_agg(jsonb_build_object(
    'column_name', c.column_name,
    'data_type', c.data_type,
    'is_nullable', c.is_nullable,
    'column_default', c.column_default
  ) ORDER BY c.column_name) AS data
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='payments'
    AND c.column_name IN ('voided','voided_at','voided_by','void_reason','notes','total_amount')
),
payments_pk AS (
  SELECT jsonb_agg(jsonb_build_object(
    'constraint_name', tc.constraint_name,
    'column_name', kcu.column_name
  )) AS data
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
  WHERE tc.table_schema='public' AND tc.table_name='payments'
    AND tc.constraint_type='PRIMARY KEY'
),
payments_fk AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payments'::regclass AND con.contype='f'
),
payments_check AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payments'::regclass AND con.contype='c'
),
payments_unique AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payments'::regclass AND con.contype='u'
),
payments_indexes AS (
  SELECT jsonb_agg(jsonb_build_object(
    'indexname', i.indexname,
    'indexdef', i.indexdef
  )) AS data
  FROM pg_indexes i
  WHERE i.schemaname='public' AND i.tablename='payments'
),
payments_triggers AS (
  SELECT jsonb_agg(jsonb_build_object(
    'tgname', t.tgname,
    'definicion', pg_get_triggerdef(t.oid)
  )) AS data
  FROM pg_trigger t
  WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal
),
payments_rls AS (
  SELECT jsonb_build_object(
    'relrowsecurity', relrowsecurity,
    'relforcerowsecurity', relforcerowsecurity
  ) AS data
  FROM pg_class
  WHERE oid='public.payments'::regclass
),
payments_policies AS (
  SELECT jsonb_agg(jsonb_build_object(
    'policyname', pol.policyname,
    'cmd', pol.cmd,
    'permissive', pol.permissive,
    'roles', pol.roles,
    'qual', pol.qual,
    'with_check', pol.with_check
  ) ORDER BY pol.cmd, pol.policyname) AS data
  FROM pg_policies pol
  WHERE pol.schemaname='public' AND pol.tablename='payments'
),
payments_update_policies AS (
  -- Foco explícito pedido: policies que gobiernan UPDATE (o ALL, que
  -- también cubre UPDATE) sobre payments -- necesarias para decidir
  -- después si "Corregir pago" puede ser titular-only u operador.
  SELECT jsonb_agg(jsonb_build_object(
    'policyname', pol.policyname,
    'cmd', pol.cmd,
    'permissive', pol.permissive,
    'roles', pol.roles,
    'qual', pol.qual,
    'with_check', pol.with_check
  ) ORDER BY pol.policyname) AS data
  FROM pg_policies pol
  WHERE pol.schemaname='public' AND pol.tablename='payments'
    AND pol.cmd IN ('UPDATE','ALL')
),
payments_privileges AS (
  SELECT jsonb_build_object(
    'authenticated_can_select', has_table_privilege('authenticated','public.payments','SELECT'),
    'authenticated_can_insert', has_table_privilege('authenticated','public.payments','INSERT'),
    'authenticated_can_update', has_table_privilege('authenticated','public.payments','UPDATE'),
    'authenticated_can_delete', has_table_privilege('authenticated','public.payments','DELETE')
  ) AS data
),
policy_functions AS (
  -- Funciones en public/private que las policies de payments (o de
  -- payment_allocations/payment_contributions/documents) podrían estar
  -- invocando -- búsqueda por coincidencia de texto en el nombre, mismo
  -- criterio ya usado en el diagnóstico de mejora #6 (puede haber falsos
  -- positivos/negativos, no es una resolución semántica real).
  SELECT jsonb_agg(jsonb_build_object(
    'esquema', n.nspname,
    'funcion', p.proname,
    'definicion', pg_get_functiondef(p.oid)
  ) ORDER BY n.nspname, p.proname) AS data
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','private')
    AND (
      p.proname ILIKE '%payment%' OR p.proname ILIKE '%can_manage%' OR
      p.proname ILIKE '%can_operate%' OR p.proname ILIKE '%is_owner%' OR
      p.proname ILIKE '%credit_owner%'
    )
),

-- ------------------------------------------------------------
-- SECCIÓN 2: public.payment_allocations -- impacto de corregir
-- payments.total_amount
-- ------------------------------------------------------------
allocations_columns AS (
  SELECT jsonb_agg(jsonb_build_object(
    'ordinal_position', c.ordinal_position,
    'column_name', c.column_name,
    'data_type', c.data_type,
    'udt_name', c.udt_name,
    'numeric_precision', c.numeric_precision,
    'numeric_scale', c.numeric_scale,
    'is_nullable', c.is_nullable,
    'column_default', c.column_default
  ) ORDER BY c.ordinal_position) AS data
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='payment_allocations'
),
allocations_fk AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payment_allocations'::regclass AND con.contype='f'
),
allocations_constraints AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'contype', con.contype,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payment_allocations'::regclass AND con.contype IN ('c','u')
),
allocations_triggers AS (
  SELECT jsonb_agg(jsonb_build_object(
    'tgname', t.tgname,
    'definicion', pg_get_triggerdef(t.oid)
  )) AS data
  FROM pg_trigger t
  WHERE t.tgrelid='public.payment_allocations'::regclass AND NOT t.tgisinternal
),
check_integrity_function_definition AS (
  -- Definición REAL y actual de check_payment_allocation_integrity(),
  -- para confirmar que sigue siendo exactamente la endurecida en 6b11
  -- (sin tolerancia de +0.01).
  SELECT jsonb_build_object(
    'existe', COUNT(*) > 0,
    'definicion', MAX(pg_get_functiondef(p.oid))
  ) AS data
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='check_payment_allocation_integrity'
),
payments_triggers_revalidating_allocations AS (
  -- Si esto devuelve vacío/[] además de lo ya listado en payments_triggers
  -- de la sección 1, confirma que HOY nada revalida payment_allocations
  -- cuando se hace UPDATE directo de payments.total_amount -- riesgo
  -- central de la mejora #7 (idéntico contenido a payments_triggers,
  -- repetido acá con nombre explícito para que la respuesta sea
  -- inequívoca sin tener que cruzar dos secciones).
  SELECT jsonb_agg(jsonb_build_object(
    'tgname', t.tgname,
    'definicion', pg_get_triggerdef(t.oid)
  )) AS data
  FROM pg_trigger t
  WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal
),
allocations_summary_per_payment AS (
  -- Por cada payment CON al menos una allocation activa: total_amount,
  -- suma allocated_amount activa, diferencia, cantidad de allocations.
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'payment_total_amount', p.total_amount,
    'allocated_activo_total', COALESCE(sub.allocated_activo_total,0),
    'diferencia', p.total_amount - COALESCE(sub.allocated_activo_total,0),
    'cantidad_allocations_activas', COALESCE(sub.cantidad_activas,0)
  ) ORDER BY (p.total_amount - COALESCE(sub.allocated_activo_total,0)) ASC) AS data
  FROM public.payments p
  JOIN (
    SELECT pa.payment_id,
           SUM(pa.allocated_amount) FILTER (WHERE pa.is_active) AS allocated_activo_total,
           COUNT(*) FILTER (WHERE pa.is_active) AS cantidad_activas
    FROM public.payment_allocations pa
    GROUP BY pa.payment_id
    HAVING COUNT(*) FILTER (WHERE pa.is_active) > 0
  ) sub ON sub.payment_id=p.id
),
allocations_overallocated AS (
  -- Pagos donde la suma de allocations activas SUPERA total_amount --
  -- debería estar siempre vacío (el trigger de integridad ya lo impide
  -- en cada INSERT/UPDATE de payment_allocations), pero se confirma con
  -- datos reales, nunca se asume.
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'payment_total_amount', p.total_amount,
    'allocated_activo_total', sub.allocated_activo_total,
    'exceso', sub.allocated_activo_total - p.total_amount
  )) AS data
  FROM public.payments p
  JOIN (
    SELECT pa.payment_id, SUM(pa.allocated_amount) FILTER (WHERE pa.is_active) AS allocated_activo_total
    FROM public.payment_allocations pa
    GROUP BY pa.payment_id
  ) sub ON sub.payment_id=p.id
  WHERE sub.allocated_activo_total > p.total_amount
),

-- ------------------------------------------------------------
-- SECCIÓN 3: public.payment_contributions -- MUY IMPORTANTE
-- ------------------------------------------------------------
contributions_columns AS (
  SELECT jsonb_agg(jsonb_build_object(
    'ordinal_position', c.ordinal_position,
    'column_name', c.column_name,
    'data_type', c.data_type,
    'udt_name', c.udt_name,
    'numeric_precision', c.numeric_precision,
    'numeric_scale', c.numeric_scale,
    'is_nullable', c.is_nullable,
    'column_default', c.column_default
  ) ORDER BY c.ordinal_position) AS data
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='payment_contributions'
),
contributions_fk AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payment_contributions'::regclass AND con.contype='f'
),
contributions_constraints AS (
  -- CHECK/UNIQUE reales sobre payment_contributions -- responde
  -- directamente la pregunta B: "¿hay constraint que garantice que las
  -- contributions sumen exactamente total_amount?" (una constraint así
  -- no puede expresarse como CHECK de fila simple -- si existe, sería vía
  -- trigger; ver contributions_triggers).
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'contype', con.contype,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.payment_contributions'::regclass AND con.contype IN ('c','u')
),
contributions_triggers AS (
  -- Responde la pregunta B con evidencia real: ¿existe un trigger que
  -- valide la suma de contributions contra total_amount en cada INSERT/
  -- UPDATE de payment_contributions?
  SELECT jsonb_agg(jsonb_build_object(
    'tgname', t.tgname,
    'definicion', pg_get_triggerdef(t.oid)
  )) AS data
  FROM pg_trigger t
  WHERE t.tgrelid='public.payment_contributions'::regclass AND NOT t.tgisinternal
),
contributions_summary_per_payment AS (
  -- Responde la pregunta A/C con evidencia real: para CADA payment,
  -- total_amount vs. suma de contributions, diferencia, cantidad.
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'payment_total_amount', p.total_amount,
    'contributions_total', COALESCE(sub.contributions_total,0),
    'diferencia', p.total_amount - COALESCE(sub.contributions_total,0),
    'cantidad_contributions', COALESCE(sub.cantidad,0)
  ) ORDER BY p.created_at DESC) AS data
  FROM public.payments p
  LEFT JOIN (
    SELECT pc.payment_id, SUM(pc.amount) AS contributions_total, COUNT(*) AS cantidad
    FROM public.payment_contributions pc
    GROUP BY pc.payment_id
  ) sub ON sub.payment_id=p.id
),
contributions_mismatch AS (
  -- Subconjunto de arriba, solo los payments donde NO coinciden --
  -- responde la pregunta C directamente ("¿existen hoy payments donde no
  -- coincidan?"): si este array viene vacío, coinciden siempre hoy; si
  -- no, están los casos reales con su diferencia exacta.
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'payment_total_amount', p.total_amount,
    'contributions_total', COALESCE(sub.contributions_total,0),
    'diferencia', p.total_amount - COALESCE(sub.contributions_total,0)
  ) ORDER BY (p.total_amount - COALESCE(sub.contributions_total,0)) DESC) AS data
  FROM public.payments p
  LEFT JOIN (
    SELECT pc.payment_id, SUM(pc.amount) AS contributions_total
    FROM public.payment_contributions pc
    GROUP BY pc.payment_id
  ) sub ON sub.payment_id=p.id
  WHERE p.total_amount <> COALESCE(sub.contributions_total,0)
),

-- ------------------------------------------------------------
-- SECCIÓN 4: public.documents <-> public.payments
-- ------------------------------------------------------------
documents_payment_fk AS (
  SELECT jsonb_agg(jsonb_build_object(
    'conname', con.conname,
    'definicion', pg_get_constraintdef(con.oid)
  )) AS data
  FROM pg_constraint con
  WHERE con.conrelid='public.documents'::regclass AND con.contype='f'
    AND pg_get_constraintdef(con.oid) ILIKE '%payment_id%'
),
documents_count_per_payment AS (
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'documentos_asociados', COALESCE(sub.cantidad,0)
  ) ORDER BY p.created_at DESC) AS data
  FROM public.payments p
  LEFT JOIN (
    SELECT d.payment_id, COUNT(*) AS cantidad
    FROM public.documents d
    WHERE d.payment_id IS NOT NULL
    GROUP BY d.payment_id
  ) sub ON sub.payment_id=p.id
),
documents_orphans AS (
  SELECT jsonb_agg(jsonb_build_object(
    'document_id', d.id,
    'payment_id', d.payment_id,
    'kind', d.kind,
    'original_name', d.original_name
  )) AS data
  FROM public.documents d
  LEFT JOIN public.payments p ON p.id=d.payment_id
  WHERE d.payment_id IS NOT NULL AND p.id IS NULL
),

-- ------------------------------------------------------------
-- SECCIÓN 5: caso real Mercado Pago -- SIN UUID hardcodeado, por
-- evidencia (importe cercano a 49.907,71 real / 49.733 histórico,
-- servicios candidatos por nombre)
-- ------------------------------------------------------------
mercado_pago_candidate_payments AS (
  SELECT p.id AS payment_id, p.obligation_id
  FROM public.payments p
  WHERE p.total_amount BETWEEN 48500.00 AND 50500.00
),
mercado_pago_candidate_services AS (
  SELECT id AS service_id
  FROM public.services
  WHERE name ILIKE '%edesur%'
     OR name ILIKE '%mercado%pago%'
     OR name ILIKE '%mercadopago%'
     OR name ILIKE '%muebles%plata%'
),
mercado_pago_candidate_obligations AS (
  -- Unión de: obligaciones de los payments candidatos por importe, MÁS
  -- todas las obligaciones de los servicios candidatos por nombre (aunque
  -- ese período puntual no tenga hoy un payment en el rango de importe --
  -- por si el pago real quedó repartido en más de uno, ninguno
  -- individualmente en el rango).
  SELECT DISTINCT o.id AS obligation_id
  FROM public.obligations o
  WHERE o.id IN (SELECT obligation_id FROM mercado_pago_candidate_payments)
     OR o.service_id IN (SELECT service_id FROM mercado_pago_candidate_services)
),
mercado_pago_detail AS (
  -- Detalle completo por obligación candidata: servicio, obligación
  -- (incluye notes completas, sin parsear -- puede contener metadata de
  -- segundo vencimiento), TODOS sus payments (no solo el candidato),
  -- notes de cada payment, appliedDueStage extraído por texto (sin
  -- asumir JSON válido -- regexp_match tolera notes NULL o no-JSON sin
  -- romper la consulta), voided+metadata, contributions, allocations,
  -- documentos asociados. Se agrega también la suma total de todos los
  -- payments NO anulados de la obligación, para saber si el importe real
  -- quedó repartido en más de un pago histórico.
  SELECT jsonb_agg(jsonb_build_object(
    'service_id', s.id,
    'service_name', s.name,
    'service_is_private', s.is_private,
    'obligation_id', o.id,
    'obligation_period', o.period,
    'obligation_amount', o.amount,
    'obligation_status', o.status,
    'obligation_notes', o.notes,
    'suma_payments_no_anulados', (
      SELECT COALESCE(SUM(p2.total_amount),0)
      FROM public.payments p2
      WHERE p2.obligation_id=o.id AND p2.voided IS DISTINCT FROM true
    ),
    'payments', (
      SELECT jsonb_agg(jsonb_build_object(
        'payment_id', p.id,
        'paid_at', p.paid_at,
        'total_amount', p.total_amount,
        'notes', p.notes,
        'applied_due_stage_desde_notes',
          (regexp_match(COALESCE(p.notes,''), '"appliedDueStage"\s*:\s*"(\w+)"'))[1],
        'voided', p.voided,
        'created_at', p.created_at,
        'created_by', p.created_by,
        'contributions', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', pc.id, 'amount', pc.amount, 'membership_id', pc.membership_id
          ))
          FROM public.payment_contributions pc
          WHERE pc.payment_id=p.id
        ),
        'allocations', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', pa.id, 'obligation_id', pa.obligation_id,
            'allocated_amount', pa.allocated_amount,
            'is_active', pa.is_active, 'currency', pa.currency
          ))
          FROM public.payment_allocations pa
          WHERE pa.payment_id=p.id
        ),
        'documents', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'kind', d.kind, 'original_name', d.original_name,
            'file_path', d.file_path, 'voided', d.voided, 'created_at', d.created_at
          ))
          FROM public.documents d
          WHERE d.payment_id=p.id
        )
      ) ORDER BY p.created_at ASC)
      FROM public.payments p
      WHERE p.obligation_id=o.id
    ),
    'invoice_documents', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'original_name', d.original_name,
        'file_path', d.file_path, 'voided', d.voided
      ))
      FROM public.documents d
      WHERE d.obligation_id=o.id AND d.kind='invoice'
    )
  ) ORDER BY o.period DESC) AS data
  FROM public.obligations o
  JOIN public.services s ON s.id=o.service_id
  WHERE o.id IN (SELECT obligation_id FROM mercado_pago_candidate_obligations)
)

-- ------------------------------------------------------------
-- RESULTADO FINAL: un único objeto JSON con todas las secciones
-- ------------------------------------------------------------
SELECT jsonb_build_object(
  'generado_en', now(),
  'aviso', 'Solo hechos read-only. La diferencia entre el comprobante real y el importe de factura NO debe interpretarse acá como interés/recargo/comisión/segundo vencimiento/saldo a favor -- eso requiere evidencia documental aparte.',

  'payments_columns', (SELECT data FROM payments_columns),
  'payments_focus_columns', (SELECT data FROM payments_focus_columns),
  'payments_pk', (SELECT data FROM payments_pk),
  'payments_fk', (SELECT data FROM payments_fk),
  'payments_check', (SELECT data FROM payments_check),
  'payments_unique', (SELECT data FROM payments_unique),
  'payments_indexes', (SELECT data FROM payments_indexes),
  'payments_triggers', (SELECT data FROM payments_triggers),
  'payments_rls', (SELECT data FROM payments_rls),
  'payments_policies', (SELECT data FROM payments_policies),
  'payments_update_policies', (SELECT data FROM payments_update_policies),
  'payments_privileges', (SELECT data FROM payments_privileges),
  'policy_functions', (SELECT data FROM policy_functions),

  'allocations_columns', (SELECT data FROM allocations_columns),
  'allocations_fk', (SELECT data FROM allocations_fk),
  'allocations_constraints', (SELECT data FROM allocations_constraints),
  'allocations_triggers', (SELECT data FROM allocations_triggers),
  'check_integrity_function_definition', (SELECT data FROM check_integrity_function_definition),
  'payments_triggers_revalidating_allocations', (SELECT data FROM payments_triggers_revalidating_allocations),
  'allocations_summary_per_payment', (SELECT data FROM allocations_summary_per_payment),
  'allocations_overallocated', (SELECT data FROM allocations_overallocated),

  'contributions_columns', (SELECT data FROM contributions_columns),
  'contributions_fk', (SELECT data FROM contributions_fk),
  'contributions_constraints', (SELECT data FROM contributions_constraints),
  'contributions_triggers', (SELECT data FROM contributions_triggers),
  'contributions_summary_per_payment', (SELECT data FROM contributions_summary_per_payment),
  'contributions_mismatch', (SELECT data FROM contributions_mismatch),

  'documents_payment_fk', (SELECT data FROM documents_payment_fk),
  'documents_count_per_payment', (SELECT data FROM documents_count_per_payment),
  'documents_orphans', (SELECT data FROM documents_orphans),

  'mercado_pago_detail', (SELECT data FROM mercado_pago_detail)
) AS diagnostico_6b13_consolidado;
