-- ============================================================
-- DIAGNÓSTICO — BUGFIX #13: "Argentina Virtual no permite Dar de baja"
-- SOLO LECTURA — 20260821
-- ------------------------------------------------------------
-- OBJETIVO ÚNICO: confirmar contra el estado REAL de Supabase por qué
-- "Dar de baja" no surte efecto sobre el servicio real Argentina Virtual
-- (empresa/espacio conocido: GR). NO interpreta, NO corrige, NO propone
-- ninguna solución -- solo trae los hechos reales para que Guido y la
-- siguiente FASE puedan decidir con datos, no con suposiciones.
--
-- PISTA HISTÓRICA (nunca asumida como vigente): un diagnóstico anterior
-- registró obligation_id 535ca587-80ef-4415-b3bd-5b83cb727c67 con
-- servicio "Argentina Virtual", empresa GR, is_private=false. Este
-- archivo usa ese id ÚNICAMENTE como punto de partida para resolver el
-- service_id real actual (CONSULTA A) -- ningún resultado posterior de
-- este archivo asume que el service_id, el grupo o is_private siguen
-- siendo los mismos hasta confirmarlo con la CONSULTA A misma.
--
-- HIPÓTESIS DE FRONTEND YA IDENTIFICADA (ver informe de entrega, no se
-- corrige acá): dropService() hoy hace
--   sb.from('services').update({active:false}).eq('id',serviceId)
-- SIN .select() y SIN revisar cuántas filas afectó. Si RLS bloquea el
-- UPDATE porque la fila no matchea el USING/WITH CHECK de la policy,
-- PostgREST responde éxito con data=null y CERO filas modificadas --
-- nunca error. El frontend lo interpretaría como "Servicio dado de
-- baja" (toast de éxito) aunque en la base nada haya cambiado. Este
-- archivo (CONSULTA D/E/F/G) es lo que permite confirmar o descartar
-- esa hipótesis con hechos reales, no con lectura de código.
--
-- 100% SELECT/CTE + pg_catalog/information_schema/pg_policies/pg_proc/
-- pg_get_constraintdef/pg_get_functiondef/has_table_privilege/
-- has_column_privilege. Cero INSERT/UPDATE/DELETE/UPSERT/CREATE/ALTER/
-- DROP/TRUNCATE/GRANT/REVOKE/DO/EXECUTE/CALL/SQL dinámico. NINGÚN
-- UPDATE de prueba, ni siquiera dentro de una transacción con ROLLBACK
-- -- ninguna consulta de este archivo escribe nada bajo ninguna
-- circunstancia. Las consultas que tocan filas reales (A/B/C/I) están
-- restringidas por WHERE a lo estrictamente necesario para resolver
-- este caso puntual -- I es agregado (COUNT), nunca expone filas de
-- otros servicios/usuarios/pagos.
--
-- NO EJECUTAR AUTOMÁTICAMENTE -- pegar manualmente en el SQL Editor de
-- Supabase y revisar el resultado. No modifica Supabase, no modifica
-- datos reales, no modifica RLS, no modifica Storage.
-- ============================================================

-- ============================================================
-- CONSULTA 0 — COLUMNAS REALES de public.services y public.obligations
-- ------------------------------------------------------------
-- Fuente de verdad de nombres de columna real, para no inventar ningún
-- nombre en el resto del archivo (algunas consultas de abajo usan `*`
-- justamente para no depender de adivinar columnas que podrían no
-- existir, ej. services.created_by).
-- ============================================================
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('services', 'obligations', 'groups')
ORDER BY table_name, ordinal_position;

-- ============================================================
-- CONSULTA A — IDENTIFICAR EL SERVICIO REAL a partir del obligation_id
-- histórico conocido (pista, no asumido vigente).
-- ============================================================
WITH obligacion_pista AS (
  SELECT *
  FROM public.obligations
  WHERE id = '535ca587-80ef-4415-b3bd-5b83cb727c67'::uuid
)
SELECT
  op.id AS obligation_id,
  op.service_id,
  op.period,
  op.status,
  s.*,
  g.name AS group_name,
  g.status AS group_status
FROM obligacion_pista op
LEFT JOIN public.services s ON s.id = op.service_id
LEFT JOIN public.groups g ON g.id = s.group_id;

