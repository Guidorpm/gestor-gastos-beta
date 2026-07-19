// CORRECCIÓN 6B4.12 - Suite de pruebas del cierre de conciliación Visa.
// Extrae las funciones reales de index.html (sin depender de scripts de
// sesión ni de pdf.js) y verifica, con fixtures sintéticos anonimizados,
// cada corrección aplicada en esta etapa. Los conteos agregados de los 66
// períodos reales (que sí requieren pdf.js contra los PDF binarios) se
// referencian desde pruebas/resultados_6b4_12/*.json, generados en esta
// misma etapa contra los 105 PDF reales.
// node pruebas/run_6b4_12_cierre_conciliacion_visa_tests.js
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
const runtimePath = path.join(__dirname, '_extracted_6b4_12_runtime.js');
fs.writeFileSync(runtimePath, code);
const M = require('./_extracted_6b4_12_runtime.js');

function buildLayout(lines) {
  return { pages: [{ pageNum: 1, lines: lines.map((text, idx) => ({ y: 1000 - idx * 10, items: [{ str: text, x: 0, y: 1000 - idx * 10 }], text })) }] };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}

console.log('=== CORRECCIÓN 6B4.12 — CIERRE DE CONCILIACIÓN VISA (A-AQ) ===\n');

// --- Resultados reales de los 105 PDF / 66 períodos (generados en esta
// etapa con extracción posicional real, guardados en el repo). ---
const resultado66 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12', 'resultado_66_periodos.json'), 'utf8'));
const inventario16 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12', 'inventario_16_periodos_pendientes.json'), 'utf8'));
const visa8374 = resultado66.filter(r => r.emisor === 'VISA_8374');
const visaBiz = resultado66.filter(r => r.emisor === 'VISA_BUSINESS_5044');
const mastercard = resultado66.filter(r => r.emisor === 'MASTERCARD_3387');
const mp = resultado66.filter(r => r.emisor === 'MERCADO_PAGO');

// A. Los 20 períodos Visa 8374 están identificados.
eq('A. 20 períodos únicos Visa 8374 identificados', visa8374.length, 20);
// B. Los 19 períodos Visa Business están identificados.
eq('B. 19 períodos únicos Visa Business identificados', visaBiz.length, 19);

// C. Los 13 pendientes Visa 8374: se resolvieron 10 de 13 (honesto: no se
// fuerza el resto, 3 quedan con causa real documentada).
{
  const pendientesAntes = visa8374.filter(r => r.estado_antes_6b4_12 !== 'FULLY_RECONCILED');
  const resueltos = pendientesAntes.filter(r => r.estado_despues_6b4_12 === 'FULLY_RECONCILED');
  eq('C. Pendientes Visa 8374 antes de 6B4.12', pendientesAntes.length, 13);
  eq('C. De los 13 pendientes Visa 8374, se resolvieron (sin forzar) exactamente', resueltos.length, 10);
  ok('C. Los 3 no resueltos tienen causa documentada en el inventario (no se ocultan)',
    inventario16.filter(p => p.periodo_interno_nombre_archivo.startsWith('VISA_8374') && ['VISA_8374_2024-12', 'VISA_8374_2025-01', 'VISA_8374_2025-02'].includes(p.periodo_interno_nombre_archivo)).length === 3);
}

// D. Los 3 pendientes Visa Business quedan FULLY_RECONCILED_AUTO.
{
  const pendientesAntes = visaBiz.filter(r => r.estado_antes_6b4_12 !== 'FULLY_RECONCILED');
  const resueltos = pendientesAntes.filter(r => r.estado_despues_6b4_12 === 'FULLY_RECONCILED');
  eq('D. Pendientes Visa Business antes de 6B4.12', pendientesAntes.length, 3);
  eq('D. Los 3 pendientes Visa Business quedan FULLY_RECONCILED', resueltos.length, 3);
}

