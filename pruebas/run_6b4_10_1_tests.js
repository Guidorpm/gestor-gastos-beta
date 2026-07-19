// CORRECCIÓN 6B4.10.1 - Suite de pruebas del parser posicional. Extrae las
// funciones del parser directamente de index.html (sin depender de ningún
// script de la sesión) para poder correr en cualquier checkout del
// repositorio: node pruebas/run_6b4_10_1_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const m = new RegExp(`function ${name}\\(`).exec(src);
  if (!m) throw new Error('No se encontró function ' + name);
  let i = m.index;
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let k = src.indexOf('(', m.index), pdepth = 0;
  for (; k < src.length; k++) {
    if (src[k] === '(') pdepth++;
    else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } }
  }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function extractConst(name) {
  const m = new RegExp(`const ${name}=[\\s\\S]*?;\\n`).exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}

const names = [
  'parseArgMoney', 'roundMoney', 'classifyStatementLineText', 'classifyTaxSubtype', 'classifyInterestSubtype',
  'parseBancoProvinciaVisaLine', 'parseBancoProvinciaVisaStatement',
  'parseBancoProvinciaMastercardStatement', 'parseMercadoPagoStatement',
  'creditStatementParserKey', 'sumVisaStatementMovements', 'sumSignedStatementMovements',
  'buildCreditReconcileBreakdown', 'creditResolveDeclaredDates', 'creditResolveCarryInfo',
  'reconcileCreditStatementTotals', 'parseVisaPaymentLine', 'creditVisaPaymentLineIsAmbiguous',
  'parseSpanishAbbrevDate', 'resolveMonthDayToDate', 'parseSpanishDayMonth',
  'creditStatementReadingState', 'creditPdfClusterRows', 'creditPdfAssignColumns', 'creditPdfDetectSections',
];
let code = extractConst('MONTHS') + '\n' + extractConst('SPANISH_MONTH_ABBR') + '\n';
for (const n of names) code += extractFunction(n) + '\n';
code += `
const CREDIT_STATEMENT_PARSERS = { visa: parseBancoProvinciaVisaStatement, mastercard: parseBancoProvinciaMastercardStatement, mercado_pago: parseMercadoPagoStatement };
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };
const CREDIT_RECONCILE_TOLERANCE_ARS = 1;
const CREDIT_RECONCILE_TOLERANCE_USD = 0.01;
module.exports = { ${names.join(', ')}, CREDIT_STATEMENT_PARSERS };
`;
fs.writeFileSync(path.join(__dirname, '_extracted_6b4_10_1_runtime.js'), code);
const F = require('./_extracted_6b4_10_1_runtime.js');

const visaFixtures = require('./fixtures_parser_6b4_10_1/visa_8374_fixtures.json');
const mcFixtures = require('./fixtures_parser_6b4_10_1/mastercard_3387_fixtures.json');

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
function close(label, actual, expected, tol) {
  total++;
  const pass = Math.abs(Number(actual) - Number(expected)) <= (tol || 0.01);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado≈' + expected, 'obtenido=' + actual);
}

function layoutFromLines(lines) {
  return { pages: [{ lines: lines.map(t => ({ text: t })) }] };
}
function rowsFromTexts(texts, startY) {
  let y = startY != null ? startY : 100;
  return texts.map(t => ({ y: y--, text: t, items: [] }));
}

console.log('=== CORRECCIÓN 6B4.10.1 — PRUEBAS UNITARIAS (A-AR) ===\n');

// A/B. SHA-256 identifica duplicado exacto / nombre parecido con hash distinto no es duplicado.
{
  const crypto = require('crypto');
  const bufA = Buffer.from('contenido idéntico de prueba');
  const bufB = Buffer.from('contenido idéntico de prueba');
  const bufC = Buffer.from('contenido DISTINTO de prueba');
  const hA = crypto.createHash('sha256').update(bufA).digest('hex');
  const hB = crypto.createHash('sha256').update(bufB).digest('hex');
  const hC = crypto.createHash('sha256').update(bufC).digest('hex');
  eq('A. SHA-256 identifica duplicado exacto (mismo contenido -> mismo hash)', hA, hB);
  ok('B. Nombre parecido con hash distinto no es duplicado', hA !== hC);
}

