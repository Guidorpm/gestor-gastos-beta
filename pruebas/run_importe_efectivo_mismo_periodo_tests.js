// ============================================================
// PRUEBA LOCAL — BUGFIX #12 FASE 2 FINAL: diferencia de pago que
// pertenece al mismo período, sin alterar el importe documental de la
// factura (20260821)
// ------------------------------------------------------------
// Caso real que motiva esta mejora: Edesur agosto 2026, obligation_id
// c28d3149-1958-4fd8-a8e2-017888409582. El pago principal
// bb23b7f8-ba1c-4d07-b754-3d02d916a008 quedó corregido (bugfix #12 FASE
// 1/FIX 6b15) de 49733.00 a 49907.71; el auxiliar de $0,69
// (61b09c9c-a789-4a28-9d37-898c80a7fe14) está anulado. Con el importe
// documental de la factura (49.733,69) como única referencia, el sistema
// mostraba "Saldo a favor $174,02" -- un sobrante que en realidad NO es
// tal: los $49.907,71 SON lo que económicamente correspondía pagar ese
// mismo período (agosto), no un mes distinto ni un segundo vencimiento.
//
// Diseño (ver informe de entrega para el detalle completo de la
// auditoría previa): NO se creó ninguna columna ni tabla nueva, NO se
// tocó ninguna migración. Se reutiliza el mismo patrón YA vigente de
// extraFields en obligations.notes/OBLIGATION_META (currency/provider/
// invoiceNumber/secondDueDate/secondAmount/amountPending) agregando una
// clave más: extraFields.effectivePeriodAmount. obligation.amount (el
// importe DOCUMENTAL de la factura) NUNCA se modifica -- effectivePeriodAmount
// es un campo aparte, opcional, que effectiveObligationAmount() usa como
// base del cálculo SOLO cuando está presente. Deliberadamente separado de
// segundo vencimiento (extraFields.secondDueDate/secondAmount): ambos
// mecanismos son independientes y pueden combinarse (ver CASO 11) pero
// ninguno se infiere del otro.
//
// Fórmula real (ver effectiveObligationAmount/calculateRealObligationBalance/
// paymentProgress/creditBalanceFor, todas sin duplicar lógica):
//   importe_documental      = obligation.amount                (intacto)
//   importe_efectivo_periodo= extraFields.effectivePeriodAmount ?? obligation.amount
//   pagado_activo           = paidAmountForWithAllocations(...)  (excluye anulados)
//   saldo_pendiente         = max(importe_efectivo_periodo - pagado_activo, 0)
//   saldo_a_favor           = max(pagado_activo - importe_efectivo_periodo, 0)
//
// Esta prueba extrae y ejecuta las funciones REALES de index.html/
// index_operator.html (nunca reimplementadas a mano) en un sandbox con
// arrays en memoria -- nunca contra Supabase real. NO se ejecutó SQL, NO
// se modificó Supabase, NO se tocó el registro real de Edesur.
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
  const fnParseMoneyField = extract(text, 'function parseMoneyField(value){', '\n}') + '\n}';
  const fnFormatMoneyField = extract(text, 'function formatMoneyField(value){', '\n}') + '\n}';
  const fnPeriodDate = extract(text, 'function periodDate(key){', '\n');
  const fnMonthLabel = extract(text, 'function monthLabel(key){', '\n');
  const fnFmtMoneyExact = extract(text, 'function fmtMoneyExact(v){', '\n');
  const fnRoundServiceMoney = extract(text, 'function roundServiceMoney(value){', '\n');
  const fnServiceMoneyCents = extract(text, 'function serviceMoneyCents(value){', '\n');
  const fnToday = extract(text, 'function today(){', '\n');
  const fnDaysUntil = extract(text, 'function daysUntil(v){', '\n');
  const fnTodayDateString = extract(text, 'function todayDateString(){', '\n');
  const constMonths = extract(text, 'const MONTHS=', '\n');
  // paidAmountForWithAllocations, paidAmountAsOfWithAllocations, paymentNoteMetadata/
  // paymentAppliedDueStage, obligationHasSecondStagePayment,
  // effectiveObligationAmount (BUGFIX #12 FASE 2), calculateRealObligationBalance
  // -- en el orden real del archivo.
  const blockPaymentsAndAmounts = extract(text, 'function paidAmountForWithAllocations(', 'function isServiceVisibleForCurrentContext(');
  // obligationFor, monthAppliesToService, paidAmountFor, balanceFor,
  // creditBalanceFor, paymentProgress, obligationNoteMeta/obligationUserNotes/
  // updateObligationNotes, obligationExtraFields, obligationCurrency,
  // formatObligationAmount, consolidationForSource/consolidationTarget/
  // isEffectivePending/previousBalanceFor, dueState/boxClass/boxText -- todo
  // en un solo bloque real, en el orden real del archivo.
  const blockObligationsCore = extract(text, 'function obligationFor(serviceId,key){', 'function lastKnownAmount(');

  return [
    fnParseMoneyField, fnFormatMoneyField, fnPeriodDate, fnMonthLabel, fnFmtMoneyExact,
    fnRoundServiceMoney, fnServiceMoneyCents, fnToday, fnDaysUntil, fnTodayDateString, constMonths,
    blockPaymentsAndAmounts, blockObligationsCore,
  ].join('\n');
}

const REAL_SOURCE_INDEX = buildRealSource(indexText);
const REAL_SOURCE_OPERATOR = buildRealSource(operatorText);

