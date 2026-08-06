# Cierre — Corrección del panel de pendientes de Fabiana (release limpio)

Fecha: 2026-08-05
Rama: `release/panel-pendientes-fabiana-20260805`
Worktree: `C:\Proyectos\gestor-gastos-beta-release-pendientes-20260805`
Base: `origin/main` @ `39609cc197dbbfb3d8048e457747fa25938738d5`
Estado: **NO publicado** (sin commit, sin push, sin publicación)

Este documento cierra el trabajo de aislamiento: la corrección fue
desarrollada y validada en `C:\Proyectos\gestor-gastos-beta-estabilizacion-20260804`
(worktree que además contiene, mezclados, los bloques de Tarjetas,
comprobantes y diagnósticos de Británico de días anteriores). Este release
extrae **exclusivamente** la corrección del panel de pendientes, aplicada
a mano sobre una copia limpia de `origin/main`, comparando cada hunk del
diff original y descartando todo lo que no correspondiera.

## Causa

El panel agregado "Obligaciones del mes" (lo que un usuario ve primero al
entrar, antes de abrir un espacio puntual) filtraba en tres capas del
cliente por `ownedGroupIds` — espacios que el usuario **fundó**
(`created_by===session.user.id`) — en vez de por membership activa real.
Fabiana es operadora de GR, no su fundadora: para ella `owned` es un
array vacío, así que:

1. `loadSpacesDashboard()` cortaba con `if(!owned.length)return;` antes de
   consultar nada.
2. `serviceObligationRowsForMonth()` volvía a filtrar por `ownedGroupIds`
   aunque hubiera datos.
3. El gate de render (`hasOwnerSpaces()?renderMonthlyObligationsBlock():''`)
   ni siquiera montaba el panel.

La tabla anual (dentro del detalle de GR) ya funcionaba, porque
`reloadGroup()` consulta `obligations`/`payments` solo por `group.id`, sin
ninguna condición de propiedad — RLS ya autoriza esa consulta por
membership real.

## Corrección

En `index.html` e `index_operator.html`, de forma idéntica:

- `loadSpacesDashboard()`: usa `authorized` (espacios activos con
  membership activa real, propia u operador) en vez de `owned` para
  decidir qué consultar. `ownedGroupIds` se conserva intacto — sigue
  siendo la fuente real de lo exclusivo del titular
  (`renderOwnerDashboard`, `dashboardCardMetrics`).
- Nuevas funciones puras: `isServiceVisibleForCurrentContext()` (servicio
  activo + grupo activo + grupo autorizado + privacidad compatible —
  SOLO TITULAR: un servicio privado de un espacio operado nunca se
  muestra a un operador), `getVisibleObligationsForCurrentContext()`
  (obligación no cancelada + servicio visible) y
  `calculateRealObligationBalance()` (pagos legado + imputaciones
  activas, sin doble conteo, sin pagos anulados — ya existía como
  `paidAmountForWithAllocations`; ahora `balanceFor()` y
  `dashboardBalanceFor()` la llaman explícitamente en vez de restar cada
  una por su cuenta).
- `serviceObligationRowsForMonth()`: usa las funciones de arriba en vez
  de `ownedGroupIds`.
- Nueva función `hasAnyActiveGroupAccess()`
  (`groups.some(g=>(g.status||'active')==='active')`) reemplaza a
  `hasOwnerSpaces()` únicamente en los dos puntos que deciden si
  "Obligaciones del mes" se muestra/liga. `hasOwnerSpaces()` no se tocó.
- El cierre de sesión reinicia `spacesDashboard` completo (antes solo se
  reasignaba en `loadSpacesDashboard()`, nunca al cerrar sesión).

No se hardcodeó ningún correo, UUID de obligación real, ni las cifras del
caso de evidencia (Argentina Virtual/Movistar/DUX, $221.333,77/
$42.592,00/$263.925,77) en el código — solo se usan como fixture en la
prueba nueva.

## Archivos

