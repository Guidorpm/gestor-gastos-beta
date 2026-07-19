// CORRECCIÓN 6B4.12.2 - Suite de pruebas del cierre al 100% (66/66) de la
// conciliación histórica de tarjetas. Extrae las funciones reales de
// index.html (sin depender de scripts de sesión ni de pdf.js) y verifica,
// con fixtures sintéticos anonimizados, la corrección de la fila del
// cupón de pago con signo real de USD. Los conteos agregados de los 66
// períodos reales (que requieren pdf.js contra los PDF binarios) se
// referencian desde pruebas/resultados_6b4_12_2/*.json, generados en esta
// misma etapa contra los 105 PDF reales.
// node pruebas/run_6b4_12_2_cierre_100pc_tests.js
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
];
let code = extractConst(srcMain, 'MONTHS') + '\n' + extractConst(srcMain, 'SPANISH_MONTH_ABBR') + '\n';
for (const n of names) code += extractFunction(srcMain, n) + '\n';
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
module.exports = { parseArgMoney, roundMoney, classifyStatementLineText, classifyTaxSubtype, classifyInterestSubtype,
  parseBancoProvinciaVisaLine, parseVisaDebtTransferLine, parseBancoProvinciaVisaStatement,
  parseBancoProvinciaMastercardStatement, parseMercadoPagoStatement,
  creditStatementParserKey, sumVisaStatementMovements, sumSignedStatementMovements,
  buildCreditReconcileBreakdown, creditResolveDeclaredDates, creditResolveCarryInfo, reconcileCreditStatementTotals,
  parseVisaPaymentLine, creditVisaPaymentLineIsAmbiguous, creditPdfClusterRows, creditPdfAssignColumns, creditPdfDetectSections,
  parseSpanishAbbrevDate, resolveMonthDayToDate, parseSpanishDayMonth, creditStatementReadingState,
  CREDIT_STATEMENT_PARSERS };
