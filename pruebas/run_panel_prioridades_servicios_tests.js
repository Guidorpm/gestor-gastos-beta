// ============================================================
// PRUEBA LOCAL — panel operativo por prioridades (Servicios)
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta prueba NO abre un navegador real y NO puede
// medir layout/clics reales (Node no tiene DOM/CSS). Lo que SÍ hace, de
// forma reproducible y sin Supabase:
//
//   1) EXTRAE y EJECUTA (no reimplementa) el código real de
//      servicePriorityCategory/computeServicePriorityCategories/
//      priorityPanelHtml/priorityListItemHtml directamente de index.html,
//      junto con las funciones reales de las que depende y que son
//      seguras de extraer tal cual (today/daysUntil/dueState/
//      paymentProgress/monthAppliesToService/planMonthNumbers/
//      periodDate/obligationFor/isObligationVoided) -- así la prueba
//      examina la MISMA lógica de estado que ya usa la matriz, nunca una
//      copia que podría divergir.
//
//   2) Mockea SOLO el borde de acceso a datos que no es razonable
//      re-derivar acá: paidAmountFor(obligationId) (que en producción
//      depende de paymentAllocations/paidAmountForWithAllocations, ya
//      cubierto por otras pruebas/hotfixes de esta sesión) y
//      consolidationTarget(id) (que depende de `consolidations`).
//      paymentProgress() SÍ es el código real, alimentado por ese mock.
//
//   3) Controla la fecha "de hoy" inyectando un Date fijo -- los casos de
//      borde (vence hoy / venció ayer / vence en 7 u 8 días) son
//      deterministas, no dependen del día real de ejecución.
//
//   4) Hace verificaciones ESTRUCTURALES (texto) sobre las partes que
//      dependen de DOM/render completo (existencia del panel en
//      renderServices(), bindPriorityPanel() reutilizando
//      goToServiceRow(), integración con el buscador y con
//      restoreNavigationScroll(), vista inicial del operador).
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBA MANUAL" en el reporte de entrega):
//   - que el panel se ve/posiciona correctamente;
//   - que el clic en una tarjeta despliega la lista visualmente bien;
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

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Extracción de las funciones reales (index.html) ----------------

