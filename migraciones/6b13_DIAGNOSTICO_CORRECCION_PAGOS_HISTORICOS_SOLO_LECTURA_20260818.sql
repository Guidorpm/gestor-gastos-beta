-- ============================================================
-- DIAGNÓSTICO SOLO LECTURA -- mejora #7, FASE 1 (auditoría + diseño,
-- NO programar todavía), 20260818.
-- ------------------------------------------------------------
-- Objetivo: conocer el estado REAL de public.payments,
-- public.payment_allocations, public.payment_contributions y su relación
-- con public.documents/public.obligations, para diseñar una corrección
-- NO destructiva de pagos históricos con importe incorrecto (caso de
-- referencia: comprobante real de Mercado Pago por $49.907,71).
--
-- NINGUNA sentencia de este archivo modifica datos ni esquema. Todo es
-- SELECT/WITH...SELECT contra information_schema/pg_catalog o SELECT de
-- solo lectura contra las tablas reales -- ninguna ejecuta INSERT/UPDATE/
-- DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE/POLICY.
--
-- NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DE GUIDO. Preparado para que
-- Guido lo ejecute manualmente en el SQL Editor de Supabase y comparta el
-- resultado completo -- el asistente no tiene acceso de ejecución.
-- ============================================================


-- ------------------------------------------------------------
-- SECCIÓN A -- public.payments: schema completo real
-- ------------------------------------------------------------

-- A1) Columnas completas (todas, no solo las que ya usa el cliente hoy:
--     id/obligation_id/total_amount/paid_at/voided/created_by/created_at).
--     El código cliente (index.html) NUNCA demuestra ausencia de columna,
--     solo demuestra uso -- confirmar si existen updated_at/voided_at/
--     voided_by/void_reason/otras, y su tipo/precisión/nulabilidad/default
--     real (numeric(14,2) se asume por el trigger de payment_allocations
--     ya ejecutado, pero se reconfirma acá).
SELECT ordinal_position, column_name, data_type, udt_name,
       character_maximum_length, numeric_precision, numeric_scale,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='payments'
ORDER BY ordinal_position;

-- A2) Primary key real de payments.
SELECT tc.constraint_name, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
WHERE tc.table_schema='public' AND tc.table_name='payments'
  AND tc.constraint_type='PRIMARY KEY';

-- A3) Foreign keys de payments (ej. obligation_id -> obligations.id,
--     created_by -> auth.users.id) con su ON DELETE/ON UPDATE real.
SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.payments'::regclass AND con.contype='f';

-- A4) CHECK constraints de payments (ej. total_amount>0, si existe alguno
--     ya, y cualquier CHECK relacionado con voided/voided_at/voided_by/
--     void_reason si esas columnas existen).
SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.payments'::regclass AND con.contype='c';

-- A5) UNIQUE constraints/índices de payments.
SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.payments'::regclass AND con.contype='u';

-- A6) TODOS los índices reales de payments (btree/otros, incluyendo los
--     que respaldan PK/UNIQUE ya listados arriba, para tener el cuadro
--     completo).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='payments';

-- A7) TODOS los triggers reales sobre payments (BEFORE/AFTER INSERT/
--     UPDATE/DELETE) -- necesitamos saber si YA existe algo que reaccione
--     a un UPDATE de payments, antes de proponer uno nuevo.
SELECT
  t.tgname,
  pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal;

-- A8) RLS habilitado en payments.
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid='public.payments'::regclass;

-- A9) TODAS las policies reales de payments (SELECT/INSERT/UPDATE/
--     DELETE), texto completo de qual/with_check -- necesitamos saber si
--     ya existe una policy de UPDATE (el cliente nunca hace UPDATE hoy,
--     pero eso no prueba que la policy no exista) y si permitiría un
--     UPDATE de solo total_amount+notes por el titular.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='payments'
ORDER BY cmd, policyname;

-- A10) Privilegios efectivos de escritura de authenticated sobre
--      payments (INSERT ya se sabe que funciona en producción; UPDATE es
--      el dato nuevo que falta para esta mejora).
SELECT
  has_table_privilege('authenticated','public.payments','SELECT') AS puede_select,
  has_table_privilege('authenticated','public.payments','INSERT') AS puede_insert,
  has_table_privilege('authenticated','public.payments','UPDATE') AS puede_update,
  has_table_privilege('authenticated','public.payments','DELETE') AS puede_delete;

-- A11) Funciones en public/private que las policies de payments podrían
--      estar invocando (búsqueda por coincidencia de texto, mismo
--      criterio ya usado en el diagnóstico 6b12 de documents -- puede
--      haber falsos positivos, es solo para no tener que adivinar
--      nombres de funciones de permisos).
SELECT n.nspname AS esquema, p.proname AS funcion, pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private')
  AND (
    p.proname ILIKE '%payment%' OR p.proname ILIKE '%can_manage%' OR
    p.proname ILIKE '%can_operate%' OR p.proname ILIKE '%is_owner%' OR
    p.proname ILIKE '%credit_owner%'
  )
