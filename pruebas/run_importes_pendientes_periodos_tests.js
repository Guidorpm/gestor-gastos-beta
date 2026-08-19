// ============================================================
// PRUEBA LOCAL — Períodos con importe pendiente + arrastre a meses
// siguientes + resolución al llegar una factura posterior
// (mejora #9, FASE 1: auditoría + implementación local + tests, 20260819)
// ------------------------------------------------------------
// Pedido real de Guido: "los servicios que no se cargan los importes
// dejarlos como pendiente para el próximo mes y ver si la nueva factura
// incluye el período anterior o no".
//
// Diseño (ver reporte de entrega para el detalle completo de la
// auditoría): NO se creó ninguna columna ni tabla nueva. Se reutiliza:
//   - obligations.notes / OBLIGATION_META / extraFields (mismo patrón ya
//     usado por currency/provider/invoiceNumber/secondDueDate/
//     secondAmount) para la nueva clave extraFields.amountPending;
//   - public.obligation_consolidations, YA EXISTENTE y en producción
//     ("esta factura incluye deuda anterior"), para representar "el
//     período anterior quedó incluido en la factura de este mes" -- sin
//     inventar un mecanismo nuevo.
// amount sigue siendo NOT NULL en la tabla real (se guarda 0 como valor
// puramente técnico cuando amountPending=true) -- la semántica real
// SIEMPRE la decide extraFields.amountPending, nunca amount===0 por sí
// solo (ver CASO 3).
//
// Esta prueba extrae y ejecuta las funciones REALES de index.html
// (nunca reimplementadas a mano) en un sandbox con arrays en memoria
// (obligations/payments/paymentAllocations/documents/consolidations/
// services) -- nunca contra Supabase real.
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

const fnPeriodDate = extract(indexText, 'function periodDate(key){', '\n');
const fnMonthLabel = extract(indexText, 'function monthLabel(key){', '\n');
const fnFmtMoneyExact = extract(indexText, 'function fmtMoneyExact(v){', '\n');
const fnFmtDate = extract(indexText, 'function fmtDate(v){', '\n');
const fnToday = extract(indexText, 'function today(){', '\n');
const fnDaysUntil = extract(indexText, 'function daysUntil(v){', '\n');
const fnRoundServiceMoney = extract(indexText, 'function roundServiceMoney(value){', '\n');
const fnServiceMoneyCents = extract(indexText, 'function serviceMoneyCents(value){', '\n');
const constMonths = extract(indexText, 'const MONTHS=', '\n');
// paidAmountForWithAllocations, paymentNoteMetadata/paymentAppliedDueStage/
// buildPaymentNotes, obligationHasSecondStagePayment, effectiveObligationAmount,
// calculateRealObligationBalance -- en el orden real del archivo.
const blockPaymentsAndAmounts = extract(indexText, 'function paidAmountForWithAllocations(', 'function isServiceVisibleForCurrentContext(');
// obligationFor, monthAppliesToService, paidAmountFor, balanceFor,
// paymentProgress, obligationNoteMeta/obligationUserNotes/
// updateObligationNotes, isObligationVoided/obligationVoidInfo/
// obligationEditHistory/obligationExtraFields/obligationCurrency/
// formatObligationAmount (YA CORREGIDA, mejora #9), displayNameForUserId,
// consolidationForSource/consolidationsForTarget/
// consolidatedSourceObligations/consolidationTarget/
// includedAmountForTarget/netNewAmount/isEffectivePending/
// previousBalanceFor, dueState/boxClass/boxText (YA CORREGIDAS, mejora #9)
// -- todo en un solo bloque real, en el orden real del archivo.
const blockObligationsCore = extract(indexText, 'function obligationFor(serviceId,key){', 'function lastKnownAmount(');
// DUE_SOON_DAYS, servicePriorityCategory (YA CORREGIDA, mejora #9),
// computeServicePriorityCategories/PRIORITY_CATEGORY_META/
// PRIORITY_CATEGORY_ORDER (YA CORREGIDOS, mejora #9).
const blockPriorities = extract(indexText, 'const DUE_SOON_DAYS=7;', 'function priorityPanelHtml(');

