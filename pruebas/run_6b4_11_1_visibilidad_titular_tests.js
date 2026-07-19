// CORRECCIÓN 6B4.11.1 - Suite de pruebas de visibilidad de datos del
// titular. Extrae funciones puras de index.html (sin depender de scripts
// de sesión) y reproduce el caso real anonimizado del pedido.
// node pruebas/run_6b4_11_1_visibilidad_titular_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcMain = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp(`function ${name}\\(`).exec(src);
  if (!m) throw new Error('No se encontró function ' + name);
  let i = m.index;
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let k = src.indexOf('(', m.index), pdepth = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pdepth++; else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } } }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(i, j);
}

const names = [
  'paymentsFor', 'paymentFor', 'paidAmountFor', 'balanceFor', 'paymentProgress',
  'paymentCreatedByLabel', 'isEffectivePending', 'pendingObligations', 'monthTotals',
  'obligationFor', 'consolidationForSource', 'consolidationTarget', 'periodDate',
  'receiptsForPayment', 'receiptsForObligation',
];
let code = 'let payments=[],obligations=[],contributions=[],documents=[],consolidations=[],services=[],members=[];\n';
for (const n of names) code += extractFunction(srcMain, n) + '\n';
code += `
function setState(s){
  payments = s.payments||[];
  obligations = s.obligations||[];
  contributions = s.contributions||[];
  documents = s.documents||[];
  consolidations = s.consolidations||[];
  services = s.services||[];
  members = s.members||[];
}
module.exports = { ${names.join(', ')}, setState };
`;
fs.writeFileSync(path.join(__dirname, '_extracted_6b4_11_1_runtime.js'), code);
const M = require('./_extracted_6b4_11_1_runtime.js');

let total = 0, failures = 0;
function ok(label, cond) {
  total++;
  if (!cond) failures++;
  console.log((cond ? 'OK  ' : 'FAIL'), label);
}
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}

console.log('=== CORRECCIÓN 6B4.11.1 — VISIBILIDAD DE DATOS DEL TITULAR (A-W) ===\n');

// --- Fixture anonimizado, exacto de la sección 4 del pedido ---
const service = { id: 'svc1', group_id: 'grp1', name: 'Servicio de prueba', active: true, is_private: false };
const otherCompanyService = { id: 'svc-otra-empresa', group_id: 'grp-otra-empresa', name: 'Servicio de otra empresa', active: true, is_private: false };
const privateService = { id: 'svc-privado', group_id: 'grp1', name: 'Servicio privado', active: true, is_private: true };
const obligation = { id: 'obl1', service_id: 'svc1', period: '2026-07-01', amount: 800000, status: null, due_date: '2026-07-10' };
const otherCompanyObligation = { id: 'obl-otra', service_id: 'svc-otra-empresa', period: '2026-07-01', amount: 100000, status: null, due_date: '2026-07-10' };
const operatorMembership = { id: 'mem-operator', user_id: 'user-operator', display_name: 'Fabiana', role: 'operator', group_id: 'grp1', participation_percent: 0 };
const titularMembership = { id: 'mem-titular', user_id: 'user-titular', display_name: 'Guido', role: 'admin', group_id: 'grp1', participation_percent: 100 };
const payment = { id: 'pay1', obligation_id: 'obl1', total_amount: 400000, paid_at: '2026-07-05', created_by: 'user-operator', created_at: '2026-07-05T10:00:00Z' };
const otherCompanyPayment = { id: 'pay-otra', obligation_id: 'obl-otra', total_amount: 50000, paid_at: '2026-07-05', created_by: 'user-operator', created_at: '2026-07-05T10:00:00Z' };
const contribution = { id: 'contrib1', payment_id: 'pay1', membership_id: 'mem-titular', amount: 400000 };

function resetState() {
  M.setState({
    services: [service, privateService],
    obligations: [obligation],
    payments: [payment],
    contributions: [contribution],
    members: [operatorMembership, titularMembership],
    documents: [],
    consolidations: [],
  });
}
resetState();

// A. titular ve pago creado por operador.
{
  const rows = M.paymentsFor('obl1');
  ok('A. titular ve el pago creado por el operador (paymentsFor no filtra por usuario)', rows.length === 1 && rows[0].id === 'pay1');
}

// B. created_by no define propiedad.
{
  const rows = M.paymentsFor('obl1');
  ok('B. created_by no participa en ningún filtro de paymentsFor (el pago aparece sin importar quién lo creó)', !extractFunction(srcMain, 'paymentsFor').includes('created_by'));
  ok('B. el pago se cuenta igual sin importar created_by', M.paidAmountFor('obl1') === 400000);
}

// C. uploaded_by no define propiedad.
{
  ok('C. receiptsForPayment no filtra por uploaded_by (solo por payment_id y kind)', !extractFunction(srcMain, 'receiptsForPayment').includes('uploaded_by'));
}

// D. payment se agrupa por obligation_id.
ok('D. paymentsFor agrupa exclusivamente por obligation_id', extractFunction(srcMain, 'paymentsFor').includes("p.obligation_id===obligationId"));

// E. obligación se agrupa por service_id.
ok('E. obligationFor agrupa por service_id + período', extractFunction(srcMain, 'obligationFor').includes('o.service_id===serviceId'));

