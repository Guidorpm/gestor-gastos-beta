# Auditoría — Cierre integral de trazabilidad de Tarjetas y pagos

**Fecha:** 2026-08-06
**Worktree:** `C:\Proyectos\gestor-gastos-beta-resumenes-trazabilidad-20260805`
**Base:** `origin/main` @ `90f736b`
**Continúa a:** [`AUDITORIA_RESUMENES_TRAZABILIDAD_20260805.md`](AUDITORIA_RESUMENES_TRAZABILIDAD_20260805.md) (secciones (1)-(4) de esta misma serie).

Quinta revisión externa de esta serie: titular contaminado por importes
en la vista previa, resumen "anterior" elegido por período en vez de
por cierre real, ausencia total de conciliación entre pagos registrados
por Guido y pagos reconocidos por el banco, y campos de importe de pago
que en algunos casos no aceptaban coma decimal.

---

## Parte C — Auditoría del circuito real de pagos (previa a modificar nada)

Investigación de código puro, sin tocar Supabase, antes de escribir
cualquier corrección.

**1. ¿Existe una tabla separada de pagos de Tarjetas?** No. Existe una
tabla `payments` (+ `payment_allocations`/`payment_contributions`) pero
pertenece al módulo no relacionado de Gestor de Servicios/obligaciones
compartidas. Un pago de tarjeta se guarda como una fila más de
`credit_card_movements` (`index.html:15337` antes de esta corrección,
línea desplazada por los cambios de esta sesión), distinguida solo por
`classification:'ajuste'` + metadata `{movementType:'payment',
source:'manual_payment'}`. No hay ningún `CREATE TABLE` de pagos de
tarjetas en `migraciones/*.sql`.

**2. Función que crea un pago:** `openCreditPaymentModal(statementId)`.
Inserta en `credit_card_movements` con `card_id`, `statement_id`,
`movement_date`, `currency`, `amount:-Math.abs(value)` (signo negativo
real), y metadata `{movementType:'payment', taxCode:'PAYMENT',
source:'manual_payment', appliesToCurrentStatement:true,
paymentMethod}`.

**3. Función que edita un pago:** `openCorrectCreditPaymentModal(movementId)`
— solo permitida si `meta.source==='manual_payment'`. Hace
`UPDATE` (nunca `DELETE`+`INSERT`), conserva moneda, agrega la
corrección a un array `corrections[]` dentro de la metadata (historial
completo, nunca se pierde qué cambió).

**4. Cálculo de deuda restante:** `creditPaymentModel(statement, items)`
usa `creditCurrentStatementPayments(items)` (suma `abs(amount)` de todo
movimiento con `creditMovementType==='payment'` para ese statement) y
resta del total del resumen: `remainingArs = max(0, totalArs - pagado)`.

**5. ¿Ya se relacionan con `credit_card_statements`?** Sí, cada pago
manual lleva `statement_id` desde que se crea — el mismo campo que usan
los movimientos parseados del PDF.

**6. ¿Riesgo de contarlo también como gasto?** Bajo/nulo. Los pagos
quedan con `classification:'ajuste'`/tipo `'payment'`, y
`creditMovementNeedsClassification` (que alimenta los conteos de
"consumos") solo devuelve `true` para tipo `'purchase'` — un pago nunca
entra en esa cuenta. No existe ningún camino de código que pliegue
`credit_card_movements` en un total general de "gastos" fuera del
módulo de Tarjetas.

**7. ¿Los pagos parciales se suman bien?** Sí — `reduce()` acumulativo
sobre todos los movimientos de tipo `'payment'` del statement.

**8. ¿Hay pagos en USD?** Sí, el modal ya tenía un selector de moneda
ARS/USD desde antes de esta corrección.

**9/10. Campos de importe y parseo real (la causa del bug de la coma):**

