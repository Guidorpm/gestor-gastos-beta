// ============================================================
// TARJETAS — FASE 3C (diagnóstico) + FASE 3D (corrección) —
// EMPAREJAMIENTO PERCEPCIÓN / DEVOLUCIÓN — 20260822
// ------------------------------------------------------------
// FASE 3C diagnosticó, con el texto único "Desglose incompleto.
// Diferencia pendiente de conciliar" (creditStatementCompositionReconciliation,
// único origen posible en todo el archivo), una contradicción visual real
// reportada manualmente por Guido sobre Visa 8374 (Banco Provincia, julio
// 2026): la composición visible (consumos $952.137,47 + intereses
// $14.546,94 + impuestos/percepciones $18.566,95 = $985.251,36 = saldo
// declarado por el banco) coincidía exactamente, pero la UI igual mostraba
// "Diferencia pendiente de conciliar: $1.545.568,38 · USD 0,12".
//
// Causa confirmada (reproducida algebraicamente de forma exacta): el
// criterio de FASE 3A ("¿existe una percepción del mismo código
// RG4815/RG5617 en este resumen?") emparejaba erróneamente una devolución
// histórica (reverso de un ciclo ANTERIOR) con una percepción NUEVA y NO
// RELACIONADA del mismo código regulatorio cobrada en julio -- dos
// eventos económicos distintos que solo comparten el tipo de impuesto.
//
// FASE 3D corrige exclusivamente esa condición: además del código, ahora
// exige evidencia monetaria de que ambos movimientos son el MISMO evento
// -- misma moneda (currency) y mismo importe absoluto (dentro de la
// tolerancia ya existente CREDIT_CARRY_TOLERANCE_ARS/USD), mismo criterio
// moneda/importe ya usado por registeredCreditPaymentsInWindow/
// creditRefundsInWindow (currency + Math.abs(Number(amount))) -- sin
// inventar campos ni tolerancias nuevas.
//
// Este archivo NUNCA reimplementa la lógica a mano: extrae y ejecuta la
// función REAL ya materializada en index.html. No modifica datos reales,
// no ejecuta SQL, no toca Supabase, permisos, Julieta ni Fabiana.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

const fnRoundMoney = extract(indexText, 'function roundMoney(value){', '\n}') + '\n}';
const blocks = [
  extract(indexText, "const CREDIT_META_PREFIX='[[CREDIT_META:'", '\nfunction fmtUsd'),
  extract(indexText, 'function formatARS(value){', '\nfunction formatUSD'),
  extract(indexText, 'function creditMovementMeta(movement){', '\nfunction fmtUsd'),
  extract(indexText, 'function fmtUsd(value){', '\n}') + '\n}',
  extract(indexText, 'const CREDIT_CARRY_TOLERANCE_ARS=1;', '\nconst CREDIT_CARRY_TOLERANCE_USD=0.01;') + '\nconst CREDIT_CARRY_TOLERANCE_USD=0.01;',
  extract(indexText, 'function creditMovementType(movement){', '\nfunction creditMovementNeedsClassification'),
  extract(indexText, 'function creditTaxCode(movement){', '\nfunction creditDollarPerceptionCode'),
  extract(indexText, 'function creditDollarPerceptionCode(value){', '\nfunction creditCurrentStatementPayments'),
  extract(indexText, 'function classifyTaxSubtype(description){', '\nfunction classifyInterestSubtype'),
  extract(indexText, 'function classifyInterestSubtype(description){', '\n// CORRECCIÓN 6B4.7 - Reconstruye un renglón'),
  extract(indexText, 'function creditNormalizeStoredMovementForBreakdown(item){', '\nfunction creditFindCarriedBalanceInfo'),
  extract(indexText, 'function buildCreditReconcileBreakdown(movements){', '\n// CORRECCIÓN 6B4.7 - Motor de reconciliación'),
  extract(indexText, 'const CREDIT_COMPOSITION_TOLERANCE_ARS=CREDIT_CARRY_TOLERANCE_ARS;', '\nfunction creditStatementCompositionReconciliation(statement,items,paymentModel){'),
];
const fnComposition = extract(
  indexText,
  'function creditStatementCompositionReconciliation(statement,items,paymentModel){',
  "\n  };\n}\n// CORRECCIÓN 6B4.9.1 - Sección 10 del pedido"
) + '\n  };\n}';

const sandbox = new Function(`
  'use strict';
  ${fnRoundMoney}
  ${blocks.join('\n')}
  ${fnComposition}
  return { creditStatementCompositionReconciliation, buildCreditReconcileBreakdown };
`)();

function mv({ id, currency = 'ARS', amount, movementType, taxCode, description = '' }) {
  const meta = {};
  if (movementType) meta.movementType = movementType;
  if (taxCode) meta.taxCode = taxCode;
  const metaJson = Object.keys(meta).length ? `[[CREDIT_META:${JSON.stringify(meta)}]]` : '';
  return { id, currency, amount, category: '', description, notes: metaJson };
}