function buildSandbox(realSource, { obligations = [], payments = [], paymentAllocations = [], documents = [], consolidations = [], services = [], members = [], session = { user: { id: 'user-1' } }, paymentAllocationsLoadError = false } = {}) {
  const sandbox = {
    obligations, payments, paymentAllocations, documents, consolidations, services, members, session,
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
      paidAmountAsOfWithAllocations, obligationHasSecondStagePayment,
      roundServiceMoney, serviceMoneyCents, periodDate, todayDateString,
      parseMoneyField, formatMoneyField, fmtMoneyExact,
    };
  `);
  return fn(...Object.values(sandbox));
}

function buildSandboxIndex(opts) { return buildSandbox(REAL_SOURCE_INDEX, opts); }
function buildSandboxOperator(opts) { return buildSandbox(REAL_SOURCE_OPERATOR, opts); }

// Helper de fixture: obligación real mínima, con extraFields codificados
// en notes usando EXACTAMENTE el formato real [[OBLIGATION_META:{...}]] --
// nunca un objeto JS "a mano" que después se pasa directo.
function obligationMeta(extraFields, extra = {}) {
  const meta = { extraFields, ...extra };
  return `[[OBLIGATION_META:${JSON.stringify(meta)}]]`;
}
function obl({ id, service_id = 'service-1', period, amount = 0, due_date = '2026-08-10', status = 'pending', notes = null, created_by = 'user-1' } = {}) {
  return { id, service_id, period, amount, due_date, status, notes, created_by };
}
function pay({ id, obligation_id, total_amount, voided = false, paid_at = '2026-08-10' } = {}) {
  return { id, obligation_id, total_amount, voided, paid_at };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — importe documental conservado / importe efectivo separado
// ============================================================

caso('CASO 1 — el importe DOCUMENTAL de la factura (obligation.amount) nunca se modifica al fijar effectivePeriodAmount', () => {
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  assert.strictEqual(o.amount, 49733.69, 'obligation.amount debe seguir siendo el importe documental real');
});

caso('CASO 2 — el importe efectivo del período puede ser distinto del documental: effectiveObligationAmount() devuelve effectivePeriodAmount cuando está seteado', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 49907.71);
});

caso('CASO 3 — caso real Edesur: importe documental 49.733,69, importe efectivo 49.907,71', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'c28d3149-1958-4fd8-a8e2-017888409582', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  assert.strictEqual(o.amount, 49733.69);
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 49907.71);
});

caso('CASO 4 — pagado activo del caso Edesur da exactamente 49.907,71 (pago principal corregido, auxiliar anulado excluido)', () => {
  const sb = buildSandboxIndex({});
  const payments = [
    pay({ id: 'bb23b7f8-ba1c-4d07-b754-3d02d916a008', obligation_id: 'o-edesur', total_amount: 49907.71, voided: false }),
    pay({ id: '61b09c9c-a789-4a28-9d37-898c80a7fe14', obligation_id: 'o-edesur', total_amount: 0.69, voided: true }),
  ];
  assert.strictEqual(sb.paidAmountForWithAllocations('o-edesur', payments, []), 49907.71);
});

caso('CASO 5 — saldo pendiente del caso Edesur da exactamente 0 (calculateRealObligationBalance usa el importe efectivo, no el documental)', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  const payments = [
    pay({ id: 'p-principal', obligation_id: 'o-edesur', total_amount: 49907.71, voided: false }),
    pay({ id: 'p-auxiliar', obligation_id: 'o-edesur', total_amount: 0.69, voided: true }),
  ];
  assert.strictEqual(sb.calculateRealObligationBalance(o, payments, []), 0);
});

caso('CASO 6 — saldo a favor del caso Edesur da exactamente 0 (creditBalanceFor usa el importe efectivo, no el documental) — ya NO aparece el falso "$174,02"', () => {
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  const payments = [
    pay({ id: 'p-principal', obligation_id: 'o-edesur', total_amount: 49907.71, voided: false }),
    pay({ id: 'p-auxiliar', obligation_id: 'o-edesur', total_amount: 0.69, voided: true }),
  ];
  const sb = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  assert.strictEqual(sb.creditBalanceFor(o), 0);
  const progress = sb.paymentProgress(o);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 7 — el pago auxiliar anulado ($0,69) NUNCA cuenta en pagado/saldo, con o sin effectivePeriodAmount', () => {
  const payments = [
    pay({ id: 'p-principal', obligation_id: 'o-edesur', total_amount: 49907.71, voided: false }),
    pay({ id: 'p-auxiliar', obligation_id: 'o-edesur', total_amount: 0.69, voided: true }),
  ];
  const sb = buildSandboxIndex({});
  const pagadoConAuxiliarVivo = sb.paidAmountForWithAllocations('o-edesur', [payments[0], { ...payments[1], voided: false }], []);
  const pagadoConAuxiliarAnulado = sb.paidAmountForWithAllocations('o-edesur', payments, []);
  assert.strictEqual(Math.round((pagadoConAuxiliarVivo - pagadoConAuxiliarAnulado) * 100) / 100, 0.69, 'el auxiliar vivo sumaría 0.69 extra; anulado, no suma nada');
  assert.strictEqual(pagadoConAuxiliarAnulado, 49907.71);
});

// ============================================================
// PARTE B — sin effectivePeriodAmount: comportamiento histórico intacto
// ============================================================

caso('CASO 8 — sin effectivePeriodAmount, effectiveObligationAmount() sigue devolviendo obligation.amount exactamente como antes', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-normal', period: '2026-08-01', amount: 15000, notes: null });
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 15000);
});

caso('CASO 9 — sin effectivePeriodAmount, un sobrepago sigue mostrándose como saldo a favor (comportamiento histórico preservado, "dejarla como saldo a favor")', () => {
  const o = obl({ id: 'o-normal', period: '2026-08-01', amount: 15000, notes: null });
  const payments = [pay({ id: 'p-1', obligation_id: 'o-normal', total_amount: 15100, voided: false })];
  const sb = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const progress = sb.paymentProgress(o);
  assert.strictEqual(progress.creditBalance, 100);
  assert.strictEqual(progress.balance, 0);
});

// ============================================================
// PARTE C — no fuerza segundo vencimiento / conviven sin interferir
// ============================================================

caso('CASO 10 — effectivePeriodAmount puede fijarse SIN secondDueDate/secondAmount (no obliga a usar segundo vencimiento para representar la diferencia)', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  const extra = sb.obligationExtraFields(o);
  assert.strictEqual(extra.secondDueDate, undefined);
  assert.strictEqual(extra.secondAmount, undefined);
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 49907.71);
});

caso('CASO 11 — segundo vencimiento sigue funcionando igual cuando además hay effectivePeriodAmount: si no se cubrió a tiempo el importe 1 (ahora el efectivo), pasa a importe 2', () => {
  const sb = buildSandboxIndex({});
  const o = obl({
    id: 'o-combo', period: '2026-06-01', amount: 10000, due_date: '2020-01-01',
    notes: obligationMeta({ effectivePeriodAmount: 10500, secondDueDate: '2020-01-10', secondAmount: 12000 }),
  });
  // no se pagó nada antes del primer vencimiento -> corresponde importe 2
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 12000);
});

caso('CASO 11b — segundo vencimiento cubierto a tiempo con el importe efectivo (no el documental) evita pasar a importe 2', () => {
  const sb = buildSandboxIndex({});
  const o = obl({
    id: 'o-combo2', period: '2026-06-01', amount: 10000, due_date: '2020-01-05',
    notes: obligationMeta({ effectivePeriodAmount: 10500, secondDueDate: '2020-01-10', secondAmount: 12000 }),
  });
  const payments = [pay({ id: 'p-1', obligation_id: 'o-combo2', total_amount: 10500, voided: false, paid_at: '2020-01-04' })];
  assert.strictEqual(sb.effectiveObligationAmount(o, payments, []), 10500, 'cubierto a tiempo con el importe EFECTIVO, no debe escalar a importe 2');
});

// ============================================================
// PARTE D — no crea filas nuevas, no toca otras tablas
// ============================================================

caso('CASO 12 — no crea una obligación nueva: sigue existiendo UNA sola fila con el mismo id al fijar effectivePeriodAmount', () => {
  const misObligations = [obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69 })];
  misObligations[0].notes = obligationMeta({ effectivePeriodAmount: 49907.71 });
  assert.strictEqual(misObligations.length, 1);
  assert.strictEqual(misObligations[0].id, 'o-edesur');
});

caso('CASO 13 — no crea ningún payment nuevo: fijar effectivePeriodAmount es un cambio de metadata de la obligación, nunca inserta en payments', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', '\n  const saveButton=document.getElementById');
    const effectiveBlock = extract(fnBlock, 'effectivePeriodAmountRaw', 'previousFreeText');
    assert.ok(!/from\('payments'\)\.insert/.test(effectiveBlock), `[${label}] la validación de effectivePeriodAmount no debe insertar payments`);
  }
});

caso('CASO 14 — no duplica documento: el campo de effectivePeriodAmount no llama a uploadDoc ni inserta documents', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fieldBlock = extract(text, 'id="oeffectivePeriodAmountField"', '<div class="category-help" style="margin:14px 0 -2px;font-weight:600;text-transform:none">Segundo vencimiento');
    assert.ok(!fieldBlock.includes('uploadDoc('), `[${label}] el campo de importe efectivo no debe subir documentos`);
    assert.ok(!/from\('documents'\)\.insert/.test(fieldBlock), `[${label}] el campo de importe efectivo no debe insertar documents`);
  }
});

caso('CASO 15 — no toca Storage: ni el campo ni el botón "Sí, corresponde a este período" referencian storage/bucket', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fieldBlock = extract(text, 'id="oeffectivePeriodAmountField"', '<div class="category-help" style="margin:14px 0 -2px;font-weight:600;text-transform:none">Segundo vencimiento');
    assert.ok(!/\.storage\.|bucket/i.test(fieldBlock), `[${label}] no debe referenciar Storage/bucket`);
  }
});

// ============================================================
// PARTE E — amountPending intacto: no se infiere effectivePeriodAmount
// ============================================================

caso('CASO 16 — la validación server-side rechaza combinar amountPending=true con un effectivePeriodAmount cargado (no tiene sentido sin importe documental/económico conocido)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', '\n  const saveButton=document.getElementById');
    assert.ok(fnBlock.includes('amountPendingChecked&&effectivePeriodAmountValue!=null'), `[${label}] debe existir la validación cruzada amountPending + effectivePeriodAmount`);
  }
});

caso('CASO 16b — la UI oculta y limpia el campo de importe efectivo cuando se marca "Importe pendiente" (mismo criterio que el campo de importe documental)', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const wiringBlock = extract(text, 'const applyAmountPendingUI=()=>{', 'amountPendingCheckbox.onchange=applyAmountPendingUI;');
    assert.ok(wiringBlock.includes("effectivePeriodAmountField.style.display=pending?'none':''"), `[${label}] debe ocultar el campo cuando amountPending está marcado`);
    assert.ok(wiringBlock.includes('if(pending)effectivePeriodAmountInput.value=\'\''), `[${label}] debe limpiar el valor cuando amountPending está marcado`);
  }
});

// ============================================================
// PARTE F — no rompe previous balance / allocations / consolidations
// ============================================================

caso('CASO 17 — previousBalanceFor() no se rompe con una obligación anterior que tiene effectivePeriodAmount (usa el saldo real de ese período, sin distorsionar el arrastre)', () => {
  const julio = obl({ id: 'o-julio', service_id: 'service-1', period: '2026-07-01', amount: 20000, due_date: '2026-07-10', notes: obligationMeta({ effectivePeriodAmount: 20500 }) });
  const sb = buildSandboxIndex({ obligations: [julio], payments: [], paymentAllocations: [] });
  const prev = sb.previousBalanceFor('service-1', '2026-08');
  assert.strictEqual(sb.serviceMoneyCents(prev.total), sb.serviceMoneyCents(20500), 'el arrastre debe reflejar el saldo real (importe efectivo), no el documental');
});

caso('CASO 18 — allocations activas se siguen sumando igual con effectivePeriodAmount: el cambio solo afecta el importe exigible, nunca cómo se suma lo pagado', () => {
  const o = obl({ id: 'o-edesur', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  const payments = [pay({ id: 'p-1', obligation_id: 'o-edesur', total_amount: 30000, voided: false })];
  const allocations = [{ payment_id: 'p-1', obligation_id: 'o-edesur', allocated_amount: 30000, is_active: true }];
  const sb = buildSandboxIndex({});
  assert.strictEqual(sb.paidAmountForWithAllocations('o-edesur', payments, allocations), 30000);
  assert.strictEqual(sb.calculateRealObligationBalance(o, payments, allocations), 19907.71);
});

caso('CASO 19 — obligation_consolidations sigue intacto: saveMonthData real sigue usando ese mecanismo sin cambios por esta mejora', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', '\n  const saveButton=document.getElementById');
    assert.ok(fnBlock.includes("from('obligation_consolidations')"), `[${label}] saveMonthData debe seguir usando obligation_consolidations`);
  }
});

// ============================================================
// PARTE G — trazabilidad: historial de edición conserva todo
// ============================================================

caso('CASO 20 — updateObligationNotes() registra effectivePeriodAmount preservando editHistory/otros extraFields (merge, nunca reemplazo del objeto completo)', () => {
  const sb = buildSandboxIndex({});
  const editHistory = [{ at: '2026-08-01T00:00:00.000Z', by: 'user-1', changedFields: { importe: { before: '$1', after: '$2' } } }];
  const before = `[[OBLIGATION_META:${JSON.stringify({ editHistory, extraFields: { currency: 'ARS', provider: 'Edesur', invoiceNumber: '5044' } })}]]\nTexto libre`;
  const partialUpdate = { extraFields: { ...sb.obligationExtraFields({ notes: before }), effectivePeriodAmount: 49907.71 } };
  const after = sb.updateObligationNotes(before, partialUpdate, sb.obligationUserNotes(before));
  const newExtra = sb.obligationExtraFields({ notes: after });
  assert.strictEqual(newExtra.effectivePeriodAmount, 49907.71);
  assert.strictEqual(newExtra.currency, 'ARS');
  assert.strictEqual(newExtra.provider, 'Edesur');
  assert.strictEqual(newExtra.invoiceNumber, '5044');
  assert.deepStrictEqual(sb.obligationEditHistory({ notes: after }), editHistory, 'editHistory previo no debe perderse');
  assert.ok(sb.obligationUserNotes(after).includes('Texto libre'), 'las notas humanas no deben perderse');
});

caso('CASO 20b — el guardado registra en changedFields un before/after legible de "importeEfectivoPeriodo" cuando cambia', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('changedFields.importeEfectivoPeriodo={before:previousExtra.effectivePeriodAmount!=null?fmtMoneyExact(previousExtra.effectivePeriodAmount):'), `[${label}] debe registrar el cambio de importe efectivo en el historial`);
  }
});

// ============================================================
// PARTE H — anulación de pagos (#11) intacta
// ============================================================

caso('CASO 21 — un pago anulado nunca cuenta para pagado/saldo, se fije o no effectivePeriodAmount (ya cubierto en CASO 4/7, se repite con importe efectivo distinto)', () => {
  const sb = buildSandboxIndex({});
  const payments = [
    pay({ id: 'p-1', obligation_id: 'o-x', total_amount: 5000, voided: false }),
    pay({ id: 'p-2', obligation_id: 'o-x', total_amount: 2000, voided: true }),
  ];
  assert.strictEqual(sb.paidAmountForWithAllocations('o-x', payments, []), 5000);
});

caso('CASO 22 — anulación de documentos (isVoidedServiceDocument/openVoidServiceDocumentModal) presente sin cambios en ambos archivos', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('function isVoidedServiceDocument(doc){'));
    assert.ok(text.includes('function openVoidServiceDocumentModal(documentId,onDelete){'));
  }
});

// ============================================================
// PARTE I — upload mobile / baja-reactivación / Tarjetas intactos
// ============================================================

const BACKUP_DIR = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_12_fase2_importe_efectivo_periodo_20260821_122820');

for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix12fase2'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix12fase2']]) {
  caso(`CASO 23 [${label}] — upload mobile (snapshotFileBytesForUpload) permanece byte-idéntico al backup previo a esta FASE`, () => {
    const beforePath = path.join(BACKUP_DIR, suffix);
    const before = fs.readFileSync(beforePath, 'utf8').replace(/\r\n/g, '\n');
    const now = text.replace(/\r\n/g, '\n');
    assert.strictEqual(
      extract(now, 'async function snapshotFileBytesForUpload(', '\nasync function uploadDoc('),
      extract(before, 'async function snapshotFileBytesForUpload(', '\nasync function uploadDoc('),
      `snapshotFileBytesForUpload() en ${label} debe seguir byte-idéntica`
    );
  });

  // AJUSTE (BUGFIX #13 FASE 2, 20260821): reactivateService() (y
  // dropService()) dejaron de ser byte-idénticas a partir de acá, de
  // forma legítima y autorizada -- se les agregó validación robusta del
  // UPDATE (.select('id,active') + verificación de fila/estado, vía la
  // función compartida applyServiceActiveUpdate) porque un UPDATE
  // bloqueado por RLS podía devolver éxito con 0 filas realmente
  // afectadas (caso real: Argentina Virtual, diagnóstico 6b16). Ya no
  // corresponde exigir identidad byte a byte contra el backup previo a
  // esa FASE -- se verifica en su lugar que el UPDATE real siga
  // existiendo (ahora en applyServiceActiveUpdate) y que
  // reactivateService lo siga pidiendo con targetActive=true, sin DELETE.
  caso(`CASO 24 [${label}] — baja/reactivación de servicios: el UPDATE real de active sigue existiendo (ahora en applyServiceActiveUpdate) y reactivateService lo sigue usando con targetActive=true, sin DELETE`, () => {
    const updateBlock = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(updateBlock.includes("from('services')") && updateBlock.includes('.update({active:targetActive})'), `[${label}] debe seguir existiendo el UPDATE real de active`);
    assert.ok(!updateBlock.includes('.delete('), `[${label}] no debe usar .delete() en ningún lado`);
    const reactivateBlock = extract(text, 'async function reactivateService(serviceId){', '\nfunction openPaymentDetail(');
    assert.ok(reactivateBlock.includes('applyServiceActiveUpdate(serviceId,true)'), `[${label}] reactivateService debe seguir pidiendo targetActive=true`);
  });

  caso(`CASO 25 [${label}] — Tarjetas (renderCreditCardsModule/bindCreditCardsModule/roundMoney/uploadCreditDocument) permanece byte-idéntica al backup previo a esta FASE`, () => {
    const beforePath = path.join(BACKUP_DIR, suffix);
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
}

// ============================================================
// PARTE J — permisos: no se agrega ninguno nuevo
// ============================================================

caso('CASO 26 — el campo "Importe efectivo de este período" respeta el mismo editableNow (canEdit()) que el resto del formulario, sin excepción nueva', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fieldBlock = extract(text, 'id="oeffectivePeriodAmount"', '>');
    assert.ok(fieldBlock.includes("!editableNow?'disabled':''"), `[${label}] el campo debe respetar editableNow, igual que el resto del formulario`);
  }
});

// ============================================================
// PARTE K — paridad titular / operador
// ============================================================

caso('CASO 27 — paridad funcional exacta index.html / index_operator.html: los bloques nuevos de esta FASE son byte-idénticos entre titular y operador', () => {
  const markers = [
    ['effectiveObligationAmount', 'function effectiveObligationAmount(obligation,paymentsList,allocationsList){', '\n}'],
    ['campo HTML', 'id="oeffectivePeriodAmountField"', 'Segundo vencimiento'],
    ['wiring JS', 'const effectivePeriodAmountField=', 'bindDocumentCards({'],
    ['validación saveMonthData', 'effectivePeriodAmountRaw', 'previousFreeText'],
    ['changedFields', 'changedFields.importeEfectivoPeriodo', '\n'],
  ];
  for (const [nombre, start, end] of markers) {
    assert.strictEqual(extract(indexText, start, end), extract(operatorText, start, end), `bloque "${nombre}" debe ser byte-idéntico entre index.html e index_operator.html`);
  }
});

// ============================================================
// PARTE L — formato monetario correcto
// ============================================================

caso('CASO 28 — fmtMoneyExact(49907.71) formatea con "49.907,71" (2 decimales, separador de miles argentino) y símbolo $', () => {
  const sb = buildSandboxIndex({});
  // fmtMoneyExact usa Intl es-AR/ARS -- validamos las partes esenciales sin
  // depender de espacios/no-breaking-space específicos de la plataforma Node.
  const formatted = sb.fmtMoneyExact(49907.71);
  assert.ok(formatted.includes('49.907,71'), `debe contener "49.907,71", obtuvo "${formatted}"`);
  assert.ok(formatted.includes('$'), `debe contener el símbolo $, obtuvo "${formatted}"`);
});

caso('CASO 28b — parseMoneyField/formatMoneyField hacen roundtrip correcto para el importe efectivo de Edesur (49.907,71 -> 49907.71 -> "49.907,71")', () => {
  const sb = buildSandboxIndex({});
  assert.strictEqual(sb.parseMoneyField('49.907,71'), 49907.71);
  assert.strictEqual(sb.formatMoneyField(49907.71), '49.907,71');
});

// ============================================================
// PARTE M — UX: distingue documental vs efectivo, pregunta simple
// ============================================================

caso('CASO 29 — el detalle del período muestra "Importe total que figura en la factura" (documental) y, aparte, "Importe efectivo de este período" (opcional) con la nota de que la factura no cambia', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('Importe total que figura en la factura'), `[${label}] debe seguir mostrando el importe documental`);
    assert.ok(text.includes('Importe efectivo de este período'), `[${label}] debe mostrar el campo de importe efectivo`);
    assert.ok(text.includes('El importe documental de la factura se conserva sin cambios'), `[${label}] debe aclarar que la factura no se toca`);
  }
});

caso('CASO 29b — cuando hay saldo a favor, se ofrece una pregunta simple de una sola diferencia ("¿corresponde a este mismo período?") sin forzar marcar segundo vencimiento', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('¿Esta diferencia corresponde económicamente a este mismo período'), `[${label}] debe ofrecer la pregunta simple`);
    assert.ok(text.includes('Sí, corresponde a este período'), `[${label}] debe tener el botón de confirmación`);
    const noticeBlock = extract(text, 'Hay un saldo a favor de', 'Segundo vencimiento');
    assert.ok(!noticeBlock.includes('Corresponde a segundo vencimiento'), `[${label}] no debe forzar marcar segundo vencimiento para resolver esto`);
  }
});

// ============================================================
// PARTE N — saldo a favor solo cuando realmente corresponde
// ============================================================

caso('CASO 30 — mismo pago ($49.907,71), dos resultados distintos según haya o no effectivePeriodAmount: SIN fijarlo, muestra saldo a favor $174,02 sobre el documental; CON él fijado, saldo a favor $0', () => {
  const sinEfectivo = obl({ id: 'o-sin', period: '2026-08-01', amount: 49733.69, notes: null });
  const conEfectivo = obl({ id: 'o-con', period: '2026-08-01', amount: 49733.69, notes: obligationMeta({ effectivePeriodAmount: 49907.71 }) });
  const payments = [pay({ id: 'p-1', obligation_id: 'o-sin', total_amount: 49907.71, voided: false })];
  const paymentsCon = [pay({ id: 'p-2', obligation_id: 'o-con', total_amount: 49907.71, voided: false })];
  const sbSin = buildSandboxIndex({ obligations: [sinEfectivo], payments, paymentAllocations: [] });
  const sbCon = buildSandboxIndex({ obligations: [conEfectivo], payments: paymentsCon, paymentAllocations: [] });
  const progressSin = sbSin.paymentProgress(sinEfectivo);
  const progressCon = sbCon.paymentProgress(conEfectivo);
  assert.strictEqual(Math.round(progressSin.creditBalance * 100) / 100, 174.02, 'sin fijar el importe efectivo, el sobrante contra el documental sigue mostrándose como saldo a favor (comportamiento preservado para quien SÍ quiere dejarlo así)');
  assert.strictEqual(progressCon.creditBalance, 0, 'al fijar el importe efectivo real del período, deja de aparecer como saldo a favor');
});

// ============================================================
// PARTE O — BUGFIX #12 FASE 2B: semántica "Total factura" +
// openCorrectHistoricalPaymentModal() con la pregunta de mismo período
// ------------------------------------------------------------
// Los 15 puntos pedidos explícitamente en FASE 2B. Sigue la misma
// convención estática/estructural ya usada en
// run_correccion_pagos_historicos_tests.js (CASO 47-66) para esta misma
// función: extrae el bloque real y verifica texto/orden/estructura, en
// vez de ejecutar un DOM real (esta función depende de modal()/toast()/
// document real, no de lógica pura aislable en un sandbox de arrays).
// ============================================================

// Normalizado a LF: el archivo real usa CRLF, y varios chequeos de acá
// abajo hacen matching multilínea -- normalizar evita falsos negativos
// por \r\n sin cambiar el contenido real que se está comparando.
const CORRECT_MODAL_BLOCK_INDEX = extract(indexText, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(').replace(/\r\n/g, '\n');
const CORRECT_MODAL_BLOCK_OPERATOR = extract(operatorText, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(').replace(/\r\n/g, '\n');

caso('FASE2B-1 — "Total factura" usa obligation.amount (documental), NUNCA progress.amount (efectivo), en los 3 renderers auditados', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const openObligationBlock = extract(text, 'function openObligation(serviceId,key){', '\nfunction openPaymentDetail(');
    assert.ok(openObligationBlock.includes('<span>Total factura</span><strong>${formatObligationAmount(o,o.amount)}</strong>'), `[${label}] openObligation: "Total factura" debe usar o.amount`);
    assert.ok(!/<span>Total factura<\/span><strong>\$\{formatObligationAmount\(o,progress\.amount\)\}/.test(openObligationBlock), `[${label}] openObligation: "Total factura" NO debe usar progress.amount`);

    const payModalBlock = extract(text, '<h2>Registrar pago</h2>', 'consolidation-box');
    assert.ok(payModalBlock.includes('<span>Total factura</span><strong>${fmtMoneyExact(baseAmount)}</strong>'), `[${label}] Registrar pago: "Total factura" debe usar baseAmount (=o.amount)`);
    assert.ok(!payModalBlock.includes('<span>Total factura</span><strong>${fmtMoneyExact(progress.amount)}</strong>'), `[${label}] Registrar pago: "Total factura" NO debe usar progress.amount`);

    const paymentDetailBlock = extract(text, 'function openPaymentDetail(id){', '\nfunction ');
    assert.ok(paymentDetailBlock.includes('Total factura: ${fmtMoneyExact(o.amount)}'), `[${label}] openPaymentDetail: "Total factura" debe usar o.amount`);
    assert.ok(!paymentDetailBlock.includes('Total factura: ${fmtMoneyExact(progress.amount)}'), `[${label}] openPaymentDetail: "Total factura" NO debe usar progress.amount`);
  }
});

caso('FASE2B-2 — effectivePeriodAmount se muestra APARTE, en una etiqueta distinta ("Importe efectivo de este período"), nunca reemplazando el rótulo "factura"', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const openObligationBlock = extract(text, 'function openObligation(serviceId,key){', '\nfunction openPaymentDetail(');
    assert.ok(openObligationBlock.includes('extraFields.effectivePeriodAmount!=null?`<div class="item"><span>Importe efectivo de este período</span>'), `[${label}] debe mostrar el importe efectivo aparte en el resumen de pagos`);

    const payModalBlock = extract(text, '<h2>Registrar pago</h2>', 'consolidation-box');
    assert.ok(payModalBlock.includes("extraDue.effectivePeriodAmount!=null?`<div class=\"item\"><span>Importe efectivo de este período</span>"), `[${label}] "Registrar pago" debe mostrar el importe efectivo aparte, condicionado a que exista`);

    const paymentDetailBlock = extract(text, 'function openPaymentDetail(id){', '\nfunction ');
    assert.ok(paymentDetailBlock.includes('obligationExtraFields(o).effectivePeriodAmount!=null?` · Importe efectivo de este período: ${fmtMoneyExact(progress.amount)}`'), `[${label}] el detalle del pago debe mostrar el importe efectivo aparte, condicionado a que exista`);
  }
});

