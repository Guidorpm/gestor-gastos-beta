// HOTFIX PRODUCCIÓN — PAYMENT_ALLOCATIONS EN DEUDAS ARRASTRADAS
// (CORRECCIÓN FINAL: imputaciones de pagos anulados + bloqueo total del
// estado financiero ante error de carga, separado por Panel/Espacio).
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// (nunca reimplementa la lógica). Cubre los 18 puntos obligatorios del
// pedido. NO asume que la imputación de un pago anulado ya fue
// desactivada por el servidor -- los casos 1/2/3 construyen deliberadamente
// datos "sucios" (imputación activa sobre un pago voided, payment_id
// inexistente) para confirmar que la función los rechaza por sí misma.
const fs = require('fs');
const path = require('path');

const FILES = {
  'index.html': path.join(__dirname, '..', 'index.html'),
  'index_operator.html': path.join(__dirname, '..', 'index_operator.html')
};

let ok = 0, fail = 0;
function assertOk(label, cond) {
  if (cond) { ok++; console.log('OK  ', label); }
  else { fail++; console.log('FAIL', label); }
}
function eq(label, actual, expected) {
  assertOk(label + ` (obtenido=${JSON.stringify(actual)}, esperado=${JSON.stringify(expected)})`, actual === expected);
}

function extractFunction(src, name) {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(src);
  if (!m) return null;
  let i = m.index;
  let k = src.indexOf('(', m.index), pdepth = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pdepth++; else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } } }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(i, j);
}
function extractConst(src, name) {
  const m = new RegExp(`const ${name}=\\{[^}]*\\};`).exec(src);
  return m ? m[0] : null;
}

// ============================================================
// PARTE A — cálculo puro: paidAmountForWithAllocations/paidAmountFor/
// balanceFor. Puntos 1 a 6.
// ============================================================
const FN_NAMES_CALC = ['paidAmountForWithAllocations', 'paidAmountFor', 'balanceFor', 'isEffectivePending', 'pendingObligations', 'carriedDebts', 'consolidationForSource', 'periodDate', 'paymentsFor'];

function buildCalcRuntime(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fns = FN_NAMES_CALC.map(n => { const f = extractFunction(src, n); if (!f) throw new Error('No se pudo extraer ' + n); return f; }).join('\n');
  const body = `
    let obligations = [];
    let payments = [];
    let paymentAllocations = [];
    let paymentAllocationsLoadError = false;
    let consolidations = [];
    let baseMonth = '2026-08';
    ${fns}
    module.exports = {
      setState: (s) => {
        obligations = s.obligations || [];
        payments = s.payments || [];
        paymentAllocations = s.paymentAllocations || [];
        consolidations = s.consolidations || [];
        baseMonth = s.baseMonth || '2026-08';
      },
      balanceFor, paidAmountFor, paidAmountForWithAllocations, isEffectivePending, pendingObligations, carriedDebts,
      getObligation: (id) => obligations.find(o => o.id === id)
    };
  `;
  const Module = require('module');
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  m._compile(body, filePath);
  return m.exports;
}

