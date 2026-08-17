// ============================================================
// PRUEBA LOCAL — Vista Operativa de Servicios de un solo mes
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta prueba NO abre un navegador real y NO puede
// medir layout/scroll real (Node no tiene DOM/CSS). Lo que SÍ hace, de
// forma reproducible y sin Supabase:
//
//   1) EXTRAE y EJECUTA (no reimplementa) el código real de
//      operationalServiceRowHtml/operationalServicesListHtml
//      directamente de index.html, junto con TODAS las funciones reales
//      de las que dependen (obligationFor/dueState/boxText/boxClass/
//      paymentProgress/emptyBoxText/frequencyLabel/serviceStartLabel/
//      receiptsForObligation/esc/isOwner/fmtDate/monthLabel/fmtMoney/
//      formatObligationAmount/etc.) -- así la prueba examina la MISMA
//      lógica de estado que ya usa la matriz, nunca una copia que
//      podría divergir.
//
//   2) Mockea SOLO el borde de acceso a datos que no es razonable
//      re-derivar acá: paidAmountFor(obligationId) y
//      consolidationTarget(id) -- el mismo borde ya mockeado en
//      run_panel_prioridades_servicios_tests.js, por el mismo motivo.
//
//   3) Para varios casos, en vez de comparar contra un texto esperado
//      escrito a mano, compara el HTML que produce
//      operationalServiceRowHtml() contra el resultado de llamar
//      DIRECTAMENTE a boxText()/boxClass()/obligationFor() con los
//      mismos datos -- prueba "no duplica la lógica", no "el texto es
//      tal cosa", que es justamente el requisito de esta mejora.
//
//   4) Hace verificaciones ESTRUCTURALES (texto) sobre las partes que
//      dependen de DOM/render completo: existencia de la Vista
//      Operativa como vista por defecto en renderServices(), el
//      toggle hacia/desde la matriz anual, la integración con
//      goToServiceRow()/el buscador/el panel de prioridades, y que
//      Tarjetas/navegación (restoreNavigationScroll/
//      scrollMatrixToBaseMonth/data-base-month) no fueron modificados.
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBA MANUAL" en el reporte de entrega):
//   - que la Vista Operativa se ve/posiciona correctamente en pantalla;
//   - que efectivamente NO aparece una barra de scroll horizontal/vertical
//     interna en un navegador real;
//   - que goToServiceRow() efectivamente scrollea a la fila en pantalla.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexPath = path.join(ROOT, 'index.html');
const operatorPath = path.join(ROOT, 'index_operator.html');
const indexText = fs.readFileSync(indexPath, 'utf8');
const operatorText = fs.readFileSync(operatorPath, 'utf8');

const BACKUP_DIR = path.join(ROOT, 'respaldos_publicacion', 'antes_vista_operativa_20260814_212947');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Extracción de las funciones reales (index.html) ----------------