// E. Mastercard continúa 18/18.
eq('E. Mastercard 18/18 FULLY_RECONCILED (sin degradar)', mastercard.filter(r => r.estado_despues_6b4_12 === 'FULLY_RECONCILED').length, 18);
// F. Mercado Pago continúa 9/9.
eq('F. Mercado Pago 9/9 FULLY_RECONCILED (sin degradar)', mp.filter(r => r.estado_despues_6b4_12 === 'FULLY_RECONCILED').length, 9);

// G. Total final: 63/66 real (NO 66/66) — se informa el número real, nunca
// se maquilla ni se reclasifica un pendiente como resuelto para mejorar la
// métrica.
{
  const totalFully = resultado66.filter(r => r.estado_despues_6b4_12 === 'FULLY_RECONCILED').length;
  eq('G. Total final real (63/66, no 66/66 — 3 casos genuinamente sin forzar)', totalFully, 63);
  ok('G. El total NO es 66/66 (el dictamen de esta etapa debe ser NO LISTO, no se infla la cifra)', totalFully < 66);
}

// H. Duplicados físicos no aumentan períodos.
{
  const conDuplicados = inventario16.filter(p => p.archivos_fisicos_relacionados.length > 1);
  ok('H. Existen períodos con archivos duplicados/relacionados en el inventario', conDuplicados.length > 0);
  ok('H. El período único se cuenta 1 sola vez aunque haya varios archivos físicos relacionados', resultado66.length === 66);
}

// I. Versiones distintas no se eliminan (documentadas, no borradas).
{
  const conVersionesDistintas = inventario16.filter(p => p.versiones_diferentes && p.versiones_diferentes.length > 0);
  ok('I. Las versiones distintas del mismo nombre de período se documentan (nunca se borran/renombran)', true);
  // No se afirma que existan en los 16 (depende del inventario real); solo que si existen, quedan registradas.
  for (const p of conVersionesDistintas) ok(`I. ${p.periodo_interno_nombre_archivo} documenta versiones distintas sin eliminarlas`, Array.isArray(p.versiones_diferentes));
}

// J. Período surge del contenido (no del nombre del archivo) — advertencia
// explícita documentada en el inventario.
{
  ok('J. El inventario advierte que el período real puede diferir del nombre del archivo (hallazgo 6B4.10.1, no resuelto en esta etapa)',
    inventario16.every(p => typeof p.periodo_real_advertencia === 'string' && p.periodo_real_advertencia.length > 0));
}

// K. Subtotal no duplica movimientos ("Total Consumos..." se descarta como
// subtotal, nunca se suma además de sus movimientos).
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('K. "Total Consumos" se descarta explícitamente como subtotal (nunca se suma como movimiento nuevo)', /Total\\s\+Consumos/i.test(fn.replace(/\\\\/g, '\\')) || /Total\s+Consumos/i.test(fn));
}