| Campo | Antes de esta corrección | Problema |
|---|---|---|
| `#creditPaymentAmount` (moneda ARS) | `data-money-input` → `bindMoneyInputs`/`parseMoneyField` | Funcionaba, pero `parseMoneyField` en sí tiene un bug latente: si el importe no trae coma (ej. "1250.50"), quita TODOS los puntos antes de mirar la coma y lo convierte en 125050 -- no se toca acá porque se usa en decenas de otros campos ajenos a pagos (fuera del alcance pedido). |
| `#creditPaymentAmount` (moneda USD) | `type="number"` + `Number(...replace(',','.'))` | `type="number"` bloquea escribir coma en varios navegadores/configuraciones regionales -- la causa real reportada por Guido. |
| `#correctPaymentAmount` (editar, ARS o USD) | `type="number"` + `Number(...)` directo | Mismo problema: `type="number"` bloquea la coma; además `Number()` sin ningún tratamiento de coma. |

Dos de los tres caminos de importe de pago (USD al crear, y corregir en
cualquier moneda) **nunca pasaban por `parseMoneyField`** — usaban
`Number()`/`type="number"` directo.

---

## Parte A — Titular contaminado por importes

**Causa exacta:** la línea ancla que separa secciones por titular en el
PDF (`Tarjeta NNNN Total Consumos de <NOMBRE> <IMPORTE>`) trae el
nombre y el importe total PEGADOS en la misma línea. El regex de
`creditPdfDetectSections` (`index.html:4790` antes de esta corrección)
capturaba con `(.+)` todo lo que sigue a "de " sin distinguir dónde
termina el nombre — de ahí "GUIDO NICOLAS RIZZO 335.281,37 + 115,63" en
vez de "GUIDO NICOLAS RIZZO".

**Corrección:** nueva función pura `cleanCreditCardHolderLabel(raw)`
que quita, desde el final del string, cualquier cantidad de tokens de
importe (dígitos con separador de miles/decimal argentino, signo +/-
y/o "$"/"USD" opcionales) hasta que no quede ninguno — nunca vacía el
nombre completo (si al quitar un token no sobrevive ninguna letra, no
se quita esa vez), nunca toca comercios ni importes de otros lugares
(solo se usa sobre `holderLabel`, dentro de `creditPdfDetectSections`).
Sin nombres hardcodeados: la función opera sobre cualquier texto.

---

## Parte B — Resumen inmediatamente anterior

**Causa exacta:** `loadPreviousCreditStatementTrace(cardId, period)`
(entrega anterior, 2026-08-06 (4)) elegía el "anterior" por
`shiftMonth(period,-1)` — es decir, por la ETIQUETA de período, nunca
por el `close_date` real. Un resumen cargado fuera de orden, o con un
`period` mal etiquetado, podía nunca coincidir o coincidir con el
resumen incorrecto.

**Corrección:** la función ahora recibe `(cardId, currentStatementId,
currentCloseDate, ownerId)`. Trae TODOS los statements de esa tarjeta
con un único `SELECT` (`sb.from('credit_card_statements').select(...).eq('card_id',cardId)`)
y filtra/ordena en JS: excluye el resumen actual, exige mismo
propietario (cuando se conoce), exige `close_date` ESTRICTAMENTE
anterior al cierre actual, ordena por `close_date` descendente (nunca
por `created_at`), elige el más cercano. Si el hueco entre el cierre
elegido y el actual supera `CREDIT_TRACE_MAX_CYCLE_GAP_DAYS` (45 días),
el estado es `'incomplete_gap'` y la interfaz muestra "TRAZABILIDAD
INCOMPLETA" con el detalle del hueco — nunca afirma continuidad en ese
caso. Sigue siendo un único `SELECT` de solo lectura.

---

## Parte D/E/F — Conciliación de pagos registrados vs. reconocidos por el banco

Nueva sección "Conciliación de pagos registrados" en la vista previa,
calculada con 5 funciones puras nuevas, todas de solo lectura:

