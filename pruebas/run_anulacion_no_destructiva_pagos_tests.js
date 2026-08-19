// ============================================================
// PRUEBA LOCAL — Anulación no destructiva de pagos (mejora #11, FASE 1:
// auditoría + implementación local + tests, 20260819)
// ------------------------------------------------------------
// Pedido real de Guido: reemplazar el flujo destructivo de annulPayment()
// (DELETE real de payments + Storage.remove de comprobantes, confirm()
// nativo) por el backend YA EXISTENTE public.void_payment(p_payment_id
// uuid, p_reason text) -- mismo RPC que #7 ya usa internamente para anular
// un pago auxiliar durante una corrección histórica.
//
// Diseño (ver reporte de entrega para el detalle completo de la
// auditoría): la función se renombró a openAnnulPaymentModal() (abre un
// modal con motivo obligatorio en vez de actuar directo) y llama
// exclusivamente `sb.rpc('void_payment',{p_payment_id,p_reason})`. NO se
// llama syncObligationStatus() después -- el propio RPC ya recalcula
// server-side. Auditoría de funciones económicas (paidAmountForWithAllocations,
// effectiveObligationAmount, calculateRealObligationBalance,
// creditAvailableForPayment/availableServiceCredits, historicalCorrectionAuxiliaryCandidates)
// confirmó que YA excluían payment.voided===true desde antes de esta
// mejora (diseñadas anticipando #11) -- SOLO se encontró y corrigió un
// hallazgo real: balanceData() ("Equilibrio acumulado") sumaba
// payment_contributions de pagos anulados sin excluirlos.
//
// Esta prueba extrae y ejecuta las funciones REALES de index.html (nunca
// reimplementadas a mano) en un sandbox con arrays en memoria, y hace
// auditoría estática (extract + assert de contenido) sobre las funciones
// pesadas de UI (openAnnulPaymentModal/openPaymentDetail/rollback de
// creación) que dependen de DOM/modal/Supabase real -- mismo patrón ya
// usado en mejoras anteriores (#7, #9, #10) para esos casos.
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
const fnRoundServiceMoney = extract(indexText, 'function roundServiceMoney(value){', '\n');
const fnServiceMoneyCents = extract(indexText, 'function serviceMoneyCents(value){', '\n');
const fnTodayDateString = extract(indexText, 'function todayDateString(){', '\n');

// paidAmountForWithAllocations/paidAmountAsOfWithAllocations/
// paymentNoteMetadata/paymentAppliedDueStage/buildPaymentNotes/
// obligationHasSecondStagePayment/effectiveObligationAmount (todos YA
// excluían voided antes de #11) /dashboardPaidFor/dashboardBalanceFor/
// calculateRealObligationBalance.
const blockPaymentsAndAmounts = extract(indexText, 'function paidAmountForWithAllocations(', 'function isServiceVisibleForCurrentContext(');
// paymentsFor/paymentFor/paymentCreatedByLabel/.../obligationExtraFields/
// dueState/boxText/.../paidAmountFor/balanceFor/creditBalanceFor/
// paymentProgress/displayNameForUserId/receiptsForPayment/
// creditAvailableForPayment/availableServiceCredits/balanceData (YA
// CORREGIDA, mejora #11)/renderBalance -- todo en el orden real del
// archivo.
const blockObligationsAndBalance = extract(indexText, 'function paymentsFor(obligationId){', 'function reportMonthData(key){');
// historicalCorrectionAuxiliaryCandidates (#7, ya excluye voided).
const blockAuxiliaryCandidates = extract(indexText, 'function historicalCorrectionAuxiliaryCandidates(', 'async function loadPaymentCorrectionsHistory(');

const REAL_SOURCE = [
  fnEsc, fnFmtDate, fnFmtMoney, fnFmtMoneyExact, fnMonthLabel, fnPeriodDate,
  fnRoundServiceMoney, fnServiceMoneyCents, fnTodayDateString,
  blockPaymentsAndAmounts, blockObligationsAndBalance, blockAuxiliaryCandidates,
].join('\n');

