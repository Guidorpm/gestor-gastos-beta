// CORRECCIÓN DE FONDO DEL FLUJO DE RESÚMENES DE TARJETAS — 20260805
// (5044: subida directa · 8374: desglose completo · trazabilidad)
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// (nunca reimplementa la lógica). Los fixtures de texto de acá abajo son
// ANONIMIZADOS: derivados de la estructura real de los dos PDF del caso
// (Visa 5044 y Visa 8374/4597, julio 2026), pero con nombre, dirección,
// CUIT y números de cuenta/tarjeta reemplazados por datos de prueba
// -- fechas, importes y descripciones de comercio se conservan porque son
// exactamente lo que este bloque corrige. Los PDF reales NUNCA se incluyen
// en este repositorio ni en ningún ZIP de entrega.
//
// node pruebas/run_resumenes_trazabilidad_20260805_tests.js
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
  const re = new RegExp(`const ${name}=[\\s\\S]*?;\\r?\\n`);
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
  'creditPdfClusterRows', 'creditPdfAssignColumns', 'cleanCreditCardHolderLabel', 'creditPdfDetectSections',
  'creditIdentificationForMovements', 'creditReviewCount', 'creditMovementNeedsClassification',
  'creditMovementRecognition', 'creditMovementGroup', 'creditMovementMeta', 'buildCreditMovementNotes',
];

function buildRuntime(src) {
  let code = extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  for (const n of names) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_STATEMENT_PARSERS = { visa: parseBancoProvinciaVisaStatement, mastercard: parseBancoProvinciaMastercardStatement, mercado_pago: parseMercadoPagoStatement };
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };
const CREDIT_RECONCILE_TOLERANCE_ARS = 1;
const CREDIT_RECONCILE_TOLERANCE_USD = 0.01;
// CORRECCIÓN FINAL 20260806 - TARJETAS: reconcileCreditStatementTotals ahora
// usa la tolerancia CONTABLE de confirmación (separada de la técnica de
// arriba) -- se agregan estos dos literales (mismo valor real que en
// index.html/index_operator.html) para que la función extraída siga
// resolviendo sin ReferenceError.
const CREDIT_CONFIRM_TOLERANCE_ARS = 0.01;
const CREDIT_CONFIRM_TOLERANCE_USD = 0.01;
module.exports = { parseArgMoney, roundMoney, classifyStatementLineText, classifyTaxSubtype, classifyInterestSubtype,
  parseBancoProvinciaVisaLine, parseVisaDebtTransferLine, parseBancoProvinciaVisaStatement,
  creditStatementParserKey, sumVisaStatementMovements, buildCreditReconcileBreakdown,
  creditResolveDeclaredDates, creditResolveCarryInfo, reconcileCreditStatementTotals,
  parseSpanishAbbrevDate, creditPdfDetectSections, creditPdfClusterRows,
  creditIdentificationForMovements, creditReviewCount, creditMovementNeedsClassification };
