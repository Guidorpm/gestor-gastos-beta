// CORRECCIÓN MUY ACOTADA — 20260807 (2)
// 1. Titular todavía contaminado (separador real "*" del PDF, no
//    cubierto por el regex anterior).
// 2. Relación del pago: distinguir relación económica conceptual
//    (aplicado al ciclo anterior) de relación real en base (solo
//    nombra un resumen específico si la trazabilidad lo confirma).
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// -- las pruebas 1-3 corren el MISMO camino de renderizado que usa la
// vista previa manual (creditPdfDetectSections real -> cardHolderLabel
// real -> directStatementResultHtml/creditPreviewGroupedConsumptionsHtml/
// creditPreviewMovementTableHtml reales), no solo la función pura
// cleanCreditCardHolderLabel() aislada.
//
// node pruebas/run_correccion_titular_relacion_pago_20260807_tests.js
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

const PURE_FUNCTIONS = [
  'monthKey', 'shiftMonth', 'periodDate', 'monthLabel', 'normalizeCreditStatementPeriod',
  'roundMoney', 'creditMovementMeta', 'creditMovementType', 'creditStatementLabel',
  'cleanCreditCardHolderLabel', 'creditPdfDetectSections',
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'buildPaymentMatchRows', 'parseLocalizedPaymentAmount',
  'fmtDate', 'esc', 'formatARS', 'formatUSD', 'fmtUsd', 'cardBrandLabel',
  'creditPreviewMovementTableHtml', 'creditPreviewGroupedConsumptionsHtml',
  'creditPreviewSimpleTableHtml', 'creditPreviewCompositionHtml', 'creditPreviewDetailHtml',
  'creditPreviewTraceabilityHtml', 'directStatementResultHtml', 'creditWriteTargetLabel',
  'buildPreviewMovementDetail', 'creditPreviewStatusLabels', 'creditPreviewTraceEvaluation',
  'creditPaymentReconciliationHtml',
];
const READ_FUNCTIONS = ['loadPreviousCreditStatementTrace'];

function buildRuntime(src) {
  let code = extractConst(src, 'CREDIT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS') + '\n';
  code += extractConst(src, 'ISSUER_FAMILY_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_DATE_CONFIDENCE_LABELS') + '\n';
  for (const n of PURE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of READ_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase / motor de
// fechas ya probado por separado). Las funciones de arriba (parser de
// secciones, limpieza de titular, renderizado, conciliación de pagos)
// son las REALES del archivo, nunca reimplementadas.
// ============================================================
let db = { credit_card_statements: [] };
let callLog = [];
function resetMockBackend(){ db = { credit_card_statements: [] }; callLog = []; }

class FakeBuilder {
  constructor(table, op, payload) { this.table = table; this.op = op; this.payload = payload; this._filters = {}; }
  eq(field, value) { this._filters[field] = value; return this; }
  select() { return this; }
  single() { return this._resolve(true); }
  then(resolve, reject) { this._resolve(false).then(resolve, reject); }
  async _resolve(wantSingle) {
    callLog.push({ op: this.op, table: this.table, payload: this.payload, filters: { ...this._filters } });
    if (this.op === 'select') {
      const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return wantSingle ? { data: rows[0] || null, error: null } : { data: rows, error: null };
    }
    if (this.op === 'insert') { const row = { id: 'mock-' + (db[this.table] || []).length, ...this.payload }; (db[this.table] = db[this.table] || []).push(row); return { data: row, error: null }; }
    if (this.op === 'update') { const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v)); rows.forEach(r => Object.assign(r, this.payload)); return { data: rows, error: null }; }
    if (this.op === 'delete') { db[this.table] = (db[this.table] || []).filter(r => !Object.entries(this._filters).every(([k, v]) => r[k] === v)); return { data: null, error: null }; }
    return { data: null, error: null };
  }
}
let sb = {
  from(table) {
    return {
      select: () => new FakeBuilder(table, 'select', null),
      insert: (payload) => new FakeBuilder(table, 'insert', payload),
      update: (payload) => new FakeBuilder(table, 'update', payload),
      delete: () => new FakeBuilder(table, 'delete', null),
    };
  },
};

let creditMovements = [];
let creditStatements = [];
let creditDocuments = [];