**Modificados:**
- `index.html`
- `index_operator.html`
- `pruebas/run_hotfix_payment_allocations_deudas_tests.js` (se agregó
  `calculateRealObligationBalance` a su lista de extracción — `balanceFor()`
  ahora depende de ella; sin este ajuste ese test preexistente crasheaba
  con `ReferenceError`. Mismo comportamiento, sin cambio de lógica real).
- `pruebas/run_correccion_deudas_arrastradas_tests.js` (mismo ajuste, dos
  listas de extracción/paridad).

**Creados:**
- `pruebas/run_panel_pendientes_fabiana_20260805_tests.js`
- `docs/CIERRE_CORRECCION_PANEL_PENDIENTES_FABIANA_20260805.md` (este archivo)

**Explícitamente NO incorporados** (quedaron en el worktree de origen,
fuera de este release): el gate `canAccessTarjetas()`/
`creditCardAccessGranted` de Tarjetas, `serviceDocumentErrorMessage()` de
comprobantes, cualquier diagnóstico o borrador SQL de Británico, Edge
Functions, migraciones.

## Confirmación del diff

El diff completo contra `origin/main` (`entregas/CAMBIOS_RELEASE_PANEL_PENDIENTES_FABIANA_20260805.patch`)
se explica en su totalidad como: **"permitir que el panel de obligaciones
use memberships activas y la misma lógica de saldo y visibilidad que la
tabla anual."** Se verificó explícitamente (búsqueda de texto sobre el
diff) que no aparece ninguna mención a `canAccessTarjetas`,
`creditCardAccessGranted`, `current_credit_card_access`,
`serviceDocumentErrorMessage` ni "británico"/"british".

## Pruebas

- `pruebas/run_panel_pendientes_fabiana_20260805_tests.js`: 50/50
  verificaciones de lógica real (extrae y ejecuta las funciones reales de
  ambos archivos, con el fixture exacto de Fabiana: 7 obligaciones,
  $221.333,77 + $42.592,00 = $263.925,77, Británico excluido, SOLO
  TITULAR excluido, Casa excluida, Guido conserva sus funciones de
  titular).
- Regresión contra la suite existente del repositorio: sin fallas nuevas.
  Fallas preexistentes confirmadas (verificadas también contra una copia
  sin modificar de `origin/main`, antes de aplicar ningún cambio):
  - `run_6b4_11_3_permisos_navegacion_tests.js`: 1/59 falla (extractor
    frágil de un test viejo sobre `renderOwnerDashboard`, no relacionado).
  - `run_6b4_16_cierre_v1_tests.js`: 1/29 falla (CSS/responsive
    preexistente, no relacionado).
  - `run_6b4_10_1`, `run_6b4_11_1_visibilidad_titular`,
    `run_6b4_11_comprobantes`, `run_6b4_12_1`, `run_6b4_12_2`,
    `run_6b4_12_cierre_conciliacion_visa`, `run_6b4_13_vista_previa`,
    `run_6b4_14_carga_masiva`, `run_6b4_15_notificaciones_edicion_tarjetas`,
    `run_correccion_deudas_arrastradas` (parte final): crashean también
    sobre `origin/main` sin ningún cambio aplicado -- confirmado
    explícitamente comparando contra una copia limpia. Causas: algunos
    referencian funciones de trabajo posterior no publicado
    (`distribución de pagos`), y `run_6b4_14_carga_masiva_tests.js`
    específicamente usa un regex (`;\n`) sensible a fin de línea CRLF —
    el checkout de este entorno normaliza a CRLF, rompiendo ese regex
    incluso en un worktree recién creado sin ningún cambio.

## Limitaciones

- No se pudo validar con una sesión real de Fabiana contra Supabase desde
  este entorno (sin acceso). La validación se hizo con pruebas de lógica
  reales sobre las funciones extraídas del código, con el fixture exacto
  de la evidencia ya confirmada por Guido en la validación anterior.
- Varios archivos de prueba preexistentes del repositorio ya estaban
  rotos en `origin/main` antes de este trabajo (ver sección Pruebas) —
  quedan señalados, no corregidos, por estar fuera de alcance de este
  release.

## Estado

**NO PUBLICADO.** Sin commit, sin push. Listo para revisión previa a
publicación.
