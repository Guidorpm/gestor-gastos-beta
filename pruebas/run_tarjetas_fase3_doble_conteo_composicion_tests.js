// ============================================================
// TARJETAS — FASE 3 / FASE 3A / FASE 3B — CORRECCIÓN DE DOBLE CONTEO EN
// creditStatementCompositionReconciliation() — MATERIALIZADA — 20260822
// ------------------------------------------------------------
// Objetivo de esta corrección (aislada del resto del WIP histórico de
// Tarjetas, que permanece sin publicar): resolver 3 bugs contables reales
// ya detectados en la composición publicada (HEAD
// a7948aa812b723f5f2826932e0d188fac7cad94d):
//
//   BUG 1 - saldoAnterior/saldoAnteriorUsd (capital trasladado del ciclo
//   previo) se sumaba dentro del total compuesto de ESTE ciclo.
//   BUG 2 - intereses se sumaba junto a interesesFinanciacion e
//   interesesPunitorios (subtotales ya incluidos en intereses) -- doble
//   conteo real (caso auditado: $14.546,94 contado dos veces = $29.093,88).
//   BUG 3 - una devolución de percepción de dólares (RG4815/RG5617)
//   vinculada al ciclo ANTERIOR se restaba como si fuera un ajuste de
//   ESTE ciclo.
//
// FASE 3A - ajuste sobre BUG 3: se auditó el criterio ya usado por
// creditPaymentModel.priorRefund y por perceptionReversal (dentro de
// reconcileConsecutiveCreditStatements, sin tocar esa función) y se
// confirmó, agregando UNA condición (¿existe en los mismos items una
// percepción con el mismo código?), que el filtro original (excluir toda
// devolución RG4815/RG5617 sin condición) era demasiado amplio: fallaba
// cuando la percepción y su reverso están en el MISMO resumen.
//
// FASE 3B - MATERIALIZACIÓN: al aplicar el fix al working tree real (que
// ya contenía el resto del WIP histórico) se detectó que una primera
// versión "minimizada" (sin la extensión USD de
// buildCreditReconcileBreakdown, sin "breakdown," en el return) rompía
// dos suites YA EXISTENTES y YA PASANDO (run_trazabilidad_8374_20260809_
// tests.js, run_trazabilidad_8374_e2e_20260809_tests.js) que dependen
// realmente de ambas cosas para un caso real (percepción RG5617 USD 0,12
// del resumen Visa 8374). La versión final materializada preserva EXACTAMENTE
// esas dos piezas del WIP (no eran simplificaciones seguras) y cambia
// ÚNICAMENTE la línea del filtro de compositionItems -- delta mínimo real
// contra el WIP ya existente, confirmado por diff (1 hunk por archivo, en
// el mismo lugar donde ya vivía el filtro).
//
// Esta prueba NUNCA reimplementa la lógica a mano:
//  - la versión ANTES (con los 3 bugs, tal cual PUBLICADA) se extrae del
//    blob de HEAD vía `git show HEAD:index.html` -- nunca del working
//    tree, que ya tiene WIP histórico aplicado.
//  - la versión DESPUÉS (materializada) se extrae DIRECTAMENTE del
//    working tree real (index.html/index_operator.html) -- así la prueba
//    corre exactamente contra el código que terminó publicado en los
//    archivos reales, nunca una reconstrucción paralela.
//
// No modifica datos reales, no ejecuta SQL, no toca permisos/RLS/
// credit_card_access, no toca Julieta ni Fabiana -- ver CASO 17-20 de
// auditoría estática más abajo.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const headIndexText = execSync('git show HEAD:index.html', { cwd: ROOT, maxBuffer: 1024 * 1024 * 50 }).toString('utf8');
const workingIndexText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const workingOperatorText = fs.readFileSync(path.join(ROOT, 'index_operator.html'), 'utf8');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}
function norm(text) { return text.replace(/\r\n/g, '\n'); }

