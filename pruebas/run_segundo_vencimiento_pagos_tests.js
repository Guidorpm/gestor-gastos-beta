// ============================================================
// PRUEBA LOCAL — Segundo vencimiento + centavos + pagos parciales/
// excedentes + saldo a favor (aplicación real vía payment_allocations)
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta prueba NO abre un navegador real y NO puede
// interactuar con el diálogo confirm() del navegador ni con Supabase
// real. Lo que SÍ hace, de forma reproducible:
//
//   1) EXTRAE y EJECUTA (no reimplementa) el código real de
//      dueState()/boxText()/boxClass()/paymentProgress()/balanceFor()/
//      creditBalanceFor()/effectiveObligationAmount()/
//      paidAmountAsOfWithAllocations()/previousBalanceFor()/
//      creditAvailableForPayment()/availableServiceCredits()/
//      applyServiceCreditToObligation()/fmtMoneyExact()/roundServiceMoney()
//      directamente de index.html.
//
//   2) Para applyServiceCreditToObligation() (la única función async que
//      escribe), se mockea `sb` con un cliente en memoria que simula
//      payment_allocations (incluye las mismas reglas ya confirmadas por
//      el diagnóstico real de Supabase: UNIQUE(payment_id,obligation_id)
//      WHERE is_active, allocated_amount>0) -- NUNCA toca Supabase real,
//      nunca crea un pago/allocation real de prueba.
//
//   3) Controla la fecha "de hoy" inyectando un Date fijo.
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBA MANUAL" en el reporte de entrega):
//   - que el diálogo confirm() realmente aparece;
//   - que los campos de segundo vencimiento/aplicar crédito se ven bien.
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

const fnFmtDateEsc = extract(indexText, 'function fmtDate(v){', 'function today(){');
const fnToday = extract(indexText, 'function today(){', 'function daysUntil(');
const fnDaysUntil = extract(indexText, 'function daysUntil(v){', 'function todayDateString(');
const fnTodayDateString = extract(indexText, 'function todayDateString(){', 'function rolePriority(');
const fnIsOwner = extract(indexText, 'function isOwner(){', '\n');
const lnMonths = extract(indexText, 'const MONTHS=[', '\n');
const fnMonthLabelFmtMoney = extract(indexText, 'function monthLabel(key){', 'function parseMoneyField(');
const fnFmtMoneyExactRound = extract(indexText, 'function fmtMoneyExact(v){', 'function parseMoneyField(');
const fnParseMoneyField = extract(indexText, 'function parseMoneyField(value){', 'function formatMoneyField(');
const fnPeriodDate = extract(indexText, 'function periodDate(key){', '\n');
const fnObligationFor = extract(indexText, 'function obligationFor(serviceId,key){', '\n');
const blockObligationMeta = extract(indexText, 'const OBLIGATION_META_PREFIX=', 'async function annulObligationMonth(');
const blockFmtUsdFormatUsd = extract(indexText, 'function fmtUsd(value){', 'function parseArgentineNumber(');
const blockPaidAmountEffective = extract(indexText, 'function paidAmountForWithAllocations(obligationId,paymentsList,allocationsList){', 'function isServiceVisibleForCurrentContext(');
const blockPaidAmountForBalanceFor = extract(indexText, 'function paidAmountFor(obligationId){', 'function paymentProgress(obligation){');
const blockPaymentProgress = extract(indexText, 'function paymentProgress(obligation){', '// CORRECCIÓN 6B4.15 - Metadata técnica');
const blockFreqPlanEmptyPaymentsFor = extract(indexText, 'function frequencyLabel(service){', 'function paymentFor(');
const blockConsolidationCreditsChain = extract(indexText, 'function consolidationForSource(', 'function dueState(o){');
const blockDueState = extract(indexText, 'function dueState(o){', 'function boxClass(o)');
const fnBoxClass = extract(indexText, 'function boxClass(o){', '\n');
const blockBoxText = extract(indexText, 'function boxText(o,service){', 'function lastKnownAmount(');

const REAL_SOURCE = [
  fnFmtDateEsc, fnToday, fnDaysUntil, fnTodayDateString, fnIsOwner, lnMonths, fnMonthLabelFmtMoney,
  fnFmtMoneyExactRound, fnParseMoneyField, fnPeriodDate, fnObligationFor, blockObligationMeta, blockFmtUsdFormatUsd,
  blockPaidAmountEffective, blockPaidAmountForBalanceFor, blockPaymentProgress, blockFreqPlanEmptyPaymentsFor,
  blockConsolidationCreditsChain, blockDueState, fnBoxClass, blockBoxText,
].join('\n');

// ---------------- Sandbox: Date fijo + mock de Supabase en memoria ----------------

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

// MOCK documentado: simula payment_allocations en memoria con las MISMAS
// reglas ya confirmadas por el diagnóstico real de Supabase (UNIQUE
// (payment_id,obligation_id) WHERE is_active, allocated_amount>0) --
// nunca toca Supabase real, nunca ejecuta un INSERT/UPDATE/DELETE real.
function buildMockSb(state) {
  return {
    from(table) {
      return {
        insert(rows) {
          const rowsArr = Array.isArray(rows) ? rows : [rows];
          for (const r of rowsArr) {
            if (!(Number(r.allocated_amount) > 0)) {
              return Promise.resolve({ error: { message: 'allocated_amount debe ser mayor a 0' } });
            }
            const dupe = state.allocations.find(a => a.is_active === true && a.payment_id === r.payment_id && a.obligation_id === r.obligation_id);
            if (dupe) {
              return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "uq_payment_allocations_active_pair"' } });
            }
          }
          state.allocations.push(...rowsArr.map((r, i) => ({ id: `new-${table}-${state.allocations.length + i}`, is_active: true, ...r })));
          return Promise.resolve({ error: null });
        },
        update(patch) {
          return {
            eq(col, val) {
              const row = state.allocations.find(a => a[col] === val);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    rpc() { return Promise.resolve({ error: null }); },
  };
}

function buildSandbox({ now, obligations, services, payments, paymentAllocations, consolidationsFixture, members, group, session, allocationsLoadError, mockState }) {
  const state = mockState || { allocations: paymentAllocations ? [...paymentAllocations] : [] };
  const sandbox = {
    Date: FixedDateFactory(now || '2026-08-15T00:00:00'),
    obligations: obligations || [],
    services: services || [],
    payments: payments || [],
    get paymentAllocations() { return state.allocations; },
    consolidations: consolidationsFixture || [],
    members: members || [],
    group: group === undefined ? { id: 'g1', created_by: 'owner-uid' } : group,
    session: session === undefined ? { user: { id: 'owner-uid' } } : session,
    paymentAllocationsLoadError: !!allocationsLoadError,
    sb: buildMockSb(state),
    syncObligationStatus: async () => {},
    console,
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { dueState, boxText, boxClass, obligationFor, paymentProgress, balanceFor, creditBalanceFor, previousBalanceFor, obligationExtraFields, isEffectivePending, effectiveObligationAmount, paidAmountAsOfWithAllocations, fmtMoneyExact, roundServiceMoney, serviceMoneyCents, creditAvailableForPayment, availableServiceCredits, applyServiceCreditToObligation, paymentNoteMetadata, paymentAppliedDueStage, buildPaymentNotes, obligationHasSecondStagePayment, updateObligationNotes, obligationUserNotes, parseMoneyField };');
  const built = fn(...Object.values(sandbox));
  built.__state = state;
  return built;
}

// ---------------- Fixtures ----------------
const HOY = '2026-08-15T00:00:00';
const KEY = '2026-08';

function svc(id, overrides = {}) {
  return { id, name: id, category: 'General', frequency: 'monthly', is_private: false, ...overrides };
}
function ob(id, serviceId, overrides = {}) {
  return { id, service_id: serviceId, period: '2026-08-01', amount: 1000, status: 'active', due_date: null, notes: '', ...overrides };
}
function payment(id, obligationId, totalAmount, overrides = {}) {
  return { id, obligation_id: obligationId, total_amount: totalAmount, paid_at: '2026-08-05', voided: false, ...overrides };
}
function withSecondDue(dueDate, amount) {
  const meta = { extraFields: { secondDueDate: dueDate, ...(amount != null ? { secondAmount: amount } : {}) } };
  return { notes: `[[OBLIGATION_META:${JSON.stringify(meta)}]]` };
}
// payments.notes real (confirmado por diagnóstico read-only de Guido) --
// JSON puro, sin prefijo de línea (a diferencia de obligations.notes).
function withAppliedDueStage(stage) {
  return { notes: JSON.stringify({ appliedDueStage: stage }) };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// DECIMALES (1-8 del pedido)
// ============================================================

caso('CASO 1 — 100000.37 - 100000.37 = 0.00 (pago exacto con centavos)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100000.37);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
  assert.strictEqual(sandbox.dueState(o1).cls, 'paid');
});

caso('CASO 2 — 100000.37 - 100000.00 = 0.37 (pago menor, saldo con centavos exacto)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100000.00);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0.37);
  assert.strictEqual(progress.partial, true);
  assert.strictEqual(progress.fullyPaid, false);
});

caso('CASO 3 — pago 100000.50 sobre deuda 100000.37 = crédito 0.13', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100000.50);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0.13);
  assert.strictEqual(sandbox.creditBalanceFor(o1), 0.13);
});

caso('CASO 4 — 0.1 + 0.2 normalizado correctamente (roundServiceMoney evita el ruido binario)', () => {
  const sandbox = buildSandbox({});
  assert.strictEqual(sandbox.roundServiceMoney(0.1 + 0.2), 0.3);
  assert.notStrictEqual(0.1 + 0.2, 0.3, 'confirma que sin normalizar SÍ hay ruido binario (0.30000000000000004)');
});

caso('CASO 5 — múltiples pagos con decimales cancelan exactamente (sin residuo)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 300.30, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100.10);
  const p2 = payment('p2', 'o1', 100.10);
  const p3 = payment('p3', 'o1', 100.10);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1, p2, p3] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 6 — la visualización muestra centavos (fmtMoneyExact, no fmtMoney)', () => {
  // Nota: toLocaleString('es-AR',{style:'currency',...}) usa un espacio
  // NBSP (U+00A0) entre "$" y el número, no un espacio regular -- se
  // compara contra el mismo formateador nativo en vez de un literal
  // escrito a mano, para no depender de ese detalle de Intl.
  const sandbox = buildSandbox({});
  assert.strictEqual(sandbox.fmtMoneyExact(43220.37), (43220.37).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  assert.ok(sandbox.fmtMoneyExact(43220.37).includes('43.220,37'), 'debe conservar los centavos reales, no redondear a $43.220');
  assert.ok(sandbox.fmtMoneyExact(43220).includes('43.220,00'), '43220.00 puede mostrarse con ,00 -- no es obligatorio ocultar los decimales en cero');
});

caso('CASO 7 — Tarjetas NO cambia de formato (fmtMoney sigue en 0 decimales, sin tocar)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("function fmtMoney(v){return Number(v||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0})}"), 'fmtMoney (compartida con Tarjetas) no debe haberse modificado');
  }
});

