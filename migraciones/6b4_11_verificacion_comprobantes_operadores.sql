-- ============================================================
-- 6B4.11 — Verificación de comprobantes/operadores (SOLO LECTURA)
-- ------------------------------------------------------------
-- Este archivo NO modifica nada. No contiene ALTER, DROP, CREATE, INSERT,
-- UPDATE ni DELETE — únicamente SELECT de solo lectura sobre el catálogo
-- del sistema (information_schema, pg_catalog, pg_policies) y sobre
-- public.documents/storage.objects sin escribir nada.
--
-- CÓMO USARLO: pegar y ejecutar en el SQL Editor de Supabase (o con una
-- conexión de solo lectura) para confirmar, ANTES de decidir si hace falta
-- aplicar 6b4_11_reparar_comprobantes_operadores.sql, cuál es el estado
-- real de las políticas y restricciones relacionadas con comprobantes.
-- No se ejecutó en esta etapa (6B4.11) — queda preparado para cuando el
-- titular autorice correrlo.
-- ============================================================

SELECT * FROM (

  -- 1) Políticas RLS actuales sobre public.documents
  SELECT
    'documents_rls' AS categoria,
    polname AS chequeo,
    pg_get_expr(polqual, polrelid) AS resultado
  FROM pg_policy
  WHERE polrelid = 'public.documents'::regclass

  UNION ALL

  -- 2) Políticas RLS actuales sobre storage.objects (bucket "documents")
  SELECT
    'storage_rls',
    polname,
    pg_get_expr(polqual, polrelid)
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass

  UNION ALL

  -- 3) Restricciones CHECK actuales sobre public.documents
  SELECT
    'documents_check',
    conname,
    pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'public.documents'::regclass AND contype = 'c'

  UNION ALL

  -- 4) Nullability de las columnas relevantes de public.documents
  SELECT
    'documents_columns',
    column_name,
    'nullable=' || is_nullable || ' | tipo=' || data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'documents'
    AND column_name IN ('group_id','obligation_id','payment_id','card_id','statement_id','movement_id','kind','storage_path','file_path','uploaded_by','size_bytes','mime_type')

  UNION ALL

  -- 5) Foreign keys de public.documents
  SELECT
    'documents_fk',
    conname,
    pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'public.documents'::regclass AND contype = 'f'

  UNION ALL

  -- 6) ¿RLS habilitado en documents y storage.objects?
  SELECT
    'rls_enabled',
    'public.documents',
    CASE WHEN relrowsecurity THEN 'RLS ON' ELSE 'RLS OFF' END
  FROM pg_class WHERE oid = 'public.documents'::regclass

  UNION ALL

  SELECT
    'rls_enabled',
    'storage.objects',
    CASE WHEN relrowsecurity THEN 'RLS ON' ELSE 'RLS OFF' END
  FROM pg_class WHERE oid = 'storage.objects'::regclass

  UNION ALL

  -- 7) Columnas relevantes de credit_cards (para saber si el vínculo
  --    titular/operador ya existe en esa tabla y con qué nombre real)
  SELECT
    'credit_cards_columns',
    column_name,
    'nullable=' || is_nullable || ' | tipo=' || data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'credit_cards'

  UNION ALL

  -- 8) Políticas RLS actuales sobre credit_cards (para confirmar si un
  --    operador ya tiene SELECT/INSERT ahí, independientemente de documents)
  SELECT
    'credit_cards_rls',
    polname,
    pg_get_expr(polqual, polrelid)
  FROM pg_policy
  WHERE polrelid = 'public.credit_cards'::regclass

  UNION ALL

  -- 9) Límite de tamaño configurado en el bucket "documents"
  SELECT
    'storage_bucket',
    'documents',
    'public=' || COALESCE(public::text,'?') || ' | file_size_limit=' || COALESCE(file_size_limit::text,'sin límite propio') || ' | allowed_mime_types=' || COALESCE(array_to_string(allowed_mime_types,','),'sin restricción propia')
  FROM storage.buckets WHERE id = 'documents'

) AS verificacion_6b4_11
ORDER BY categoria, chequeo;

-- ------------------------------------------------------------
-- 10) NO INCLUIDA COMO CONSULTA AUTOMÁTICA A PROPÓSITO: comparar
--     documents.uploaded_by contra el dueño real de cada credit_card
--     requiere saber el nombre REAL de esa columna en credit_cards (no
--     verificado desde archivos locales — ver el resultado de
--     "credit_cards_columns" más arriba antes de escribir esta consulta).
--     Ejemplo de plantilla a completar manualmente reemplazando
--     "<columna_dueno>" por el nombre real:
--
--   SELECT count(*) FROM public.documents d
--   JOIN public.credit_cards c ON c.id = d.card_id
--   WHERE d.card_id IS NOT NULL AND d.uploaded_by <> c.<columna_dueno>;
-- ------------------------------------------------------------