// ---------------- Helpers comunes (idénticos en HEAD y en el working tree) ----------------
function commonHelperBlocks(text) {
  return [
    extract(text, "const CREDIT_META_PREFIX='[[CREDIT_META:'", '\nfunction fmtUsd'),
    extract(text, 'function formatARS(value){', '\nfunction formatUSD'),
    extract(text, 'function creditMovementMeta(movement){', '\nfunction fmtUsd'),
    extract(text, 'function fmtUsd(value){', '\n}') + '\n}',
    extract(text, 'const CREDIT_CARRY_TOLERANCE_ARS=1;', '\nconst CREDIT_CARRY_TOLERANCE_USD=0.01;') + '\nconst CREDIT_CARRY_TOLERANCE_USD=0.01;',
    extract(text, 'function creditMovementType(movement){', '\nfunction creditMovementNeedsClassification'),
    extract(text, 'function creditTaxCode(movement){', '\nfunction creditDollarPerceptionCode'),
    extract(text, 'function creditDollarPerceptionCode(value){', '\nfunction creditCurrentStatementPayments'),
    extract(text, 'function classifyTaxSubtype(description){', '\nfunction classifyInterestSubtype'),
    extract(text, 'function classifyInterestSubtype(description){', '\n// CORRECCIÓN 6B4.7 - Reconstruye un renglón'),
    extract(text, 'function creditNormalizeStoredMovementForBreakdown(item){', '\nfunction creditFindCarriedBalanceInfo'),
    extract(text, 'const CREDIT_COMPOSITION_TOLERANCE_ARS=CREDIT_CARRY_TOLERANCE_ARS;', '\nfunction creditStatementCompositionReconciliation(statement,items,paymentModel){'),
  ];
}

const fnRoundMoney = extract(headIndexText, 'function roundMoney(value){', '\n}') + '\n}';

