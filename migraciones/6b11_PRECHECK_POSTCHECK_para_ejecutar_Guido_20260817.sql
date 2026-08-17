-- ============================================================
-- PARA QUE EJECUTE GUIDO EN EL SQL EDITOR DE SUPABASE -- Claude no tiene
-- acceso de ejecución en esta sesión (sin MCP, sin credenciales).
-- ------------------------------------------------------------
-- Orden sugerido:
--   1) Correr el bloque PRECHECK (A-D). Confirmar que da lo esperado.
--   2) Si A-D coinciden con lo esperado, correr el CREATE OR REPLACE
--      FUNCTION real (contenido idéntico al de
--      migraciones/6b11_ENDURECIMIENTO_PAYMENT_ALLOCATIONS_EXACTITUD_
--      CENTAVOS_20260817.sql, SHA-256
--      3aca381f4953613354685836f245ca49ec95e620c31343750631f2d074d0fc11).
--   3) Correr el bloque POSTCHECK y pegar el resultado completo acá para
--      que Claude lo audite.
-- Ninguna sentencia de este archivo (salvo la señalada en el paso 2)
-- modifica datos ni esquema.
-- ============================================================

-- ---------------- PRECHECK (solo lectura) ----------------

-- A) La función real todavía contiene "payment_total + 0.01" -- debe dar
--    TRUE antes de ejecutar (si da FALSE, alguien ya la cambió: DETENERSE).
SELECT pg_get_functiondef(p.oid) ILIKE '%payment_total + 0.01%' AS contiene_tolerancia_actual
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_payment_allocation_integrity';

-- B) El trigger real sigue siendo trg_check_payment_allocation_integrity
--    y sigue llamando a check_payment_allocation_integrity().
SELECT tgname AS trigger_name,
       tgrelid::regclass AS tabla,
       tgtype,
       pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgname = 'trg_check_payment_allocation_integrity'
  AND NOT t.tgisinternal;

-- C) Sigue habiendo pagos_con_exceso = 0 (repite el resumen agregado ya
--    confirmado por Guido, para verificar que no cambió nada mientras
--    tanto).
WITH por_pago AS (
  SELECT
    pa.payment_id,
    p.total_amount AS payment_total,
    SUM(pa.allocated_amount) AS allocated_total,
    SUM(pa.allocated_amount) - p.total_amount AS diferencia
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.id = pa.payment_id
  WHERE pa.is_active = true
  GROUP BY pa.payment_id, p.total_amount
)
SELECT
  COUNT(*) FILTER (WHERE diferencia > 0) AS pagos_con_exceso,
  COUNT(*) FILTER (WHERE diferencia = 0.01) AS pagos_con_exceso_exacto_1_centavo,
  COUNT(*) FILTER (WHERE diferencia > 0.01) AS pagos_con_exceso_mayor_a_1_centavo,
  COUNT(*) AS total_pagos_con_allocations_activas,
  MAX(diferencia) AS maximo_exceso_detectado,
  MIN(diferencia) AS minima_diferencia_detectada
FROM por_pago;

-- D) Sigue habiendo 0 allocations activas huérfanas.
SELECT pa.id, pa.payment_id, pa.obligation_id, pa.allocated_amount
FROM public.payment_allocations pa
LEFT JOIN public.payments p ON p.id = pa.payment_id
WHERE pa.is_active = true
  AND p.id IS NULL;


-- ---------------- EJECUCIÓN (paso 2 -- la única sentencia que escribe) ----------------
-- Copiar y ejecutar EXACTAMENTE el contenido de:
-- migraciones/6b11_ENDURECIMIENTO_PAYMENT_ALLOCATIONS_EXACTITUD_CENTAVOS_20260817.sql
-- No se repite acá para no correr el riesgo de que este archivo combinado
-- se ejecute entero de una sola vez sin revisión intermedia.


-- ---------------- POSTCHECK (solo lectura) ----------------

-- 1) Definición completa de la función después de aplicar el cambio.
SELECT pg_get_functiondef(p.oid) AS definicion_actual
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_payment_allocation_integrity';

-- 2) Confirmación puntual: ya NO debe contener "payment_total + 0.01",
--    y SÍ debe contener la comparación exacta sin tolerancia.
SELECT
  pg_get_functiondef(p.oid) ILIKE '%payment_total + 0.01%' AS todavia_tiene_tolerancia,
  pg_get_functiondef(p.oid) ILIKE '%allocated_total + NEW.allocated_amount > payment_total THEN%' AS tiene_comparacion_exacta
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_payment_allocation_integrity';

-- 3) El trigger sigue existiendo, sigue BEFORE INSERT OR UPDATE, sigue
--    apuntando a la misma función (mismo query que el precheck B).
SELECT tgname AS trigger_name,
       tgrelid::regclass AS tabla,
       tgtype,
       pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgname = 'trg_check_payment_allocation_integrity'
  AND NOT t.tgisinternal;

-- 4) Repetir la auditoría de datos completa (mismo query que el
--    precheck C) -- debe dar EXACTAMENTE los mismos números, porque esta
--    migración no toca ninguna fila.
WITH por_pago AS (
  SELECT
    pa.payment_id,
    p.total_amount AS payment_total,
    SUM(pa.allocated_amount) AS allocated_total,
    SUM(pa.allocated_amount) - p.total_amount AS diferencia
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.id = pa.payment_id
  WHERE pa.is_active = true
  GROUP BY pa.payment_id, p.total_amount
)
SELECT
  COUNT(*) FILTER (WHERE diferencia > 0) AS pagos_con_exceso,
  COUNT(*) FILTER (WHERE diferencia = 0.01) AS pagos_con_exceso_exacto_1_centavo,
  COUNT(*) FILTER (WHERE diferencia > 0.01) AS pagos_con_exceso_mayor_a_1_centavo,
  COUNT(*) AS total_pagos_con_allocations_activas,
  MAX(diferencia) AS maximo_exceso_detectado,
  MIN(diferencia) AS minima_diferencia_detectada
FROM por_pago;

-- 5) Allocations activas huérfanas (mismo query que precheck D) -- debe
--    seguir dando 0 filas.
SELECT pa.id, pa.payment_id, pa.obligation_id, pa.allocated_amount
FROM public.payment_allocations pa
LEFT JOIN public.payments p ON p.id = pa.payment_id
WHERE pa.is_active = true
  AND p.id IS NULL;