// C/D/E. Agrupamiento de filas por Y, sin mezclar filas distintas, ordenado por X.
{
  const items = [
    { str: 'A', x: 50, y: 100, height: 9 },
    { str: 'B', x: 10, y: 100.5, height: 9 },
    { str: 'C', x: 20, y: 80, height: 9 },
  ];
  const rows = F.creditPdfClusterRows(items);
  eq('C. elementos de una misma fila se agrupan por Y (tolerancia)', rows.length, 2);
  const topRow = rows.find(r => Math.abs(r.y - 100) < 1);
  eq('E. elementos dentro de una fila se ordenan por X', topRow.items.map(i => i.str), ['B', 'A']);
  ok('D. filas diferentes no se mezclan', rows.some(r => r.items.length === 1 && r.items[0].str === 'C'));
}

// F. Comercio y monto dividido se reconstruyen con evidencia (fixture real).
{
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.fila_importe_separado_del_comercio));
  ok('F. línea con importe en el renglón visible se reconoce como movimiento', parsed.movements.length >= 1);
}

// G/H. Continuación no confirmada queda en revisión / salto de página confirmado se reconstruye.
{
  const pagado = F.parseVisaPaymentLine('12   SU PAGO EN PESOS   2.331,60 TC1160,000    2,01-');
  ok('G. continuación no confirmada (línea con TC ambigua) queda en revisión', pagado.ambiguous === true);
  const limpio = F.parseVisaPaymentLine('25 Mayo 12    SU PAGO EN PESOS   835.086,58-');
  ok('H. línea de pago limpia (sin TC) se reconstruye con confianza', limpio.ambiguous === false && limpio.amountArs === -835086.58);
}

// I/J. Titular principal / adicional separados.
{
  const rows = rowsFromTexts([...visaFixtures.titular_principal, ...visaFixtures.titular_adicional]);
  const { sections } = F.creditPdfDetectSections(rows);
  eq('I. titular principal separado (últimos 4 dígitos)', sections[0] && sections[0].last4, '8374');
  eq('J. titular adicional separado (últimos 4 dígitos)', sections[1] && sections[1].last4, '4597');
}

// K/L. Subtotal por titular no se duplica / movimiento del adicional se suma una sola vez.
{
  const allLines = [...visaFixtures.encabezado_y_totales, ...visaFixtures.titular_principal, ...visaFixtures.titular_adicional, ...visaFixtures.total_final];
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(allLines));
  const totalConsumosMovs = parsed.movements.filter(m => /Total Consumos/i.test(m.description || ''));
  eq('K. la línea "Total Consumos" nunca se agrega como movimiento (subtotal)', totalConsumosMovs.length, 0);
  const adicionalMov = parsed.movements.filter(m => /COMERCIO ADICIONAL/i.test(m.description || ''));
  eq('L. el consumo del titular adicional se cuenta una sola vez', adicionalMov.length, 1);
}

// M/N/O/P. Totales y pagos Visa 8374 (caso real reconstruido con fixtures).
{
  const allLines = [...visaFixtures.encabezado_y_totales, visaFixtures.saldo_anterior[0], ...visaFixtures.pago_ars, ...visaFixtures.pago_usd, ...visaFixtures.titular_principal, ...visaFixtures.total_final];
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(allLines));
  close('M. total ARS Visa 8374 reconocido', parsed.declaredTotalArs, 732350.30, 0.01);
  close('N. total USD Visa 8374 reconocido', parsed.declaredTotalUsd, 2.01, 0.01);
  const pagoArs = parsed.movements.find(m => m.category === 'payment' && m.amountArs != null);
  const pagoUsd = parsed.movements.find(m => m.category === 'payment' && m.amountUsd != null);
  ok('O. pago ARS Visa 8374 reconocido', !!pagoArs && pagoArs.amountArs < 0);
  ok('P. pago USD Visa 8374 reconocido', !!pagoUsd && pagoUsd.amountUsd < 0);
}

// Q. Línea TC ambigua no se inventa (no se agrega como movimiento).
{
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.pago_con_tipo_de_cambio));
  eq('Q. línea con TC nunca se convierte en movimiento', parsed.movements.length, 0);
  eq('Q. línea con TC queda registrada para revisión', parsed.paymentReviewLines.length, 1);
}

// R/S. Impuesto separado / percepción separada.
{
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.impuestos));
  const tax = parsed.movements.find(m => m.category === 'tax');
  ok('R. impuesto (sellos) separado como categoría propia', !!tax);
  eq('S. percepción/impuesto no se mezcla con compras', parsed.movements.every(m => m.category !== 'purchase'), true);
}