// ---------------- ANTES: CONGELADO el 20260824 (ver FASE 3G) ----------------
// El propio commit que publica este fix cambia HEAD para incluir ESE MISMO
// fix -- por lo tanto ya no se puede seguir leyendo el "antes" vía
// `git show HEAD:index.html` (dejaría de reproducir el bug apenas se
// publicara este commit, y los 4 casos que abajo aseveran el comportamiento
// buggy pasarían a fallar). Se congela acá, una sola vez, el texto EXACTO
// (extraído el 20260824, nunca reescrito a mano) tal cual estaba publicado
// en HEAD a7948aa812b723f5f2826932e0d188fac7cad94d, ANTES de este fix.
const fnBreakdownBefore = "function buildCreditReconcileBreakdown(movements){\n  const sum=(pred)=>roundMoney((movements||[]).filter(pred).reduce((acc,m)=>acc+(m.amountArs||0),0));\n  return{\n    // CORRECCIÓN 6B4.8.3 - \"saldoAnterior\" separado de \"consumosArs\": el\n    // capital trasladado del resumen previo nunca es un consumo nuevo (ver\n    // Fase 2/5/15 del pedido).\n    saldoAnterior:sum(m=>m.category==='carried_balance'),\n    saldoAnteriorUsd:roundMoney((movements||[]).filter(m=>m.category==='carried_balance').reduce((acc,m)=>acc+(m.amountUsd||0),0)),\n    consumosArs:sum(m=>m.category==='purchase'),\n    impuestos:sum(m=>m.category==='tax'&&m.taxSubtype!=='percepcion'),\n    percepciones:sum(m=>m.category==='tax'&&m.taxSubtype==='percepcion'),\n    intereses:sum(m=>m.category==='interest'),\n    interesesFinanciacion:sum(m=>m.category==='interest'&&m.interestSubtype==='financing'),\n    interesesPunitorios:sum(m=>m.category==='interest'&&m.interestSubtype==='punitive'),\n    comisiones:sum(m=>m.category==='fee'),\n    ajustes:sum(m=>m.category==='adjustment'),\n    devoluciones:sum(m=>m.category==='refund'),\n    consumosUsd:roundMoney((movements||[]).filter(m=>m.category==='purchase').reduce((acc,m)=>acc+(m.amountUsd||0),0)),\n  };\n}";
const fnCompositionBefore = "function creditStatementCompositionReconciliation(statement,items,paymentModel){\n  const hasMovementDetail=(items||[]).length>0;\n  if(!hasMovementDetail){\n    return{\n      status:'INSUFFICIENT_DETAIL',\n      composedArs:null,composedUsd:null,\n      bankArs:paymentModel.bankArs,bankUsd:paymentModel.bankUsd,\n      diffArs:null,diffUsd:null,\n      message:'Desglose incompleto: este resumen no tiene movimientos individuales guardados, así que no se puede reconciliar la composición contra el total del banco.',\n    };\n  }\n  const breakdown=buildCreditReconcileBreakdown(items.map(creditNormalizeStoredMovementForBreakdown));\n  const composedArs=roundMoney(\n    (breakdown.saldoAnterior||0)+(breakdown.consumosArs||0)+(breakdown.intereses||0)+\n    (breakdown.interesesFinanciacion||0)+(breakdown.interesesPunitorios||0)+\n    (breakdown.comisiones||0)+(breakdown.impuestos||0)+(breakdown.percepciones||0)+\n    (breakdown.ajustes||0)-(breakdown.devoluciones||0)\n  );\n  const composedUsd=roundMoney((breakdown.saldoAnteriorUsd||0)+(breakdown.consumosUsd||0));\n  const diffArs=roundMoney(paymentModel.bankArs-composedArs);\n  const diffUsd=roundMoney(paymentModel.bankUsd-composedUsd);\n  const matches=Math.abs(diffArs)<=CREDIT_COMPOSITION_TOLERANCE_ARS&&Math.abs(diffUsd)<=CREDIT_COMPOSITION_TOLERANCE_USD;\n  return{\n    status:matches?'MATCH':'DIFFERENCE',\n    composedArs,composedUsd,\n    bankArs:paymentModel.bankArs,bankUsd:paymentModel.bankUsd,\n    diffArs,diffUsd,\n    message:matches\n      ?'La composición del resumen coincide con el total declarado por el banco.'\n      :`Desglose incompleto. Diferencia pendiente de conciliar: ${formatARS(Math.abs(diffArs))}${Math.abs(diffUsd)>0.01?` · ${fmtUsd(Math.abs(diffUsd))}`:''}. El total del banco es la referencia de deuda: el desglose disponible todavía no explica completamente ese total.`,\n  };\n}\n// CORRECCIÓN 6B4.9.1 - Sección 10 del pedido: coherencia impositiva. Compara\n// (percepción vinculada a USD + otros impuestos del modelo de pago) contra\n// los impuestos identificados en la composición — nunca reemplaza una fuente\n// por la otra, siempre muestra ambas cifras y la diferencia.\nfunction creditTaxCoherenceCheck(statement,items,paymentModel){\n  const modelTaxTotal=roundMoney((paymentModel.dollarPerception||0)+(paymentModel.ivaRg4240||0)+(paymentModel.ivaPerception||0)+(paymentModel.iibb||0)+(paymentModel.sellosArs||0));\n  const hasMovementDetail=(items||[]).length>0;\n  if(!hasMovementDetail){\n    return{status:'INSUFFICIENT_DETAIL',modelTaxTotal,compositionTaxTotal:null,diff:null,\n      message:'Detalle impositivo incompleto: este resumen no tiene movimientos individuales guardados para comparar contra la composición.'};\n  }\n  const breakdown=buildCreditReconcileBreakdown(items.map(creditNormalizeStoredMovementForBreakdown));\n  const compositionTaxTotal=roundMoney((breakdown.impuestos||0)+(breakdown.percepciones||0));\n  const diff=roundMoney(modelTaxTotal-compositionTaxTotal);\n  const matches=Math.abs(diff)<=CREDIT_COMPOSITION_TOLERANCE_ARS;\n  return{\n    status:matches?'MATCH':'DIFFERENCE',\n    modelTaxTotal,compositionTaxTotal,diff,\n    message:matches\n      ?'El detalle impositivo coincide con la composición.'\n      :`Detalle impositivo incompleto: percepción + otros impuestos (${formatARS(modelTaxTotal)}) vs. impuestos identificados en la composición (${formatARS(compositionTaxTotal)}). Diferencia: ${formatARS(Math.abs(diff))}.`,\n  };\n}";

// ---------------- DESPUÉS: extraído DIRECTAMENTE del working tree real ----------------
// (mismo criterio de marcadores, sobre index.html / index_operator.html ya
// materializados -- nunca reconstruido a mano).
const workingIndexTextLf = norm(workingIndexText);
const workingOperatorTextLf = norm(workingOperatorText);

