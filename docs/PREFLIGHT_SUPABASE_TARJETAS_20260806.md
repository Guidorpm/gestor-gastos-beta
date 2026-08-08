# Preflight de Supabase — Tarjetas (owner de Storage, período directo, versión vigente)

**Fecha:** 2026-08-06
**Estado:** BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN

Este documento **no se ejecuta** como parte de esta tarea. Enumera las
verificaciones de **solo lectura** que deberían correrse contra el
Supabase real antes de publicar las correcciones de Tarjetas de esta
serie (owner de Storage, resolución previa del statement, versionado
documental, validación central de identidad/período). Cada consulta es
`SELECT` puro — ninguna escribe, modifica RLS, ni altera datos.

Todas las consultas de este documento deben ejecutarse manualmente,
revisando el resultado antes de continuar, nunca en un script
automatizado sin supervisión.

---

## 1. Existencia de la RPC `current_credit_card_access()`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'current_credit_card_access';
```

**Resultado esperado:** una fila, `routine_type = FUNCTION`,
`security_type = DEFINER` (para poder evaluar `credit_card_access` sin
que el propio RLS de esa tabla bloquee la evaluación).

## 2. Resultado esperado por usuario

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
-- Ejecutar autenticado como cada usuario (o con SET ROLE / impersonación
-- equivalente que ya use el equipo para pruebas de RLS).
SELECT current_credit_card_access();
```

- **Guido** (titular): `true`.
- **Julieta** (acceso delegado activo): `true`.
- **Fabiana**: `false` (o error controlado, nunca `true`).

## 3. `credit_cards.owner_id` — existencia y NOT NULL

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT column_name, is_nullable, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'credit_cards' AND column_name = 'owner_id';
```

**Resultado esperado:** `is_nullable = NO`, `data_type = uuid`,
`column_default` referenciando `auth.uid()` (según
`migraciones/6b_FINAL_F_2B_2_MIGRACION_ACCESO_TARJETAS.sql`, local, no
aplicada — confirmar que el estado real coincide).

## 4. owner_id real de 5044 y 8374

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT id, last4, brand, issuer, owner_id
FROM public.credit_cards
WHERE last4 IN ('5044', '8374');
```

**Resultado esperado:** ambas filas con el mismo `owner_id` (Guido,
titular real) — el mismo valor que debería aparecer como segundo
segmento de la ruta de Storage de sus documentos.

## 5. Filas activas de `credit_card_access`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT owner_id, user_id, role, created_at
FROM public.credit_card_access
ORDER BY created_at DESC;
```

**Resultado esperado:** una fila `owner_id = Guido, user_id = Julieta`
con un `role` válido; ninguna fila para Fabiana/Diego/Lisa.

## 6. Policies SELECT/INSERT/UPDATE de `credit_cards`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.credit_cards'::regclass;
```

**Resultado esperado:** políticas owner-only (`owner_id = auth.uid()`)
más la extensión de operador vía `credit_card_access` (si ya se aplicó
`6b_FINAL_F_2B_2_MIGRACION_ACCESO_TARJETAS.sql`) — confirmar que el
SELECT efectivamente permite a Julieta ver las tarjetas delegadas.

## 7. Policies de `credit_card_statements`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.credit_card_statements'::regclass;
```

**Resultado esperado:** INSERT/UPDATE con `owner_id` re-derivado desde
`credit_cards` (nunca confiado del payload del cliente, según el diseño
documentado en la migración local) — confirmar que el `UPDATE` que
`processCreditStatementFile()` ejecuta al reprocesar un statement
existente (metadata + totales) está cubierto.

## 8. Policies de `credit_card_movements`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.credit_card_movements'::regclass;
```

**Resultado esperado:** INSERT con `owner_id`/`card_id` re-derivados vía
`credit_cards`, nunca confiados del payload — confirmar que Julieta
puede insertar movimientos de una tarjeta delegada.