let results = [], passCount = 0, failCount = 0;
function caso(name, fn) {
  try { fn(); results.push(`PASS - ${name}`); passCount++; }
  catch (err) { results.push(`FAIL - ${name}\n        ${err.message}`); failCount++; }
}

// ============================================================
// CASO REAL OBLIGATORIO (FASE 3D) — números exactos reportados por Guido
// ============================================================
const baselineItems = [
  mv({ id: 'consumo', amount: 952137.47, movementType: 'purchase' }),
  mv({ id: 'interes', amount: 14546.94, movementType: 'interest', description: 'INTERESES POR FINANCIACION' }),
  mv({ id: 'impuesto-percepcion-julio', amount: 18566.95, movementType: 'tax', taxCode: 'RG5617', description: 'PERCEPCION RG5617 JULIO' }),
  mv({ id: 'consumo-usd', currency: 'USD', amount: 9.98, movementType: 'purchase' }),
  mv({ id: 'percepcion-usd-julio', currency: 'USD', amount: 0.12, movementType: 'tax', taxCode: 'RG5617', description: 'PERCEPCION RG5617 JULIO' }),
];
const bankModel = { bankArs: 985251.36, bankUsd: 10.10 };

const reversoHistoricoArs = mv({ id: 'reverso-ciclo-anterior-ars', amount: 1545568.38, movementType: 'refund', taxCode: 'RG5617', description: 'REVERSO PERCEPCION CICLO ANTERIOR' });
const reversoHistoricoUsd = mv({ id: 'reverso-ciclo-anterior-usd', currency: 'USD', amount: 0.12, movementType: 'refund', taxCode: 'RG5617', description: 'REVERSO PERCEPCION CICLO ANTERIOR' });

caso('1) CASO REAL — ANTES del fix (diagnóstico FASE 3C, ya corregido): con el reverso histórico presente, el criterio actual YA NO lo empareja con la percepción nueva de julio (importes distintos)', () => {
  const items = [...baselineItems, reversoHistoricoArs, reversoHistoricoUsd];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, bankModel);
  assert.strictEqual(r.breakdown.devoluciones, 0, `breakdown.devoluciones = ${r.breakdown.devoluciones} -- el reverso histórico (1.545.568,38) NO coincide en importe con la percepción de julio (18.566,95) -> debe excluirse`);
});

caso('2) CASO REAL — DESPUÉS del fix: diffArs = 0 (ya no 1.545.568,38)', () => {
  const items = [...baselineItems, reversoHistoricoArs, reversoHistoricoUsd];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, bankModel);
  assert.strictEqual(r.diffArs, 0, `diffArs = ${r.diffArs}`);
});

// HALLAZGO HONESTO (no ocultado): la única forma de reconstruir el
// reverso histórico USD que reproduce el diffUsd=0,12 reportado bajo la
// fórmula ANTERIOR (con un solo movimiento) es asumirle exactamente
// USD 0,12 -- que es, por coincidencia numérica, EL MISMO importe que la
// percepción nueva de julio (también USD 0,12). En ese escenario
// específico, código+moneda+importe NO alcanza para distinguir "es la
// misma percepción" de "son dos percepciones USD distintas que
// coincidieron en el importe" -- limitación real e inherente de usar
// solo importe como señal, ya anticipada conceptualmente. Esto NO estaba
// verificado como el valor real de producción (solo es la reconstrucción
// mínima consistente con el síntoma reportado) -- por eso este caso
// queda documentado como ABIERTO, no como resuelto, hasta que la prueba
// manual de Guido confirme si el resumen real de Julio realmente tiene
// esa coincidencia de importe en USD o no.
caso('3) CASO REAL — ARS: diffArs = 0 (resuelto, ver CASO 2)', () => {
  const items = [...baselineItems, reversoHistoricoArs, reversoHistoricoUsd];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, bankModel);
  assert.strictEqual(r.diffArs, 0, `diffArs = ${r.diffArs} -- el lado ARS queda completamente resuelto`);
});

caso('4) CASO REAL — USD: diffUsd sigue en 0,12 SI el reverso histórico USD coincide exactamente con la percepción nueva USD (edge case abierto, documentado, no resuelto por este alcance)', () => {
  const items = [...baselineItems, reversoHistoricoArs, reversoHistoricoUsd];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, bankModel);
  assert.strictEqual(r.diffUsd, 0.12, `diffUsd = ${r.diffUsd} -- reproduce el edge case: importe USD coincidente entre dos percepciones distintas no se puede distinguir solo por código+moneda+importe`);
  assert.strictEqual(r.status, 'DIFFERENCE', 'el status global sigue en DIFFERENCE mientras el lado USD no se resuelva -- no se fuerza un MATCH falso');
});