const fnBreakdownAfter = extract(workingIndexTextLf, 'function buildCreditReconcileBreakdown(movements){', '\n// CORRECCIÓN 6B4.7 - Motor de reconciliación');
const fnCompositionAfter = extract(
  workingIndexTextLf,
  'function creditStatementCompositionReconciliation(statement,items,paymentModel){',
  "\n  };\n}\n// CORRECCIÓN 6B4.9.1 - Sección 10 del pedido"
) + '\n  };\n}';

const fnCompositionAfterOperator = extract(
  workingOperatorTextLf,
  'function creditStatementCompositionReconciliation(statement,items,paymentModel){',
  "\n  };\n}\n// CORRECCIÓN 6B4.9.1 - Sección 10 del pedido"
) + '\n  };\n}';

// ---------------- Sandboxes ejecutables (código real, nunca reescrito) ----------------
function buildSandbox(text, breakdownFnSource, compositionFnSource) {
  const src = `
    'use strict';
    ${fnRoundMoney}
    ${commonHelperBlocks(text).join('\n')}
    ${breakdownFnSource}
    ${compositionFnSource}
    return { creditStatementCompositionReconciliation, buildCreditReconcileBreakdown, creditMovementType, creditDollarPerceptionCode, creditNormalizeStoredMovementForBreakdown };
  `;
  return new Function(src)();
}

const before = buildSandbox(headIndexText, fnBreakdownBefore, fnCompositionBefore);
const after = buildSandbox(workingIndexTextLf, fnBreakdownAfter, fnCompositionAfter);

// ---------------- Fixtures sintéticos (nunca datos reales) ----------------
function mv({ id, currency = 'ARS', amount, movementType, taxCode, description = '' }) {
  const meta = {};
  if (movementType) meta.movementType = movementType;
  if (taxCode) meta.taxCode = taxCode;
  const metaJson = Object.keys(meta).length ? `[[CREDIT_META:${JSON.stringify(meta)}]]` : '';
  return { id, currency, amount, category: '', description, notes: metaJson };
}

let results = [];
let passCount = 0, failCount = 0;
function caso(name, fn) {
  try {
    fn();
    results.push(`PASS - ${name}`);
    passCount++;
  } catch (err) {
    results.push(`FAIL - ${name}\n        ${err.message}`);
    failCount++;
  }
}

// ============================================================
// BUG 1 — saldoAnterior contado como gasto del período actual
// ============================================================
const bug1Items = [
  mv({ id: 'b1-carry', amount: 50000, movementType: 'carried_balance', description: 'SALDO ANTERIOR' }),
  mv({ id: 'b1-purchase', amount: 10000, movementType: 'purchase', description: 'CONSUMO REAL DEL PERIODO' }),
];
const bug1PaymentModel = { bankArs: 10000, bankUsd: 0 };

caso('CASO 1 — ANTES (HEAD publicado): saldoAnterior se suma al gasto del período actual (bug reproducido)', () => {
  const r = before.creditStatementCompositionReconciliation({}, bug1Items, bug1PaymentModel);
  assert.strictEqual(r.composedArs, 60000, `composedArs debía incluir 50000(saldo)+10000(consumo)=60000, dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'DIFFERENCE');
});

caso('CASO 1b — DESPUÉS (materializado): saldoAnterior NO suma al gasto del período actual', () => {
  const r = after.creditStatementCompositionReconciliation({}, bug1Items, bug1PaymentModel);
  assert.strictEqual(r.composedArs, 10000, `composedArs debía ser solo el consumo real (10000), dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'MATCH');
});

caso('CASO 2 — saldoAnterior sigue disponible como información de continuidad (breakdown en el return, preservado del WIP)', () => {
  const r = after.creditStatementCompositionReconciliation({}, bug1Items, bug1PaymentModel);
  assert.ok(r.breakdown, 'el resultado materializado debe seguir exponiendo breakdown (ya lo hacía el WIP; se preservó)');
  assert.strictEqual(r.breakdown.saldoAnterior, 50000, 'saldoAnterior debe seguir calculándose aunque composedArs ya no lo sume');
});

// ============================================================
// BUG 2 — intereses/subintereses duplicados (caso real auditado)
// ============================================================
const bug2FinancingItems = [
  mv({ id: 'b2-fin', amount: 14546.94, movementType: 'interest', description: 'INTERESES POR FINANCIACION' }),
];
const bug2FinancingPaymentModel = { bankArs: 14546.94, bankUsd: 0 };

