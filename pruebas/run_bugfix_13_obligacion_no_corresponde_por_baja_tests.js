// ============================================================
// PRUEBA LOCAL — BUGFIX #13 FASE 4: obligación pendiente que dejó de
// corresponder pagar por baja del servicio (20260821)
// ------------------------------------------------------------
// Caso real que motiva esta FASE (aclarado por Guido): Argentina Virtual
// es un servicio "mes a vencer" (service_id
// 209b9202-a858-4c31-ad22-f19b2e358463, GR, active=false). Se cargó una
// obligación/deuda (Julio 2026, $1) y se dio de baja el servicio ANTES
// de que correspondiera abonarla -- esa obligación puntual ya NO
// corresponde pagar, pero NO debe borrarse, ni marcarse pagada, ni
// generar un pago ficticio.
//
// DISEÑO (ver informe de entrega para la auditoría completa): se
// reutiliza EXACTAMENTE el mecanismo no destructivo YA EXISTENTE de
// anulación de obligaciones -- annulObligationMonth() (mejora #6/6B4.15):
// UPDATE obligations SET status='cancelled', notes=merge(...,{voided:
// {voidedBy,voidedAt,voidReason}}) -- preserva obligation/pagos/
// documentos/Storage, exige motivo, registra quién y cuándo. NO se creó
// un segundo mecanismo de anulación. Se auditó (y se confirma con
// sandbox real más abajo) que TODAS las fuentes de cálculo de deuda ya
// excluían status==='cancelled' desde antes de esta FASE: carriedDebts()/
// pendingObligations(), isEffectivePending(), previousBalanceFor(),
// servicePriorityCategory()/computeServicePriorityCategories(),
// dashboardMetricsForGroup(), getVisibleObligationsForCurrentContext() --
// no hizo falta tocar ninguna.
//
// Lo único nuevo de esta FASE es la UX: dropService() ya NO asume que
// dar de baja implica que las deudas dejaron de corresponder -- si
// quedan obligaciones pendientes reales (isEffectivePending), abre
// openServiceObligationsReviewModal() para decidir explícitamente,
// período por período: "Mantener como deuda" (no escribe nada) o
// "No corresponde pagar" (motivo obligatorio, vía annulObligationMonth
// real). Si la obligación ya tiene algún pago activo asociado, NO se
// ofrece el atajo -- se exige revisión manual abriendo el período.
//
// Esta prueba audita el TEXTO REAL de index.html/index_operator.html y
// ejecuta funciones puras reales extraídas en sandbox (con arrays en
// memoria, incluyendo una obligación con status='cancelled' como fixture
// de "ya no corresponde pagar"). NO se ejecutó SQL, NO se modificó
// Supabase, NO se tocó el servicio real Argentina Virtual.
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

// ---------------- Sandbox de las funciones reales del frontend ----------------

function buildRealSource(text) {
  const fnPeriodDate = extract(text, 'function periodDate(key){', '\n');
  const fnMonthLabel = extract(text, 'function monthLabel(key){', '\n');
  const fnFmtMoneyExact = extract(text, 'function fmtMoneyExact(v){', '\n');
  const fnRoundServiceMoney = extract(text, 'function roundServiceMoney(value){', '\n');
  const fnServiceMoneyCents = extract(text, 'function serviceMoneyCents(value){', '\n');
  const fnToday = extract(text, 'function today(){', '\n');
  const fnDaysUntil = extract(text, 'function daysUntil(v){', '\n');
  const fnTodayDateString = extract(text, 'function todayDateString(){', '\n');
  const constMonths = extract(text, 'const MONTHS=', '\n');
  const blockPaymentsAndAmounts = extract(text, 'function paidAmountForWithAllocations(', 'function isServiceVisibleForCurrentContext(');
  const blockObligationsCore = extract(text, 'function obligationFor(serviceId,key){', 'function lastKnownAmount(');
  // pendingObligations/carriedDebts (+ monthTotals/monthQuickSummary de paso).
  const blockDebts = extract(text, 'function pendingObligations(){', '\nasync function openStoredDocument(');
  // DUE_SOON_DAYS, servicePriorityCategory, computeServicePriorityCategories,
  // PRIORITY_CATEGORY_META/ORDER.
  const blockPriorities = extract(text, 'const DUE_SOON_DAYS=7;', 'function priorityPanelHtml(');

  return [
    fnPeriodDate, fnMonthLabel, fnFmtMoneyExact, fnRoundServiceMoney, fnServiceMoneyCents,
    fnToday, fnDaysUntil, fnTodayDateString, constMonths,
    blockPaymentsAndAmounts, blockObligationsCore, blockDebts, blockPriorities,
  ].join('\n');
}

