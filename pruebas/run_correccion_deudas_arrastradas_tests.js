// CORRECCIÓN LOCAL — DEUDAS ARRASTRADAS IGNORA IMPUTACIONES.
// Prueba dedicada a los 15 puntos exigidos por este pedido. Mezcla
// pruebas FUNCIONALES reales (ejecuta de verdad carriedDebts/
// pendingObligations/isEffectivePending/balanceFor/paidAmountFor/
// loadGroups extraídas del código real, nunca reimplementadas) con
// verificación por texto real (el fix del importe mostrado en el
// panel "Deudas arrastradas", y la paridad/no-regresión de GR/Casa/
// Tarjetas/RLS). NO ejecuta SQL, NO toca Supabase real.
// node pruebas/run_correccion_deudas_arrastradas_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcMain = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(root, 'index_operator.html'), 'utf8');
const backupDir = path.join(root, 'respaldos', 'antes_correccion_deudas_arrastradas_20260802_214949');

let total = 0, failures = 0;
function ok(label, cond) { total++; if (cond) console.log('OK  ', label); else { console.log('FAIL', label); failures++; } }
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(pass ? 'OK  ' : 'FAIL', label, pass ? '' : (': esperado=' + JSON.stringify(expected) + ' obtenido=' + JSON.stringify(actual)));
  if (!pass) failures++;
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

console.log('=== CORRECCIÓN LOCAL — DEUDAS ARRASTRADAS IGNORA IMPUTACIONES — 15 PUNTOS ===\n');