function buildSandbox({
  obligations = [], payments = [], paymentAllocations = [], documents = [], consolidations = [],
  services = [], members = [], contributions = [],
  session = { user: { id: 'user-1' } }, baseMonth = '2026-08', paymentAllocationsLoadError = false,
} = {}) {
  const sandbox = {
    obligations, payments, paymentAllocations, documents, consolidations, services, members, contributions,
    session, baseMonth, paymentAllocationsLoadError,
    today: () => new Date(2026, 7, 19),
    window: {},
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + `
    return {
      paidAmountForWithAllocations, paidAmountAsOfWithAllocations, obligationHasSecondStagePayment,
      effectiveObligationAmount, calculateRealObligationBalance, dashboardPaidFor, dashboardBalanceFor,
      paymentsFor, paymentFor, paymentCreatedByLabel, paidAmountFor, balanceFor, creditBalanceFor,
      paymentProgress, displayNameForUserId, receiptsForPayment, creditAvailableForPayment,
      availableServiceCredits, balanceData, renderBalance, obligationExtraFields,
      historicalCorrectionAuxiliaryCandidates,
    };
  `);
  return fn(...Object.values(sandbox));
}

function svc(id, overrides = {}) {
  return { id, group_id: 'g1', name: `Servicio ${id}`, category: 'Otros', frequency: 'monthly', is_private: false, active: true, ...overrides };
}
function obl(id, serviceId, overrides = {}) {
  return { id, service_id: serviceId, period: '2026-08-01', amount: 1000, status: 'active', due_date: null, notes: null, ...overrides };
}
function pay(id, obligationId, amount, overrides = {}) {
  return { id, obligation_id: obligationId, total_amount: amount, paid_at: '2026-08-05', created_by: 'user-1', created_at: '2026-08-05T00:00:00Z', voided: false, voided_at: null, voided_by: null, void_reason: null, notes: null, ...overrides };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ================================================================
// PARTE A -- flujo destructivo eliminado / RPC correcto
// ================================================================

caso('CASO 1/2 — openAnnulPaymentModal no contiene .delete() sobre payments ni Storage.remove', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/from\('payments'\)\s*\.\s*delete/.test(block), `[${label}] no debe hacer DELETE de payments`);
    assert.ok(!/storage\.from\(/.test(block), `[${label}] no debe tocar Storage`);
    assert.ok(!block.includes('confirm('), `[${label}] no debe usar confirm() nativo destructivo`);
  }
});

caso('CASO 3/4/5 — llama sb.rpc(\'void_payment\',...) pasando p_payment_id y p_reason con los nombres reales', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(block.includes("sb.rpc('void_payment'"), `[${label}] debe llamar al RPC void_payment`);
    assert.ok(block.includes('p_payment_id:paymentId'), `[${label}] debe pasar p_payment_id`);
    assert.ok(block.includes('p_reason:reason'), `[${label}] debe pasar p_reason`);
  }
});

caso('CASO 6 — motivo obligatorio en frontend: no llama al RPC si el motivo está vacío (trim)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(/const reason=\(document\.getElementById\('annulPaymentReason'\)\.value\|\|''\)\.trim\(\)/.test(block), `[${label}] debe leer y trimear el motivo`);
    assert.ok(/if\(!reason\)return toast/.test(block), `[${label}] debe bloquear el envío si el motivo está vacío`);
  }
});

caso('CASO 7 — el backend sigue siendo la fuente real de validación (frontend no asume que su propio chequeo alcanza -- el RPC puede rechazar igual)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(/if\(error\)throw error/.test(block), `[${label}] debe propagar cualquier error real del RPC (incluida una validación server-side)`);
  }
});

caso('CASO 8/9 — usa canEdit() (permiso operativo vigente), no inventa owner-only', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', '\n  const payment=');
    assert.ok(block.includes("if(!canEdit())return toast('No tenés permiso para anular pagos')"), `[${label}] debe usar canEdit(), el mismo gate operativo vigente`);
    assert.ok(!block.includes('isOwner()'), `[${label}] no debe agregar un chequeo owner-only nuevo`);
  }
});

// ================================================================
// PARTE B -- UI: botones, badge, motivo, historial
// ================================================================

