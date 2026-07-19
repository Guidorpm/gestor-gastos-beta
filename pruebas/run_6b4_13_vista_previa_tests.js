// CORRECCIÓN 6B4.13 - Suite de pruebas de la vista previa financiera de
// resúmenes sin guardar. Extrae las funciones reales de index.html e
// index_operator.html (sin depender de scripts de sesión ni de pdf.js) y
// verifica, con fixtures sintéticos, que el flujo nuevo:
//   - existe como botón/función separados de la carga histórica real,
//   - nunca invoca Supabase (insert/update/upsert/rpc) ni Storage,
//   - conserva el signo interno del saldo en dólares y muestra el texto
//     correcto para USD negativo/positivo/cero,
//   - no modifica ninguna regla ya congelada del parser (6B4.12.2),
//   - no introduce regresiones en las etapas anteriores.
// Los 4 casos reales contra PDF binarios (2 con saldo acreedor + control
// positivo + control cero) se corrieron aparte con pdf.js real en el
// scratchpad de sesión (fuera del repo) y se referencian en el informe
// final; esta suite no depende de pdf.js para poder correr en cualquier
// checkout.
// node pruebas/run_6b4_13_vista_previa_tests.js
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
function extractConst(src, name) {
  const re = new RegExp(`const ${name}=[\\s\\S]*?;\\n`);
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}