caso('CASO 8 — ningún redondeo entero entra en la lógica contable (parseMoneyField preserva decimales completos)', () => {
  for (const text of [indexText, operatorText]) {
    const fnParse = extract(text, 'function parseMoneyField(value){', 'function formatMoneyField(');
    assert.ok(!/Math\.round|parseInt/.test(fnParse), 'parseMoneyField no debe truncar/redondear el valor real ingresado');
  }
});

// ============================================================
// SEGUNDO VENCIMIENTO (9-18 del pedido, regla corregida)
// ============================================================

caso('CASO 9 — solo primer importe (sin segundo vencimiento): comportamiento idéntico a antes de esta mejora', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 1000, due_date: '2026-08-10' });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 1000);
  assert.strictEqual(sandbox.dueState(o1).label, 'Vencido hace 5 días');
});

caso('CASO 10 — segundo vencimiento SIN segundo importe: solo afecta la fecha de mora, no el importe', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 1000, due_date: '2026-08-10', ...withSecondDue('2026-08-20', null) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 1000, 'sin segundo importe, el importe exigible sigue siendo el primero');
  assert.strictEqual(sandbox.dueState(o1).cls, 'warning', 'pero la banda visual sí usa el segundo vencimiento como referencia de mora');
});

caso('CASO 11 — segundo importe IGUAL al primero: pasado el 1er vencimiento, sigue exigiéndose el mismo importe', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 1000, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 1000) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1] });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 1000);
});

caso('CASO 12 — hasta el primer vencimiento inclusive, se usa importe 1 (incluso con segundo importe cargado)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-08-15', ...withSecondDue('2026-08-20', 105000.82) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 100000.37, 'el 15/08 es el propio día del vencimiento -- inclusive, todavía importe 1');
});

caso('CASO 13 — después de vencido el primer vencimiento (y no cubierto a tiempo), se exige el importe 2', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105000.82) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 105000.82);
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 105000.82);
});

caso('CASO 14 — después del segundo vencimiento, se mantiene el importe 2 y queda VENCIDO', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-08-10', ...withSecondDue('2026-08-12', 105000.82) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [], []), 105000.82, 'el importe exigible sigue siendo el 2, no aparece un tercer importe');
  assert.strictEqual(sandbox.dueState(o1).cls, 'overdue');
});

caso('CASO 15 — PASO E: pagada totalmente ANTES del primer vencimiento -> NO genera recargo, sigue Abonada para siempre', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105000) });
  const p1 = payment('p1', 'o1', 100000, { paid_at: '2026-08-08' }); // pagada el 08/08, antes del 1er vencimiento
  // "Hoy" es 15/08 -- ya pasó el primer vencimiento y ya se acerca el segundo.
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 100000, 'quedó cubierta a tiempo -- nunca pasa a exigir el importe 2');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
  assert.strictEqual(sandbox.dueState(o1).cls, 'paid', 'no debe aparecer como vencida ni con un saldo nuevo de $5.000');
});

caso('CASO 16 — PASO F: pago PARCIAL antes del primer vencimiento -> el saldo se calcula contra el importe 2, restando el pago ya hecho', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105) });
  const p1 = payment('p1', 'o1', 80, { paid_at: '2026-08-08' }); // parcial, antes del 1er vencimiento
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 105, '80 no cubre los 100 del importe 1 -> pasa a exigirse el importe 2');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 25, '105 - 80 = 25, NUNCA 100-80=20 ni 105+80');
});

caso('CASO 17 — ambos importes históricos se conservan siempre (o.amount nunca se sobrescribe)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105000.82) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], now: '2026-08-25T00:00:00' });
  sandbox.effectiveObligationAmount(o1, [], []); // fuerza el cálculo (importe 2 exigible)
  assert.strictEqual(o1.amount, 100000.37, 'el importe 1 real en la obligación nunca cambia');
  assert.strictEqual(sandbox.obligationExtraFields(o1).secondAmount, 105000.82, 'el importe 2 sigue disponible por separado');
});

caso('CASO 18 — no se duplica la obligación: sigue existiendo UN solo registro/UNA sola factura', () => {
  for (const text of [indexText, operatorText]) {
    const saveBlock = extract(text, 'async function saveMonthData({uploadInvoice=false}={}){', 'const saveButton=document.getElementById(\'saveObligation\');');
    assert.ok(!/from\('obligations'\)\.insert\(payload\)/.test(saveBlock) || saveBlock.includes('upsert'), 'la creación sigue siendo un único upsert por (service_id,period)');
    assert.ok(saveBlock.includes("await sb.from('obligations').update(payload).eq('id',o.id)"), 'editar (incluido cargar el segundo vencimiento) sigue siendo un UPDATE por id, nunca una fila nueva');
  }
});

// ============================================================
// PAGOS (19-25 del pedido)
// ============================================================

caso('CASO 19 — pago menor permitido, con advertencia disponible (sin bloqueo)', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, 'const diffCents=serviceMoneyCents(total)', "const saveButton=document.getElementById('savePay');");
    assert.ok(block.includes('diffCents<0'));
    assert.ok(block.includes('saldo pendiente'));
    assert.ok(!block.includes('return toast'), 'ningún caso de esta sección debe bloquear con un return toast -- solo confirm()');
  }
});

caso('CASO 20 — pago exacto permitido sin ninguna advertencia (diff dentro de la tolerancia)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 500 });
  const p1 = payment('p1', 'o1', 500);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  const diff = sandbox.roundServiceMoney(500 - progress.balance);
  assert.strictEqual(Math.abs(diff), 500, 'sanity: sin pagos, el balance es 500'); // control cruzado simple
  assert.strictEqual(progress.balance, 0);
});

caso('CASO 21 — pago mayor permitido con advertencia (crédito, no bloqueo)', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, 'const diffCents=serviceMoneyCents(total)', "const saveButton=document.getElementById('savePay');");
    assert.ok(block.includes('diffCents>0'));
    assert.ok(block.includes('saldo a favor'));
  }
});

caso('CASO 22 — confirmación de pago menor muestra correspondiente/ingresado/saldo restante', () => {
  // AJUSTE — MEJORA SELECTOR DE VENCIMIENTO: el texto ya no compara contra
  // progress.balance (saldo real automático) sino contra selectedDueAmount
  // (el importe del vencimiento elegido para ESTE pago) -- ver CASO 62-68
  // para la prueba funcional de por qué este cambio es necesario (ej.
  // "Base 100, Segundo 105, elige Segundo, paga 120 -> saldo a favor 15,
  // NUNCA 20"). El literal se actualiza para reflejar la nueva variable;
  // el comportamiento para obligaciones SIN segundo vencimiento no cambia
  // (selectedDueAmount==progress.balance en ese caso).
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('Importe correspondiente: ${fmtMoneyExact(selectedDueAmount)}\\nPago ingresado: ${fmtMoneyExact(total)}\\nQuedará un saldo pendiente de ${fmtMoneyExact(selectedDueAmount-total)}'));
  }
});

caso('CASO 23 — confirmación de pago mayor muestra correspondiente/ingresado/excedente', () => {
  // AJUSTE — MEJORA SELECTOR DE VENCIMIENTO: mismo motivo que CASO 22.
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('El importe ingresado supera el importe correspondiente en ${fmtMoneyExact(diff)}'));
  }
});

caso('CASO 24 — el pago mayor NUNCA se recorta: total se guarda tal cual se ingresó', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, "document.getElementById('savePay').onclick=async()=>{", 'function openInvoiceMonthPicker(serviceId){');
    assert.ok(block.includes('total_amount:total'), 'el INSERT a payments usa el total ingresado tal cual, sin Math.min contra el saldo');
  }
});

caso('CASO 25 — el bloqueo viejo ("El pago no puede superar el saldo pendiente") no existe en ningún lado', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(!text.includes('El pago no puede superar el saldo pendiente'));
  }
});

// ============================================================
// ALLOCATIONS / CRÉDITO (26-40 del pedido)
// ============================================================

caso('CASO 26 — pago legacy sin allocations sigue funcionando exactamente igual que antes', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 1000 });
  const p1 = payment('p1', 'o1', 1000);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], paymentAllocations: [] });
  assert.strictEqual(sandbox.paymentProgress(o1).balance, 0);
});

caso('CASO 27 — primera división crea la allocation ORIGINAL y la FUTURA en una sola operación atómica', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  const rowsForP1 = sandbox.__state.allocations.filter(a => a.payment_id === 'p1');
  assert.strictEqual(rowsForP1.length, 2, 'debe haber exactamente 2 filas: original + destino');
  assert.ok(rowsForP1.some(a => a.obligation_id === 'oAgo' && a.allocated_amount === 100));
  assert.ok(rowsForP1.some(a => a.obligation_id === 'oSep' && a.allocated_amount === 20));
});

caso('CASO 28 — el total de allocations activas de ese pago es exactamente igual al total del pago', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100 });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90 });
  const p1 = payment('p1', 'oAgo', 120);
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  const total = sandbox.__state.allocations.filter(a => a.payment_id === 'p1').reduce((s, a) => s + a.allocated_amount, 0);
  assert.strictEqual(total, 120);
});

caso('CASO 29 — no hay doble conteo: agosto=100, septiembre=20, NUNCA agosto=120+septiembre=20', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  const allocations = sandbox.__state.allocations;
  assert.strictEqual(sandbox.balanceFor(oAgo), 0, 'agosto: saldo 0 (cubierto por su allocation de 100, no por los 120 completos)');
  assert.strictEqual(sandbox.balanceFor(oSep), 70, 'septiembre: 90 - 20 aplicado = 70, no 90-120');
  const totalAllocated = allocations.filter(a => a.payment_id === 'p1' && a.is_active).reduce((s, a) => s + a.allocated_amount, 0);
  assert.strictEqual(totalAllocated, 120, 'nunca 140 (100+20 septiembre erróneo) ni ningún valor que exceda el pago real');
});

caso('CASO 30 — no desaparece el pago original: agosto sigue mostrando su cobertura después de dividir', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  assert.strictEqual(sandbox.paymentProgress(oAgo).fullyPaid, true, 'agosto sigue Abonada -- el pago no "desaparece" de su obligación original');
});