const REAL_SOURCE_INDEX = buildRealSource(indexText);
const REAL_SOURCE_OPERATOR = buildRealSource(operatorText);

function buildSandbox(realSource, { obligations = [], payments = [], paymentAllocations = [], documents = [], consolidations = [], services = [], members = [], session = { user: { id: 'user-1' } }, baseMonth = '2026-08', paymentAllocationsLoadError = false } = {}) {
  const sandbox = {
    obligations, payments, paymentAllocations, documents, consolidations, services, members, session, baseMonth,
    paymentAllocationsLoadError,
    window: {},
  };
  const fn = new Function(...Object.keys(sandbox), realSource + `
    return {
      obligationFor, paidAmountFor, balanceFor, creditBalanceFor, paymentProgress,
      obligationNoteMeta, obligationUserNotes, updateObligationNotes,
      obligationEditHistory, obligationExtraFields, obligationCurrency, formatObligationAmount,
      consolidationForSource, consolidationTarget, isEffectivePending, previousBalanceFor,
      dueState, boxClass, boxText,
      effectiveObligationAmount, calculateRealObligationBalance, paidAmountForWithAllocations,
      pendingObligations, carriedDebts, monthTotals, monthQuickSummary,
      servicePriorityCategory, computeServicePriorityCategories, PRIORITY_CATEGORY_META,
      roundServiceMoney, serviceMoneyCents, periodDate, monthLabel, fmtMoneyExact,
    };
  `);
  return fn(...Object.values(sandbox));
}

function buildSandboxIndex(opts) { return buildSandbox(REAL_SOURCE_INDEX, opts); }

// Helper de fixture: obligación real con OBLIGATION_META, igual formato
// que el resto de la suite de bugfix #12/#13.
function obligationMeta(extraFields, extra = {}) {
  const meta = { extraFields, ...extra };
  return `[[OBLIGATION_META:${JSON.stringify(meta)}]]`;
}
function obl({ id, service_id = 'service-1', period, amount = 0, due_date = '2026-08-10', status = 'pending', notes = null } = {}) {
  return { id, service_id, period, amount, due_date, status, notes, created_by: 'user-1' };
}
function pay({ id, obligation_id, total_amount, voided = false, paid_at = '2026-08-10' } = {}) {
  return { id, obligation_id, total_amount, voided, paid_at };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — comportamiento funcional real (sandbox), caso Argentina Virtual
// ============================================================

caso('CASO 1 — baja de servicio NO anula deudas automáticamente: annulObligationMonth() nunca se invoca desde applyServiceActiveUpdate/dropService salvo decisión explícita del usuario en el modal nuevo', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const applyBlock = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '// BUGFIX #13 FASE 4 -- DEUDA REAL');
    assert.ok(!applyBlock.includes('annulObligationMonth'), `[${label}] el UPDATE de active no debe anular obligaciones por su cuenta`);
  }
});

