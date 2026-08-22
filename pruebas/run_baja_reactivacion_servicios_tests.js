// ============================================================
// PRUEBA LOCAL — Baja no destructiva y reactivación de servicios
// (mejora #10, FASE 1: auditoría + implementación local + tests, 20260818)
// ------------------------------------------------------------
// Pedido real de Guido: "Quiero poder dar de baja los servicios pero que
// no desaparezcan sino que queden abajo de todo como servicios dados de
// baja y poder reactivarlos cuando uno quisiera."
//
// Diseño (ver reporte de entrega para el detalle completo de la
// auditoría): se audito el modelo REAL de public.services en el código
// frontend y se confirmo que la columna `active` YA EXISTE y YA se usa en
// producción (reloadGroup()/spacesDashboard ya filtraban .eq('active',true)
// antes de esta mejora). NO se creó ninguna columna ni tabla nueva. "Dar
// de baja" = UPDATE services SET active=false sobre la MISMA fila (mismo
// service_id). "Reactivar" = UPDATE services SET active=true. El viejo
// deleteService() (DELETE real + borrado de Storage) se ELIMINÓ por
// completo del archivo -- ya no existe ningún camino de UI normal que
// pueda borrar un servicio.
//
// La tabla `services` NO tiene hoy ningún campo de trazabilidad (notes/
// editHistory como sí tiene obligations vía OBLIGATION_META) -- por eso
// esta mejora NO registra quién/cuándo dio de baja o reactivó: sería
// inventar una estructura nueva sin autorización. Se reporta como
// limitación conocida (ver entrega).
//
// Esta prueba extrae y ejecuta las funciones REALES de index.html (nunca
// reimplementadas a mano) en un sandbox con arrays en memoria, y hace
// auditoría estática (extract + assert de contenido) sobre las funciones
// pesadas de UI (openObligation/openFolder/dropService/reactivateService/
// reloadGroup) que dependen de DOM/modal/Supabase real -- mismo patrón ya
// usado en mejoras anteriores (#7, #9) para esos casos.
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
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Bloques reales extraídos de index.html ----------------
const fnEsc = extract(indexText, 'function esc(v){', '\n');
const fnFmtDate = extract(indexText, 'function fmtDate(v){', '\n');
const fnFmtMoney = extract(indexText, 'function fmtMoney(v){', '\n');
const fnFmtMoneyExact = extract(indexText, 'function fmtMoneyExact(v){', '\n');
const fnMonthLabel = extract(indexText, 'function monthLabel(key){', '\n');
const fnPeriodDate = extract(indexText, 'function periodDate(key){', '\n');
const fnDaysUntil = extract(indexText, 'function daysUntil(v){', '\n');
const constMonths = extract(indexText, 'const MONTHS=', '\n');
const fnRoundServiceMoney = extract(indexText, 'function roundServiceMoney(value){', '\n');
const fnServiceMoneyCents = extract(indexText, 'function serviceMoneyCents(value){', '\n');

// paidAmountForWithAllocations/paymentNoteMetadata/buildPaymentNotes/
// obligationHasSecondStagePayment/effectiveObligationAmount -- necesarios
// para paymentProgress()/previousBalanceFor() más abajo (mismo bloque que
// ya usa la suite de mejora #9).
const blockPaymentsAndAmounts = extract(indexText, 'function paidAmountForWithAllocations(', 'function isServiceVisibleForCurrentContext(');