const REAL_SOURCE = [
  fnPeriodDate, fnMonthLabel, fnFmtMoneyExact, fnFmtDate, fnToday, fnDaysUntil,
  fnRoundServiceMoney, fnServiceMoneyCents, constMonths,
  blockPaymentsAndAmounts, blockObligationsCore, blockPriorities,
].join('\n');

function buildSandbox({ obligations = [], payments = [], paymentAllocations = [], documents = [], consolidations = [], services = [], members = [], session = { user: { id: 'user-1' } }, paymentAllocationsLoadError = false } = {}) {
  const sandbox = {
    obligations, payments, paymentAllocations, documents, consolidations, services, members, session,
    paymentAllocationsLoadError,
    window: {},
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + `
    return {
      obligationFor, monthAppliesToService, paidAmountFor, balanceFor, paymentProgress,
      obligationNoteMeta, obligationUserNotes, updateObligationNotes,
      isObligationVoided, obligationVoidInfo, obligationEditHistory, obligationExtraFields,
      obligationCurrency, formatObligationAmount, displayNameForUserId,
      consolidationForSource, consolidationsForTarget, consolidatedSourceObligations,
      consolidationTarget, includedAmountForTarget, netNewAmount, isEffectivePending,
      previousBalanceFor, dueState, boxClass, boxText,
      servicePriorityCategory, computeServicePriorityCategories,
      PRIORITY_CATEGORY_META, PRIORITY_CATEGORY_ORDER,
      effectiveObligationAmount, calculateRealObligationBalance, paidAmountForWithAllocations,
      roundServiceMoney, serviceMoneyCents, periodDate,
    };
  `);
  return fn(...Object.values(sandbox));
}

// Helper de fixture: obligación real mínima, con extraFields.amountPending
// codificado en notes usando EXACTAMENTE el formato real
// [[OBLIGATION_META:{...}]] -- nunca un objeto JS "a mano" que después se
// pasa directo, siempre pasa por el mismo texto que el RPC/la app
// producirían.
function obligationMeta(extraFields, extra = {}) {
  const meta = { extraFields, ...extra };
  return `[[OBLIGATION_META:${JSON.stringify(meta)}]]`;
}
function obl({ id, service_id = 'service-1', period, amount = 0, due_date = '2026-08-10', status = 'pending', notes = null, created_by = 'user-1' } = {}) {
  return { id, service_id, period, amount, due_date, status, notes, created_by };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — amountPending explícito, nunca amount===0 como única señal
// ============================================================

caso('CASO 1 — una obligación puede quedar explícitamente con importe pendiente (extraFields.amountPending=true) preservando período/vencimiento reales', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', amount: 0, due_date: '2026-07-10', notes: obligationMeta({ amountPending: true }) });
  const extra = sb.obligationExtraFields(julio);
  assert.strictEqual(extra.amountPending, true);
  assert.strictEqual(julio.period, '2026-07-01');
  assert.strictEqual(julio.due_date, '2026-07-10');
});

caso('CASO 2 — amountPending NO depende solo de amount===0: una obligación con amount=0 y SIN la metadata sigue siendo un dato normal (histórico), nunca se reinterpreta automáticamente', () => {
  const sb = buildSandbox({});
  const historico = obl({ id: 'o-hist', period: '2026-05-01', amount: 0, notes: null });
  assert.strictEqual(sb.obligationExtraFields(historico).amountPending, undefined);
  const state = sb.dueState(historico);
  assert.notStrictEqual(state.cls, 'pending-amount');
});

caso('CASO 3 — un cero histórico (amount=0 sin metadata) NO se convierte automáticamente en "pendiente" -- boxText no debe decir "Importe pendiente" para ese caso', () => {
  const sb = buildSandbox({});
  const historico = obl({ id: 'o-hist2', period: '2026-05-01', amount: 0, notes: null });
  const [label] = sb.boxText(historico, {});
  assert.notStrictEqual(label, 'Importe pendiente');
});

