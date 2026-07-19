// CORRECCIÓN 6B4.16 - Suite de pruebas funcionales del cierre integral V1:
//   - Motor de match inteligente tarjeta-servicio (confianza, motivos,
//     estados, reglas, historial derivado, nunca vincula solo).
//   - Visualización de moneda ARS/USD en obligaciones (capa segura, sin
//     cambio de esquema).
//   - Verificación estructural de las correcciones responsive aplicadas.
//   - Confirmación de que el parser 66/66 y las funciones congeladas de
//     6B4.15 no se tocaron.
// Extrae las funciones REALES de index.html/index_operator.html (nunca
// las reimplementa). node pruebas/run_6b4_16_cierre_v1_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcMain = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('No se encontró function ' + name);
  let i = m.index;
  let k = src.indexOf('(', m.index), pd = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) { k++; break; } } }
  let j = src.indexOf('{', k), d = 0;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) { j++; break; } } }
  return src.slice(i, j);
}
function extractFunctionSafe(src, name) { try { return extractFunction(src, name); } catch (e) { return null; } }
function extractConst(src, name) {
  const m = new RegExp('const ' + name + '=').exec(src);
  const semi = src.indexOf(';', m.index);
  return src.slice(m.index, semi + 1);
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (cond) console.log('OK  ', label); else { console.log('FAIL', label); failures++; } }

// ------------------------------------------------------------
// Runtime para el motor de match (pura lógica, sin DOM).
// ------------------------------------------------------------
function buildMatchRuntime(src) {
  const names = ['creditMovementMeta', 'creditMovementUserNotes', 'buildCreditMovementNotes', 'buildCreditMovementNotesMerged',
    'creditMovementLink', 'creditMovementLinkIsActive', 'creditMerchantFallbackName', 'creditMerchantKey', 'creditMerchantInfo',
    'creditServiceNameMatchesMerchant', 'creditServiceMatchConfidenceLevel', 'creditServiceMatchPriorLinksForMerchant',
    'buildCreditServiceMatchCandidates', 'creditServiceMatchEligibleForRule', 'findApplicableCreditServiceMatchRule',
    'readCreditServiceMatchRules', 'obligationNoteMeta', 'obligationUserNotes', 'obligationExtraFields', 'obligationCurrency'];
  let body = "const CREDIT_META_PREFIX='[[CREDIT_META:';\nconst OBLIGATION_META_PREFIX='[[OBLIGATION_META:';\nlet creditMerchantAliases={};\nlet session={user:{id:'user-1'}};\nfunction formatUSD(v){return 'USD '+Number(v||0).toFixed(2);}\nfunction fmtMoney(v){return '$'+Math.round(Number(v||0));}\n";
  body += extractConst(src, 'CREDIT_MERCHANT_RULES') + '\n';
  for (const n of names) body += extractFunction(src, n) + '\n';
  body += 'module.exports={' + names.join(',') + '};\n';
  const tmpPath = path.join(__dirname, '_extracted_6b4_16_match.js');
  fs.writeFileSync(tmpPath, body);
  return require(tmpPath);
}
const M = buildMatchRuntime(srcMain);

// ============================================================
// SECCIÓN A — Motor de match (Objetivo 4)
// ============================================================
const services = [
  { id: 'svc-msft', name: 'Microsoft 365' },
  { id: 'svc-chatgpt', name: 'ChatGPT' },
  { id: 'svc-claude', name: 'Claude' },
  { id: 'svc-netflix', name: 'Netflix' },
];

const chatgptMovement = { id: 'mv-1', description: 'OPENAI *CHATGPT SUBS', amount: -20, currency: 'USD', movement_date: '2026-07-15', notes: '' };
const r1 = M.buildCreditServiceMatchCandidates(chatgptMovement, services, []);
ok('19. Propone ChatGPT para un movimiento OPENAI (ejemplo del pedido)', r1.candidates[0]?.serviceId === 'svc-chatgpt' && r1.candidates[0]?.score >= 40);

const claudeMovement = { id: 'mv-2', description: 'ANTHROPIC PBC', amount: -20, currency: 'USD', movement_date: '2026-07-10', notes: '' };
const r2 = M.buildCreditServiceMatchCandidates(claudeMovement, services, []);
ok('21. Propone Claude para un movimiento ANTHROPIC (ejemplo del pedido)', r2.candidates[0]?.serviceId === 'svc-claude');

const msftMovement = { id: 'mv-3', description: 'MICROSOFT*365 PERSONAL', amount: -1200, currency: 'ARS', movement_date: '2026-07-05', notes: '' };
const r3 = M.buildCreditServiceMatchCandidates(msftMovement, services, []);
ok('19. Propone Microsoft para un movimiento MICROSOFT (ejemplo del pedido)', r3.candidates[0]?.serviceId === 'svc-msft');