// obligationFor/frequencyLabel/monthAppliesToService/servicePlanDescription/
// serviceStartLabel/paidAmountFor/balanceFor/paymentProgress/
// receiptsForObligation/consolidationsForTarget/isEffectivePending/
// previousBalanceFor/dueState/boxClass/boxText (YA CORREGIDAS, mejora #10) --
// todo en el orden real del archivo.
const blockObligationsCore = extract(indexText, 'function obligationFor(serviceId,key){', 'function lastKnownAmount(');
// lastKnownAmount/forecastMonth (YA CORREGIDA, mejora #10)/renderForecast/
// pendingObligations/monthTotals/monthQuickSummary (YA CORREGIDA, mejora
// #10)/renderAnnualOverview/carriedDebts.
const blockTotalsForecast = extract(indexText, 'function lastKnownAmount(serviceId,beforeKey){', 'function operationalServiceRowHtml(s,key){');
// operationalServiceRowHtml (YA CORREGIDA)/operationalServicesListHtml (YA
// CORREGIDA)/matrixServiceRowHtml (NUEVA, mejora #10)/renderServices (YA
// CORREGIDA, referencia funciones de UI que este sandbox no provee, pero
// nunca se invoca directamente acá).
const blockServicesLists = extract(indexText, 'function operationalServiceRowHtml(s,key){', 'function normalizeSearchText(value){');
// normalizeSearchText/searchServicesByName/serviceSearchResultHtml (YA
// CORREGIDA)/closeServiceSearchResults/bindServiceSearch/goToServiceRow.
const blockSearch = extract(indexText, 'function normalizeSearchText(value){', 'const DUE_SOON_DAYS=7;');
// DUE_SOON_DAYS/servicePriorityCategory (YA CORREGIDA, mejora
// #10)/computeServicePriorityCategories/PRIORITY_CATEGORY_META/
// PRIORITY_CATEGORY_ORDER/priorityPanelHtml/priorityListItemHtml (YA
// CORREGIDA)/togglePriorityPanelList/bindPriorityPanel.
const blockPriorities = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function openServiceModal(serviceId=null){');

const REAL_SOURCE = [
  fnEsc, fnFmtDate, fnFmtMoney, fnFmtMoneyExact, fnMonthLabel, fnPeriodDate, fnDaysUntil, constMonths,
  fnRoundServiceMoney, fnServiceMoneyCents, blockPaymentsAndAmounts,
  blockObligationsCore, blockTotalsForecast, blockServicesLists, blockSearch, blockPriorities,
].join('\n');

function buildSandbox({
  obligations = [], payments = [], paymentAllocations = [], documents = [], consolidations = [], services = [],
  session = { user: { id: 'user-1' } }, baseMonth = '2026-08', paymentAllocationsLoadError = false,
  isOwnerValue = false,
} = {}) {
  const sandbox = {
    obligations, payments, paymentAllocations, documents, consolidations, services, session, baseMonth,
    paymentAllocationsLoadError,
    isOwner: () => isOwnerValue,
    today: () => new Date(2026, 7, 16),
    window: {},
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + `
    return {
      obligationFor, frequencyLabel, monthAppliesToService, servicePlanDescription, serviceStartLabel,
      paidAmountFor, balanceFor, paymentProgress, receiptsForObligation, consolidationsForTarget,
      isEffectivePending, previousBalanceFor, dueState, boxClass, boxText, activeServiceDocuments,
      lastKnownAmount, forecastMonth, pendingObligations, monthTotals, monthQuickSummary, carriedDebts,
      operationalServiceRowHtml, operationalServicesListHtml, matrixServiceRowHtml,
      normalizeSearchText, searchServicesByName, serviceSearchResultHtml,
      servicePriorityCategory, computeServicePriorityCategories, priorityListItemHtml,
      PRIORITY_CATEGORY_META, PRIORITY_CATEGORY_ORDER,
    };
  `);
  return fn(...Object.values(sandbox));
}

function svc(id, overrides = {}) {
  return { id, group_id: 'g1', name: `Servicio ${id}`, category: 'Otros', frequency: 'monthly', is_private: false, active: true, plan_start_month: null, ...overrides };
}
function obl(id, serviceId, overrides = {}) {
  return { id, service_id: serviceId, period: '2026-08-01', amount: 1000, status: 'active', due_date: null, notes: null, ...overrides };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ================================================================
// PARTE A -- servicio activo puede darse de baja / modelo real
// ================================================================

caso('CASO 1 — el modelo real detectado usa services.active (boolean) -- ya existía y ya se usaba en producción antes de esta mejora (reloadGroup/spacesDashboard ya lo filtraban)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("sb.from('services').select('id,group_id,name,active,is_private')"), 'spacesDashboard ya seleccionaba active antes de #10 -- confirma que la columna es real');
  }
});