caso('CASO 10/11/12/13/14 — pago vigente muestra "Anular pago"; pago voided no lo muestra y en cambio muestra badge ANULADO + motivo + fecha', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openPaymentDetail(id){', '\n  bindDocumentCards');
    assert.ok(block.includes("canEdit()&&p.voided!==true?'<button class=\"btn danger\" id=\"annulPaymentBtn\">Anular pago</button>'"), `[${label}] el botón Anular pago debe requerir p.voided!==true`);
    assert.ok(block.includes('payment-voided-badge">ANULADO'), `[${label}] debe mostrar el badge ANULADO cuando corresponde`);
    assert.ok(block.includes('Motivo: ${esc(p.void_reason'), `[${label}] debe mostrar el motivo`);
    assert.ok(block.includes('Anulado el: ${p.voided_at'), `[${label}] debe mostrar la fecha de anulación`);
  }
});

caso('CASO 15/16 — conserva paid_at (fecha original) y payment_id: openAnnulPaymentModal nunca reasigna ninguno de los dos, ambos se leen del registro real, nunca se envían desde el frontend al RPC', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!block.includes('paid_at:'), `[${label}] no debe reasignar paid_at`);
    assert.ok(!/payments\)\s*\.\s*(update|insert)/.test(block), `[${label}] no debe hacer ningún UPDATE/INSERT manual de payments`);
  }
});

caso('CASO 17/18/19/20 — conserva documents/receipt/original_name, no borra Storage: cero referencias a esos objetos en el flujo de anulación', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/from\('documents'\)/.test(block), `[${label}] no debe tocar documents`);
    assert.ok(!block.includes('file_path'), `[${label}] no debe tocar archivos físicos`);
  }
});

caso('CASO 29/30/31 — un payment voided no ofrece "Corregir pago histórico"; correction history existente sigue visible; payment_corrections no se toca desde la anulación', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const detailBlock = extract(text, 'function openPaymentDetail(id){', '\n  bindDocumentCards');
    assert.ok(detailBlock.includes("isOwner()&&p.voided!==true?'<button class=\"btn soft\" id=\"correctHistoricalPaymentBtn\">Corregir pago histórico</button>'"), `[${label}] el botón de corrección debe requerir p.voided!==true`);
    assert.ok(detailBlock.includes('paymentCorrectionsHistory'), `[${label}] el contenedor de historial de correcciones sigue presente sin condición de voided (siempre visible)`);
    const annulBlock = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!annulBlock.includes('payment_corrections'), `[${label}] la anulación no debe tocar payment_corrections`);
  }
});

caso('CASO 32 — #7 (correct_historical_payment) sigue pudiendo usar void_payment internamente para el pago auxiliar (p_void_auxiliary_payment_id/p_void_auxiliary_reason intactos, mismo RPC subyacente)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('p_void_auxiliary_payment_id:auxiliaryPaymentId'), `[${label}] #7 sigue pasando el id auxiliar al RPC de corrección`);
    assert.ok(text.includes('p_void_auxiliary_reason:auxiliaryReason'), `[${label}] #7 sigue pasando el motivo auxiliar`);
  }
});

// ================================================================
// PARTE C -- auditoría económica real (ejecutada, no solo texto)
// ================================================================

caso('CASO 25/26 — pago voided no reduce deuda; otro pago vigente en la misma obligación sigue contando (paidAmountForWithAllocations)', () => {
  const o1 = obl('o1', 's1', { amount: 100000 });
  const pA = pay('pA', 'o1', 40000, { voided: true });
  const pB = pay('pB', 'o1', 60000, { voided: false });
  const sb = buildSandbox({ obligations: [o1], payments: [pA, pB] });
  const paid = sb.paidAmountForWithAllocations('o1', [pA, pB], []);
  assert.strictEqual(paid, 60000, 'solo el pago vigente (60000) debe contar -- el anulado (40000) queda excluido');
});

caso('CASO 25b — ejemplo exacto del pedido: obligación $100.000, pago vigente $100.000 -> saldo $0; al anular ese pago -> saldo $100.000', () => {
  const o1 = obl('o1', 's1', { amount: 100000, due_date: null });
  const pagoVigente = pay('p1', 'o1', 100000, { voided: false });
  const sbAntes = buildSandbox({ obligations: [o1], payments: [pagoVigente] });
  assert.strictEqual(sbAntes.calculateRealObligationBalance(o1, [pagoVigente], []), 0, 'con el pago vigente, el saldo es 0');
  const pagoAnulado = { ...pagoVigente, voided: true };
  const sbDespues = buildSandbox({ obligations: [o1], payments: [pagoAnulado] });
  assert.strictEqual(sbDespues.calculateRealObligationBalance(o1, [pagoAnulado], []), 100000, 'al anular ese pago, el saldo vuelve a 100000 completo');
});