// ============================================================
// Matriz de emparejamiento (casos 1-6 pedidos explícitamente en FASE 3D)
// ============================================================
caso('5) mismo código (RG5617), importe DISTINTO -> NO emparejar (devolución se excluye)', () => {
  const items = [
    mv({ id: 'p1', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax1', amount: 500, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref1', amount: 800, movementType: 'refund', taxCode: 'RG5617' }), // importe distinto de 500
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5500, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 0, 'importe distinto -> no son la misma percepción -> se excluye');
  assert.strictEqual(r.composedArs, 5500);
  assert.strictEqual(r.status, 'MATCH');
});

caso('6) RG5617 vieja (sin pareja) queda excluida del ciclo actual', () => {
  const items = [
    mv({ id: 'p2', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'ref2', amount: 800, movementType: 'refund', taxCode: 'RG5617' }),
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5000, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 0);
  assert.strictEqual(r.status, 'MATCH');
});

caso('7) percepción nueva del ciclo actual permanece (no se excluye por tener una devolución no relacionada al lado)', () => {
  const items = [
    mv({ id: 'p3', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax3', amount: 500, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref3', amount: 800, movementType: 'refund', taxCode: 'RG5617' }), // no relacionada (importe distinto)
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5500, bankUsd: 0 });
  assert.strictEqual(r.breakdown.percepciones, 500, 'la percepción nueva de este ciclo sigue contando con normalidad');
});

caso('8) percepción + devolución del MISMO ciclo, mismo código e importe compatible -> SÍ se netean', () => {
  const items = [
    mv({ id: 'p4', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax4', amount: 500, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref4', amount: 500, movementType: 'refund', taxCode: 'RG5617' }), // mismo importe
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5000, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 500, 'debe conservarse para netear');
  assert.strictEqual(r.composedArs, 5000, '5000+500(percepción)-500(reverso mismo ciclo)=5000');
  assert.strictEqual(r.status, 'MATCH');
});

caso('9) misma combinación (8) pero importe distinto -> NO se netean', () => {
  const items = [
    mv({ id: 'p5', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax5', amount: 500, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref5', amount: 501.50, movementType: 'refund', taxCode: 'RG5617' }), // fuera de tolerancia (CREDIT_CARRY_TOLERANCE_ARS=1)
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5500, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 0, 'diferencia de importe mayor a la tolerancia -> no son la misma percepción');
});

caso('10) RG4815 equivalente: mismo código, mismo importe -> se netea', () => {
  const items = [
    mv({ id: 'p6', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax6', amount: 300, movementType: 'tax', taxCode: 'RG4815' }),
    mv({ id: 'ref6', amount: 300, movementType: 'refund', taxCode: 'RG4815' }),
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5000, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 300);
  assert.strictEqual(r.composedArs, 5000);
  assert.strictEqual(r.status, 'MATCH');
});

caso('10b) RG4815 vs RG5617 (mismo importe, código DISTINTO) -> NO emparejar', () => {
  const items = [
    mv({ id: 'p7', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax7', amount: 300, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref7', amount: 300, movementType: 'refund', taxCode: 'RG4815' }), // código distinto
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5300, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 0, 'códigos regulatorios distintos -> nunca son la misma percepción');
});

caso('11) refund genérico sin código de percepción -> comportamiento histórico intacto (siempre resta)', () => {
  const items = [
    mv({ id: 'p8', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'ref8', amount: 300, movementType: 'refund', description: 'REEMBOLSO COMERCIO' }),
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 4700, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 300);
  assert.strictEqual(r.status, 'MATCH');
});

caso('12) mismo código, distinta MONEDA (ARS vs USD) -> NO emparejar aunque el importe numérico coincida', () => {
  const items = [
    mv({ id: 'p9', amount: 5000, movementType: 'purchase' }),
    mv({ id: 'tax9', currency: 'ARS', amount: 300, movementType: 'tax', taxCode: 'RG5617' }),
    mv({ id: 'ref9', currency: 'USD', amount: 300, movementType: 'refund', taxCode: 'RG5617' }), // misma cifra, moneda distinta
  ];
  const r = sandbox.creditStatementCompositionReconciliation({}, items, { bankArs: 5300, bankUsd: 0 });
  assert.strictEqual(r.breakdown.devoluciones, 0, 'una percepción en ARS nunca puede ser la pareja de un reverso en USD, aunque coincida el número');
});

console.log(results.join('\n'));
console.log('----------------------------------------');
console.log(`Total: ${passCount + failCount} | PASS: ${passCount} | FAIL: ${failCount}`);
console.log('DIAGNÓSTICO + VALIDACIÓN DE CORRECCIÓN -- no se modificó ningún dato real, no se ejecutó SQL, no se tocó Supabase.');
if (failCount > 0) process.exit(1);