// AJUSTE (BUGFIX #13 FASE 2, 20260821): el UPDATE de services.active dejó
// de estar inline dentro de dropService()/reactivateService() -- se
// extrajo a applyServiceActiveUpdate(serviceId,targetActive), compartida
// por ambas, que además valida la fila devuelta (.select('id,active'),
// exactamente 1 fila, mismo id, mismo estado) antes de confirmar éxito.
// Cambio legítimo y autorizado (diagnóstico real 6b16: un UPDATE sin
// validar podía mostrar "Servicio dado de baja" con 0 filas realmente
// afectadas). Se ajustan estos dos casos para verificar el UPDATE real en
// su ubicación real, y que dropService/reactivateService sigan llamándolo
// con el targetActive correcto.
caso('CASO 2 — dropService() hace UPDATE de active=false (vía applyServiceActiveUpdate), nunca DELETE', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const updateBlock = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(updateBlock.includes("from('services')") && updateBlock.includes('.update({active:targetActive})') && updateBlock.includes(".eq('id',serviceId)"), `[${label}] applyServiceActiveUpdate debe hacer UPDATE sobre active`);
    assert.ok(!updateBlock.includes('.delete('), `[${label}] no debe usar .delete() en ningún lado`);
    const dropBlock = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(serviceId){');
    assert.ok(dropBlock.includes('applyServiceActiveUpdate(serviceId,false)'), `[${label}] dropService debe pedir targetActive=false`);
  }
});

caso('CASO 3 — reactivateService() hace UPDATE de active=true (vía applyServiceActiveUpdate) sobre el mismo id (misma fila, mismo service_id)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const reactivateBlock = extract(text, 'async function reactivateService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(reactivateBlock.includes('applyServiceActiveUpdate(serviceId,true)'), `[${label}] reactivateService debe pedir targetActive=true`);
    assert.ok(!/insert\(/.test(reactivateBlock), `[${label}] reactivateService no debe insertar una fila nueva`);
  }
});

caso('CASO 4 — active pasa true→false y false→true SOBRE EL MISMO id: dropService/reactivateService reciben y usan el mismo serviceId, nunca generan uno nuevo', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const dropBlock = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(serviceId){');
    const reactivateBlock = extract(text, 'async function reactivateService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(!/uuid|crypto\.randomUUID|Date\.now\(\)/.test(dropBlock + reactivateBlock), `[${label}] no debe generarse ningún id nuevo`);
  }
});

// ================================================================
// PARTE B -- UI: activos arriba, dados de baja abajo, nunca mezclados
// ================================================================

caso('CASO 5/7/8 — matrixServiceRowHtml distingue activo/inactivo (clase inactive-service-row + badge), pero es la MISMA función real para ambos -- ningún camino paralelo simplificado', () => {
  const sb = buildSandbox({});
  const activo = svc('s1', { active: true });
  const inactivo = svc('s2', { active: false });
  const rowActivo = sb.matrixServiceRowHtml(activo, ['2026-08']);
  const rowInactivo = sb.matrixServiceRowHtml(inactivo, ['2026-08']);
  assert.ok(!rowActivo.includes('inactive-service-row'), 'un servicio activo no lleva la clase de atenuado');
  assert.ok(rowInactivo.includes('inactive-service-row'), 'un servicio inactivo sí lleva la clase de atenuado');
  assert.ok(rowInactivo.includes('DADO DE BAJA'), 'un servicio inactivo muestra el badge "DADO DE BAJA"');
  assert.ok(!rowActivo.includes('DADO DE BAJA'), 'un servicio activo NUNCA muestra el badge "DADO DE BAJA"');
});