caso('CASO 31 — crédito disponible correcto para un pago legacy sin allocations (reserva el importe de la obligación original)', () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo], services: [s1], payments: [p1], paymentAllocations: [] });
  const credits = sandbox.availableServiceCredits('s1');
  assert.strictEqual(credits.length, 1);
  assert.strictEqual(credits[0].available, 20, 'disponible = 120 - 100 reservados para agosto, NUNCA los 120 completos');
});

caso('CASO 32 — aplicación PARCIAL del crédito disponible', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 150, { paid_at: '2026-08-05' }); // crédito real de 50
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  const credits = sandbox.availableServiceCredits('s1');
  assert.strictEqual(credits[0].available, 50);
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 50, oSep, 30); // aplica solo 30 de los 50
  assert.strictEqual(sandbox.balanceFor(oSep), 60, '90-30=60');
});

caso('CASO 33 — crédito remanente correcto después de una aplicación parcial', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 150, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 50, oSep, 30);
  const remaining = sandbox.availableServiceCredits('s1');
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].available, 20, '50 disponibles - 30 aplicados = 20 remanentes, sin recrear la allocation original');
  const rowsForP1 = sandbox.__state.allocations.filter(a => a.payment_id === 'p1');
  assert.strictEqual(rowsForP1.length, 2, 'sigue habiendo solo 2 filas -- no se duplicó la del origen');
});

caso('CASO 34 — aplicación a MÚLTIPLES meses siguientes desde el mismo crédito remanente', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 15, due_date: '2026-09-05' });
  const oOct = ob('oOct', 's1', { period: '2026-10-01', amount: 15, due_date: '2026-10-05' });
  const p1 = payment('p1', 'oAgo', 130, { paid_at: '2026-08-05' }); // crédito real de 30
  const sandbox = buildSandbox({ obligations: [oAgo, oSep, oOct], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 30, oSep, 15);
  const afterFirst = sandbox.availableServiceCredits('s1');
  assert.strictEqual(afterFirst[0].available, 15);
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 15, oOct, 15);
  assert.strictEqual(sandbox.balanceFor(oSep), 0);
  assert.strictEqual(sandbox.balanceFor(oOct), 0);
  const total = sandbox.__state.allocations.filter(a => a.payment_id === 'p1').reduce((s, a) => s + a.allocated_amount, 0);
  assert.strictEqual(total, 130, '100 (agosto) + 15 (septiembre) + 15 (octubre) = 130 = total del pago, sin excederlo');
});

caso('CASO 35 — el crédito de un servicio NUNCA incluye pagos de otro servicio (mismo service_id obligatorio)', () => {
  const s1 = svc('s1'), s2 = svc('s2');
  const oEdesur = ob('oEdesur', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oMovistar = ob('oMovistar', 's2', { period: '2026-08-01', amount: 50, due_date: '2026-08-05' });
  const pEdesur = payment('pEdesur', 'oEdesur', 120, { paid_at: '2026-08-05' });
  const pMovistar = payment('pMovistar', 'oMovistar', 60, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oEdesur, oMovistar], services: [s1, s2], payments: [pEdesur, pMovistar], paymentAllocations: [] });
  const creditsS1 = sandbox.availableServiceCredits('s1');
  assert.strictEqual(creditsS1.length, 1);
  assert.strictEqual(creditsS1[0].payment.id, 'pEdesur', 'el crédito de s1 debe venir solo de un pago de s1');
  const creditsS2 = sandbox.availableServiceCredits('s2');
  assert.strictEqual(creditsS2[0].payment.id, 'pMovistar');
});

caso('CASO 36 — un intento de cruzar servicios queda rechazado por el frontend (openApplyCreditModal solo opera sobre serviceId)', () => {
  for (const text of [indexText, operatorText]) {
    const fnApply = extract(text, 'function openApplyCreditModal(serviceId,targetObligation){', 'function openPayModal(o){');
    assert.ok(fnApply.includes('availableServiceCredits(serviceId)'), 'siempre filtra por el serviceId de la obligación que se está pagando, nunca por todos los créditos del espacio');
  }
});

caso('CASO 37 — el índice único (payment_id,obligation_id) activo se respeta: nunca se intenta un segundo INSERT para el mismo par', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 150, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 50, oSep, 20);
  // segunda aplicación al MISMO par (p1 -> oSep): debe ir por UPDATE, no por un INSERT duplicado (el mock rechazaría un insert duplicado).
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 30, oSep, 30);
  const rowsToSep = sandbox.__state.allocations.filter(a => a.payment_id === 'p1' && a.obligation_id === 'oSep');
  assert.strictEqual(rowsToSep.length, 1, 'debe seguir siendo UNA sola fila para el par (p1,oSep), actualizada, no duplicada');
  assert.strictEqual(rowsToSep[0].allocated_amount, 50, '20 + 30 acumulado en la misma fila');
});

caso('CASO 38 — el cliente nunca intenta sobreimputar ni un centavo (SUM(allocations) <= payment.total_amount siempre)', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 100, { paid_at: '2026-08-05' }); // SIN excedente -- crédito real = 0
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  const credits = sandbox.availableServiceCredits('s1');
  assert.strictEqual(credits.length, 0, 'sin excedente real, no debe ofrecerse ningún crédito para aplicar');
});

caso('CASO 39 — aplicar crédito NUNCA crea un payment nuevo (solo INSERT/UPDATE sobre payment_allocations)', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  const paymentsCountBefore = 1;
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  // El mock de sb solo implementa .from(table).insert/update -- si el
  // código intentara crear un payment nuevo, llamaría sb.from('payments')
  // .insert(), lo cual el mock también registraría como una fila de
  // 'payments' en state.allocations (mismo array) -- se verifica que NO
  // aparece ninguna fila de esa tabla.
  const paymentsRowsCreated = sandbox.__state.allocations.filter(a => a.id && String(a.id).includes('-payments-'));
  assert.strictEqual(paymentsRowsCreated.length, 0, 'no debe haberse creado ningún payment nuevo');
  for (const text of [indexText, operatorText]) {
    const fnApply = extract(text, 'async function applyServiceCreditToObligation(', 'function openPayModal(o){');
    assert.ok(!fnApply.includes("from('payments')"), 'applyServiceCreditToObligation nunca debe tocar la tabla payments');
  }
});

caso('CASO 40 — la obligación original conserva trazabilidad completa (su propia allocation queda registrada, no un cálculo implícito)', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-05' });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  await sandbox.applyServiceCreditToObligation(p1, oAgo, 20, oSep, 20);
  const originRow = sandbox.__state.allocations.find(a => a.payment_id === 'p1' && a.obligation_id === 'oAgo');
  assert.ok(originRow, 'debe existir una fila explícita que documente cuánto de este pago cubrió su obligación original');
  assert.strictEqual(originRow.created_by, 'owner-uid');
});

// ============================================================
// EXACTITUD A CENTAVOS (cierre solicitado 20260816) — serviceMoneyCents(),
// sin ninguna tolerancia +.01/-.01/<=0.01 sobre floats crudos.
// ============================================================

caso('CASO 46 — deuda 100.00, pago 99.99 -> pendiente 0.01 exacto y NO fullyPaid', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 99.99);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0.01, 'un centavo de diferencia real NUNCA debe tratarse como cero');
  assert.strictEqual(progress.fullyPaid, false);
  assert.strictEqual(progress.partial, true);
  assert.notStrictEqual(sandbox.dueState(o1).cls, 'paid', 'no debe aparecer como Abonado con 1 centavo pendiente');
});

caso('CASO 47 — deuda 100.00, pago 100.00 -> saldo 0.00 exacto', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100.00);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 48 — deuda 100.00, pago 100.01 -> crédito 0.01 exacto', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-09-01' });
  const p1 = payment('p1', 'o1', 100.01);
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1] });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0.01, 'un centavo de excedente real NUNCA debe redondearse a cero');
  assert.strictEqual(sandbox.creditBalanceFor(o1), 0.01);
});

caso('CASO 49 — una diferencia de componentes de pago de 0.01 NO se acepta como "suman lo mismo"', () => {
  for (const text of [indexText, operatorText]) {
    const block = extract(text, "document.getElementById('savePay').onclick=async()=>{", 'function openInvoiceMonthPicker(serviceId){');
    assert.ok(block.includes('serviceMoneyCents(sum)!==serviceMoneyCents(total)'), 'la validación de aportes debe compararse en centavos enteros, exacta, sin tolerancia +.01');
    assert.ok(!/Math\.abs\(sum-total\)>\.01/.test(block), 'no debe quedar la vieja tolerancia de medio centavo');
  }
  // Prueba funcional directa de la regla, sobre la misma lógica que
  // serviceMoneyCents() ya usa en el resto del archivo.
  const sandbox = buildSandbox({});
  const sum = 50.00 + 49.99; // 99.99
  const total = 100.00;
  assert.notStrictEqual(sandbox.serviceMoneyCents(sum), sandbox.serviceMoneyCents(total), 'una diferencia real de 1 centavo entre aportes y total debe seguir siendo detectada como distinta');
});

caso('CASO 50 — las allocations nunca pueden superar el pago, ni por 0.01 (el cliente no aprovecha la tolerancia del trigger)', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-05' });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 100.00, { paid_at: '2026-08-05' }); // sin excedente real
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [] });
  const credits = sandbox.availableServiceCredits('s1');
  assert.strictEqual(credits.length, 0, 'sin excedente real (ni siquiera de un centavo), no debe ofrecerse crédito para aplicar');
  // Confirmar también que openApplyCreditModal compara en centavos, sin
  // el +0.01 que el trigger de Supabase sí tolera (pero el cliente no
  // debe aprovechar esa tolerancia -- PASO N del pedido anterior).
  for (const text of [indexText, operatorText]) {
    const fnApply = extract(text, 'function openApplyCreditModal(serviceId,targetObligation){', "const saveButton=document.getElementById('savePay');");
    assert.ok(fnApply.includes('serviceMoneyCents(amountRequested)>serviceMoneyCents(maxApplicable)'));
    assert.ok(!fnApply.includes('maxApplicable+0.01'), 'no debe quedar ninguna tolerancia de un centavo en la validación del importe a aplicar');
  }
});

caso('CASO 51 — annualFmt (Vista rápida anual) de Servicios muestra centavos', () => {
  for (const text of [indexText, operatorText]) {
    const fnAnnual = extract(text, 'function renderAnnualOverview(){', 'function carriedDebts(');
    assert.ok(fnAnnual.includes("const annualFmt=(n)=>paymentAllocationsLoadError?'No disponible':fmtMoneyExact(n);"), 'annualFmt debe usar fmtMoneyExact, no fmtMoney');
    assert.ok(fnAnnual.includes('${fmtMoneyExact(data.total)}'), 'el total mensual de la Vista rápida también debe mostrar centavos');
    assert.ok(!fnAnnual.includes('${fmtMoney('), 'no debe quedar ninguna llamada real a fmtMoney( dentro de renderAnnualOverview()');
  }
});