const fnFmtDateEsc = extract(indexText, 'function fmtDate(v){', 'function today(){');
const fnToday = extract(indexText, 'function today(){', 'function daysUntil(');
const fnDaysUntil = extract(indexText, 'function daysUntil(v){', 'function rolePriority(');
const fnIsOwner = extract(indexText, 'function isOwner(){', '\n');
const lnMonths = extract(indexText, 'const MONTHS=[', '\n');
const fnMonthLabelFmtMoney = extract(indexText, 'function monthLabel(key){', 'function parseMoneyField(');
const fnPeriodDate = extract(indexText, 'function periodDate(key){', '\n');
const fnObligationFor = extract(indexText, 'function obligationFor(serviceId,key){', '\n');
const blockObligationMeta = extract(indexText, 'const OBLIGATION_META_PREFIX=', 'async function annulObligationMonth(');
const blockFmtUsdFormatUsd = extract(indexText, 'function fmtUsd(value){', 'function parseArgentineNumber(');
const blockPaymentProgress = extract(indexText, 'function paymentProgress(obligation){', '// CORRECCIÓN 6B4.15 - Metadata técnica');
const blockFreqPlanEmptyPaymentsFor = extract(indexText, 'function frequencyLabel(service){', 'function paymentFor(');
const blockDueState = extract(indexText, 'function dueState(o){', 'function boxClass(o)');
const fnBoxClass = extract(indexText, 'function boxClass(o){', '\n');
const blockBoxText = extract(indexText, 'function boxText(o,service){', 'function lastKnownAmount(');
const blockReceiptsForObligation = extract(indexText, 'function receiptsForObligation(obligationId){', 'async function syncObligationStatus(');
const lnPriorityOrder = extract(indexText, 'const PRIORITY_CATEGORY_ORDER=[', '\n');
const blockOperational = extract(indexText, 'function operationalServiceRowHtml(s,key){', 'function renderServices(ms){');
// AJUSTE — MEJORA "SEGUNDO VENCIMIENTO + PAGOS PARCIALES/EXCEDENTES":
// operationalServiceRowHtml() ahora también llama a previousBalanceFor()
// (saldo anterior, puramente informativo) -- esta extracción NO estaba en
// el bundle original porque esa función todavía no existía cuando este
// test se escribió. No es un cambio de comportamiento del resto de la
// Vista Operativa: se agrega la cadena real de la que depende
// previousBalanceFor() (balanceFor/calculateRealObligationBalance/
// paidAmountForWithAllocations/isEffectivePending/consolidationForSource),
// nunca una copia. Los casos de esta mejora específica tienen su propia
// suite dedicada: pruebas/run_segundo_vencimiento_pagos_tests.js.
// Nota: NO se incluye la función corta paidAmountFor() ni creditBalanceFor()
// a propósito -- este archivo ya mockea paidAmountFor()/consolidationTarget()
// como bordes documentados (ver arriba) para no depender de payments/
// paymentAllocations/consolidations reales en el resto de los casos.
// balanceFor() (para previousBalanceFor) llama a
// calculateRealObligationBalance()->paidAmountForWithAllocations(), NUNCA
// a la función corta paidAmountFor() -- así que puede incluirse sin pisar
// ese mock.
const blockPaidAmountForAllocations = extract(indexText, 'function paidAmountForWithAllocations(obligationId,paymentsList,allocationsList){', 'function isServiceVisibleForCurrentContext(');
const blockBalanceOnly = extract(indexText, 'function balanceFor(obligation){', '// CORRECCIÓN 6B4.15 - Un importe corregido a la baja');
const blockConsolidationAndPreviousBalance = extract(indexText, 'function consolidationForSource(', 'function dueState(o){');

const REAL_SOURCE = [
  fnFmtDateEsc, fnToday, fnDaysUntil, fnIsOwner, lnMonths, fnMonthLabelFmtMoney,
  fnPeriodDate, fnObligationFor, blockObligationMeta, blockFmtUsdFormatUsd,
  blockPaidAmountForAllocations, blockBalanceOnly,
  blockPaymentProgress, blockFreqPlanEmptyPaymentsFor,
  blockConsolidationAndPreviousBalance, blockDueState, fnBoxClass,
  blockBoxText, blockReceiptsForObligation, lnPriorityOrder, blockOperational,
].join('\n');

// ---------------- Sandbox: Date fijo + mocks mínimos y documentados ----------------

function FixedDateFactory(fixedIso) {
  const fixedMs = new Date(fixedIso).getTime();
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) { super(fixedMs); return; }
      super(...args);
    }
    static now() { return fixedMs; }
  };
}

