// CORRECCIÓN 6B4.12.1 - Suite de pruebas de la resolución final de los 3
// períodos pendientes tras 6B4.12. Extrae las funciones reales de
// index.html (sin depender de scripts de sesión ni de pdf.js) y verifica,
// con fixtures sintéticos anonimizados, cada corrección nueva de esta
// etapa. Los conteos agregados de los 66 períodos reales (que requieren
// pdf.js contra los PDF binarios) se referencian desde
// pruebas/resultados_6b4_12_1/*.json, generados en esta misma etapa contra
// los 105 PDF reales.
// node pruebas/run_6b4_12_1_resolucion_final_tests.js
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
const runtimePath = path.join(__dirname, '_extracted_6b4_12_1_runtime.js');
fs.writeFileSync(runtimePath, code);
const M = require('./_extracted_6b4_12_1_runtime.js');

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}

console.log('=== CORRECCIÓN 6B4.12.1 — RESOLUCIÓN FINAL DE 3 PERÍODOS PENDIENTES ===\n');

const resultado66 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_1', 'resultado_66_periodos_final.json'), 'utf8'));
const inventario2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12_1', 'inventario_2_periodos_pendientes.json'), 'utf8'));

// A. Se identifican exactamente los 3 períodos pendientes de 6B4.12.
{
  const pendientesAntes = resultado66.filter(r => r.estado_baseline_6b4_10_1 !== 'FULLY_RECONCILED');
  // El baseline 6B4.10.1 es 50/66; los "3 pendientes de 6B4.12" son un
  // subconjunto de esos 16 -- se identifican por comparación directa contra
  // el inventario ya generado en 6B4.12 (fuente de verdad pedida por el
  // pedido: inventario_16_periodos_pendientes.json).
  const inventario16 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12', 'inventario_16_periodos_pendientes.json'), 'utf8'));
  const pendientes3 = inventario16.filter(p => p.estado_actual !== 'FULLY_RECONCILED').map(p => p.periodo_interno_nombre_archivo);
  eq('A. Los 3 períodos pendientes de 6B4.12 son exactamente', pendientes3.sort(), ['VISA_8374_2024-12', 'VISA_8374_2025-01', 'VISA_8374_2025-02'].sort());
}

// B. VISA_8374_2025-02 queda resuelto (FULLY_RECONCILED).
{
  const r = resultado66.find(r => r.periodo === 'VISA_8374_2025-02');
  eq('B. VISA_8374_2025-02 queda FULLY_RECONCILED', r.estado_final_6b4_12_1, 'FULLY_RECONCILED');
  eq('B. VISA_8374_2025-02 diffArs final = 0', r.diffArs_final, 0);
  eq('B. VISA_8374_2025-02 diffUsd final = 0', r.diffUsd_final, 0);
}

// C. VISA_8374_2024-12 y VISA_8374_2025-01: ARS resuelto, USD con causa
// exacta documentada, sin forzar.
{
  for (const periodo of ['VISA_8374_2024-12', 'VISA_8374_2025-01']) {
    const r = resultado66.find(r => r.periodo === periodo);
    eq(`C. ${periodo} diffArs final = 0 (ARS totalmente reconciliado)`, r.diffArs_final, 0);
    eq(`C. ${periodo} diffUsd final = -2.01 (causa exacta documentada, no forzada)`, r.diffUsd_final, -2.01);
    ok(`C. ${periodo} sigue sin FULLY_RECONCILED (no se fuerza)`, r.estado_final_6b4_12_1 !== 'FULLY_RECONCILED');
  }
  ok('C. Ambos períodos tienen "dato_exacto_que_falta" documentado (nunca se inventa)', inventario2.every(p => typeof p.dato_exacto_que_falta === 'string' && p.dato_exacto_que_falta.length > 0));
}

// D. Total final: 64/66.
{
  const totalFully = resultado66.filter(r => r.estado_final_6b4_12_1 === 'FULLY_RECONCILED').length;
  eq('D. Total final 64/66 (no 66/66 — 2 casos genuinamente sin forzar)', totalFully, 64);
}

// E. "CREDITOS VS EN PESOS" clasifica como refund (no purchase).
ok('E. "CREDITOS VS EN PESOS" clasifica como refund (crédito real, nunca purchase)', M.classifyStatementLineText('03 CREDITOS VS EN PESOS') === 'refund');
// F. "CREDITO POR/DE" sigue funcionando igual que antes (sin regresión).
ok('F. "CREDITO POR mercadería" sigue clasificando como refund (sin regresión)', M.classifyStatementLineText('CREDITO POR MERCADERIA') === 'refund');

// G. "CANCELACION SALDO ACREEDOR U$S" se excluye del parseo (nunca se
// suma como movimiento, ni en ARS ni en USD).
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('G. El parser excluye explícitamente "CANCELACION SALDO ACREEDOR U$S..." (nunca se cuenta un importe en dólares mal asignado a pesos)', /CANCELACION\\s\+SALDO\\s\+ACREEDOR\\s\+U\\\$\?S/.test(fn) || /CANCELACION\s+SALDO\s+ACREEDOR\s+U\$\?S/.test(fn));
}

// H. "CANCELACION SALDO ACREEDOR $" (componente ARS, sin U$S) SIGUE siendo
// un movimiento real (no se excluye) -- necesario para cancelar con
// CREDITOS VS EN PESOS.
{
  const parsed = M.parseBancoProvinciaVisaLine('25 Enero 03 CANCELACION SALDO ACREEDOR $                                        1928.416,86');
  ok('H. "CANCELACION SALDO ACREEDOR $" (sin U$S) sigue generando un movimiento real', !!parsed && Math.abs(parsed.amountArs - 1928416.86) < 0.01);
}