- `registeredCreditPaymentsInWindow(cardId, previousCloseDate,
  currentCloseDate)`: filtra `creditMovements` (ya cargado en memoria,
  sin ninguna consulta nueva) por tarjeta + tipo `'payment'` + fecha
  dentro de (cierre anterior EXCLUSIVE, cierre actual INCLUSIVE].
- `bankRecognizedPaymentsFromPreview(movementDetail)`: filtra los
  movimientos ya parseados del PDF actual por
  `categoriaParserOriginal==='payment'`.
- `matchRegisteredVsBankPayments(registered, bank)`: empareja por
  misma moneda, mismo importe (tolerancia $0,01), fecha dentro de 3
  días. Más de un candidato con el mismo importe → ambiguo (nunca
  elige al azar). Nunca crea, modifica ni borra un pago; nunca vincula
  nada de forma definitiva durante la vista previa.
- `creditPaymentReconciliationSummary(...)`: totales separados ARS/USD,
  cantidad de pagos de cada lado, y el estado final (PAGOS
  CONCILIADOS / FALTAN PAGOS EN EL GESTOR / EL BANCO TODAVÍA NO
  RECONOCIÓ UNO O MÁS PAGOS / DIFERENCIA DE IMPORTE / COINCIDENCIA
  AMBIGUA / NO HAY PAGOS EN EL PERÍODO). El estado más específico (un
  solo lado con pendientes) siempre gana sobre el genérico "diferencia
  de importe".
- `buildCreditPaymentReconciliation(...)`: reúne todo, calculado ANTES
  del corte de `previewOnly` (mismo criterio que el detalle/trazabilidad
  de la entrega anterior).

RG (percepciones/devoluciones), impuestos, intereses y consumos nunca
se cuentan como pago — ya filtrados por `categoriaParserOriginal`/
`creditMovementType`, sin necesidad de lógica nueva.

---

## Parte G — Coma decimal en importes de pago

**Causa exacta:** confirmada en la Parte C — dos de los tres campos de
importe de pago usaban `type="number"` (bloquea la coma en varios
navegadores) y `Number()` sin tratamiento de separadores.

**Corrección:** nueva función central `parseLocalizedPaymentAmount(value,
{allowNegative=false})`, usada por los 3 caminos (crear ARS, crear USD,
corregir). Decide el separador decimal según cuál de "," o "." aparece
más a la derecha del texto — soporta `1250,50`, `1.250,50`, `1250.50`,
`1 250,50`, `1250`, sin invertir miles y decimales. Devuelve `null` si
está vacío (el llamador bloquea la confirmación), `NaN` si el texto no
es un importe válido (el llamador muestra un mensaje claro), o un
número redondeado a 2 decimales. Rechaza importes negativos salvo
`allowNegative:true` explícito (reservado para una futura función de
reversión, no usada todavía). Los 3 campos HTML pasan a
`type="text" inputmode="decimal" autocomplete="off"` — nunca
`type="number"`.

---

## Campos corregidos

- `#creditPaymentAmount` (`openCreditPaymentModal`) — ARS y USD, mismo
  campo unificado.
- `#correctPaymentAmount` (`openCorrectCreditPaymentModal`) — ARS y
  USD.

Ningún otro campo numérico de la app fue modificado (los money-input
generales del resto de Gestor de Servicios siguen con
`parseMoneyField`/`formatMoneyTyping`, sin cambios).

---

## Regresión y pruebas

**Suite nueva** (`run_trazabilidad_pagos_decimales_20260806_tests.js`):
**91/91 OK** en `index.html` e `index_operator.html`.

**Suite anterior actualizada** (`run_detalle_trazabilidad_preview_20260806_tests.js`,
Parte B/D-F obligaron a actualizar 2 pruebas de trazabilidad a la nueva
firma de `loadPreviousCreditStatementTrace`): **63/63 OK**.