// ============================================================
// PARTE A — Verificación por texto real (ambos archivos): el fix del
// importe mostrado y la limpieza de estado en loadGroups().
// ============================================================
for (const [fileName, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  console.log(`\n--- ${fileName} (texto real) ---`);

  // Punto 8/2 (texto): "Deudas arrastradas" muestra balanceFor(o), nunca o.amount.
  {
    ok(`[${fileName}] el ítem de "Deudas arrastradas" muestra balanceFor(o) (nunca o.amount crudo)`, /<div class="debt-amount">\$\{fmtMoney\(balanceFor\(o\)\)\}<\/div>/.test(src));
    ok(`[${fileName}] ya no queda ningún <div class="debt-amount">...o.amount... en el archivo`, !/<div class="debt-amount">\$\{fmtMoney\(o\.amount\)\}<\/div>/.test(src));
  }
  // Totales de pendiente (previousPendingAmount/currentPendingAmount/
  // futurePendingAmount/pendingTotalAmount/overdueAmount) usan balanceFor,
  // no Number(o.amount||0).
  {
    const fn = extractFunction(src, 'renderServices');
    ok(`[${fileName}] renderServices ya no suma Number(o.amount||0) para ningún total de "pendiente"`, !/\.reduce\(\(a,o\)=>a\+Number\(o\.amount\|\|0\),0\)/.test(fn));
    const balanceForReduceCount = (fn.match(/\.reduce\(\(a,o\)=>a\+balanceFor\(o\),0\)/g) || []).length;
    ok(`[${fileName}] las 5 sumas de pendiente (previa/actual/futura/total/vencida) usan balanceFor(o) (5 ocurrencias reales)`, balanceForReduceCount === 5);
  }

  // Punto 4/15 (texto): loadGroups() limpia el estado del usuario/espacio
  // anterior ANTES de cargar los espacios del usuario actual.
  {
    const fn = extractFunction(src, 'loadGroups');
    ok(`[${fileName}] loadGroups() limpia group=null al inicio (antes de app.innerHTML='<div class="spinner">Cargando tus espacios…</div>')`,
      fn.indexOf('group=null;') >= 0 && fn.indexOf('group=null;') < fn.indexOf(`app.innerHTML='<div class="spinner">Cargando tus espacios…</div>';`));
    for (const stmt of ['membership=null;', 'members=\\[\\];', 'services=\\[\\];', 'obligations=\\[\\];', 'payments=\\[\\];', 'paymentAllocations=\\[\\];', 'contributions=\\[\\];', 'documents=\\[\\];', 'consolidations=\\[\\];']) {
      ok(`[${fileName}] loadGroups() limpia "${stmt.replace(/\\\\/g, '')}"`, new RegExp(stmt).test(fn));
    }
    // Nunca usa localStorage para saldos/pagos.
    // Se revisa el CÓDIGO real (líneas sin comentarios), no el texto
    // completo -- el propio comentario de este ajuste menciona la
    // palabra "localStorage" en prosa explicativa, lo que daría un falso
    // positivo si se buscara sobre el texto crudo.
    const fnCodeOnly = fn.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
    ok(`[${fileName}] loadGroups() no usa localStorage (código real, sin contar comentarios)`, !/localStorage\.(get|set|remove)Item/.test(fnCodeOnly));
  }

  // Punto 3/15: carriedDebts/pendingObligations/isEffectivePending
  // reutilizan balanceFor/paidAmountFor -- ninguna copia divergente del
  // algoritmo (nunca reimplementan la resta a mano).
  {
    const carried = extractFunction(src, 'carriedDebts');
    const pending = extractFunction(src, 'pendingObligations');
    const effective = extractFunction(src, 'isEffectivePending');
    ok(`[${fileName}] carriedDebts() reutiliza pendingObligations() (sin lógica propia de saldo)`, /return pendingObligations\(\)/.test(carried));
    ok(`[${fileName}] pendingObligations() reutiliza isEffectivePending() (sin lógica propia de saldo)`, /\.filter\(isEffectivePending\)/.test(pending));
    ok(`[${fileName}] isEffectivePending() reutiliza balanceFor() (fuente única, nunca duplica la resta amount-pagado)`, /balanceFor\(obligation\)>0\.01/.test(effective));
  }
}

// ============================================================
// PARTE B — Pruebas FUNCIONALES reales (lógica de cálculo, ejecutada
// con las funciones REALES extraídas de index.html).
// ============================================================
const CALC_FUNCTION_NAMES = ['carriedDebts', 'pendingObligations', 'isEffectivePending', 'balanceFor', 'creditBalanceFor', 'paidAmountFor', 'paidAmountForWithAllocations', 'consolidationForSource', 'consolidationsForTarget', 'periodDate'];
function buildCalcRuntime(src) {
  let code = "'use strict';\nlet obligations=[], payments=[], paymentAllocations=[], consolidations=[], baseMonth='2026-08';\n";
  for (const n of CALC_FUNCTION_NAMES) {
    const fn = extractFunction(src, n);
    if (!fn) throw new Error('No se pudo extraer ' + n);
    code += fn + '\n';
  }
  code += `
module.exports = {
  ${CALC_FUNCTION_NAMES.join(', ')},
  setState(next){
    if('obligations' in next) obligations=next.obligations;
    if('payments' in next) payments=next.payments;
    if('paymentAllocations' in next) paymentAllocations=next.paymentAllocations;
    if('consolidations' in next) consolidations=next.consolidations;
    if('baseMonth' in next) baseMonth=next.baseMonth;
  },
};
`;
  return code;
}
const calcPathMain = path.join(__dirname, '_extracted_deudas_calc_main.js');
const calcPathOperator = path.join(__dirname, '_extracted_deudas_calc_operator.js');
fs.writeFileSync(calcPathMain, buildCalcRuntime(srcMain));
fs.writeFileSync(calcPathOperator, buildCalcRuntime(srcOperator));
delete require.cache[require.resolve(calcPathMain)];
delete require.cache[require.resolve(calcPathOperator)];
const CM = require('./_extracted_deudas_calc_main.js');
const CMO = require('./_extracted_deudas_calc_operator.js');

for (const [label, C] of [['index.html', CM], ['index_operator.html', CMO]]) {
  console.log(`\n--- ${label} (funcional, escenario real del pedido) ---`);
  const JUNE_OB = { id: 'ob-june', service_id: 'svc-alquiler', period: '2026-06-01', amount: 900000, due_date: '2026-06-10', status: 'pending' };
  const JULY_OB = { id: 'ob-july', service_id: 'svc-alquiler', period: '2026-07-01', amount: 900000, due_date: '2026-07-10', status: 'pending' };

  C.setState({
    obligations: [JUNE_OB, JULY_OB],
    payments: [
      { id: 'pay-june-legacy', obligation_id: 'ob-june', total_amount: 800000, voided: false },
      { id: 'pay-july-legacy', obligation_id: 'ob-july', total_amount: 400000, voided: false },
      { id: 'pay-distributed', obligation_id: 'ob-july', total_amount: 600000, voided: false },
    ],
    paymentAllocations: [
      { id: 'alloc-june', payment_id: 'pay-distributed', obligation_id: 'ob-june', allocated_amount: 100000, is_active: true },
      { id: 'alloc-july', payment_id: 'pay-distributed', obligation_id: 'ob-july', allocated_amount: 500000, is_active: true },
    ],
    consolidations: [],
    baseMonth: '2026-08',
  });

  // 1/4. Obligación junio $900.000, pago legado $800.000, imputación activa $100.000 -> saldo 0.
  eq(`[${label}] 1/4. paidAmountFor(junio) = $900.000 (legado $800k + imputación activa $100k)`, C.paidAmountFor('ob-june'), 900000);
  eq(`[${label}] 4. balanceFor(junio) = 0`, C.balanceFor(JUNE_OB), 0);
  // 5. Junio no aparece en Deudas arrastradas.
  ok(`[${label}] 5. Junio NO aparece en carriedDebts()`, !C.carriedDebts().some(o => o.id === 'ob-june'));
  // 6/7. Julio $400k legado + $500k imputado = saldo 0; julio no aparece.
  eq(`[${label}] 6. paidAmountFor(julio) = $900.000 (legado $400k + imputación activa $500k)`, C.paidAmountFor('ob-july'), 900000);
  eq(`[${label}] 6. balanceFor(julio) = 0`, C.balanceFor(JULY_OB), 0);
  ok(`[${label}] 7. Julio NO aparece en carriedDebts()`, !C.carriedDebts().some(o => o.id === 'ob-july'));
  eq(`[${label}] 5/7. carriedDebts() queda vacío con este escenario (ni junio ni julio)`, C.carriedDebts().map(o => o.id), []);

  // 8. Obligación $900.000 con solo $700.000 pagados (legado) -> saldo $200.000.
  {
    const AUG_OB = { id: 'ob-agosto', service_id: 'svc-alquiler', period: '2026-05-01', amount: 900000, due_date: '2026-05-10', status: 'pending' };
    C.setState({
      obligations: [AUG_OB],
      payments: [{ id: 'pay-parcial', obligation_id: 'ob-agosto', total_amount: 700000, voided: false }],
      paymentAllocations: [],
    });
    eq(`[${label}] 8. balanceFor($900.000 obligación, $700.000 pagados) = $200.000 (nunca $900.000)`, C.balanceFor(AUG_OB), 200000);
    const carried = C.carriedDebts();
    ok(`[${label}] 8b. Esa obligación SÍ aparece en carriedDebts() (saldo > 0)`, carried.some(o => o.id === 'ob-agosto'));
  }

  // 9. Una imputación inactiva no reduce deuda.
  {
    const OB = { id: 'ob-inactiva', service_id: 'svc-alquiler', period: '2026-05-01', amount: 900000, due_date: '2026-05-10', status: 'pending' };
    C.setState({
      obligations: [OB],
      payments: [],
      paymentAllocations: [{ id: 'alloc-inactiva', payment_id: 'pay-x', obligation_id: 'ob-inactiva', allocated_amount: 900000, is_active: false }],
    });
    eq(`[${label}] 9. Una imputación INACTIVA no reduce el saldo (balance sigue en $900.000)`, C.balanceFor(OB), 900000);
    ok(`[${label}] 9b. Esa obligación aparece en carriedDebts() (la imputación inactiva no la saldó)`, C.carriedDebts().some(o => o.id === 'ob-inactiva'));
  }

  // 10. Un pago anulado no reduce deuda.
  {
    const OB = { id: 'ob-anulado', service_id: 'svc-alquiler', period: '2026-05-01', amount: 900000, due_date: '2026-05-10', status: 'pending' };
    C.setState({
      obligations: [OB],
      payments: [{ id: 'pay-anulado', obligation_id: 'ob-anulado', total_amount: 900000, voided: true }],
      paymentAllocations: [],
    });
    eq(`[${label}] 10. Un pago ANULADO no reduce el saldo (balance sigue en $900.000)`, C.balanceFor(OB), 900000);
    ok(`[${label}] 10b. Esa obligación aparece en carriedDebts() (el pago anulado no la saldó)`, C.carriedDebts().some(o => o.id === 'ob-anulado'));
  }

  // 11. Un pago con imputaciones activas no se cuenta dos veces (ni legado + imputación juntos).
  {
    const OB = { id: 'ob-no-doble', service_id: 'svc-alquiler', period: '2026-05-01', amount: 500000, due_date: '2026-05-10', status: 'pending' };
    C.setState({
      obligations: [OB],
      // El MISMO pago (pay-redistribuido) tiene además una imputación
      // activa hacia esta obligación -- si se contara por legado
      // (obligation_id) Y por imputación a la vez, el saldo pagado
      // quedaría duplicado (400k+400k=800k en vez de 400k).
      payments: [{ id: 'pay-redistribuido', obligation_id: 'ob-no-doble', total_amount: 400000, voided: false }],
      paymentAllocations: [{ id: 'alloc-no-doble', payment_id: 'pay-redistribuido', obligation_id: 'ob-no-doble', allocated_amount: 400000, is_active: true }],
    });
    eq(`[${label}] 11. Un pago con imputación activa se cuenta UNA sola vez (400k, nunca 800k)`, C.paidAmountFor('ob-no-doble'), 400000);
    eq(`[${label}] 11b. Saldo real = $100.000 (500k - 400k, nunca $500k ni $0)`, C.balanceFor(OB), 100000);
  }

  // 12. status='pending' con saldo calculado 0 no genera deuda.
  {
    const OB = { id: 'ob-status-desactualizado', service_id: 'svc-alquiler', period: '2026-05-01', amount: 300000, due_date: '2026-05-10', status: 'pending' };
    C.setState({
      obligations: [OB],
      payments: [{ id: 'pay-completo', obligation_id: 'ob-status-desactualizado', total_amount: 300000, voided: false }],
      paymentAllocations: [],
    });
    ok(`[${label}] 12. status='pending' (persistido, desactualizado) con saldo calculado 0 NO genera deuda`, !C.carriedDebts().some(o => o.id === 'ob-status-desactualizado'));
  }

  // 13. Guido y Fabiana obtienen el mismo cálculo con los mismos datos --
  // las funciones son puras (nunca leen session/rol/usuario), así que con
  // el MISMO estado obligations/payments/paymentAllocations el resultado
  // es idéntico sin importar quién esté "mirando".
  {
    ok(`[${label}] 13. balanceFor/paidAmountFor no dependen de session/rol/usuario (funciones puras sobre obligations/payments/paymentAllocations)`,
      !/session/.test(extractFunction(label === 'index.html' ? srcMain : srcOperator, 'balanceFor')) &&
      !/session/.test(extractFunction(label === 'index.html' ? srcMain : srcOperator, 'paidAmountForWithAllocations')));
  }
}

// ============================================================
// PARTE C — Prueba funcional real del RESET de estado en loadGroups()
// (Punto 4 del pedido: cambio de sesión Guido -> Fabiana).
// ============================================================
const LOADGROUPS_FUNCTION_NAMES = ['loadGroups'];
function buildLoadGroupsRuntime(src) {
  let code = `
'use strict';
let session={user:{id:'user-fabiana'}};
let groups=[], group={id:'group-guido-stale'}, membership={role:'admin'}, members=[{id:'m1'}];
let services=[{id:'s1'}], obligations=[{id:'o1'}], payments=[{id:'p1'}], paymentAllocations=[{id:'pa1'}];
let contributions=[{id:'c1'}], documents=[{id:'d1'}], consolidations=[{id:'k1'}];
let platformPermissions={}, creditCardAccessGranted=false, currentScreen='spaces';
const app={ innerHTML:'' };
async function loadSpacesDashboard(){ /* stub: no toca los globales de arriba */ }
async function loadCreditCardsData(){ /* stub */ }
function renderGroups(){ /* stub */ }
function toast(){}
let sb=null;
`;
  for (const n of LOADGROUPS_FUNCTION_NAMES) {
    const fn = extractFunction(src, n);
    if (!fn) throw new Error('No se pudo extraer ' + n);
    code += fn + '\n';
  }
  code += `
module.exports = {
  loadGroups,
  setState(next){ if('sb' in next) sb=next.sb; },
  getState(){ return { group, membership, members, services, obligations, payments, paymentAllocations, contributions, documents, consolidations }; },
};
`;
  return code;
}
const lgPathMain = path.join(__dirname, '_extracted_deudas_loadgroups_main.js');
const lgPathOperator = path.join(__dirname, '_extracted_deudas_loadgroups_operator.js');
fs.writeFileSync(lgPathMain, buildLoadGroupsRuntime(srcMain));
fs.writeFileSync(lgPathOperator, buildLoadGroupsRuntime(srcOperator));
delete require.cache[require.resolve(lgPathMain)];
delete require.cache[require.resolve(lgPathOperator)];
const LGM = require('./_extracted_deudas_loadgroups_main.js');
const LGO = require('./_extracted_deudas_loadgroups_operator.js');

async function runLoadGroupsCheck() {
  for (const [label, mod] of [['index.html', LGM], ['index_operator.html', LGO]]) {
    console.log(`\n--- ${label} (loadGroups real, cambio de sesión) ---`);
    const fakeSb = {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }),
    };
    mod.setState({ sb: fakeSb });
    await mod.loadGroups();
    const s = mod.getState();
    ok(`[${label}] 4. loadGroups() limpia group (ya no es el group STALE de Guido)`, s.group === null);
    ok(`[${label}] 4. loadGroups() limpia membership`, s.membership === null);
    eq(`[${label}] 4. loadGroups() limpia members`, s.members, []);
    eq(`[${label}] 4. loadGroups() limpia services`, s.services, []);
    eq(`[${label}] 4. loadGroups() limpia obligations (Deudas arrastradas nunca ve las de Guido)`, s.obligations, []);
    eq(`[${label}] 4. loadGroups() limpia payments`, s.payments, []);
    eq(`[${label}] 4. loadGroups() limpia paymentAllocations`, s.paymentAllocations, []);
    eq(`[${label}] 4. loadGroups() limpia contributions`, s.contributions, []);
    eq(`[${label}] 4. loadGroups() limpia documents`, s.documents, []);
    eq(`[${label}] 4. loadGroups() limpia consolidations`, s.consolidations, []);
  }
}