caso('CASO 2 — deuda real puede mantenerse: "Mantener como deuda" no escribe nada (ningún .update/.insert/.delete en su handler), la obligación permanece pendiente e isEffectivePending sigue true', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-julio', service_id: 'svc-x', period: '2026-07-01', amount: 1, due_date: '2026-07-10', status: 'pending' });
  assert.strictEqual(sb.isEffectivePending(o), true, 'antes de decidir, la obligación real (mantenida) sigue pendiente');
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const keepBlock = extract(text, "document.querySelectorAll('[data-keep-debt]')", "document.querySelectorAll('[data-not-applicable]')");
    assert.ok(!/\.update\(|\.insert\(|\.delete\(/.test(keepBlock), `[${label}] "Mantener como deuda" no debe escribir nada`);
  }
});

caso('CASO 3/4 — opción "No corresponde pagar" disponible y con motivo obligatorio: reutiliza annulObligationMonth (que exige reason no vacío antes de cualquier UPDATE)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('No corresponde pagar'));
    const notApplicableBlock = extract(text, "document.querySelectorAll('[data-not-applicable]')", '\nasync function dropService(');
    assert.ok(notApplicableBlock.includes('annulObligationMonth(obligationId,svcId,key)'));
    const annulBlock = extract(text, 'async function annulObligationMonth(obligationId,serviceId,key){', '\nfunction nowInArgentina(');
    assert.ok(annulBlock.includes("if(!reason)return toast('La anulación requiere un motivo');"), `[${label}] el motivo debe seguir siendo obligatorio`);
  }
});

caso('CASO 5/6/7 — annulObligationMonth real: la obligación NO se borra (solo UPDATE), NO se marca "paid" (queda status=cancelled, un estado propio de anulado, no de pagada), y NO crea ningún payment nuevo', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const annulBlock = extract(text, 'async function annulObligationMonth(obligationId,serviceId,key){', '\nfunction nowInArgentina(');
    assert.ok(!/\.delete\(/.test(annulBlock), `[${label}] no debe borrar la obligación`);
    assert.ok(!/from\('payments'\)\.(insert|upsert)\(/.test(annulBlock), `[${label}] no debe crear ningún payment`);
    assert.ok(annulBlock.includes(".update({status:'cancelled',notes:newNotes})"), `[${label}] debe seguir marcando status='cancelled' (anulado), nunca 'paid'`);
    assert.ok(!annulBlock.includes("status:'paid'"), `[${label}] jamás debe marcarla como pagada`);
  }
});

caso('CASO 8 — factura/documento se conserva: annulObligationMonth no toca la tabla documents en absoluto', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const annulBlock = extract(text, 'async function annulObligationMonth(obligationId,serviceId,key){', '\nfunction nowInArgentina(');
    assert.ok(!/from\('documents'\)/.test(annulBlock), `[${label}] no debe tocar documents`);
  }
});

caso('CASO 9 — Storage no se toca: ni annulObligationMonth ni el modal nuevo referencian storage/bucket', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const annulBlock = extract(text, 'async function annulObligationMonth(obligationId,serviceId,key){', '\nfunction nowInArgentina(');
    const reviewBlock = extract(text, 'function openServiceObligationsReviewModal(', '\nasync function dropService(');
    assert.ok(!/\.storage\.|bucket/i.test(annulBlock + reviewBlock), `[${label}] no debe referenciar Storage/bucket`);
  }
});

caso('CASO 10/11/12/13 — obligación anulada (status=cancelled) deja carriedDebts(), deja saldo pendiente (isEffectivePending=false), deja prioridades (servicePriorityCategory=null vía cls voided), y no pasa a meses siguientes (previousBalanceFor no la incluye)', () => {
  const sb = buildSandboxIndex({
    baseMonth: '2026-08',
    services: [{ id: 'svc-av', name: 'Argentina Virtual', group_id: 'g1', active: false, frequency: 'monthly', category: 'Otro' }],
    obligations: [
      obl({ id: 'o-julio', service_id: 'svc-av', period: '2026-07-01', amount: 1, due_date: '2026-07-10', status: 'cancelled', notes: obligationMeta({}, { voided: { voidedBy: 'user-1', voidedAt: '2026-08-21T00:00:00.000Z', voidReason: 'Servicio dado de baja antes del período a vencer. No corresponde pagar.' } }) }),
    ],
  });
  const o = sb.obligationFor('svc-av', '2026-07');
  assert.strictEqual(sb.isEffectivePending(o), false, 'una obligación cancelada nunca es "pendiente efectiva"');
  assert.deepStrictEqual(sb.carriedDebts().map(x => x.id), [], 'no debe aparecer en Deudas arrastradas');
  const prev = sb.previousBalanceFor('svc-av', '2026-08');
  assert.strictEqual(sb.serviceMoneyCents(prev.total), 0, 'no debe arrastrarse como saldo de meses siguientes');
  const category = sb.servicePriorityCategory({ id: 'svc-av', active: false, frequency: 'monthly' }, '2026-07');
  assert.strictEqual(category, null, 'una obligación anulada no debe ocupar ninguna categoría de prioridad');
});

