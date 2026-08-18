-- ============================================================
-- DIAGNÓSTICO SOLO LECTURA -- esquema real de public.documents (y tablas
-- relacionadas) para diseñar la anulación no destructiva de factura/
-- comprobante (mejora #6, FASE 1: auditoría + diseño, 20260817).
-- ------------------------------------------------------------
-- NINGUNA sentencia de este archivo modifica datos ni esquema. Todo es
-- SELECT contra information_schema/pg_catalog -- ninguna ejecuta ni crea
-- nada, solo describen lo que YA existe.
--
-- Motivo: el código cliente (index.html/index_operator.html) solo
-- demuestra qué columnas de documents SE USAN hoy al insertar
-- (group_id, obligation_id, payment_id, kind, file_path, original_name,
-- mime_type, size_bytes, uploaded_by, vía uploadDoc()) -- eso NUNCA
-- prueba que no exista ya alguna columna de anulación sin usar
-- (voided/status/deleted_at/cancelled_at/etc., mismo caso que
-- payments.notes en la mejora anterior). Tampoco se puede proponer una
-- migración segura sin conocer constraints/RLS/Storage reales. Ejecutar
-- en el SQL Editor de Supabase y compartir el resultado completo.
-- ============================================================

-- 1) Columnas REALES y completas de public.documents (todas, no solo las
--    que ya usa el cliente), con tipo/precisión/nulabilidad/default.
SELECT ordinal_position, column_name, data_type, udt_name,
       character_maximum_length, numeric_precision, numeric_scale,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='documents'
ORDER BY ordinal_position;

-- 2) Chequeo puntual: ¿ya existe alguna columna equivalente a anulación/
--    soft-delete en documents? (is_active/status/voided/voided_at/
--    voided_by/void_reason/deleted_at/cancelled_at/annulled_at o
--    similares). Por nombre, para no proponer una columna que ya existe.
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='documents'
  AND (
    column_name ILIKE '%active%' OR column_name ILIKE '%status%' OR
    column_name ILIKE '%void%' OR column_name ILIKE '%delet%' OR
    column_name ILIKE '%cancel%' OR column_name ILIKE '%annul%' OR
    column_name ILIKE '%anul%'
  );

-- 3) Constraints (PK/FK/CHECK/UNIQUE) vía pg_constraint -- identificación
--    inequívoca por conrelid = 'public.documents'::regclass (en vez de
--    comparar conrelid::regclass::text = 'documents', que depende
--    innecesariamente del search_path vigente en el momento de la
--    consulta), con la definición completa ya resuelta por
--    pg_get_constraintdef() y la tabla referenciada explícita para las
--    FK (incluye ON DELETE/ON UPDATE real, no supuesto).
SELECT
  conrelid::regclass::text AS table_name,
  conname AS constraint_name,
  CASE contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    ELSE contype::text
  END AS constraint_type,
  pg_get_constraintdef(oid) AS definition,
  CASE WHEN confrelid<>0 THEN confrelid::regclass::text ELSE NULL END AS references_table
FROM pg_constraint
WHERE conrelid = 'public.documents'::regclass
ORDER BY constraint_type;

-- 4) Índices existentes sobre documents (para no proponer uno redundante
--    si la migración llegara a necesitarlo).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='documents'
ORDER BY indexname;

-- 5) Triggers sobre documents (por si ya existe algo que reaccione a
--    INSERT/UPDATE/DELETE, ej. sincronizar un contador o un estado).
SELECT trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema='public' AND event_object_table='documents'
ORDER BY trigger_name;

-- 6) RLS: ¿está habilitado en documents? (independiente de que existan
--    policies -- una tabla con RLS deshabilitado deja pasar todo a quien
--    tenga el privilegio de tabla).
SELECT relname AS table_name, relrowsecurity AS rls_enabled,
       relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname='documents' AND relnamespace='public'::regnamespace;

-- 7) Policies SELECT/INSERT/UPDATE/DELETE vigentes sobre documents.
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='documents'
ORDER BY cmd;

-- 8) Privilegios efectivos de authenticated sobre documents (SELECT/
--    INSERT/UPDATE/DELETE) -- pregunta directa, solo lectura.
SELECT
  has_table_privilege('authenticated','public.documents','SELECT') AS authenticated_can_select,
  has_table_privilege('authenticated','public.documents','INSERT') AS authenticated_can_insert,
  has_table_privilege('authenticated','public.documents','UPDATE') AS authenticated_can_update,
  has_table_privilege('authenticated','public.documents','DELETE') AS authenticated_can_delete;