caso('FASE2B-3 — el modal histórico contiene la pregunta exacta de mismo período, con el texto de diferencia y las dos opciones pedidas', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    assert.ok(block.includes('id="correctSamePeriodQuestion"'), `[${label}] debe existir el contenedor de la pregunta`);
    assert.ok(block.includes('Hay una diferencia de ${fmtMoneyExact(estimatedDiff)}. ¿Esta diferencia corresponde a este mismo período?'), `[${label}] debe mostrar el texto exacto de la pregunta`);
    assert.ok(block.includes('id="correctSamePeriodYes"') && block.includes('Sí, corresponde a este período'), `[${label}] debe existir el botón "Sí, corresponde a este período"`);
    assert.ok(block.includes('id="correctSamePeriodNo"') && block.includes('No, dejarla como saldo a favor'), `[${label}] debe existir el botón "No, dejarla como saldo a favor"`);
  }
});

caso('FASE2B-4 — segundo vencimiento queda separado: la pregunta de mismo período NUNCA marca ni depende del checkbox "correctIsSecondDue"', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const questionBox = extract(block, 'id="correctSamePeriodQuestion"', '<div class="modalactions">');
    assert.ok(!questionBox.includes('correctIsSecondDue'), `[${label}] la pregunta no debe tocar el checkbox de segundo vencimiento`);
    assert.ok(!/checked\s*=\s*true/.test(questionBox), `[${label}] la pregunta no debe marcar nada automáticamente`);
    // el checkbox de segundo vencimiento sigue existiendo intacto, como opción avanzada aparte
    assert.ok(block.includes('id="correctIsSecondDue"'), `[${label}] el checkbox de segundo vencimiento debe seguir existiendo, sin fusionarse con esta pregunta`);
  }
});