const fnToday = extract(indexText, 'function today(){', 'function daysUntil(');
const fnDaysUntil = extract(indexText, 'function daysUntil(v){', 'function rolePriority(');
const fnDueState = extract(indexText, 'function dueState(o){', 'function boxClass(o)');
const fnPaymentProgress = extract(indexText, 'function paymentProgress(obligation){', '// CORRECCIÓN 6B4.15 - Metadata técnica');
const fnPlanMonthNumbersAndMonthApplies = extract(indexText, 'function planMonthNumbers(service){', 'function servicePlanDescription(');
const fnPeriodDate = 'function periodDate(key){return key+\'-01\'}\n';
const fnObligationFor = 'function obligationFor(serviceId,key){return obligations.find(o=>o.service_id===serviceId&&o.period===periodDate(key))}\n';
const fnIsVoided = 'function isObligationVoided(o){return o?.status===\'cancelled\';}\n';
const panelSource = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function togglePriorityPanelList(');

const REAL_SOURCE = [fnToday, fnDaysUntil, fnPaymentProgress, fnDueState, fnPlanMonthNumbersAndMonthApplies, fnPeriodDate, fnObligationFor, fnIsVoided, panelSource].join('\n');

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

function buildSandbox({ now, obligations, consolidationTargetsById, paidById, allocationsLoadError, services }) {
  const sandbox = {
    Date: FixedDateFactory(now),
    obligations,
    services,
    paymentAllocationsLoadError: !!allocationsLoadError,
    // MOCK documentado (ver aviso al inicio del archivo): en producción
    // depende de `consolidations` -- acá, una tabla fija id->target.
    consolidationTarget: (id) => (consolidationTargetsById && consolidationTargetsById[id]) || null,
    // MOCK documentado: en producción depende de paymentAllocations vía
    // paidAmountForWithAllocations -- acá, una tabla fija id->monto pagado.
    paidAmountFor: (obligationId) => (paidById && paidById[obligationId]) || 0,
    console,
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { dueState, daysUntil, monthAppliesToService, servicePriorityCategory, computeServicePriorityCategories, DUE_SOON_DAYS };');
  return fn(...Object.values(sandbox));
}

// ---------------- Fixtures ----------------
// "Hoy" fijo: 2026-08-15 (viernes), para que los casos de borde sean
// deterministas sin depender del día real de ejecución.
const HOY = '2026-08-15T00:00:00';
const KEY = '2026-08';

function svc(id, overrides = {}) {
  return { id, name: id, category: 'General', frequency: 'monthly', is_private: false, ...overrides };
}
function ob(id, serviceId, overrides = {}) {
  return { id, service_id: serviceId, period: '2026-08-01', amount: 1000, status: 'active', due_date: null, ...overrides };
}

// ---------------- Los 20 casos exigidos + bordes de fecha ----------------

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

caso('CASO 1 — el panel existe en la pantalla de Servicios', () => {
  const renderServicesSource = extract(indexText, 'function renderServices(ms){', 'function balanceData(');
  assert.ok(renderServicesSource.includes('${priorityPanelHtml(priorityBuckets)}'), 'renderServices() debe imprimir el panel de prioridades');
  assert.ok(renderServicesSource.includes('const priorityBuckets=computeServicePriorityCategories(baseMonth);'), 'debe calcular las categorías con baseMonth');
});

caso('CASO 2 — usa baseMonth (no un mes propio/hardcodeado)', () => {
  assert.ok(indexText.includes('computeServicePriorityCategories(baseMonth)'), 'debe llamarse siempre con baseMonth, el mismo mes que la matriz');
  assert.ok(!/computeServicePriorityCategories\(['"]2026-08['"]\)/.test(indexText), 'no debe haber ningún mes hardcodeado');
});

caso('CASO 3 — vencidos correctamente identificados', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-10', amount: 1000 }); // venció hace 5 días, sin pagos
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'vencidos');
});

caso('CASO 4 — próximos correctamente identificados', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-20', amount: 1000 }); // vence en 5 días
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'proximos');
});

caso('CASO 5 — sin importe/datos NO incluye meses donde el servicio no corresponde', () => {
  // one_time sin obligación este mes -> nunca se marca por ausencia.
  const oneTime = svc('s-one', { frequency: 'one_time', plan_start_month: '2026-05-01' });
  // monthly con plan_start_month futuro (todavía no arrancó) -> no corresponde.
  const futuro = svc('s-futuro', { frequency: 'monthly', plan_start_month: '2026-09-01' });
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [], services: [oneTime, futuro], paidById: {} });
  assert.strictEqual(servicePriorityCategory(oneTime, KEY), null, 'one_time sin obligación no debe marcarse como sin datos');
  assert.strictEqual(servicePriorityCategory(futuro, KEY), null, 'un servicio que todavía no arrancó no debe marcarse como sin datos');
});

caso('CASO 5b — sin importe/datos SÍ incluye un mensual esperado sin obligación cargada', () => {
  const s1 = svc('s1', { frequency: 'monthly' });
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'sin_datos');
});

caso('CASO 5c — sin importe/datos SÍ incluye una obligación cargada sin vencimiento', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: null });
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'sin_datos');
});

caso('CASO 6 — pendientes funciona como fallback (saldo, vencimiento a más de 7 días)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-09-15', amount: 1000 }); // muy lejos, con saldo
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'pendientes');
});

caso('CASO 6b — pendientes también cubre "no se pudieron verificar los pagos" (unavailable)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-20', amount: 1000 });
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {}, allocationsLoadError: true });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'pendientes', 'sin poder verificar pagos no debe afirmarse vencido/próximo/abonado');
});