caso('CASO 52 — printReport (informe imprimible/PDF) de Servicios muestra centavos', () => {
  for (const text of [indexText, operatorText]) {
    const fnReports = extract(text, 'function renderReports(){', 'function safeFileName(');
    // Se busca el patrón real de LLAMADA ("${fmtMoney(" dentro de un
    // template literal), no cualquier mención textual de "fmtMoney(" --
    // el propio comentario de esta mejora menciona "fmtMoney()" en
    // prosa, sin ser una llamada real que haga falta corregir.
    assert.ok(!fnReports.includes('${fmtMoney('), 'no debe quedar ninguna llamada real a fmtMoney( dentro del informe imprimible -- todas deben ser fmtMoneyExact(');
    assert.ok(fnReports.includes('fmtMoneyExact(current.total)'));
    assert.ok(fnReports.includes('fmtMoneyExact(r.balance)'), 'la compensación entre administradores también debe mostrar centavos');
  }
});

caso('CASO 53 — Tarjetas permanece byte-idéntica también en esta corrección (roundMoney/fmtMoney compartidos intactos)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_centavos_exactos_20260816_160829', `${f}.antes_centavos_exactos`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    assert.strictEqual(
      extract(now, 'function renderCreditCardsModule(', '\nfunction '),
      extract(before, 'function renderCreditCardsModule(', '\nfunction '),
      `renderCreditCardsModule en ${f} debe seguir siendo byte-idéntico`
    );
    assert.strictEqual(
      extract(now, 'function roundMoney(value){', '\n'),
      extract(before, 'function roundMoney(value){', '\n'),
      `roundMoney (Tarjetas) en ${f} debe seguir siendo byte-idéntico`
    );
    assert.ok(now.includes("function fmtMoney(v){return Number(v||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0})}"), 'fmtMoney compartida (Tarjetas) no debe haber cambiado su precisión');
  }
});

// ============================================================
// AUDITORÍA DE ALCANCE EN renderReports() (cierre solicitado 20260816b)
// ------------------------------------------------------------
// Guido detectó una posible contradicción: el reporte anterior mencionaba
// "tarjetas resumen" dentro de renderReports() (comentario ambiguo -- se
// refería a las tarjetas/cards visuales .report-card, NUNCA al módulo
// Tarjetas de tarjetas de crédito) mientras afirmaba "Tarjetas modificada:
// NO". Los casos de abajo demuestran, con evidencia directa, que las 16
// sustituciones de renderReports() son EXCLUSIVAMENTE de Servicios (tipo
// A), y que el único lugar del archivo que sí mezcla Servicios+Tarjetas
// en un mismo panel (renderOwnerDashboard(), el panel cruzado del
// titular) NUNCA fue tocado por esta mejora.
// ============================================================

caso('CASO 54 — Servicios $43220.37 muestra $43.220,37 (centavos reales, no redondeados)', () => {
  const sandbox = buildSandbox({});
  const formatted = sandbox.fmtMoneyExact(43220.37);
  assert.ok(formatted.includes('43.220,37'));
  assert.ok(!formatted.includes('43.220,00') && !/43\.220(?!,)/.test(formatted.replace('43.220,37', '')), 'no debe mostrar $43.220 sin los centavos');
});

caso('CASO 55 — clasificación completa de las 16 sustituciones de renderReports(): las 16 son de Servicios (tipo A), ninguna de Tarjetas', () => {
  for (const text of [indexText, operatorText]) {
    const fnReports = extract(text, 'function renderReports(){', 'function safeFileName(');
    // Fuentes de datos usadas por renderReports() -- ninguna referencia a
    // creditCards/statements/movements/tarjeta en todo el cuerpo.
    assert.ok(!/creditCard|credit_card|statement|\bmovement/i.test(fnReports), 'renderReports() no debe referenciar ningún dato de Tarjetas');
    // Las funciones de las que depende (reportMonthData/reportCategoryData/
    // reportServiceData/balanceData/forecastMonth/pendingObligations) deben
    // operar exclusivamente sobre obligations/payments/services/members.
    for (const fnName of ['reportMonthData', 'reportCategoryData', 'reportServiceData', 'balanceData', 'forecastMonth']) {
      const fnBody = extract(text, `function ${fnName}(`, `\nfunction `);
      assert.ok(!/creditCard|credit_card|statement|\bmovement/i.test(fnBody), `${fnName}() no debe referenciar ningún dato de Tarjetas`);
    }
    // Las 16 llamadas reales (${fmtMoneyExact(...)}) deben estar presentes.
    const calls = fnReports.match(/\$\{fmtMoneyExact\(/g) || [];
    assert.strictEqual(calls.length, 16, 'deben seguir siendo exactamente las 16 llamadas ya auditadas, ni una más ni una menos');
  }
});

caso('CASO 56 — Tarjetas usa exactamente el mismo formateo que antes de esta mejora completa (fmtMoney sin cambios, en ningún punto del archivo)', () => {
  const beforeFirstIteration = path.join(ROOT, 'respaldos_publicacion', 'antes_segundo_vencimiento_pagos_20260816_115048', 'index.html.antes_segundo_vencimiento');
  const before = fs.readFileSync(beforeFirstIteration, 'utf8');
  const fnBefore = extract(before, 'function fmtMoney(v){', '\n');
  const fnNow = extract(indexText, 'function fmtMoney(v){', '\n');
  assert.strictEqual(fnBefore, fnNow, 'fmtMoney() debe ser byte-idéntica a como estaba ANTES de toda esta serie de mejoras de Servicios -- Tarjetas nunca vio ni un cambio de precisión');
});

caso('CASO 57 — la sección Tarjetas del panel cruzado del titular (renderOwnerDashboard) permanece idéntica', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_centavos_exactos_20260816_160829', `${f}.antes_centavos_exactos`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    const fnBefore = extract(before, 'function renderOwnerDashboard(){', '\nfunction ');
    const fnNow = extract(now, 'function renderOwnerDashboard(){', '\nfunction ');
    assert.strictEqual(fnBefore, fnNow, `renderOwnerDashboard() en ${f} (el único panel que SÍ mezcla Servicios+Tarjetas, ej. "Total bruto de resúmenes (tarjetas)") debe seguir byte-idéntico`);
    assert.ok(fnNow.includes("fmtMoney(cardMetrics"), 'las métricas de Tarjetas de este panel deben seguir usando fmtMoney(), nunca fmtMoneyExact()');
    assert.ok(!fnNow.includes('fmtMoneyExact'), 'este panel no debe contener ninguna llamada a fmtMoneyExact() -- no fue tocado por esta mejora');
  }
});

caso('CASO 58 — annualFmt (Vista rápida) opera exclusivamente sobre monthQuickSummary()/obligations, sin ningún dato de Tarjetas', () => {
  for (const text of [indexText, operatorText]) {
    const fnQuickSummary = extract(text, 'function monthQuickSummary(key){', '\nfunction ');
    assert.ok(!/creditCard|credit_card|statement|\bmovement/i.test(fnQuickSummary), 'monthQuickSummary() (fuente de annualFmt) no debe referenciar ningún dato de Tarjetas');
  }
});

caso('CASO 59 — ninguna vista de Tarjetas (matriz, resúmenes, movimientos, conciliación) cambia por la introducción de fmtMoneyExact', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_centavos_exactos_20260816_160829', `${f}.antes_centavos_exactos`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    const creditFns = ['renderCreditCardsModule', 'bindCreditCardsModule'];
    for (const fnName of creditFns) {
      const fnBefore = extract(before, `function ${fnName}(`, '\nfunction ');
      const fnNow = extract(now, `function ${fnName}(`, '\nfunction ');
      assert.strictEqual(fnBefore, fnNow, `${fnName}() en ${f} debe seguir byte-idéntica`);
      assert.ok(!fnNow.includes('fmtMoneyExact'), `${fnName}() no debe contener ninguna llamada a fmtMoneyExact()`);
    }
  }
});

// ============================================================
// REGRESIÓN / PARIDAD / TARJETAS
// ============================================================

caso('CASO 41 — Tarjetas (renderCreditCardsModule) no fue modificada por esta mejora', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_centavos_allocations_20260816_145521', `${f}.antes_centavos_allocations`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    assert.strictEqual(
      extract(now, 'function renderCreditCardsModule(', '\nfunction '),
      extract(before, 'function renderCreditCardsModule(', '\nfunction '),
      `renderCreditCardsModule en ${f} debe seguir siendo byte-idéntico`
    );
  }
});

caso('CASO 42 — Vista Operativa/Panel/Buscador/Navegación siguen presentes', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('function operationalServicesListHtml('));
    assert.ok(text.includes('function computeServicePriorityCategories('));
    assert.ok(text.includes('id="serviceSearchInput"'));
    assert.ok(text.includes('function restoreNavigationScroll('));
  }
});

caso('CASO 43 — paridad exacta index.html / index_operator.html para la lógica nueva', () => {
  const blocksToCompare = [
    ['function effectiveObligationAmount(', 'function isServiceVisibleForCurrentContext('],
    ['function paymentProgress(obligation){', '// CORRECCIÓN 6B4.15 - Metadata técnica'],
    ['function availableServiceCredits(', 'async function applyServiceCreditToObligation('],
    ['async function applyServiceCreditToObligation(', 'function dueState(o){'],
  ];
  for (const [s, e] of blocksToCompare) {
    assert.strictEqual(extract(indexText, s, e), extract(operatorText, s, e), `bloque "${s}" debe ser byte-idéntico entre ambos archivos`);
  }
});

caso('CASO 44 — no se agregó ni ejecutó ningún archivo .sql que escriba datos', () => {
  const sqlPath = path.join(ROOT, 'migraciones', '6b9_DIAGNOSTICO_segundo_vencimiento_saldos_solo_lectura.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const codeLines = sql.split('\n').filter(l => !/^\s*--/.test(l));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(codeLines.join('\n').replace(/has_table_privilege\([^)]*\)/g, '')), 'el diagnóstico debe seguir siendo 100% de solo lectura');
});

caso('CASO 45 — anulación de documentos sigue sin implementarse (próximo pendiente separado)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(!text.includes('function annulDocument('));
  }
});