**Regresión completa:**
- `run_cierre_definitivo_tarjetas_20260806_tests.js`: **75/75 OK**.
- `run_integracion_real_tarjetas_20260806_tests.js`: **67/67 OK**.
- `run_correccion_final_tarjetas_20260806_tests.js`: **99/99 OK**.
- `run_resumenes_trazabilidad_20260805_tests.js`: **83/83 OK**.
- `run_panel_pendientes_fabiana_20260805_tests.js`: **50/50 OK**.
- `run_6b4_11_3_permisos_navegacion_tests.js`: **58/59 OK** — la única
  falla es preexistente y no relacionada (confirmada idéntica contra
  `origin/main` sin modificar, en una sesión anterior).

Todas las suites anteriores necesitaron ampliar su extracción de
funciones (`registeredCreditPaymentsInWindow`,
`bankRecognizedPaymentsFromPreview`, `matchRegisteredVsBankPayments`,
`creditPaymentReconciliationSummary`, `buildCreditPaymentReconciliation`,
`creditMovementMeta`, `creditMovementType`, `creditStatementLabel`,
`cleanCreditCardHolderLabel`, y la constante `CREDIT_TRACE_MAX_CYCLE_GAP_DAYS`)
porque el motor real (`processCreditStatementFile`) ahora también
calcula la conciliación de pagos antes del corte de vista previa —
mismo patrón ya usado en toda la serie, nunca una reimplementación de
la lógica de negocio en los archivos de prueba.

`git diff --stat origin/main` acumulado de `index.html`/`index_operator.html`
(incluye las cinco correcciones de Tarjetas de esta serie, nunca
publicadas): **3488 inserciones / 520 eliminaciones**, idéntico en
ambos archivos — paridad exacta.

---

## Limitaciones

- El preflight de Supabase (`docs/PREFLIGHT_SUPABASE_TARJETAS_20260806.md`)
  sigue sin ejecutarse — pendiente de correr manualmente antes de
  publicar.
- La validación manual completa en navegador (abrir el modal de pago,
  tipear una coma, ver la nueva sección de conciliación con los PDF
  reales) no se ejecutó como parte de esta entrega automatizada; los
  escenarios equivalentes se verificaron con datos de prueba en la
  suite nueva.
- El bug latente de `parseMoneyField` con importes sin coma (ej.
  "1250.50" fuera de los campos de pago) queda documentado acá pero
  **no corregido**, porque el pedido explícitamente acota el alcance a
  "campos de pago" y pide no modificar otros campos numéricos.

---

## Actualización 2026-08-07 — Corrección final de trazabilidad de pagos
## MODELO DE DOBLE EVIDENCIA DEL PAGO

Sexta revisión de esta serie: prueba manual real sobre Visa 5044/julio
2026 mostró **10 "pagos registrados en el Gestor"** cuando el resultado
correcto es **6**. Los 4 movimientos de más traían la etiqueta
"Reconocido del resumen" y correspondían a fechas de junio.

### Modelo conceptual

Un mismo pago tiene dos evidencias posibles, y son el **mismo hecho
económico**, nunca dos movimientos financieros distintos:

1. **Registro interno**: Guido registra en el Gestor que realizó el
   pago (`openCreditPaymentModal`, `meta.source:'manual_payment'`) —
   esto es el **hecho financiero**: el pago existe y reduce la deuda
   desde el momento en que se registra.
2. **Reconocimiento bancario**: el resumen SIGUIENTE, al leerse,
   reconoce ese mismo pago como una línea de movimiento
   (`meta.source:'process_credit_statement_file'` o
   `'massive_historical_load'`, nunca `'manual_payment'`) — esto es la
   **evidencia bancaria** de que el banco efectivamente lo recibió y
   contabilizó. No es un pago nuevo, no debe descontar la deuda por
   segunda vez, no debe considerarse un movimiento financiero
   independiente.

Relación temporal: el pago se registra DESPUÉS del cierre del resumen
A (el que cancela) y ANTES o hasta el cierre del resumen B (el
siguiente); el banco recién lo reconoce documentalmente dentro de los
movimientos de B. Por eso: **aplicado_a = resumen A (anterior)**,
**reconocido_en = resumen B (actual)**.

### 1. Causa exacta del grupo de 10 pagos