function buildSandbox({ now, obligations, services, documents, payments, paymentAllocations, consolidations, members, group, session, baseMonth, consolidationTargetsById, paidById, allocationsLoadError }) {
  const sandbox = {
    Date: FixedDateFactory(now || '2026-08-15T00:00:00'),
    obligations: obligations || [],
    services: services || [],
    documents: documents || [],
    payments: payments || [],
    // Usados por balanceFor()/consolidationForSource() -- dependencias
    // reales de previousBalanceFor(), independientes de los mocks
    // paidAmountFor()/consolidationTarget() de abajo.
    paymentAllocations: paymentAllocations || [],
    consolidations: consolidations || [],
    members: members || [],
    group: group === undefined ? { id: 'g1', created_by: 'owner-uid' } : group,
    session: session === undefined ? { user: { id: 'owner-uid' } } : session,
    baseMonth: baseMonth || '2026-08',
    paymentAllocationsLoadError: !!allocationsLoadError,
    // MOCK documentado (ver AVISO al inicio del archivo): en producción
    // depende de `consolidations` -- acá, una tabla fija id->target.
    consolidationTarget: (id) => (consolidationTargetsById && consolidationTargetsById[id]) || null,
    // MOCK documentado: en producción depende de paymentAllocations vía
    // paidAmountForWithAllocations -- acá, una tabla fija id->monto pagado.
    paidAmountFor: (obligationId) => (paidById && paidById[obligationId]) || 0,
    console,
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { operationalServiceRowHtml, operationalServicesListHtml, boxText, boxClass, obligationFor, dueState, PRIORITY_CATEGORY_ORDER };');
  return fn(...Object.values(sandbox));
}

// ---------------- Fixtures ----------------
const KEY = '2026-08';
function svc(id, overrides = {}) {
  return { id, name: id, category: 'General', frequency: 'monthly', is_private: false, ...overrides };
}
function ob(id, serviceId, overrides = {}) {
  return { id, service_id: serviceId, period: '2026-08-01', amount: 1000, status: 'active', due_date: null, ...overrides };
}
function buckets(partial) {
  return { vencidos: [], proximos: [], sin_datos: [], pendientes: [], abonados: [], ...partial };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ---------------- 1: Vista Operativa existe y es la vista por defecto ----------------

caso('CASO 1 — Vista Operativa es la vista por defecto en renderServices()', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("function isValidServicesView(value){"));
    assert.ok(text.includes("return value==='operational'||value==='matrix';"));
    assert.ok(text.includes("return isValidServicesView(saved)?saved:'operational';"), 'el valor por defecto de servicesView debe ser "operational"');
  }
});

caso('CASO 2 — renderServices() alterna entre operationalServicesListHtml y la matriz según servicesView', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, "${servicesView==='matrix'?`", 'operationalServicesListHtml(priorityBuckets)}') + 'operationalServicesListHtml(priorityBuckets)}';
    assert.ok(block.includes('class="matrix card"'), 'la rama "matrix" debe seguir renderizando la matriz anual completa');
    assert.ok(block.trim().endsWith('`:operationalServicesListHtml(priorityBuckets)}'), 'la rama por defecto debe ser la Vista Operativa, reusando priorityBuckets ya calculado');
  }
});

// ---------------- 2: usa exclusivamente baseMonth ----------------

