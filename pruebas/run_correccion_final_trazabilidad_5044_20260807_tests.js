// CORRECCIÓN FINAL DE TRAZABILIDAD 5044 — 20260807
// El statement 02/07 existe pero la vista manual real seguía eligiendo
// 28/05 como "último resumen disponible" -- causa real: contextStatement
// (preseleccionado en pantalla, el 02/07, el único existente antes de
// cargar el PDF de 30/07) se pasaba ciegamente como "statement actual" a
// loadPreviousCreditStatementTrace, que lo EXCLUÍA de los candidatos a
// "resumen anterior" aunque no fuera el mismo resumen (distinto
// close_date). Corregido: solo se excluye cuando el contextStatement
// realmente representa el PDF actual (mismo close_date real).
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// -- las pruebas de trazabilidad corren el MISMO camino de renderizado
// que usa la vista previa manual (processCreditStatementFile end-to-end
// en modo preview + directStatementResultHtml/creditPreviewTraceabilityHtml/
// creditPaymentReconciliationHtml reales), no solo las funciones puras
// aisladas. Doble local completo de Supabase -- nunca se conecta al
// Supabase real, nunca usa una base productiva.
//
// node pruebas/run_correccion_final_trazabilidad_5044_20260807_tests.js
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

const ENGINE_FUNCTIONS = [
  'isCreditLocalPreviewMode', 'assertCreditWriteAllowed', 'canAccessTarjetas',
  'creditStorageOwnerId', 'findMatchingCreditDocument', 'uploadCreditDocument', 'receiptFileIsAcceptable',
  'normalizeCreditDocumentName', 'creditDocumentDisplayName',
  'buildFinancialReviewNotes', 'financialReviewStatusFor',
  'buildCreditStatementNotes', 'creditStatementUserNotes', 'creditStatementMeta',
  'creditStatementParserKey', 'findStatementForPeriod', 'normalizeCreditStatementPeriod',
  'isDuplicateStatementError', 'historicalUploadErrorMessage', 'periodDate',
  'buildCreditMovementNotes', 'creditDocumentErrorMessage',
  'creditDocumentsForStatement', 'creditStatementOriginalDoc', 'deleteCreditDocument',
  'validateStatementAgainstCard', 'creditBrandFamily', 'creditIssuerFamily', 'normalizePlainText',
  'monthLabel', 'creditCardName', 'cardBrandLabel', 'monthKey', 'shiftMonth',
  'buildPreviewMovementDetail', 'creditPreviewStatusLabels',
  'loadPreviousCreditStatementTrace', 'creditPreviewTraceEvaluation',
  'creditMovementMeta', 'creditMovementType', 'creditStatementLabel',
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'buildPaymentMatchRows',
  'describeExistingCreditStatementState', 'existingManualPaymentsForCard',
  'fmtDate', 'esc', 'formatARS', 'formatUSD', 'fmtUsd',
  'resolveCreditStatementCycleBySequence', 'resolveCreditStatementCycle',
  'resolveCreditStatementWriteTarget', 'creditWriteTargetLabel',
  'creditPreviewMovementTableHtml', 'creditPreviewGroupedConsumptionsHtml',
  'creditPreviewSimpleTableHtml', 'creditPreviewCompositionHtml', 'creditPreviewDetailHtml',
  'creditPreviewTraceabilityHtml', 'directStatementResultHtml', 'creditPaymentReconciliationHtml',
  'processCreditStatementFile',
];
const RECONCILE_FUNCTIONS = [
  'parseArgMoney', 'roundMoney', 'sumVisaStatementMovements', 'sumSignedStatementMovements',
  'buildCreditReconcileBreakdown', 'creditResolveDeclaredDates', 'creditResolveCarryInfo',
  'reconcileCreditStatementTotals', 'parseSpanishAbbrevDate', 'resolveMonthDayToDate', 'parseSpanishDayMonth',
];

function buildEngineRuntime(src) {
  let code = extractConst(src, 'CREDIT_STATEMENT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_META_PREFIX') + '\n';
  code += extractConst(src, 'RECEIPT_ALLOWED_MIME') + '\n';
  code += extractConst(src, 'RECEIPT_ALLOWED_EXT') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_PARSER_VERSION') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS') + '\n';
  code += extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'ISSUER_FAMILY_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_DATE_CONFIDENCE_LABELS') + '\n';
  for (const n of RECONCILE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };

// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema, nunca la lógica que
// esta corrección modifica. buildExistingSnapshot/buildMovementDetailAnalysis
// (motor de fechas/matching de movimientos, ya probado por separado en
// run_resumenes_trazabilidad_20260805_tests.js) se controlan con un plan
// explícito, mismo patrón usado en toda esta serie.
// ============================================================
let creditCardAccessGranted = true;
let session = { user: { id: 'uuid-guido' } };
let location = { hostname: 'guidorpm.github.io' };
function canRepairCreditDocuments(){ return true; }
function toast(){ return undefined; }
async function refreshDashboardData(){ return undefined; }
function confirm(){ return true; }

let __movementPlan = { movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] };
function buildExistingSnapshot(card, period) { return { card, period }; }
function buildMovementDetailAnalysis(item, snapshot) { return __movementPlan; }

let db, callLog, forceErrors;
function resetMockBackend() {
  db = { credit_card_statements: [], documents: [], credit_card_movements: [] };
  callLog = [];
  forceErrors = [];
}
resetMockBackend();

class FakeBuilder {
  constructor(table, op, payload) { this.table = table; this.op = op; this.payload = payload; this._filters = {}; }
  eq(field, value) { this._filters[field] = value; return this; }
  select() { return this; }
  single() { return this._resolve(true); }
  then(resolve, reject) { this._resolve(false).then(resolve, reject); }
  async _resolve(wantSingle) {
    callLog.push({ op: this.op, table: this.table, payload: this.payload, filters: { ...this._filters } });
    const forcedIdx = forceErrors.findIndex(f => f.table === this.table && f.op === this.op && (!f.match || f.match(this.payload, this._filters)));
    if (forcedIdx !== -1) {
      const forced = forceErrors[forcedIdx];
      if (forced.consumeOnce) forceErrors.splice(forcedIdx, 1);
      return { data: null, error: forced.error };
    }
    if (this.op === 'insert') {
      const rowsToInsert = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rowsToInsert.map((p, idx) => ({ id: 'mock-' + this.table + '-' + (db[this.table].length + 1 + idx), created_at: new Date(Date.now() + db[this.table].length + idx).toISOString(), ...p }));
      db[this.table].push(...inserted);
      return wantSingle ? { data: inserted[0], error: null } : { data: inserted, error: null };
    }
    if (this.op === 'update') {
      const rows = db[this.table].filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      rows.forEach(r => Object.assign(r, this.payload));
      return { data: wantSingle ? rows[0] : rows, error: null };
    }
    if (this.op === 'delete') {
      db[this.table] = db[this.table].filter(r => !Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return { data: null, error: null };
    }
    if (this.op === 'select') {
      const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return wantSingle ? { data: rows[0] || null, error: null } : { data: rows, error: null };
    }
    return { data: null, error: null };
  }
}
let sb = {
  from(table) {
    return {
      select: (cols) => new FakeBuilder(table, 'select', null),
      insert: (payload) => new FakeBuilder(table, 'insert', payload),
      update: (payload) => new FakeBuilder(table, 'update', payload),
      delete: () => new FakeBuilder(table, 'delete', null),
    };
  },
  storage: {
    from(bucket) {
      return {
        upload: async (filePath) => { callLog.push({ op: 'storage.upload', bucket, filePath }); return { error: null }; },
        remove: async (paths) => { callLog.push({ op: 'storage.remove', bucket, paths }); return { error: null }; },
        download: async (filePath) => { callLog.push({ op: 'storage.download', bucket, filePath }); return { data: null, error: new Error('mock: sin descarga') }; },
        list: async (folderPath) => { callLog.push({ op: 'storage.list', bucket, folderPath }); return { data: [], error: null }; },
      };
    },
  },
  rpc: async () => ({ data: null, error: null }),
};

let creditDocuments = [];
let creditStatements = [];
let creditMovements = [];
let creditCards = [];
async function loadCreditCardsData() {
  creditDocuments = db.documents.slice();
  creditStatements = db.credit_card_statements.slice();
  creditMovements = db.credit_card_movements.slice();
}

let __financialResult = null;
async function runCreditStatementFinancialCheck(file, identity, period) { return __financialResult; }
let __fileHash = 'mockhash0000000000000000000000000000000000000000000000000000';
async function computeFileHash(file) { return __fileHash; }
let __storedHashByPath = new Map();
async function computeStoredFileHash(filePath) { return __storedHashByPath.get(filePath) || null; }

module.exports = {
  isCreditLocalPreviewMode, canAccessTarjetas, processCreditStatementFile,
  findStatementForPeriod, describeExistingCreditStatementState,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  directStatementResultHtml, creditPreviewTraceabilityHtml, creditPaymentReconciliationHtml,
  setLocation: (host) => { location.hostname = host; },
  setAccess: (granted) => { creditCardAccessGranted = granted; },
  setSession: (uid) => { session = { user: { id: uid } }; },
  setFinancialResult: (fr) => { __financialResult = fr; },
  setFileHash: (h) => { __fileHash = h; },
  setMovementPlan: (plan) => { __movementPlan = plan; },
  resetMockBackend: () => { resetMockBackend(); creditDocuments = []; creditStatements = []; creditMovements = []; creditCards = []; },
  getDb: () => db,
  getCallLog: () => callLog,
  getCreditStatements: () => creditStatements,
  getCreditMovements: () => creditMovements,
  seedCard: (card) => { creditCards.push(card); },
  seedDocuments: (docs) => { creditDocuments = docs; db.documents = docs.slice(); },
  seedStatements: (stmts) => { creditStatements = stmts; db.credit_card_statements = stmts.slice(); },
  seedMovements: (movs) => { creditMovements = movs; db.credit_card_movements = movs.slice(); },
};
`;
  return code;
}

function makeFile(name, { size = 1000, type = 'application/pdf' } = {}) {
  return { name, size, type, arrayBuffer: async () => new ArrayBuffer(size) };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

let seq = 0;
function regMov(overrides) {
  seq++;
  return Object.assign({
    id: 'reg-' + seq, card_id: 'card-5044', currency: 'ARS', amount: -1000,
    movement_date: '2026-07-05', statement_id: 'st-0207',
    notes: '[[CREDIT_META:{"movementType":"payment","source":"manual_payment","appliesToCurrentStatement":true}]]',
  }, overrides);
}
function bankPm(overrides) {
  seq++;
  return Object.assign({
    fecha: '2026-07-05', fechaConfianza: 'alta', descripcionOriginal: 'SU PAGO EN PESOS',
    moneda: 'ARS', importe: 1000, categoriaParserOriginal: 'payment', categoria: 'pago',
    cardLast4: '5044', cardHolderLabel: 'GUIDO NICOLAS RIZZO', installment: null, firma: 'bank-' + seq,
  }, overrides);
}
function sixBankPayments() {
  return [
    bankPm({ fecha: '2026-07-13', importe: 120.79, moneda: 'USD' }),
    bankPm({ fecha: '2026-07-13', importe: 500000, moneda: 'ARS' }),
    bankPm({ fecha: '2026-07-17', importe: 500000, moneda: 'ARS' }),
    bankPm({ fecha: '2026-07-22', importe: 500000, moneda: 'ARS' }),
    bankPm({ fecha: '2026-07-23', importe: 2062.79, moneda: 'ARS' }),
    bankPm({ fecha: '2026-07-25', importe: 280000, moneda: 'ARS' }),
  ];
}
function sixManualPayments() {
  return [
    regMov({ id: 'r1', movement_date: '2026-07-13', currency: 'USD', amount: -120.79 }),
    regMov({ id: 'r2', movement_date: '2026-07-13', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r3', movement_date: '2026-07-17', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r4', movement_date: '2026-07-22', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r5', movement_date: '2026-07-23', currency: 'ARS', amount: -2062.79 }),
    regMov({ id: 'r6', movement_date: '2026-07-25', currency: 'ARS', amount: -280000 }),
  ];
}

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_finaltraza5044_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };

    // ============================================================
    // (1-3) setup: statement 28/05 existente, statement 02/07 existente
    // SIN documento, PDF actual con cierre 30/07 -- exactamente el
    // caso real reportado.
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedStatements([
      { id: 'st-2805', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-05-01', close_date: '2026-05-28', due_date: '2026-06-10', status: 'paid', total_ars: 999999, total_usd: 0, notes: '[[CREDIT_STATEMENT_META:{}]]' },
      { id: 'st-0207', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 2063211.91, total_usd: 120.79, notes: '[[CREDIT_STATEMENT_META:{}]]' },
    ]);
    ok(`[${label}] (1) Statement 28/05 existe en la base de prueba`, M.getCreditStatements().some(s => s.id === 'st-2805'));
    ok(`[${label}] (2) Statement 02/07 existe, SIN documento (kind='statement') vinculado`, M.getCreditStatements().some(s => s.id === 'st-0207'));
    const sixPayments = sixManualPayments();
    M.seedMovements(sixPayments);

    const financial5044 = {
      valid: true,
      totals: { statementArs: 1782062.79, calculatedArs: 1782062.79, diffArs: 0, statementUsd: 120.79, calculatedUsd: 120.79, diffUsd: 0 },
      breakdown: { saldoAnterior: 2063211.91, saldoAnteriorUsd: 120.79, consumosArs: 12000, consumosUsd: 0 },
      movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
      declaredPreviousBalanceArs: 2063211.91, declaredPreviousBalanceUsd: 120.79,
    };
    M.setFinancialResult(financial5044);
    M.setFileHash('hash-5044-3007-preview');
    const consumos12 = Array.from({ length: 12 }, (_, i) => ({
      categoriaParserOriginal: 'purchase', fecha: `2026-07-${String(2 + i).padStart(2, '0')}`, fechaConfianza: 'alta',
      moneda: 'ARS', importe: -(1000 + i * 10), descripcionOriginal: `COMERCIO ${i + 1}`, cardLast4: '5044', cardHolderLabel: 'GUIDO NICOLAS RIZZO', installment: null, firma: 'c' + i,
    }));
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, persistableMovements: [...consumos12, ...sixBankPayments()], plannedMovementInserts: [] });

    // Simula EXACTAMENTE el bug real: la pantalla ya tenía preseleccionado
    // el resumen 02/07 (único existente) como contextStatement al abrir
    // "Subir resumen" para el PDF de cierre 30/07 -- mismo período
    // ('2026-07'), close_date DISTINTO.
    const rPreview = await M.processCreditStatementFile(makeFile('resumen5044_30jul.pdf'), CARD_5044, {
      previewOnly: true, statementId: 'st-0207',
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (3) El PDF actual (cierre 30/07) se analiza en vista previa sin escribir nada`, rPreview.stage === 'preview_complete');

    // ============================================================
    // (4/6) resolver anterior = 02/07, no 28/05; no informa gap
    // inexistente.
    // ============================================================
    ok(`[${label}] (4) El resolver de trazabilidad elige 02/07 como resumen anterior, NUNCA 28/05`,
      rPreview.previousTrace.status === 'found' && rPreview.previousTrace.statement.id === 'st-0207');
    ok(`[${label}] (6) No informa un salto/gap inexistente (28 días reales, muy por debajo del umbral) -- nunca dice "TRAZABILIDAD INCOMPLETA" por un gap falso`,
      rPreview.previousTraceEvaluation.state !== 'incomplete_gap');

    // ============================================================
    // (5) la ausencia de PDF no elimina el statement de la trazabilidad
    // ============================================================
    ok(`[${label}] (5) La ausencia de PDF vinculado NO hace desaparecer el statement 02/07 de la trazabilidad`,
      rPreview.previousTraceEvaluation.previousStatement && rPreview.previousTraceEvaluation.previousStatement.id === 'st-0207');

    // ============================================================
    // (7/8/9) appliedTo usa cierre 02/07; recognizedIn usa cierre 30/07;
    // ambos pueden pertenecer a Julio 2026 sin colisionar (desambiguados
    // por el cierre real, no por el mes).
    // ============================================================
    const appliedTo = rPreview.paymentReconciliation.appliedToLabel;
    const recognizedIn = rPreview.paymentReconciliation.recognizedInLabel;
    // fmtDate() delega en toLocaleDateString('es-AR'); el motor ICU de esta
    // máquina de pruebas no rellena con ceros (es-AR real en navegador sí
    // lo hace) -- se toleran ambos formatos, el contenido semántico (2/7 y
    // 30/7 de 2026) es lo que importa.
    ok(`[${label}] (7) "Aplicado a" usa el cierre real del resumen anterior (02/07/2026)`, /cierre 0?2\/0?7\/2026/.test(appliedTo));
    ok(`[${label}] (8) "Reconocido en" usa el cierre real del PDF actual (30/07/2026)`, /cierre 30\/0?7\/2026/.test(recognizedIn));
    // CORRECCIÓN DEFINITIVA DE CICLO 20260807 - esta suite fija identity.period
    // manualmente en '2026-07' (sin periodSource:'explicit'), así que ahora
    // resolveCreditStatementCycle prioriza la secuencia real de la tarjeta
    // (Julio + 1 mes = Agosto) por encima de ese valor débil -- exactamente
    // la corrección de la etapa siguiente. Ya NO colisionan por mes (antes sí,
    // y por eso hacía falta el cierre para distinguirlos); ahora tampoco
    // colisionan por mes NI por cierre -- ambas señales, cada vez más
    // correctas, siguen sin colisionar nunca.
    ok(`[${label}] (9) "Aplicado a" (Julio 2026, el resumen anterior real) y "Reconocido en" (Agosto 2026, el ciclo correctamente avanzado) nunca colisionan`,
      appliedTo.startsWith('Julio 2026') && recognizedIn.startsWith('Agosto 2026') && appliedTo !== recognizedIn);

    // ============================================================
    // (10) trazabilidad documental incompleta por PDF faltante (nunca
    // por falta de statement).
    // ============================================================
    ok(`[${label}] (10) Trazabilidad documental incompleta exclusivamente por PDF pendiente, statement real reconocido`,
      rPreview.previousTraceEvaluation.documentalStatus && rPreview.previousTraceEvaluation.documentalStatus.code === 'documento_pendiente');
    const traceHtml = M.creditPreviewTraceabilityHtml(rPreview);
    ok(`[${label}] Mismo camino de renderizado real: el HTML de trazabilidad muestra el aviso de PDF pendiente`,
      /PDF anterior: pendiente\/no vinculado/.test(traceHtml) && /Trazabilidad documental: incompleta/.test(traceHtml));
    ok(`[${label}] Mismo camino de renderizado real: el HTML de trazabilidad nunca menciona 28/05 ni un intervalo falso de 63 días`,
      !traceHtml.includes('28/5/2026') && !traceHtml.includes('28/05/2026') && !traceHtml.includes('63 días'));
    const fullResultHtml = M.directStatementResultHtml(rPreview) + M.creditPreviewTraceabilityHtml(rPreview) + M.creditPaymentReconciliationHtml(rPreview.paymentReconciliation);
    ok(`[${label}] Mismo camino de renderizado real: directStatementResultHtml()+trazabilidad (el que usa la vista previa manual) refleja el resumen anterior real (02/07) y nunca 28/05`,
      /0?2\/0?7\/2026/.test(fullResultHtml) && !fullResultHtml.includes('28/5/2026') && !fullResultHtml.includes('28/05/2026'));

    // ============================================================
    // (11-13) conciliación sigue 6/6, diferencia ARS 0, diferencia USD 0.
    // ============================================================
    ok(`[${label}] (11) Conciliación sigue 6/6`, rPreview.paymentReconciliation.matchResult.matches.length === 6);
    ok(`[${label}] (12) Diferencia ARS 0,00`, rPreview.paymentReconciliation.summary.diffArs === 0);
    ok(`[${label}] (13) Diferencia USD 0,00`, rPreview.paymentReconciliation.summary.diffUsd === 0);

    // ============================================================
    // (14-16) no cambia ningún statement_id, pago ni movimiento (vista
    // previa: cero escrituras).
    // ============================================================
    ok(`[${label}] (14) No cambia ningún statement_id (los 2 statements sembrados siguen exactamente iguales, sin altas/bajas/updates)`,
      M.getDb().credit_card_statements.length === 2 &&
      M.getDb().credit_card_statements.find(s => s.id === 'st-0207').close_date === '2026-07-02' &&
      M.getDb().credit_card_statements.find(s => s.id === 'st-2805').close_date === '2026-05-28');
    ok(`[${label}] (15) No cambia ningún pago (los 6 pagos manuales sembrados siguen exactamente iguales, sin altas/bajas/updates)`,
      M.getDb().credit_card_movements.length === 6 &&
      sixPayments.every(p => M.getDb().credit_card_movements.some(m => m.id === p.id && m.amount === p.amount)));
    ok(`[${label}] (16) No cambia ningún movimiento -- cero operaciones de escritura en la bitácora`,
      M.getCallLog().filter(c => ['insert', 'update', 'delete', 'storage.upload', 'storage.remove'].includes(c.op)).length === 0);

    // ============================================================
    // (17) 8374 no se rompe
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ id: 'st-8374-jun', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-06-30', due_date: '2026-07-10', status: 'paid', total_ars: 1, total_usd: 0 }]);
    const trace8374 = await M.loadPreviousCreditStatementTrace('card-8374', null, '2026-07-30', 'uuid-guido');
    ok(`[${label}] (17) 8374 no se rompe: sigue encontrando su resumen anterior real (Junio 2026) correctamente`,
      trace8374.status === 'found' && trace8374.statement.id === 'st-8374-jun');

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(18) Todas las suites anteriores siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = [
    'const contextIsSameCloseDate=!!(contextStatement&&contextStatement.close_date&&financialResult?.declaredCloseDate&&',
    'contextIsSameCloseDate?contextStatement.id:null',
    '${creditStatementLabel(documentedPreviousStatement)} — cierre ${documentedPreviousStatement.close_date?fmtDate(documentedPreviousStatement.close_date):',
  ];
  ok('Paridad index.html / index_operator.html en la corrección final de trazabilidad', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