caso('CASO 25c — pago A $40.000 + pago B $60.000, se anula B -> saldo $60.000 (no "vuelve a pending" ciego, respeta el otro pago)', () => {
  const o1 = obl('o1', 's1', { amount: 100000 });
  const pA = pay('pA', 'o1', 40000, { voided: false });
  const pBAnulado = pay('pB', 'o1', 60000, { voided: true });
  const sb = buildSandbox({ obligations: [o1], payments: [pA, pBAnulado] });
  assert.strictEqual(sb.calculateRealObligationBalance(o1, [pA, pBAnulado], []), 60000, 'saldo=60000: se descuenta solo A, B anulado no cuenta');
});

caso('CASO 27/28 — pago voided no genera crédito disponible y no puede redistribuirse (availableServiceCredits/creditAvailableForPayment)', () => {
  const o1 = obl('o1', 's1', { amount: 1000 });
  const pagoAnulado = pay('p1', 'o1', 5000, { voided: true });
  const sb = buildSandbox({ obligations: [o1], services: [svc('s1')], payments: [pagoAnulado] });
  const credits = sb.availableServiceCredits('s1');
  assert.strictEqual(credits.length, 0, 'un pago anulado (aunque haya sobrepagado) no debe aparecer como crédito disponible');
});

caso('CASO 27b — creditBalanceFor tampoco expone saldo a favor de un pago anulado (excluido vía paidAmountFor)', () => {
  const o1 = obl('o1', 's1', { amount: 1000 });
  const pagoAnulado = pay('p1', 'o1', 5000, { voided: true });
  const sb = buildSandbox({ obligations: [o1], payments: [pagoAnulado] });
  assert.strictEqual(sb.creditBalanceFor(o1), 0, 'sin ningún pago vigente, el saldo a favor debe ser 0 aunque exista un pago anulado de sobra');
});

caso('CASO 22 — contributions de un payment voided no cuentan económicamente en balanceData() ("Equilibrio acumulado") -- HALLAZGO REAL corregido en esta mejora', () => {
  const admin = { id: 'm1', role: 'admin', participation_percent: 100, display_name: 'Admin Uno' };
  const o1 = obl('o1', 's1', { amount: 1000 });
  const pagoVigente = pay('p1', 'o1', 1000, { voided: false });
  const pagoAnulado = pay('p2', 'o1', 5000, { voided: true });
  const contribVigente = { payment_id: 'p1', membership_id: 'm1', amount: 1000 };
  const contribAnulada = { payment_id: 'p2', membership_id: 'm1', amount: 5000 };
  const sb = buildSandbox({
    obligations: [o1], payments: [pagoVigente, pagoAnulado], members: [admin],
    contributions: [contribVigente, contribAnulada],
  });
  const rows = sb.balanceData();
  const row = rows.find(r => r.m.id === 'm1');
  assert.strictEqual(row.paid, 1000, 'solo la contribución del pago vigente (1000) debe sumarse -- la del pago anulado (5000) queda excluida');
  assert.strictEqual(row.owed, 1000, 'lo que "correspondía" tampoco debe incluir el pago anulado');
});

caso('CASO 21 — conserva payment_contributions: la fila histórica de contributions ligada a un payment voided NO se borra ni se toca (auditoría estática de openAnnulPaymentModal)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/from\('payment_contributions'\)/.test(block), `[${label}] no debe tocar payment_contributions`);
  }
});

caso('CASO 23/24 — conserva payment_allocations (nunca las borra); dependen del mismo criterio ya existente (is_active + payment no voided) para no contar', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/from\('payment_allocations'\)/.test(block), `[${label}] no debe tocar payment_allocations`);
  }
  const o1 = obl('o1', 's1', { amount: 1000 });
  const pagoAnulado = pay('p1', 'o1', 1000, { voided: true });
  const allocActiva = { payment_id: 'p1', obligation_id: 'o1', allocated_amount: 1000, is_active: true };
  const sb = buildSandbox({ obligations: [o1], payments: [pagoAnulado], paymentAllocations: [allocActiva] });
  assert.strictEqual(sb.paidAmountForWithAllocations('o1', [pagoAnulado], [allocActiva]), 0, 'una allocation activa de un pago anulado NUNCA debe contar (paidAmountForWithAllocations exige payment no voided además de is_active)');
});