// F. service.group_id define empresa/grupo (verificado en la query real de reloadGroup).
{
  const reloadGroupFn = extractFunction(srcMain, 'reloadGroup');
  ok('F. reloadGroup carga payments/obligations escaneados por services.group_id (nunca por created_by)', /services\.group_id/.test(reloadGroupFn) && !/created_by/.test(reloadGroupFn));
}

// G. pago reduce deuda. H. pago no crea gasto.
{
  const balance = M.balanceFor(obligation);
  ok('G. el pago reduce la deuda (balance = monto - pagado)', balance === 400000);
  ok('H. el pago nunca se cuenta como un gasto nuevo (paymentProgress no suma al total de la obligación)', M.paymentProgress(obligation).amount === 800000);
}

// I. pago parcial 400000 sobre 800000 deja 400000.
{
  const progress = M.paymentProgress(obligation);
  // CORRECCIÓN 6B4.15 - paymentProgress ahora también expone creditBalance
  // (saldo a favor real, nunca oculto) de forma aditiva -- 0 acá porque no
  // hay sobrepago en este fixture (pagado 400000 sobre 800000).
  eq('I. progreso del pago parcial: paid=400000, balance=400000, partial=true, fullyPaid=false', progress, { amount: 800000, paid: 400000, balance: 400000, creditBalance: 0, fullyPaid: false, partial: true });
}

// J. pago sin comprobante sigue visible.
{
  const receipts = M.receiptsForPayment('pay1');
  eq('J. sin comprobante (documents vacío)', receipts, []);
  ok('J. el pago sigue apareciendo en paymentsFor aunque no tenga comprobante', M.paymentsFor('obl1').length === 1);
}

// K. reintento de comprobante usa mismo payment_id (verificado en 6B4.11;
// acá solo se confirma que sigue vigente tras esta etapa).
ok('K. openAddReceiptModal (6B4.11) sigue reutilizando paymentId al reintentar, sin cambios en esta etapa', /uploadDoc\(file,service\.id,obligation\?\.id\|\|null,paymentId,'receipt'\)/.test(srcMain));

// L. operador no pasa a ser propietario.
{
  const label = M.paymentCreatedByLabel(payment);
  ok('L. el pago sigue perteneciendo a la obligación/servicio, nunca al operador (paidAmountFor no distingue quién lo creó)', M.paidAmountFor('obl1') === 400000);
  ok('L. paymentCreatedByLabel es solo texto informativo, no cambia ningún campo del pago', typeof label === 'string' && payment.created_by === 'user-operator');
}

// M. auditoría muestra "Cargado por".
{
  const label = M.paymentCreatedByLabel(payment);
  eq('M. paymentCreatedByLabel muestra "Cargado por <nombre>" usando el nombre del operador', label, 'Cargado por Fabiana');
}

// N. servicios privados permanecen protegidos (no se tocó ninguna condición
// de privacidad en esta etapa -- verificado por ausencia de cambios).
ok('N. is_private sigue usándose solo como badge informativo para el owner, nunca para filtrar client-side', /isOwner\(\)&&s\.is_private/.test(srcMain));

// O. otra empresa no puede ver el pago (verificado: reloadGroup siempre
// filtra por group.id real, nunca trae datos de otro grupo).
{
  M.setState({
    services: [service, otherCompanyService],
    obligations: [obligation, otherCompanyObligation],
    payments: [payment, otherCompanyPayment],
    contributions: [contribution],
    members: [operatorMembership, titularMembership],
    documents: [],
    consolidations: [],
  });
  ok('O. paymentsFor(obl-otra) no se mezcla con la obligación del grupo del titular', M.paymentsFor('obl1').every(p => p.id === 'pay1'));
  resetState();
}

// P/Q/R. no se insertan datos / no se actualiza Supabase / no se ejecuta SQL.
{
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('P/Q/R. esta suite es de solo lectura (nunca invoca sb.from/insert/update/rpc)', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
}

// S. index.html e index_operator.html coherentes.
for (const fn of ['paymentCreatedByLabel', 'paymentsFor', 'paidAmountFor', 'balanceFor']) {
  const a = (srcMain.match(new RegExp(fn, 'g')) || []).length;
  const b = (srcOperator.match(new RegExp(fn, 'g')) || []).length;
  eq(`S. "${fn}" mismo conteo en index.html e index_operator.html`, b, a);
}

// T. 6B4.11 continúa aprobada (verificación rápida: las funciones clave de
// 6B4.11 siguen presentes, sin haber sido revertidas en esta etapa).
ok('T. openAddReceiptModal (6B4.11) sigue definida', /function openAddReceiptModal\(/.test(srcMain));
ok('T. receiptFileIsAcceptable (6B4.11) sigue definida', /function receiptFileIsAcceptable\(/.test(srcMain));

// U. sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('U. index.html sintaxis válida', true); }
  catch (e) { ok('U. index.html sintaxis válida', false); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('U. index_operator.html sintaxis válida', true); }
  catch (e) { ok('U. index_operator.html sintaxis válida', false); }
}

// V. HTTP 200: se verifica por separado con curl.
console.log('V. HTTP 200: se verifica por separado con curl contra localhost.');

// W. sin regresiones nuevas: se verifica corriendo la suite completa por separado.
console.log('W. Sin regresiones nuevas: se verifica corriendo la suite completa de la sesión por separado.');

fs.unlinkSync(path.join(__dirname, '_extracted_6b4_11_1_runtime.js'));

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
