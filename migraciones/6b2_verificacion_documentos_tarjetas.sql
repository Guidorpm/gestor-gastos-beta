-- ============================================================
-- MEJORA 6B2 — Verificación posterior (SOLO LECTURA)
-- ------------------------------------------------------------
-- Este archivo NO modifica nada. No contiene ALTER, DROP, CREATE,
-- INSERT, UPDATE ni DELETE — únicamente consultas SELECT de solo
-- lectura sobre el catálogo del sistema (information_schema, pg_catalog,
-- pg_policies, storage.buckets).
--
-- CÓMO USARLO:
--   Pegar y ejecutar en el SQL Editor de Supabase DESPUÉS de aplicar
--   migraciones\6b2_documentos_tarjetas.sql, para confirmar en una sola
--   tabla que todo quedó como se esperaba.
--
-- Cada fila es un chequeo independiente: "resultado" debe decir "OK"
-- (o mostrar la definición esperada) para los 9 puntos pedidos.
-- ============================================================

SELECT * FROM (

  -- 1) Existencia de card_id
  SELECT
    'columnas' AS categoria,
    'card_id existe en public.documents' AS chequeo,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'card_id'
    ) THEN 'OK' ELSE 'FALTA' END AS resultado

  UNION ALL
  -- 2) Existencia de statement_id
  SELECT
    'columnas',
    'statement_id existe en public.documents',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'statement_id'
    ) THEN 'OK' ELSE 'FALTA' END

  UNION ALL
  -- 3) Existencia de movement_id
  SELECT
    'columnas',
    'movement_id existe en public.documents',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'movement_id'
    ) THEN 'OK' ELSE 'FALTA' END

  UNION ALL
  -- 4) Nulabilidad de group_id
  SELECT
    'columnas',
    'group_id es nullable en public.documents',
    COALESCE(
      (SELECT CASE WHEN is_nullable = 'YES' THEN 'OK (nullable)' ELSE 'NOT NULL (falta el paso 2 de la migración)' END
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'group_id'),
      'FALTA la columna group_id'
    )

  UNION ALL
  -- 5) Definición completa de documents_check
  SELECT
    'restricciones check',
    'definición de documents_check',
    COALESCE(
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_check'),
      'FALTA la restricción documents_check'
    )

  UNION ALL
  -- 6) Definición completa de documents_kind_check
  SELECT
    'restricciones check',
    'definición de documents_kind_check',
    COALESCE(
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'public.documents'::regclass AND conname = 'documents_kind_check'),
      'FALTA la restricción documents_kind_check'
    )

  UNION ALL
  -- 7) Existencia de las 4 políticas documents_credit_*
  SELECT
    'políticas RLS',
    'políticas documents_credit_* (select/insert/update/delete)',
    (SELECT COALESCE(string_agg(policyname, ', ' ORDER BY policyname), 'NINGUNA ENCONTRADA') || ' (' ||
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documents' AND policyname LIKE 'documents_credit_%')
       || ' de 4)'
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'documents' AND policyname LIKE 'documents_credit_%')

  UNION ALL
  -- 8) Existencia de las 4 políticas storage_credit_documents_*
  SELECT
    'políticas RLS',
    'políticas storage_credit_documents_* (select/insert/update/delete)',
    (SELECT COALESCE(string_agg(policyname, ', ' ORDER BY policyname), 'NINGUNA ENCONTRADA') || ' (' ||
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'storage_credit_documents_%')
       || ' de 4)'
     FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'storage_credit_documents_%')

  UNION ALL
  -- 9) Estado privado del bucket "documents"
  SELECT
    'storage',
    'bucket "documents" es privado (public = false)',
    COALESCE(
      (SELECT CASE WHEN public = false THEN 'OK (privado)' ELSE 'ALERTA: el bucket está marcado como público' END
       FROM storage.buckets WHERE id = 'documents'),
      'FALTA el bucket "documents"'
    )

) AS verificacion_6b2
ORDER BY categoria, chequeo;