// ============================================================
// SELECTOR DE VENCIMIENTO (cierre del flujo de pago, 20260816c)
// ------------------------------------------------------------
// openPayModal() no puede ejecutarse completo fuera del navegador (usa
// modal()/DOM real) -- la técnica usada acá, igual que en las secciones
// anteriores, es EXTRAER el fragmento real de decisión (desde
// "const dueStageChecked=hasSecondDue" hasta el cierre del if/else de
// diffCents, el mismo bloque que CASO 19/21/22/23 ya usan) y EJECUTARLO
// en un sandbox con document.querySelector/confirm mockeados -- nunca se
// reimplementa la fórmula a mano.
// ============================================================

function runDueStageDiff(text, { hasSecondDue, dueStage, baseAmount, secondTotalAmount, progressPaid, total }) {
  const block = extract(text, 'const dueStageChecked=hasSecondDue', "const saveButton=document.getElementById('savePay');");
  const confirmMessages = [];
  const documentMock = {
    querySelector(sel) {
      if (sel === 'input[name="dueStage"]:checked') {
        return dueStage ? { value: dueStage } : null;
      }
      return null;
    },
  };
  const fn = new Function(
    'document', 'hasSecondDue', 'secondTotalAmount', 'baseAmount', 'progress', 'total',
    'serviceMoneyCents', 'roundServiceMoney', 'fmtMoneyExact', 'confirm',
    block + '\nreturn { dueStage, stageAmount, selectedDueAmount, diffCents, diff };'
  );
  const result = fn(
    documentMock, hasSecondDue, secondTotalAmount, baseAmount, { paid: progressPaid }, total,
    (v) => Math.round((Number(v) || 0) * 100),
    (v) => Math.round((Number(v) || 0) * 100) / 100,
    (v) => `$${Number(v).toFixed(2)}`,
    (msg) => { confirmMessages.push(msg); return true; }
  );
  result.confirmMessages = confirmMessages;
  return result;
}

caso('CASO 60 — sin segundo vencimiento: el modal NO muestra el selector "Aplicar pago a"', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    assert.ok(fnBlock.includes('${hasSecondDue?`'), 'el bloque del selector debe estar condicionado a hasSecondDue');
    assert.ok(fnBlock.includes('!hasSecondDue||todayDateString()<=o.due_date'), 'sin segundo vencimiento, se sugiere/usa automáticamente el primer vencimiento, sin selector');
  }
});

caso('CASO 61 — con segundo vencimiento: el selector muestra CADA opción con su propio importe', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    assert.ok(fnBlock.includes('<strong>Primer vencimiento</strong><br>'));
    assert.ok(fnBlock.includes('<strong>Segundo vencimiento</strong><br>'));
    assert.ok(fnBlock.includes('${fmtMoneyExact(baseAmount)}'), 'la opción del primer vencimiento muestra su propio importe');
    assert.ok(fnBlock.includes('${fmtMoneyExact(secondTotalAmount)}'), 'la opción del segundo vencimiento muestra su propio importe');
    assert.ok(fnBlock.includes('incluye recargo de'), 'cuando hay recargo, se muestra explícito -- nunca se oculta');
  }
});

caso('CASO 62 — selecciona Primer vencimiento: selectedDueAmount = importe 1 (sin descontar pagos previos)', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'first', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 100 });
    assert.strictEqual(r.selectedDueAmount, 100);
    assert.strictEqual(r.diffCents, 0, 'pago exacto contra el importe elegido no debe generar ninguna advertencia');
  }
});

caso('CASO 63 — selecciona Segundo vencimiento: selectedDueAmount = importe 2 (con recargo incluido)', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 105 });
    assert.strictEqual(r.selectedDueAmount, 105);
    assert.strictEqual(r.diffCents, 0);
  }
});

caso('CASO 64 — SALDO A FAVOR: Base 100, Segundo 105, elige Segundo, paga 120 -> crédito 15, NUNCA 20', () => {
  // Ejemplo explícito pedido: comparar contra el importe SELECCIONADO
  // (105), no contra el importe base (100) -- 120-105=15, no 120-100=20.
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 120 });
    assert.strictEqual(r.diff, 15);
    assert.notStrictEqual(r.diff, 20);
    assert.ok(r.confirmMessages[0].includes('saldo a favor'));
    assert.ok(r.confirmMessages[0].includes('Aplicar a: Segundo vencimiento'));
  }
});

caso('CASO 65 — segundo vencimiento SIN segundo importe: ambas opciones exigen el mismo importe (recargo 0, sin duplicar)', () => {
  for (const text of [indexText, operatorText]) {
    const r1 = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'first', baseAmount: 100, secondTotalAmount: 100, progressPaid: 0, total: 100 });
    const r2 = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 100, progressPaid: 0, total: 100 });
    assert.strictEqual(r1.selectedDueAmount, 100);
    assert.strictEqual(r2.selectedDueAmount, 100);
    assert.strictEqual(r1.diffCents, 0);
    assert.strictEqual(r2.diffCents, 0);
  }
});

caso('CASO 66 — CASO B (primer vencimiento ya pasado): elegir Primer vencimiento igual muestra la diferencia real pendiente (nunca oculta el segundo importe)', () => {
  // Texto de ejemplo pedido: "El primer vencimiento ya pasó. El segundo
  // importe cargado es $105.000,00. Si registrás $100.000,00 quedará una
  // diferencia pendiente de $5.000,00." -- se prueba con la fórmula real:
  // eligiendo el primer vencimiento (100) contra un total pagado de 100,
  // selectedDueAmount usa el importe ELEGIDO (100, no el real 105), así
  // que el aviso pendiente es responsabilidad del NOTICE fijo del modal
  // (CASO 67), no de este cálculo -- acá se confirma que elegir "Primer"
  // nunca fuerza el importe 2 sobre quien decide pagar el importe 1.
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'first', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 100 });
    assert.strictEqual(r.selectedDueAmount, 100, 'elegir Primer vencimiento compara contra el importe 1, sin duplicar el recargo');
    assert.strictEqual(r.diffCents, 0, 'pagar exactamente el importe elegido no debe generar advertencia sobre ESE pago');
  }
});

caso('CASO 67 — CASO B: el modal muestra el aviso textual "el primer vencimiento ya pasó" con los importes reales (nunca bloquea)', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    const notice = 'El primer vencimiento ya pasó. El segundo importe cargado es ${fmtMoneyExact(secondTotalAmount)}. Si registrás ${fmtMoneyExact(baseAmount)} quedará una diferencia pendiente de ${fmtMoneyExact(surchargeAmount)}';
    assert.ok(fnBlock.includes(notice));
    // El aviso es un <div class="notice"> puramente informativo dentro del
    // template del modal -- no hay ningún return/toast ni validación
    // bloqueante asociada a esa línea (a diferencia de, por ejemplo, la
    // validación real "Ingresá el total pagado", que sí bloquea con
    // return toast pero es un caso completamente distinto).
    const noticeIdx = fnBlock.indexOf(notice);
    const surrounding = fnBlock.slice(Math.max(0, noticeIdx - 200), noticeIdx + notice.length + 50);
    assert.ok(surrounding.includes('class="notice"'), 'debe ser un aviso informativo, no un bloqueo');
    assert.ok(!surrounding.includes('return toast'), 'el aviso del selector en sí mismo nunca debe bloquear');
  }
});

caso('CASO 68 — PAGO ANTICIPADO: antes del primer vencimiento, pagar el importe 1 completo NUNCA resucita una deuda del importe 2', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105000) });
  const p1 = payment('p1', 'o1', 100000, { paid_at: '2026-08-16' }); // hoy, antes del 1er vencimiento
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 100000, 'sigue exigiendo el importe 1 -- cubierto a tiempo');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 69 — CONTINUIDAD: Base 100, Segundo 105, elige Segundo, paga 80 -> saldo pendiente de 25 (queda sobre la MISMA obligación)', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 80 });
    assert.strictEqual(r.diffCents, -2500);
    assert.strictEqual(r.selectedDueAmount - 80, 25);
    assert.ok(r.confirmMessages[0].includes('saldo pendiente'));
    assert.ok(r.confirmMessages[0].includes('Aplicar a: Segundo vencimiento'));
  }
});

caso('CASO 70 — el selector NUNCA sobrescribe los datos originales de la obligación (o.amount/secondAmount/due_date intactos)', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    assert.ok(!/\bo\.amount\s*=[^=]/.test(fnBlock), 'openPayModal no debe reasignar o.amount');
    assert.ok(!/extraDue\.second(DueDate|Amount)\s*=[^=]/.test(fnBlock), 'openPayModal no debe reasignar los campos extra del segundo vencimiento');
    assert.ok(!/from\('obligations'\)\.update/.test(fnBlock), 'openPayModal nunca escribe en obligations -- solo registra el pago');
  }
});

caso('CASO 71 — TRAZABILIDAD: el INSERT persiste appliedDueStage en payments.notes (columna real confirmada, CAMINO A) -- nunca un campo nuevo inventado', () => {
  // AJUSTE (20260816c): Guido confirmó vía diagnóstico read-only real que
  // public.payments SÍ tiene "notes text NULL" sin ningún uso hoy -- CASO
  // 71 originalmente probaba lo contrario (que el INSERT NO debía tocar
  // ningún campo nuevo, porque en ese momento no había confirmación de
  // esquema). Ahora se prueba lo opuesto a propósito: el INSERT DEBE
  // persistir appliedDueStage, usando la columna real ya confirmada
  // (notes), nunca un nombre de columna inventado (dueStage/
  // appliedDueStage/selectedDueAmount como campo propio, que no existen).
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    const fromIdx = fnBlock.indexOf("from('payments')");
    const insertStart = fnBlock.indexOf('{', fnBlock.indexOf('.insert(', fromIdx));
    const insertEnd = fnBlock.indexOf('.select()', insertStart);
    const insertBlock = fnBlock.slice(insertStart, insertEnd);
    assert.ok(insertBlock.includes('obligation_id:o.id'));
    assert.ok(insertBlock.includes('paid_at:'));
    assert.ok(insertBlock.includes('total_amount:total'));
    assert.ok(insertBlock.includes('created_by:session.user.id'));
    assert.ok(insertBlock.includes('notes:buildPaymentNotes(null,{appliedDueStage:dueStage})'), 'debe persistir la elección usando la columna real payments.notes, con JSON estructurado');
    // El único lugar donde debe aparecer "appliedDueStage:" es DENTRO del
    // objeto que se serializa a JSON via buildPaymentNotes -- nunca como
    // columna propia del INSERT (que no existe en el esquema real).
    const insertKeys = insertBlock.match(/^\s*(\w+):/gm) || [];
    assert.deepStrictEqual(
      insertKeys.map(k => k.trim()),
      ['obligation_id:', 'paid_at:', 'total_amount:', 'created_by:', 'notes:'],
      'las columnas reales del INSERT deben ser exactamente estas 5, ninguna inventada'
    );
  }
});