-- 9) Funciones que las policies de public.documents Y de storage.objects
--    PODRÍAN estar invocando -- búsqueda por coincidencia de texto
--    literal (nombre de función como substring, con límites de palabra
--    vía \m...\M) dentro del texto combinado de qual/with_check de esas
--    policies, en los esquemas public Y private (el proyecto usa
--    funciones de seguridad en private.*, no solo public.* -- la
--    consulta original solo miraba public y se quedaba corta).
--    LIMITACIÓN EXPLÍCITA, a propósito, sin inventar un parser SQL:
--    Postgres no expone un catálogo de "esta policy invoca esta función"
--    ya resuelto -- pg_policies.qual/with_check son el texto reconstruido
--    de la expresión, no un árbol navegable por SQL estándar. Esto es
--    una coincidencia de texto (puede haber falsos positivos si un
--    nombre de función aparece como substring de otra palabra, o falsos
--    negativos si el nombre está compuesto de forma no literal) -- NO es
--    una prueba definitiva de invocación real, es la aproximación más
--    fiable posible sin parsear la expresión a mano.
WITH policy_text AS (
  SELECT string_agg(COALESCE(qual,'') || ' ' || COALESCE(with_check,''), ' ') AS combined
  FROM pg_policies
  WHERE (schemaname='public' AND tablename='documents')
     OR (schemaname='storage' AND tablename='objects')
)
SELECT p.proname, n.nspname AS schema_name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN policy_text
WHERE n.nspname IN ('public','private')
  AND policy_text.combined ~* ('\m' || p.proname || '\M')
ORDER BY n.nspname, p.proname;

-- 9b) Complementaria, MÁS DÉBIL que el punto 9 -- candidatos por
--     convención de nombre (has_access_to_*, *document*access*), en
--     public Y private, SIN confirmar que el texto real de ninguna
--     policy las mencione. Se conserva solo como pista adicional; el
--     punto 9 es la evidencia real basada en el texto de las policies.
SELECT p.proname, n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','private')
  AND (
    p.proname ILIKE '%access%document%' OR
    p.proname ILIKE '%document%access%' OR
    p.proname ILIKE 'has_access_to_%'
  );

-- 10) Confirmar la relación real documents -> obligations/payments/
--     services (vía las FK ya resueltas en el punto 3, más una muestra
--     de columnas relevantes de las tablas referenciadas, para
--     confirmar cardinalidad esperada -- un documento referencia UNA
--     obligación O UN pago, nunca ambos a la vez, según el cliente).
--     Esta consulta NO modifica nada: cuenta filas por combinación de
--     obligation_id/payment_id nulos, sin traer datos reales.
SELECT
  (obligation_id IS NOT NULL) AS tiene_obligation_id,
  (payment_id IS NOT NULL) AS tiene_payment_id,
  kind,
  COUNT(*) AS cantidad
FROM public.documents
GROUP BY (obligation_id IS NOT NULL), (payment_id IS NOT NULL), kind
ORDER BY kind;

-- 11) Definición completa de payments.voided (columna real ya confirmada
--     en uso por el cliente) -- para evaluar si su convención (nombre,
--     tipo, default) es reutilizable como referencia de diseño en
--     documents. Se incluyen también columnas de payments cuyo nombre
--     sugiera anulación pero que el cliente no use hoy (mismo criterio
--     defensivo del punto 2, aplicado a payments para no asumir que
--     "voided" es la única columna relacionada).
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='payments'
  AND (
    column_name ILIKE '%void%' OR column_name ILIKE '%delet%' OR
    column_name ILIKE '%cancel%' OR column_name ILIKE '%annul%' OR
    column_name ILIKE '%anul%' OR column_name = 'voided'
  );

-- 12) Storage: TODAS las policies de storage.objects (no se filtra por
--     bucket -- una policy que NO mencione "documents" literalmente
--     puede igual aplicarle, vía una función auxiliar o una condición
--     genérica sin bucket_id fijo, así que filtrar de entrada por texto
--     escondería justo esas). Confirma qué puede hacer authenticated
--     sobre los objetos físicos (upload/select/update/remove), sin
--     ejecutar ninguna operación de Storage, sin leer contenido de
--     archivos, sin generar signed URLs.
--     Dos columnas derivadas de solo lectura (mismo criterio y misma
--     limitación de coincidencia de texto que el punto 9):
--       menciona_documents_directamente -- el texto de qual/with_check
--       contiene literalmente 'documents' (ej. bucket_id='documents').
--       posible_policy_generica -- NO menciona 'documents' Y tampoco
--       menciona ningún otro bucket_id='...' específico -- candidata a
--       ser una condición genérica que también alcance a este bucket,
--       necesita revisión manual, no se puede descartar solo por no
--       nombrar "documents".
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check,
  (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ILIKE '%documents%' AS menciona_documents_directamente,
  (
    (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) NOT ILIKE '%documents%'
    AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) !~ 'bucket_id\s*=\s*''[a-zA-Z0-9_-]+'''
  ) AS posible_policy_generica
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
ORDER BY cmd;

-- 13) Metadata real del bucket "documents" (público/privado, límite de
--     tamaño, mime types permitidos si está configurado a nivel bucket).
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at
FROM storage.buckets
WHERE id='documents' OR name='documents';