caso('CASO 3 — ANTES (HEAD publicado): intereses total se duplica con financiación (caso real 14.546,94 -> 29.093,88)', () => {
  const r = before.creditStatementCompositionReconciliation({}, bug2FinancingItems, bug2FinancingPaymentModel);
  assert.strictEqual(r.composedArs, 29093.88, `esperado exactamente 29093.88 (doble conteo), dio ${r.composedArs}`);
});

caso('CASO 7 — DESPUÉS (materializado): caso real 14.546,94 ya NO termina en 29.093,88', () => {
  const r = after.creditStatementCompositionReconciliation({}, bug2FinancingItems, bug2FinancingPaymentModel);
  assert.strictEqual(r.composedArs, 14546.94, `esperado 14546.94 sin duplicar, dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'MATCH');
});

caso('CASO 4 — ANTES (HEAD publicado): intereses total se duplica con punitorios', () => {
  const items = [mv({ id: 'b2-pun', amount: 2000, movementType: 'interest', description: 'INTERESES PUNITORIOS' })];
  const r = before.creditStatementCompositionReconciliation({}, items, { bankArs: 2000, bankUsd: 0 });
  assert.strictEqual(r.composedArs, 4000, `esperado 2000(intereses)+2000(punitorios duplicado)=4000, dio ${r.composedArs}`);
});

caso('CASO 4b — DESPUÉS (materializado): intereses total NO se duplica con punitorios', () => {
  const items = [mv({ id: 'b2-pun', amount: 2000, movementType: 'interest', description: 'INTERESES PUNITORIOS' })];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 2000, bankUsd: 0 });
  assert.strictEqual(r.composedArs, 2000, `esperado 2000 sin duplicar, dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'MATCH');
});

caso('CASO 5 — financiación sigue disponible como desglose informativo tras la corrección', () => {
  const r = after.creditStatementCompositionReconciliation({}, bug2FinancingItems, bug2FinancingPaymentModel);
  assert.strictEqual(r.breakdown.interesesFinanciacion, 14546.94, 'el subtotal de financiación debe seguir calculándose');
  assert.strictEqual(r.breakdown.intereses, 14546.94, 'el total de intereses debe seguir calculándose (una sola vez)');
});

caso('CASO 6 — punitorios sigue disponible como desglose informativo tras la corrección', () => {
  const items = [mv({ id: 'b2-pun', amount: 2000, movementType: 'interest', description: 'INTERESES PUNITORIOS' })];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 2000, bankUsd: 0 });
  assert.strictEqual(r.breakdown.interesesPunitorios, 2000, 'el subtotal de punitorios debe seguir calculándose');
});

// ============================================================
// BUG 3 — devolución de percepción USD: CASO A (ciclo anterior) vs
// CASO B (ciclo actual, percepción y reverso en el MISMO resumen)
// ============================================================
const casoAItems = [
  mv({ id: 'a-purchase', amount: 5000, movementType: 'purchase', description: 'CONSUMO DE ESTE CICLO' }),
  mv({ id: 'a-refund-prior-cycle', amount: 800, movementType: 'refund', taxCode: 'RG5617', description: 'DEVOLUCION PERCEPCION CICLO ANTERIOR' }),
];
const casoAPaymentModel = { bankArs: 5000, bankUsd: 0 };

caso('CASO 8a — ANTES (HEAD publicado): devolución de percepción del ciclo anterior resta en la composición del ciclo actual (bug reproducido)', () => {
  const r = before.creditStatementCompositionReconciliation({}, casoAItems, casoAPaymentModel);
  assert.strictEqual(r.composedArs, 4200, `esperado 5000-800=4200 (bug), dio ${r.composedArs}`);
  assert.notStrictEqual(r.status, 'MATCH');
});