`registeredCreditPaymentsInWindow()` (entrega anterior, 2026-08-06)
filtraba únicamente por `card_id` + `creditMovementType(m)==='payment'`
+ fecha dentro de la ventana — **nunca excluía por origen**. La única
diferencia entre un pago manual y uno reconocido desde un PDF era la
etiqueta de texto (`estado:'Registrado manualmente'` vs `'Reconocido
del resumen'`), no un filtro real. Así, cualquier movimiento de tipo
`'payment'` ya persistido — incluidos los que el PDF de **junio** había
reconocido como pagos al procesarse (evidencia bancaria de un ciclo YA
conciliado en su propia carga) — volvía a aparecer como si fuera un
"pago registrado por Guido" del ciclo de julio.

### 2. Campos usados para identificar pagos manuales

`creditMovementMeta(movement).source==='manual_payment'` — el único
valor que escribe `openCreditPaymentModal()` (línea de metadata
`{movementType:'payment', source:'manual_payment', ...}`). Es el único
discriminador confiable: ni `classification` ni `creditMovementType`
por sí solos distinguen origen (ambos caminos pueden clasificar como
`'payment'`).

### 3. Campos usados para identificar reconocimientos bancarios

`creditMovementMeta(movement).source` con valor
`'process_credit_statement_file'` (motor único de carga directa/
histórica) o `'massive_historical_load'` (camino de reparación masiva
más antiguo) — confirmado por lectura directa de los dos únicos
`buildCreditMovementNotes(...)` que insertan movimientos parseados de
un PDF (nunca `'manual_payment'` en ninguno de los dos).

### 4. ¿Ambos afectan la deuda actualmente?

No de la misma forma — y esto ya era así ANTES de esta corrección, sin
cambios: `creditCurrentStatementPayments(items)` (la función real que
alimenta `creditPaymentModel`, el cálculo de "saldo restante") solo
suma un movimiento de tipo `'payment'` si
`meta.appliesToCurrentStatement===true || meta.source==='manual_payment'`
— y **solo** `openCreditPaymentModal()` escribe
`appliesToCurrentStatement:true`. Un pago reconocido desde un PDF
(sin ese flag, sin `source:'manual_payment'`) **nunca** se suma en
`creditCurrentStatementPayments`, así que **nunca** vuelve a descontar
la deuda de ningún resumen. Este invariante se reconfirmó con una
prueba explícita (nueva, 15-17): deuda 1000, pago usuario 400,
reconocimiento banco 400 → resultado 600, nunca 200.

### 5. Cómo se evita el doble descuento

Estructuralmente, por diseño ya existente (no modificado): la deuda de
un resumen se calcula como `total del PDF (ya neto de lo que el banco
ya descontó) − pagos con appliesToCurrentStatement/manual_payment`. El
reconocimiento bancario es solo informativo/evidencia para la
conciliación de esta entrega — nunca entra en esa resta. La corrección
de esta entrega (filtrar `registeredCreditPaymentsInWindow` por
`source==='manual_payment'`) es **adicional**: antes solo afectaba qué
se MOSTRABA en "pagos registrados en el Gestor" (un problema de
presentación de la vista previa), no el cálculo real de deuda (que ya
era correcto). El bug reportado era, entonces, exclusivamente de la
nueva vista de conciliación — nunca afectó el saldo restante real
mostrado en el resto de la app.

### 6. Ventana de fechas — segunda causa reforzada

Adicionalmente se endureció el límite inferior de la ventana: si no
hay un resumen anterior determinado (`previousCloseDate` nulo),
`registeredCreditPaymentsInWindow` YA NO deja la ventana sin cota
inferior (lo que arrastraría todo el historial) — usa como respaldo
acotado `currentCloseDate − CREDIT_TRACE_MAX_CYCLE_GAP_DAYS` (45 días),
la misma constante ya usada para "TRAZABILIDAD INCOMPLETA".

### Corrección aplicada