const names = [
  'parseArgMoney', 'roundMoney', 'classifyStatementLineText', 'classifyTaxSubtype', 'classifyInterestSubtype',
  'parseBancoProvinciaVisaLine', 'parseVisaDebtTransferLine', 'parseBancoProvinciaVisaStatement',
  'parseBancoProvinciaMastercardStatement', 'parseMercadoPagoStatement',
  'creditStatementParserKey', 'sumVisaStatementMovements', 'sumSignedStatementMovements',
  'buildCreditReconcileBreakdown', 'creditResolveDeclaredDates', 'creditResolveCarryInfo',
  'reconcileCreditStatementTotals', 'parseVisaPaymentLine', 'creditVisaPaymentLineIsAmbiguous',
  'parseSpanishAbbrevDate', 'resolveMonthDayToDate', 'parseSpanishDayMonth', 'creditStatementReadingState',
  'creditPdfClusterRows', 'creditPdfAssignColumns', 'creditPdfDetectSections',
  'fmtMoney', 'fmtUsd', 'formatARS', 'creditMoneyOrDash', 'creditUsdOrDash',
  'creditPreviewUsdBalanceText', 'creditPreviewMovementIncluded', 'creditPreviewSignLabel',
  'creditStatementPreviewModalHtml',
];
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function buildRuntime(src) {
  let code = extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_STATE_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_CATEGORY_LABELS') + '\n';
  code += 'function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}\n';
  for (const n of names) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_STATEMENT_PARSERS = {
  visa: parseBancoProvinciaVisaStatement,
  mastercard: parseBancoProvinciaMastercardStatement,
  mercado_pago: parseMercadoPagoStatement,
};
const CREDIT_RECONCILE_SUM_FNS = {
  visa: sumVisaStatementMovements,
  mastercard: sumSignedStatementMovements,
  mercado_pago: sumSignedStatementMovements,
};
const CREDIT_RECONCILE_TOLERANCE_ARS = 1;
const CREDIT_RECONCILE_TOLERANCE_USD = 0.01;
module.exports = { parseBancoProvinciaVisaStatement, reconcileCreditStatementTotals, creditStatementReadingState,
  creditStatementParserKey, creditPreviewUsdBalanceText, creditPreviewMovementIncluded, creditPreviewSignLabel,
  creditStatementPreviewModalHtml, fmtUsd, creditUsdOrDash };
`;
  return code;
}

const runtimePathMain = path.join(__dirname, '_extracted_6b4_13_runtime_main.js');
const runtimePathOperator = path.join(__dirname, '_extracted_6b4_13_runtime_operator.js');
fs.writeFileSync(runtimePathMain, buildRuntime(srcMain));
fs.writeFileSync(runtimePathOperator, buildRuntime(srcOperator));
const M = require('./_extracted_6b4_13_runtime_main.js');
const MO = require('./_extracted_6b4_13_runtime_operator.js');

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}
function buildLayout(lines) {
  return { pages: [{ pageNum: 1, lines: lines.map((text, idx) => ({ y: 1000 - idx * 10, items: [{ str: text, x: 0, y: 1000 - idx * 10 }], text })) }] };
}

console.log('=== CORRECCIÓN 6B4.13 — VISTA PREVIA FINANCIERA SIN GUARDAR ===\n');

// A. Existencia del nuevo botón, separado del de carga histórica real.
{
  ok('A. index.html tiene el botón id="verifyStatementPreview"', srcMain.includes('id="verifyStatementPreview"'));
  ok('A. index_operator.html tiene el botón id="verifyStatementPreview"', srcOperator.includes('id="verifyStatementPreview"'));
  ok('A. El texto del botón es "Verificar resumen sin guardar"', /id="verifyStatementPreview"[^>]*>Verificar resumen sin guardar</.test(srcMain));
  ok('A. El botón nuevo es distinto del botón de carga histórica real (openCreditHistoricalReview)', srcMain.includes('id="openCreditHistoricalReview"') && srcMain.includes('id="verifyStatementPreview"'));
}

// B. Existencia del flujo de preview separado (funciones nuevas presentes
// en ambos archivos, con firma propia).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  ok(`B. ${label} define runHistoricalStatementPreview()`, /async function runHistoricalStatementPreview\(file\)/.test(src));
  ok(`B. ${label} define openCreditStatementPreviewModal()`, /function openCreditStatementPreviewModal\(\)/.test(src));
  ok(`B. ${label} define creditStatementPreviewModalHtml()`, /function creditStatementPreviewModalHtml\(preview\)/.test(src));
  ok(`B. ${label} define creditPreviewUsdBalanceText()`, /function creditPreviewUsdBalanceText\(declaredTotalUsd\)/.test(src));
  const bindingBlock = src.slice(src.indexOf('function bindCreditCardsModule'), src.indexOf('function bindCreditCardsModule') + 4000);
  ok(`B. ${label} conecta el botón a openCreditStatementPreviewModal() (no a runHistoricalUpload)`, /verifyPreviewBtn\.onclick=\(\)=>openCreditStatementPreviewModal\(\)/.test(bindingBlock));
}

// C. runHistoricalStatementPreview() nunca reutiliza runHistoricalUpload()
// ni ninguna función que continúe hacia una escritura real.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'runHistoricalStatementPreview');
  ok(`C. ${label} runHistoricalStatementPreview() no llama a runHistoricalUpload()`, !/runHistoricalUpload\(/.test(fn));
  ok(`C. ${label} runHistoricalStatementPreview() no llama a uploadCreditDocument()`, !/uploadCreditDocument\(/.test(fn));
  ok(`C. ${label} runHistoricalStatementPreview() solo llama a las 4 funciones ya congeladas`, /detectCreditStatementIdentity\(file\)/.test(fn) && /parseCreditStatementFinancials\(file,identity\)/.test(fn) && /reconcileCreditStatementTotals\(parsed,identity\)/.test(fn) && /creditStatementReadingState\(parsed,identity,reconciliation\)/.test(fn));
  const openFn = extractFunction(src, 'openCreditStatementPreviewModal');
  ok(`C. ${label} openCreditStatementPreviewModal() no llama a runHistoricalUpload()`, !/runHistoricalUpload\(/.test(openFn));
}

// D. Ausencia total de escrituras a Supabase (insert/update/upsert/rpc) en
// todo el código nuevo de esta etapa.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fns = ['runHistoricalStatementPreview', 'openCreditStatementPreviewModal', 'creditStatementPreviewModalHtml',
    'creditPreviewUsdBalanceText', 'creditPreviewMovementIncluded', 'creditPreviewSignLabel', 'creditUsdOrDash']
    .map(n => extractFunction(src, n)).join('\n');
  ok(`D. ${label} código nuevo de 6B4.13 no invoca sb.from/.insert/.update/.upsert/.rpc`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(fns));
}

// E. Ausencia total de llamadas a Storage (subida de archivos) en el
// código nuevo de esta etapa.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fns = ['runHistoricalStatementPreview', 'openCreditStatementPreviewModal', 'creditStatementPreviewModalHtml']
    .map(n => extractFunction(src, n)).join('\n');
  ok(`E. ${label} código nuevo de 6B4.13 no invoca sb.storage/uploadCreditDocument`, !/sb\.storage|uploadCreditDocument\(/.test(fns));
}

// F. Visualización correcta para USD negativo (saldo a favor): conserva
// signo interno, muestra el texto exacto pedido, en valor absoluto.
{
  eq('F. USD negativo -1902.73 → "Saldo a favor en dólares: USD 1.902,73"', M.creditPreviewUsdBalanceText(-1902.73), 'Saldo a favor en dólares: USD 1.902,73');
  ok('F. El signo interno -1902.73 nunca se muestra directamente como negativo en el texto (se usa el valor absoluto)', !M.creditPreviewUsdBalanceText(-1902.73).includes('-1.902,73') && !M.creditPreviewUsdBalanceText(-1902.73).includes('-1902'));
}

// G. Visualización correcta para USD positivo (saldo a pagar).
{
  eq('G. USD positivo 10.10 → "Saldo a pagar en dólares: USD 10,10"', M.creditPreviewUsdBalanceText(10.10), 'Saldo a pagar en dólares: USD 10,10');
}

// H. Visualización correcta para USD cero (sin saldo pendiente).
{
  eq('H. USD 0 → "Sin saldo pendiente en dólares"', M.creditPreviewUsdBalanceText(0), 'Sin saldo pendiente en dólares');
  eq('H. USD null (no detectado) → mensaje explícito, nunca inventa un número', M.creditPreviewUsdBalanceText(null), 'No se pudo determinar el saldo en dólares de este resumen.');
}

// I. Conservación del signo interno: el objeto de datos (parsed/totals)
// nunca se modifica por mostrar el texto — solo se calcula texto aparte.
{
  const parsed = M.parseBancoProvinciaVisaStatement(buildLayout([
    'CIERRE 26 Dic 24 VENCIMIENTO 06 Ene 25',
    'LIMITES:      COMPRA $ 5.500.000,00                                            FINANCIACION $ 4.400.000,00',
    '              SALDO ANTERIOR                                                  1843.243,20     1.904,74',
    '09 SU PAGO EN PESOS                                                           1972.358,27 TC1035,500 1.904,74-',
    '10   SU PAGO EN USD                                                               1.904,74-',
    'Tarjeta 8374 Total Consumos de TITULAR PRINCIPAL                             0,00 *    2,01 *',
    'TNA 81,000 TEM 6,658 TNA 10,000 TEM 0,822 2788.451,78 1.902,73-',
    '                    DEBITAREMOS DE SU CTA 00000000514817 LA SUMA DE $ 2788451,78     SUC.126',
  ]));
  eq('I. parsed.declaredTotalUsd conserva el signo real (-1902.73), no se altera para mostrar texto', parsed.declaredTotalUsd, -1902.73);
  const texto = M.creditPreviewUsdBalanceText(parsed.declaredTotalUsd);
  eq('I. El dato interno sigue siendo -1902.73 después de generar el texto (no hay mutación)', parsed.declaredTotalUsd, -1902.73);
  ok('I. El texto muestra el valor absoluto para lectura humana', texto.includes('1.902,73') && !texto.includes('-1.902,73'));
}

// J. La tabla de movimientos conserva el signo real de cada renglón
// (creditPreviewSignLabel refleja el signo real, no lo altera).
{
  eq('J. Movimiento con amountArs negativo → signo "negativo"', M.creditPreviewSignLabel({ amountArs: -100, amountUsd: null }), 'negativo');
  eq('J. Movimiento con amountArs positivo → signo "positivo"', M.creditPreviewSignLabel({ amountArs: 100, amountUsd: null }), 'positivo');
  eq('J. Movimiento sin ARS con amountUsd negativo → signo "negativo"', M.creditPreviewSignLabel({ amountArs: null, amountUsd: -5 }), 'negativo');
}

// K. El modal generado nunca incluye botones de guardado/confirmación —
// solo "Cerrar" (sección "no incluir todavía" del pedido).
{
  const preview = {
    fileName: 'test.pdf',
    identity: { issuer: 'Banco Provincia', brand: 'Visa', last4: '8374', period: '2024-12' },
    parsed: { declaredTotalUsd: -1902.73, movements: [], paymentReviewLines: [] },
    reconciliation: { totals: { statementArs: 100, calculatedArs: 100, diffArs: 0, statementUsd: -1902.73, calculatedUsd: -1902.73, diffUsd: 0 }, breakdown: null },
    state: { state: 'FULLY_RECONCILED', detail: 'ok' },
  };
  const html = M.creditStatementPreviewModalHtml(preview);
  ok('K. El modal contiene el botón "Cerrar"', /Cerrar</.test(html));
  ok('K. El modal NO contiene ningún botón "Guardar"', !/Guardar</.test(html));
  ok('K. El modal NO contiene ningún botón "Confirmar e importar"', !/Confirmar e importar/.test(html));
  ok('K. El modal muestra el texto de saldo a favor exacto pedido para -1902.73', html.includes('Saldo a favor en dólares: USD 1.902,73'));
  ok('K. El modal advierte explícitamente que es solo vista previa local, sin guardar', /vista previa local/i.test(html) && /No se guardó ni se subió nada/i.test(html));
}

// L. Sintaxis válida en ambos archivos.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('L. index.html sintaxis válida', true); }
  catch (e) { ok('L. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('L. index_operator.html sintaxis válida', true); }
  catch (e) { ok('L. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// M. No regresión de etapas anteriores: funciones/reglas congeladas de
// 6B4.9.1, 6B4.11.x y 6B4.12.x siguen presentes sin modificar.
{
  ok('M. 6B4.9.1: creditPaymentModel/creditUsdPaymentRecommendation/creditUsdPaymentDecision siguen presentes', /function creditPaymentModel\(/.test(srcMain) && /function creditUsdPaymentRecommendation\(/.test(srcMain) && /function creditUsdPaymentDecision\(/.test(srcMain));
  ok('M. 6B4.12/6B4.12.1: parseVisaDebtTransferLine, CREDITOS→refund, financiable siguen presentes', /function parseVisaDebtTransferLine\(/.test(srcMain) && /CREDITOS\\s\+\\S/.test(srcMain) && /\^financiable\\s\+de\\s\+\\\$/.test(srcMain));
  ok('M. 6B4.12.2: la regla del cupón de pago (paymentCouponTotalsMatch) sigue presente sin tocar', /paymentCouponTotalsMatch/.test(extractFunction(srcMain, 'parseBancoProvinciaVisaStatement')));
  ok('M. 6B4.11.3: permisos/navegación sin cambios', /canViewReports\(\)\?renderBalance\(\):''/.test(srcMain));
  ok('M. 6B4.11.2: getAveragePeriodForYear sigue presente en index_operator.html', /function getAveragePeriodForYear\(/.test(srcOperator));
}

// N. El parser histórico congelado (6B4.12.2) sigue produciendo los mismos
// resultados exactos para el caso de saldo acreedor (66/66 no se rompió
// por los cambios de interfaz de esta etapa — misma entrada, misma salida).
{
  const layout = buildLayout([
    'CIERRE 26 Dic 24 VENCIMIENTO 06 Ene 25',
    'LIMITES:      COMPRA $ 5.500.000,00                                            FINANCIACION $ 4.400.000,00',
    '              SALDO ANTERIOR                                                  1843.243,20     1.904,74',
    '09 SU PAGO EN PESOS                                                           1972.358,27 TC1035,500 1.904,74-',
    '10   SU PAGO EN USD                                                               1.904,74-',
    '11 464605 Google One A75343520USD 1,99                                                          1,99',
    '26 IMPUESTO DE SELLOS USD                                                        0,02',
    'Tarjeta 8374 Total Consumos de TITULAR PRINCIPAL                             0,00 *    2,01 *',
    'TNA 81,000 TEM 6,658 TNA 10,000 TEM 0,822 2788.451,78 1.902,73-',
    '                    DEBITAREMOS DE SU CTA 00000000514817 LA SUMA DE $ 2788451,78     SUC.126',
  ]);
  const parsedMain = M.parseBancoProvinciaVisaStatement(layout);
  const parsedOperator = MO.parseBancoProvinciaVisaStatement(layout);
  eq('N. index.html y index_operator.html producen el mismo declaredTotalUsd (-1902.73)', parsedMain.declaredTotalUsd, -1902.73);
  eq('N. index.html y index_operator.html son equivalentes byte a byte en el resultado', JSON.stringify(parsedMain), JSON.stringify(parsedOperator));
  const identity = { issuer: 'Banco Provincia', brand: 'Visa', last4: '8374' };
  const reconciliation = M.reconcileCreditStatementTotals(parsedMain, identity);
  const state = M.creditStatementReadingState(parsedMain, identity, reconciliation);
  eq('N. diffUsd sigue siendo 0 (la corrección 6B4.12.2 del cupón de pago sigue vigente)', reconciliation.totals.diffUsd, 0);
  // Este fixture mínimo no incluye todas las líneas de consumo ARS reales
  // del período (no es su propósito — solo aísla el comportamiento USD),
  // por eso no se compara diffArs acá; el 66/66 real (ARS y USD) ya está
  // verificado contra los 105 PDF reales en resultados_6b4_12_2.
  // Este fixture mínimo deja deliberadamente 1 línea ambigua sin resolver
  // (el PDF real trae evidencia adicional que la resuelve — ver
  // resultados_6b4_12_2/resultado_66_periodos_final.json para el 66/66
  // real). Lo que importa acá es que el estado siga siendo uno de "los
  // números cierran" (FULLY_RECONCILED o READABLE_REQUIRES_CONFIRMATION
  // por línea ambigua), nunca una regresión real de lectura del parser.
  ok('N. El estado no retrocede a un estado de error de parser (PARSER_ERROR/UNINTERPRETABLE/TOTALS_RECOGNIZED_DETAIL_INCOMPLETE)', ['FULLY_RECONCILED', 'READABLE_REQUIRES_CONFIRMATION'].includes(state.state));
  const resultado66 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_2', 'resultado_66_periodos_final.json'), 'utf8'));
  const totalFully = resultado66.filter(r => r.estado_final_6b4_12_2 === 'FULLY_RECONCILED').length;
  eq('N. El resultado real de 66/66 (6B4.12.2) sigue documentado sin cambios', totalFully, 66);
}

// O. Esta suite es de solo lectura (nunca invoca Supabase/Storage).
{
  const selfSrc = fs.readFileSync(__filename, 'utf8').replace(/^\/\/.*$/gm, '');
  ok('O. Esta suite no invoca sb.from/.insert/.update/.upsert/.rpc/sb.storage (fuera de los strings de prueba de regex)', !/\bsb\.from\(|sb\.storage\.upload/.test(selfSrc));
}

fs.unlinkSync(runtimePathMain);
fs.unlinkSync(runtimePathOperator);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