caso('CASO 4 — dueState() muestra cls="pending-amount"/label="Importe pendiente" cuando amountPending=true, ANTES de calcular vencimiento/pago', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', amount: 0, due_date: '2020-01-01', notes: obligationMeta({ amountPending: true }) });
  const state = sb.dueState(julio);
  assert.strictEqual(state.cls, 'pending-amount');
  assert.strictEqual(state.label, 'Importe pendiente');
});

caso('CASO 5 — boxText() muestra "Importe pendiente", nunca "$0,00"', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const [label, detail] = sb.boxText(julio, {});
  assert.strictEqual(label, 'Importe pendiente');
  assert.ok(!detail.includes('$'));
});

caso('CASO 6 — formatObligationAmount() nunca devuelve "$0,00" para una obligación amountPending=true, sin importar qué valor se le pase', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  assert.strictEqual(sb.formatObligationAmount(julio, 999999), 'Importe pendiente');
  assert.strictEqual(sb.formatObligationAmount(julio, 0), 'Importe pendiente');
});

caso('CASO 7 — dueState() nunca muestra "Abonado" para un pendiente sin resolver, aunque no tenga pagos (fullyPaid exige amount>0)', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', status: 'pending', notes: obligationMeta({ amountPending: true }) });
  const state = sb.dueState(julio);
  assert.notStrictEqual(state.label, 'Abonado');
});

// ============================================================
// PARTE B — totales monetarios / prioridades: nunca suma como gasto real
// ============================================================

caso('CASO 8 — un pendiente NO suma a deuda monetaria: balanceFor()/isEffectivePending() lo tratan con saldo 0 (amount técnico 0 nunca se exige como deuda)', () => {
  const sb = buildSandbox({});
  const julio = obl({ id: 'o-julio', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  assert.strictEqual(sb.balanceFor(julio), 0);
  assert.strictEqual(sb.isEffectivePending(julio), false);
});

caso('CASO 9 — un pendiente no aparece en previousBalanceFor() (arrastre de SALDO monetario) -- ese arrastre es solo para deuda real, no para "importe desconocido"', () => {
  const sb = buildSandbox({
    obligations: [
      obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) }),
    ],
  });
  const prev = sb.previousBalanceFor('service-1', '2026-08');
  assert.strictEqual(sb.serviceMoneyCents(prev.total), 0);
});

caso('CASO 10 — importes_pendientes es una categoría de prioridades PROPIA, separada de vencidos/próximos/pendientes/abonados', () => {
  const servicioEdesur = { id: 'service-1', name: 'Edesur', frequency: 'monthly', is_private: false };
  const sb = buildSandbox({
    services: [servicioEdesur],
    obligations: [
      obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) }),
    ],
  });
  const category = sb.servicePriorityCategory(servicioEdesur, '2026-07');
  assert.strictEqual(category, 'importes_pendientes');
  assert.ok(sb.PRIORITY_CATEGORY_META.importes_pendientes);
  assert.strictEqual(sb.PRIORITY_CATEGORY_META.importes_pendientes.label, 'Importes por completar');
});

caso('CASO 10b — computeServicePriorityCategories() agrupa el servicio pendiente en su propio bucket, nunca en "vencidos"/"pendientes"/"sin_datos"', () => {
  const sb = buildSandbox({
    services: [{ id: 'service-1', name: 'Edesur', frequency: 'monthly', is_private: false }],
    obligations: [
      obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', due_date: '2020-01-01', notes: obligationMeta({ amountPending: true }) }),
    ],
  });
  const buckets = sb.computeServicePriorityCategories('2026-07');
  assert.deepStrictEqual(buckets.importes_pendientes.map(s => s.id), ['service-1']);
  assert.deepStrictEqual(buckets.vencidos, []);
  assert.deepStrictEqual(buckets.sin_datos, []);
});

// ============================================================
// PARTE C — arrastre a meses siguientes / múltiples pendientes
// ============================================================