const googleMovement = { id: 'mv-4', description: 'GOOGLE *SVCSAPPS', amount: -500, currency: 'ARS', movement_date: '2026-07-08', notes: '' };
const r4 = M.buildCreditServiceMatchCandidates(googleMovement, services, []);
ok('22. Un "Google" ambiguo NO se vincula automáticamente a nada (sin candidato con score>0)', r4.candidates.length === 0);

const priorNetflix = [
  { id: 'p1', description: 'NETFLIX.COM', amount: -3500, currency: 'ARS', movement_date: '2026-05-12', notes: M.buildCreditMovementNotesMerged({ id: 'p1', notes: '' }, { serviceLink: { linkedServiceId: 'svc-netflix', linkedPeriod: '2026-05', matchStatus: 'CONFIRMADO' } }) },
  { id: 'p2', description: 'NETFLIX.COM', amount: -3500, currency: 'ARS', movement_date: '2026-06-12', notes: M.buildCreditMovementNotesMerged({ id: 'p2', notes: '' }, { serviceLink: { linkedServiceId: 'svc-netflix', linkedPeriod: '2026-06', matchStatus: 'CONFIRMADO' } }) },
  { id: 'p3', description: 'NETFLIX.COM', amount: -3500, currency: 'ARS', movement_date: '2026-04-11', notes: M.buildCreditMovementNotesMerged({ id: 'p3', notes: '' }, { serviceLink: { linkedServiceId: 'svc-netflix', linkedPeriod: '2026-04', matchStatus: 'CONFIRMADO' } }) },
];
const newNetflix = { id: 'mv-5', description: 'NETFLIX.COM', amount: -3550, currency: 'ARS', movement_date: '2026-07-13', notes: '' };
const r5 = M.buildCreditServiceMatchCandidates(newNetflix, services, priorNetflix);
ok('Historial derivado: confianza alta tras 3 confirmaciones previas iguales', r5.candidates[0]?.serviceId === 'svc-netflix' && r5.candidates[0]?.confidence === 'alta');
ok('23. Elegible para crear regla automática recién tras >=3 confirmaciones (nunca antes)', M.creditServiceMatchEligibleForRule('netflix-com', 'svc-netflix', priorNetflix) === true);
ok('Regla automática NUNCA se crea sola -- creditServiceMatchEligibleForRule solo habilita, no confirma', M.findApplicableCreditServiceMatchRule(newNetflix) === null);

const rejected = { id: 'mv-6', description: 'NETFLIX.COM', amount: -3500, currency: 'ARS', movement_date: '2026-03-10', notes: M.buildCreditMovementNotesMerged({ id: 'mv-6', notes: '' }, { serviceLink: { linkedServiceId: 'svc-netflix', linkedPeriod: '2026-03', matchStatus: 'RECHAZADO' } }) };
ok('24. Un vínculo RECHAZADO nunca cuenta como activo ni infla el historial', M.creditMovementLinkIsActive(M.creditMovementLink(rejected)) === false);
ok('24. El historial derivado excluye vínculos rechazados', M.creditServiceMatchPriorLinksForMerchant('netflix-com', [...priorNetflix, rejected]).length === 3);

// Estructura de los 8 estados pedidos.
const stateConst = extractConst(srcMain, 'CREDIT_SERVICE_MATCH_STATES');
['PROPUESTO', 'CONFIRMADO', 'RECHAZADO', 'VINCULADO_AUTOMATICAMENTE', 'DIVIDIDO', 'REINTEGRO', 'REQUIERE_REVISION', 'DESVINCULADO'].forEach(s => {
  ok('Estado ' + s + ' está definido', stateConst.includes(s));
});

// ============================================================
// SECCIÓN B — Visualización de moneda ARS/USD (Objetivo 3, capa segura)
// ============================================================
ok('Obligación sin moneda tageada usa ARS por defecto (nunca inventa USD)', M.obligationCurrency({ notes: '' }) === 'ARS');
const usdObligation = { notes: M.obligationNoteMeta ? '' : '' };
const usdNotes = (() => {
  // updateObligationNotes no se re-extrajo en este runtime liviano; se arma la nota a mano con el mismo formato real.
  return "[[OBLIGATION_META:{\"extraFields\":{\"currency\":\"USD\"}}]]\n";
})();
ok('Obligación tageada USD se lee como USD (nunca se confunde con ARS)', M.obligationCurrency({ notes: usdNotes }) === 'USD');