caso('CASO 14/15 — la obligación sigue siendo consultable como historial (obligationFor la sigue devolviendo, con su editHistory/voided real) y la trazabilidad queda completa: quién, cuándo y motivo', () => {
  const notes = obligationMeta({}, { voided: { voidedBy: 'user-1', voidedAt: '2026-08-21T12:00:00.000Z', voidReason: 'Servicio dado de baja antes del período a vencer. No corresponde pagar.' } });
  const o = obl({ id: 'o-julio', service_id: 'svc-av', period: '2026-07-01', amount: 1, status: 'cancelled', notes });
  const sbWithData = buildSandboxIndex({ obligations: [o] });
  assert.strictEqual(sbWithData.obligationFor('svc-av', '2026-07'), o, 'la obligación sigue siendo consultable como historial, nunca desaparece');
  const voidInfo = JSON.parse(o.notes.slice('[[OBLIGATION_META:'.length, -2)).voided;
  assert.strictEqual(voidInfo.voidedBy, 'user-1');
  assert.ok(voidInfo.voidedAt);
  assert.strictEqual(voidInfo.voidReason, 'Servicio dado de baja antes del período a vencer. No corresponde pagar.');
});

caso('CASO 16 — obligación con pago activo NO se anula automáticamente desde el flujo de baja: el modal nuevo no ofrece el botón "No corresponde pagar" cuando paidAmountForWithAllocations>0, muestra aviso de revisión manual', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openServiceObligationsReviewModal(', '\nasync function dropService(');
    assert.ok(block.includes('const hasActivePayment=serviceMoneyCents(paidAmountForWithAllocations(o.id,payments,paymentAllocations))>0;'));
    assert.ok(block.includes('Tiene un pago registrado -- revisalo abriendo el período.'), `[${label}] con pago activo debe mostrar el aviso de revisión manual`);
    assert.ok(block.includes('hasActivePayment'), `[${label}] debe condicionar la decisión al pago activo`);
    const ifIdx = block.indexOf('hasActivePayment\r\n');
    const noticeIdx = block.indexOf('Tiene un pago registrado');
    const buttonIdx = block.indexOf('No corresponde pagar</button>');
    assert.ok(ifIdx !== -1 && ifIdx < noticeIdx && noticeIdx < buttonIdx, `[${label}] el aviso debe aparecer en la rama "hasActivePayment" verdadera, antes que el botón (rama falsa)`);
  }
});

caso('CASO 17/18 — el servicio sigue inactivo y NO se reactiva en ningún punto del flujo nuevo: ni dropService ni openServiceObligationsReviewModal ni annulObligationMonth llaman a applyServiceActiveUpdate(...,true)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openServiceObligationsReviewModal(', '\nasync function reactivateService(');
    assert.ok(!block.includes('applyServiceActiveUpdate(serviceId,true)'), `[${label}] este flujo no debe reactivar el servicio`);
    const annulBlock = extract(text, 'async function annulObligationMonth(obligationId,serviceId,key){', '\nfunction nowInArgentina(');
    assert.ok(!annulBlock.includes('applyServiceActiveUpdate'), `[${label}] annulObligationMonth no debe tocar active`);
  }
});

caso('CASO 19 — FASE 2 (applyServiceActiveUpdate) intacta: sigue validando exactamente 1 fila, mismo serviceId, active esperado', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(block.includes(".select('id,active')"));
    assert.ok(block.includes('rows.length===0'));
    assert.ok(block.includes('rows.length>1'));
    assert.ok(block.includes('row.id!==serviceId||row.active!==targetActive'));
  }
});

caso('CASO 20 — FASE 3 (sin períodos nuevos para servicio inactivo) intacta: isNewForInactiveService y el guard de "Cargar <mes>" siguen presentes sin cambios', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('const isNewForInactiveService=!o&&s&&s.active===false;'));
    assert.ok(text.includes('${canEdit()&&service?.active!==false?`<button class="btn primary small" data-next-invoice='));
  }
});