caso('CASO 7 — abonados usa estado real (saldado), no mera existencia de un pago', () => {
  const s1 = svc('s1');
  const oParcial = ob('o1', 's1', { due_date: '2026-08-20', amount: 1000 });
  const oSaldada = ob('o2', 's1', { due_date: '2026-08-20', amount: 1000 });
  const { servicePriorityCategory } = buildSandbox({
    now: HOY,
    obligations: [oParcial],
    services: [s1],
    paidById: { o1: 300 }, // pago parcial: NO debe ser "abonados"
  });
  assert.notStrictEqual(servicePriorityCategory(s1, KEY), 'abonados', 'un pago parcial no debe contar como abonado');

  const sandboxSaldada = buildSandbox({
    now: HOY,
    obligations: [oSaldada],
    services: [s1],
    paidById: { o2: 1000 }, // saldado completo
  });
  assert.strictEqual(sandboxSaldada.servicePriorityCategory(s1, KEY), 'abonados');
});

caso('CASO 8 — cada servicio queda como máximo en UNA categoría principal', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-10', amount: 1000 }); // vencido
  const { computeServicePriorityCategories } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  const buckets = computeServicePriorityCategories(KEY);
  let apariciones = 0;
  for (const key of Object.keys(buckets)) if (buckets[key].some(s => s.id === 's1')) apariciones++;
  assert.strictEqual(apariciones, 1);
});

caso('CASO 9 — todos los servicios relevantes quedan clasificados', () => {
  const vencido = svc('v', { name: 'Vencido' });
  const proximo = svc('p', { name: 'Proximo' });
  const sinDatos = svc('sd', { name: 'SinDatos' });
  const pendiente = svc('pe', { name: 'Pendiente' });
  const abonado = svc('ab', { name: 'Abonado' });
  const obligations = [
    ob('o1', 'v', { due_date: '2026-08-01', amount: 1000 }),
    ob('o2', 'p', { due_date: '2026-08-18', amount: 1000 }),
    ob('o4', 'pe', { due_date: '2026-09-30', amount: 1000 }),
    ob('o5', 'ab', { due_date: '2026-08-05', amount: 1000 }),
  ];
  const { computeServicePriorityCategories } = buildSandbox({
    now: HOY, obligations, services: [vencido, proximo, sinDatos, pendiente, abonado],
    paidById: { o5: 1000 },
  });
  const buckets = computeServicePriorityCategories(KEY);
  const todos = Object.values(buckets).flat().map(s => s.id);
  assert.deepStrictEqual(new Set(todos), new Set(['v', 'p', 'sd', 'pe', 'ab']));
});

caso('CASO 10 — el clic usa la fila real / goToServiceRow (mecanismo común con el buscador)', () => {
  const bindSrc = extract(indexText, 'function togglePriorityPanelList(card){', 'function bindPriorityPanel(');
  assert.ok(bindSrc.includes('goToServiceRow(el.dataset.priorityItem)'), 'debe reutilizar goToServiceRow(), no un mecanismo propio de localización de fila');
  assert.ok(!indexText.slice(indexText.indexOf('function togglePriorityPanelList'), indexText.indexOf('function bindPriorityPanel')).includes('scrollIntoView'), 'no debe implementar un scrollIntoView propio -- debe delegar en goToServiceRow()');
});

caso('CASO 11 — el buscador sigue existiendo', () => {
  assert.ok(indexText.includes('id="serviceSearchInput"'));
  assert.ok(indexText.includes('function bindServiceSearch('));
});

caso('CASO 12 — la navegación (mejora #1) sigue intacta', () => {
  assert.ok(indexText.includes('function restoreNavigationScroll(prevScrollY,prevMatrixState){'));
  assert.ok(indexText.includes('function scrollMatrixToBaseMonth(matrixScroll){'));
  const panelBindSrc = extract(indexText, 'function bindPriorityPanel(){', 'function openServiceModal(');
  assert.ok(!panelBindSrc.includes('renderApp()'), 'bindPriorityPanel/togglePriorityPanelList no deben llamar a renderApp()');
});

caso('CASO 13 — el operador entra en Servicios por defecto (única divergencia intencional)', () => {
  assert.ok(operatorText.includes("let tab='services', baseMonth=getSavedBaseMonth(), authMode='login';"), 'index_operator.html debe arrancar siempre en la pestaña services');
  assert.ok(indexText.includes("let tab=getSavedTab(), baseMonth=getSavedBaseMonth(), authMode='login';"), 'index.html (titular) NO debe cambiar su landing');
});