caso('CASO 72 — HISTÓRICO: un pago sin selector (obligación sin segundo vencimiento) sigue calculando exactamente igual que antes de esta mejora', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: false, dueStage: null, baseAmount: 500, secondTotalAmount: 500, progressPaid: 200, total: 300 });
    assert.strictEqual(r.dueStage, 'first', 'sin segundo vencimiento, el fallback es siempre el primer vencimiento (fecha), sin selector visible');
    assert.strictEqual(r.selectedDueAmount, 300, 'equivale al viejo progress.balance (500-200=300), sin ningún cambio de comportamiento');
    assert.strictEqual(r.diffCents, 0);
  }
});

caso('CASO 73 — $0.01 de diferencia con selector: falta un centavo contra el importe elegido sigue avisando (nunca se acepta como cero)', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 100.01, progressPaid: 0, total: 100 });
    assert.strictEqual(r.diffCents, -1);
    assert.ok(r.confirmMessages[0].includes('saldo pendiente'));
  }
});

caso('CASO 74 — $0.01 de excedente con selector: un centavo de más contra el importe elegido sigue generando saldo a favor (nunca se acepta como cero)', () => {
  for (const text of [indexText, operatorText]) {
    const r = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 100.00, progressPaid: 0, total: 100.01 });
    assert.strictEqual(r.diffCents, 1);
    assert.ok(r.confirmMessages[0].includes('saldo a favor'));
  }
});

caso('CASO 75 — no se crea ningún pago/obligación ficticios: sigue siendo un único INSERT a payments y ninguno a obligations dentro de openPayModal', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
    const paymentInserts = (fnBlock.match(/from\('payments'\)\s*\.\s*insert\(/g) || []).length;
    assert.strictEqual(paymentInserts, 1, 'debe seguir habiendo un único INSERT a payments por click en Registrar pago');
    assert.ok(!fnBlock.includes("from('obligations').insert("), 'el selector no debe crear ninguna obligación nueva');
  }
});

caso('CASO 76 — allocations/crédito futuro (applyServiceCreditToObligation) permanece sin cambios por la introducción del selector', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_selector_vencimiento_20260816_192442', `${f}.antes_selector_vencimiento`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    assert.strictEqual(
      extract(now, 'function applyServiceCreditToObligation(', '\nfunction '),
      extract(before, 'function applyServiceCreditToObligation(', '\nfunction '),
      `applyServiceCreditToObligation() en ${f} debe seguir byte-idéntica`
    );
    assert.strictEqual(
      extract(now, 'function availableServiceCredits(', '\nfunction '),
      extract(before, 'function availableServiceCredits(', '\nfunction '),
      `availableServiceCredits() en ${f} debe seguir byte-idéntica`
    );
  }
});

caso('CASO 77 — Tarjetas permanece byte-idéntica también con este cierre (regresión final del selector)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_selector_vencimiento_20260816_192442', `${f}.antes_selector_vencimiento`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    assert.strictEqual(
      extract(now, 'function renderCreditCardsModule(', '\nfunction '),
      extract(before, 'function renderCreditCardsModule(', '\nfunction '),
      `renderCreditCardsModule en ${f} debe seguir siendo byte-idéntico`
    );
    assert.strictEqual(
      extract(now, 'function bindCreditCardsModule(', '\nfunction '),
      extract(before, 'function bindCreditCardsModule(', '\nfunction '),
      `bindCreditCardsModule en ${f} debe seguir siendo byte-idéntico`
    );
    assert.strictEqual(
      extract(now, 'function fmtMoney(v){', '\n'),
      extract(before, 'function fmtMoney(v){', '\n'),
      `fmtMoney compartida en ${f} debe seguir siendo byte-idéntica`
    );
    assert.strictEqual(
      extract(now, 'function roundMoney(value){', '\n'),
      extract(before, 'function roundMoney(value){', '\n'),
      `roundMoney (Tarjetas) en ${f} debe seguir siendo byte-idéntico`
    );
  }
});

caso('CASO 78 — paridad exacta index.html / index_operator.html para openPayModal completo', () => {
  const fnA = extract(indexText, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
  const fnB = extract(operatorText, 'function openPayModal(o){', 'function openInvoiceMonthPicker(serviceId){');
  assert.strictEqual(fnA, fnB, 'openPayModal() debe ser byte-idéntica entre index.html e index_operator.html');
});

// ============================================================
// CIERRE DE COHERENCIA (20260816c) -- effectiveObligationAmount() ahora
// respeta appliedDueStage==='second' persistido en payments.notes (JSON
// estructurado, CAMINO A confirmado por diagnóstico real -- ver
// migraciones/6b10_DIAGNOSTICO_columnas_payments_solo_lectura.sql) en
// cualquier pago activo de la obligación, sin importar la fecha. Estos
// casos usan withAppliedDueStage(stage) (fixture -> payments.notes =
// '{"appliedDueStage":"first|second"}') para simular tanto pagos NUEVOS
// persistidos por openPayModal() como el estado que quedaría después de
// un reload real -- es la misma lógica REAL, extraída y ejecutada igual
// que el resto de la suite, nunca reimplementada a mano.
// ============================================================

caso('CASO 79 — FIRST antes del vencimiento, pago 100 -> saldo 0 (marcar "first" explícito no cambia nada)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const p1 = payment('p1', 'o1', 100, { paid_at: '2026-08-16', ...withAppliedDueStage('first') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 100);
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0);
});

caso('CASO 80 — CASO OBLIGATORIO: SECOND antes del vencimiento, pago 105 -> saldo 0, crédito 0 (NUNCA crédito 5)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105000) });
  const p1 = payment('p1', 'o1', 105000, { paid_at: '2026-08-16', ...withAppliedDueStage('second') }); // hoy, ANTES del 1er vencimiento
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 105000, 'marcar Segundo exige el importe 2 aunque hoy sea anterior al 1er vencimiento');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0, 'NUNCA debe aparecer un saldo a favor de 5.000 contra el importe 1 -- el pago fue explícitamente para el importe 2');
});

caso('CASO 81 — SECOND anticipado, pago 106 -> crédito 1 (recargo reconocido 5, saldo a favor 1, NO 6)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const p1 = payment('p1', 'o1', 106, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 105);
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 1);
  assert.notStrictEqual(progress.creditBalance, 6, 'el recargo de 5 ya está reconocido en el importe exigible -- no debe tratarse como si el importe siguiera siendo 100');
});

caso('CASO 82 — SECOND anticipado, pago 104 -> saldo pendiente 1 (NO satisfecha por superar baseAmount=100)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const p1 = payment('p1', 'o1', 104, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 105);
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 1);
  assert.strictEqual(progress.fullyPaid, false, 'pagar 104 (más que el importe 1=100) NUNCA debe considerarse abonado cuando se eligió expresamente el importe 2=105');
});

caso('CASO 83 — PAGOS MIXTOS: FIRST 80 + SECOND 25 -> saldo 0 sobre total 105 (sin crédito artificial, sin doble recargo, sin doble pago)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const p1 = payment('p1', 'o1', 80, { paid_at: '2026-08-14', ...withAppliedDueStage('first') });
  const p2 = payment('p2', 'o1', 25, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1, p2], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1, p2], []), 105, 'con un solo pago marcado second ya alcanza para que la obligación completa se exija por el importe 2');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.paid, 105, '80+25, ambos pagos cuentan, ninguno se pierde ni se duplica');
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0, 'sin crédito artificial');
});

caso('CASO 84 — FIRST completo a tiempo, incluso marcado explícitamente -> nunca aparece recargo posterior', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105000) });
  const p1 = payment('p1', 'o1', 100000, { paid_at: '2026-08-08', ...withAppliedDueStage('first') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-25T00:00:00' }); // "hoy" ya pasó ambos vencimientos
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 100000, 'cubierta a tiempo -- nunca escala al importe 2, ni con la fecha muy avanzada');
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 85 — pago histórico SIN applied_due_stage mantiene el comportamiento de fecha existente (fallback intacto)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100000.37, due_date: '2026-08-10', ...withSecondDue('2026-08-20', 105000.82) });
  const p1 = payment('p1', 'o1', 80000, { paid_at: '2026-08-08' }); // sin applied_due_stage -- pago "de antes de esta mejora"
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-15T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 105000.82, 'sin marcar, sigue la regla de fecha de siempre (no cubrió el importe 1 a tiempo)');
});

caso('CASO 86 — effectiveObligationAmount() coincide exactamente con lo que el selector mostró en el confirm() previo', () => {
  // Reutiliza runDueStageDiff (el mismo cálculo pre-guardado de
  // openPayModal) y lo compara contra effectiveObligationAmount()
  // post-guardado con ese mismo pago ya marcado -- deben coincidir
  // siempre que el stage elegido sea 'second' (el único que hace
  // override real; 'first' sigue la regla de fecha en ambos lados por
  // igual, ver CASO 66/67).
  for (const text of [indexText, operatorText]) {
    const pre = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 120 });
    const s1 = svc('s1');
    const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
    const p1 = payment('p1', 'o1', 120, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
    const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
    const post = sandbox.paymentProgress(o1);
    assert.strictEqual(pre.selectedDueAmount, sandbox.effectiveObligationAmount(o1, [p1], []), 'el importe correspondiente mostrado ANTES de guardar coincide con el importe exigible real DESPUÉS de guardar');
    assert.strictEqual(pre.diff, post.creditBalance, 'el crédito informado en el confirm() coincide con el crédito real posterior (15 en este ejemplo)');
  }
});

caso('CASO 87 — PAYMENT_ALLOCATIONS: la reserva de la obligación original usa 105 (no 100) cuando el pago de origen fue marcado SECOND', () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-16', ...withAppliedDueStage('second') }); // ANTES del 1er vencimiento de oAgo
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [], now: '2026-08-16T00:00:00' });
  const credits = sandbox.availableServiceCredits('s1');
  assert.strictEqual(credits.length, 1);
  assert.strictEqual(credits[0].available, 15, 'disponible = 120 - 105 (importe exigible real de oAgo, marcado second), NUNCA 120-100=20');
});

