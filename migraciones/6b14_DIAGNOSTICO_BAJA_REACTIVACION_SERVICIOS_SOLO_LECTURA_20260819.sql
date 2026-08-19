-- ============================================================
-- DIAGNÓSTICO PREFLIGHT — MEJORA #10: BAJA NO DESTRUCTIVA Y
-- REACTIVACIÓN DE SERVICIOS (services.active) — SOLO LECTURA — 20260819
-- ------------------------------------------------------------
-- OBJETIVO ÚNICO: confirmar contra el estado REAL de Supabase si la
-- implementación de FASE 1 (dropService()/reactivateService() haciendo
-- UPDATE public.services SET active=false/true, y reloadGroup() ya sin
-- filtrar .eq('active',true) al cargar servicios) puede publicarse SIN
-- ninguna migración, cambio de RLS, cambio de policy ni cambio de schema.
-- NO interpreta una solución, NO propone ni prepara ninguna corrección --
-- solo trae los hechos reales.
--
-- 100% SELECT/CTE (incluye VALUES de solo lectura para listas fijas de
-- objetos esperados -- VALUES nunca escribe nada, es una fuente de filas
-- literal) + pg_catalog/information_schema/pg_policies/pg_proc/
-- pg_get_constraintdef/pg_get_functiondef/has_table_privilege. Cero
-- INSERT/UPDATE/DELETE/UPSERT/CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE/DO/
-- EXECUTE/CALL/SQL dinámico. La única consulta que toca datos reales
-- (CONSULTA 9) es un COUNT(*) agregado -- nunca selecciona ni expone
-- filas ni nombres de servicios reales. NO EJECUTAR AUTOMÁTICAMENTE --
-- pegar manualmente en el SQL Editor de Supabase y revisar el resultado
-- antes de decidir cualquier publicación. No modifica Supabase, no
-- modifica Storage, no modifica policies, no ejecuta migraciones.
-- ============================================================

-- ============================================================
-- CONSULTA 1 — COLUMNAS REALES DE public.services
-- ============================================================
SELECT
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'services'
ORDER BY ordinal_position;

-- ============================================================
-- CONSULTA 2 — CONSTRAINTS REALES DE public.services (PK/FK/UNIQUE/CHECK)
-- ------------------------------------------------------------
-- Confirma en particular si `active` tiene NOT NULL (ya cubierto por
-- CONSULTA 1 vía is_nullable), algún CHECK propio, o si depende de otra
-- columna vía un CHECK compuesto.
-- ============================================================
SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    ELSE con.contype::text
  END AS constraint_type_label,
  pg_get_constraintdef(con.oid) AS definicion,
  (
    SELECT array_agg(att.attname ORDER BY att.attnum)
    FROM unnest(con.conkey) AS k(attnum)
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
  ) AS columnas_origen,
  fn.nspname AS schema_referenciado,
  fc.relname AS tabla_referenciada,
  (
    SELECT array_agg(att.attname ORDER BY att.attnum)
    FROM unnest(con.confkey) AS k(attnum)
    JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum
  ) AS columnas_referenciadas
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_class fc ON fc.oid = con.confrelid
LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'services'
ORDER BY con.contype, con.conname;

-- ============================================================
-- CONSULTA 3 — ÍNDICES REALES DE public.services
-- ============================================================
SELECT
  i.relname AS index_name,
  pg_get_indexdef(i.oid) AS definicion,
  ix.indisunique AS es_unico,
  ix.indisprimary AS es_primary_key
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'services'
ORDER BY i.relname;

-- ============================================================
-- CONSULTA 4 — RLS HABILITADA/FORZADA en public.services
-- ============================================================
SELECT
  n.nspname AS schema,
  c.relname AS tabla,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS rls_forzado_para_owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'services';