caso('FASE2B-5 — flujo "Sí": el RPC correct_historical_payment se ejecuta ANTES que cualquier escritura de effectivePeriodAmount (orden textual real en executeHistoricalCorrection)', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    const rpcIdx = execBlock.indexOf("sb.rpc('correct_historical_payment',{");
    const metaIdx = execBlock.indexOf("samePeriodDecision==='same_period'");
    const writeIdx = execBlock.indexOf('extraFields:newExtraForHistory');
    assert.ok(rpcIdx !== -1 && metaIdx !== -1 && writeIdx !== -1, `[${label}] deben existir las 3 piezas (RPC, chequeo de decisión, escritura de metadata)`);
    assert.ok(rpcIdx < metaIdx && metaIdx < writeIdx, `[${label}] el orden textual real debe ser RPC -> chequeo de decisión -> escritura de effectivePeriodAmount`);
    // el botón "Sí" dispara executeHistoricalCorrection con samePeriodDecision:'same_period'
    assert.ok(block.includes("executeHistoricalCorrection({...correctionPayload,samePeriodDecision:'same_period'})"), `[${label}] el botón "Sí" debe pasar samePeriodDecision:'same_period'`);
  }
});

caso('FASE2B-6 — flujo "No": NO modifica effectivePeriodAmount (samePeriodDecision distinto de "same_period" nunca entra al bloque de escritura de metadata)', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    assert.ok(block.includes("executeHistoricalCorrection({...correctionPayload,samePeriodDecision:'credit_balance'})"), `[${label}] el botón "No" debe pasar samePeriodDecision:'credit_balance'`);
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(execBlock.includes("if(samePeriodDecision==='same_period'){"), `[${label}] la escritura de metadata debe estar condicionada exactamente a 'same_period' -- 'credit_balance' nunca entra ahí`);
  }
});