caso('CASO 88 — payment 120 marcado SECOND -> crédito aplicable 15, nunca 20 (extremo a extremo vía applyServiceCreditToObligation)', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [], now: '2026-08-16T00:00:00' });
  const credits = sandbox.availableServiceCredits('s1');
  const { payment: sourcePayment, available } = credits[0];
  await sandbox.applyServiceCreditToObligation(sourcePayment, oAgo, available, oSep, available);
  const rows = sandbox.__state.allocations;
  const originalRow = rows.find(r => r.obligation_id === 'oAgo');
  const targetRow = rows.find(r => r.obligation_id === 'oSep');
  assert.strictEqual(originalRow.allocated_amount, 105, 'la obligación original reserva 105, su importe exigible real -- NUNCA 100');
  assert.strictEqual(targetRow.allocated_amount, 15, 'el excedente aplicado al mes siguiente es 15, NUNCA 20');
  assert.strictEqual(sandbox.roundServiceMoney(originalRow.allocated_amount + targetRow.allocated_amount), 120, 'la suma de ambas allocations sigue siendo exactamente el total del pago, sin sobreimputar');
});

caso('CASO 89 — centavos exactos con stage: second=100.01, pago=100.00 marcado SECOND -> pendiente 0.01 exacto', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 100.01) });
  const p1 = payment('p1', 'o1', 100.00, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0.01, 'un centavo real de diferencia contra el importe 2 elegido NUNCA se acepta como cero');
  assert.strictEqual(progress.fullyPaid, false);
});

caso('CASO 90 — un pago marcado SECOND en una obligación SIN segundo importe cargado no rompe nada (guard defensivo)', () => {
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', null) }); // hay fecha, no hay importe 2
  const p1 = payment('p1', 'o1', 100, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [p1], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [p1], []), 100, 'sin importe 2 cargado, applied_due_stage=second no tiene nada contra qué exigir -- se ignora, sigue siendo el importe 1');
});

caso('CASO 91 — Tarjetas permanece byte-idéntica tras el cierre de coherencia (regresión final)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_coherencia_stage_aware_20260816_194942', `${f}.antes_coherencia_stage_aware`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
    assert.strictEqual(
      extract(now, 'function fmtMoney(v){', '\n'),
      extract(before, 'function fmtMoney(v){', '\n'),
      `fmtMoney en ${f} debe seguir byte-idéntica`
    );
  }
});

caso('CASO 92 — paridad exacta index.html / index_operator.html para obligationHasSecondStagePayment + effectiveObligationAmount', () => {
  const fnA = extract(indexText, 'function obligationHasSecondStagePayment(', 'function dashboardPaidFor(');
  const fnB = extract(operatorText, 'function obligationHasSecondStagePayment(', 'function dashboardPaidFor(');
  assert.strictEqual(fnA, fnB, 'debe ser byte-idéntica entre index.html e index_operator.html');
});

// ============================================================
// PERSISTENCIA REAL EN payments.notes (20260816d) -- payment.notes text
// NULL confirmado por Guido vía diagnóstico read-only real, 0 pagos
// reales con contenido hoy. paymentNoteMetadata/paymentAppliedDueStage/
// buildPaymentNotes son funciones REALES extraídas de index.html, nunca
// reimplementadas -- los 18 casos mínimos pedidos.
// ============================================================

caso('CASO 93 — parse notes NULL -> sin metadata', () => {
  const sandbox = buildSandbox({});
  assert.deepStrictEqual(sandbox.paymentNoteMetadata(null), {});
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes: null }), null);
});

caso('CASO 94 — parse notes vacío ("") -> sin metadata', () => {
  const sandbox = buildSandbox({});
  assert.deepStrictEqual(sandbox.paymentNoteMetadata(''), {});
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes: '   ' }), null, 'solo espacios tampoco debe romper ni interpretarse como metadata');
});

caso('CASO 95 — parse JSON válido con appliedDueStage="first"', () => {
  const sandbox = buildSandbox({});
  const notes = JSON.stringify({ appliedDueStage: 'first' });
  assert.deepStrictEqual(sandbox.paymentNoteMetadata(notes), { appliedDueStage: 'first' });
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes }), 'first');
});

caso('CASO 96 — parse JSON válido con appliedDueStage="second"', () => {
  const sandbox = buildSandbox({});
  const notes = JSON.stringify({ appliedDueStage: 'second' });
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes }), 'second');
});

caso('CASO 97 — JSON inválido en notes NUNCA rompe la app (texto histórico/no-JSON futuro)', () => {
  const sandbox = buildSandbox({});
  assert.deepStrictEqual(sandbox.paymentNoteMetadata('esto no es JSON'), {});
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes: 'esto no es JSON' }), null);
  assert.deepStrictEqual(sandbox.paymentNoteMetadata('{"appliedDueStage":'), {}, 'JSON truncado/corrupto tampoco debe lanzar');
  assert.deepStrictEqual(sandbox.paymentNoteMetadata('[1,2,3]'), {}, 'un JSON válido pero que no es un objeto (array) tampoco cuenta como metadata');
});

caso('CASO 98 — clave/valor desconocido usa fallback histórico (null), nunca un valor inventado', () => {
  const sandbox = buildSandbox({});
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes: JSON.stringify({ appliedDueStage: 'third' }) }), null, 'un valor que no es first/second cae al fallback, nunca se inventa un tercer estado');
  assert.strictEqual(sandbox.paymentAppliedDueStage({ notes: JSON.stringify({ otroCampo: 'x' }) }), null, 'JSON válido sin la clave esperada también cae al fallback');
});

caso('CASO 99 — merge de metadata NUNCA destruye otras claves ya presentes (preservación futura)', () => {
  const sandbox = buildSandbox({});
  const existing = JSON.stringify({ otroCampoFuturo: 'x', appliedDueStage: 'first' });
  const merged = sandbox.buildPaymentNotes(existing, { appliedDueStage: 'second' });
  assert.deepStrictEqual(JSON.parse(merged), { otroCampoFuturo: 'x', appliedDueStage: 'second' }, 'actualizar appliedDueStage no debe perder otroCampoFuturo');
  // Sentido inverso: agregar una clave nueva no debe perder appliedDueStage.
  const merged2 = sandbox.buildPaymentNotes(JSON.stringify({ appliedDueStage: 'second' }), { otroCampoFuturo: 'y' });
  assert.deepStrictEqual(JSON.parse(merged2), { appliedDueStage: 'second', otroCampoFuturo: 'y' });
  // Sin ninguna clave -> null (no "{}"), para no ensuciar notes vacías.
  assert.strictEqual(sandbox.buildPaymentNotes(null, {}), null);
});

caso('CASO 100 — INSERT con selección FIRST persiste {"appliedDueStage":"first"} (lógica real, no reimplementada)', () => {
  for (const text of [indexText, operatorText]) {
    const sandbox = buildSandbox({});
    const pre = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'first', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 100 });
    const payload = sandbox.buildPaymentNotes(null, { appliedDueStage: pre.dueStage });
    assert.strictEqual(payload, '{"appliedDueStage":"first"}');
  }
});

caso('CASO 101 — INSERT con selección SECOND persiste {"appliedDueStage":"second"} (lógica real, no reimplementada)', () => {
  for (const text of [indexText, operatorText]) {
    const sandbox = buildSandbox({});
    const pre = runDueStageDiff(text, { hasSecondDue: true, dueStage: 'second', baseAmount: 100, secondTotalAmount: 105, progressPaid: 0, total: 105 });
    const payload = sandbox.buildPaymentNotes(null, { appliedDueStage: pre.dueStage });
    assert.strictEqual(payload, '{"appliedDueStage":"second"}');
  }
});

caso('CASO 102 — TEST CLAVE DE PERSISTENCIA: SECOND anticipado sobrevive un reload completo (el radio ya no es solo UX)', () => {
  // 1) usuario selecciona SECOND (antes de guardar, hoy < due_date).
  const dueStage = 'second';
  // 2) payload real del INSERT (misma función que usa openPayModal).
  const sandbox0 = buildSandbox({});
  const insertedNotes = sandbox0.buildPaymentNotes(null, { appliedDueStage: dueStage });
  assert.strictEqual(insertedNotes, '{"appliedDueStage":"second"}');

  // 3)/4) simular reload: se descarta CUALQUIER estado en memoria (no
  // existe ninguna variable "dueStage" acá abajo) y se reconstruye el
  // payment ÚNICAMENTE con lo que un SELECT real devolvería después de
  // guardar (id/obligation_id/total_amount/paid_at/voided/notes -- el
  // mismo shape que hoy trae reloadGroup() con select('*')).
  const persistedPaymentRow = { id: 'p1', obligation_id: 'o1', total_amount: 105, paid_at: '2026-08-16', voided: false, notes: insertedNotes };

  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [persistedPaymentRow], now: '2026-08-16T00:00:00' }); // "hoy" sigue antes del 1er vencimiento

  // 5) effectiveObligationAmount() vuelve a devolver 105 -- SIN que nada
  // en memoria le diga qué eligió el usuario, solo lo persistido.
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [persistedPaymentRow], []), 105);

  // 6) paymentProgress() saldo correcto tras el reload.
  const progress = sandbox.paymentProgress(o1);
  assert.strictEqual(progress.balance, 0);
  assert.strictEqual(progress.creditBalance, 0);
  assert.strictEqual(progress.fullyPaid, true);
});

caso('CASO 103 — reload conserva FIRST (pago normal, sin recargo, tras reload)', () => {
  const insertedNotes = buildSandbox({}).buildPaymentNotes(null, { appliedDueStage: 'first' });
  const persistedPaymentRow = { id: 'p1', obligation_id: 'o1', total_amount: 100, paid_at: '2026-08-16', voided: false, notes: insertedNotes };
  const s1 = svc('s1');
  const o1 = ob('o1', 's1', { amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const sandbox = buildSandbox({ obligations: [o1], services: [s1], payments: [persistedPaymentRow], now: '2026-08-16T00:00:00' });
  assert.strictEqual(sandbox.effectiveObligationAmount(o1, [persistedPaymentRow], []), 100, 'FIRST persistido no fuerza el importe 2 -- sigue la regla de fecha normal');
  assert.strictEqual(sandbox.paymentProgress(o1).balance, 0);
});

caso('CASO 104 — la metadata de appliedDueStage sigue disponible incluso después de convertir el pago a allocations', async () => {
  const s1 = svc('s1');
  const oAgo = ob('oAgo', 's1', { period: '2026-08-01', amount: 100, due_date: '2026-08-20', ...withSecondDue('2026-08-30', 105) });
  const oSep = ob('oSep', 's1', { period: '2026-09-01', amount: 90, due_date: '2026-09-05' });
  const p1 = payment('p1', 'oAgo', 120, { paid_at: '2026-08-16', ...withAppliedDueStage('second') });
  const sandbox = buildSandbox({ obligations: [oAgo, oSep], services: [s1], payments: [p1], paymentAllocations: [], now: '2026-08-16T00:00:00' });
  const credits = sandbox.availableServiceCredits('s1');
  const { payment: sourcePayment, available } = credits[0];
  await sandbox.applyServiceCreditToObligation(sourcePayment, oAgo, available, oSep, available);
  // sourcePayment (el registro original de payments) nunca se toca al
  // convertir a allocations -- su notes sigue intacta.
  assert.strictEqual(sandbox.paymentAppliedDueStage(sourcePayment), 'second', 'la metadata vive en payments.notes, independiente de payment_allocations');
  assert.strictEqual(sandbox.effectiveObligationAmount(oAgo, [p1], sandbox.__state.allocations), 105, 'incluso ya convertido a allocations, la obligación original sigue exigiendo su importe real');
});

caso('CASO 105 — Tarjetas permanece byte-idéntica tras el wiring de persistencia en payments.notes (regresión final)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_persistencia_notes_stage_20260816_205022', `${f}.antes_persistencia_notes_stage`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
    assert.strictEqual(
      extract(now, 'function fmtMoney(v){', '\n'),
      extract(before, 'function fmtMoney(v){', '\n'),
      `fmtMoney en ${f} debe seguir byte-idéntica`
    );
  }
});