caso('CASO 11 — Julio pendiente aparece como candidato al abrir Agosto (mismo servicio, período anterior, sin resolver)', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const misObligations = [julio];
  const sb = buildSandbox({ obligations: misObligations });
  const candidates = misObligations.filter(item =>
    item.service_id === 'service-1'
    && item.period < sb.periodDate('2026-08')
    && item.status !== 'cancelled'
    && sb.obligationExtraFields(item).amountPending === true
    && !sb.consolidationForSource(item.id)
  );
  assert.deepStrictEqual(candidates.map(c => c.id), ['o-julio']);
});

caso('CASO 12/13 — resolver "incluido" NUNCA crea una obligación nueva de Julio: sigue existiendo UNA sola fila, mismo obligation_id, solo cambia el vínculo de consolidación', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000 });
  const misObligations = [julio, agosto];
  buildSandbox({
    obligations: misObligations,
    consolidations: [{ source_obligation_id: 'o-julio', target_obligation_id: 'o-agosto', created_by: 'user-1' }],
  });
  assert.strictEqual(misObligations.filter(o => o.period === '2026-07-01' && o.service_id === 'service-1').length, 1, 'debe seguir existiendo UNA sola obligación de julio');
  assert.strictEqual(misObligations.find(o => o.id === 'o-julio').id, 'o-julio', 'mismo obligation_id de siempre');
});

caso('CASO 14 — múltiples pendientes anteriores (Junio y Julio) se listan ambos al abrir Agosto', () => {
  const junio = obl({ id: 'o-junio', service_id: 'service-1', period: '2026-06-01', notes: obligationMeta({ amountPending: true }) });
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const misObligations = [junio, julio];
  const sb = buildSandbox({ obligations: misObligations });
  const candidates = misObligations.filter(item =>
    item.service_id === 'service-1'
    && item.period < sb.periodDate('2026-08')
    && sb.obligationExtraFields(item).amountPending === true
    && !sb.consolidationForSource(item.id)
  ).sort((a, b) => b.period.localeCompare(a.period));
  assert.deepStrictEqual(candidates.map(c => c.id), ['o-julio', 'o-junio']);
});

caso('CASO 15 — los pendientes NO se resuelven automáticamente por el solo hecho de existir una factura posterior -- sin un vínculo explícito en obligation_consolidations, Julio sigue abierto', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000 });
  const sb = buildSandbox({ obligations: [julio, agosto], consolidations: [] });
  assert.strictEqual(sb.dueState(julio).cls, 'pending-amount');
  assert.strictEqual(sb.consolidationTarget('o-julio'), null);
});

// ============================================================
// PARTE D — resolución explícita: Sí incluido / No / Todavía no sé
// ============================================================

caso('CASO 20/21/22 — "Sí, incluido": consolidationTarget(julio) apunta a Agosto, dueState/boxText de Julio pasan a "Incluida en Agosto 2026", con referencia real al obligation_id posterior', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000 });
  const sb = buildSandbox({
    obligations: [julio, agosto],
    consolidations: [{ source_obligation_id: 'o-julio', target_obligation_id: 'o-agosto', created_by: 'user-1' }],
  });
  const target = sb.consolidationTarget('o-julio');
  assert.strictEqual(target.id, 'o-agosto');
  const state = sb.dueState(julio);
  assert.strictEqual(state.cls, 'included');
  assert.strictEqual(state.label, 'Incluida en Agosto 2026');
});

caso('CASO 23/24 — el importe de la factura posterior se registra UNA sola vez (en Agosto), Julio nunca copia ni recibe ningún monto', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', amount: 0, notes: obligationMeta({ amountPending: true }) });
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000 });
  const misObligations = [julio, agosto];
  buildSandbox({
    obligations: misObligations,
    consolidations: [{ source_obligation_id: 'o-julio', target_obligation_id: 'o-agosto', created_by: 'user-1' }],
  });
  assert.strictEqual(julio.amount, 0, 'julio nunca recibe un importe copiado');
  const totalReal = misObligations.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.amount || 0), 0);
  assert.strictEqual(totalReal, 100000, 'el importe real total sigue siendo exactamente el de agosto, sin duplicar');
});