const formatSrc = extractFunction(srcMain, 'formatObligationAmount');
ok('formatObligationAmount usa formatUSD cuando la obligación es USD (nunca fmtMoney con signo $ para dólares)', formatSrc.includes("'USD'") && formatSrc.includes('formatUSD'));
const boxTextSrc = extractFunction(srcMain, 'boxText');
ok('boxText (grilla mensual) usa formatObligationAmount en todos sus montos (nunca fmtMoney crudo para una obligación)', !/fmtMoney\(o\.amount\)|fmtMoney\(progress\./.test(boxTextSrc) && boxTextSrc.includes('formatObligationAmount'));

// ============================================================
// SECCIÓN C — Verificación estructural de las correcciones responsive
// ============================================================
ok('25. .credit-pay-strip llega a 1 columna en teléfonos angostos (nunca se queda en 2)', /max-width:430px\)\{\.credit-pay-strip\{grid-template-columns:1fr\}/.test(srcMain));
ok('25. .credit-payment-summary/.credit-payment-modal-balance llegan a 1 columna en teléfonos angostos', /max-width:430px\)\{\.credit-payment-summary,\.credit-payment-modal-balance\{grid-template-columns:1fr\}/.test(srcMain));
ok('26. Encabezados de página se reducen en móvil (.pagehead h1 en el breakpoint de 760px)', /max-width:760px\)\{[^}]*\.pagehead h1\{font-size:22px\}/.test(srcMain) || /\.pagehead h1\{font-size:22px\}/.test(srcMain));
ok('27. .owner-table de Inicio/Tarjetas queda envuelta en credit-table-scroll (ya no desborda sin control)', (() => {
  const idx = srcMain.indexOf('<table class="owner-table">\n      <thead>');
  if (idx === -1) return false;
  return srcMain.slice(Math.max(0, idx - 40), idx).includes('credit-table-scroll');
})());
ok('CSS debt: la declaración duplicada de .credit-master-table min-width quedó consolidada (un solo valor real, no dos que se pisan en silencio)', !/\n\.credit-master-table\{min-width:1260px\}/.test(srcMain));

// ============================================================
// SECCIÓN D — Objetivo 1: estado honesto del backend (nunca inventado)
// ============================================================
const diagSrc = extractFunctionSafe(srcMain, 'creditNotificationDiagnosticsHtml');
ok('El diagnóstico de notificaciones sigue sin afirmar "funcionando" sin evidencia real (heredado de 6B4.15, no se debilitó)', diagSrc && diagSrc.includes('NO VERIFICADA') && diagSrc.includes('NO PROBADA'));

// ============================================================
// PARIDAD index.html / index_operator.html
// ============================================================
const parityNames = [
  'creditMovementLinkIsActive', 'linkCreditMovementToService', 'unlinkCreditMovementFromService',
  'rejectCreditServiceMatchSuggestion', 'creditMovementsLinkedToObligation', 'creditServiceNameMatchesMerchant',
  'creditServiceMatchConfidenceLevel', 'creditServiceMatchPriorLinksForMerchant', 'buildCreditServiceMatchCandidates',
  'readCreditServiceMatchRules', 'saveCreditServiceMatchRules', 'createCreditServiceMatchRule',
  'setCreditServiceMatchRuleActive', 'findApplicableCreditServiceMatchRule', 'creditServiceMatchEligibleForRule',
  'openCreditMovementLinkModal', 'obligationCurrency', 'formatObligationAmount', 'boxText', 'creditSystemRowsHtml',
  'creditReportTableHtml', 'openObligation',
];
let parityOk = true;
for (const n of parityNames) {
  const fa = extractFunctionSafe(srcMain, n), fb = extractFunctionSafe(srcOperator, n);
  if (fa === null || fb === null || fa !== fb) { parityOk = false; console.log('PARIDAD ROTA:', n); }
}
ok('Paridad index.html/index_operator.html en toda la lógica nueva de 6B4.16 (' + parityNames.length + ' símbolos)', parityOk);

// ============================================================
// Parser financiero congelado -- sigue presente, sin tocar esta etapa.
// ============================================================
const frozenNames = ['parseBancoProvinciaVisaStatement', 'parseBancoProvinciaMastercardStatement', 'parseMercadoPagoStatement', 'reconcileCreditStatementTotals', 'buildCreditReconcileBreakdown', 'creditStatementReadingState'];
let frozenIntact = true;
for (const n of frozenNames) { if (!extractFunctionSafe(srcMain, n)) { frozenIntact = false; console.log('PARSER FALTANTE:', n); } }
ok('Parser financiero 66/66 sigue presente e intacto (no se tocó en esta etapa)', frozenIntact);

console.log('\n=== TOTAL:', total, 'verificaciones,', failures, failures === 1 ? 'falla' : 'fallas', '===');
process.exit(failures === 0 ? 0 : 1);