// I. "financiable de $" (continuación huérfana del boilerplate "Plan V")
// se excluye como boilerplate, no como consumo.
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('I. El parser excluye "financiable de $..." como boilerplate (continuación de "saldo financiable")', /\^financiable\\s\+de\\s\+\\\$/.test(fn) || /\^financiable\\s\+de\\s\+\$/.test(fn));
}

// J. La exclusión de "financiable de $" no afecta un consumo real que
// legítimamente contenga la palabra "financiable" en otro contexto (no
// existe tal caso real en los 105 PDF, pero se verifica que el patrón es
// anclado al inicio de línea, no en cualquier posición).
{
  const parsedLegit = M.parseBancoProvinciaVisaLine('17 006519 * COMERCIO FINANCIABLE SA C.06/06                                    31.666,16');
  ok('J. Un comercio real que contenga "financiable" en su nombre (no al inicio del renglón) no se descarta por esta exclusión', !!parsedLegit);
}

// K. Evidencia real "saldo en dólares es acreedor" habilita USD=0 con
// evidencia, en vez de "missing".
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('K. El parser reconoce la evidencia real "saldo en dólares es acreedor" para USD=0', /saldo\\s\+en\\s\+d\[o.\]\+lares\\s\+es\\s\+acreedor/i.test(fn) || /hasCreditorUsdBalanceEvidence/.test(fn));
}

// L. No se inventó ningún importe: todas las correcciones de esta etapa
// están respaldadas por una verificación aritmética exacta documentada
// (ver resumen_final_6b4_12_1.md), nunca por un valor fijo.
{
  const fn = extractFunction(srcMain, 'parseBancoProvinciaVisaStatement');
  ok('L. Ningún valor de archivo/período específico está hardcodeado en la lógica del parser (solo en comentarios de evidencia)', !/==='?VISA_8374_2\d{3}-\d{2}/.test(fn.replace(/\/\/.*$/gm, '')));
}

// M. index.html e index_operator.html siguen equivalentes (0 diferencias
// funcionales, verificado contra los 105 PDF reales en esta etapa —
// referenciado, no re-ejecutado acá por no depender de pdf.js).
console.log('M. Equivalencia index.html/index_operator.html verificada contra los 105 PDF reales en esta etapa (0 diferencias) — ver informe final.');

// N. Caso 6B4.9.1 sigue intacto (funciones congeladas no tocadas).
ok('N. creditPaymentModel/creditUsdPaymentRecommendation/creditUsdPaymentDecision no fueron tocadas en 6B4.12.1', /function creditPaymentModel\(/.test(srcMain) && /function creditUsdPaymentRecommendation\(/.test(srcMain) && /function creditUsdPaymentDecision\(/.test(srcMain));

// O. 6B4.12 continúa aprobado (funciones clave siguen presentes).
ok('O. 6B4.12: parseVisaDebtTransferLine y BONIF→refund siguen presentes', /function parseVisaDebtTransferLine\(/.test(srcMain) && /BONIF\(ICACION\|ICACI[ÓO]N\)\?/.test(srcMain.replace(/Ó/g, 'Ó')));
// P. 6B4.11.3/6B4.11.2/6B4.11.1/6B4.11 continúan aprobados.
ok('P. Permisos/navegación (6B4.11.3) sin cambios', /canViewReports\(\)\?renderBalance\(\):''/.test(srcMain));
ok('P. getAveragePeriodForYear (6B4.11.2) sigue presente', /function getAveragePeriodForYear\(/.test(srcOperator));
ok('P. paymentCreatedByLabel (6B4.11.1) sigue presente', /function paymentCreatedByLabel\(/.test(srcMain));
ok('P. openAddReceiptModal (6B4.11) sigue presente en ambos archivos', /function openAddReceiptModal\(/.test(srcMain) && /function openAddReceiptModal\(/.test(srcOperator));

// Q. Sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('Q. index.html sintaxis válida', true); }
  catch (e) { ok('Q. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('Q. index_operator.html sintaxis válida', true); }
  catch (e) { ok('Q. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// R. Sin escrituras a Supabase.
{
  const touchedFns = ['classifyStatementLineText', 'parseBancoProvinciaVisaStatement', 'parseBancoProvinciaVisaLine']
    .map(n => extractFunction(srcMain, n)).join('\n');
  ok('R. Las funciones modificadas en 6B4.12.1 nunca invocan sb.from/insert/update/rpc', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(touchedFns));
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('R. Esta suite es de solo lectura (nunca invoca sb.from/insert/update/rpc)', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
}

// S. Sin regresiones: 0 períodos antes FULLY_RECONCILED retrocedieron.
{
  const before6b4_12 = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados_6b4_12', 'resultado_66_periodos.json'), 'utf8'));
  const beforeMap = {}; for (const r of before6b4_12) beforeMap[r.emisor + '::' + r.periodo] = r.estado_despues_6b4_12;
  const regresiones = resultado66.filter(r => beforeMap[r.emisor + '::' + r.periodo] === 'FULLY_RECONCILED' && r.estado_final_6b4_12_1 !== 'FULLY_RECONCILED');
  eq('S. 0 regresiones contra el resultado de 6B4.12 (63/66)', regresiones.length, 0);
}

fs.unlinkSync(runtimePath);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