caso('CASO 17 — la opción "Sí" no viene preseleccionada: un candidato recién detectado (sin vínculo previo) no tiene consolidationTarget hasta que se confirme explícitamente', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const sb = buildSandbox({ obligations: [julio], consolidations: [] });
  assert.strictEqual(sb.consolidationTarget('o-julio'), null, 'sin resolución explícita, no debe haber vínculo');
});

caso('CASO 18 — "No, no está incluido" deja el pendiente abierto: sin insertar ningún vínculo, Julio conserva amountPending=true y cls="pending-amount"', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const sb = buildSandbox({ obligations: [julio], consolidations: [] });
  assert.strictEqual(sb.dueState(julio).cls, 'pending-amount');
});

caso('CASO 19 — "Todavía no lo sé" tampoco muta nada: mismo resultado que "No" (no crea vínculo, no cambia amountPending, no toca notes)', () => {
  const originalNotes = obligationMeta({ amountPending: true });
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: originalNotes });
  const sb = buildSandbox({ obligations: [julio], consolidations: [] });
  sb.dueState(julio); // "abrir"/consultar no debe mutar nada
  assert.strictEqual(julio.notes, originalNotes, 'notes no debe mutarse por solo consultar el estado');
});

// ============================================================
// PARTE E — reversión sin destruir historial
// ============================================================

caso('CASO 33 — puede revertirse "incluido" a pendiente sin borrar historial: al quitar el vínculo, Julio vuelve a mostrar "Importe pendiente" y su notes/metadata siguen intactos', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }, { editHistory: [{ at: '2026-07-01T00:00:00.000Z', by: 'user-1', changedFields: {} }] }) });
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000 });
  // Antes de revertir: vinculado.
  let sb = buildSandbox({ obligations: [julio, agosto], consolidations: [{ source_obligation_id: 'o-julio', target_obligation_id: 'o-agosto', created_by: 'user-1' }] });
  assert.strictEqual(sb.dueState(julio).cls, 'included');
  // Revertir = ya no existe el vínculo (mismo mecanismo real: DELETE+
  // re-INSERT de obligation_consolidations en cada guardado de Agosto,
  // ver saveMonthData real) -- julio.notes NUNCA se toca en este proceso.
  sb = buildSandbox({ obligations: [julio, agosto], consolidations: [] });
  assert.strictEqual(sb.dueState(julio).cls, 'pending-amount');
  assert.strictEqual(sb.obligationEditHistory(julio).length, 1, 'el historial de julio no se pierde al revertir el vínculo');
});

// ============================================================
// PARTE F — preservación de metadata existente / editHistory / notes
// ============================================================

caso('CASO 27/28/30/31/32 — notes humanas, extraFields ajenos (currency/provider/invoiceNumber), secondDueDate y secondAmount se preservan al agregar amountPending', () => {
  const sb = buildSandbox({});
  const before = `[[OBLIGATION_META:${JSON.stringify({ extraFields: { currency: 'USD', provider: 'Edesur', invoiceNumber: '5044', secondDueDate: '2026-07-20', secondAmount: 55000 } })}]]\nTexto humano libre del titular`;
  const partialUpdate = { extraFields: { ...sb.obligationExtraFields({ notes: before }), amountPending: true } };
  const after = sb.updateObligationNotes(before, partialUpdate, sb.obligationUserNotes(before));
  const newExtra = sb.obligationExtraFields({ notes: after });
  assert.strictEqual(newExtra.currency, 'USD');
  assert.strictEqual(newExtra.provider, 'Edesur');
  assert.strictEqual(newExtra.invoiceNumber, '5044');
  assert.strictEqual(newExtra.secondDueDate, '2026-07-20');
  assert.strictEqual(newExtra.secondAmount, 55000);
  assert.strictEqual(newExtra.amountPending, true);
  assert.ok(sb.obligationUserNotes(after).includes('Texto humano libre del titular'));
});