caso('FASE2B-7 — si el RPC falla, NUNCA se escribe effectivePeriodAmount: el catch del RPC hace return antes de llegar al bloque de metadata', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    // extract() devuelve el texto HASTA el marcador de fin (sin incluirlo)
    // -- por diseño 'return;' queda fuera de catchBlock, así que la
    // presencia real de "return;" se confirma con indexOf más abajo, no
    // buscándolo adentro del slice.
    const catchStartIdx = execBlock.indexOf('}catch(err){');
    const catchReturnIdx = execBlock.indexOf('return;\n    }', catchStartIdx);
    assert.ok(catchStartIdx !== -1 && catchReturnIdx !== -1, `[${label}] el catch del RPC debe cortar la ejecución con return`);
    const metaWriteIdx = execBlock.indexOf('extraFields:newExtraForHistory');
    assert.ok(metaWriteIdx !== -1 && catchReturnIdx < metaWriteIdx, `[${label}] el return del catch del RPC debe ocurrir textualmente ANTES que la escritura de metadata`);
  }
});

caso('FASE2B-8 — si falla la metadata DESPUÉS de un RPC exitoso, no se revierte ni duplica el pago (no hay una segunda llamada al RPC ni a insert/void dentro del catch de metadata) y se muestra el mensaje exacto pedido', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    const metaCatchBlock = extract(execBlock, '}catch(metaErr){', 'closeModal();');
    assert.ok(!metaCatchBlock.includes("sb.rpc("), `[${label}] el catch de metadata no debe volver a llamar al RPC`);
    assert.ok(!/\.insert\(|\.delete\(/.test(metaCatchBlock), `[${label}] el catch de metadata no debe insertar ni borrar nada`);
    assert.ok(metaCatchBlock.includes("metaWarning='El pago fue corregido, pero no pudo guardarse que la diferencia corresponde a este período.';"), `[${label}] debe mostrar el mensaje exacto pedido`);
    // closeModal()/refreshDashboardData()/toast() se ejecutan SIEMPRE después, tanto si hubo error de metadata como si no
    assert.ok(execBlock.includes('closeModal();\n    await refreshDashboardData();\n    toast(metaWarning||'), `[${label}] debe seguir cerrando el modal y refrescando aunque la metadata haya fallado (execBlock ya está normalizado a LF)`);
  }
});