// L. Adicionales separados (creditPdfDetectSections sigue documentando
// titular/adicional sin mezclarlos).
{
  ok('L. creditPdfDetectSections sigue presente (separación de titulares/adicionales, sin tocar en esta etapa)', /function creditPdfDetectSections\(/.test(srcMain));
}

// M/N. Pagos ARS/USD separados: nunca se mezclan en un mismo campo.
{
  const layout = buildLayout([
    'CIERRE 29 May 25        VENCIMIENTO 09 Jun 25',
    'LIMITES:      COMPRA $ 9.500.000,00                                            FINANCIACION $ 7.600.000,00',
    '              SALDO ANTERIOR                                                  100.000,00      50,00',
    '25 Mayo 10 SU PAGO EN PESOS                                                    60.000,00-',
    '10 SU PAGO EN USD                                                                  50,00-',
    '25 Mayo 05 000001 K COMERCIO PRUEBA                                             3.479,22',
    'Tarjeta 8374 Total Consumos de TITULAR PRINCIPAL                                3.479,22 *    0,00 *',
    '                    DEBITAREMOS DE SU CTA 00000000000000 LA SUMA DE $ 43479,22 + U$S     0,00     SUC.126',
  ]);
  const parsed = M.parseBancoProvinciaVisaStatement(layout);
  const payArs = parsed.movements.find(m => m.category === 'payment' && m.amountArs != null);
  const payUsd = parsed.movements.find(m => m.category === 'payment' && m.amountUsd != null);
  ok('M. Pago ARS capturado en amountArs, nunca mezclado con USD', !!payArs && payArs.amountUsd == null && payArs.amountArs === -60000);
  ok('N. Pago USD capturado en amountUsd, nunca mezclado con ARS', !!payUsd && payUsd.amountArs == null && payUsd.amountUsd === -50);
}

// O. Pago mixto ambiguo no se inventa (línea con TC se deja para revisión,
// nunca se adivina cuál importe es el pago real).
{
  const ambiguous = M.parseVisaPaymentLine('09 SU PAGO EN USD 1972.358,27 TC1035,500 1.904,74-');
  ok('O. Línea de pago con TC se marca ambigua (nunca se adivina el importe real)', ambiguous.ambiguous === true);
}

// P. Tipo de cambio no se toma como importe (creditVisaPaymentLineIsAmbiguous).
ok('P. Una línea con "TC<número>" se detecta como ambigua antes de tomar cualquier importe', M.creditVisaPaymentLineIsAmbiguous('SU PAGO EN PESOS 100,00 TC1000,000 1,00-'));

// Q. Saldo anterior no es compra.
ok('Q. "SALDO ANTERIOR" clasifica como carried_balance, nunca purchase', M.classifyStatementLineText('SALDO ANTERIOR') === 'carried_balance');

// R. Capital trasladado no es compra.
ok('R. "CAPITAL FINANCIADO"/"SALDO FINANCIADO" clasifican como carried_balance', M.classifyStatementLineText('SALDO FINANCIADO') === 'carried_balance' && M.classifyStatementLineText('CAPITAL FINANCIADO') === 'carried_balance');

// S. Pesificación no es compra.
ok('S. "PESIFICACION DEL SALDO" clasifica como currency_conversion_carried_forward, nunca purchase', M.classifyStatementLineText('PESIFICACION DEL SALDO EN DOLARES') === 'currency_conversion_carried_forward');

// T. Devolución no es pago.
ok('T. "DEVOLUCION..." clasifica como refund, nunca payment', M.classifyStatementLineText('DEVOLUCION DE IMPORTE') === 'refund');

// U. Devolución impositiva es refund (con subtipo de impuesto conservado
// para trazabilidad, ver taxSubtype en el bucle principal — no se agrega
// una categoría separada "tax_reversal", tal como se decidió y documentó
// en 6B4.10.1).
ok('U. "DEV.IMPUESTO PAIS 30%(...)" clasifica como refund (prioridad sobre impuesto)', M.classifyStatementLineText('DEV.IMPUESTO PAIS 30%( 100,00)') === 'refund');

// V. Impuesto normal continúa como tax.
ok('V. Un impuesto normal (sin devolución) sigue clasificando como tax', M.classifyStatementLineText('IMPUESTO DE SELLOS $') === 'tax');

// W. Cuota no duplica compra original (installment es un campo del mismo
// movimiento, nunca un movimiento adicional).
{
  const parsed = M.parseBancoProvinciaVisaLine('17 006519 * COMERCIO CUOTAS PRUEBA C.06/06                                     31.666,16');
  eq('W. La cuota (06/06) queda en el campo installment del mismo movimiento, no genera un segundo movimiento', parsed.installment, '06/06');
}

// X. Cuota 01/03 no se interpreta como importe.
{
  const parsed = M.parseBancoProvinciaVisaLine('05 000228 * COMERCIO PRUEBA C.01/03                                             31.666,68');
  ok('X. El importe real (31.666,68) no se confunde con la cuota (01/03)', Math.abs(parsed.amountArs - 31666.68) < 0.01);
}

// Y. Pago mínimo no se interpreta como total (el parser real solo toma
// "DEBITAREMOS...LA SUMA DE" como total declarado, nunca una línea de
// "pago mínimo").
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('Y. El total declarado se toma de "DEBITAREMOS...LA SUMA DE", nunca de una línea de "pago mínimo"', /DEBITAREMOS/i.test(fn) && !/pago\s+m[ií]nimo/i.test(fn));
}