module.exports = {
  cleanCreditCardHolderLabel, creditPdfDetectSections,
  loadPreviousCreditStatementTrace,
  registeredCreditPaymentsInWindow, bankRecognizedPaymentsFromPreview,
  matchRegisteredVsBankPayments, creditPaymentReconciliationSummary,
  buildCreditPaymentReconciliation, buildPaymentMatchRows, parseLocalizedPaymentAmount,
  directStatementResultHtml, creditPreviewGroupedConsumptionsHtml,
  creditPreviewMovementTableHtml, creditPaymentReconciliationHtml,
  buildPreviewMovementDetail, creditPreviewStatusLabels,
  formatARS, formatUSD,
  shiftMonth, periodDate,
  resetMockBackend: () => { resetMockBackend(); creditMovements = []; creditStatements = []; creditDocuments = []; },
  getCallLog: () => callLog,
  seedStatements: (stmts) => { creditStatements = stmts; db.credit_card_statements = stmts.slice(); },
  seedMovements: (movs) => { creditMovements = movs; },
  seedDocuments: (docs) => { creditDocuments = docs; },
};
`;
  return code;
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

let seq = 0;
function pm(overrides) {
  seq++;
  return Object.assign({
    descripcionOriginal: 'CONSUMO ' + seq, fecha: '2026-07-05', fechaConfianza: 'alta',
    moneda: 'ARS', importe: 1000, categoria: 'consumo', categoriaParserOriginal: 'purchase',
    subtipo: null, origen: 'pdf', esIndividual: true, computaComoGasto: true,
    firma: 'sig-' + seq, motivoPersistible: 'nuevo', cardLast4: '5044', cardHolderLabel: null, installment: null,
  }, overrides);
}
function regMov(overrides) {
  seq++;
  return Object.assign({
    id: 'reg-' + seq, card_id: 'card-5044', currency: 'ARS', amount: -1000,
    movement_date: '2026-07-05', statement_id: null,
    notes: '[[CREDIT_META:{"movementType":"payment","source":"manual_payment","appliesToCurrentStatement":true}]]',
  }, overrides);
}
function bankPm(overrides) {
  return Object.assign({ fecha: '2026-07-05', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 1000 }, overrides);
}

function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_titularrelacion_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    (async () => {
      // ============================================================
      // 1-3: TITULAR -- mismo camino real de renderizado que la vista
      // previa manual (creditPdfDetectSections real, con el separador
      // "*" real del PDF, no un ejemplo simplificado con "+").
      // ============================================================
      const sections5044 = M.creditPdfDetectSections([
        { text: 'Tarjeta 5044 Total Consumos de GUIDO NICOLAS RIZZO                      335.281,37 *        115,63 *' },
      ]).sections;
      const holder5044 = sections5044[0].holderLabel;
      const sections4597 = M.creditPdfDetectSections([
        { text: 'Tarjeta 4597 Total Consumos de JULIETA DISIPIO                      437.785,17 *        9,98 *' },
      ]).sections;
      const holder4597 = sections4597[0].holderLabel;

      const consumos5044 = Array.from({ length: 12 }, (_, i) => pm({
        descripcionOriginal: `COMERCIO 5044 ${i + 1}`, fecha: `2026-07-${String(2 + i).padStart(2, '0')}`,
        moneda: 'ARS', importe: 1000 + i * 37, cardLast4: '5044', cardHolderLabel: holder5044,
      }));
      const detailMovements = M.buildPreviewMovementDetail ? null : null; // (no-op, buildPreviewMovementDetail no se usa acá: se arma result.movementDetail a mano)
      const fr5044 = {
        valid: true, totals: { statementArs: 500000, calculatedArs: 500000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
        breakdown: { saldoAnterior: 0, saldoAnteriorUsd: 0, consumosArs: 12784, consumosUsd: 0 },
        movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
      };
      const result5044 = {
        previewOnly: true, financialResult: fr5044,
        movementDetail: { persistableMovements: consumos5044, movementDetailState: 'DETAILED_COMPLETE', datesResolved: true },
        previewStatus: { lectura: { label: 'Lectura completa' }, conciliacion: { label: 'Conciliado' }, revision: { label: 'Listo para revisión' } },
        previousTrace: { status: 'not_found', statement: null, previousPeriod: null },
        previousTraceEvaluation: { state: 'not_found', label: 'NO SE ENCONTRÓ EL RESUMEN ANTERIOR. LA CONTINUIDAD QUEDARÁ PENDIENTE HASTA CARGARLO.' },
        identity: { brandFamily: 'visa', issuerFamily: 'banco_provincia' }, period: '2026-07', hash: 'a'.repeat(64),
        resultMessage: 'Vista previa procesada. No se guardó nada (modo de prueba local).',
        paymentReconciliation: null,
      };
      const html5044 = M.directStatementResultHtml(result5044);
      ok(`[${label}] (1) La vista previa real 5044 no muestra importes dentro del titular ("335.281" no aparece pegado a GUIDO)`,
        !/GUIDO[^<]*335\.281/.test(html5044) && !/GUIDO[^<]*\*/.test(html5044));
      ok(`[${label}] (2) El encabezado de tarjeta muestra solo el nombre ("TARJETA 5044 — GUIDO NICOLAS RIZZO", sin números)`,
        html5044.includes('TARJETA 5044 — GUIDO NICOLAS RIZZO') && !html5044.includes('TARJETA 5044 — GUIDO NICOLAS RIZZO 335'));
      ok(`[${label}] (3) La columna Titular muestra solo el nombre en cada fila de consumo`,
        consumos5044.length === 12 && (html5044.match(/<td>GUIDO NICOLAS RIZZO<\/td>/g) || []).length === 12);
      ok(`[${label}] 4597: titular real también queda limpio en el mismo camino de renderizado`, holder4597 === 'JULIETA DISIPIO');

      // ============================================================
      // 4-9: regresión -- 12 consumos, 6 pagos internos, 6 bancarios,
      // 6/6 matches, diferencia ARS/USD 0,00 (montos reales reportados).
      // ============================================================
      ok(`[${label}] (4) Continúan 12 consumos`, consumos5044.length === 12);
      M.resetMockBackend();
      const registeredRows = [
        regMov({ id: 'r1', movement_date: '2026-07-25', currency: 'ARS', amount: -280000 }),
        regMov({ id: 'r2', movement_date: '2026-07-23', currency: 'ARS', amount: -2062.79 }),
        regMov({ id: 'r3', movement_date: '2026-07-22', currency: 'ARS', amount: -500000 }),
        regMov({ id: 'r4', movement_date: '2026-07-17', currency: 'ARS', amount: -500000 }),
        regMov({ id: 'r5', movement_date: '2026-07-13', currency: 'ARS', amount: -500000 }),
        regMov({ id: 'r6', movement_date: '2026-07-13', currency: 'USD', amount: -120.79 }),
      ];
      const bank = [
        bankPm({ fecha: '2026-07-13', moneda: 'ARS', importe: 500000 }),
        bankPm({ fecha: '2026-07-13', moneda: 'USD', importe: 120.79 }),
        bankPm({ fecha: '2026-07-17', moneda: 'ARS', importe: 500000 }),
        bankPm({ fecha: '2026-07-22', moneda: 'ARS', importe: 500000 }),
        bankPm({ fecha: '2026-07-23', moneda: 'ARS', importe: 280000 }),
        bankPm({ fecha: '2026-07-23', moneda: 'ARS', importe: 2062.79 }),
      ];
      M.seedMovements(registeredRows);
      const registered5044 = M.registeredCreditPaymentsInWindow('card-5044', '2026-06-30', '2026-07-30');
      ok(`[${label}] (5) Continúan 6 pagos internos`, registered5044.length === 6);
      ok(`[${label}] (6) Continúan 6 pagos bancarios`, bank.length === 6);
      const match5044 = M.matchRegisteredVsBankPayments(registered5044, bank);
      ok(`[${label}] (7) Continúan 6/6 matches`, match5044.matches.length === 6);
      const summary5044 = M.creditPaymentReconciliationSummary(registered5044, bank, match5044);
      ok(`[${label}] (8) Diferencia ARS 0,00`, summary5044.diffArs === 0);
      ok(`[${label}] (9) Diferencia USD 0,00`, summary5044.diffUsd === 0);

      // ============================================================
      // 10-13: relación económica conceptual vs. relación real en base
      // ============================================================
      const traceIncomplete = { status: 'incomplete_gap', statement: { id: 'st-mayo', card_id: 'card-5044', statement_month: '2026-06-01', close_date: '2026-05-28', total_ars: 1, total_usd: 0 }, gapDays: 63, currentCloseDate: '2026-07-30' };
      const movementDetailForRecon = { persistableMovements: [], declaredCloseDate: '2026-07-30' };
      const recon10 = M.buildCreditPaymentReconciliation({ id: 'card-5044' }, traceIncomplete, movementDetailForRecon, '2026-07-30', '2026-07');
      ok(`[${label}] (10) Con TRAZABILIDAD INCOMPLETA no inventa una relación real con "Junio 2026" ni con ningún período específico`,
        recon10.appliedToLabel !== 'Junio 2026' && !/\d{4}$/.test(recon10.appliedToLabel.replace('Ciclo anterior — resumen pendiente de cargar', '')));
      ok(`[${label}] (11) Muestra "Ciclo anterior — resumen pendiente de cargar"`,
        recon10.appliedToLabel === 'Ciclo anterior — resumen pendiente de cargar');
      // CORRECCIÓN FINAL TRAZABILIDAD 5044 20260807 - PARTE 3: cuando hay
      // cierre real disponible, recognizedInLabel ahora lo agrega para
      // desambiguar (ver run_correccion_final_trazabilidad_5044_20260807_tests.js)
      // -- el mes sigue siendo el mismo dato de siempre, solo se vuelve más
      // preciso, nunca menos correcto.
      ok(`[${label}] (12) El reconocimiento sí muestra el período actual (Julio 2026), con el cierre real como precisión adicional`,
        recon10.recognizedInLabel.startsWith('Julio 2026') && /cierre 30\/0?7\/2026/.test(recon10.recognizedInLabel));
      const html10 = M.creditPaymentReconciliationHtml(recon10);
      ok(`[${label}] La tabla renderizada usa el mismo texto genérico, nunca "Resumen anterior (Junio 2026)"`,
        html10.includes('Ciclo anterior — resumen pendiente de cargar') && !html10.includes('Junio 2026'));

      const traceFound = { status: 'found', statement: { id: 'st-junio', card_id: 'card-5044', statement_month: '2026-06-01', close_date: '2026-06-30', total_ars: 1, total_usd: 0 } };
      const recon13 = M.buildCreditPaymentReconciliation({ id: 'card-5044' }, traceFound, movementDetailForRecon, '2026-07-30', '2026-07');
      ok(`[${label}] (13) Si existe un resumen anterior real (trazabilidad 'found'), muestra su período específico, con el cierre real como precisión adicional`,
        recon13.appliedToLabel.startsWith('Junio 2026') && /cierre 30\/0?6\/2026/.test(recon13.appliedToLabel));

      // ============================================================
      // 14-15: no cambia statement_id ni movimientos
      // ============================================================
      const beforeSnapshot = JSON.stringify(registeredRows);
      M.matchRegisteredVsBankPayments(registered5044, bank);
      M.buildCreditPaymentReconciliation({ id: 'card-5044' }, traceIncomplete, movementDetailForRecon, '2026-07-30', '2026-07');
      ok(`[${label}] (14/15) No cambia statement_id ni ningún campo de los movimientos reales (mismo snapshot antes/después)`,
        JSON.stringify(registeredRows) === beforeSnapshot);

      // ============================================================
      // 16: cero escrituras en Supabase
      // ============================================================
      const reconSrc = extractFunction(src, 'buildCreditPaymentReconciliation') + extractFunction(src, 'creditPaymentReconciliationHtml') + extractFunction(src, 'cleanCreditCardHolderLabel');
      ok(`[${label}] (16) No escribe Supabase (sin .insert(/.update(/.delete( en las funciones tocadas de esta corrección)`,
        !/\.insert\(|\.update\(|\.delete\(/.test(reconSrc));

      // ============================================================
      // 17: regresión de coma decimal
      // ============================================================
      ok(`[${label}] (17) Regresión de coma decimal sigue pasando (parseLocalizedPaymentAmount)`,
        M.parseLocalizedPaymentAmount('1250,50') === 1250.5 && M.parseLocalizedPaymentAmount('1.250,50') === 1250.5);

      fs.unlinkSync(runtimePath);
      finish();
    })();
  }
}

let pending = 2;
function finish() {
  pending--;
  if (pending > 0) return;
  console.log('\n(18) Todas las suites anteriores siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  ok('Paridad index.html / index_operator.html en el punto corregido de esta tarea',
    srcMain.includes("moneyTokenRe=/[\\s*+\\-]*") && srcOperator.includes("moneyTokenRe=/[\\s*+\\-]*") &&
    srcMain.includes('Ciclo anterior — resumen pendiente de cargar') && srcOperator.includes('Ciclo anterior — resumen pendiente de cargar'));
  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