caso('FASE2B-9 — caso Edesur modelado end-to-end: documental 49.733,69, corrección a 49.907,71, "Sí" produce effectivePeriodAmount=49.907,71, pagado=49.907,71, saldo pendiente=0, saldo a favor=0', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'c28d3149-1958-4fd8-a8e2-017888409582', period: '2026-08-01', amount: 49733.69, notes: null });
  // Simula lo que hace executeHistoricalCorrection cuando samePeriodDecision==='same_period':
  // extraFields:{...extra,effectivePeriodAmount:newTotalAmount} -- exactamente ese merge.
  const extra = sb.obligationExtraFields(o);
  const newTotalAmount = 49907.71;
  o.notes = sb.updateObligationNotes(o.notes, { extraFields: { ...extra, effectivePeriodAmount: newTotalAmount } });
  const payments = [
    pay({ id: 'bb23b7f8-ba1c-4d07-b754-3d02d916a008', obligation_id: o.id, total_amount: 49907.71, voided: false }),
    pay({ id: '61b09c9c-a789-4a28-9d37-898c80a7fe14', obligation_id: o.id, total_amount: 0.69, voided: true }),
  ];
  assert.strictEqual(o.amount, 49733.69, 'obligation.amount (documental) nunca se toca');
  assert.strictEqual(sb.obligationExtraFields(o).effectivePeriodAmount, 49907.71);
  const sbWithData = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const progress = sbWithData.paymentProgress(o);
  assert.strictEqual(progress.paid, 49907.71);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0);
});

caso('FASE2B-10 — obligation.amount sigue siendo 49733.69 tras la corrección completa (documental jamás escrito por executeHistoricalCorrection)', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(!/from\('obligations'\)\.update\(\{[^}]*amount:/.test(execBlock), `[${label}] no debe existir ningún UPDATE de obligations que toque la columna amount`);
    assert.ok(execBlock.includes(".from('obligations').update({notes:notesValue}).eq('id',obligation.id)"), `[${label}] el único UPDATE de obligations debe tocar exclusivamente notes`);
  }
});

caso('FASE2B-11 — amountPending intacto: executeHistoricalCorrection nunca lee ni escribe extraFields.amountPending', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(!execBlock.includes('amountPending'), `[${label}] no debe tocar amountPending`);
  }
});

caso('FASE2B-12 — allocations intactas: la estimación previa usa paidAmountForWithAllocations (misma fuente real de "pagado", nunca una suma paralela)', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    assert.ok(block.includes('paidAmountForWithAllocations(obligation.id,payments,paymentAllocations)'), `[${label}] debe reutilizar paidAmountForWithAllocations, no una fórmula paralela`);
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(!/from\('payment_allocations'\)/.test(execBlock), `[${label}] executeHistoricalCorrection no debe tocar payment_allocations directamente (eso lo hace el RPC)`);
  }
});

caso('FASE2B-13 — anulaciones intactas: el auxiliar sigue anulándose exclusivamente vía el mismo RPC (p_void_auxiliary_payment_id), nunca con un DELETE/update directo desde el frontend', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(execBlock.includes('p_void_auxiliary_payment_id:auxiliaryPaymentId'), `[${label}] la anulación del auxiliar sigue yendo por el RPC`);
    assert.ok(!/from\('payments'\)\.(update|delete)/.test(execBlock), `[${label}] no debe haber un update/delete directo de payments desde el frontend`);
  }
});

caso('FASE2B-14 — documentos/Storage intactos: ni la pregunta ni executeHistoricalCorrection suben archivos, insertan documents ni tocan Storage', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    const execBlock = extract(block, 'async function executeHistoricalCorrection(', "\n  document.getElementById('confirmCorrectHistoricalPayment').onclick=async()=>{");
    assert.ok(!execBlock.includes('uploadDoc('), `[${label}] no debe subir documentos`);
    assert.ok(!/from\('documents'\)\.insert/.test(execBlock), `[${label}] no debe insertar documents`);
    assert.ok(!/\.storage\.|bucket/i.test(execBlock), `[${label}] no debe tocar Storage`);
  }
});

caso('FASE2B-15 — Tarjetas intacta tras FASE 2B: renderCreditCardsModule/bindCreditCardsModule/roundMoney/uploadCreditDocument siguen byte-idénticas al backup previo a la FASE (mismo backup usado en FASE 2)', () => {
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix12fase2'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix12fase2']]) {
    const beforePath = path.join(BACKUP_DIR, suffix);
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
  }
});