caso('CASO 3 — operationalServicesListHtml usa baseMonth (no un mes propio/nuevo)', () => {
  assert.ok(blockOperational.includes('operationalServiceRowHtml(s,baseMonth)'), 'debe llamarse siempre con baseMonth, el mismo mes que la matriz/el panel/el buscador');
  assert.ok(!/operationalServiceRowHtml\(s,\s*['"]2026-08['"]\)/.test(indexText), 'no debe haber ningún mes hardcodeado');
});

caso('CASO 4 — no se agregó ningún selector de mes nuevo (prev/next siguen siendo los únicos controles de mes)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('id="prevMonth"') && text.includes('id="nextMonth"'), 'los controles de mes existentes deben seguir presentes sin cambios');
    assert.ok(!blockOperational.includes('id="prevMonth"') && !blockOperational.includes('id="nextMonth"'), 'la Vista Operativa no debe introducir sus propios controles de mes');
  }
});

// ---------------- 3/4: sin scroll horizontal ni contenedor vertical interno ----------------

caso('CASO 5 — el CSS de la Vista Operativa no introduce overflow-x (no requiere scroll horizontal)', () => {
  const css = extract(indexText, '.operational-list{', '.operational-switch{margin:14px 0;text-align:center}') + '.operational-switch{margin:14px 0;text-align:center}';
  assert.ok(!/overflow-x/.test(css), 'ningún selector .operational-* debe declarar overflow-x');
});

caso('CASO 6 — el CSS de la Vista Operativa no introduce un contenedor de scroll vertical propio', () => {
  const css = extract(indexText, '.operational-list{', '.operational-switch{margin:14px 0;text-align:center}') + '.operational-switch{margin:14px 0;text-align:center}';
  assert.ok(!/overflow-y\s*:\s*auto/.test(css), 'no debe haber overflow-y:auto en ningún selector .operational-*');
  assert.ok(!/max-height/.test(css), 'no debe haber una altura fija tipo max-height en ningún selector .operational-*');
});

caso('CASO 7 — operationalServicesListHtml no reutiliza la clase matrix-scroll (sin la doble caja de la matriz)', () => {
  assert.ok(!blockOperational.includes('matrix-scroll'), 'la Vista Operativa no debe envolver la lista en .matrix-scroll');
});

// ---------------- 5-11: servicios que aparecen, orden por categoría, orden alfabético ----------------

caso('CASO 8 — todos los servicios relevantes aparecen, cada uno exactamente una vez', () => {
  const s1 = svc('s1', { name: 'Edesur' }), s2 = svc('s2', { name: 'Metrogas' }), s3 = svc('s3', { name: 'Movistar' });
  const b = buckets({ vencidos: [s1], proximos: [s2], pendientes: [s3] });
  const { operationalServicesListHtml } = buildSandbox({});
  const html = operationalServicesListHtml(b);
  for (const s of [s1, s2, s3]) {
    const count = html.split(`data-service-row="${s.id}"`).length - 1;
    assert.strictEqual(count, 1, `${s.id} debe aparecer exactamente una vez`);
  }
});

caso('CASO 9 — orden de categorías: Vencidos -> Próximos -> Sin datos -> Pendientes -> Abonados', () => {
  const sV = svc('sV', { name: 'Servicio Vencido' });
  const sP = svc('sP', { name: 'Servicio Proximo' });
  const sS = svc('sS', { name: 'Servicio SinDatos' });
  const sD = svc('sD', { name: 'Servicio Pendiente' });
  const sA = svc('sA', { name: 'Servicio Abonado' });
  const b = buckets({ vencidos: [sV], proximos: [sP], sin_datos: [sS], pendientes: [sD], abonados: [sA] });
  const { operationalServicesListHtml } = buildSandbox({});
  const html = operationalServicesListHtml(b);
  const positions = [sV, sP, sS, sD, sA].map(s => html.indexOf(`data-service-row="${s.id}"`));
  assert.ok(positions.every(p => p !== -1), 'los 5 servicios deben estar presentes');
  for (let i = 0; i < positions.length - 1; i++) {
    assert.ok(positions[i] < positions[i + 1], `la categoría en la posición ${i} debe aparecer antes que la siguiente`);
  }
});

caso('CASO 10 — dentro de cada categoría, los servicios se ordenan alfabéticamente', () => {
  const sZ = svc('sZ', { name: 'Zeta' }), sA = svc('sA', { name: 'Alfa' }), sM = svc('sM', { name: 'Medio' });
  const b = buckets({ pendientes: [sZ, sA, sM] });
  const { operationalServicesListHtml } = buildSandbox({});
  const html = operationalServicesListHtml(b);
  const positions = [sA, sM, sZ].map(s => html.indexOf(`data-service-row="${s.id}"`));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'el orden dentro de la categoría debe ser alfabético (localeCompare es-AR), no el orden de llegada');
});

caso('CASO 11 — lista vacía (ningún servicio corresponde este mes) muestra el mensaje operational-empty, no un error', () => {
  const { operationalServicesListHtml } = buildSandbox({});
  const html = operationalServicesListHtml(buckets({}));
  assert.ok(html.includes('operational-empty'), 'sin servicios este mes debe mostrarse un mensaje claro, no una lista vacía silenciosa');
  assert.ok(html.includes('Todavía no hay servicios para este mes.'));
});

// ---------------- 12-16: estado/importe reutiliza EXACTAMENTE la lógica existente ----------------

caso('CASO 12 — el estado mostrado en la fila es EXACTAMENTE el que produce boxText() para la misma obligación (no un cálculo paralelo)', () => {
  const s1 = svc('s1', { name: 'Edesur' });
  const o1 = ob('o1', 's1', { due_date: '2026-08-20', amount: 1500 });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  const html = sandbox.operationalServiceRowHtml(s1, KEY);
  const [status, amount] = sandbox.boxText(sandbox.obligationFor('s1', KEY), s1);
  assert.ok(html.includes(`<div class="status">${status}</div>`), 'el texto de estado debe coincidir carácter a carácter con boxText()[0]');
  assert.ok(html.includes(`<div class="amount">${amount}</div>`), 'el texto de importe debe coincidir carácter a carácter con boxText()[1]');
});

caso('CASO 13 — la clase CSS de la fila es EXACTAMENTE boxClass() (mismas bandas de vencimiento que la matriz)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-10', amount: 1000 }); // vencido
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  const html = sandbox.operationalServiceRowHtml(s1, KEY);
  const cls = sandbox.boxClass(sandbox.obligationFor('s1', KEY));
  assert.ok(html.includes(`class="operational-row ${cls}"`), 'la fila debe llevar la MISMA clase de estado que colorea la celda de la matriz');
  assert.strictEqual(cls, 'overdue');
});