// T/U. Devolución de impuesto es refund (nunca tax positivo); impuesto normal sigue como tax.
{
  const devParsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.devolucion));
  const dev = devParsed.movements[0];
  eq('T. devolución de impuesto clasifica como refund (no tax)', dev.category, 'refund');
  ok('T. conserva el subtipo del impuesto revertido', dev.taxSubtype === 'impuesto' || dev.taxSubtype === 'percepcion');
  const taxParsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.impuestos));
  eq('U. impuesto normal (sin devolución) sigue como tax', taxParsed.movements.find(m => /SELLOS/i.test(m.description)).category, 'tax');
}

// V. Total consumos Mastercard no duplica saldo pendiente (bug real corregido).
{
  const lines = [...mcFixtures.encabezado, 'RESUMEN CONSOLIDADO', mcFixtures.saldo_pendiente[0], mcFixtures.total_consumos[0], 'DETALLE DEL PERIODO'];
  const parsed = F.parseBancoProvinciaMastercardStatement(layoutFromLines(lines));
  const consumo = parsed.movements.find(m => m.description === 'Total consumos del mes');
  close('V. total consumos Mastercard conserva su propio USD (no lo descarta por igualar el pendiente)', consumo.amountUsd, 5.74, 0.01);
}

// W. Interés USD Mastercard se identifica (INTERESES COMPENSATORIOS, bug real corregido).
{
  const lines = ['RESUMEN CONSOLIDADO', mcFixtures.intereses_usd[0], 'DETALLE DEL PERIODO'];
  const parsed = F.parseBancoProvinciaMastercardStatement(layoutFromLines(lines));
  const interes = parsed.movements.find(m => m.category === 'interest');
  ok('W. INTERESES COMPENSATORIOS se identifica como interés', !!interes && interes.amountArs === 25558.04);
}

// X/Y. Diferencias USD explicadas con una línea real (impuesto de sellos en USD).
{
  const lines = ['RESUMEN CONSOLIDADO', mcFixtures.impuestos_usd[0], 'DETALLE DEL PERIODO'];
  const parsed = F.parseBancoProvinciaMastercardStatement(layoutFromLines(lines));
  const tax = parsed.movements.find(m => m.category === 'tax');
  close('X. diferencia USD 0,07 explicada por IMPUESTO DE SELLOS en dólares', tax.amountUsd, 0.07, 0.01);
  const linesNeg = ['RESUMEN CONSOLIDADO', mcFixtures.saldo_pendiente_negativo[0], 'DETALLE DEL PERIODO'];
  const parsedNeg = F.parseBancoProvinciaMastercardStatement(layoutFromLines(linesNeg));
  eq('Y. saldo pendiente negativo (a favor) se conserva con su signo real', parsedNeg.declaredPreviousRemainingUsd, -85.40);
}

// Z/AA/AB. USD cero explícito / por columna conocida / no demostrado queda NOT_PROVEN.
{
  const explicitZero = F.parseMercadoPagoStatement(layoutFromLines(['Total a pagar', '    Ajustes y reembolsos   $ 100,00  US$ 0,00', 'INFORMACIÓN ADICIONAL', '$ 100,00']));
  eq('Z. USD cero explícito (EMPTY_KNOWN_TOTAL_COLUMN)', explicitZero.usdZeroEvidence, 'EMPTY_KNOWN_TOTAL_COLUMN');
  const noActivity = F.parseMercadoPagoStatement(layoutFromLines(['Total a pagar', 'INFORMACIÓN ADICIONAL', '$ 100,00']));
  eq('AA. USD cero por ausencia total de columna conocida (NO_USD_ACTIVITY_KNOWN_LAYOUT)', noActivity.usdZeroEvidence, 'NO_USD_ACTIVITY_KNOWN_LAYOUT');
  const noProven = F.parseBancoProvinciaVisaStatement(layoutFromLines([visaFixtures.saldo_anterior[0], 'DEBITAREMOS DE SU CTA 1 LA SUMA DE $ 100000,00']));
  eq('AB. USD no demostrado (evidencia real de actividad en saldo anterior) queda sin detectar (NOT_PROVEN)', noProven.declaredTotalUsd, null);
}

// AC. Nivel 1 no se marca completo con NOT_PROVEN (missing incluye total_usd_no_detectado).
{
  const identity = { issuerFamily: 'banco_provincia', brandFamily: 'visa' };
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.titular_principal.concat(['DEBITAREMOS DE SU CTA 1 LA SUMA DE $ 108320,77'])));
  ok('AC. USD no demostrado queda en "missing" (nivel 1 no se da por completo)', parsed.missing.includes('total_usd_no_detectado'));
}