-- ============================================================
-- CONSULTA 5 — TODAS LAS POLICIES REALES DE public.services
-- ------------------------------------------------------------
-- Expresiones completas, sin truncar -- necesarias para responder sin
-- inferencias: A) ¿SELECT permite active=false? B) ¿UPDATE USING permite
-- actuar sobre una fila active=false (para poder reactivarla)? C) ¿UPDATE
-- WITH CHECK permite escribir active=false? D) ¿UPDATE WITH CHECK permite
-- escribir active=true? E) ¿protege is_private? F) ¿valida group/
-- membership?
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
-- CONSULTA 6 — PRIVILEGIOS DE TABLA para authenticated sobre public.services
-- ------------------------------------------------------------
-- Esto NO reemplaza RLS -- un privilegio GRANT positivo no implica que una
-- fila concreta sea visible/editable si RLS lo deniega. Solo complementa
-- el diagnóstico de CONSULTA 4/5.
-- ============================================================
SELECT
  'authenticated' AS rol,
  has_table_privilege('authenticated', 'public.services', 'SELECT') AS select_priv,
  has_table_privilege('authenticated', 'public.services', 'INSERT') AS insert_priv,
  has_table_privilege('authenticated', 'public.services', 'UPDATE') AS update_priv,
  has_table_privilege('authenticated', 'public.services', 'DELETE') AS delete_priv;

-- ============================================================
-- CONSULTA 7 — HELPERS SERVER-SIDE RELACIONADOS (definición REAL, solo
-- lectura vía pg_get_functiondef -- nunca se ejecutan)
-- ------------------------------------------------------------
-- Cubre los helpers mencionados explícitamente en el pedido MÁS cualquier
-- otro helper que las policies reales de CONSULTA 5 invoquen (descubierto
-- por texto, sin asumir nombres) -- mismo patrón de dos pasadas ya usado
-- en el preflight de privacidad de servicios (6b_AUDITORIA_PRIVACIDAD_
-- SERVICIOS_20260811_PREFLIGHT_solo_lectura.sql). Necesario para
-- confirmar si alguno contiene una condición del tipo `services.active =
-- true` que pudiera bloquear lectura de inactivos, baja o reactivación.
-- ============================================================
WITH helpers_conocidos AS (
  SELECT
    n.nspname AS schema,
    p.proname AS funcion,
    pg_get_function_arguments(p.oid) AS argumentos,
    pg_get_function_result(p.oid) AS retorno,
    p.prosecdef AS security_definer,
    pg_get_functiondef(p.oid) AS definicion
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname IN (
    'can_operate_service', 'service_group_id', 'is_group_owner', 'can_operate_group',
    'can_view_service', 'can_manage_service'
  )
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
),
funciones_no_resueltas AS (
  SELECT f.nombre_calificado
  FROM funciones_referenciadas_nombres f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = split_part(f.nombre_calificado, '.', 2)
      AND n.nspname = split_part(f.nombre_calificado, '.', 1)
  )
)
SELECT jsonb_build_object(
  'helpers_conocidos', (SELECT jsonb_agg(row_to_json(helpers_conocidos)) FROM helpers_conocidos),
  'helpers_referenciados_en_policies_de_services', (SELECT jsonb_agg(row_to_json(helpers_referenciados)) FROM helpers_referenciados),
  'nombres_referenciados_no_resueltos_en_pg_proc', (SELECT jsonb_agg(nombre_calificado) FROM funciones_no_resueltas)
) AS preflight_helpers_services;

-- ============================================================
-- CONSULTA 8 — TRIGGERS REALES sobre public.services
-- ------------------------------------------------------------
-- Si el trigger llama una función, se incluye también su definición
-- completa (pg_get_functiondef, solo lectura) para poder detectar si
-- fuerza active=true, impide active=false, borra datos, o modifica
-- is_private/grupo/owner.
-- ============================================================
SELECT
  t.tgname AS trigger_name,
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
-- CONSULTA 9 — ESTADO REAL DE active, SOLO AGREGADO (sin nombres/filas)
-- ------------------------------------------------------------
-- Un solo COUNT(*) agregado por estado -- nunca selecciona una fila real
-- ni expone ningún nombre de servicio. Si ya existen active=false reales,
-- confirma que el estado ya fue usado históricamente (por ejemplo por
-- alguna corrección manual anterior), lo cual es información relevante
-- para decidir la publicación con más confianza.
-- ============================================================
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE active = true) AS activos,
  count(*) FILTER (WHERE active = false) AS inactivos,
  count(*) FILTER (WHERE active IS NULL) AS con_active_null