caso('CASO 14 — servicio sin obligación este mes ("sin datos") usa emptyBoxText, sin fecha de vencimiento', () => {
  const s1 = svc('s1', { name: 'Sin Cargar' });
  const sandbox = buildSandbox({ obligations: [], services: [s1] });
  const html = sandbox.operationalServiceRowHtml(s1, KEY);
  assert.ok(html.includes('Sin datos'));
  assert.ok(!html.includes('<div class="date">'), 'sin obligación no debe mostrarse ninguna fecha de vencimiento');
});

caso('CASO 15 — la fecha de vencimiento se muestra solo si la obligación tiene due_date', () => {
  const s1 = svc('s1'), s2 = svc('s2');
  const o1 = ob('o1', 's1', { due_date: '2026-08-25' });
  const o2 = ob('o2', 's2', { due_date: null });
  const sandbox = buildSandbox({ obligations: [o1, o2], services: [s1, s2] });
  assert.ok(sandbox.operationalServiceRowHtml(s1, KEY).includes('<div class="date">Vence'));
  assert.ok(!sandbox.operationalServiceRowHtml(s2, KEY).includes('<div class="date">Vence'));
});

caso('CASO 16 — un servicio abonado se identifica con la MISMA lógica que "Abonado" en la matriz', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-05', amount: 1000, status: 'paid' });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  const cls = sandbox.boxClass(sandbox.obligationFor('s1', KEY));
  assert.strictEqual(cls, 'paid');
  assert.ok(sandbox.operationalServiceRowHtml(s1, KEY).includes('class="operational-row paid"'));
});

// ---------------- 17-19: indicadores de documentos ----------------

caso('CASO 17 — indicador de Factura refleja documents reales (kind=invoice ligado a la obligación)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1');
  const docs = [{ id: 'd1', obligation_id: 'o1', kind: 'invoice' }];
  const sandboxConDoc = buildSandbox({ obligations: [o1], services: [s1], documents: docs });
  const sandboxSinDoc = buildSandbox({ obligations: [o1], services: [s1], documents: [] });
  assert.ok(sandboxConDoc.operationalServiceRowHtml(s1, KEY).includes('Factura ✓'));
  assert.ok(sandboxSinDoc.operationalServiceRowHtml(s1, KEY).includes('Factura —'));
});

caso('CASO 18 — indicador de Comprobante reutiliza receiptsForObligation() real (vía payments+documents)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1');
  const p1 = { id: 'p1', obligation_id: 'o1', paid_at: '2026-08-06' };
  const docs = [{ id: 'd2', payment_id: 'p1', kind: 'receipt' }];
  const sandboxConComprobante = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], documents: docs });
  const sandboxSinComprobante = buildSandbox({ obligations: [o1], services: [s1], payments: [], documents: [] });
  assert.ok(sandboxConComprobante.operationalServiceRowHtml(s1, KEY).includes('Comprobante ✓'));
  assert.ok(sandboxSinComprobante.operationalServiceRowHtml(s1, KEY).includes('Comprobante —'));
});

caso('CASO 19 — sin obligación este mes, no se muestran indicadores de documentos (no hay nada que indicar todavía)', () => {
  const s1 = svc('s1');
  const sandbox = buildSandbox({ obligations: [], services: [s1] });
  assert.ok(!sandbox.operationalServiceRowHtml(s1, KEY).includes('doc-indicators'));
});

// ---------------- 20-22: acciones existentes preservadas, sin duplicar el mecanismo de la matriz ----------------

caso('CASO 20 — data-cell usa el MISMO formato "serviceId|key" que ya usa la matriz -> abre el mismo modal openObligation() sin cambios', () => {
  assert.ok(blockOperational.includes('data-cell="${s.id}|${key}"'), 'la Vista Operativa debe usar el formato "id|periodo"');
  assert.ok(indexText.includes('data-cell="${s.id}|${m}"'), 'confirma que el formato de data-cell de la matriz también es "id|periodo"');
  assert.ok(indexText.includes("document.querySelectorAll('[data-cell]').forEach(e=>e.onclick=()=>{const [s,m]=e.dataset.cell.split('|');openObligation(s,m)});"), 'el binder de data-cell (compartido por matriz y Vista Operativa) no debe haber cambiado');
});