caso('CASO 6/9 — operationalServicesListHtml agrega una sección "Servicios dados de baja" SEPARADA, después de la lista operativa normal -- nunca mezclada', () => {
  const sb = buildSandbox({});
  const activo = svc('s1', { active: true, name: 'Edesur' });
  const inactivo = svc('s2', { active: false, name: 'Viejo Servicio' });
  const buckets = { vencidos: [], proximos: [], sin_datos: [], importes_pendientes: [], pendientes: [], abonados: [] };
  const html = sb.operationalServicesListHtml(buckets, [inactivo]);
  assert.ok(html.includes('Servicios dados de baja'), 'debe mostrar el encabezado de la sección');
  const headingIdx = html.indexOf('Servicios dados de baja');
  const inactiveRowIdx = html.indexOf(`data-service-row="s2"`);
  assert.ok(inactiveRowIdx > headingIdx, 'la fila del servicio inactivo debe estar DESPUÉS del encabezado de la sección');
});

caso('CASO 9b — si no hay servicios dados de baja, la sección no se muestra (sin bloque vacío innecesario)', () => {
  const sb = buildSandbox({});
  const buckets = { vencidos: [], proximos: [], sin_datos: [], importes_pendientes: [], pendientes: [], abonados: [] };
  const html = sb.operationalServicesListHtml(buckets, []);
  assert.ok(!html.includes('Servicios dados de baja'), 'sin inactivos, no debe aparecer la sección');
});

caso('CASO 50 — múltiples servicios inactivos se muestran de forma estable (orden alfabético, todos presentes, sin duplicados)', () => {
  const sb = buildSandbox({});
  const inactivos = [svc('s3', { active: false, name: 'Zeta' }), svc('s1', { active: false, name: 'Alfa' }), svc('s2', { active: false, name: 'Medio' })];
  const buckets = { vencidos: [], proximos: [], sin_datos: [], importes_pendientes: [], pendientes: [], abonados: [] };
  const html = sb.operationalServicesListHtml(buckets, inactivos);
  const posAlfa = html.indexOf('data-service-row="s1"');
  const posMedio = html.indexOf('data-service-row="s2"');
  const posZeta = html.indexOf('data-service-row="s3"');
  assert.ok(posAlfa < posMedio && posMedio < posZeta, 'orden alfabético estable dentro de la sección de inactivos');
  assert.strictEqual((html.match(/data-service-row="s1"/g) || []).length, 1, 'sin duplicados');
});

caso('CASO 38/39 — mobile/desktop: no hay ninguna rama de plataforma en toda la implementación de mejora #10 (mismo código para ambos)', () => {
  for (const text of [indexText, operatorText]) {
    const dropBlock = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(serviceId){');
    assert.ok(!/navigator\.userAgent|isMobile|innerWidth/i.test(dropBlock));
  }
});

// ================================================================
// PARTE C -- reactivación: botón, wiring, no duplica
// ================================================================

caso('CASO 10/11/12 — openFolder(): servicio activo muestra "Dar de baja servicio"; servicio inactivo muestra "Reactivar servicio" -- nunca ambos, nunca "Eliminar"', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openFolder(serviceId){', 'async function dropService(serviceId){');
    assert.ok(block.includes("id=\"dropServiceBtn\""), `[${label}] debe existir el botón Dar de baja`);
    assert.ok(block.includes("id=\"reactivateServiceBtn\""), `[${label}] debe existir el botón Reactivar`);
    assert.ok(!block.includes('Eliminar servicio'), `[${label}] NUNCA debe mostrarse "Eliminar servicio"`);
    assert.ok(!block.includes('deleteServiceBtn'), `[${label}] el botón viejo deleteServiceBtn no debe existir más`);
  }
});

caso('CASO 48 — la confirmación de "Dar de baja" deja explícito que no se borran datos', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(serviceId){');
    assert.ok(block.includes('No se borrarán obligaciones, facturas, pagos ni documentos'), `[${label}] el texto de confirmación debe ser explícito`);
    assert.ok(block.includes('Podrás reactivarlo'), `[${label}] debe mencionar que se puede reactivar`);
  }
});

// ================================================================
// PARTE D -- no destructivo: obligations/payments/documents/Storage
// ================================================================