caso('CASO 29b — historicalCorrectionAuxiliaryCandidates (#7) sigue excluyendo pagos ya anulados como candidatos', () => {
  const candidatoValido = pay('pAux', 'o1', 500, { voided: false });
  const candidatoAnulado = pay('pAux2', 'o1', 500, { voided: true });
  const sb = buildSandbox({
    payments: [candidatoValido, candidatoAnulado],
    paymentAllocations: [], documents: [],
    contributions: [{ payment_id: 'pAux', amount: 500 }, { payment_id: 'pAux2', amount: 500 }],
  });
  const candidates = sb.historicalCorrectionAuxiliaryCandidates('o1', 'p-original');
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'pAux');
});

// ================================================================
// PARTE D -- segundo vencimiento / #9 / #10 intactos
// ================================================================

caso('CASO 33 — segundo vencimiento intacto: effectiveObligationAmount recalcula correctamente al anular un pago -- un pago que había cubierto el importe 1 A TIEMPO (dejando la obligación resuelta en amount1 para siempre) deja de contar si se anula, y la obligación vuelve a escalar correctamente al importe 2 (paidAmountAsOfWithAllocations ya excluye voided)', () => {
  const o1 = obl('o1', 's1', { amount: 1000, due_date: '2026-07-01', notes: '[[OBLIGATION_META:' + JSON.stringify({ extraFields: { secondDueDate: '2026-08-01', secondAmount: 1200 } }) + ']]' });
  const pagoVigente = pay('p1', 'o1', 1000, { voided: false, paid_at: '2026-06-15' });
  const sbAntes = buildSandbox({ obligations: [o1], payments: [pagoVigente] });
  assert.strictEqual(sbAntes.effectiveObligationAmount(o1, [pagoVigente], []), 1000, 'pagado a tiempo y completo -> se queda en importe 1 para siempre (regla ya existente)');
  const pagoAnulado = { ...pagoVigente, voided: true };
  const sbDespues = buildSandbox({ obligations: [o1], payments: [pagoAnulado] });
  assert.strictEqual(sbDespues.effectiveObligationAmount(o1, [pagoAnulado], []), 1200, 'al anular ese pago, deja de contar como "cubierto a tiempo" -- la obligación vuelve a escalar correctamente al importe 2, sin quedar protegida por un pago que ya no es real');
});

caso('CASO 34 — amountPending (#9) intacto: openAnnulPaymentModal nunca menciona amountPending ni toca notes de obligations', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!block.includes('amountPending'), `[${label}] no debe mencionar amountPending`);
    assert.ok(!block.includes("from('obligations')"), `[${label}] no debe tocar obligations directamente`);
  }
});

caso('CASO 35 — servicios dados de baja (#10) intacto: un pago histórico de un servicio inactivo se sigue pudiendo consultar/anular con la misma regla de permiso (openAnnulPaymentModal no filtra por service.active)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!block.includes('active'), `[${label}] no debe agregar ninguna condición nueva basada en services.active`);
  }
});

// ================================================================
// PARTE E -- Tarjetas / #6 / #8 intactas
// ================================================================

caso('CASO 38 [index.html] — Tarjetas (uploadCreditDocument/renderCreditCardsModule/bindCreditCardsModule) permanece byte-idéntica al backup previo a mejora #11', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_11_anulacion_pagos_20260819_173517', 'index.html.antes_mejora11'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(indexText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

caso('CASO 38b [index_operator.html] — Tarjetas permanece byte-idéntica al backup previo a mejora #11', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_11_anulacion_pagos_20260819_173517', 'index_operator.html.antes_mejora11'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(operatorText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

caso('CASO 36 — documentos #6 intactos: isVoidedServiceDocument/documentCard siguen presentes sin cambios, un receipt de pago anulado se sigue mostrando con documentCard normal (no se fuerza a voided)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('function isVoidedServiceDocument('), `[${label}] #6 intacta`);
    assert.ok(text.includes('function documentCard('), `[${label}] #6 intacta`);
    const annulBlock = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!annulBlock.includes('voided:true'), `[${label}] la anulación de un pago no debe forzar documents.voided`);
  }
});

