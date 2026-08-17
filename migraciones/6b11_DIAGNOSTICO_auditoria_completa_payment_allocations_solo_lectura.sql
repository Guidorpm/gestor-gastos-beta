-- ============================================================
-- DIAGNÓSTICO SOLO LECTURA -- auditoría COMPLETA (sin LIMIT) de todas las
-- payment_allocations activas reales, para confirmar si es seguro
-- endurecer check_payment_allocation_integrity() eliminando la
-- tolerancia de +0.01 (mejora #5, 20260817).
-- ------------------------------------------------------------
-- NINGUNA sentencia de este archivo modifica datos ni esquema. Todo es
-- SELECT de agregación sobre payments/payment_allocations -- ninguna
-- ejecuta ni crea nada, solo describen lo que YA existe.
--
-- Motivo: la muestra de 20 filas que Guido ya audité manualmente (2
-- pagos, diferencia 0.00 en ambos) no alcanza para garantizar que NINGÚN
-- pago en la base tiene una allocation activa que exceda su
-- payment_total -- necesitamos el universo completo antes de proponer
-- que la migración de endurecimiento es segura. Ejecutar en el SQL
-- Editor de Supabase y compartir el resultado completo.
-- ============================================================

-- 1) Por cada pago con al menos una allocation ACTIVA: total del pago,
--    suma de allocations activas, diferencia (positivo = sobreimputado),
--    cantidad de allocations activas, y si hay exceso.
--    diff redondeado a 2 decimales por prolijidad (las columnas ya son
--    numeric(14,2), esto no introduce ninguna tolerancia nueva -- es
--    solo para que el resultado se lea limpio, la comparación real de
--    "exceso" usa el numeric exacto, sin redondear).
SELECT
  pa.payment_id,
  p.total_amount AS payment_total,
  SUM(pa.allocated_amount) AS allocated_total,
  SUM(pa.allocated_amount) - p.total_amount AS diferencia,
  COUNT(*) AS cantidad_allocations_activas,
  (SUM(pa.allocated_amount) > p.total_amount) AS existe_exceso
FROM public.payment_allocations pa
JOIN public.payments p ON p.id = pa.payment_id
WHERE pa.is_active = true
GROUP BY pa.payment_id, p.total_amount
ORDER BY (SUM(pa.allocated_amount) - p.total_amount) DESC;

-- 2) Resumen agregado -- responde directamente las 4 preguntas pedidas:
--    (a) ¿existe hoy alguna allocation activa cuyo total supere el
--        payment total?
--    (b) ¿existe algún exceso EXACTAMENTE de $0.01?
--    (c) ¿existe algún exceso MAYOR a $0.01?
--    (d) ¿cuántos pagos están afectados en total?
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

-- 3) Chequeo defensivo adicional: allocations activas que referencian un
--    payment_id inexistente en payments (no debería ocurrir por la FK,
--    pero se confirma explícitamente antes de tocar el trigger que
--    depende de ese SELECT). Solo lectura, mismo criterio.
SELECT pa.id, pa.payment_id, pa.obligation_id, pa.allocated_amount
FROM public.payment_allocations pa
LEFT JOIN public.payments p ON p.id = pa.payment_id
WHERE pa.is_active = true
  AND p.id IS NULL;