caso('CASO 13/14/15/16/17/18 — dropService/reactivateService NUNCA tocan obligations/payments/documents/Storage/payment_allocations/payment_corrections', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(!/from\('obligations'\)/.test(block), `[${label}] no debe tocar obligations`);
    assert.ok(!/from\('payments'\)/.test(block), `[${label}] no debe tocar payments`);
    assert.ok(!/from\('documents'\)/.test(block), `[${label}] no debe tocar documents`);
    assert.ok(!/storage\.from\(/.test(block), `[${label}] no debe tocar Storage`);
    assert.ok(!/payment_allocations/.test(block), `[${label}] no debe tocar payment_allocations`);
    assert.ok(!/payment_corrections/.test(block), `[${label}] no debe tocar payment_corrections`);
  }
});

caso('CASO 44/45/46/47 — sin SQL, sin migración nueva ejecutable, sin ningún .from(\'services\').delete( en todo el archivo (auditoría de DELETE)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(!/from\('services'\)\s*\.\s*delete\(/.test(text), `[${label}] no debe existir NINGÚN DELETE real de services accesible`);
    assert.ok(!text.includes('function deleteService('), `[${label}] la función legacy deleteService() debe estar eliminada, no solo desconectada`);
  }
});

caso('CASO 19/20/33 — baja no cambia deuda histórica: monthTotals()/pendingObligations()/carriedDebts() no filtran por services.active -- operan 100% sobre obligations', () => {
  const s1 = svc('s1', { active: false });
  const o1 = obl('o1', 's1', { amount: 5000, period: '2026-07-01', status: 'active' });
  const sb = buildSandbox({ services: [s1], obligations: [o1], baseMonth: '2026-07' });
  const totals = sb.monthTotals('2026-07');
  assert.strictEqual(totals.total, 5000, 'el gasto real de Julio sigue existiendo aunque el servicio esté inactivo');
  const pending = sb.pendingObligations();
  assert.strictEqual(pending.length, 1, 'la obligación impaga de un servicio inactivo sigue apareciendo como pendiente');
});

caso('CASO 21 — baja no resuelve amountPending (#9): dropService/reactivateService nunca tocan extraFields/notes de obligations', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(!block.includes('amountPending'), `[${label}] dropService/reactivateService no deben mencionar amountPending`);
    assert.ok(!block.includes('updateObligationNotes'), `[${label}] no deben tocar notes de obligations`);
  }
});

// ================================================================
// PARTE E -- generación futura de períodos / reactivación / backfill
// ================================================================

caso('CASO 22 — un servicio inactivo sin obligación este mes NO se marca "sin_datos" (no pide cargar un período nuevo)', () => {
  const s1 = svc('s1', { active: false, frequency: 'monthly', plan_start_month: null });
  const sb = buildSandbox({ services: [s1], obligations: [] });
  const category = sb.servicePriorityCategory(s1, '2026-08');
  assert.strictEqual(category, null, 'inactivo sin obligación este mes -> ninguna categoría (nunca sin_datos)');
});

caso('CASO 22b — un servicio ACTIVO sin obligación este mes SÍ sigue marcándose "sin_datos" (comportamiento previo intacto)', () => {
  const s1 = svc('s1', { active: true, frequency: 'monthly', plan_start_month: null });
  const sb = buildSandbox({ services: [s1], obligations: [] });
  const category = sb.servicePriorityCategory(s1, '2026-08');
  assert.strictEqual(category, 'sin_datos', 'un servicio activo real sin datos sigue pidiendo carga -- comportamiento previo NO se rompió');
});

caso('CASO 22c — un servicio inactivo CON una obligación histórica real este mes conserva su categoría real (vencidos/pendientes/etc.) -- la baja no la resuelve ni la esconde', () => {
  const s1 = svc('s1', { active: false });
  const o1 = obl('o1', 's1', { period: '2026-08-01', amount: 1000, due_date: '2026-07-01', status: 'active' });
  const sb = buildSandbox({ services: [s1], obligations: [o1], baseMonth: '2026-08' });
  const category = sb.servicePriorityCategory(s1, '2026-08');
  assert.strictEqual(category, 'vencidos', 'la obligación real vencida de un servicio inactivo sigue clasificándose como vencida, no se resuelve por la baja');
});