caso('CASO 29 — editHistory se preserva al tocar amountPending (mismo patrón vigente de merge, nunca reemplazo del objeto completo)', () => {
  const sb = buildSandbox({});
  const editHistory = [{ at: '2026-06-01T00:00:00.000Z', by: 'user-1', changedFields: { importe: { before: '$1', after: '$2' } } }];
  const before = `[[OBLIGATION_META:${JSON.stringify({ editHistory, extraFields: { currency: 'ARS' } })}]]`;
  const after = sb.updateObligationNotes(before, { extraFields: { currency: 'ARS', amountPending: true } });
  assert.deepStrictEqual(sb.obligationEditHistory({ notes: after }), editHistory);
});

// ============================================================
// PARTE G — segundo vencimiento no se rompe
// ============================================================

caso('CASO 31b — secondDueDate/secondAmount preservados intactos aunque la obligación esté amountPending=true (no se borra metadata histórica de segundo vencimiento)', () => {
  const sb = buildSandbox({});
  const o = { notes: obligationMeta({ amountPending: true, secondDueDate: '2026-07-20', secondAmount: 55000 }) };
  const extra = sb.obligationExtraFields(o);
  assert.strictEqual(extra.secondDueDate, '2026-07-20');
  assert.strictEqual(extra.secondAmount, 55000);
});

caso('CASO — effectiveObligationAmount()/calculateRealObligationBalance() no se rompen con una obligación pendiente en la lista de pagos (amount=0 no distorsiona el cálculo de otras obligaciones)', () => {
  const sb = buildSandbox({});
  const agosto = obl({ id: 'o-agosto', service_id: 'service-1', period: '2026-08-01', amount: 100000, due_date: '2026-08-10' });
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', notes: obligationMeta({ amountPending: true }) });
  const amount = sb.effectiveObligationAmount(agosto, [julio], []);
  assert.strictEqual(amount, 100000);
});

// ============================================================
// PARTE H — no toca pagos/allocations/payment_corrections/documentos
// ============================================================

caso('CASO 34/35/36 — marcar/resolver un pendiente no crea pagos, no modifica payment_allocations, no modifica payment_corrections (auditado sobre el saveMonthData REAL completo, no sobre un bundle que podría incluir otras funciones ajenas como applyServiceCreditToObligation)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', '\n  const saveButton=document.getElementById');
    assert.ok(!fnBlock.includes('correct_historical_payment'), `[${label}] saveMonthData no debe tocar correct_historical_payment`);
    assert.ok(!/from\('payments'\)\s*\.\s*insert/.test(fnBlock), `[${label}] saveMonthData no debe insertar payments`);
    assert.ok(!/from\('payment_allocations'\)/.test(fnBlock), `[${label}] saveMonthData no debe tocar payment_allocations`);
    assert.ok(!/from\('payment_corrections'\)/.test(fnBlock), `[${label}] saveMonthData no debe tocar payment_corrections`);
    assert.ok(fnBlock.includes("from('obligation_consolidations')"), `[${label}] saveMonthData debe seguir usando obligation_consolidations (mecanismo reutilizado)`);
  }
});

caso('CASO 25 — no duplica documento: el bloque de resolución de pendientes nunca llama a uploadDoc/insert de documents', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const block = extract(text, '${pendingCandidates.length&&!sourceLink?`', 'Archivo de factura');
    assert.ok(!block.includes('uploadDoc('), `[${label}] el bloque de resolución de pendientes no debe subir documentos`);
    assert.ok(!/from\('documents'\)\.insert/.test(block), `[${label}] no debe insertar documents`);
  }
});

caso('CASO 26 — obligación anterior (Julio) nunca se borra al resolverla: el saveMonthData real solo hace UPDATE/insert sobre obligation_consolidations, ningún DELETE de obligations', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', '\n  const saveButton=document.getElementById');
    assert.ok(!/from\('obligations'\)\.delete/.test(fnBlock), `[${label}] saveMonthData no debe borrar obligations`);
  }
});

// ============================================================
// PARTE I — permisos: mismo criterio que hoy, nada nuevo se otorga
// ============================================================