ORDER BY esquema, funcion;


-- ------------------------------------------------------------
-- SECCIÓN B -- public.payment_allocations: impacto de corregir
-- payments.total_amount
-- ------------------------------------------------------------

-- B1) Columnas completas de payment_allocations (reconfirmar sobre lo ya
--     documentado en 6b11 -- payment_id, obligation_id, allocated_amount,
--     is_active, currency, y cualquier columna adicional no usada por el
--     cliente hoy).
SELECT ordinal_position, column_name, data_type, udt_name,
       numeric_precision, numeric_scale, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='payment_allocations'
ORDER BY ordinal_position;

-- B2) Foreign keys de payment_allocations -- ON DELETE real hacia
--     payments/obligations (annulPayment() asume CASCADE en su texto de
--     confirm(), nunca confirmado por SQL real hasta ahora).
SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.payment_allocations'::regclass AND con.contype='f';

-- B3) TODOS los triggers reales sobre payment_allocations (ya sabemos por
--     6b11 que existe trg_check_payment_allocation_integrity ->
--     check_payment_allocation_integrity(), que revalida contra
--     payments.total_amount en cada INSERT/UPDATE de payment_allocations
--     -- pero NO se dispara cuando se hace UPDATE de payments.total_amount
--     directamente. Se reconfirma texto completo actual.)
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgrelid='public.payment_allocations'::regclass AND NOT t.tgisinternal;

-- B4) Búsqueda de CUALQUIER trigger existente sobre public.payments que
--     ya se encargue de revalidar payment_allocations al cambiar
--     total_amount (si no aparece nada acá además de lo listado en A7,
--     confirma que HOY nada revalida allocations si se corrige el total
--     de un pago -- riesgo central de la mejora #7).
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgrelid='public.payments'::regclass AND NOT t.tgisinternal;

-- B5) Auditoría real: para cada payment CON al menos una allocation
--     activa, comparar total_amount vs. suma de allocated_amount activas
--     -- confirma si hoy existe algún caso donde bajar total_amount
--     dejaría allocations sobregiradas respecto del nuevo total (esto es
--     evidencia real para decidir la regla de guardia de la corrección).
SELECT
  p.id AS payment_id,
  p.total_amount,
  COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.is_active), 0) AS allocated_activo_total,
  p.total_amount - COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.is_active), 0) AS remanente_sin_asignar
FROM public.payments p
JOIN public.payment_allocations pa ON pa.payment_id=p.id
GROUP BY p.id, p.total_amount
HAVING COUNT(pa.id) FILTER (WHERE pa.is_active) > 0
ORDER BY remanente_sin_asignar ASC;


-- ------------------------------------------------------------
-- SECCIÓN C -- public.payment_contributions: consistencia con
-- total_amount
-- ------------------------------------------------------------

-- C1) Columnas completas de payment_contributions.
SELECT ordinal_position, column_name, data_type, udt_name,
       numeric_precision, numeric_scale, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='payment_contributions'
ORDER BY ordinal_position;

-- C2) Foreign keys de payment_contributions -- ON DELETE real hacia
--     payments (annulPayment() también asume CASCADE acá).
SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.payment_contributions'::regclass AND con.contype='f';

-- C3) TODOS los triggers reales sobre payment_contributions -- ¿existe
--     algo que valide que la suma de contributions == total_amount del
--     payment? (el cliente hoy solo lo valida en el momento de creación,
--     nunca en un UPDATE posterior porque nunca hace UPDATE de payments).
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgrelid='public.payment_contributions'::regclass AND NOT t.tgisinternal;

-- C4) Para cada payment, comparar total_amount vs. suma de
--     payment_contributions -- confirma si hoy existe algún caso donde
--     ya no coinciden (evidencia real de si esa invariante se mantiene
--     sola con el tiempo o si haría falta re-conciliar contributions
--     también al corregir total_amount).
SELECT
  p.id AS payment_id,
  p.total_amount,
  COALESCE(SUM(pc.amount),0) AS contributions_total,
  p.total_amount - COALESCE(SUM(pc.amount),0) AS diferencia
FROM public.payments p
LEFT JOIN public.payment_contributions pc ON pc.payment_id=p.id
GROUP BY p.id, p.total_amount
HAVING p.total_amount <> COALESCE(SUM(pc.amount),0)
ORDER BY diferencia DESC;


-- ------------------------------------------------------------
-- SECCIÓN D -- public.documents <-> public.payments
-- ------------------------------------------------------------