for (const [label, filePath] of Object.entries(FILES)) {
  console.log(`\n--- ${label} : PARTE A (cálculo con imputaciones) ---`);
  const rt = buildCalcRuntime(filePath);

  // 1. Pago voided=true + imputación is_active=true (dato "sucio",
  //    nunca se asume que el servidor ya la desactivó): total pagado = 0.
  rt.setState({
    obligations: [{ id: 'oblVoided', service_id: 's1', period: '2026-06-01', amount: 400000, status: 'pending', due_date: '2026-06-10' }],
    payments: [{ id: 'payVoided', obligation_id: 'oblVoided', total_amount: 400000, voided: true }],
    paymentAllocations: [{ payment_id: 'payVoided', obligation_id: 'oblVoided', allocated_amount: 400000, is_active: true }],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 1. Pago anulado con imputación todavía activa -- total pagado = 0`, rt.paidAmountFor('oblVoided'), 0);

  // 2. Imputación activa cuyo payment_id NO existe en paymentsList: total pagado = 0.
  rt.setState({
    obligations: [{ id: 'oblGhost', service_id: 's1', period: '2026-06-01', amount: 500000, status: 'pending', due_date: '2026-06-10' }],
    payments: [],
    paymentAllocations: [{ payment_id: 'payQueNoExiste', obligation_id: 'oblGhost', allocated_amount: 500000, is_active: true }],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 2. Imputación con payment_id inexistente -- total pagado = 0`, rt.paidAmountFor('oblGhost'), 0);

  // 3. Solo imputaciones con is_active === true contabilizan (null/undefined/otro valor NO cuentan).
  rt.setState({
    obligations: [{ id: 'oblStrict', service_id: 's1', period: '2026-06-01', amount: 300000, status: 'pending', due_date: '2026-06-10' }],
    payments: [{ id: 'payStrict', obligation_id: 'oblOtra', total_amount: 300000, voided: false }],
    paymentAllocations: [
      { payment_id: 'payStrict', obligation_id: 'oblStrict', allocated_amount: 100000, is_active: null },
      { payment_id: 'payStrict', obligation_id: 'oblStrict', allocated_amount: 100000, is_active: undefined },
      { payment_id: 'payStrict', obligation_id: 'oblStrict', allocated_amount: 100000 } // sin campo is_active
    ],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 3. Imputaciones con is_active null/undefined/ausente -- NINGUNA contabiliza (validación estricta ===true)`, rt.paidAmountFor('oblStrict'), 0);

  // 4. Pago no anulado con imputación activa -- no se cuenta también por obligation_id.
  rt.setState({
    obligations: [{ id: 'obl1', service_id: 's1', period: '2026-06-01', amount: 500000, status: 'pending', due_date: '2026-06-10' }],
    payments: [{ id: 'payX', obligation_id: 'obl1', total_amount: 500000, voided: false }],
    paymentAllocations: [{ payment_id: 'payX', obligation_id: 'obl1', allocated_amount: 500000, is_active: true }],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 4. Pago con asignación activa -- se cuenta UNA sola vez (nunca 1.000.000)`, rt.paidAmountFor('obl1'), 500000);

  // 5. Junio real: obligación $900.000, pago legado $800.000 + imputación
  //    activa $100.000 (proveniente de un pago distribuido de $600.000
  //    junto con julio) -> total pagado $900.000, saldo $0, no aparece.
  // 6. Julio real: obligación $900.000, pago legado $400.000 + imputación
  //    activa $500.000 -> total pagado $900.000, saldo $0, no aparece.
  rt.setState({
    obligations: [
      { id: 'jun', service_id: 's1', period: '2026-06-01', amount: 900000, status: 'pending', due_date: '2026-06-10' },
      { id: 'jul', service_id: 's1', period: '2026-07-01', amount: 900000, status: 'pending', due_date: '2026-07-10' }
    ],
    payments: [
      { id: 'legJun', obligation_id: 'jun', total_amount: 800000, voided: false },
      { id: 'legJul', obligation_id: 'jul', total_amount: 400000, voided: false },
      { id: 'paySplit', obligation_id: null, total_amount: 600000, voided: false }
    ],
    paymentAllocations: [
      { payment_id: 'paySplit', obligation_id: 'jun', allocated_amount: 100000, is_active: true },
      { payment_id: 'paySplit', obligation_id: 'jul', allocated_amount: 500000, is_active: true }
    ],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 5. Junio real -- $800.000 legado + $100.000 imputado = $900.000`, rt.paidAmountFor('jun'), 900000);
  eq(`[${label}] 5. Junio real -- saldo $0`, rt.balanceFor(rt.getObligation('jun')), 0);
  assertOk(`[${label}] 5. Junio real -- NO aparece en carriedDebts`, !rt.carriedDebts().some(o => o.id === 'jun'));
  eq(`[${label}] 6. Julio real -- $400.000 legado + $500.000 imputado = $900.000`, rt.paidAmountFor('jul'), 900000);
  eq(`[${label}] 6. Julio real -- saldo $0`, rt.balanceFor(rt.getObligation('jul')), 0);
  assertOk(`[${label}] 6. Julio real -- NO aparece en carriedDebts`, !rt.carriedDebts().some(o => o.id === 'jul'));

  // 7. Caso de saldo PARCIAL (distinto de los casos $0 de arriba): obligación
  //    $900.000, pagado $700.000 ($400.000 legado + $300.000 vía imputación
  //    activa de un pago distinto) -> saldo $200.000, sigue pendiente
  //    (isEffectivePending=true), no se confunde con "abonado".
  rt.setState({
    obligations: [{ id: 'oblPartial', service_id: 's1', period: '2026-08-01', amount: 900000, status: 'pending', due_date: '2026-08-10' }],
    payments: [
      { id: 'legPartial', obligation_id: 'oblPartial', total_amount: 400000, voided: false },
      { id: 'payAllocPartial', obligation_id: null, total_amount: 300000, voided: false }
    ],
    paymentAllocations: [
      { payment_id: 'payAllocPartial', obligation_id: 'oblPartial', allocated_amount: 300000, is_active: true }
    ],
    baseMonth: '2026-08'
  });
  eq(`[${label}] 7. Saldo parcial -- $400.000 legado + $300.000 imputado = $700.000 pagado`, rt.paidAmountFor('oblPartial'), 700000);
  eq(`[${label}] 7. Saldo parcial -- saldo pendiente $200.000 (nunca $0 ni el importe completo)`, rt.balanceFor(rt.getObligation('oblPartial')), 200000);
  assertOk(`[${label}] 7. Saldo parcial -- SIGUE pendiente (isEffectivePending)`, rt.isEffectivePending(rt.getObligation('oblPartial')));
}

// ============================================================
// PARTE B — paymentProgress/dueState/boxText/openPayModal con
// paymentAllocationsLoadError=true (espacio). Puntos 8 y 9.
// ============================================================
const FN_NAMES_SPACE_ERROR = ['paymentProgress', 'paidAmountFor', 'paidAmountForWithAllocations', 'dueState', 'boxText', 'isObligationVoided', 'obligationVoidInfo', 'consolidationTarget', 'consolidationForSource', 'consolidationsForTarget', 'emptyBoxText', 'formatObligationAmount', 'obligationCurrency', 'obligationExtraFields', 'obligationNoteMeta', 'obligationUserNotes'];

function buildSpaceErrorRuntime(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const present = FN_NAMES_SPACE_ERROR.filter(n => extractFunction(src, n));
  const fns = present.map(n => extractFunction(src, n)).join('\n');
  const metaPrefixConst = (src.match(/const OBLIGATION_META_PREFIX=[^;]+;/) || ["const OBLIGATION_META_PREFIX='[[OBLIGATION_META:';"])[0];
  const body = `
    ${metaPrefixConst}
    let payments = [];
    let paymentAllocations = [];
    let paymentAllocationsLoadError = false;
    let consolidations = [];
    let members = [];
    let daysUntil = () => 0;
    let displayNameForUserId = () => '';
    let monthLabel = (k) => k;
    let fmtMoney = (n) => n === null ? 'No disponible' : ('$' + n);
    let formatUSD = (n) => n === null ? 'No disponible' : ('US$' + n);
    let fmtDate = (d) => d;
    let esc = (s) => s;
    ${fns}
    module.exports = { setError: (v) => { paymentAllocationsLoadError = v; }, paymentProgress, dueState, boxText };
  `;
  const Module = require('module');
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  m._compile(body, filePath);
  return m.exports;
}

for (const [label, filePath] of Object.entries(FILES)) {
  console.log(`\n--- ${label} : PARTE B (estado del espacio con error) ---`);
  const rt = buildSpaceErrorRuntime(filePath);
  rt.setError(true);
  const oblVencida = { id: 'oblV', period: '2026-06-01', amount: 100000, status: 'pending', due_date: '2026-01-01' }; // muy vencida por fecha
  const progress = rt.paymentProgress(oblVencida);
  assertOk(`[${label}] 8. paymentProgress marca unavailable=true con paymentAllocationsLoadError`, progress.unavailable === true);
  eq(`[${label}] 8. paymentProgress.balance es null (nunca un número calculado)`, progress.balance, null);
  const state = rt.dueState(oblVencida);
  eq(`[${label}] 8. dueState NUNCA muestra "vencido" calculado por fecha con error activo`, state.cls, 'unavailable');
  eq(`[${label}] 8. dueState.label es "No disponible"`, state.label, 'No disponible');
  const text = rt.boxText(oblVencida, { frequency: 'monthly' });
  eq(`[${label}] 8. boxText muestra "No disponible" en vez de un estado financiero`, text[0], 'No disponible');

  // 18/19. EL CASO REAL DEL BUG REPORTADO: un registro con status='paid'
  // PERSISTIDO en la base (dato real, no inventado) -- antes de esta
  // corrección, dueState()/boxText() comprobaban o.status==='paid' ANTES
  // que progress.unavailable, así que esto se mostraba como "Abonado" a
  // pesar de que el pago real no podía verificarse. Ahora debe mostrar
  // "No disponible" igual que cualquier otro caso con error activo -- el
  // status persistido nunca puede prevalecer sobre un error de carga.
  const oblYaPagada = { id: 'oblPaid', period: '2026-06-01', amount: 250000, status: 'paid', due_date: '2026-06-10' };
  const stateForPaid = rt.dueState(oblYaPagada);
  eq(`[${label}] 18. dueState con status='paid' + error activo -- NUNCA "Abonado", debe ser "No disponible"`, stateForPaid.cls, 'unavailable');
  eq(`[${label}] 18. dueState con status='paid' + error activo -- label "No disponible"`, stateForPaid.label, 'No disponible');
  const textForPaid = rt.boxText(oblYaPagada, { frequency: 'monthly' });
  eq(`[${label}] 19. boxText con status='paid' + error activo -- NUNCA "Abonado", debe ser "No disponible"`, textForPaid[0], 'No disponible');
  assertOk(`[${label}] 19. boxText con status='paid' + error activo -- el importe mostrado es el ORIGINAL (250.000), nunca "null"/vacío`, /250\.?000|250000/.test(textForPaid[1]) && !/null|undefined/.test(textForPaid[1]));

  // Regresión: con el error DESACTIVADO, status='paid' sigue funcionando
  // normalmente (la corrección no rompe el caso legítimo de "sí se pudo
  // verificar y sí está pagada").
  rt.setError(false);
  const stateForPaidOk = rt.dueState(oblYaPagada);
  eq(`[${label}] 18b. Regresión -- sin error, status='paid' SIGUE mostrando "Abonado"`, stateForPaidOk.cls, 'paid');
  const textForPaidOk = rt.boxText(oblYaPagada, { frequency: 'monthly' });
  eq(`[${label}] 19b. Regresión -- sin error, boxText SIGUE mostrando "Abonado"`, textForPaidOk[0], 'Abonado');
  rt.setError(true);
}

// ============================================================
// PARTE G — servicePriorityNotifications() con paymentAllocationsLoadError.
// Puntos 20 a 27: ningún aviso FINANCIERO (vencido/vence hoy/vence
// pronto/comprobante faltante basado en progress.paid) se genera con el
// error activo; los avisos NO financieros (factura faltante) se
// mantienen; se agrega el aviso de suspensión; nunca aparece
// "Pendiente $0"; y con el error desactivado los avisos financieros
// vuelven a generarse con normalidad (para confirmar que la suspensión es
// condicional, no una rotura general de la función).
// ============================================================
const FN_NAMES_NOTIFICATIONS = [
  'servicePriorityNotifications', 'paymentProgress', 'paidAmountFor', 'paidAmountForWithAllocations',
  'isObligationVoided', 'obligationFor', 'monthAppliesToService', 'todayInArgentina', 'nowInArgentina',
  'daysUntil', 'today', 'receiptsForObligation', 'paymentsFor', 'monthLabel'
];
function buildNotificationsRuntime(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fns = FN_NAMES_NOTIFICATIONS.map(n => { const f = extractFunction(src, n); if (!f) throw new Error('No se pudo extraer ' + n); return f; }).join('\n');
  const body = `
    const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    function monthKey(d){return \`\${d.getFullYear()}-\${String(d.getMonth()+1).padStart(2,'0')}\`}
    function periodDate(key){return key+'-01'}
    function fmtMoney(v){return '$'+Number(v||0)}
    let services = [];
    let obligations = [];
    let documents = [];
    let payments = [];
    let paymentAllocations = [];
    let paymentAllocationsLoadError = false;
    ${fns}
    module.exports = {
      setState: (s) => {
        services = s.services || [];
        obligations = s.obligations || [];
        documents = s.documents || [];
        payments = s.payments || [];
        paymentAllocations = s.paymentAllocations || [];
        paymentAllocationsLoadError = !!s.paymentAllocationsLoadError;
      },
      run: () => servicePriorityNotifications(),
      getToday: () => todayInArgentina(),
      getCurrentPeriodKey: () => monthKey(todayInArgentina())
    };
  `;
  const Module = require('module');
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  m._compile(body, filePath);
  return m.exports;
}

for (const [label, filePath] of Object.entries(FILES)) {
  console.log(`\n--- ${label} : PARTE G (servicePriorityNotifications con error) ---`);
  const rt = buildNotificationsRuntime(filePath);
  const period = rt.getCurrentPeriodKey();
  const today = rt.getToday();
  const isoOffset = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

  const baseServices = [
    { id: 'svcOverdue', name: 'Servicio vencido', frequency: 'monthly' },
    { id: 'svcToday', name: 'Servicio vence hoy', frequency: 'monthly' },
    { id: 'svcSoon', name: 'Servicio vence pronto', frequency: 'monthly' }
  ];
  const baseObligations = [
    { id: 'oOverdue', service_id: 'svcOverdue', period: periodDateHelper(period), amount: 100000, status: 'pending', due_date: isoOffset(-5), notes: '' },
    { id: 'oToday', service_id: 'svcToday', period: periodDateHelper(period), amount: 50000, status: 'pending', due_date: isoOffset(0), notes: '' },
    { id: 'oSoon', service_id: 'svcSoon', period: periodDateHelper(period), amount: 75000, status: 'pending', due_date: isoOffset(2), notes: '' }
  ];
  function periodDateHelper(key) { return key + '-01'; }

  // 20-22. Con paymentAllocationsLoadError=true: NINGÚN aviso financiero
  // (overdue/due_today/due_soon) se genera, aunque las obligaciones estén
  // realmente vencidas/por vencer.
  rt.setState({ services: baseServices, obligations: baseObligations, documents: [{ obligation_id: 'oOverdue', kind: 'invoice' }, { obligation_id: 'oToday', kind: 'invoice' }, { obligation_id: 'oSoon', kind: 'invoice' }], payments: [], paymentAllocations: [], paymentAllocationsLoadError: true });
  const itemsWithError = rt.run();
  assertOk(`[${label}] 20. Con error activo -- NO se genera aviso 'overdue' aunque la obligación esté vencida`, !itemsWithError.some(i => i.key.includes(':overdue')));
  assertOk(`[${label}] 21. Con error activo -- NO se genera aviso 'due_today'`, !itemsWithError.some(i => i.key.includes(':due_today')));
  assertOk(`[${label}] 22. Con error activo -- NO se genera aviso 'due_soon'`, !itemsWithError.some(i => i.key.includes(':due_soon')));

  // 23. Aviso de suspensión presente con el texto exacto pedido.
  const suspensionItem = itemsWithError.find(i => i.key === '__payment_allocations_unavailable__');
  assertOk(`[${label}] 23. Con error activo -- se agrega el aviso de suspensión`, !!suspensionItem);
  eq(`[${label}] 23. El aviso de suspensión tiene el texto exacto pedido`, suspensionItem && suspensionItem.message,
    'No se pudieron verificar las imputaciones de pagos. Los avisos de vencimiento y pago de este espacio están temporalmente suspendidos para evitar informar deudas incorrectas.');

  // 24. NUNCA aparece "Pendiente $0" (ni ningún "Pendiente" financiero) en
  // ningún mensaje mientras el error está activo.
  assertOk(`[${label}] 24. Con error activo -- NINGÚN mensaje contiene "Pendiente" (nunca "Pendiente $0")`, !itemsWithError.some(i => /Pendiente/.test(i.message)));

  // 25. Documental (factura faltante) SIGUE funcionando con error activo --
  // no depende del saldo.
  rt.setState({ services: baseServices, obligations: baseObligations, documents: [], payments: [], paymentAllocations: [], paymentAllocationsLoadError: true });
  const itemsNoInvoice = rt.run();
  assertOk(`[${label}] 25. Con error activo -- 'missing_invoice' SIGUE generándose (no depende del saldo)`,
    itemsNoInvoice.some(i => i.key.includes(':missing_invoice')));

  // 26. Comprobante faltante (missing_receipt) NO se genera con error
  // activo, aunque haya pagos legado registrados (depende de progress.paid).
  const obligationWithPayment = [{ id: 'oPaidNoReceipt', service_id: 'svcOverdue', period: periodDateHelper(period), amount: 100000, status: 'pending', due_date: isoOffset(-5), notes: '' }];
  rt.setState({ services: baseServices, obligations: obligationWithPayment, documents: [{ obligation_id: 'oPaidNoReceipt', kind: 'invoice' }], payments: [{ id: 'payNoReceipt', obligation_id: 'oPaidNoReceipt', total_amount: 50000, voided: false }], paymentAllocations: [], paymentAllocationsLoadError: true });
  const itemsNoReceipt = rt.run();
  assertOk(`[${label}] 26. Con error activo -- 'missing_receipt' NO se genera (depende de progress.paid, no verificado)`,
    !itemsNoReceipt.some(i => i.key.includes(':missing_receipt')));

  // 27. REGRESIÓN -- con el error DESACTIVADO, los avisos financieros
  // vuelven a generarse con normalidad (la suspensión es condicional).
  rt.setState({ services: baseServices, obligations: baseObligations, documents: [{ obligation_id: 'oOverdue', kind: 'invoice' }, { obligation_id: 'oToday', kind: 'invoice' }, { obligation_id: 'oSoon', kind: 'invoice' }], payments: [], paymentAllocations: [], paymentAllocationsLoadError: false });
  const itemsNoError = rt.run();
  assertOk(`[${label}] 27. Regresión -- SIN error, 'overdue' SÍ se genera con normalidad`, itemsNoError.some(i => i.key.includes(':overdue')));
  assertOk(`[${label}] 27. Regresión -- SIN error, 'due_today' SÍ se genera con normalidad`, itemsNoError.some(i => i.key.includes(':due_today')));
  assertOk(`[${label}] 27. Regresión -- SIN error, 'due_soon' SÍ se genera con normalidad`, itemsNoError.some(i => i.key.includes(':due_soon')));
  assertOk(`[${label}] 27. Regresión -- SIN error, NO aparece el aviso de suspensión`, !itemsNoError.some(i => i.key === '__payment_allocations_unavailable__'));
}

// openPayModal: verificación estática del corte inmediato (invocar la
// función real requeriría todo el árbol de modal()/DOM -- se confirma el
// texto real de la guarda, ya verificado funcionalmente vía paymentProgress
// arriba, que es la fuente de la que openPayModal depende).
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fn = extractFunction(src, 'openPayModal');
  assertOk(`[${label}] 9. openPayModal se detiene INMEDIATAMENTE si paymentAllocationsLoadError (antes de calcular progress)`,
    /^function openPayModal\(o\)\{[\s\S]{0,400}?if\(paymentAllocationsLoadError\)\{[\s\S]{0,200}?return;[\s\S]{0,50}?\}[\s\S]*?const progress=paymentProgress\(o\);/.test(fn.replace(/\r\n/g, '\n').replace(/\s+/g, m => m)));
}

// ============================================================
// PARTE C — independencia real de las 2 banderas de error (Panel vs
// Espacio). Puntos 11 y 12: una carga exitosa de un contexto NUNCA borra
// el error real del otro.
// ============================================================
function makeChainableResult(result) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    order() { return builder; },
    single() { return builder; },
    then(resolve, reject) { try { resolve(result); } catch (e) { reject(e); } }
  };
  return builder;
}
function makeFakeSb(resultsByTable) {
  return {
    from(table) {
      const result = resultsByTable[table] || { data: [], error: null };
      return makeChainableResult(result);
    }
  };
}

const FN_NAMES_INDEPENDENCE = ['loadSpacesDashboard', 'reloadGroup'];
function buildIndependenceRuntime(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fns = FN_NAMES_INDEPENDENCE.map(n => { const f = extractFunction(src, n); if (!f) throw new Error('No se pudo extraer ' + n); return f; }).join('\n');
  const body = `
    let sb = null;
    let groups = [{ id: 'g1', created_by: 'user1', status: 'active' }];
    let session = { user: { id: 'user1' } };
    let spacesDashboard = { paymentAllocationsLoadError: false };
    let group = { id: 'g1' };
    let membership = null, members = [], services = [], obligations = [], payments = [], contributions = [], documents = [], consolidations = [];
    let paymentAllocations = [];
    let paymentAllocationsLoadError = false;
    function toast(){}
    function pickMembership(){ return null; }
    ${fns}
    module.exports = {
      setSb: (s) => { sb = s; },
      getSpacesDashboardError: () => spacesDashboard.paymentAllocationsLoadError,
      getGroupError: () => paymentAllocationsLoadError,
      runLoadSpacesDashboard: async () => { await loadSpacesDashboard(); },
      runReloadGroup: async () => { await reloadGroup(); }
    };
  `;
  const Module = require('module');
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  m._compile(body, filePath);
  return m.exports;
}

const OK_TABLE_RESULT = { data: [], error: null };
const FAIL_RESULT = { data: null, error: { message: 'boom' } };

// PARTE C usa await real (reloadGroup()/loadSpacesDashboard() son async) --
// se ejecuta dentro de una función async y el resto del archivo (Partes
// D/E/F + el resumen final) corre recién después de que termine, para que
// el orden de ejecución y el conteo final sean correctos.
async function runPartC() {
for (const [label, filePath] of Object.entries(FILES)) {
  console.log(`\n--- ${label} : PARTE C (independencia Panel vs Espacio) ---`);

  // 11. El Panel falla; luego el Espacio carga bien -> el error del Panel sigue en pie.
  const rt1 = buildIndependenceRuntime(filePath);
  rt1.setSb(makeFakeSb({
    services: OK_TABLE_RESULT, obligations: { data: [], error: null }, payments: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    payment_allocations: FAIL_RESULT
  }));
  await rt1.runLoadSpacesDashboard();
  eq(`[${label}] 11a. Falla la consulta del Panel -- spacesDashboard.paymentAllocationsLoadError=true`, rt1.getSpacesDashboardError(), true);
  rt1.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: OK_TABLE_RESULT,
    obligations: { data: [{ id: 'obl1', services: { group_id: 'g1' } }], error: null },
    payments: OK_TABLE_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    obligation_consolidations: OK_TABLE_RESULT,
    payment_allocations: OK_TABLE_RESULT,
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt1.runReloadGroup();
  eq(`[${label}] 11b. El espacio carga bien -- paymentAllocationsLoadError (espacio) queda en false`, rt1.getGroupError(), false);
  eq(`[${label}] 11c. El error del PANEL NO se borró por la carga exitosa del espacio`, rt1.getSpacesDashboardError(), true);

  // 12. El Espacio falla; luego el Panel carga bien -> el error del Espacio sigue en pie.
  const rt2 = buildIndependenceRuntime(filePath);
  rt2.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: OK_TABLE_RESULT,
    obligations: { data: [{ id: 'obl1', services: { group_id: 'g1' } }], error: null },
    payments: OK_TABLE_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    obligation_consolidations: OK_TABLE_RESULT,
    payment_allocations: FAIL_RESULT,
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt2.runReloadGroup();
  eq(`[${label}] 12a. Falla la consulta del espacio -- paymentAllocationsLoadError (espacio)=true`, rt2.getGroupError(), true);
  rt2.setSb(makeFakeSb({
    services: OK_TABLE_RESULT, obligations: { data: [], error: null }, payments: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    payment_allocations: OK_TABLE_RESULT
  }));
  await rt2.runLoadSpacesDashboard();
  eq(`[${label}] 12b. El Panel carga bien -- spacesDashboard.paymentAllocationsLoadError queda en false`, rt2.getSpacesDashboardError(), false);
  eq(`[${label}] 12c. El error del ESPACIO NO se borró por la carga exitosa del Panel`, rt2.getGroupError(), true);

  // ==========================================================
  // 28-31. MATRIZ DE FALLAS DE reloadGroup(): services/obligations/payments
  // que fallan SOLOS o combinados, con la consulta de payment_allocations
  // exitosa en TODOS los casos -- confirma que el hotfix ya no depende
  // únicamente del resultado de payment_allocations para decidir si el
  // estado financiero está disponible.
  // ==========================================================

  // 28. Falla SOLO 'services' (obligations con datos reales, payments ok,
  // payment_allocations EXITOSA) -- paymentAllocationsLoadError debe
  // terminar en true igual.
  const rt3 = buildIndependenceRuntime(filePath);
  rt3.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: FAIL_RESULT,
    obligations: { data: [{ id: 'obl1', services: { group_id: 'g1' } }], error: null },
    payments: OK_TABLE_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    obligation_consolidations: OK_TABLE_RESULT,
    payment_allocations: OK_TABLE_RESULT,
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt3.runReloadGroup();
  eq(`[${label}] 28. Falla SOLO 'services' (payment_allocations exitosa) -- paymentAllocationsLoadError=true igual`, rt3.getGroupError(), true);

  // 29. Falla SOLO 'payments' (services/obligations ok, payment_allocations
  // EXITOSA) -- paymentAllocationsLoadError debe terminar en true igual.
  const rt4 = buildIndependenceRuntime(filePath);
  rt4.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: OK_TABLE_RESULT,
    obligations: { data: [{ id: 'obl1', services: { group_id: 'g1' } }], error: null },
    payments: FAIL_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    obligation_consolidations: OK_TABLE_RESULT,
    payment_allocations: OK_TABLE_RESULT,
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt4.runReloadGroup();
  eq(`[${label}] 29. Falla SOLO 'payments' (payment_allocations exitosa) -- paymentAllocationsLoadError=true igual`, rt4.getGroupError(), true);

  // 30. Falla SOLO 'obligations' (que además deja obligationIds.length=0,
  // entrando por la rama "sin obligaciones"). Antes, un obligationIds vacío
  // por falla se confundía con "el espacio realmente no tiene obligaciones"
  // y terminaba en paymentAllocationsLoadError=false. Ahora debe dar true.
  const rt5 = buildIndependenceRuntime(filePath);
  rt5.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: OK_TABLE_RESULT,
    obligations: FAIL_RESULT,
    payments: OK_TABLE_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt5.runReloadGroup();
  eq(`[${label}] 30. Falla SOLO 'obligations' (obligationIds queda vacío A CAUSA de la falla) -- paymentAllocationsLoadError=true, NUNCA se confunde con "sin obligaciones"`, rt5.getGroupError(), true);

  // 31. Fallan LAS TRES a la vez (services+obligations+payments), con
  // payment_allocations igual exitosa -- combinación total, mismo resultado.
  const rt6 = buildIndependenceRuntime(filePath);
  rt6.setSb(makeFakeSb({
    memberships: OK_TABLE_RESULT, services: FAIL_RESULT,
    obligations: FAIL_RESULT,
    payments: FAIL_RESULT, payment_contributions: OK_TABLE_RESULT, documents: OK_TABLE_RESULT,
    groups: { data: { id: 'g1', name: 'G' }, error: null },
    internal_accounts: OK_TABLE_RESULT, service_categories: OK_TABLE_RESULT
  }));
  await rt6.runReloadGroup();
  eq(`[${label}] 31. Fallan services+obligations+payments a la vez -- paymentAllocationsLoadError=true`, rt6.getGroupError(), true);
}
}

function runRest() {
// ============================================================
// PARTE D — verificación estática de guardas en renderServices (matriz +
// panel de deudas), renderAnnualOverview (Vista rápida), renderReports,
// y el lado del Panel general (dashboardMetricsForGroup/
// renderOwnerDashboard/renderMonthlyObligationsBlock). Puntos 7, 13, 14, 15.
// ============================================================
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');

  const renderServicesFn = extractFunction(src, 'renderServices');
  assertOk(`[${label}] 14. Pie mensual de la matriz usa fmtPending (nunca fmtMoney) para Pagado/Pendiente`,
    /Pagado \$\{fmtPending\(total\.paid\)\} · Pendiente \$\{fmtPending\(total\.pending\)\}/.test(renderServicesFn));

  const annualFn = extractFunction(src, 'renderAnnualOverview');
  assertOk(`[${label}] 13. renderAnnualOverview NUNCA muestra Pagado/Pendiente con fmtMoney directo (usa annualFmt condicionado)`,
    /const annualFmt=\(n\)=>paymentAllocationsLoadError\?'No disponible':fmtMoney\(n\)/.test(annualFn)
    && /Pagado \$\{annualFmt\(data\.paid\)\} · Pendiente \$\{annualFmt\(data\.pending\)\}/.test(annualFn));

  const reportsFn = extractFunction(src, 'renderReports');
  assertOk(`[${label}] 15. renderReports corta con un aviso ANTES de generar métricas si paymentAllocationsLoadError`,
    /if\(paymentAllocationsLoadError\)\{\s*return `<div class="notice"/.test(reportsFn.replace(/\r\n/g, '\n')));

  const dashboardMetricsFn = extractFunction(src, 'dashboardMetricsForGroup');
  assertOk(`[${label}] 7a. dashboardMetricsForGroup deja paid/pending/unpaid en null si spacesDashboard.paymentAllocationsLoadError`,
    /financialDataUnavailable=spacesDashboard\.paymentAllocationsLoadError===true/.test(dashboardMetricsFn)
    && /const paid=financialDataUnavailable\?null:/.test(dashboardMetricsFn));

  const ownerDashFn = extractFunction(src, 'renderOwnerDashboard');
  assertOk(`[${label}] 7b. renderOwnerDashboard muestra "No disponible" (ownerFmt) en vez de un total calculado`,
    /const ownerFmt=\(n\)=>n===null\?'No disponible':fmtMoney\(n\)/.test(ownerDashFn));

  const monthlyBlockFn = extractFunction(src, 'renderMonthlyObligationsBlock');
  assertOk(`[${label}] 7c. renderMonthlyObligationsBlock oculta Total pagado/pendiente si hasUnavailableFinancialData`,
    /summary\.hasUnavailableFinancialData\?'No disponible':formatARS\(summary\.paidArs\)/.test(monthlyBlockFn));
}

// ============================================================
// PARTE E — punto 10: distribución/consolidación de pagos (Bloque 6A:
// un pago repartido entre VARIAS obligaciones/meses vía payment_allocations
// + RPC distribute_payment). Este baseline (05ba8f0) NO incluye ese
// mecanismo -- se confirma su ausencia real por nombre exacto de la RPC/
// función, nunca por una palabra suelta ("distribute" también aparece en
// distributePaymentContributions(), que reparte UN pago entre los APORTES
// de los integrantes -- una función preexistente, real, y completamente
// distinta, que no debe confundirse con Bloque 6A).
// ============================================================
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const hasDistributeRpc = /distribute_payment|create_and_distribute_payment/.test(src);
  const hasDistributeModal = /function\s+openDistributePaymentModal\(/.test(src);
  const hasCreateConsolidation = /function\s+\w*[Cc]reateConsolidat\w*\(/.test(src);
  assertOk(`[${label}] 10. Confirmado: este baseline no tiene la RPC de distribución de pagos entre obligaciones (Bloque 6A)`, !hasDistributeRpc);
  assertOk(`[${label}] 10. Confirmado: este baseline no tiene el modal de distribución de pagos (Bloque 6A)`, !hasDistributeModal);
  assertOk(`[${label}] 10. Confirmado: este baseline no tiene función de creación de consolidaciones (no aplica bloquear lo que no existe)`, !hasCreateConsolidation);
}

// ============================================================
// PARTE H — consolidación REAL de obligaciones (obligation_consolidations,
// dentro de openObligation() y su manejador de guardado). Puntos 32 a 37.
//
// IMPORTANTE: una ronda anterior de esta auditoría concluyó erróneamente
// "distribución/consolidación no aplica" porque solo buscó nombres de
// función que contuvieran "consolidat" (ver PARTE E arriba, que sigue
// siendo válida para la funcionalidad de Bloque 6A -- reparto de UN pago
// entre VARIAS obligaciones, que efectivamente no existe). Pero SÍ existe
// una consolidación real y distinta: una factura puede marcarse como que
// "incluye" deuda de meses anteriores, registrado en la tabla real
// obligation_consolidations mediante priorCandidates/data-consolidation-
// source/invoiceMode dentro de openObligation(). Esta parte confirma
// explícitamente su presencia (para no repetir la conclusión errónea) y
// que queda bloqueada mientras las imputaciones de pagos no estén
// verificadas.
// ============================================================
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const openObligationFn = extractFunction(src, 'openObligation');

  // 32. Confirmación explícita: el baseline SÍ contiene la consolidación
  // real de obligaciones -- nunca reutilizar "no aplica".
  assertOk(`[${label}] 32. Confirmado: el baseline SÍ contiene consolidación real de obligaciones (obligation_consolidations) dentro de openObligation() -- NO reutilizar la conclusión "no aplica"`,
    /obligation_consolidations/.test(openObligationFn)
    && /data-consolidation-source/.test(openObligationFn)
    && /priorCandidates/.test(openObligationFn)
    && /invoiceMode/.test(openObligationFn));

  // 33. priorCandidates se calcula vacío (nunca se llama a balanceFor sobre
  // deudas anteriores) cuando paymentAllocationsLoadError está activo.
  assertOk(`[${label}] 33. openObligation -- priorCandidates es [] cuando paymentAllocationsLoadError (nunca se calcula con balanceFor sin verificar)`,
    /const priorCandidates=paymentAllocationsLoadError\?\[\]:obligations/.test(openObligationFn));

  // 34. El bloque de controles de consolidación (radios "Factura
  // adicional"/"incluye deuda anterior" + checkboxes data-consolidation-
  // source) NUNCA se renderiza cuando paymentAllocationsLoadError.
  assertOk(`[${label}] 34. openObligation -- el bloque de consolidación (radios/checkboxes) se oculta explícitamente con paymentAllocationsLoadError`,
    /priorCandidates\.length&&!sourceLink&&!paymentAllocationsLoadError\?`/.test(openObligationFn));

  // 35. Se muestra un aviso explicando por qué no se puede consolidar.
  assertOk(`[${label}] 35. openObligation -- muestra el aviso "No se pueden consolidar deudas..." cuando corresponde`,
    /paymentAllocationsLoadError&&!sourceLink&&!voided\?`/.test(openObligationFn)
    && (openObligationFn.match(/No se pueden consolidar deudas hasta verificar las imputaciones de pagos/g) || []).length >= 2);

  // 36. El manejador de guardado (saveMonthData) se detiene ANTES de
  // cualquier escritura si se intenta guardar en modo "consolidated" con
  // el error activo -- nunca confía solo en que el HTML esté oculto.
  const guardIdx = openObligationFn.search(/if\(paymentAllocationsLoadError&&mode==='consolidated'\)\{\s*throw new Error\('No se pueden consolidar deudas hasta verificar las imputaciones de pagos\. Recargá el espacio\.'\);\s*\}/);
  const obligationsUpdateIdx = openObligationFn.indexOf(`sb.from('obligations').update(payload)`);
  assertOk(`[${label}] 36. saveMonthData -- la guarda de modo "consolidated" existe`, guardIdx !== -1);
  assertOk(`[${label}] 36. saveMonthData -- la guarda se ejecuta ANTES de escribir en 'obligations' (nunca después)`, guardIdx !== -1 && obligationsUpdateIdx !== -1 && guardIdx < obligationsUpdateIdx);

  // 37. Con paymentAllocationsLoadError activo, el guardado NUNCA toca
  // obligation_consolidations (ni borra vínculos existentes ni crea
  // nuevos) -- el delete+insert queda envuelto en if(!paymentAllocationsLoadError).
  assertOk(`[${label}] 37. saveMonthData -- el borrado/alta en obligation_consolidations queda envuelto en if(!paymentAllocationsLoadError) (nunca se ejecuta con el error activo)`,
    /if\(!paymentAllocationsLoadError\)\{\s*const \{error:deleteLinkError\}=await sb\s*\.from\('obligation_consolidations'\)\s*\.delete\(\)/.test(openObligationFn.replace(/\r\n/g, '\n')));
}

// ============================================================
// PARTE F — paridad (16) y sintaxis (17).
// ============================================================
{
  const srcMain = fs.readFileSync(FILES['index.html'], 'utf8');
  const srcOp = fs.readFileSync(FILES['index_operator.html'], 'utf8');
  const PARITY_FN_NAMES = [
    'paidAmountForWithAllocations', 'paidAmountFor', 'balanceFor', 'paymentProgress',
    'dueState', 'boxText', 'boxClass', 'loadGroups', 'loadSpacesDashboard',
    'dashboardPaidFor', 'dashboardBalanceFor', 'serviceObligationRowsForMonth',
    'monthlyObligationsSummary', 'monthlyObligationRowHtml', 'renderMonthlyObligationsBlock',
    'obligationDisplayStatus', 'reloadGroup', 'renderAnnualOverview', 'renderReports',
    'renderServices', 'openPayModal', 'openObligation', 'openFolder', 'openPaymentDetail',
    'servicePriorityNotifications'
  ];
  for (const name of PARITY_FN_NAMES) {
    const a = extractFunction(srcMain, name);
    const b = extractFunction(srcOp, name);
    assertOk(`16. Paridad -- ${name} byte-idéntica entre index.html e index_operator.html`, a === b && a !== null);
  }
  const rankA = extractConst(srcMain, 'OBLIGATION_STATUS_RANK');
  const rankB = extractConst(srcOp, 'OBLIGATION_STATUS_RANK');
  assertOk('16. Paridad -- OBLIGATION_STATUS_RANK idéntica entre ambos archivos', rankA === rankB && rankA !== null);
  // dashboardMetricsForGroup y renderOwnerDashboard tienen una diferencia
  // PRE-EXISTENTE (no introducida por este hotfix, confirmada contra el
  // respaldo previo a esta corrección) en el cálculo de averageMonthly --
  // se verifica que AMBAS sigan conteniendo la corrección de este hotfix,
  // en vez de exigir byte-a-byte total.
  const dmgA = extractFunction(srcMain, 'dashboardMetricsForGroup');
  const dmgB = extractFunction(srcOp, 'dashboardMetricsForGroup');
  assertOk('16. dashboardMetricsForGroup (index.html) contiene la corrección financialDataUnavailable', /financialDataUnavailable=spacesDashboard\.paymentAllocationsLoadError===true/.test(dmgA));
  assertOk('16. dashboardMetricsForGroup (index_operator.html) contiene la corrección financialDataUnavailable', /financialDataUnavailable=spacesDashboard\.paymentAllocationsLoadError===true/.test(dmgB));
}

for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((s, i) => {
    try { new Function(s); assertOk(`17. [${label}] bloque <script> #${i} -- sintaxis válida`, true); }
    catch (e) { assertOk(`17. [${label}] bloque <script> #${i} -- sintaxis válida (${e.message})`, false); }
  });
}

console.log(`\n=== TOTAL: ${ok + fail} verificaciones, ${fail} fallas ===`);
if (fail > 0) process.exitCode = 1;
}

runPartC().then(runRest).catch((e) => { console.error(e); process.exitCode = 1; });