-- ============================================================
-- CONSULTA B — DUPLICADOS/HOMÓNIMOS: todos los services cuyo nombre
-- normalizado coincide con "Argentina Virtual", sin importar espacio o
-- mayúsculas/minúsculas.
-- ------------------------------------------------------------
-- Objetivo: detectar si existen dos filas "Argentina Virtual" y la UI
-- podría estar actuando sobre una fila distinta de la que Guido ve.
-- ============================================================
SELECT
  s.id,
  s.name,
  s.group_id,
  s.active,
  s.is_private,
  s.category,
  g.name AS group_name
FROM public.services s
LEFT JOIN public.groups g ON g.id = s.group_id
WHERE trim(lower(s.name)) = trim(lower('Argentina Virtual'))
ORDER BY s.id;

-- ============================================================
-- CONSULTA C — GRUPO REAL del/los service(s) encontrados en B.
-- ------------------------------------------------------------
-- NO modifica memberships -- solo lectura de la fila real del grupo.
-- ============================================================
SELECT g.*
FROM public.groups g
WHERE g.id IN (
  SELECT s.group_id
  FROM public.services s
  WHERE trim(lower(s.name)) = trim(lower('Argentina Virtual'))
);

-- ============================================================
-- CONSULTA D — POLICIES REALES de public.services (SELECT/UPDATE)
-- ------------------------------------------------------------
-- Expresiones completas, sin truncar -- confirma si UPDATE filtra por
-- active/is_private, si hay alguna condición que pueda impedir escribir
-- false, y si SELECT ocultaría el servicio después de la baja.
-- ============================================================
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expr,
  with_check AS with_check_expr,
  (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%active%' AS menciona_active,
  (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%is_private%' AS menciona_is_private,
  (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%group%' AS menciona_group
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'services'
ORDER BY cmd, policyname;

-- ============================================================
-- CONSULTA E — HELPER DE PERMISOS private.can_manage_service(uuid) y
-- cualquier otro helper referenciado por las policies reales de D
-- (descubierto por texto, sin asumir nombres -- mismo patrón de dos
-- pasadas ya usado en 6b14/6b_AUDITORIA_PRIVACIDAD_SERVICIOS).
-- NO redefine nada, NO cambia permisos.
-- ============================================================
WITH helper_pedido AS (
  SELECT
    n.nspname AS schema,
    p.proname AS funcion,
    pg_get_function_arguments(p.oid) AS argumentos,
    pg_get_function_result(p.oid) AS retorno,
    p.prosecdef AS security_definer,
    pg_get_functiondef(p.oid) AS definicion
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'can_manage_service'
),
texto_policies_services AS (
  SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS texto
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'services'
),
funciones_referenciadas_nombres AS (
  SELECT DISTINCT (regexp_matches(texto, '\m((?:private|public)\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\(', 'g'))[1] AS nombre_calificado
  FROM texto_policies_services
),
helpers_referenciados AS (
  SELECT
    f.nombre_calificado AS referenciado_como,
    n.nspname AS schema,
    p.proname AS funcion,
    pg_get_function_arguments(p.oid) AS argumentos,
    pg_get_function_result(p.oid) AS retorno,
    p.prosecdef AS security_definer,
    pg_get_functiondef(p.oid) AS definicion
  FROM funciones_referenciadas_nombres f
  JOIN pg_proc p ON p.proname = split_part(f.nombre_calificado, '.', 2)
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = split_part(f.nombre_calificado, '.', 1)
)
SELECT jsonb_build_object(
  'helper_pedido_can_manage_service', (SELECT jsonb_agg(row_to_json(helper_pedido)) FROM helper_pedido),
  'helpers_referenciados_en_policies_de_services', (SELECT jsonb_agg(row_to_json(helpers_referenciados)) FROM helpers_referenciados)
) AS diagnostico_helpers;

-- ============================================================
-- CONSULTA F — TRIGGERS REALES sobre public.services
-- ------------------------------------------------------------
-- Objetivo: detectar si algún trigger fuerza active=true, impide el
-- cambio, toca group_id/is_private, o ejecuta lógica especial.
-- ============================================================
SELECT
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_flag,
  CASE WHEN t.tgtype & 2 > 0 THEN 'BEFORE' WHEN t.tgtype & 64 > 0 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
  CASE WHEN t.tgtype & 4 > 0 THEN 'INSERT' WHEN t.tgtype & 8 > 0 THEN 'DELETE' WHEN t.tgtype & 16 > 0 THEN 'UPDATE' WHEN t.tgtype & 32 > 0 THEN 'TRUNCATE' ELSE 'DESCONOCIDO' END AS event_principal,
  pg_get_triggerdef(t.oid) AS action_statement_completo,
  p.proname AS funcion_asociada,
  pg_get_functiondef(p.oid) AS definicion_funcion_asociada
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND c.relname = 'services'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- ============================================================
-- CONSULTA G — COLUMNA active: tipo/nullable/default + CHECK
-- constraints relevantes de public.services.
-- ============================================================
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'active';

SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'services' AND con.contype = 'c';

-- ============================================================
-- CONSULTA H — PRIVILEGIO UPDATE de authenticated sobre public.services
-- ------------------------------------------------------------
-- NO sustituye la revisión de RLS (D/E) -- solo confirma si el
-- privilegio de tabla en sí está otorgado.
-- ============================================================
SELECT
  'authenticated' AS rol,
  has_table_privilege('authenticated', 'public.services', 'SELECT') AS select_priv,
  has_table_privilege('authenticated', 'public.services', 'UPDATE') AS update_priv,
  has_column_privilege('authenticated', 'public.services', 'active', 'UPDATE') AS update_priv_columna_active;

-- ============================================================
-- CONSULTA I — CONTEXTO DEL SERVICIO (solo conteos/estados, sin exponer
-- filas de otros servicios): dimensiona el historial real para confirmar
-- que la baja debe seguir siendo no destructiva.
-- ============================================================
WITH servicio_objetivo AS (
  SELECT s.id
  FROM public.services s
  WHERE trim(lower(s.name)) = trim(lower('Argentina Virtual'))
)
SELECT
  (SELECT count(*) FROM public.obligations o WHERE o.service_id IN (SELECT id FROM servicio_objetivo)) AS total_obligations,
  (SELECT count(*) FROM public.obligations o WHERE o.service_id IN (SELECT id FROM servicio_objetivo) AND o.status <> 'cancelled') AS obligations_vigentes,
  (SELECT count(*) FROM public.payments p JOIN public.obligations o ON o.id = p.obligation_id WHERE o.service_id IN (SELECT id FROM servicio_objetivo)) AS total_payments,
  (SELECT count(*) FROM public.documents d JOIN public.obligations o ON o.id = d.obligation_id WHERE o.service_id IN (SELECT id FROM servicio_objetivo)) AS total_documents;

-- ============================================================
-- CÓMO LEER EL RESULTADO (sin sacar conclusiones prematuras)
-- ------------------------------------------------------------
-- 1) CONSULTA A: confirma si el obligation_id histórico todavía existe y
--    a qué service_id/grupo apunta HOY. Si no devuelve filas, el
--    obligation_id ya no es válido como pista -- usar directamente B.
-- 2) CONSULTA B: si devuelve MÁS DE UNA fila, hay servicios homónimos --
--    revisar cuál es el que Guido ve/usa realmente (por group_id/activo)
--    antes de asumir cualquier otra causa.
-- 3) CONSULTA C: confirma si el grupo real es GR (por nombre) y su
--    estado (activo/eliminado).
-- 4) CONSULTA D (cmd='UPDATE', using_expr/with_check_expr): si el USING
--    exige una condición que la fila de Argentina Virtual no cumple
--    (ej. depende de is_private, de group_id, o de alguna membership
--    específica), el UPDATE de dropService() matchea CERO filas sin
--    generar ningún error -- esto reproduciría EXACTAMENTE el síntoma
--    reportado ("no permite Dar de baja" sin mensaje de error visible).
-- 5) CONSULTA E: si can_manage_service(uuid) (u otro helper referenciado)
--    contiene una condición que la fila real no satisface, es la misma
--    causa que el punto 4 pero a nivel función en vez de expresión
--    inline.
-- 6) CONSULTA F: confirma que ningún trigger fuerza active=true de
--    vuelta ni bloquea el UPDATE con una excepción silenciada.
-- 7) CONSULTA G: confirma que `active` no tiene un CHECK que la
--    restrinja a un único valor.
-- 8) CONSULTA H: si update_priv o update_priv_columna_active dieran
--    false, sería un problema de GRANT, no de RLS -- distinto arreglo.
-- 9) CONSULTA I: dimensiona cuánto historial real tiene Argentina
--    Virtual, para confirmar que cualquier corrección futura debe
--    preservarlo intacto (no destructiva), igual que el resto de
--    servicios.
-- ============================================================