caso('CASO 8b — DESPUÉS (CASO A materializado): devolución de percepción del ciclo anterior NO resta (sin percepción hermana en este resumen -> se excluye)', () => {
  const r = after.creditStatementCompositionReconciliation({}, casoAItems, casoAPaymentModel);
  assert.strictEqual(r.composedArs, 5000, `esperado 5000 (sin restar la devolución de otro ciclo), dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'MATCH');
});

const casoBItems = [
  mv({ id: 'b-purchase', amount: 5000, movementType: 'purchase', description: 'CONSUMO DE ESTE CICLO' }),
  mv({ id: 'b-percepcion', amount: 500, movementType: 'tax', taxCode: 'RG5617', description: 'PERCEPCION RG5617' }),
  mv({ id: 'b-reverso-mismo-ciclo', amount: 500, movementType: 'refund', taxCode: 'RG5617', description: 'DEVOLUCION PERCEPCION RG5617 MISMO CICLO' }),
];
const casoBPaymentModel = { bankArs: 5000, bankUsd: 0 };

caso('CASO 9 — DESPUÉS (CASO B materializado): percepción RG5617 y su reverso del MISMO ciclo se conservan y se netean', () => {
  const r = after.creditStatementCompositionReconciliation({}, casoBItems, casoBPaymentModel);
  assert.strictEqual(r.composedArs, 5000, `esperado 5000+500(percepción)-500(reverso mismo ciclo)=5000, dio ${r.composedArs}`);
  assert.strictEqual(r.status, 'MATCH', 'el CASO B corregido debe cerrar contra bankArs sin diferencia falsa');
});

caso('CASO 9b — devolución normal del ciclo actual (sin código de percepción USD) sigue restando sin cambios', () => {
  const items = [
    mv({ id: 'n-purchase', amount: 5000, movementType: 'purchase', description: 'CONSUMO DE ESTE CICLO' }),
    mv({ id: 'n-refund-normal', amount: 300, movementType: 'refund', description: 'REEMBOLSO COMERCIO (no es percepción USD)' }),
  ];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 4700, bankUsd: 0 });
  assert.strictEqual(r.composedArs, 4700, 'una devolución normal del ciclo actual (sin RG4815/RG5617) debe seguir restando');
  assert.strictEqual(r.status, 'MATCH');
});

// ============================================================
// Caso real Visa 8374 — percepción USD 0,12 (motivo real de preservar la
// extensión USD de buildCreditReconcileBreakdown, ver cabecera del archivo)
// ============================================================
caso('CASO 9c — composedUsd incluye impuestos/percepciones en dólares (caso real 8374: USD 0,12), no solo consumosUsd', () => {
  const items = [
    mv({ id: 'usd-purchase', currency: 'USD', amount: 9.98, movementType: 'purchase' }),
    mv({ id: 'usd-tax', currency: 'USD', amount: 0.12, movementType: 'tax', taxCode: 'RG5617' }),
  ];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 0, bankUsd: 10.10 });
  assert.strictEqual(r.composedUsd, 10.10, `composedUsd debía incluir consumosUsd+percepcionesUsd=10.10, dio ${r.composedUsd}`);
  assert.strictEqual(r.status, 'MATCH');
});

// ============================================================
// Consumos, impuestos/percepciones/comisiones, pagos ≠ gastos
// ============================================================
caso('CASO 10 — consumos ARS siguen sumando correctamente tras la corrección', () => {
  const items = [
    mv({ id: 'c1', amount: 1000, movementType: 'purchase' }),
    mv({ id: 'c2', amount: 2500, movementType: 'purchase' }),
  ];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 3500, bankUsd: 0 });
  assert.strictEqual(r.composedArs, 3500);
});

caso('CASO 11 — consumos USD siguen correctos tras la corrección', () => {
  const items = [mv({ id: 'cu1', currency: 'USD', amount: 100, movementType: 'purchase' })];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 0, bankUsd: 100 });
  assert.strictEqual(r.composedUsd, 100);
});

caso('CASO 12/13/14 — impuestos/percepciones/comisiones no se mezclan entre sí ni con intereses', () => {
  const items = [
    mv({ id: 'tax1', amount: 500, movementType: 'tax', description: 'IMPUESTO SELLOS' }),
    mv({ id: 'tax2', amount: 200, movementType: 'tax', taxCode: 'IIBB', description: 'PERCEPCION IIBB' }),
    mv({ id: 'fee1', amount: 150, movementType: 'fee', description: 'COMISION MANTENIMIENTO' }),
  ];
  const r = after.creditStatementCompositionReconciliation({}, items, { bankArs: 850, bankUsd: 0 });
  assert.strictEqual(r.breakdown.impuestos, 500, 'impuesto no-percepción debe quedar separado');
  assert.strictEqual(r.breakdown.percepciones, 200, 'percepción debe quedar separada del impuesto genérico');
  assert.strictEqual(r.breakdown.comisiones, 150, 'comisión debe quedar separada');
  assert.strictEqual(r.breakdown.intereses, 0, 'ninguno de estos tres debe filtrarse dentro de intereses');
  assert.strictEqual(r.composedArs, 850);
});

caso('CASO 15 — pagos NUNCA se suman como gasto de la composición', () => {
  const withoutPayment = after.creditStatementCompositionReconciliation({}, [mv({ id: 'p-base', amount: 1000, movementType: 'purchase' })], { bankArs: 1000, bankUsd: 0 });
  const withPayment = after.creditStatementCompositionReconciliation({}, [
    mv({ id: 'p-base', amount: 1000, movementType: 'purchase' }),
    mv({ id: 'p-pay', amount: -1000, movementType: 'payment', description: 'PAGO DE TARJETA' }),
  ], { bankArs: 1000, bankUsd: 0 });
  assert.strictEqual(withPayment.composedArs, withoutPayment.composedArs, 'agregar un pago no debe alterar la composición del resumen (reduce deuda, no es un gasto)');
});

caso('CASO 16 — el total banco/composición mantiene lógica esperada (MATCH cuando cierra, DIFFERENCE cuando no)', () => {
  const matches = after.creditStatementCompositionReconciliation({}, [mv({ id: 'm1', amount: 100, movementType: 'purchase' })], { bankArs: 100, bankUsd: 0 });
  assert.strictEqual(matches.status, 'MATCH');
  const mismatches = after.creditStatementCompositionReconciliation({}, [mv({ id: 'm2', amount: 100, movementType: 'purchase' })], { bankArs: 500, bankUsd: 0 });
  assert.strictEqual(mismatches.status, 'DIFFERENCE', 'una diferencia real y no explicada nunca debe ocultarse como MATCH');
});

// ============================================================
// Auditoría estática de seguridad/alcance (17-20)
// ============================================================
const compositionDiffOnly = (() => {
  // Aísla, para la auditoría estática, únicamente el bloque que cambió
  // realmente respecto al WIP ya existente (la línea del filtro) -- nunca
  // el resto de la función, que ya estaba en el WIP y no es objeto de esta
  // auditoría de alcance.
  return extract(fnCompositionAfter, 'const compositionItems=items.filter(m=>{', '\n  });') + '\n  });';
})();

caso('CASO 17 — la corrección no modifica datos (sin .insert/.update/.delete/sb.from en el bloque del filtro)', () => {
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|sb\.from\(/.test(compositionDiffOnly));
});

caso('CASO 18 — la corrección no depende de SQL/migraciones', () => {
  assert.ok(!/CREATE|ALTER|DROP|migraciones\//i.test(compositionDiffOnly));
});

caso('CASO 19 — la función completa no toca funciones/identificadores de permisos', () => {
  assert.ok(!/canAccessTarjetas|credit_card_access|canRepairCreditDocuments|isOwner\(|canEdit\(/.test(fnCompositionAfter));
});

caso('CASO 20 — Julieta/Fabiana sin cambios (ningún identificador propio de acceso delegado en el bloque del filtro)', () => {
  assert.ok(!/Julieta|Fabiana|delegad/i.test(compositionDiffOnly));
});

caso('CASO 21 — paridad funcional: la función materializada es idéntica (salvo fin de línea) entre index.html e index_operator.html', () => {
  assert.strictEqual(fnCompositionAfter, fnCompositionAfterOperator, 'la función materializada debe ser idéntica entre index.html e index_operator.html');
});

// ============================================================
console.log(results.join('\n'));
console.log('----------------------------------------');
console.log(`Total: ${passCount + failCount} | PASS: ${passCount} | FAIL: ${failCount}`);
console.log('AVISO: corrección materializada exclusivamente sobre creditStatementCompositionReconciliation() (línea del filtro), extraída y ejecutada desde el working tree real. No modifica datos reales, no ejecuta SQL, no toca permisos/RLS/credit_card_access/Julieta/Fabiana.');
if (failCount > 0) process.exit(1);