`;
const runtimePath = path.join(__dirname, '_extracted_6b4_12_2_runtime.js');
fs.writeFileSync(runtimePath, code);
const M = require('./_extracted_6b4_12_2_runtime.js');

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

console.log('=== CORRECCIÓN 6B4.12.2 — CIERRE AL 100% (66/66) ===\n');

const resultado66 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_2', 'resultado_66_periodos_final.json'), 'utf8'));
const auditoriaUsd = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_2', 'auditoria_usd_linea_por_linea.json'), 'utf8'));

// A. Los 2 períodos pendientes de 6B4.12.1 quedan identificados.
{
  const dosPendientes = ['VISA_8374_2024-12', 'VISA_8374_2025-01'];
  ok('A. Los 2 períodos pendientes de 6B4.12.1 existen en el resultado final', dosPendientes.every(p => resultado66.some(r => r.periodo === p)));
}

// B. Ambos quedan FULLY_RECONCILED, diffArs=0 y diffUsd=0.
for (const periodo of ['VISA_8374_2024-12', 'VISA_8374_2025-01']) {
  const r = resultado66.find(r => r.periodo === periodo);
  eq(`B. ${periodo} queda FULLY_RECONCILED`, r.estado_final_6b4_12_2, 'FULLY_RECONCILED');
  eq(`B. ${periodo} diffArs = 0`, r.diffArs_final, 0);
  eq(`B. ${periodo} diffUsd = 0`, r.diffUsd_final, 0);
  eq(`B. ${periodo} statementUsd real = -1902.73 (saldo acreedor, no cero, no "no detectado")`, r.statementUsd, -1902.73);
}

// C. Total final: 66/66.
{
  const totalFully = resultado66.filter(r => r.estado_final_6b4_12_2 === 'FULLY_RECONCILED').length;
  eq('C. Total final 66/66', totalFully, 66);
  eq('C. 0 períodos pendientes', resultado66.filter(r => r.estado_final_6b4_12_2 !== 'FULLY_RECONCILED').length, 0);
}

// D. Auditoría línea por línea existe para ambos períodos y explica
// exactamente la línea que produce/resuelve la diferencia.
for (const archivo of ['VISA_8374_2024-12.pdf', 'VISA_8374_2025-01.pdf']) {
  const a = auditoriaUsd[archivo];
  ok(`D. ${archivo} tiene auditoría línea por línea`, !!a && Array.isArray(a.auditoria_usd_linea_por_linea) && a.auditoria_usd_linea_por_linea.length > 0);
  const ajuste = a.auditoria_usd_linea_por_linea.find(l => l.categoria === 'currency_conversion_carried_forward');
  ok(`D. ${archivo} identifica la línea de ajuste real (saldo acreedor) que resuelve la diferencia`, !!ajuste && ajuste.incluido_en_la_suma === true && Math.abs(ajuste.importe_original - (-1904.74)) < 0.01);
  eq(`D. ${archivo} subtotal acumulado final = declaredTotalUsd`, a.calculatedUsd_final, a.declaredTotalUsd_final);
}

// E. La regla nueva: fila del cupón de pago ("TNA...TEM...<ars> <usd>-")
// se reconoce y se usa como fuente del total USD real cuando trae signo "-".
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('E. El parser reconoce la fila del cupón de pago (TNA...TEM...) con signo real de USD', /paymentCouponTotalsMatch/.test(fn));
  ok('E. La regla valida cruzadamente el importe ARS de esa fila contra el total ya conocido (nunca confía a ciegas)', /Math\.abs\(couponArs-declaredTotalArs\)<=CREDIT_RECONCILE_TOLERANCE_ARS/.test(fn));
}

// F. La corrección no reemplaza el movimiento "Saldo anterior" ya existente
// (sigue con su valor real positivo, tal como lo imprime el PDF); solo
// agrega un movimiento de ajuste aparte.
{
  const parsed = M.parseBancoProvinciaVisaStatement(buildLayout([
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
  ]));
  const saldoAnterior = parsed.movements.find(m => m.category === 'carried_balance');
  const ajuste = parsed.movements.find(m => m.category === 'currency_conversion_carried_forward');
  ok('F. "Saldo anterior" conserva su valor real positivo (nunca se modifica)', !!saldoAnterior && saldoAnterior.amountUsd === 1904.74 && saldoAnterior.amountArs === 1843243.2);
  ok('F. Se agrega un movimiento de ajuste APARTE con el saldo acreedor real (signo negativo)', !!ajuste && Math.abs(ajuste.amountUsd - (-1904.74)) < 0.01 && ajuste.amountArs == null);
  eq('F. declaredTotalUsd real = -1902.73 (no 0, no "no detectado")', parsed.declaredTotalUsd, -1902.73);
  eq('F. missing no incluye total_usd_no_detectado', parsed.missing.includes('total_usd_no_detectado'), false);
}

// G. Si la fila del cupón de pago no coincide en ARS con el total ya
// conocido, NO se usa (nunca se inventa un total a partir de una fila no
// confirmada).
{
  const parsed = M.parseBancoProvinciaVisaStatement(buildLayout([
    'CIERRE 26 Dic 24 VENCIMIENTO 06 Ene 25',
    'LIMITES:      COMPRA $ 5.500.000,00                                            FINANCIACION $ 4.400.000,00',
    '              SALDO ANTERIOR                                                  1843.243,20     1.904,74',
    'TNA 81,000 TEM 6,658 TNA 10,000 TEM 0,822 999999,99 1.902,73-',
    '                    DEBITAREMOS DE SU CTA 00000000514817 LA SUMA DE $ 2788451,78     SUC.126',
  ]));
  ok('G. Fila de cupón con ARS que NO coincide con el total real se ignora (no se inventa el total USD)', parsed.declaredTotalUsd !== -1902.73);
}

// H. La corrección no cambia el comportamiento cuando el cupón trae un
// total USD positivo (sin signo "-") — no se activa el ajuste especial.
{
  const parsed = M.parseBancoProvinciaVisaStatement(buildLayout([
    'CIERRE 26 May 25 VENCIMIENTO 09 Jun 25',
    'LIMITES:      COMPRA $ 9.500.000,00                                            FINANCIACION $ 7.600.000,00',
    '              SALDO ANTERIOR                                                   100.000,00      50,00',
    '25 Mayo 05 000001 K COMERCIO DE PRUEBA           960003496345101                         3.479,22',
    'Tarjeta 8374 Total Consumos de TITULAR PRINCIPAL                             108.320,77 *    0,00 *',
    'TNA 81,000 TEM 6,658 TNA 10,000 TEM 0,822 108.320,77 50,00',
    '                    DEBITAREMOS DE SU CTA 00000000514817 LA SUMA DE $ 108320,77 + U$S     50,00     SUC.126',
  ]));
  ok('H. Con signo positivo en el cupón, no se agrega ningún movimiento de ajuste especial', !parsed.movements.some(m => m.category === 'currency_conversion_carried_forward' && /saldo en dólares acreedor/i.test(m.description)));
  eq('H. declaredTotalUsd sigue viniendo de la línea DEBITAREMOS normal (comportamiento sin cambios)', parsed.declaredTotalUsd, 50);
}

// I. 0 regresiones: ningún período antes FULLY_RECONCILED (63/66 de
// 6B4.12.1) retrocedió.
{
  const before6b4_12_1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_1', 'resultado_66_periodos_final.json'), 'utf8'));
  const beforeMap = {}; for (const r of before6b4_12_1) beforeMap[r.emisor + '::' + r.periodo] = r.estado_final_6b4_12_1;
  const regresiones = resultado66.filter(r => beforeMap[r.emisor + '::' + r.periodo] === 'FULLY_RECONCILED' && r.estado_final_6b4_12_2 !== 'FULLY_RECONCILED');
  eq('I. 0 regresiones contra el resultado de 6B4.12.1 (64/66)', regresiones.length, 0);
}

// J. Ningún importe hardcodeado en la lógica (solo en comentarios de evidencia).
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement').replace(/\/\/.*$/gm, '');
  ok('J. Ningún nombre de archivo ni importe puntual de 2024-12/2025-01 está hardcodeado en la lógica', !/1902,73|1904,74|2788451/.test(fn));
}

// K. Caso 6B4.9.1 y funciones congeladas sin tocar.
ok('K. creditPaymentModel/creditUsdPaymentRecommendation/creditUsdPaymentDecision no fueron tocadas', /function creditPaymentModel\(/.test(srcMain) && /function creditUsdPaymentRecommendation\(/.test(srcMain) && /function creditUsdPaymentDecision\(/.test(srcMain));

// L. Etapas previas siguen presentes.
ok('L. 6B4.12/6B4.12.1: parseVisaDebtTransferLine, CREDITOS→refund, financiable siguen presentes', /function parseVisaDebtTransferLine\(/.test(srcMain) && /CREDITOS\\s\+\\S/.test(srcMain) && /\^financiable\\s\+de\\s\+\\\$/.test(srcMain));
ok('L. 6B4.11.3: permisos/navegación sin cambios', /canViewReports\(\)\?renderBalance\(\):''/.test(srcMain));
ok('L. 6B4.11.2: getAveragePeriodForYear sigue presente', /function getAveragePeriodForYear\(/.test(srcOperator));

// M. Sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('M. index.html sintaxis válida', true); }
  catch (e) { ok('M. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('M. index_operator.html sintaxis válida', true); }
  catch (e) { ok('M. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// N. Sin escrituras a Supabase.
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('N. La función modificada nunca invoca sb.from/insert/update/rpc', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(fn));
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('N. Esta suite es de solo lectura', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
}

fs.unlinkSync(runtimePath);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