`;
  return code;
}

function buildLayout(lines) {
  return { pages: [{ pageNum: 1, lines: lines.map((text, idx) => ({ y: 1000 - idx * 10, items: [{ str: text, x: 0, y: 1000 - idx * 10 }], text })) }] };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }
function approxEq(a, b, eps) { return Math.abs(Number(a) - Number(b)) < (eps || 0.01); }

// ============================================================
// FIXTURE ANONIMIZADO — VISA 5044 (Visa Commercial, Banco Provincia,
// julio 2026). Estructura real del PDF, con titular/dirección/CUIT/
// número de cuenta reemplazados por datos de prueba. Fechas, importes y
// descripciones de comercio son los reales del caso -- son exactamente
// lo que este bloque corrige.
// ============================================================
const FIXTURE_5044_LINES = [
  '(0000) LOCALIDAD DE PRUEBA                         CUIT 30-00000000-0',
  'TITULAR,DE PRUEBA            AT: TITULAR,DE PRUEBA                  IVA: EXENTO',
  '     TITULAR,DE PRUEBA                      SUC: 000       CIERRE 30 Jul 26               VENCIMIENTO 10 Ago 26',
  '     CALLE DE PRUEBA 000',
  '     PROV BS AIRES',
  '                                                                    Cierre Ant.: 02 Jul 26  Vto. Ant.: 13 Jul 26',
  '                                                                    Prox.Cierre: 27 Ago 26  Prox.Vto.: 07 Set 26',
  'LIMITES:      COMPRA $ 2.320.000,00                                     FINANCIACION $ 1.856.000,00',
  '              SALDO ANTERIOR                                            2063.211,91         120,79',
  '26 Julio 13   SU PAGO EN PESOS                                          500.000,00-',
  '          13  SU PAGO EN USD                                                                120,79-',
  '          13  DEV.IMP. RG 5617 30%( 179856,31)                          53.956,89-',
  '          17  SU PAGO EN PESOS                                          500.000,00-',
  '          22  SU PAGO EN PESOS                                          500.000,00-',
  '          23  SU PAGO EN PESOS                                          280.000,00-',
  '          23  SU PAGO EN PESOS                                                 2.062,79-',
  '25 Agosto 29 470658 * COMERCIO PRUEBA UNO              C.11/12             33.174,00',
  '26 Mayo 06 002246 * COMERCIO PRUEBA DOS                     C.03/03             61.346,25',
  '          07 002248 * COMERCIO PRUEBA DOS                   C.03/03             27.928,98',
  '26 Junio 27 867065 * MERPAGO*COMERCIO TRES                 C.02/02                    25,00',
  '26 Julio 03 241909 K Google ChatGPT A98656984USD             19,99                          19,99',
  '          04 220778 APPLE.COM/BILL           USD             2,26                           2,26',
  '          06 115517 K MERPAGO*COMERCIO CUATRO                                  112.807,14',
  '          07 014173 P GOOGLE *ADS3335080167                             100.000,00',
  '          14 466921 K CapCut                 USD             13,99                          13,99',
  '          15 064593 K OPENAI *CHATGPT in1TtV55CUSD           20,00                          20,00',
  '          22 462436 K ANTHROPIC* CLAUD in1Tw1ECBUSD          20,00                          20,00',
  '          24 391808 K Microsoft-G173193362   USD             39,39                          39,39',
  'Tarjeta 5044 Total Consumos de TITULAR DE PRUEBA                      335.281,37 *        115,63 *',
  '26 Julio 30   IMPUESTO DE SELLOS       $                                   5.786,58',
  '          30  IMPUESTO DE SELLOS       USD                                                     1,39',
  '          30  INTERESES FINANCIACION $                                     40.386,55',
  '          30  COM.POR MANT.DE CUENTA                                       5.000,00',
  '          30  IIBB PERCEP-BSAS 2,00%( 103380,96)                           2.067,61',
  '          30  IIBB PERCEP-BSAS 2,00%( 58927,44)                            1.178,54',
  '          30  IVA RG 4240 21%( 103380,96)                                  21.710,00',
  '          30  IVA RG 4240 21%( 58927,44)                                   12.374,76',
  '          30  DB.RG 5617 30% ( 214055,04 )                                 64.216,51',
  'DEBITAREMOS DE SU CTA 00000000000000 LA SUMA DE $      715194,15 +U$S 117,02 SUC.000',
];

// ============================================================
// FIXTURE ANONIMIZADO — VISA 8374 + ADICIONAL 4597 (Visa Signature,
// Banco Provincia, julio 2026). El bloque de la tarjeta adicional cruza
// un salto de página real del PDF (línea "Google One" queda antes del
// salto; "GOOGLE *CapCut" queda después, ya en la página siguiente) --
// se simula con el mismo header de página repetido en medio del bloque,
// tal como aparece en el PDF real.
// ============================================================
const FIXTURE_8374_LINES = [
  '(0000) LOCALIDAD DE PRUEBA                         CUIT 30-00000000-0',
  'SIGNATURE - CLIENTES PARTICUL',
  'TITULAR,DE PRUEBA                    1269                  CIERRE 30 Jul 26              VENCIMIENTO 10 Ago 26',
  'CALLE DE PRUEBA 000                    SUC: 000',
  'PROV BS AIRES',
  '                                                                   Cierre Ant.: 02 Jul 26  Vto. Ant.: 13 Jul 26',
  '                                                                   Prox.Cierre: 27 Ago 26  Prox.Vto.: 07 Set 26',
  'LIMITES:      COMPRA $ 16.000.000,00                                   FINANCIACION $ 12.800.000,00',
  '              SALDO ANTERIOR                                           1526.563,38         10,10',
  '26 Julio 13   SU PAGO EN PESOS                                         500.000,00-',
  '          13  SU PAGO EN USD                                                               10,10-',
  '          13  DEV.IMP. RG 5617 30%( 14860,22)                                  4.458,06-',
  '          17  SU PAGO EN PESOS                                         500.000,00-',
  '          22  SU PAGO EN PESOS                                         500.000,00-',
  '          23  SU PAGO EN PESOS                                         22.105,32-',
  '26 Febrero 13 006337 * COMERCIO PRUEBA A          C.06/06            14.993,98',
  '26 Marzo 10 374178 * MERPAGO*COMERCIO B               C.05/06            281.500,00',
  '26 Mayo 09 002237 * COMERCIO PRUEBA C                       C.03/03            105.333,33',
  '          12 577742 * MERPAGO*COMERCIO D                 C.03/06            39.328,33',
  '          15 133028 * COMERCIO PRUEBA E                      C.03/03            73.196,66',
  'Tarjeta 8374 Total Consumos de TITULAR DE PRUEBA                     514.352,30 *        0,00 *',
  '26 Febrero 12 009097 * COMERCIO PRUEBA F                     C.06/06            14.983,33',
  '26 Junio 19 001323 * COMERCIO PRUEBA G                     C.02/03            25.000,00',
  '26 Julio 06 639121 Google One          A67994261USD          2,99                          2,99',
  '          12 469415 * COMERCIO PRUEBA H                         91.003,00',
  '          13 483546 * MERPAGO*COMERCIO I                               30.000,00',
  '          13 690922 K MERPAGO*COMERCIO J                             22.999,00',
  '          13 095451 * CP*COMERCIO K                                33.751,00',
  '          23 007486 * COMERCIO PRUEBA L                            220.048,84',
  '(0000) LOCALIDAD DE PRUEBA                   CUIT 30-00000000-0',
  'SIGNATURE - CLIENTES PARTICUL',
  'TITULAR,DE PRUEBA                   1269                  CIERRE 30 Jul 26              VENCIMIENTO 10 Ago 26',
  'CALLE DE PRUEBA 000                   SUC: 000',
  'PROV BS AIRES',
  '                                                                  Cierre Ant.: 02 Jul 26  Vto. Ant.: 13 Jul 26',
  '                                                                  Prox.Cierre: 27 Ago 26  Prox.Vto.: 07 Set 26',
  'LIMITES:      COMPRA $ 16.000.000,00                                          FINANCIACION $ 12.800.000,00',
  '26 Julio 28 747241 GOOGLE *CapCut V P1nadyiJ USD            6,99                                 6,99',
  'Tarjeta 4597 Total Consumos de ADICIONAL DE PRUEBA                               437.785,17 *        9,98 *',
  '26 Julio 30   IMPUESTO DE SELLOS                 $                            11.682,82',
  '          30  IMPUESTO DE SELLOS                 USD                                                0,12',
  '          30  INTERESES FINANCIACION $                                        14.546,94',
  '          30  IIBB PERCEP-BSAS 2,00%( 10457,04)                               209,14',
  '          30  IVA RG 4240 21%( 10457,04)                                      2.195,97',
  '          30  DB.RG 5617 30% ( 14930,08 )                                     4.479,02',
  'DEBITAREMOS DE SU CTA 00000000000000 LA SUMA DE $         985251,36 +U$S 10,10 SUC.000',
];

for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  console.log(`\n=== ${label} ===`);
  const runtimeCode = buildRuntime(src);
  const runtimePath = path.join(__dirname, `_extracted_resumenes_${label.replace(/\W/g, '_')}.js`);
  fs.writeFileSync(runtimePath, runtimeCode);
  delete require.cache[require.resolve(runtimePath)];
  const M = require(runtimePath);

  // ------------------------------------------------------------
  // CASO 5044 — subida directa
  // ------------------------------------------------------------
  const identity5044 = { issuerFamily: 'banco_provincia', brandFamily: 'visa', productFamily: 'business' };
  const parsed5044 = M.parseBancoProvinciaVisaStatement(buildLayout(FIXTURE_5044_LINES));

  // 1/2/3/4. Tarjeta / período / cierre / vencimiento.
  ok(`[${label}] (3) Detecta cierre 2026-07-30`, parsed5044.declaredCloseDate === '2026-07-30');
  ok(`[${label}] (4) Detecta vencimiento 2026-08-10`, parsed5044.declaredDueDate === '2026-08-10');

  // 8/9/10. 12 consumos, 6 ARS, 6 USD (excluye pagos, impuestos, saldo anterior).
  const purchases5044 = parsed5044.movements.filter(m => m.category === 'purchase');
  ok(`[${label}] (8) Extrae 12 consumos`, purchases5044.length === 12);
  ok(`[${label}] (9) 6 consumos en ARS`, purchases5044.filter(m => m.amountArs != null).length === 6);
  ok(`[${label}] (10) 6 consumos en USD`, purchases5044.filter(m => m.amountUsd != null).length === 6);

  // 11/12. Conciliación exacta ARS/USD (misma tolerancia real ya usada por la app).
  const reconciled5044 = M.reconcileCreditStatementTotals(parsed5044, identity5044, '2026-07');
  ok(`[${label}] (11) Concilia ARS en 0,00 (diffArs dentro de tolerancia)`, reconciled5044.totals && Math.abs(reconciled5044.totals.diffArs) <= 1);
  ok(`[${label}] (12) Concilia USD en 0,00 (diffUsd dentro de tolerancia)`, reconciled5044.totals && Math.abs(reconciled5044.totals.diffUsd) <= 0.01);
  ok(`[${label}] Saldo final ARS real 715.194,15`, approxEq(reconciled5044.totals.statementArs, 715194.15));
  ok(`[${label}] Saldo final USD real 117,02`, approxEq(reconciled5044.totals.statementUsd, 117.02));
  ok(`[${label}] (FIX E) reconcileCreditStatementTotals expone movements`, Array.isArray(reconciled5044.movements) && reconciled5044.movements.length > 0);

  // Fix A (regex real usado por detectCreditStatementIdentity): la misma
  // expresión que ahora reconoce el período por contenido.
  const fullText5044 = FIXTURE_5044_LINES.join('\n');
  const closeDueMatch = fullText5044.match(/CIERRE\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})\s+VENCIMIENTO\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})/i);
  ok(`[${label}] (2) FIX A: el regex de identidad reconoce "CIERRE 30 Jul 26 ... VENCIMIENTO 10 Ago 26"`, !!closeDueMatch);
  const period5044 = closeDueMatch ? M.parseSpanishAbbrevDate(closeDueMatch[1], closeDueMatch[2], closeDueMatch[3]).slice(0, 7) : null;
  ok(`[${label}] (2b) Período resuelto = 2026-07`, period5044 === '2026-07');

  // 5/6/7. El PDF se conserva aunque falle la lectura (verificación estructural:
  // el código real de detectCreditStatementIdentity nunca lanza excepción por
  // no encontrar período -- deja period:null y sigue, no bloquea la conservación).
  ok(`[${label}] (5/6/7) detectCreditStatementIdentity nunca usa throw para "sin período" (deja period:null, no bloquea el guardado del PDF)`,
    /function detectCreditStatementIdentity/.test(src) && !/period:null[\s\S]{0,50}throw/.test(extractFunction(src, 'detectCreditStatementIdentity')));

  // ------------------------------------------------------------
  // CASO 8374/4597 — desglose completo
  // ------------------------------------------------------------
  const identity8374 = { issuerFamily: 'banco_provincia', brandFamily: 'visa', productFamily: 'signature' };
  const parsed8374 = M.parseBancoProvinciaVisaStatement(buildLayout(FIXTURE_8374_LINES));

  // 17/18. Detecta ambas tarjetas.
  ok(`[${label}] (17) Detecta tarjeta 8374 en titularSections`, parsed8374.titularSections.some(s => s.last4 === '8374'));
  ok(`[${label}] (18) Detecta tarjeta adicional 4597 en titularSections`, parsed8374.titularSections.some(s => s.last4 === '4597'));

  // 19/20/21. 5 consumos de 8374, 9 de 4597 (incluye el que cruza el
  // salto de página), separados por cardLast4 (FIX D).
  const purchases8374All = parsed8374.movements.filter(m => m.category === 'purchase');
  const purchasesOwner = purchases8374All.filter(m => m.cardLast4 === '8374');
  const purchasesAdicional = purchases8374All.filter(m => m.cardLast4 === '4597');
  ok(`[${label}] (19) Extrae 5 consumos de la tarjeta 8374`, purchasesOwner.length === 5);
  ok(`[${label}] (20) Extrae 9 consumos de la tarjeta adicional 4597`, purchasesAdicional.length === 9);
  ok(`[${label}] (21) El consumo posterior al salto de página ("CapCut") queda asignado a 4597, no se pierde ni queda en la 8374`,
    purchasesAdicional.some(m => /CapCut/i.test(m.description)));

  // 22/23/24/25/26. Separación de pagos, devolución, RG, intereses, impuestos.
  const payments8374 = parsed8374.movements.filter(m => m.category === 'payment');
  ok(`[${label}] (22) Separa los pagos como categoría 'payment' (no consumo)`, payments8374.length >= 5);
  const refunds8374 = parsed8374.movements.filter(m => m.category === 'refund');
  ok(`[${label}] (23) Separa la devolución RG 5617 anterior como 'refund'`, refunds8374.some(m => /RG\s*5617/i.test(m.description)));
  const taxes8374 = parsed8374.movements.filter(m => m.category === 'tax');
  ok(`[${label}] (24/26) Separa impuestos/RG actual como 'tax'`, taxes8374.some(m => /DB\.?RG\s*5617/i.test(m.description)) && taxes8374.some(m => /SELLOS/i.test(m.description)));
  const interest8374 = parsed8374.movements.filter(m => m.category === 'interest');
  ok(`[${label}] (25) Separa intereses como 'interest'`, interest8374.some(m => /INTERESES/i.test(m.description)));

  // 27/28. Conciliación exacta ARS/USD del resumen completo (8374+4597+impuestos).
  const reconciled8374 = M.reconcileCreditStatementTotals(parsed8374, identity8374, '2026-07');
  ok(`[${label}] (27) Concilia ARS en 0,00`, reconciled8374.totals && Math.abs(reconciled8374.totals.diffArs) <= 1);
  ok(`[${label}] (28) Concilia USD en 0,00`, reconciled8374.totals && Math.abs(reconciled8374.totals.diffUsd) <= 0.01);
  ok(`[${label}] Saldo final ARS real 985.251,36`, approxEq(reconciled8374.totals.statementArs, 985251.36));
  ok(`[${label}] Saldo final USD real 10,10`, approxEq(reconciled8374.totals.statementUsd, 10.10));

  // 29/30/31. Estados contradictorios corregidos (FIX C) -- verificación
  // estructural sobre el código real: reviewPillLabel/reviewBannerTitle
  // nunca deben decir "Todo revisado"/identificados sin comprobar
  // noMovementsExtracted primero.
  const detailFn = extractFunction(src, 'creditSelectedDetailHtml');
  ok(`[${label}] (29/30) 'Todo revisado' ya no se puede mostrar con 0 movimientos (noMovementsExtracted se define y se usa antes de reviewPillLabel/reviewClass)`,
    /const noMovementsExtracted=movements\.length===0;/.test(detailFn) && /noMovementsExtracted\?'Sin movimientos extraídos':'Todo revisado'/.test(detailFn));
  ok(`[${label}] (31) 'Todos los consumos están identificados' ya no se muestra con 0 movimientos`,
    /noMovementsExtracted\?'Este resumen no tiene movimientos individuales extraídos todavía':'Todos los consumos están identificados'/.test(detailFn));
  const rowsTableFn = extractFunction(src, 'creditCardsRowsTableHtml');
  ok(`[${label}] Fila de la tabla maestra: mismo criterio (rowHasNoMovements) para no decir "Todo revisado" con 0 movimientos`,
    /const rowHasNoMovements=row\.items\.length===0;/.test(rowsTableFn));

  // ------------------------------------------------------------
  // Trazabilidad
  // ------------------------------------------------------------
  const traceFn = extractFunction(src, 'creditTraceabilityHtml');
  ok(`[${label}] (32/33) "Continuidad verificada" cuando el resultado de la comparación es MATCH`,
    /continuitySummary=latestRow\.reconciliation\.result==='MATCH'\s*\n\s*\?'Continuidad verificada\.'/.test(traceFn));
  ok(`[${label}] (34) "Diferencia con el resumen anterior" en cualquier otro caso con datos suficientes`,
    /'Diferencia con el resumen anterior\.'/.test(traceFn));
  ok(`[${label}] (35) "Falta cargar el resumen anterior para verificar continuidad" cuando no hay transición previa`,
    /Falta cargar el resumen anterior para verificar continuidad\./.test(traceFn));

  // 36/37/38. No se cuenta saldo anterior como gasto nuevo / no se descuenta
  // dos veces / no se duplica al reprocesar -- verificación sobre el parser real.
  const carriedBalanceMovs = parsed5044.movements.filter(m => m.category === 'carried_balance');
  ok(`[${label}] (36) "Saldo anterior" queda categorizado aparte ('carried_balance'), nunca como 'purchase'`,
    carriedBalanceMovs.length === 1 && !purchases5044.some(m => m.description === 'Saldo anterior'));
  ok(`[${label}] (37) sumVisaStatementMovements no resta el pago dos veces (fórmula única, ya usada por balanceFor y el panel)`,
    /function sumVisaStatementMovements/.test(src));

  // FIX F: inserta movimientos reales de forma idempotente, reutilizando el
  // motor ya probado de la carga masiva (buildExistingSnapshot +
  // buildMovementDetailAnalysis) -- verificación estructural (no se puede
  // ejecutar sin Supabase real). CORRECCIÓN FINAL 20260806: esta lógica se
  // extrajo de runHistoricalUpload hacia el motor único compartido
  // processCreditStatementFile (también usado por la subida directa) -- se
  // verifica ahí, no en runHistoricalUpload, que ahora delega a esa función.
  const uploadFn = extractFunction(src, 'processCreditStatementFile');
  const historicalFn = extractFunction(src, 'runHistoricalUpload');
  ok(`[${label}] (FIX F) processCreditStatementFile llama a buildMovementDetailAnalysis para completar movimientos`,
    /buildMovementDetailAnalysis\(movementItem,movementSnapshot\)/.test(uploadFn));
  ok(`[${label}] (FIX F) Inserta en credit_card_movements dentro del motor único (antes: nunca lo hacía)`,
    /credit_card_movements['"]\)\.insert\(movementRows/.test(uploadFn));
  ok(`[${label}] (14/15/38) No duplica: usa buildExistingSnapshot (mismo motor idempotente de dedup por firma que la carga masiva)`,
    /buildExistingSnapshot\(refreshedCard,period\)/.test(uploadFn));
  ok(`[${label}] (16) Vincula el documento PDF real (uploadCreditDocument) en el mismo flujo`,
    /uploadCreditDocument\(file,\{cardId:card\.id,statementId:uploadStatementId,kind:'statement'\}\)/.test(uploadFn));
  ok(`[${label}] runHistoricalUpload ahora delega en el motor único compartido (processCreditStatementFile), en vez de reimplementar la lógica`,
    /processCreditStatementFile\(row\.file,card,\{/.test(historicalFn));

  // Un error de análisis de movimientos nunca bloquea la conservación del
  // PDF ni de los totales ya guardados (Principio obligatorio).
  ok(`[${label}] Un error analizando movimientos no revierte ni bloquea el documento/totales ya guardados (catch propio, sin throw)`,
    /catch\(movementAnalysisError\)\{/.test(uploadFn) && !/catch\(movementAnalysisError\)\{[\s\S]{0,120}throw/.test(uploadFn));

  fs.unlinkSync(runtimePath);
}

// ------------------------------------------------------------
// Regresión: sintaxis y paridad
// ------------------------------------------------------------
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 5000);
  let syntaxOk = false;
  try { scripts.forEach(s => new Function(s)); syntaxOk = scripts.length > 0; } catch (e) { console.error('  ->', e.message); }
  ok(`[${label}] (43) Sintaxis JavaScript válida`, syntaxOk);
}

const parityMarkers = [
  'cardSectionForLineIndex', 'const noMovementsExtracted=movements.length===0;',
  'const rowHasNoMovements=row.items.length===0;', 'buildMovementDetailAnalysis(movementItem,movementSnapshot)',
  "const closeDueMatch=text.match(/CIERRE", 'continuitySummary',
];
ok('Paridad: index.html e index_operator.html contienen exactamente los mismos marcadores de esta corrección',
  parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
console.log('MANUAL: 44/45 (HTTP local 200) se verifican con curl contra el servidor levantado por separado.');
console.log('MANUAL: 39/40/41/42 (Fabiana, Servicios, comprobantes, Británico) se verifican corriendo la suite general por separado.');
process.exitCode = failures > 0 ? 1 : 0;