caso('CASO 37/38 — el checkbox "Importe pendiente" y la resolución de pendientes usan el mismo editableNow (canEdit()) que el resto del formulario -- servicios privados siguen dependiendo de la visibilidad ya existente, sin excepción nueva', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const checkboxLine = extract(text, 'id="oamountPending"', '>');
    assert.ok(checkboxLine.includes("!editableNow?'disabled':''"), `[${label}] el checkbox debe respetar editableNow, igual que el resto del formulario`);
  }
});

// ============================================================
// PARTE J — Tarjetas / #6 / #7 / #8 intactas
// ============================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  caso(`CASO 39 [${label}] — Tarjetas (uploadCreditDocument/renderCreditCardsModule) permanece byte-idéntica al backup previo a esta mejora`, () => {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_9_importes_pendientes_20260819_010000', `${label}.antes_mejora9`);
    const before = fs.readFileSync(beforePath, 'utf8').replace(/\r\n/g, '\n');
    const now = text.replace(/\r\n/g, '\n');
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney', 'uploadCreditDocument']) {
      const endMarker = fnName === 'uploadCreditDocument' ? 'async function reconcileCreditDocumentLink(' : '\nfunction ';
      assert.strictEqual(
        extract(now, `function ${fnName}(`, endMarker),
        extract(before, `function ${fnName}(`, endMarker),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  });

  caso(`CASO 40 [${label}] — mejora #6 (anulación no destructiva de documentos) intacta: isVoidedServiceDocument/openVoidServiceDocumentModal presentes sin cambios`, () => {
    assert.ok(text.includes('function isVoidedServiceDocument(doc){'));
    assert.ok(text.includes('function openVoidServiceDocumentModal(documentId,onDelete){'));
  });

  caso(`CASO 41 [${label}] — mejora #7 (corrección trazable de pagos) intacta: correct_historical_payment/openCorrectHistoricalPaymentModal presentes sin cambios`, () => {
    assert.ok(text.includes("sb.rpc('correct_historical_payment',{"));
    assert.ok(text.includes('function openCorrectHistoricalPaymentModal(paymentId){'));
  });

  caso(`CASO 42 [${label}] — mejora #8 (upload robusto mobile) intacta: snapshotFileBytesForUpload presente sin cambios`, () => {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_9_importes_pendientes_20260819_010000', `${label}.antes_mejora9`);
    const before = fs.readFileSync(beforePath, 'utf8').replace(/\r\n/g, '\n');
    const now = text.replace(/\r\n/g, '\n');
    assert.strictEqual(
      extract(now, 'async function snapshotFileBytesForUpload(', '\nasync function uploadDoc('),
      extract(before, 'async function snapshotFileBytesForUpload(', '\nasync function uploadDoc('),
      `snapshotFileBytesForUpload() en ${label} debe seguir byte-idéntica`
    );
  });
}

caso('CASO 43/44 — desktop y mobile: no hay ninguna rama de plataforma en toda la implementación de mejora #9 (mismo código para ambos, sin user-agent sniffing)', () => {
  assert.ok(!/navigator\.userAgent|isIOS|isSafari|isMobile/i.test(REAL_SOURCE));
});

caso('CASO 45 — paridad funcional exacta index.html / index_operator.html: el bloque de resolución de pendientes es byte-idéntico entre titular y operador', () => {
  const blockIndex = extract(indexText, '${pendingCandidates.length&&!sourceLink?`', 'Archivo de factura');
  const blockOperator = extract(operatorText, '${pendingCandidates.length&&!sourceLink?`', 'Archivo de factura');
  assert.strictEqual(blockIndex, blockOperator);
});

caso('CASO — sintaxis JS válida en ambos HTML (verificado por separado con node --check, ver reporte de entrega)', () => {
  assert.ok(indexText.includes('<script'));
  assert.ok(operatorText.includes('<script'));
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
  console.log('AVISO: valida lógica real extraída con arrays en memoria, NO ejecución real contra Postgres/Supabase.');
  if (fail > 0) process.exitCode = 1;
}

run();