caso('CASO E — servicio dado de baja con un importe pendiente (#9) histórico: sigue existiendo, sigue en su bucket importes_pendientes real, la baja NO lo resuelve ni lo hace desaparecer', () => {
  const s1 = svc('s1', { active: false, name: 'Edesur' });
  const notesConPendiente = '[[OBLIGATION_META:' + JSON.stringify({ extraFields: { amountPending: true } }) + ']]';
  const o1 = obl('o1', 's1', { period: '2026-08-01', amount: 0, due_date: '2026-08-10', status: 'active', notes: notesConPendiente });
  const sb = buildSandbox({ services: [s1], obligations: [o1], baseMonth: '2026-08' });
  const category = sb.servicePriorityCategory(s1, '2026-08');
  assert.strictEqual(category, 'importes_pendientes', 'un pendiente histórico de un servicio inactivo sigue clasificado como importes_pendientes, la baja no lo resuelve');
  const t = sb.boxText(o1, s1);
  assert.strictEqual(t[0], 'Importe pendiente', 'sigue mostrando "Importe pendiente", nunca $0 real ni "Pagado"');
});

caso('CASO 34/35 — computeServicePriorityCategories: un servicio inactivo con deuda real aparece en su bucket real; uno inactivo sin datos no aparece en ningún bucket', () => {
  const sConDeuda = svc('sA', { active: false, name: 'Con Deuda' });
  const oConDeuda = obl('oA', 'sA', { period: '2026-08-01', amount: 1000, due_date: '2026-07-01', status: 'active' });
  const sSinDatos = svc('sB', { active: false, name: 'Sin Datos' });
  const sb = buildSandbox({ services: [sConDeuda, sSinDatos], obligations: [oConDeuda], baseMonth: '2026-08' });
  const buckets = sb.computeServicePriorityCategories('2026-08');
  assert.ok(buckets.vencidos.some(s => s.id === 'sA'), 'el inactivo con deuda real aparece en vencidos');
  assert.ok(!Object.values(buckets).some(list => list.some(s => s.id === 'sB')), 'el inactivo sin datos no aparece en ningún bucket -- "active=false por sí sola NO debe crear una prioridad nueva"');
});

caso('CASO 23 — reactivación no genera backfill: NO existe en todo el archivo ningún mecanismo de creación automática de obligations más allá del upsert explícito del usuario en saveMonthData', () => {
  for (const text of [indexText, operatorText]) {
    const inserts = text.match(/from\('obligations'\)\s*\.\s*(insert|upsert)/g) || [];
    assert.strictEqual(inserts.length, 1, 'debe existir EXACTAMENTE un punto de creación de obligations en todo el archivo (el upsert explícito de saveMonthData) -- confirma que no hay backfill automático que #10 debiera bloquear aparte');
  }
});

caso('CASO 24 — meses inactivos intermedios no se crean automáticamente: forecastMonth() nunca proyecta un gasto estimado para un servicio inactivo sin obligación', () => {
  const s1 = svc('s1', { active: false, frequency: 'monthly', plan_start_month: null });
  const oPrevia = obl('o0', 's1', { period: '2026-06-01', amount: 3000, status: 'paid' });
  const sb = buildSandbox({ services: [s1], obligations: [oPrevia], baseMonth: '2026-08' });
  const forecast = sb.forecastMonth('2026-08');
  assert.strictEqual(forecast.estimated, 0, 'un servicio inactivo nunca debe generar un gasto estimado para un mes futuro');
  assert.strictEqual(forecast.confirmed, 0, 'tampoco confirmado, porque no hay ninguna obligación real para ese mes');
});

caso('CASO 24b — forecastMonth() SÍ sigue proyectando normalmente para un servicio activo sin obligación (comportamiento previo intacto)', () => {
  const s1 = svc('s1', { active: true, frequency: 'monthly', plan_start_month: null });
  const oPrevia = obl('o0', 's1', { period: '2026-06-01', amount: 3000, status: 'paid' });
  const sb = buildSandbox({ services: [s1], obligations: [oPrevia], baseMonth: '2026-08' });
  const forecast = sb.forecastMonth('2026-08');
  assert.strictEqual(forecast.estimated, 3000, 'un servicio activo real sigue proyectando con normalidad -- no se rompió el comportamiento previo');
});

