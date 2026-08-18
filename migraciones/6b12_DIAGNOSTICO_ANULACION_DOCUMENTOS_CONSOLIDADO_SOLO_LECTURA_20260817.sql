-- ============================================================
-- DIAGNÓSTICO SOLO LECTURA -- versión CONSOLIDADA en UNA SOLA sentencia
-- SELECT (mejora #6, FASE 1, 20260817c). Devuelve un único objeto
-- JSONB con toda la información que ya pedía
-- migraciones/6b12_DIAGNOSTICO_ANULACION_DOCUMENTOS_SOLO_LECTURA_20260817.sql
-- (14 SELECT por separado) -- este archivo NO lo reemplaza ni lo borra,
-- es una forma alternativa de ejecutar la MISMA auditoría de un solo
-- golpe, para copiar el resultado completo en un único paso.
-- ------------------------------------------------------------
-- NINGUNA sentencia de este archivo modifica datos ni esquema. Es UNA
-- sola sentencia SELECT (con subconsultas escalares como argumentos de
-- jsonb_build_object) contra information_schema/pg_catalog/pg_policies/
-- storage.buckets -- no ejecuta ni crea nada, solo describe lo que YA
-- existe. Ejecutar en el SQL Editor de Supabase y compartir el resultado
-- completo (un único valor JSON).
-- ============================================================

SELECT jsonb_build_object(

  -- 1) Columnas REALES y completas de public.documents.
  'documents_columns', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.ordinal_position)
    FROM (
      SELECT ordinal_position, column_name, data_type, udt_name,
             character_maximum_length, numeric_precision, numeric_scale,
             is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='documents'
    ) c
  ),

  -- 2) Columnas candidatas de anulación/soft-delete en documents (por
  --    nombre, para no proponer una columna que ya existe).
  'documents_void_columns', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.column_name)
    FROM (
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='documents'
        AND (
          column_name ILIKE '%active%' OR column_name ILIKE '%status%' OR
          column_name ILIKE '%void%' OR column_name ILIKE '%delet%' OR
          column_name ILIKE '%cancel%' OR column_name ILIKE '%annul%' OR
          column_name ILIKE '%anul%'
        )
    ) c
  ),

  -- 3) Constraints (PK/FK/CHECK/UNIQUE) vía pg_constraint, con
  --    conrelid = 'public.documents'::regclass (nunca dependiente de
  --    search_path) y ON DELETE/ON UPDATE reales vía pg_get_constraintdef().
  'documents_constraints', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.constraint_type)
    FROM (
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
    ) c
  ),

  -- 4) Índices existentes sobre documents.
  'documents_indexes', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.indexname)
    FROM (
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname='public' AND tablename='documents'
    ) c
  ),

  -- 5) Triggers sobre documents.
  'documents_triggers', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.trigger_name)
    FROM (
      SELECT trigger_name, action_timing, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema='public' AND event_object_table='documents'
    ) c
  ),

  -- 6) RLS: habilitado/forzado en documents.
  'documents_rls', (
    SELECT to_jsonb(c)
    FROM (
      SELECT relname AS table_name, relrowsecurity AS rls_enabled,
             relforcerowsecurity AS rls_forced
      FROM pg_class
      WHERE relname='documents' AND relnamespace='public'::regnamespace
    ) c
  ),

  -- 7) Policies SELECT/INSERT/UPDATE/DELETE vigentes sobre documents.
  'documents_policies', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.cmd)
    FROM (
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname='public' AND tablename='documents'
    ) c
  ),

  -- 8) Privilegios efectivos de authenticated sobre documents.
  'documents_authenticated_privileges', (
    SELECT to_jsonb(c)
    FROM (
      SELECT
        has_table_privilege('authenticated','public.documents','SELECT') AS authenticated_can_select,
        has_table_privilege('authenticated','public.documents','INSERT') AS authenticated_can_insert,
        has_table_privilege('authenticated','public.documents','UPDATE') AS authenticated_can_update,
        has_table_privilege('authenticated','public.documents','DELETE') AS authenticated_can_delete
    ) c
  ),

  -- 9) Funciones que las policies de public.documents Y de
  --    storage.objects PODRÍAN estar invocando -- búsqueda por
  --    coincidencia de texto literal (nombre de función como substring,
  --    con límites de palabra \m...\M) dentro del texto combinado de
  --    qual/with_check de esas policies, en los esquemas public Y
  --    private. Ver 'policy_functions_limitation' más abajo.
  'policy_functions', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.schema_name, c.proname)
    FROM (
      SELECT p.proname, n.nspname AS schema_name, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (
        SELECT string_agg(COALESCE(qual,'') || ' ' || COALESCE(with_check,''), ' ') AS combined
        FROM pg_policies
        WHERE (schemaname='public' AND tablename='documents')
           OR (schemaname='storage' AND tablename='objects')
      ) policy_text
      WHERE n.nspname IN ('public','private')
        AND policy_text.combined ~* ('\m' || p.proname || '\M')
    ) c
  ),

  -- 10) LIMITACIÓN EXPLÍCITA, a propósito, sin inventar un parser SQL:
  --     'policy_functions' es una coincidencia de TEXTO (substring), no
  --     una resolución semántica/parser real del árbol de expresión de
  --     la policy. Puede haber falsos positivos (un nombre de función
  --     aparece como substring de otra palabra) o falsos negativos (el
  --     nombre está compuesto de forma no literal). Postgres no expone
  --     un catálogo de "esta policy invoca esta función" ya resuelto.
  'policy_functions_limitation', 'Busqueda por coincidencia de texto literal (substring con limites de palabra \m...\M) dentro de qual/with_check de las policies de public.documents y storage.objects, en los esquemas public y private. NO es una resolucion semantica ni un parser real del arbol de expresion de la policy. Puede haber falsos positivos o falsos negativos. No se ejecuta ninguna funcion: pg_get_functiondef() solo devuelve el texto ya existente del CREATE FUNCTION, de forma read-only.',

  -- 9b) Complementaria y MÁS DÉBIL que 'policy_functions' -- candidatos
  --     por convención de nombre (has_access_to_*, *document*access*),
  --     en public Y private, SIN confirmar que el texto real de ninguna
  --     policy las mencione.
  'policy_functions_candidates_by_name', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.schema_name, c.proname)
    FROM (
      SELECT p.proname, n.nspname AS schema_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private')
        AND (
          p.proname ILIKE '%access%document%' OR
          p.proname ILIKE '%document%access%' OR
          p.proname ILIKE 'has_access_to_%'
        )
    ) c
  ),

  -- 11) Cardinalidad real documents -> obligations/payments (agregado,
  --     sin traer ninguna fila real): confirma si un documento
  --     referencia UNA obligación O UN pago, nunca ambos.
  'document_relationship_counts', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.kind)
    FROM (
      SELECT
        (obligation_id IS NOT NULL) AS tiene_obligation_id,
        (payment_id IS NOT NULL) AS tiene_payment_id,
        kind,
        COUNT(*) AS cantidad
      FROM public.documents
      GROUP BY (obligation_id IS NOT NULL), (payment_id IS NOT NULL), kind
    ) c
  ),

  -- 12) Columnas de anulación candidatas en payments (para comparar con
  --     la convención "voided" ya confirmada en uso por el cliente).
  'payments_void_columns', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.column_name)
    FROM (
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='payments'
        AND (
          column_name ILIKE '%void%' OR column_name ILIKE '%delet%' OR
          column_name ILIKE '%cancel%' OR column_name ILIKE '%annul%' OR
          column_name ILIKE '%anul%' OR column_name = 'voided'
        )
    ) c
  ),

  -- 13) TODAS las policies de storage.objects (sin filtrar de entrada
  --     por bucket -- una policy genérica sin "documents" literal puede
  --     igual aplicarle). Incluye las 2 columnas derivadas de solo
  --     lectura (mismo criterio y misma limitación de coincidencia de
  --     texto que 'policy_functions'):
  --       menciona_documents_directamente -- el texto de qual/with_check
  --       contiene literalmente 'documents'.
  --       posible_policy_generica -- NO menciona 'documents' Y tampoco
  --       ningún otro bucket_id='...' específico -- candidata a condición
  --       genérica, necesita revisión manual.
  'storage_policies', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.cmd)
    FROM (
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
    ) c
  ),

  -- 14) Metadata real del bucket "documents" (público/privado, límite
  --     de tamaño, mime types permitidos) -- nunca contenido de archivos.
  'storage_bucket', (
    SELECT jsonb_agg(to_jsonb(c))
    FROM (
      SELECT id, name, public, file_size_limit, allowed_mime_types, created_at
      FROM storage.buckets
      WHERE id='documents' OR name='documents'
    ) c
  )

) AS diagnostico_anulacion_documentos;