caso('CASO 21 — el botón "Abrir" (data-folder) es HERMANO del área clickeable, no descendiente (evita que el clic dispare también el modal)', () => {
  const html = buildSandbox({ obligations: [ob('o1', 's1')], services: [svc('s1')] }).operationalServiceRowHtml(svc('s1'), KEY);
  const actionsOpen = html.indexOf('<div class="operational-row-actions">');
  const folderPos = html.indexOf('data-folder=');
  assert.ok(actionsOpen !== -1 && folderPos > actionsOpen, 'data-folder debe estar dentro de .operational-row-actions');
  assert.ok(html.indexOf('operational-row-info') < actionsOpen, 'operational-row-actions (con el botón Abrir) debe abrir DESPUÉS de que operational-row-info ya cerró -- hermano, no descendiente');
});

caso('CASO 22 — todas las acciones existentes siguen disponibles: el binder de data-folder (Abrir) no cambió', () => {
  assert.ok(blockOperational.includes('data-folder="${s.id}"'));
  assert.ok(indexText.includes("document.querySelectorAll('[data-folder]').forEach(e=>e.onclick=()=>openFolder(e.dataset.folder));"), 'el binder de data-folder no debe haber cambiado -- factura/comprobante/pago siguen accesibles vía openFolder(), sin reducir funcionalidad');
});

// ---------------- 23-25: integración con buscador y panel de prioridades ----------------

caso('CASO 23 — data-service-row permite que goToServiceRow() (el buscador) localice la fila en Vista Operativa sin cambios', () => {
  assert.ok(blockOperational.includes('data-service-row="${s.id}"'));
  for (const text of [indexText, operatorText]) {
    const fnGoTo = extract(text, 'function goToServiceRow(serviceId){', 'function servicePriorityCategory(');
    assert.ok(fnGoTo.includes("document.querySelector(`[data-service-row=\"${serviceId}\"]`)"), 'goToServiceRow debe seguir usando el selector genérico, válido tanto para <tr> de la matriz como para el <div> de la Vista Operativa');
    assert.ok(fnGoTo.includes("row.querySelector('.service-cell')||row"), 'el fallback a la propia fila (sin .service-cell) es lo que hace que funcione también en la Vista Operativa, sin necesitar ningún cambio');
  }
});

caso('CASO 24 — el panel de prioridades sigue apuntando a goToServiceRow() (no quedó atado solo a la matriz)', () => {
  for (const text of [indexText, operatorText]) {
    const fnToggle = extract(text, 'function togglePriorityPanelList(card){', 'function openServiceModal(');
    assert.ok(/goToServiceRow/.test(fnToggle), 'el panel debe seguir navegando con goToServiceRow(), funcional en ambas vistas');
  }
});

caso('CASO 25 — el buscador (serviceSearchResultHtml) sigue reutilizando boxText/obligationFor sin cambios por esta mejora', () => {
  for (const text of [indexText, operatorText]) {
    const fnSearch = extract(text, 'function serviceSearchResultHtml(s){', 'function closeServiceSearchResults(');
    assert.ok(fnSearch.includes('obligationFor(s.id,baseMonth)') && fnSearch.includes('boxText(o,s)[0]'));
  }
});

// ---------------- 26: matriz anual sigue disponible, el toggle no muta datos ----------------

caso('CASO 26 — el toggle hacia la matriz anual (showMatrixView) y de vuelta (showOperationalView) solo cambia servicesView + re-renderiza', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("document.getElementById('showMatrixView').onclick=()=>{servicesView='matrix';renderApp()};"));
    assert.ok(text.includes("document.getElementById('showOperationalView').onclick=()=>{servicesView='operational';renderApp()};"));
  }
});

// ---------------- 27: privacidad -- PRIVADO solo visible para el titular ----------------

caso('CASO 27 — el indicador PRIVADO en Vista Operativa depende de isOwner(), igual que en la matriz (Fabiana no lo ve)', () => {
  const s1 = svc('s1', { is_private: true, name: 'Cuenta privada' });
  const o1 = ob('o1', 's1');
  const sandboxTitular = buildSandbox({ obligations: [o1], services: [s1], group: { id: 'g1', created_by: 'owner-uid' }, session: { user: { id: 'owner-uid' } } });
  const sandboxOperador = buildSandbox({ obligations: [o1], services: [s1], group: { id: 'g1', created_by: 'owner-uid' }, session: { user: { id: 'operator-uid' } } });
  assert.ok(sandboxTitular.operationalServiceRowHtml(s1, KEY).includes('private-service-badge'));
  assert.ok(!sandboxOperador.operationalServiceRowHtml(s1, KEY).includes('private-service-badge'));
});