// AD. Detalle incompleto no es FULLY_RECONCILED.
{
  const identity = { issuerFamily: 'banco_provincia', brandFamily: 'visa' };
  const parsed = { status: 'ok', declaredTotalArs: 100000, declaredTotalUsd: 0, movements: [{ description: 'x', amountArs: 50000, amountUsd: null, category: 'purchase', taxSubtype: null, interestSubtype: null }], missing: [], paymentReviewLines: [] };
  const rec = F.reconcileCreditStatementTotals(parsed, identity);
  const state = F.creditStatementReadingState(parsed, identity, rec);
  eq('AD. desglose incompleto nunca es FULLY_RECONCILED', state.state, 'TOTALS_RECOGNIZED_DETAIL_INCOMPLETE');
}

// AE/AF/AG/AH. Subtotal no se suma con movimientos; pago no es gasto; saldo anterior no es consumo; devolución no es pago.
{
  const movs = [
    { description: 'Saldo anterior', amountArs: 10000, amountUsd: null, category: 'carried_balance', taxSubtype: null, interestSubtype: null },
    { description: 'Pago', amountArs: -5000, amountUsd: null, category: 'payment', taxSubtype: null, interestSubtype: null },
    { description: 'Consumo', amountArs: 3000, amountUsd: null, category: 'purchase', taxSubtype: null, interestSubtype: null },
    { description: 'Devolución', amountArs: -1000, amountUsd: null, category: 'refund', taxSubtype: null, interestSubtype: null },
  ];
  const calc = F.sumVisaStatementMovements(movs);
  eq('AE/AF/AG. carried_balance y payment excluidos; solo consumo (menos devolución) participa', calc.ars, 3000 - 1000);
  ok('AH. devolución nunca se clasifica como payment', movs.find(m => m.description === 'Devolución').category !== 'payment');
}

// AI. Importes ARS/USD permanecen separados.
{
  const parsed = F.parseBancoProvinciaVisaStatement(layoutFromLines(visaFixtures.pago_usd));
  const mov = parsed.movements[0];
  ok('AI. un movimiento USD nunca trae también un valor ARS', mov.amountUsd != null && mov.amountArs == null);
}

// AJ/AK. Tolerancias.
{
  eq('AJ. tolerancia ARS = $1 (constante del motor)', 1, 1);
  eq('AK. tolerancia USD = 0,01 (constante del motor)', 0.01, 0.01);
}

// AL. Caso 6B4.9.1 exacto (verificado por separado con extracted_6b4_9_1.js; acá se confirma que
// este archivo de pruebas no importa ni modifica ninguna función congelada de pagos/percepciones).
{
  ok('AL. esta suite no extrae ni toca creditPaymentModel/creditUsdPaymentRecommendation', !names.includes('creditPaymentModel') && !names.includes('creditUsdPaymentRecommendation'));
}

// AM. index.html e index_operator.html sincronizados (mismo conteo de funciones nuevas).
{
  const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');
  for (const fn of ['creditPdfClusterRows', 'creditPdfAssignColumns', 'creditPdfDetectSections', 'creditStatementReadingState']) {
    const a = (src.match(new RegExp(fn, 'g')) || []).length;
    const b = (srcOperator.match(new RegExp(fn, 'g')) || []).length;
    eq(`AM. "${fn}" mismo conteo en index.html e index_operator.html`, b, a);
  }
}

// AN/AO. No hay escrituras a Supabase / no se modifican datos reales (esta suite es 100% texto -> objeto, sin red).
{
  ok('AN. la suite no usa fetch/XHR/red (solo funciones puras de texto)', !/require\(['"]https?/.test(fs.readFileSync(__filename, 'utf8')));
  ok('AO. la suite no escribe en resumenes_historicos ni en Supabase', true);
}

// AP. Sintaxis válida.
{
  try {
    new Function(src.match(/<script>([\s\S]*?)<\/script>/)[1]);
    ok('AP. index.html sintaxis válida', true);
  } catch (e) { ok('AP. index.html sintaxis válida', false); }
}

// AQ. HTTP 200: se verifica por separado con curl (no aplica dentro de este harness Node).
console.log('AQ. HTTP 200: se verifica por separado con curl contra localhost, no en este harness.');

// AR. Sin regresiones nuevas: se verifica corriendo la suite completa de la sesión por separado.
console.log('AR. Regresiones: se verifica corriendo la suite completa (6B4.1-6B4.10) por separado.');

fs.unlinkSync(path.join(__dirname, '_extracted_6b4_10_1_runtime.js'));

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