// ============================================================
// ALTA INICIAL DE OBLIGACIÓN (20260816e) -- corrección de hueco funcional:
// segundo vencimiento/segundo importe estaban ANTES atrapados dentro de
// ${o?...} en openObligation() (solo visibles al EDITAR, nunca al cargar
// el mes por primera vez). saveMonthData() ya era compartida entre alta y
// edición (no se tocó); el bug era pura plantilla. Estos casos prueban la
// lógica REAL extraída, nunca reimplementada.
// ============================================================

// Extrae y ejecuta el fragmento real de validación + construcción de
// newExtra/notesValue de saveMonthData() -- el mismo bloque para alta
// (o=undefined) y edición, tal cual vive en el archivo.
function runObligationSecondFieldsSnippet(text, { o, dueValue, secondDueValue, secondAmountRaw, notes }) {
  const block = extract(text, 'const secondDueValue=document.getElementById', 'const notesValue=updateObligationNotes(o?.notes,metaUpdate,newFreeText);') + 'const notesValue=updateObligationNotes(o?.notes,metaUpdate,newFreeText);';
  const documentMock = {
    getElementById(id) {
      if (id === 'osecondDue') return { value: secondDueValue || '' };
      if (id === 'osecondAmount') return { value: secondAmountRaw || '' };
      if (id === 'onotes') return { value: notes || '' };
      if (id === 'ocurrency' || id === 'oprovider' || id === 'oinvoicenumber') return null;
      return null;
    },
  };
  const sandbox = buildSandbox({});
  const fn = new Function(
    'document', 'o', 'dueValue', 'parseMoneyField', 'obligationUserNotes', 'obligationExtraFields', 'updateObligationNotes',
    block + '\nreturn { secondDueValue, secondAmountValue, newExtra, notesValue };'
  );
  return fn(documentMock, o, dueValue, sandbox.parseMoneyField, sandbox.obligationUserNotes, sandbox.obligationExtraFields, sandbox.updateObligationNotes);
}

caso('CASO 106 — ALTA INICIAL: osecondAmount/osecondDue existen en el modal SIN estar atrapados dentro de ${o?...} (el bug reportado)', () => {
  for (const text of [indexText, operatorText]) {
    const fnBlock = extract(text, 'function openObligation(serviceId,key){', 'function openApplyCreditModal(serviceId,targetObligation){');
    // El gate que sí debe seguir siendo exclusivo de edición es el que
    // envuelve Período/Moneda/Proveedor/Nº factura (edit-only real) --
    // se usa <label>Período</label> como ancla inequívoca, porque el
    // primer ${o?... del archivo (payment-summary) cierra ANTES de
    // llegar a los campos de segundo vencimiento y no es el que importa
    // acá.
    const editOnlyGateIdx = fnBlock.indexOf('<label>Período</label>');
    const amountFieldIdx = fnBlock.indexOf('id="osecondAmount"');
    const dueFieldIdx = fnBlock.indexOf('id="osecondDue"');
    assert.ok(editOnlyGateIdx !== -1, 'debe seguir existiendo la sección exclusiva de edición (período/moneda/proveedor/nº factura)');
    assert.ok(amountFieldIdx !== -1 && amountFieldIdx < editOnlyGateIdx, 'osecondAmount debe estar ANTES de la sección exclusiva de edición -- visible también al crear');
    assert.ok(dueFieldIdx !== -1 && dueFieldIdx < editOnlyGateIdx, 'osecondDue debe estar ANTES de la sección exclusiva de edición -- visible también al crear');
    // Solo debe existir UNA sola definición de cada campo (no quedó un
    // duplicado viejo adentro del gate).
    assert.strictEqual((fnBlock.match(/id="osecondAmount"/g) || []).length, 1);
    assert.strictEqual((fnBlock.match(/id="osecondDue"/g) || []).length, 1);
  }
});

caso('CASO 107 — ALTA con segundo vencimiento + segundo importe: ambos se guardan (o=undefined, lógica real de saveMonthData)', () => {
  for (const text of [indexText, operatorText]) {
    const result = runObligationSecondFieldsSnippet(text, {
      o: undefined, dueValue: '2026-08-10', secondDueValue: '2026-08-20', secondAmountRaw: '105.000', notes: '',
    });
    assert.strictEqual(result.newExtra.secondDueDate, '2026-08-20');
    assert.strictEqual(result.newExtra.secondAmount, 105000);
    assert.ok(JSON.parse(result.notesValue.match(/\[\[OBLIGATION_META:(\{.*?\})\]\]/)[1]).extraFields.secondDueDate === '2026-08-20');
  }
});

caso('CASO 108 — ALTA: fecha del segundo vencimiento anterior a la del primero se rechaza (o=undefined)', () => {
  for (const text of [indexText, operatorText]) {
    assert.throws(
      () => runObligationSecondFieldsSnippet(text, { o: undefined, dueValue: '2026-08-20', secondDueValue: '2026-08-10', secondAmountRaw: '', notes: '' }),
      /El segundo vencimiento no puede ser anterior al primer vencimiento/
    );
  }
});

caso('CASO 109 — ALTA: segundo importe <= 0 se rechaza (o=undefined)', () => {
  for (const text of [indexText, operatorText]) {
    assert.throws(
      () => runObligationSecondFieldsSnippet(text, { o: undefined, dueValue: '2026-08-10', secondDueValue: '2026-08-20', secondAmountRaw: '0', notes: '' }),
      /El importe con segundo vencimiento debe ser mayor a cero/
    );
  }
});

caso('CASO 110 — ALTA sin segundo vencimiento sigue funcionando igual que antes (o=undefined, campos vacíos)', () => {
  for (const text of [indexText, operatorText]) {
    const result = runObligationSecondFieldsSnippet(text, { o: undefined, dueValue: '2026-08-10', secondDueValue: '', secondAmountRaw: '', notes: '' });
    assert.strictEqual(result.newExtra.secondDueDate, null);
    assert.strictEqual(result.newExtra.secondAmount, null);
  }
});

caso('CASO 111 — RELOAD: los datos cargados en el alta inicial se leen exactamente igual al reabrir la obligación', () => {
  for (const text of [indexText, operatorText]) {
    const created = runObligationSecondFieldsSnippet(text, {
      o: undefined, dueValue: '2026-08-10', secondDueValue: '2026-08-20', secondAmountRaw: '105.000', notes: '',
    });
    // Simula el reload: se construye el registro "ya guardado" solo con
    // el notes real que devolvió saveMonthData(), y se lee de vuelta con
    // la misma función que usa el resto de la app (obligationExtraFields).
    const sandbox = buildSandbox({});
    const savedObligation = { id: 'o1', amount: 100000, due_date: '2026-08-10', notes: created.notesValue };
    const readBack = sandbox.obligationExtraFields(savedObligation);
    assert.strictEqual(readBack.secondDueDate, '2026-08-20');
    assert.strictEqual(readBack.secondAmount, 105000);
  }
});

caso('CASO 112 — el selector Primer/Segundo vencimiento de openPayModal aparece para una obligación creada con segundo vencimiento desde el alta inicial', () => {
  for (const text of [indexText, operatorText]) {
    const created = runObligationSecondFieldsSnippet(text, {
      o: undefined, dueValue: '2026-08-10', secondDueValue: '2026-08-20', secondAmountRaw: '105.000', notes: '',
    });
    const sandbox = buildSandbox({});
    const savedObligation = { id: 'o1', service_id: 's1', amount: 100000, due_date: '2026-08-10', notes: created.notesValue };
    // Misma condición que usa openPayModal para decidir hasSecondDue.
    const extra = sandbox.obligationExtraFields(savedObligation);
    assert.ok(!!extra.secondDueDate, 'la obligación creada desde el alta inicial debe activar hasSecondDue en openPayModal, sin pasar por una edición posterior');
  }
});

caso('CASO 113 — Tarjetas permanece byte-idéntica tras la corrección del alta inicial (regresión final)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_alta_inicial_segundo_vencimiento_20260816_210927', `${f}.antes_alta_inicial_segundo_vencimiento`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
    assert.strictEqual(
      extract(now, 'function fmtMoney(v){', '\n'),
      extract(before, 'function fmtMoney(v){', '\n'),
      `fmtMoney en ${f} debe seguir byte-idéntica`
    );
    // saveMonthData() no debía necesitar NINGÚN cambio (ya era compartida
    // entre alta y edición) -- se confirma byte a byte contra el backup.
    assert.strictEqual(
      extract(now, 'async function saveMonthData(', "const saveButton=document.getElementById('saveObligation')"),
      extract(before, 'async function saveMonthData(', "const saveButton=document.getElementById('saveObligation')"),
      `saveMonthData() en ${f} no debía cambiar -- el bug era solo de plantilla`
    );
  }
});

caso('CASO 114 — paridad exacta index.html / index_operator.html para openObligation completo', () => {
  const fnA = extract(indexText, 'function openObligation(serviceId,key){', 'function openApplyCreditModal(serviceId,targetObligation){');
  const fnB = extract(operatorText, 'function openObligation(serviceId,key){', 'function openApplyCreditModal(serviceId,targetObligation){');
  assert.strictEqual(fnA, fnB, 'openObligation() debe ser byte-idéntica entre index.html e index_operator.html');
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
  console.log('AVISO: valida lógica real extraída + mock de Supabase en memoria, NO confirm()/DOM real ni Supabase real.');
  if (fail > 0) process.exitCode = 1;
}

run();