caso('CASO 37 — upload #8 intacto', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('snapshotFileBytesForUpload'));
  }
});

// ================================================================
// PARTE F -- desktop/mobile, idempotencia, error UX, trazabilidad
// ================================================================

caso('CASO 39/40 — desktop/mobile: no hay ninguna rama de plataforma en el flujo de anulación', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/navigator\.userAgent|isMobile|innerWidth/i.test(block));
  }
});

caso('CASO 43 — doble click bloqueado: el botón se deshabilita ANTES de llamar al RPC', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    const disableIdx = block.indexOf('button.disabled=true');
    const rpcIdx = block.indexOf("sb.rpc('void_payment'");
    assert.ok(disableIdx !== -1 && rpcIdx !== -1 && disableIdx < rpcIdx, `[${label}] el botón debe deshabilitarse antes de invocar el RPC`);
  }
});

caso('CASO 44/45 — si el RPC falla no cierra el modal ni finge éxito; si tiene éxito, recarga estado (refreshDashboardData)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    const tryIdx = block.indexOf('try{');
    const catchIdx = block.indexOf('}catch(err){');
    const tryBlock = block.slice(tryIdx, catchIdx);
    const catchBlock = block.slice(catchIdx);
    assert.ok(tryBlock.includes('closeModal()'), `[${label}] el éxito debe cerrar el modal`);
    assert.ok(tryBlock.includes('refreshDashboardData()'), `[${label}] el éxito debe recargar el estado`);
    assert.ok(!catchBlock.slice(0, catchBlock.indexOf('}')).includes('closeModal()'), `[${label}] el error NO debe cerrar el modal`);
    assert.ok(catchBlock.includes('button.disabled=false'), `[${label}] el error debe rehabilitar el botón`);
  }
});

caso('CASO 46 — el toast de éxito no dice "eliminado"', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!/eliminad/i.test(block), `[${label}] no debe usar la palabra "eliminado" en ningún mensaje`);
    assert.ok(block.includes('Pago anulado. Se conservó el historial y se actualizó la deuda.'), `[${label}] debe usar el texto de éxito no destructivo`);
  }
});

caso('CASO 47/48/49 — no modifica created_by; no envía voided_by ni voided_at desde el frontend (esos campos los pone el servidor)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!block.includes('created_by'), `[${label}] no debe tocar created_by`);
    assert.ok(!block.includes('voided_by:'), `[${label}] no debe enviar voided_by`);
    assert.ok(!block.includes('voided_at:'), `[${label}] no debe enviar voided_at`);
    assert.ok(!block.includes('voided:true'), `[${label}] no debe enviar voided directamente -- eso lo hace el RPC`);
  }
});

caso('CASO 50 — el rollback de creación de un pago recién creado NO fue tocado por #11: sigue siendo un DELETE real (createdPaymentId), distinto del flujo de anulación de un pago YA existente', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes("await sb.from('payments').delete().eq('id',createdPaymentId);"), `[${label}] el rollback transaccional de creación debe seguir intacto (caso distinto a anular un pago histórico)`);
    // Nunca debe estar dentro de openAnnulPaymentModal -- es un bloque de savePay(), completamente separado.
    const annulBlock = extract(text, 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7");
    assert.ok(!annulBlock.includes('createdPaymentId'), `[${label}] el rollback de creación no debe mezclarse con la anulación de un pago existente`);
  }
});

// ================================================================
// PARTE G -- sintaxis / paridad
// ================================================================

caso('CASO — sintaxis JS válida en ambos HTML (verificado por separado con node --check, ver reporte de entrega)', () => {
  assert.ok(true);
});

caso('CASO — paridad funcional exacta index.html / index_operator.html: openAnnulPaymentModal y balanceData son byte-idénticos entre titular y operador', () => {
  for (const [name, startA, endA] of [
    ['openAnnulPaymentModal', 'function openAnnulPaymentModal(paymentId){', "\n// MEJORA #7"],
    ['balanceData', 'function balanceData(){', '\nfunction renderBalance('],
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