caso('CASO 14 — el titular no pierde funcionalidad (mismo panel, mismas funciones)', () => {
  const blockA = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function openServiceModal(');
  const blockB = extract(operatorText, 'const DUE_SOON_DAYS=7;', 'function openServiceModal(');
  assert.strictEqual(blockA, blockB, 'el panel debe ser byte-idéntico entre ambos archivos (misma lógica para titular y operador)');
});

caso('CASO 15 — el panel usa solo `services` autorizados (visibles por RLS)', () => {
  assert.ok(/services\.forEach\(s=>\{/.test(panelSource), 'computeServicePriorityCategories debe iterar sobre `services`, no sobre otra fuente');
});

caso('CASO 16 — no consulta Tarjetas', () => {
  const fullPanelBlock = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function openServiceModal(');
  assert.ok(!fullPanelBlock.includes('creditCards'), 'el panel no debe mencionar creditCards en ningún punto');
});

caso('CASO 17 — no agrega consultas Supabase nuevas', () => {
  const fullPanelBlock = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function openServiceModal(');
  assert.ok(!/\bsb\.from\(|\bsb\.rpc\(|\bfetch\(|supabase/i.test(fullPanelBlock), 'el panel no debe llamar a Supabase/fetch -- trabaja 100% sobre datos ya cargados en memoria');
});

caso('CASO 18 — no modifica SQL / no hay archivos de esta tarea en migraciones/', () => {
  const archivosDeEstaTarea = [indexPath, operatorPath, __filename];
  for (const archivo of archivosDeEstaTarea) assert.ok(!archivo.includes('migraciones'), `${archivo} no debería estar dentro de migraciones/`);
});

caso('CASO 19 — paridad lógica index.html / index_operator.html (fuera de la divergencia documentada)', () => {
  const cssA = indexText.split('\r\n').find(l => l.includes('.priority-panel{'));
  const cssB = operatorText.split('\r\n').find(l => l.includes('.priority-panel{'));
  assert.strictEqual(cssA, cssB);
});

caso('CASO 20 — los conteos se calculan solo sobre datos visibles (no hay total "real" paralelo sin filtrar)', () => {
  // No debe existir ningún cálculo de conteo del panel que use otra
  // fuente que no sea `services` (p.ej. una lista sin filtrar, o
  // `spacesDashboard`, que mezcla varios grupos).
  assert.ok(!panelSource.includes('spacesDashboard'), 'el panel no debe usar spacesDashboard (mezcla de varios espacios) para sus conteos');
});

// ---------------- Bordes de fecha ----------------

caso('BORDE — vence hoy (0 días) -> próximos', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-15', amount: 1000 }); // HOY
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'proximos');
});

caso('BORDE — venció ayer (-1 día) -> vencidos', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-14', amount: 1000 });
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'vencidos');
});

caso('BORDE — vence dentro de 7 días (límite exacto DUE_SOON_DAYS) -> próximos', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-22', amount: 1000 }); // 15+7
  const { servicePriorityCategory, DUE_SOON_DAYS } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(DUE_SOON_DAYS, 7, 'confirma que el umbral real sigue siendo 7');
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'proximos');
});

caso('BORDE — vence dentro de 8 días (un día después del límite) -> pendientes', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { due_date: '2026-08-23', amount: 1000 }); // 15+8
  const { servicePriorityCategory } = buildSandbox({ now: HOY, obligations: [o1], services: [s1], paidById: {} });
  assert.strictEqual(servicePriorityCategory(s1, KEY), 'pendientes');
});

// ---------------- Runner ----------------

let ok = 0, fail = 0;
for (const c of casos) {
  try { c.fn(); console.log('PASS -', c.nombre); ok++; }
  catch (e) { console.error('FAIL -', c.nombre); console.error('       ', e.message); fail++; }
}

console.log('----------------------------------------');
console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
console.log('AVISO: valida lógica real extraída (con Date fijo) + estructura del código, NO interacción visual en navegador real.');
if (fail > 0) process.exitCode = 1;
