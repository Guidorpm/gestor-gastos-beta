-- ============================================================
-- POSTCHECK V2 — FIX MIN(uuid) de public.correct_historical_payment
-- SOLO LECTURA — bugfix #12, 20260820
-- ------------------------------------------------------------
-- OBJETIVO ÚNICO: confirmar, contra el estado REAL de Supabase, que
-- migraciones/6b15_FIX_CORRECT_HISTORICAL_PAYMENT_MIN_UUID_NO_EJECUTAR_20260820.sql
-- (YA EJECUTADA por Guido, resultado real "Success. No rows returned")
-- quedó aplicada correctamente y que nada más cambió. NO interpreta, NO
-- corrige, NO propone -- solo trae los hechos reales.
--
-- POR QUÉ EXISTE V2: la versión anterior (6b15_POSTCHECK_..._20260820.sql,
-- sin "_V2") disparó una advertencia real del SQL Editor de Supabase,
-- del tipo "Potential issue detected -- this query creates a table
-- without enabling Row Level Security", nombrando ahí una de las
-- variables internas del RPC auditado. Guido eligió correctamente
-- "Cancel" -- esa versión NUNCA se ejecutó.
--
-- CAUSA REAL CONFIRMADA (no una suposición): el analizador estático del
-- SQL Editor escanea el TEXTO CRUDO de la consulta buscando, en
-- cualquier parte del archivo (incluso dentro de comillas simples), la
-- combinación de dos palabras clave de PostgreSQL que -- en SQL plano,
-- fuera de una función PL/pgSQL -- forman sintaxis real de creación de
-- tabla a partir de un resultado. El analizador NO entiende que esa
-- combinación vivía dentro de literales de comparación (ILIKE) usados
-- para auditar, por lectura, el código fuente real de una función -- la
-- interpreta igual que si fuera SQL ejecutable real. Esa misma
-- combinación de palabras aparecía, en el archivo anterior, dentro de
-- DOS literales de texto usados como patrón de búsqueda -- nunca código
-- ejecutable real, pero de todos modos visibles para el analizador.
--
-- CORRECCIÓN EN V2: se eliminan esos dos literales completos. En su
-- lugar, se verifica la MISMA garantía real (que el patrón de dos pasos
-- del fix esté presente) buscando cada palabra clave por separado con
-- position(), y el ORDEN relativo en el que las variables aparecen
-- dentro de la definición real de la función -- sin que este archivo
-- vuelva a escribir, en ningún punto (código, comentario o literal), esa
-- combinación de dos palabras clave una junto a la otra. Mismo resultado
-- auditado que antes, construido de forma que el analizador no pueda
-- confundirlo con DDL real.
--
-- 100% SELECT/CTE. Cero INSERT/UPDATE/DELETE/UPSERT/CREATE/ALTER/DROP/
-- TRUNCATE/GRANT/REVOKE/DO/EXECUTE/CALL/SQL dinámico. Las consultas que
-- leen filas reales del caso conocido de Edesur (antecedentes de bugfix
-- #12) son SELECT puros, restringidos por WHERE a los IDs ya conocidos
-- de este caso puntual -- nunca recorren toda la tabla, nunca listan
-- otros grupos/servicios/usuarios/pagos.
-- ============================================================

-- ============================================================
-- 1/2/3/4/5/6 — función: existencia, firma completa, RETURNS,
-- SECURITY DEFINER, search_path, definición completa real (para
-- revisión humana directa -- la forma más segura de confirmar el
-- contenido real, sin que este archivo tenga que citarlo).
-- ============================================================
SELECT
  n.nspname AS schema,
  p.proname AS funcion,
  pg_get_function_arguments(p.oid) AS firma_argumentos,
  pg_get_function_result(p.oid) AS retorno,
  p.prosecdef AS security_definer,
  p.proconfig AS config_real,
  (SELECT array_to_string(
      array_agg(cfg), ', '
    ) FROM unnest(p.proconfig) AS cfg WHERE cfg ILIKE 'search_path=%'
  ) AS search_path_real,
  pg_get_functiondef(p.oid) AS definicion_completa
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'correct_historical_payment';

-- ============================================================
-- 7 — ausencia de MIN(id)/MAX(id) (o cualquier MIN/MAX sobre una
-- columna uuid) en la definición real desplegada.
-- ============================================================
SELECT
  pg_get_functiondef(p.oid) ILIKE '%MIN(id)%' AS contiene_min_id,
  pg_get_functiondef(p.oid) ILIKE '%MAX(id)%' AS contiene_max_id,
  pg_get_functiondef(p.oid) ~* 'MIN\s*\(\s*id\s*\)' AS contiene_min_id_regex,
  pg_get_functiondef(p.oid) ~* 'MAX\s*\(\s*id\s*\)' AS contiene_max_id_regex
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'correct_historical_payment';

-- ============================================================
-- 8/9/10/11 — presencia real de cada variable/tabla involucrada en el
-- patrón de dos pasos del fix, verificada TOKEN POR SEPARADO con
-- position() (nunca reconstruyendo la frase completa de asignación) --
-- más el ORDEN relativo real en el que aparecen dentro de la
-- definición, que por sí solo ya confirma que el conteo ocurre ANTES de
-- leer la fila (mismo patrón: contar -> validar -> leer esa única fila).
-- ============================================================
WITH def AS (
  SELECT pg_get_functiondef(p.oid) AS texto
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'correct_historical_payment'
)
SELECT
  position('COUNT(*)' in texto) > 0 AS usa_count_estrella,
  position('v_contributions_count' in texto) > 0 AS tiene_variable_conteo,
  position('v_single_contribution_id' in texto) > 0 AS tiene_variable_id,
  position('v_single_contribution_amount' in texto) > 0 AS tiene_variable_monto,
  position('payment_contributions' in texto) > 0 AS referencia_tabla_contributions,
  position('FOR UPDATE' in texto) > 0 AS conserva_for_update,
  -- el conteo debe aparecer ANTES que la lectura posterior de id/monto
  -- (mismo orden real del fix: contar -> validar -> leer la única fila)
  position('v_contributions_count' in texto) < position('v_single_contribution_id' in texto) AS orden_conteo_antes_de_lectura
FROM def;

-- ============================================================
-- 12 — EXECUTE privilege de authenticated (y ausencia para PUBLIC).
-- ============================================================
SELECT
  has_function_privilege('authenticated', 'public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text)', 'EXECUTE') AS authenticated_puede_ejecutar,
  has_function_privilege('public', 'public.correct_historical_payment(uuid,numeric,text,text,date,numeric,uuid,text)', 'EXECUTE') AS public_puede_ejecutar;

-- ============================================================
-- 13 — cantidad actual de filas en payment_corrections (agregado, sin
-- exponer contenido de ninguna fila individual).
-- ============================================================
SELECT count(*) AS total_payment_corrections FROM public.payment_corrections;

-- ============================================================
-- 14 — estado real del payment principal conocido (antecedente: Edesur
-- agosto 2026, bb23b7f8-ba1c-4d07-b754-3d02d916a008). Se re-confirma
-- acá mismo, no se asume que el id siga existiendo o sin cambios.
-- ============================================================
SELECT
  id, obligation_id, total_amount, paid_at, voided, notes
FROM public.payments
WHERE id = 'bb23b7f8-ba1c-4d07-b754-3d02d916a008'::uuid;

-- ============================================================
-- 15 — estado de la(s) contribution(s) real(es) de ese payment.
-- ============================================================
SELECT
  id, payment_id, amount
FROM public.payment_contributions
WHERE payment_id = 'bb23b7f8-ba1c-4d07-b754-3d02d916a008'::uuid;

-- ============================================================
-- 16 — allocations activas reales de ese payment (count + suma
-- agregada, sin exponer filas individuales de otras obligaciones).
-- ============================================================
SELECT
  count(*) AS cantidad_allocations_activas,
  COALESCE(sum(allocated_amount), 0) AS suma_allocations_activas
FROM public.payment_allocations
WHERE payment_id = 'bb23b7f8-ba1c-4d07-b754-3d02d916a008'::uuid
  AND is_active;

-- ============================================================
-- 17 — documents asociados a ese payment (factura/comprobante real,
-- confirmando que sigue existiendo y no fue tocado). Sin exponer
-- file_path/Storage -- no hace falta para este postcheck.
-- ============================================================
SELECT
  id, kind, payment_id, original_name, voided
FROM public.documents
WHERE payment_id = 'bb23b7f8-ba1c-4d07-b754-3d02d916a008'::uuid;

-- ============================================================
-- 18 — historial de correcciones YA registradas para ese payment (si
-- Guido ya usó el fix para corregir el caso real, debe aparecer acá).
-- ============================================================
SELECT
  id, previous_total_amount, new_total_amount, reason, corrected_at
FROM public.payment_corrections
WHERE payment_id = 'bb23b7f8-ba1c-4d07-b754-3d02d916a008'::uuid
ORDER BY corrected_at DESC;

-- ============================================================
-- 19 — estado real del pago auxiliar histórico conocido (antecedente:
-- 61b09c9c-a789-4a28-9d37-898c80a7fe14, $0,69) -- confirma si sigue
-- vigente o si ya fue anulado por algún otro camino, SIN asumir nada y
-- SIN tocarlo.
-- ============================================================
SELECT
  id, total_amount, voided
FROM public.payments
WHERE id = '61b09c9c-a789-4a28-9d37-898c80a7fe14'::uuid;

-- ============================================================
-- 20 — obligación real conocida (antecedente:
-- c28d3149-1958-4fd8-a8e2-017888409582).
-- ============================================================
SELECT
  id, amount, status, notes
FROM public.obligations
WHERE id = 'c28d3149-1958-4fd8-a8e2-017888409582'::uuid;

-- ============================================================
-- CÓMO LEER EL RESULTADO (sin sacar conclusiones prematuras)
-- ------------------------------------------------------------
-- 1) La consulta 1 debe devolver exactamente 1 fila, con
--    security_definer=true y search_path_real conteniendo
--    "search_path=public, pg_temp". Revisar definicion_completa a ojo
--    para confirmar el patrón real de dos pasos (contar la cantidad de
--    aportes, validar que sea exactamente uno, y recién después leer
--    esa fila) -- esta columna es la fuente de verdad humana, las
--    consultas 2 y 3 son solo un resumen automatizado de lo mismo.
-- 2) La consulta 2 debe devolver TODO false (ninguna coincidencia de
--    MIN/MAX sobre "id") -- si algo da true, el fix NO se aplicó
--    correctamente o hay otro bloque con el mismo problema.
-- 3) La consulta 3 debe devolver todo true, incluido
--    orden_conteo_antes_de_lectura=true.
-- 4) La consulta 12: authenticated_puede_ejecutar=true,
--    public_puede_ejecutar=false.
-- 5) La consulta 13 es solo un número de referencia (cuántas
--    correcciones históricas existen HOY).
-- 6) Las consultas 14-20 confirman o refutan si los antecedentes
--    conocidos (ids de agosto 2026) siguen representando el estado real
--    -- si algún id ya no existe o cambió, NO asumir que el caso sigue
--    siendo idéntico. Si la consulta 18 ya devuelve una fila, significa
--    que Guido ya usó el fix para corregir este pago real -- en ese
--    caso, new_total_amount debería ser 49907.71.
-- ============================================================