## 9. Policies de `public.documents`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.documents'::regclass;
```

**Resultado esperado (según `migraciones/6b2_documentos_tarjetas.sql`,
ya en el repo):** `documents_credit_select/insert/update/delete`, todas
con `card_id IS NOT NULL AND uploaded_by = auth.uid()`. Confirmar
específicamente que el `UPDATE` (usado por
`processCreditStatementFile()` para vincular `statement_id` después de
crear el resumen) sigue permitido bajo esta condición — el `USING`
actual no exige `statement_id` no nulo, así que debería alcanzar; pero
debe confirmarse contra el estado real, no asumirse.

## 10. Policies de `storage.objects`

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'storage.objects'::regclass
  AND polname ILIKE '%credit%';
```

**Resultado esperado:** políticas `storage_credit_documents_*` y
`storage_credit_documents_*_operator` exigiendo, para rutas
`credit-cards/...`, que el segundo segmento coincida con
`credit_cards.owner_id` (vía `EXISTS` con join a `credit_cards`), no con
`auth.uid()` directo — esto es lo que
`creditStorageOwnerId()`/`uploadCreditDocument()` ya asumen en el código
corregido de esta serie.

## 11. Formato exacto esperado de la ruta

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN — SOLO LECTURA, sin JOIN de
-- escritura, revisa objetos YA existentes sin modificarlos.
SELECT o.name,
       (storage.foldername(o.name))[1] AS segmento1,
       (storage.foldername(o.name))[2] AS segmento2_owner_id,
       (storage.foldername(o.name))[3] AS segmento3_card_id
FROM storage.objects o
WHERE o.bucket_id = 'documents'
  AND (storage.foldername(o.name))[1] = 'credit-cards'
LIMIT 50;
```

**Resultado esperado:** el segmento 2 de CADA ruta existente coincide
con un `owner_id` real de `credit_cards`, no con un `uploaded_by`
distinto. Si algún objeto real no sigue el formato
`credit-cards/{owner_id}/{card_id}/{statement_id o sin-resumen}/...`,
documentarlo antes de publicar (podría tratarse de objetos subidos antes
de esta corrección, con `session.user.id` en el segundo segmento).

## 12. Permiso de Julieta para subir (prueba de policy, solo lectura de resultado)

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
-- Ejecutar autenticado como Julieta: confirma que puede LEER (SELECT) la
-- tarjeta delegada y el resumen -- no ejecuta ningún INSERT/UPDATE real.
SELECT c.id, c.last4, c.owner_id
FROM public.credit_cards c
WHERE c.owner_id = (SELECT owner_id FROM public.credit_card_access WHERE user_id = auth.uid() LIMIT 1);
```

**Resultado esperado:** Julieta ve las tarjetas de Guido (delegadas),
confirmando que el SELECT necesario antes de `uploadCreditDocument()`
(`creditCards.find(...)` en el cliente depende de que esta fila haya
llegado por `loadCreditCardsData()`) funciona.

## 13. Prohibición de Fabiana/Diego/Lisa

```sql
-- BORRADOR — NO EJECUTAR SIN AUTORIZACIÓN
-- Ejecutar autenticado como cada uno de ellos.
SELECT count(*) FROM public.credit_cards; -- esperado: 0 filas visibles
SELECT current_credit_card_access();      -- esperado: false
```

**Resultado esperado:** cero tarjetas visibles y `current_credit_card_access() = false`
para los tres.

---

## Resumen de qué confirma cada bloque

| Bloque | Qué confirma | Relevante para |
|---|---|---|
| 1-2 | La RPC de acceso existe y responde lo esperado por usuario | Acceso delegado (entrega 2026-08-06 "integración real") |
| 3-4 | `owner_id` es la columna real y tiene el valor esperado en 5044/8374 | `creditStorageOwnerId()` (Hallazgo 1, "integración real") |
| 5 | Delegación real de Julieta existe en la tabla | Acceso delegado |
| 6-9 | Las policies de las 4 tablas principales cubren los flujos de escritura reales (crear/actualizar statement, vincular documento, insertar movimientos) | Todo el motor `processCreditStatementFile()` |
| 10-11 | Las policies de Storage exigen el formato de ruta que el código ya asume | `creditStorageOwnerId()`, tanto para subir como para reconciliar huérfanos |
| 12-13 | El acceso delegado funciona en ambos sentidos (Julieta sí, Fabiana/Diego/Lisa no) | Matriz de permisos completa |

Ninguna consulta de este documento fue ejecutada. No se modificó
Supabase, RLS, ni Storage. No se ejecutó SQL alguno como parte de esta
tarea.