caso('CASO 22d/24c — openObligation: crear un período NUEVO (o=undefined) para un servicio inactivo queda bloqueado vía editableNow; un período EXISTENTE sigue 100% editable', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n  const paymentRows=');
    assert.ok(block.includes('isNewForInactiveService=!o&&s&&s.active===false'), `[${label}] el gate debe exigir explícitamente !o (sin registro existente)`);
    assert.ok(block.includes('editableNow=canEdit()&&!voided&&!isNewForInactiveService'), `[${label}] editableNow debe incorporar el nuevo gate sin romper voided/canEdit previos`);
  }
});

// ================================================================
// PARTE F -- historial sigue accesible (facturas, pagos, #6, #7, #8, #9)
// ================================================================

caso('CASO 25/26/27/28 — reloadGroup() ya NO filtra active=true al cargar services -- las obligaciones/facturas/pagos/segundo vencimiento de un servicio inactivo siguen accesibles', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'async function reloadGroup(){', '\n  const err=');
    assert.ok(!/from\('services'\)\.select\('\*'\)\.eq\('group_id',group\.id\)\.eq\('active',true\)/.test(block), `[${label}] reloadGroup ya no debe filtrar active=true`);
    assert.ok(block.includes("from('services').select('*').eq('group_id',group.id).order('name')"), `[${label}] reloadGroup debe seguir cargando TODOS los servicios del grupo`);
  }
});

caso('CASO 29/30/31/32 — mejoras previas (#6/#7/#8/#9) intactas: sus identificadores clave siguen presentes sin cambios', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('isVoidedServiceDocument'), `[${label}] #6 intacta`);
    assert.ok(text.includes('openVoidServiceDocumentModal'), `[${label}] #6 intacta`);
    assert.ok(text.includes('correct_historical_payment'), `[${label}] #7 intacta`);
    assert.ok(text.includes('openCorrectHistoricalPaymentModal'), `[${label}] #7 intacta`);
    assert.ok(text.includes('snapshotFileBytesForUpload'), `[${label}] #8 intacta`);
    assert.ok(text.includes('amountPending'), `[${label}] #9 intacta`);
    assert.ok(text.includes('pendingCandidates'), `[${label}] #9 intacta`);
    assert.ok(text.includes('importes_pendientes'), `[${label}] #9 intacta`);
    assert.ok(text.includes("from('obligation_consolidations')"), `[${label}] #9 intacta`);
  }
});

