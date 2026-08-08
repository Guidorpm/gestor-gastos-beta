# Auditoría — Flujo de carga, lectura y trazabilidad de resúmenes de Tarjetas

Fecha: 2026-08-05
Worktree: `C:\Proyectos\gestor-gastos-beta-resumenes-trazabilidad-20260805`
Base: `origin/main` @ `90f736b`

Auditoría de código real (`index.html`, ~18.500 líneas) más verificación
directa contra los dos PDF reales del caso (Visa 5044 julio 2026, Visa
8374/4597 julio 2026), extraídos con `pdftotext -layout` y comparados
línea por línea contra el parser real. Los PDF viven en
`C:\Proyectos\gestor-gastos-beta-fixtures-privados\2026-07\` (fuera del
repositorio, nunca commiteados).

## Motores existentes (mapa real)

Hay **tres** caminos de carga de un PDF de resumen, con motores internos
distintos:

1. **"+ Resumen"** (`newStatement` → `openCreditStatementModal`, línea
   12947): formulario 100% manual. No lee ningún PDF.
2. **"Cargar resúmenes históricos"** (`openHistoricalUpload` → `runHistoricalUpload`,
   línea 13454): el único camino REALMENTE ejecutable hoy para subir un
   PDF. Usa `detectCreditStatementIdentity` (identidad) +
   `parseBancoProvinciaVisaStatement`/Mastercard/MercadoPago (parser
   financiero) + `runCreditStatementFinancialCheck`
   (`reconcileCreditStatementTotals`). Guarda `credit_card_statements`
   (totales) y el documento — **nunca** movimientos individuales.
3. **"Carga masiva conciliada"** (`openMassiveLoadModal` →
   `runMassiveConciliatedLoadExecute`, línea 10341): motor completo, ya
   probado, que SÍ inserta movimientos individuales reales
   (`credit_card_movements`, línea 10448) de forma idempotente
   (`plannedMovementInserts` ya deduplicado). Está **apagado a
   propósito**: `const MASSIVE_LOAD_EXECUTION_ENABLED_STAGE=false;`
   (línea 7174) deshabilita todos los botones de ejecución real de ese
   modal (comentario línea 10779: *"la ejecución real se habilita en una
   etapa posterior"*).

Confirmado: **hoy no existen dos parsers distintos para el contenido**
(el parser financiero — `parseBancoProvinciaVisaStatement`/Mastercard/
MercadoPago — es el mismo en los tres caminos), pero sí hay **motores de
persistencia distintos**, y el único activo (2) es el que nunca guarda
movimientos.

## A. Por qué 5044 detecta tarjeta pero no detecta período

Hay **dos extractores de período independientes**. El parser financiero
sí soporta el formato real:

```js
// línea 5119, parseBancoProvinciaVisaStatement
const closeDueMatch=fullText.match(/CIERRE\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})\s+VENCIMIENTO\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})/i);
```
Verificado contra el PDF real: la línea "CIERRE 30 Jul 26 VENCIMIENTO 10
Ago 26" matchea sin problema — el parser financiero SÍ obtiene
`declaredCloseDate='2026-07-30'`/`declaredDueDate='2026-08-10'`.

El problema está en `detectCreditStatementIdentity` (línea 6188), que
corre **antes** y cuyo campo `period` decide si el archivo "está listo".
Tiene 4 patrones de período (líneas 6264-6313) y **ninguno** matchea
"CIERRE 30 Jul 26":
- `\b(20\d{2})[-\/](\d{1,2})\b` (línea 6264): exige año de 4 dígitos con
  separador `-`/`/`.
- Nombre completo del mes + año 4 dígitos (línea 6271): exige "julio",
  no "Jul".
- `\b\d{1,2}-([A-Za-z]{3})-(\d{2})\b` (línea 6287): formato con
  **guiones**, agregado explícitamente para Mastercard ("13-Mar-25", ver
  comentario línea 6278). El real de Visa usa **espacios**, no guiones.
- `\d{1,2}\s+de\s+(mes completo)` (línea 6306): exige la palabra "de" y
  mes completo.

**Causa exacta:** ningún patrón de `detectCreditStatementIdentity`
contempla "DD Mon YY" separado por espacios — el patrón de guiones fue
diseñado solo para Mastercard y nunca se generalizó a Visa/Banco
Provincia.

## B. Por qué un error de período bloquea también la subida del PDF

`analyzeMassiveLoadFile` (línea 7233) calcula el período de tres formas
pero usa **solo una** como operativa:
```js
periodOperativo:periodFromFilename,                    // línea 7240 — SOLO nombre de archivo
periodPorCierre:preview.parsed?.declaredCloseDate?...,  // línea 7241 — SÍ funciona (parser financiero)
periodPorContenido:preview.identity?.period||null,      // línea 7242 — NO funciona (bug A)
```
`parseHistoricalStatementPeriod(filename)` (línea 13048) busca `YYYY-MM`
en el **nombre del archivo**. "Resumen.pdf" no tiene ningún patrón de
fecha en el nombre → `periodOperativo=null`.

`decideMassiveLoadAction` (línea 7901, también usado — indirectamente,
vía el mismo cálculo de `periodOperativo` — como señal de "¿está listo?"
en el flujo real de `runHistoricalUpload`) bloquea con:
```js
if(!item.periodOperativo)return{action:'error_lectura',detail:'No se pudo determinar el período con seguridad',...}; // línea 7903
```
`periodPorCierre` (que sí tiene el valor correcto) solo se usa como
**corrector de conflictos** dentro de `classifyMassiveLoadGroups` (línea
7259) — y esa función además **excluye de entrada** a los ítems sin
`periodOperativo` (línea 7260: `usable=items.filter(...&&item.periodOperativo)`).
Nunca se usa como *fallback* primario.

**Causa exacta:** el valor correcto ya extraído por el parser financiero
(`periodPorCierre`) existe en memoria pero nunca se promueve a
`periodOperativo` cuando el nombre del archivo no alcanza — el diseño
actual trata "sin período en el nombre" como error terminal en vez de
"usar el período del contenido".

## C. Cómo se crearon los totales de 8374 sin movimientos

`runHistoricalUpload` (línea 13454), en su único `insert`, escribe
`credit_card_statements` con los totales (línea 13527-13546) usando
`financialResult.totals` (que sí vienen bien: el parser financiero lee
los totales del pie de página, no depende del período). **En ningún
punto de esta función hay un `insert` a `credit_card_movements`** —
confirmado por búsqueda exhaustiva en el rango completo de la función
(líneas 13454-13663). Es una limitación estructural, no un fallo
puntual: **todo** resumen cargado por este camino tiene siempre 0
movimientos, sin importar qué tan bien haya leído el PDF el parser.

El motor que sí inserta movimientos (`runMassiveConciliatedLoadExecute`,
punto 3 del mapa de arriba) existe, está probado, pero apagado por
`MASSIVE_LOAD_EXECUTION_ENABLED_STAGE=false`.

## D. Por qué el PDF original de 8374 figura ausente

`runHistoricalUpload` primero inserta el `statement` (totales) y **recién
después** sube/vincula el documento (`uploadCreditDocument`, línea
13633) — sin transacción atómica entre ambas escrituras a Supabase. Entre
el `insert` y el `uploadCreditDocument` hay varios caminos de salida
(`continue`) que dejan el `statement` ya creado sin llegar nunca a subir
el documento:
- Línea 13556-13564: recuperación ambigua tras error de duplicado (23505).
- Línea 13619-13624: `reconcileCreditStatementDocument` devuelve
  `'ambiguous'`.
- Cualquier excepción entre las líneas 13527 y 13633 cae en el `catch`
  de la línea 13655 (`row.state='error'`), que **no revierte** el
  `insert` del statement ya hecho.

**Causa exacta:** falta de atomicidad real entre "crear/actualizar
totales" y "guardar el PDF" — cualquier interrupción a mitad de camino
dejó exactamente el estado descrito (totales sin documento).

## E. Por qué la interfaz muestra "Todo revisado" con cero movimientos

Dos funciones de conteo con criterios distintos, sin reconciliar entre
sí:

- `creditIdentificationForMovements` (línea 4170) SÍ exige movimientos:
  `result.canReview=result.total>0&&...` (línea 4183).
- `creditReviewCount` (línea 11422), la que realmente alimenta el texto
  de la UI, **no exige nada de eso**:
  ```js
  function creditReviewCount(items){
    return (items||[]).filter(item=>creditMovementNeedsClassification(item)&&(...)).length;
  }
  ```
  Con `items=[]`, `.filter(...).length===0` — trivialmente "nada
  pendiente".

`creditSelectedDetailHtml` (línea 11977) usa `reviewCount` directamente
(línea 12002): `${reviewCount?...:'Todo revisado'}` y `${reviewCount?...:'Todos los consumos están identificados'}` —
sin comprobar nunca `purchases.length>0`.

En paralelo, `creditStatementCompositionReconciliation` (línea 11627) sí
tiene el guard correcto (`hasMovementDetail=(items||[]).length>0`, línea
11628) y produce "Desglose incompleto" (línea 11635) — por eso ambos
mensajes conviven en la misma pantalla, contradictorios.

## F. Trazabilidad — ya existe, parcial

`reconcileConsecutiveCreditStatements(previousStatement,currentStatement)`
(línea 3688) ya compara el saldo pendiente del resumen anterior contra el
saldo declarado/trasladado del actual, con 5 estados (`PAID`,
`CARRIED_FORWARD`, `PARTIALLY_CARRIED_FORWARD`, `DIFFERENCE_DETECTED`,
`NOT_RECONCILED`) y se renderiza en `creditTraceabilityHtml` (línea
11870), sección "Trazabilidad entre resúmenes" ya visible en el panel de
cada tarjeta. **No hace falta ninguna migración de Supabase para esta
función** — usa datos que ya se guardan hoy (`notes`/meta de cada
statement vía `buildFinancialReviewNotes`, que desde 6B4.8.3 ya incluye
`declaredPreviousBalanceArs/Usd` y `declaredPreviousRemainingArs/Usd`
específicamente para que esta comparación funcione sin depender de que
existan movimientos guardados).

Lo que le falta: como (C) `runHistoricalUpload` nunca guarda
movimientos, la trazabilidad depende de que la fecha correcta se haya
guardado como texto declarado — funciona, pero no puede mostrar detalle
línea por línea real (pagos/consumos/impuestos individuales) hasta que
(C) esté resuelto.

## Verificación adicional sobre los PDF reales (no solo análisis estático)

- El "pie repetido por página" que el código asume en varios comentarios
  (`DEBITAREMOS DE SU CTA` como fila fija de cada página) **no se repite**
  en ninguno de los dos PDF reales: aparece **una sola vez**, al final del
  documento. El corte `stopIndex=lines.findIndex(...DEBITAREMOS...)`
  (línea 5143) por lo tanto **no trunca** movimientos de páginas
  posteriores en estos dos casos concretos — se descarta como causa
  activa del "0 movimientos" de 8374 (la causa real y suficiente es (C)).
  Sí sigue siendo un supuesto fràgil si algún emisor imprimiera ese pie
  por página; no se tocó porque no es la causa confirmada de este caso.
- Confirmado con `grep` sobre el texto extraído: la tarjeta 8374 tiene
  exactamente 5 consumos (SHERWIN PINTURERIAS, MERPAGO*RCONLINE, DON
  NADIE, MERPAGO*SHINE, LUDOVICO) y la tarjeta 4597 exactamente 9
  (GRIMOLDI, KEVINGSTON, Google One, SHELL ITAL GAS, MERPAGO*REDANDBLUE,
  MERPAGO*ENCANTOSOUVE, CP*FACTURAS CLARO, HOSPITAL ITALIANO, GOOGLE
  *CapCut) — coincide exactamente con la evidencia del pedido. El bloque
  de la tarjeta 4597 sí cruza un salto de página del PDF (el consumo
  "GOOGLE *CapCut" del 28/07 aparece en la página 2, después del header
  repetido de página); confirmado con `parseBancoProvinciaVisaLine`
  (línea 4994+, loop principal): los headers de página se descartan por
  la lista de exclusiones de la línea 5163 sin resetear ningún estado de
  "tarjeta actual" — el loop de por sí no corta el bloque 4597 al cruzar
  de página.
- **Hallazgo adicional no reportado en el pedido, confirmado por
  código:** los `movements` que arma `parseBancoProvinciaVisaStatement`
  **no llevan ninguna marca de a qué tarjeta (8374 o 4597) ni a qué
  titular pertenecen** — la función SÍ calcula `titularSections` (línea
  5005, vía `creditPdfDetectSections`, línea 4621) con el rango de filas
  de cada bloque "Tarjeta NNNN Total Consumos de...", pero el propio
  comentario de esa sección (línea 4999-5004) dice explícitamente que es
  "información ADITIVA... nunca reemplaza el cálculo de
  movimientos/totales" — es decir, se calcula pero nunca se usa para
  etiquetar cada movimiento individual. Esto es necesario para poder
  desglosar 8374 (Guido) de 4597 (Julieta) como pide el punto 5 del
  pedido, y se corrige en este bloque (ver informe, sección "Corrección
  del parser").

## Conclusión

Ninguno de los dos bugs reportados es un problema de "lectura de PDF
difícil": el parser financiero ya lee correctamente fechas, totales y
movimientos de ambos documentos reales. Los bugs son de **integración**:
un segundo extractor de período con menos formatos soportados que
bloquea antes de llegar al parser bueno (5044), y un motor de
persistencia activo que nunca terminó de conectarse al motor de
movimientos ya construido y probado (8374). Las correcciones de este
bloque se concentran en cerrar esa brecha de integración, reutilizando
al máximo el código ya validado (parser financiero, motor de inserción
de movimientos, trazabilidad ya construida) en vez de reescribir nada
desde cero.

## Actualización 2026-08-06 — Corrección final (revisión externa)

La entrega del 2026-08-05 fue revisada externamente: el parser era
correcto (81 pruebas pasaban), pero la entrega **no era segura para
prueba con PDF reales ni para publicación**, por los motivos que siguen.

### G. El frontend apunta directo al Supabase productivo

`SUPABASE_URL='https://xjpuwokoefklxqezslwv.supabase.co'` (línea 403) es
la única instancia de Supabase que usa la app, tanto en `localhost` como
en producción — no existe un backend intermedio ni un proyecto de
pruebas separado. Antes de esta corrección, subir un PDF desde
`localhost` escribía datos reales. Se agregó `isCreditLocalPreviewMode()`
(activado solo por `location.hostname` en `localhost`/`127.0.0.1`) y una
guarda central `assertCreditWriteAllowed()`, aplicada en
`uploadCreditDocument()` (punto de entrada único de toda subida de
documento de Tarjetas) y en el motor `processCreditStatementFile()`.

### H. No existía un botón directo por tarjeta/período

El detalle de cada tarjeta solo ofrecía "Cargar resúmenes históricos"
(pensado para varios archivos). Se agregó "Subir resumen" (Bloque 3),
visible tanto con resumen seleccionado como sin ningún resumen todavía,
usando el mismo motor.

### I. Orden de persistencia incorrecto en `runHistoricalUpload`

El código anterior creaba el `statement` e insertaba movimientos **antes**
de subir el PDF (`uploadCreditDocument` era la última línea de la
función). Se extrajo toda la lógica a `processCreditStatementFile()`
(motor único compartido por la subida directa y la histórica),
reordenada al patrón obligatorio: documento primero (con
`statement_id` null si el resumen todavía no existe) → confirmar/crear
el resumen → vincular el documento (`documents.statement_id`, columna ya
nullable desde la migración 6b2, sin tocar Supabase) → procesar y
conciliar → insertar solo los movimientos faltantes, con el snapshot
recién refrescado desde Supabase (nunca un array en memoria
desactualizado tras una escritura parcial).

### J. Hash calculado pero nunca persistido

`buildExistingSnapshot` (línea ~7504) ya leía
`meta?.sourceFileHash` — la lectura existía, pero ningún camino de
escritura la llenaba. Se amplió `buildFinancialReviewNotes()` con
`sourceFileHash`/`sourceFileName`/`parserVersion`/`processedAt`.

### K. `findMatchingCreditDocument` no detectaba un PDF renombrado

Filtraba primero por nombre+tamaño+tipo y solo comparaba hash sobre lo
que pasara ese filtro — un PDF idéntico con otro nombre nunca llegaba a
compararse por hash. Se invirtió la prioridad: hash primero contra todos
los candidatos del mismo `statement`/`card`/`kind`; nombre+tamaño+tipo
solo como respaldo secundario, excluyendo explícitamente los candidatos
cuyo hash ya se confirmó distinto.

### L. Tolerancia única para reconocimiento técnico y confirmación contable

`CREDIT_RECONCILE_TOLERANCE_ARS=1` se usaba tanto para que el parser
reconociera columnas/alineaciones del PDF como para decidir si un
resumen quedaba "conciliado". Se agregaron
`CREDIT_CONFIRM_TOLERANCE_ARS/USD=0.01`, usadas exclusivamente en el gate
real de confirmación (`reconcileCreditStatementTotals`); la tolerancia
técnica original se conserva sin cambios en sus demás usos (interpretación
de columnas, criterios de "misma tarjeta" en la carga masiva).

### M. Acceso a Tarjetas gateado por `hasOwnerSpaces()`

Confirmado: la entrega del 2026-08-05 no incluía ninguna referencia a
`current_credit_card_access`. Se incorporó selectivamente (no se copió
ningún archivo completo) desde
`C:\Proyectos\gestor-gastos-beta-estabilizacion-20260804` (cambios sin
commitear en ese worktree, nunca fusionados a `origin/main`): variable
`creditCardAccessGranted`, resuelta una vez por sesión en `loadGroups()`
vía `sb.rpc('current_credit_card_access')`, y `canAccessTarjetas()`
reemplazando a `hasOwnerSpaces()` en los 4 gates reales (`loadCreditCardsData`,
`openCreditCardsModule`, `renderCreditCardsModule`, panel de Tarjetas en
`renderGroups`) más dos gates de escritura del motor de carga masiva
(`refreshMassiveLoadLiveData`, `decideMassiveLoadAction`). El resto del
diff de ese worktree (panel de pendientes de Fabiana) ya estaba
publicado en `origin/main` y no se volvió a tocar; la corrección de
mensajes de RLS en comprobantes de Servicios de ese mismo worktree
(`serviceDocumentErrorMessage`) quedó fuera por no ser parte del acceso
de Tarjetas.

### N. Hallazgo adicional durante la prueba con los PDF reales

Al ejecutar el motor real contra el texto extraído del PDF real de 8374
(vía `pdftotext -layout`, herramienta externa usada solo para
inspección), el cargo "IMPUESTO DE SELLOS ... USD 0,12" aparece en una
línea propia, separada de su línea de concepto, por una particularidad
de alineación de columnas de esa herramienta externa. Esto deja una
diferencia real de USD 0,12 sin conciliar contra el total declarado. No
se pudo confirmar si el extractor real de la aplicación (pdf.js, que usa
coordenadas del PDF en vez de heurísticas de texto plano) sufre la misma
desalineación, porque este entorno no tiene un navegador real disponible
para ejecutar pdf.js. El comportamiento actual ante esto es el correcto
y seguro por diseño: el resumen 8374 queda en "Requiere revisión" (no se
fuerza ninguna conciliación falsa) — ver limitaciones en el informe.

## Actualización 2026-08-06 (2) — Integración real (owner de Storage,
## reprocesamiento sin duplicados, conservación de originales)

Revisión externa de la entrega anterior: encontró 3 fallas de
integración real, no de lógica financiera.

### O. Ruta de Storage con `session.user.id` en vez de `card.owner_id`

`uploadCreditDocument()` armaba `credit-cards/${session.user.id}/${cardId}/...`.
Confirmado contra `migraciones/6b_FINAL_F_2B_2_MIGRACION_ACCESO_TARJETAS.sql`
(no aplicada, local): `credit_cards.owner_id` es `NOT NULL DEFAULT
auth.uid()`, y las políticas reales de `storage.objects`
(`storage_credit_documents_*_operator`) exigen `(storage.foldername(name))[2]
= c.owner_id::text`. Con acceso delegado (Julieta sube una tarjeta de
Guido), `session.user.id` (Julieta) ≠ `card.owner_id` (Guido) — la
subida quedaría rechazada por RLS en producción real. Se agregó
`creditStorageOwnerId(cardId)` (busca en `creditCards`, ya cargado y
filtrado por RLS, exige `owner_id` real, falla antes de tocar Storage) y
se corrigió tanto `uploadCreditDocument()` como
`reconcileCreditDocumentLink()` (mismo patrón de ruta) para usarla.
`uploaded_by` se mantiene como `session.user.id` sin cambios — son dos
identidades distintas a propósito (dueño del dato vs. quien operó).

### P. La subida directa no resolvía el resumen antes del PDF

`processCreditStatementFile()` recién llamaba a `findStatementForPeriod`
dentro del manejo del error 23505 (unique_violation), es decir, DESPUÉS
de haber subido el documento e intentado crear el resumen. Para un
reprocesamiento de 8374 (resumen ya existente), esto significaba: subir
el PDF a "sin-resumen", fallar al crear un segundo `credit_card_statement`,
recién ahí encontrar el resumen real. El documento quedaba en
`sin-resumen` en vez de nacer ya vinculado. Se movió la resolución del
`statement` (vía `findStatementForPeriod`) a ANTES del paso de subida —
el `unique_violation` queda exclusivamente como defensa ante una
condición de carrera real, nunca como camino normal.

### Q. `processCreditStatementFile()` borraba el documento anterior

Al reemplazar el PDF de un resumen existente, ejecutaba `sb.from('documents').delete()`
+ `sb.storage.from('documents').remove()` sobre el documento anterior —
tanto en el motor único como en el flujo manual paralelo
`confirmCreditStatementDocUpload()` (detalle del resumen abierto,
botón "Reemplazar"). Ambos puntos se corrigieron: nunca se borra nada
automáticamente; un PDF distinto para el mismo resumen queda como una
versión nueva, vinculada al mismo `statement_id`, sin tocar la anterior.
`creditStatementOriginalDoc()` sigue eligiendo la más reciente como
vigente (sin cambios); se agregó `creditStatementPriorVersionsHtml()`
para mostrar las versiones anteriores con acceso a abrirlas. La única
eliminación real posible sigue siendo la acción manual "Eliminar"
(`deleteCreditDocument`), que además carecía de cualquier chequeo de
permiso propio — se le agregó `canRepairCreditDocuments()` para que el
acceso delegado (Julieta) nunca alcance por sí solo para borrar
documentos.

### R. Auditoría de `canRepairCreditDocuments()`

Se revisaron los 16 llamadores reales: todos corresponden a acciones
administrativas/de reparación genuinas (revisión de resúmenes
anteriores, carga masiva conciliada -aún deshabilitada-, confirmación
manual de archivos UNCERTAIN, revisión/eliminación de copias
duplicadas, calendario de la tarjeta, reemplazo de resúmenes de Mercado
Pago). Ninguno necesitaba cambiar a `canAccessTarjetas()` — la subida
normal (directa e histórica) nunca pasó por `canRepairCreditDocuments()`.
El único hallazgo real fue la ausencia total de chequeo en
`deleteCreditDocument()` (corregida, ver punto Q). Matriz completa en el
informe, sección 8.

## Actualización 2026-08-06 (3) — Cierre definitivo (validación central,
## período directo, versión vigente segura)

Tercera revisión externa de esta serie: confirmó que owner de Storage,
resolución previa del statement, versionado documental e idempotencia
(entrega anterior) eran correctos, pero encontró 3 fallas adicionales.

### S. `processCreditStatementFile()` no ejecutaba `validateStatementAgainstCard()`

La función ya existía y ya se usaba en la interfaz (carga histórica,
reemplazo manual), pero el motor real de escritura nunca la llamaba —
nada impedía, a nivel de motor, que un archivo de otra tarjeta se
procesara si algo en la interfaz fallaba al filtrarlo antes. Se agregó
la llamada real, con corte inmediato en `MISMATCH` (cero escrituras) y
exigencia de confirmación manual explícita en `UNCERTAIN`
(`options.manualConfirmed`) — nunca se escribe nada hasta que el estado
sea `MATCH` o `UNCERTAIN` ya confirmado. Los últimos 4 dígitos explícitos
siguen teniendo prioridad máxima (ya así en la función existente, sin
cambios ahí).

### T. La carga directa no transmitía contexto real de período

`openDirectStatementUploadModal(card)` solo recibía la tarjeta. Se
amplió a `openDirectStatementUploadModal(card, selectedStatement)`
-- valida que el `selectedStatement` pertenezca realmente a esa tarjeta
antes de guardarlo como contexto (`directUploadState.selectedStatementId`/
`selectedPeriod`). `processCreditStatementFile()` ahora compara: período
detectado en el PDF vs. contexto de pantalla, con los 4 casos pedidos
(A: coinciden, continúa; B: declaran otro período, corta; C: el PDF no
declara período pero hay contexto, exige confirmación explícita; D: no
hay período en ningún lado, exige selección manual vía `<input
type="month">`, nunca inventado). `options.statementId` se revalida
siempre contra `creditStatements` -- nunca se acepta arbitrario.

### U. Versión vigente insegura ante un PDF no conciliado

Bug real: un PDF distinto para un statement YA EXISTENTE se subía
vinculado directamente a ese `statement_id` sin importar si conciliaba,
así que `creditStatementOriginalDoc()` (elige el documento más reciente)
podía convertirlo en "Resumen vigente" mientras los totales seguían
siendo los del PDF anterior -- documento y totales de versiones
distintas, sin ninguna migración necesaria para que ocurriera. Corregido:
si el statement ya existía Y este procesamiento no concilia
(`financiallyOk=false`), el PDF se sube vinculado SOLO a la tarjeta
(`statement_id` null) -- nunca participa de `creditStatementOriginalDoc()`
(que filtra por `statement_id` exacto). Metadata aceptada
(`sourceFileHash`/`sourceFileName`/`parserVersion`/`processedAt`) y
totales del statement existente quedan exactamente como estaban; no se
insertan movimientos. `result.state` se corrigió para nunca devolver un
estado "exitoso" (`uploaded`/`created_and_uploaded`/`linked_existing`/
`already_uploaded`) cuando `financialResult.valid` es `false` -- siempre
`review_required` en ese caso, con mensaje aclarando que el PDF quedó
preservado pero no aceptado como vigente.

### V. Hallazgo adicional durante las pruebas nuevas: refresco antes de la búsqueda

Al escribir la prueba "reintentar el mismo PDF pendiente no duplica" se
detectó que `processCreditStatementFile()` refrescaba
`creditDocuments`/`creditStatements` (`loadCreditCardsData()`) recién
antes del paso de movimientos, al final -- una segunda llamada
inmediata (antes de que la interfaz disparara su propio refresh) podía
no ver un documento huérfano recién creado por la llamada anterior, y
crear otro. Se adelantó el refresco a justo después de la guarda de
escritura, antes de cualquier búsqueda o escritura real.

## Actualización 2026-08-06 (4) — Cierre funcional de la vista previa
## (detalle completo A-E y trazabilidad real de solo lectura)

Cuarta revisión externa de esta serie: confirmó que la validación
central de identidad/período y la versión vigente segura (entrega
anterior) eran correctas, pero encontró 2 fallas de la vista previa de
resúmenes, ambas de cara al usuario (Guido necesita revisar el resumen
completo antes de guardar, y confiar en que la trazabilidad mostrada es
real).

### W. La vista previa solo mostraba conteos, nunca el detalle línea por línea

`directStatementResultHtml()` mostraba únicamente totales agregados
("Consumos: 12 · Pagos: 6 · ...") sin ninguna tabla de detalle -- Guido
no podía revisar comercio, fecha, importe ni clasificación de cada
movimiento antes de decidir guardar. Causa: la función solo leía
`fr.movements` (componentes crudos del parser, sin fecha resuelta por
movimiento -- el parser real, `parseBancoProvinciaVisaStatement`, nunca
adjunta una fecha por línea) y nunca invocaba el motor de fechas/matching
que la app ya usa para persistir (`buildExistingSnapshot`+
`buildMovementDetailAnalysis`, con `extractMovementDates` resolviendo la
fecha real de cada movimiento). Corregido reutilizando ESE MISMO motor,
ya probado y ya usado por la persistencia real, ahora también en modo de
solo lectura para la vista previa (`buildPreviewMovementDetail()`, nueva,
llama a `buildExistingSnapshot`/`buildMovementDetailAnalysis` exactamente
igual que el camino de escritura, sin duplicar ni reimplementar el
parser ni las fórmulas de conciliación).

Se agregó la sección "Detalle del resumen" con 5 subsecciones, todas
generadas por funciones nuevas puras (solo arman HTML a partir de datos
ya calculados, no vuelven a calcular nada):
- **A. Consumos** (`creditPreviewGroupedConsumptionsHtml`+
  `creditPreviewMovementTableHtml`): agrupados por tarjeta real
  (`cardLast4`) -- "TARJETA 8374 — GUIDO" / "TARJETA 4597 — JULIETA"
  cuando hay más de una tarjeta física en el mismo resumen, un único
  grupo "TARJETA NNNN" cuando es una sola. Columnas: Fecha, Tarjeta,
  Titular, Comercio/descripción, Cuota, Importe ARS, Importe USD,
  Clasificación, Estado de lectura. Nunca oculta movimientos en USD
  (columna dedicada, nunca se descartan); nunca transforma la
  descripción original del PDF (ninguna función de esta sección toca
  `descripcionOriginal`, solo la escapa para HTML).
- **B. Pagos**, **C. Devoluciones y créditos**, **D. Impuestos y
  cargos** (`creditPreviewSimpleTableHtml`, reutilizada 3 veces): fecha,
  descripción, importe ARS, importe USD, cada movimiento en su propia
  fila -- nunca agregados en un solo número.
- **E. Composición del saldo** (`creditPreviewCompositionHtml`): saldo
  anterior, menos pagos, menos devoluciones, más consumos, más impuestos
  y cargos, saldo final leído, diferencia de conciliación -- ARS y USD
  por separado. Reutiliza `fr.breakdown`/`fr.totals` ya calculados por
  `reconcileCreditStatementTotals()` (sin tocar esa fórmula); solo agrega
  de forma aditiva las sumas de pagos/devoluciones/cargos en USD que el
  breakdown original no traía para mostrar (nunca participa de la
  conciliación real, que ya cerró antes de llegar a esta función).

Estados de revisión corregidos (`creditPreviewStatusLabels()`, nueva):
ya no existe un único "Todo revisado" que aparecía solo porque no había
movimientos pendientes de clasificar. Ahora son 3 indicadores
independientes -- Lectura (`Lectura completa`/`Lectura incompleta`),
Conciliación (`Conciliado`/`Con diferencia`) y Revisión (`Listo para
revisión`/`Movimientos pendientes de clasificación`/`Requiere revisión`)
-- y "Listo para revisión — todos los consumos identificados" exige
explícitamente que existan movimientos, todos con fecha resuelta,
moneda e importe, y ninguno con categoría `unknown_review`.

### X. "Trazabilidad simulada" no era una consulta real

El texto anterior era estático, no ejecutaba ninguna consulta contra el
resumen anterior real. Se creó `loadPreviousCreditStatementTrace(cardId,
period)`, una función separada y claramente marcada que ejecuta
EXCLUSIVAMENTE un `SELECT` (`sb.from('credit_card_statements').select(...)
.eq('card_id',cardId).eq('statement_month',periodDate(shiftMonth(period,-1)))`)
contra el período inmediato anterior real de esa tarjeta -- nunca
inserta, actualiza, ni elimina nada, y `assertCreditWriteAllowed()`
nunca se llama dentro de ella porque nunca escribe. Permitida incluso en
modo de vista previa local por la propia autorización de esta tarea:
"en localhost se mantiene prohibida toda escritura; sin embargo, se
permiten consultas SELECT contra la base productiva, porque la interfaz
ya realiza lecturas reales para mostrar tarjetas y resúmenes"
(`loadGroups()`/`loadCreditCardsData()` ya lo hacían; esta consulta es la
misma categoría de operación, solo acotada a una tarjeta y un período
puntual).

`creditPreviewTraceEvaluation()` compara el saldo final REAL del
resumen anterior (columnas `total_ars`/`total_usd` de la fila
consultada) contra el saldo anterior que el PDF ACTUAL declara como
propio (`declaredPreviousBalanceArs`/`Usd`, ya extraído por el parser) --
nunca compara contra el mismo PDF, nunca inventa continuidad. Con
diferencia ≤ $0,01 ARS/USD: "CONTINUIDAD VERIFICADA". Si no: "DIFERENCIA
CON EL RESUMEN ANTERIOR". Sin resumen anterior encontrado: "NO SE
ENCONTRÓ EL RESUMEN ANTERIOR. LA CONTINUIDAD QUEDARÁ PENDIENTE HASTA
CARGARLO." -- nunca la palabra "simulada" cuando la consulta sí se
ejecutó de verdad.

### Y. Seguridad de la vista previa reconfirmada, no debilitada

Los 2 puntos anteriores se calculan (`buildPreviewMovementDetail`,
`creditPreviewStatusLabels`, `loadPreviousCreditStatementTrace`,
`creditPreviewTraceEvaluation`) ANTES del corte de `previewOnly` dentro
de `processCreditStatementFile()`, para que la vista previa muestre el
detalle completo y la trazabilidad real -- pero el corte de
`previewOnly` sigue exactamente en el mismo lugar que en la entrega
anterior, antes de `assertCreditWriteAllowed()` y de cualquier
`uploadCreditDocument()`/insert/update/delete/upload. Se agregó una
prueba automatizada (24-29 de la suite nueva) que corre el motor
completo en modo de vista previa local y falla si aparece cualquier
operación insert/update/delete/upload/remove en la bitácora del doble de
Supabase.

### Regresión y pruebas

**Suite nueva**
(`run_detalle_trazabilidad_preview_20260806_tests.js`): **63/63 OK** en
`index.html` e `index_operator.html` (31 casos pedidos × 2 archivos,
más una verificación de paridad), cubriendo detalle 5044 (1-8), detalle
8374 (9-17), trazabilidad (18-23) y seguridad (24-29).

**Regresión completa** (las 4 correcciones de Tarjetas de esta serie
nunca publicadas, más las suites preexistentes): 75/75, 67/67, 99/99,
83/83, 50/50 OK -- las 3 suites anteriores de Tarjetas necesitaron
ampliar su extracción de funciones (`buildPreviewMovementDetail`,
`creditPreviewStatusLabels`, `loadPreviousCreditStatementTrace`,
`creditPreviewTraceEvaluation`, `monthKey`, `shiftMonth`) y su doble de
Supabase (soporte de `SELECT` en `sb.from(tabla)`, antes solo tenía
`insert`/`update`/`delete`) porque el motor real ahora también ejecuta
una consulta de lectura antes del corte de vista previa. Único fallo
preexistente y no relacionado: `run_6b4_11_3_permisos_navegacion_tests.js`
58/59 (confirmado idéntico contra `origin/main` sin modificar, en una
sesión anterior).