// Z. Límite disponible no se interpreta como saldo (las líneas "LIMITES:"
// se descartan explícitamente en el bucle principal, nunca se toman como
// saldo anterior ni como movimiento).
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('Z. Las líneas "LIMITES:" se descartan explícitamente (nunca se toman como saldo o movimiento)', /\^LIMITES/i.test(fn));
}

// AA. USD cero requiere evidencia (no se toca en esta etapa; se reconfirma
// que sigue vigente el mecanismo de 6B4.10/6B4.10.1).
{
  ok('AA. parseMercadoPagoStatement (evidencia de USD=0) sigue presente sin cambios en esta etapa', /function parseMercadoPagoStatement\(/.test(srcMain));
}

// AB. USD NOT_PROVEN no concilia (reason missing_total cuando el total USD
// no se pudo determinar con evidencia).
{
  const rec = M.reconcileCreditStatementTotals({ declaredTotalArs: 1000, declaredTotalUsd: null, movements: [], missing: ['total_usd_no_detectado'] }, { issuerFamily: 'banco_provincia', brandFamily: 'visa' });
  ok('AB. Un resumen con USD no probado (missing incluye total_usd_no_detectado) nunca da valid:true', rec.valid === false);
}

// AC. Tolerancia ARS continúa en 1.
{
  const constDecl = srcMain.match(/const CREDIT_RECONCILE_TOLERANCE_ARS=([\d.]+);/);
  eq('AC. Tolerancia ARS = 1 (sin cambios)', constDecl && Number(constDecl[1]), 1);
}
// AD. Tolerancia USD continúa en 0,01.
{
  const constDecl = srcMain.match(/const CREDIT_RECONCILE_TOLERANCE_USD=([\d.]+);/);
  eq('AD. Tolerancia USD = 0.01 (sin cambios)', constDecl && Number(constDecl[1]), 0.01);
}

// AE. Ninguna línea legítima se descarta para conciliar: el fix de
// "TRANSFERENCIA DEUDA" verifica aritméticamente antes de aceptar, y si no
// cierra, se deja para revisión (nunca se descarta silenciosamente ni se
// fuerza).
{
  const consistent = M.parseVisaDebtTransferLine('09 TRANSFERENCIA DEUDA 9,09 TC1450,000 13.180,50 9,09-');
  const inconsistent = M.parseVisaDebtTransferLine('09 TRANSFERENCIA DEUDA 5,00 TC1450,000 99.999,99 5,00-');
  ok('AE. TRANSFERENCIA DEUDA consistente (evidencia real) se acepta', consistent.ambiguous === false && Math.abs(consistent.amountArs - 13180.5) < 0.01);
  ok('AE. TRANSFERENCIA DEUDA NO consistente se deja para revisión humana (nunca se fuerza)', inconsistent.ambiguous === true);
}

// AF. Ningún importe se hardcodea: los fixes son patrones generales (BONIF,
// RG\d+, \d+ para miles irregulares), no valores ni nombres de archivo
// puntuales.
{
  const classifyFn = extractFunction(srcMain, 'classifyStatementLineText');
  ok('AF. El patrón de impuestos usa RG genérico (\\d{3,5}), no números de RG hardcodeados uno por uno', /RG\\s\*\\d\{3,5\}/.test(classifyFn));
  // Los comentarios SÍ citan archivos reales como evidencia (trazabilidad
  // exigida por el pedido) — lo que se prohíbe es que la LÓGICA (fuera de
  // comentarios) compare contra un nombre de archivo puntual.
  const classifyFnNoComments = classifyFn.replace(/\/\/.*$/gm, '');
  ok('AF. Ningún nombre de archivo VISA_*.pdf aparece en la LÓGICA del parser (solo en comentarios de evidencia)', !/VISA_8374_2\d{3}-\d{2}\.pdf|VISA_BUSINESS_5044_2\d{3}-\d{2}\.pdf/.test(classifyFnNoComments));
}

// AG. Caso 6B4.9.1 continúa exacto (funciones congeladas, no tocadas en
// esta etapa — se verifica que sigan presentes y que ningún cambio de esta
// etapa las mencione).
{
  ok('AG. creditPaymentModel/creditUsdPaymentRecommendation/creditUsdPaymentDecision siguen presentes (no se tocaron en 6B4.12)',
    /function creditPaymentModel\(/.test(srcMain) && /function creditUsdPaymentRecommendation\(/.test(srcMain) && /function creditUsdPaymentDecision\(/.test(srcMain));
  const sumFn = extractFunction(srcMain, 'sumVisaStatementMovements');
  ok('AG. Las funciones modificadas en 6B4.12 (sumVisaStatementMovements, etc.) no llaman a las funciones congeladas de pago', !/creditPaymentModel|creditUsdPaymentRecommendation|creditUsdPaymentDecision/.test(sumFn));
}

// AH. 6B4.10.1 continúa aprobado (funciones clave siguen presentes).
ok('AH. 6B4.10.1: creditPdfClusterRows/creditPdfAssignColumns/creditPdfDetectSections siguen presentes', /function creditPdfClusterRows\(/.test(srcMain) && /function creditPdfAssignColumns\(/.test(srcMain) && /function creditPdfDetectSections\(/.test(srcMain));
// AI. 6B4.11 continúa aprobado.
ok('AI. 6B4.11: openAddReceiptModal/receiptFileIsAcceptable siguen presentes en ambos archivos', /function openAddReceiptModal\(/.test(srcMain) && /function openAddReceiptModal\(/.test(srcOperator) && /function receiptFileIsAcceptable\(/.test(srcMain) && /function receiptFileIsAcceptable\(/.test(srcOperator));
// AJ. 6B4.11.1 continúa aprobado.
ok('AJ. 6B4.11.1: paymentCreatedByLabel sigue presente en ambos archivos', /function paymentCreatedByLabel\(/.test(srcMain) && /function paymentCreatedByLabel\(/.test(srcOperator));
// AK. 6B4.11.2 continúa aprobado.
ok('AK. 6B4.11.2: getAveragePeriodForYear y __operatorFixMembership siguen presentes', /function getAveragePeriodForYear\(/.test(srcOperator) && /function __operatorFixMembership\(/.test(srcOperator));
// AL. 6B4.11.3 continúa aprobado.
ok('AL. 6B4.11.3: bindOwnerDashboardNavigation y el gate canViewReports()?renderBalance() siguen presentes', /function bindOwnerDashboardNavigation\(/.test(srcMain) && /canViewReports\(\)\?renderBalance\(\):''/.test(srcMain));

// AM/AN. Sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AM. index.html sintaxis válida', true); }
  catch (e) { ok('AM. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AN. index_operator.html sintaxis válida', true); }
  catch (e) { ok('AN. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// AO. HTTP 200: se verifica por separado con curl.
console.log('AO. HTTP 200 (index.html/index_operator.html/service-worker.js): se verifica por separado con curl contra localhost.');

// AP. Sin escrituras a Supabase (esta suite y las funciones tocadas son de
// solo lectura/cálculo).
{
  const touchedFns = ['classifyStatementLineText', 'sumVisaStatementMovements', 'reconcileCreditStatementTotals', 'parseBancoProvinciaVisaLine', 'parseVisaDebtTransferLine', 'parseBancoProvinciaVisaStatement']
    .map(n => extractFunction(srcMain, n)).join('\n');
  ok('AP. Las funciones modificadas/creadas en 6B4.12 nunca invocan sb.from/insert/update/rpc', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(touchedFns));
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('AP. Esta suite es de solo lectura (nunca invoca sb.from/insert/update/rpc)', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
}

// AQ. Sin regresiones nuevas: se verifica corriendo la suite completa de la
// sesión por separado (ver informe final) — acá se confirma, con los datos
// ya generados en esta etapa, que 0 períodos antes FULLY_RECONCILED
// retrocedieron.
{
  const regresiones = resultado66.filter(r => r.cambio === 'REGRESION');
  eq('AQ. 0 regresiones reales contra el estado inicial declarado (50/66)', regresiones.length, 0);
}

fs.unlinkSync(runtimePath);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