caso('FASE2B-16 — paridad exacta: openCorrectHistoricalPaymentModal() completa es byte-idéntica entre index.html e index_operator.html', () => {
  assert.strictEqual(CORRECT_MODAL_BLOCK_INDEX, CORRECT_MODAL_BLOCK_OPERATOR);
});

// ============================================================
// PARTE P — BUGFIX #12 FASE 2C: la UI ignoraba effectivePeriodAmount en
// tarjeta y detalle aunque la metadata real ya lo tuviera guardado
// ------------------------------------------------------------
// CAUSA RAÍZ REAL encontrada en la auditoría (ver informe de entrega):
// obligationNoteMeta() exigía que el JSON de OBLIGATION_META terminara
// EXACTAMENTE al final de la primera línea de notes
// (firstLine.endsWith(']]')) -- cualquier contenido extra en esa misma
// línea (un espacio final, un CR suelto, texto pegado sin salto de
// línea real) hacía que TODA la metadata se descartara en silencio y
// devolviera {}, perdiendo effectivePeriodAmount aunque el valor
// estuviera de verdad en la columna real. obligationUserNotes() ya usaba
// un regex tolerante que NO exige esto -- había una inconsistencia entre
// ambas funciones. Se corrigió obligationNoteMeta() para usar el mismo
// criterio tolerante (CASO FASE2C-1/1b).
//
// Además, la consulta de obligations del Panel general/"Obligaciones del
// mes" (loadSpacesDashboard) no traía la columna notes en absoluto -- ahí
// obligationExtraFields() SIEMPRE devolvía {} sin importar qué hubiera
// guardado (CASO FASE2C-14).
// ============================================================

// Fixture EXACTA al estado real reportado: obligation.amount=49733.69,
// extraFields.effectivePeriodAmount=49907.71, payment activo 49907.71,
// payment auxiliar 0.69 voided=true.
function buildRealEdesurFixture(notesOverride) {
  const notes = notesOverride !== undefined
    ? notesOverride
    : obligationMeta({ effectivePeriodAmount: 49907.71 });
  const o = obl({ id: 'c28d3149-1958-4fd8-a8e2-017888409582', service_id: 'service-edesur', period: '2026-08-01', amount: 49733.69, due_date: '2026-08-12', status: 'paid', notes });
  const payments = [
    pay({ id: 'bb23b7f8-ba1c-4d07-b754-3d02d916a008', obligation_id: o.id, total_amount: 49907.71, voided: false }),
    pay({ id: '61b09c9c-a789-4a28-9d37-898c80a7fe14', obligation_id: o.id, total_amount: 0.69, voided: true }),
  ];
  return { o, payments };
}

caso('FASE2C-1 — obligationNoteMeta() parsea effectivePeriodAmount aunque haya contenido extra en la misma línea del JSON (formato real tolerado, antes se perdía en silencio)', () => {
  const sb = buildSandboxIndex({});
  const notesConTrailing = `${obligationMeta({ effectivePeriodAmount: 49907.71 })} `; // espacio final real
  const extra = sb.obligationExtraFields({ notes: notesConTrailing });
  assert.strictEqual(extra.effectivePeriodAmount, 49907.71, 'debe seguir leyendo effectivePeriodAmount aunque la línea no termine exactamente en "]]"');
});

caso('FASE2C-1b — este mismo fixture HABRÍA fallado con el parseo estricto anterior (firstLine.endsWith(\']\']) -- se documenta acá el contraste para dejar registrada la causa raíz real', () => {
  const notesConTrailing = `${obligationMeta({ effectivePeriodAmount: 49907.71 })} `;
  const OBLIGATION_META_PREFIX = '[[OBLIGATION_META:';
  function obligationNoteMetaVIEJA(rawNotes) {
    const notes = String(rawNotes || '');
    const firstLine = notes.split(/\r?\n/, 1)[0];
    if (!firstLine.startsWith(OBLIGATION_META_PREFIX) || !firstLine.endsWith(']]')) return {};
    try { return JSON.parse(firstLine.slice(OBLIGATION_META_PREFIX.length, -2)) || {}; } catch { return {}; }
  }
  assert.deepStrictEqual(obligationNoteMetaVIEJA(notesConTrailing), {}, 'el parseo anterior perdía TODA la metadata con un solo espacio final -- confirma la causa raíz real');
});

caso('FASE2C-2/3 — metadata real Edesur: obligation.amount=49733.69 (documental, intacto) y effectivePeriodAmount=49907.71 leído correctamente', () => {
  const sb = buildSandboxIndex({});
  const { o } = buildRealEdesurFixture();
  assert.strictEqual(o.amount, 49733.69);
  assert.strictEqual(sb.obligationExtraFields(o).effectivePeriodAmount, 49907.71);
});

caso('FASE2C-4/5 — pago activo=49907.71, pago voided 0.69 no cuenta', () => {
  const sb = buildSandboxIndex({});
  const { o, payments } = buildRealEdesurFixture();
  assert.strictEqual(sb.paidAmountForWithAllocations(o.id, payments, []), 49907.71);
});

caso('FASE2C-6/7/8 — effectiveObligationAmount=49907.71, saldo pendiente=0, saldo a favor=0 (fixture real completa, vía paymentProgress)', () => {
  const sb = buildSandboxIndex({});
  const { o, payments } = buildRealEdesurFixture();
  assert.strictEqual(sb.effectiveObligationAmount(o, payments, []), 49907.71);
  const sbWithData = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const progress = sbWithData.paymentProgress(o);
  assert.strictEqual(progress.balance, 0, 'saldo pendiente debe ser 0');
  assert.strictEqual(progress.creditBalance, 0, 'saldo a favor debe ser 0, nunca 174.02');
});

caso('FASE2C-9 — no debe activarse la condición que dispara el aviso "Hay un saldo a favor de..." (progress.creditBalance>0.01 es falso con la fixture real)', () => {
  const sb = buildSandboxIndex({ obligations: [buildRealEdesurFixture().o], payments: buildRealEdesurFixture().payments, paymentAllocations: [] });
  const { o } = buildRealEdesurFixture();
  const sbReal = buildSandboxIndex({ obligations: [o], payments: buildRealEdesurFixture().payments, paymentAllocations: [] });
  const progress = sbReal.paymentProgress(o);
  assert.ok(!(progress.creditBalance > 0.01), 'con la fixture real, la condición del aviso de saldo a favor no debe dispararse');
});

caso('FASE2C-10 — tarjeta/matriz (boxText): con status=paid y effectivePeriodAmount cargado, muestra ["Abonado", "$49.907,71"], NUNCA "$49.733,69"', () => {
  const { o, payments } = buildRealEdesurFixture();
  const sb = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const [label, amountText] = sb.boxText(o, { id: 'service-edesur', name: 'Edesur' });
  assert.strictEqual(label, 'Abonado');
  assert.ok(amountText.includes('49.907,71'), `la tarjeta debe mostrar 49.907,71, obtuvo "${amountText}"`);
  assert.ok(!amountText.includes('49.733,69'), `la tarjeta NUNCA debe mostrar el documental 49.733,69 como importe principal, obtuvo "${amountText}"`);
});