// ---------------- 28: sin consultas nuevas a Supabase, sin SQL ----------------

caso('CASO 28 — operationalServiceRowHtml/operationalServicesListHtml no agregan ninguna consulta nueva a Supabase', () => {
  assert.ok(!/\bsb\.from\(|\bsb\.rpc\(|\bfetch\(/i.test(blockOperational), 'deben operar 100% sobre datos ya cargados en memoria (services/obligations/documents/payments), igual que la matriz');
});

caso('CASO 29 — no se agregó ni modificó ningún archivo .sql para esta mejora', () => {
  const archivosDeEstaTarea = [indexPath, operatorPath, __filename];
  for (const archivo of archivosDeEstaTarea) assert.ok(!archivo.includes('migraciones'), `${archivo} no debería estar dentro de migraciones/`);
});

// ---------------- 30-31: paridad index.html / index_operator.html ----------------

caso('CASO 30 — operationalServiceRowHtml/operationalServicesListHtml son byte-idénticos entre index.html e index_operator.html', () => {
  const blockA = extract(indexText, 'function operationalServiceRowHtml(s,key){', 'function renderServices(ms){');
  const blockB = extract(operatorText, 'function operationalServiceRowHtml(s,key){', 'function renderServices(ms){');
  assert.strictEqual(blockA, blockB);
});

caso('CASO 31 — el wrap condicional matrix/operational en renderServices() y el wiring del toggle son byte-idénticos entre ambos archivos', () => {
  const wrapA = extract(indexText, "${servicesView==='matrix'?`", 'operationalServicesListHtml(priorityBuckets)}') + 'operationalServicesListHtml(priorityBuckets)}';
  const wrapB = extract(operatorText, "${servicesView==='matrix'?`", 'operationalServicesListHtml(priorityBuckets)}') + 'operationalServicesListHtml(priorityBuckets)}';
  assert.strictEqual(wrapA, wrapB);

  const wireA = extract(indexText, 'VISTA OPERATIVA DE SERVICIOS: alterna', 'BUSCADOR RÁPIDO DE SERVICIOS: opera exclusivamente');
  const wireB = extract(operatorText, 'VISTA OPERATIVA DE SERVICIOS: alterna', 'BUSCADOR RÁPIDO DE SERVICIOS: opera exclusivamente');
  assert.strictEqual(wireA, wireB);
});

// ---------------- 32: Tarjetas y navegación (mejora #1) intactas ----------------

caso('CASO 32 — Tarjetas (renderCreditCardsModule) y la navegación de la matriz (restoreNavigationScroll/scrollMatrixToBaseMonth/data-base-month) no fueron modificados por esta mejora', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(BACKUP_DIR, `${f}.antes_vista_operativa`);
    assert.ok(fs.existsSync(beforePath), `falta el respaldo de referencia ${beforePath}`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;

    const checks = [
      ['renderCreditCardsModule', 'function renderCreditCardsModule(', '\nfunction '],
      ['restoreNavigationScroll', 'function restoreNavigationScroll(', '\nfunction '],
      ['scrollMatrixToBaseMonth', 'function scrollMatrixToBaseMonth(', '\nfunction '],
    ];
    for (const [name, s, e] of checks) {
      assert.strictEqual(extract(now, s, e), extract(before, s, e), `${name} en ${f} debe seguir siendo byte-idéntico al respaldo previo a esta mejora`);
    }
    assert.ok(now.includes('data-base-month="${baseMonth}"'), `data-base-month debe seguir presente en ${f} (matriz anual)`);
  }
});

// ---------------- Runner ----------------

let ok = 0, fail = 0;
for (const c of casos) {
  try { c.fn(); console.log('PASS -', c.nombre); ok++; }
  catch (e) { console.error('FAIL -', c.nombre); console.error('       ', e.message); fail++; }
}

console.log('----------------------------------------');
console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
console.log('AVISO: valida lógica real extraída + estructura del código, NO renderizado/scroll visual en navegador real.');
if (fail > 0) process.exitCode = 1;