- `registeredCreditPaymentsInWindow()`: agrega
  `.filter(m=>creditMovementMeta(m).source==='manual_payment')`; límite
  inferior de ventana nunca queda sin cota.
- `buildPaymentMatchRows()` (nueva): arma las filas de conciliación 1 a
  1 — un match nunca se muestra dos veces (una fila por hecho
  económico), con columnas Aplicado al resumen / Reconocido en resumen
  / Estado (`CONCILIADO` / `PENDIENTE DE RECONOCIMIENTO BANCARIO` /
  `PAGO BANCARIO SIN REGISTRO INTERNO` / `COINCIDENCIA AMBIGUA —
  REQUIERE REVISIÓN`).
- `buildCreditPaymentReconciliation()`: ahora también recibe el período
  actual (para el rótulo "Reconocido en resumen actual") y solo toma
  `previousStatement` de una trazabilidad `'found'` o `'incomplete_gap'`
  (nunca de `'not_found'`/`'ambiguous'`).
- `creditPaymentReconciliationHtml()`: agrega el saldo final del
  resumen anterior y la nueva tabla de conciliación 1 a 1 como sección
  principal (C), manteniendo A (pagos del usuario) y B (reconocidos por
  el banco) como detalle.

Ninguna de las funciones de `matchRegisteredVsBankPayments`,
`creditPaymentReconciliationSummary`, el parser, ni las fórmulas de
conciliación contable del PDF (`reconcileCreditStatementTotals` y
relacionadas) se modificaron.

### Resultado real 5044 (fixture de prueba con los montos exactos reportados)

- 6 pagos registrados (ARS: 500.000 × 3, 280.000, 2.062,79; USD: 120,79).
- 6 pagos reconocidos por el banco (mismos importes).
- 6 de 6 matches, 0 ambiguos, 0 sin match.
- Total registrado ARS 1.782.062,79 = Total banco ARS 1.782.062,79 → diferencia 0,00.
- Total registrado USD 120,79 = Total banco USD 120,79 → diferencia 0,00.
- Estado: PAGOS CONCILIADOS.
- Los 4 movimientos de junio quedan correctamente excluidos de "pagos registrados por el usuario".

### Resultado real 8374

Mismo modelo aplicado exactamente igual (mismas funciones, sin lógica
separada por tarjeta) — verificado estructuralmente por las pruebas de
paridad y por reutilizar sin duplicar el mismo motor que 5044.

### Pruebas y regresión

**Suite nueva** (`run_doble_evidencia_pagos_20260807_tests.js`):
**81/81 OK** en `index.html` e `index_operator.html` — cubre los 40
casos pedidos (identidad de origen 1-2, caso real 5044 3-14, deuda
15-17, parciales/USD 18-19, RG/impuestos/devoluciones 20-23, ventana
por close_date 24-25, tolerancia de fecha y ambigüedad 26-27, casos sin
match 28-29, seguridad 30-32, regresión 33-39, paridad 40).

**Regresión completa:** `run_trazabilidad_pagos_decimales_20260806_tests.js`
91/91, `run_detalle_trazabilidad_preview_20260806_tests.js` 63/63,
`run_cierre_definitivo_tarjetas_20260806_tests.js` 75/75,
`run_integracion_real_tarjetas_20260806_tests.js` 67/67,
`run_correccion_final_tarjetas_20260806_tests.js` 99/99,
`run_resumenes_trazabilidad_20260805_tests.js` 83/83,
`run_panel_pendientes_fabiana_20260805_tests.js` 50/50 — todas sin
fallas. `run_6b4_11_3_permisos_navegacion_tests.js` 58/59, la única
falla preexistente y no relacionada de siempre. Las 4 suites anteriores
de Tarjetas necesitaron ampliar su extracción con `buildPaymentMatchRows`
(nueva función que `buildCreditPaymentReconciliation` ahora invoca).

Todas las pruebas usan un doble local completo de Supabase — nunca se
conectan al Supabase real. No se subieron PDF reales, no se cargaron
datos reales.