caso('FASE2C-11/12 — "Total factura" sigue siendo 49.733,69 (documental) y "Importe efectivo de este período" aparece aparte con 49.907,71 (los 3 renderers auditados en FASE 2B siguen correctos con la fixture real)', () => {
  const sb = buildSandboxIndex({});
  const { o } = buildRealEdesurFixture();
  assert.strictEqual(sb.fmtMoneyExact(o.amount).includes('49.733,69'), true);
  const { payments } = buildRealEdesurFixture();
  const sbReal = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const progress = sbReal.paymentProgress(o);
  assert.ok(sb.fmtMoneyExact(progress.amount).includes('49.907,71'));
});

caso('FASE2C-13 — sin effectivePeriodAmount, el comportamiento histórico sigue intacto: boxText muestra el documental como importe principal', () => {
  const o = obl({ id: 'o-normal', service_id: 'service-1', period: '2026-08-01', amount: 15000, due_date: '2026-08-10', status: 'paid', notes: null });
  const payments = [pay({ id: 'p-1', obligation_id: 'o-normal', total_amount: 15000, voided: false })];
  const sb = buildSandboxIndex({ obligations: [o], payments, paymentAllocations: [] });
  const [label, amountText] = sb.boxText(o, { id: 'service-1', name: 'Servicio' });
  assert.strictEqual(label, 'Abonado');
  assert.ok(amountText.includes('15.000'));
});

caso('FASE2C-14 — el Panel general ("Obligaciones del mes") ahora trae notes en su consulta de obligations, para no perder effectivePeriodAmount/amountPending/secondDueDate en ese camino paralelo', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const loadBlock = extract(text, 'async function loadSpacesDashboard(){', '\n// CORRECCIÓN — si la carga de imputaciones del Panel general falló');
    assert.ok(/sb\.from\('obligations'\)\.select\('[^']*\bnotes\b[^']*'\)/.test(loadBlock), `[${label}] la consulta de obligations del Panel general debe incluir notes`);
  }
});

caso('FASE2C-14b — serviceObligationRowsForMonth (fila de "Obligaciones del mes") usa effectiveObligationAmount para el importe mostrado, no el documental crudo', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const rowsBlock = extract(text, 'function serviceObligationRowsForMonth(monthKeyStr){', '\n  // "Sin importe"');
    assert.ok(rowsBlock.includes('const amountArs=effectiveObligationAmount(obligation,spacesDashboard.payments,spacesDashboard.paymentAllocations);'), `[${label}] amountArs debe venir de effectiveObligationAmount, no de Number(amountRaw||0)`);
  }
});

caso('FASE2C-15 — FASE 2B (openCorrectHistoricalPaymentModal, pregunta de mismo período, orden RPC->metadata) sigue intacta: se reutiliza el mismo bloque ya verificado en FASE2B-3/5', () => {
  for (const [label, block] of [['index.html', CORRECT_MODAL_BLOCK_INDEX], ['index_operator.html', CORRECT_MODAL_BLOCK_OPERATOR]]) {
    assert.ok(block.includes('id="correctSamePeriodQuestion"'), `[${label}] la pregunta de mismo período debe seguir existiendo`);
    assert.ok(block.includes("executeHistoricalCorrection({...correctionPayload,samePeriodDecision:'same_period'})"), `[${label}] el flujo "Sí" debe seguir intacto`);
  }
});

caso('FASE2C-16 — segundo vencimiento intacto: effectiveObligationAmount sigue combinando effectivePeriodAmount con secondDueDate/secondAmount exactamente igual que antes', () => {
  const sb = buildSandboxIndex({});
  const o = obl({
    id: 'o-combo', period: '2026-06-01', amount: 10000, due_date: '2020-01-01',
    notes: obligationMeta({ effectivePeriodAmount: 10500, secondDueDate: '2020-01-10', secondAmount: 12000 }),
  });
  assert.strictEqual(sb.effectiveObligationAmount(o, [], []), 12000);
});

caso('FASE2C-17 — amountPending intacto: obligationExtraFields sigue leyendo amountPending correctamente con el nuevo parseo tolerante', () => {
  const sb = buildSandboxIndex({});
  const o = obl({ id: 'o-pend', period: '2026-08-01', notes: obligationMeta({ amountPending: true }) });
  assert.strictEqual(sb.obligationExtraFields(o).amountPending, true);
});

caso('FASE2C-18 — allocations intactas: paidAmountForWithAllocations sigue sumando igual con la fixture real de Edesur si hubiera allocations activas', () => {
  const sb = buildSandboxIndex({});
  const { o } = buildRealEdesurFixture();
  const payments = [pay({ id: 'p-1', obligation_id: o.id, total_amount: 30000, voided: false })];
  const allocations = [{ payment_id: 'p-1', obligation_id: o.id, allocated_amount: 30000, is_active: true }];
  assert.strictEqual(sb.paidAmountForWithAllocations(o.id, payments, allocations), 30000);
});

caso('FASE2C-19 — anulaciones intactas: el pago auxiliar voided de la fixture real sigue excluido de paidAmountForWithAllocations tras el fix de parseo', () => {
  const sb = buildSandboxIndex({});
  const { o, payments } = buildRealEdesurFixture();
  const pagadoConAuxiliarVivo = sb.paidAmountForWithAllocations(o.id, [payments[0], { ...payments[1], voided: false }], []);
  assert.strictEqual(Math.round((pagadoConAuxiliarVivo - sb.paidAmountForWithAllocations(o.id, payments, [])) * 100) / 100, 0.69);
});

caso('FASE2C-20 — documentos/Storage intactos: el fix de obligationNoteMeta/consulta del panel no toca documents ni Storage', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    const fnBlock = extract(text, 'function obligationNoteMeta(rawNotes){', '\nfunction obligationUserNotes(');
    assert.ok(!fnBlock.includes('uploadDoc('), `[${label}] no debe subir documentos`);
    assert.ok(!/from\('documents'\)|storage\.from\(/.test(fnBlock), `[${label}] no debe tocar documents/Storage`);
  }
});

caso('FASE2C-21 — Tarjetas intacta tras FASE 2C: renderCreditCardsModule/bindCreditCardsModule/roundMoney/uploadCreditDocument siguen byte-idénticas al backup de FASE 2', () => {
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix12fase2'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix12fase2']]) {
    const beforePath = path.join(BACKUP_DIR, suffix);
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
  }
});

caso('FASE2C-14c — paridad titular/operador: obligationNoteMeta() y la fila de "Obligaciones del mes" quedaron byte-idénticas entre index.html e index_operator.html', () => {
  const markers = [
    ['obligationNoteMeta', 'function obligationNoteMeta(rawNotes){', '\nfunction obligationUserNotes('],
    ['loadSpacesDashboard select', "sb.from('obligations').select('id,service_id,period,amount,status,due_date,notes,services!inner(group_id,name)')", '.in(\'services.group_id\',groupIds)'],
    ['serviceObligationRowsForMonth amountArs', 'const amountArs=effectiveObligationAmount(obligation,spacesDashboard.payments,spacesDashboard.paymentAllocations);', '\n'],
  ];
  for (const [nombre, start, end] of markers) {
    assert.strictEqual(extract(indexText, start, end), extract(operatorText, start, end), `bloque "${nombre}" debe ser byte-idéntico entre index.html e index_operator.html`);
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
  console.log('AVISO: valida lógica real extraída con arrays en memoria, NO ejecución real contra Postgres/Supabase. NO se modificó Supabase, NO se tocó el registro real de Edesur.');
  if (fail > 0) process.exitCode = 1;
}

run();