FROM public.services;

-- ============================================================
-- CONSULTA 10 — FOREIGN KEYS de otras tablas public.* que referencian
-- public.services
-- ------------------------------------------------------------
-- No es porque #10 vaya a borrar nada -- documenta qué riesgo real se
-- retiró al eliminar deleteService() (que hacía DELETE FROM services, y
-- cuyo comportamiento de cascada dependía exactamente de estos ON DELETE).
-- ============================================================
SELECT
  ns.nspname AS schema_origen,
  cl.relname AS tabla_origen,
  con.conname AS constraint_name,
  (
    SELECT array_agg(att.attname ORDER BY att.attnum)
    FROM unnest(con.conkey) AS k(attnum)
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
  ) AS columna_origen,
  CASE con.confupdtype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE con.confupdtype::text
  END AS on_update,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE con.confdeltype::text
  END AS on_delete,
  pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class cl ON cl.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = cl.relnamespace
JOIN pg_class fc ON fc.oid = con.confrelid
JOIN pg_namespace fn ON fn.oid = fc.relnamespace
WHERE con.contype = 'f'
  AND fn.nspname = 'public' AND fc.relname = 'services'
  AND ns.nspname = 'public'
ORDER BY cl.relname, con.conname;

-- ============================================================
-- CÓMO LEER EL RESULTADO (sin sacar conclusiones prematuras)
-- ------------------------------------------------------------
-- Antes de publicar #10, confirmar explícitamente con el resultado real:
--
-- 1) CONSULTA 1/2: `active` es boolean, NOT NULL, sin CHECK que la
--    restrinja a un único valor -- si tuviera un CHECK tipo
--    `active = true`, ninguna fila podría quedar en false y #10 no
--    podría publicarse tal cual.
-- 2) CONSULTA 5 (cmd='SELECT'): el `using_expr` de la policy de lectura
--    NO debe filtrar por `active = true` -- si lo hiciera, un servicio
--    dado de baja jamás volvería a cargar en reloadGroup() (rompería el
--    requisito "no ocultar el pasado").
-- 3) CONSULTA 5 (cmd='UPDATE', using_expr): debe permitir actuar sobre
--    una fila con `active=false` -- si el USING exige `active=true` para
--    poder tocar la fila, reactivateService() nunca podría ejecutar el
--    UPDATE (quedaría bloqueado por RLS, con o sin cambios de frontend).
-- 4) CONSULTA 5 (cmd='UPDATE', with_check_expr): debe permitir escribir
--    tanto `active:false` como `active:true` -- si el WITH CHECK fuerza
--    `active=true` de alguna forma, dropService() fallaría en runtime.
-- 5) CONSULTA 5 (menciona_is_private): confirmar que la policy sigue
--    protegiendo is_private igual que antes -- #10 no debe abrir una
--    grieta de privacidad al dejar de filtrar por active.
-- 6) CONSULTA 7: si algún helper referenciado contiene una condición
--    `active = true` (o equivalente) en su definición real, revisar si
--    bloquea alguno de los 3 casos de arriba antes de asumir que #10 es
--    publicable.
-- 7) CONSULTA 8: confirmar que ningún trigger fuerza `active=true` en
--    INSERT/UPDATE (lo cual bloquearía dropService()) ni ejecuta lógica
--    adicional inesperada (borrado, cambio de is_private/group/owner) al
--    tocar `active`.
-- 8) CONSULTA 9: si `inactivos > 0` ya hoy, es una señal fuerte de que el
--    campo ya se usó en producción sin romper nada -- refuerza la
--    confianza en que el modelo soporta el flujo de #10.
-- 9) CONSULTA 10: documentar los ON DELETE reales de obligations (y
--    cualquier otra tabla) hacia services -- información de contexto
--    sobre el riesgo que ya no aplica porque deleteService() fue
--    eliminada, no una acción a tomar.
-- ============================================================