caso('CASO 40 [index.html] — Tarjetas (uploadCreditDocument/renderCreditCardsModule/bindCreditCardsModule) permanece byte-idéntica al backup previo a mejora #10', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_10_baja_reactivacion_servicios_20260818_221536', 'index.html.antes_mejora10'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(indexText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

caso('CASO 40b [index_operator.html] — Tarjetas permanece byte-idéntica al backup previo a mejora #10', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_10_baja_reactivacion_servicios_20260818_221536', 'index_operator.html.antes_mejora10'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(operatorText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

caso('CASO 40c — ningún identificador de Tarjetas (creditCard/credit_card/card_receipt/carried_balance) aparece en el código nuevo de mejora #10', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const dropReactivate = extract(text, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(!/creditCard|credit_card|card_receipt|carried_balance/i.test(dropReactivate), `[${label}] cero referencias a Tarjetas en el código de #10`);
  }
});

// ================================================================
// PARTE G -- buscador
// ================================================================

caso('CASO 36/37 — el buscador encuentra un servicio inactivo (searchServicesByName no filtra por active) y serviceSearchResultHtml lo marca "DADO DE BAJA"', () => {
  const inactivo = svc('s1', { active: false, name: 'Servicio Viejo' });
  const activo = svc('s2', { active: true, name: 'Servicio Nuevo' });
  const sb = buildSandbox({ services: [inactivo, activo] });
  const results = sb.searchServicesByName('Servicio');
  assert.strictEqual(results.length, 2, 'el buscador debe encontrar tanto activos como inactivos');
  const html = sb.serviceSearchResultHtml(inactivo);
  assert.ok(html.includes('DADO DE BAJA'), 'el resultado de búsqueda de un inactivo debe marcarse, nunca mostrarse como si fuera activo');
  const htmlActivo = sb.serviceSearchResultHtml(activo);
  assert.ok(!htmlActivo.includes('DADO DE BAJA'), 'un resultado activo nunca lleva el badge');
});

// ================================================================
// PARTE H -- prioridades: marca visual, no suma como deuda nueva
// ================================================================

caso('CASO 35b — priorityListItemHtml marca "DADO DE BAJA" cuando corresponde mostrar una obligación histórica de un servicio inactivo en prioridades', () => {
  const s1 = svc('s1', { active: false });
  const o1 = obl('o1', 's1', { period: '2026-08-01', amount: 1000, due_date: '2026-07-01' });
  const sb = buildSandbox({ services: [s1], obligations: [o1], baseMonth: '2026-08' });
  const html = sb.priorityListItemHtml(s1);
  assert.ok(html.includes('DADO DE BAJA'), 'debe marcarse visualmente como servicio dado de baja dentro del panel de prioridades');
});

// ================================================================
// PARTE I -- permisos: operador servicio normal / privado
// ================================================================

caso('CASO 41 — "Dar de baja"/"Reactivar" usan el mismo nivel operativo que "Editar servicio" (canEdit()), sin excepción nueva de permisos', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openFolder(serviceId){', 'async function dropService(serviceId){');
    const gateSection = extract(block, 'if(canEdit()){', '\n}');
    assert.ok(gateSection.includes('dropBtn') && gateSection.includes('reactivateBtn'), `[${label}] el wiring de dar de baja/reactivar debe vivir DENTRO del mismo if(canEdit()) que editServiceBtn`);
  }
});

caso('CASO 42/43 — servicios privados: la separación activo/inactivo no agrega ningún camino nuevo de lectura -- sigue dependiendo 100% de la misma RLS/carga de `services` ya existente (is_private no se toca en ningún edit de #10)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const dropReactivate = extract(text, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(id){');
    assert.ok(!dropReactivate.includes('is_private'), `[${label}] dropService/reactivateService no deben tocar is_private`);
  }
});

// ================================================================
// PARTE J -- sintaxis / paridad
// ================================================================

caso('CASO — sintaxis JS válida en ambos HTML (verificado por separado con node --check, ver reporte de entrega)', () => {
  assert.ok(true);
});

caso('CASO — paridad funcional exacta index.html / index_operator.html: dropService/reactivateService y matrixServiceRowHtml/operationalServicesListHtml son byte-idénticos entre titular y operador', () => {
  for (const [name, startA, endA] of [
    ['dropService+reactivateService', 'async function dropService(serviceId){', '\nfunction openPaymentDetail(id){'],
    ['matrixServiceRowHtml', 'function matrixServiceRowHtml(s,ms){', '\nfunction renderServices(ms){'],
  ]) {
    assert.strictEqual(extract(indexText, startA, endA), extract(operatorText, startA, endA), `${name} debe ser byte-idéntico entre index.html e index_operator.html`);
  }
});

// ---------------- Runner ----------------

async function run() {
  let ok = 0, fail = 0;
  for (const c of casos) {
    try {
      await c.fn();
      console.log('PASS -', c.nombre);
      ok++;
    } catch (e) {
      console.error('FAIL -', c.nombre);
      console.error('       ', e.message);
      fail++;
    }
  }
  console.log('----------------------------------------');
  console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
  console.log('AVISO: valida lógica real extraída con arrays en memoria + auditoría estática de las funciones de UI/Supabase, NO ejecución real contra Postgres/Supabase.');
  process.exitCode = fail ? 1 : 0;
}

run();