caso('CASO 21 — deuda real de servicio inactivo sigue visible: una obligación pendiente NO anulada de un servicio con active=false sigue en carriedDebts()', () => {
  const sb = buildSandboxIndex({
    baseMonth: '2026-08',
    obligations: [obl({ id: 'o-julio', service_id: 'svc-av', period: '2026-07-01', amount: 1, due_date: '2026-07-10', status: 'pending' })],
  });
  assert.deepStrictEqual(sb.carriedDebts().map(x => x.id), ['o-julio']);
});

caso('CASO 22 — BUGFIX #12 intacto: effectivePeriodAmount y el modal de corrección histórica siguen presentes sin cambios', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('effectivePeriodAmount'));
    assert.ok(text.includes('id="correctSamePeriodQuestion"'));
  }
});

caso('CASO 23 — documents intactos: ningún camino nuevo de esta FASE inserta/borra documents', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openServiceObligationsReviewModal(', '\nasync function reactivateService(');
    assert.ok(!/from\('documents'\)\.(insert|delete)\(/.test(block));
  }
});

caso('CASO 24 — pagos intactos: ningún camino nuevo de esta FASE inserta/borra/anula payments (la anulación de pagos sigue siendo un flujo aparte, mejora #11)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openServiceObligationsReviewModal(', '\nasync function reactivateService(');
    assert.ok(!/from\('payments'\)\.(insert|delete|update)\(/.test(block));
  }
});

caso('CASO 25 — amountPending (#9) intacto: sigue existiendo y una obligación amountPending no es confundida con "no corresponde pagar" (son conceptos distintos, campos distintos)', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-pend', service_id: 'svc-1', period: '2026-08-01', notes: obligationMeta({ amountPending: true }) });
  assert.strictEqual(sb.obligationExtraFields(o).amountPending, true);
  assert.strictEqual(o.status, 'pending', 'amountPending no cambia status -- son mecanismos independientes');
});

caso('CASO 26 — allocations intactas: paidAmountForWithAllocations (usado para decidir "tiene pago activo") sigue sumando igual, sin cálculo paralelo', () => {
  const sb = buildSandboxIndex({});
  const payments = [pay({ id: 'p-1', obligation_id: 'o-1', total_amount: 100, voided: false })];
  const allocations = [{ payment_id: 'p-1', obligation_id: 'o-1', allocated_amount: 60, is_active: true }];
  assert.strictEqual(sb.paidAmountForWithAllocations('o-1', payments, allocations), 60);
});

caso('CASO 27 — Tarjetas intacta: renderCreditCardsModule/bindCreditCardsModule/roundMoney byte-idénticas al backup previo a esta FASE', () => {
  const backupDir = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_13_fase4_obligacion_no_corresponde_20260821_234500');
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix13fase4'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix13fase4']]) {
    const before = fs.readFileSync(path.join(backupDir, suffix), 'utf8');
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(text, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
});

caso('CASO 28 — paridad exacta index.html / index_operator.html: openServiceObligationsReviewModal+dropService son byte-idénticos entre titular y operador', () => {
  const blockIndex = extract(indexText, 'function openServiceObligationsReviewModal(', '\nfunction openPaymentDetail(');
  const blockOperator = extract(operatorText, 'function openServiceObligationsReviewModal(', '\nfunction openPaymentDetail(');
  assert.strictEqual(blockIndex, blockOperator);
});

caso('CASO 29 — Argentina Virtual no está hardcodeada: la regla usa isEffectivePending/paidAmountForWithAllocations de forma genérica, sin nombre ni id fijo', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(!text.includes('Argentina Virtual'));
    assert.ok(!text.includes('209b9202-a858-4c31-ad22-f19b2e358463'));
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
  console.log('AVISO: valida lógica real extraída con arrays en memoria, NO ejecución real contra Postgres/Supabase. NO se modificó Supabase, NO se tocó el servicio real Argentina Virtual.');
  if (fail > 0) process.exitCode = 1;
}

run();