-- D1) Foreign key real de documents.payment_id -> payments.id, ON DELETE
--     (ya se sabe por mejora #6 que es CASCADE, se reconfirma en el mismo
--     lote que el resto de esta mejora, sin asumir nada de memoria).
SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid='public.documents'::regclass AND con.contype='f'
  AND pg_get_constraintdef(con.oid) ILIKE '%payment_id%';

-- D2) Documentos huérfanos o con payment_id apuntando a un payment
--     inexistente (no debería haber ninguno si la FK es real y válida,
--     pero se confirma en vez de asumir).
SELECT d.id, d.payment_id, d.kind, d.original_name
FROM public.documents d
LEFT JOIN public.payments p ON p.id=d.payment_id
WHERE d.payment_id IS NOT NULL AND p.id IS NULL;


-- ------------------------------------------------------------
-- SECCIÓN E -- caso real de referencia: comprobante de Mercado Pago
-- por $49.907,71 (búsqueda por evidencia, SIN UUID hardcodeado)
-- ------------------------------------------------------------
-- No conocemos todavía el service_id/obligation_id/payment_id real. Esta
-- sección busca candidatos por importe (con tolerancia de centavos) y por
-- texto relacionado a Mercado Pago, para que Guido identifique
-- visualmente el caso real en el resultado. Si ninguna fila aparece,
-- indica que falta un identificador mínimo (ver punto 20 del reporte de
-- entrega: probablemente el nombre exacto del servicio y el período/mes
-- del pago, o el id de la obligación, ya que el importe podría estar
-- repartido en más de un payment histórico).

-- E1) Pagos cuyo total_amount está en un entorno de $49.907,71 (por si el
--     importe real quedó registrado con alguna diferencia de centavos, o
--     por si existen dos pagos que sumados se acercan a ese valor -- ver
--     E3 para la variante agregada por obligación).
SELECT
  p.id AS payment_id, p.obligation_id, p.paid_at, p.total_amount, p.notes,
  p.voided, p.created_at,
  o.period, o.amount AS obligation_amount, o.service_id,
  s.name AS service_name, s.is_private
FROM public.payments p
JOIN public.obligations o ON o.id=p.obligation_id
JOIN public.services s ON s.id=o.service_id
WHERE p.total_amount BETWEEN 49000.00 AND 50500.00
ORDER BY p.created_at DESC;

-- E2) Servicios cuyo nombre sugiere Mercado Pago / Edesur (ambos
--     mencionados en el pedido -- "recargo forzado por la limitación
--     anterior" en el caso Edesur/Mercado Pago) -- ILIKE amplio a
--     propósito, para no perder el caso real por mayúsculas/acentos.
SELECT id, name, is_private, group_id
FROM public.services
WHERE name ILIKE '%edesur%' OR name ILIKE '%mercado%pago%' OR name ILIKE '%mercadopago%';

-- E3) Para cada obligación de esos servicios candidatos (E2), TODOS los
--     payments asociados, con suma total, para ver si el importe real
--     quedó repartido en más de un pago histórico (posible "pago
--     adicional creado para compensar la limitación antigua", que el
--     pedido explícitamente NO quiere asumir sin evidencia).
SELECT
  o.id AS obligation_id, o.period, o.amount AS obligation_amount, o.status,
  o.notes AS obligation_notes,
  p.id AS payment_id, p.paid_at, p.total_amount, p.notes AS payment_notes,
  p.voided, p.created_at
FROM public.obligations o
JOIN public.services s ON s.id=o.service_id
LEFT JOIN public.payments p ON p.obligation_id=o.id
WHERE s.name ILIKE '%edesur%' OR s.name ILIKE '%mercado%pago%' OR s.name ILIKE '%mercadopago%'
ORDER BY o.period DESC, p.created_at ASC;

-- E4) Para los payment_id candidatos de E1, sus payment_allocations
--     activas (para saber si ya se usó crédito de este pago hacia otra
--     obligación -- afectaría directamente el riesgo F del pedido: "cómo
--     evitar que una corrección duplique dinero").
SELECT
  pa.id, pa.payment_id, pa.obligation_id, pa.allocated_amount,
  pa.is_active, pa.currency
FROM public.payment_allocations pa
WHERE pa.payment_id IN (
  SELECT p.id FROM public.payments p
  WHERE p.total_amount BETWEEN 49000.00 AND 50500.00
);

-- E5) Documentos (comprobantes) asociados a los payment_id candidatos de
--     E1 -- confirma cuál es "el" comprobante real de $49.907,71 y si
--     coincide en cantidad/fecha con lo esperado (un único comprobante
--     real, según el pedido).
SELECT
  d.id, d.payment_id, d.obligation_id, d.kind, d.original_name,
  d.file_path, d.created_at, d.voided
FROM public.documents d
WHERE d.payment_id IN (
  SELECT p.id FROM public.payments p
  WHERE p.total_amount BETWEEN 49000.00 AND 50500.00
);