runLoadGroupsCheck().then(() => {
  // ============================================================
  // PARTE D — Paridad (14) y GR/Casa/Tarjetas/RLS sin cambios (15).
  // ============================================================
  console.log('\n--- paridad e impacto fuera de alcance ---');
  const parityFns = ['loadGroups', 'renderServices', 'carriedDebts', 'pendingObligations', 'isEffectivePending', 'balanceFor', 'paidAmountFor', 'paidAmountForWithAllocations'];
  for (const name of parityFns) {
    const a = extractFunction(srcMain, name);
    const b = extractFunction(srcOperator, name);
    ok(`14. Paridad: ${name} existe en ambos archivos y es texto IDÉNTICO`, a != null && b != null && a === b);
  }
  const hasBackup = fs.existsSync(path.join(backupDir, 'index.html')) && fs.existsSync(path.join(backupDir, 'index_operator.html'));
  ok('15. Existe el respaldo fechado tomado antes de esta corrección', hasBackup);
  if (hasBackup) {
    const backupMain = fs.readFileSync(path.join(backupDir, 'index.html'), 'utf8');
    const backupOperator = fs.readFileSync(path.join(backupDir, 'index_operator.html'), 'utf8');
    for (const [label, before, after] of [['index.html', backupMain, srcMain], ['index_operator.html', backupOperator, srcOperator]]) {
      for (const name of ['canEdit', 'isOwner', 'hasOwnerSpaces', 'canAccessTarjetas', 'isCardOwner', 'isCreditCardOwnerById']) {
        const a = extractFunction(before, name);
        const b = extractFunction(after, name);
        ok(`15. [${label}] ${name}() es byte a byte idéntica al respaldo previo a esta corrección (GR/Casa/Tarjetas/RLS sin cambios)`, a != null && b != null && a === b);
      }
    }
  }

  console.log('\n=== TOTAL:', total, 'verificaciones,', failures, failures === 1 ? 'falla' : 'fallas', '===');
  process.exitCode = failures === 0 ? 0 : 1;
});
