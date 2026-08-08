// CORRECCIÓN DE IDENTIDAD DE RESÚMENES — 5044 — 20260807
// Una misma tarjeta puede tener dos cierres reales dentro del mismo mes
// calendario (caso real: Visa 5044, close_date 02/07/2026 vs. PDF con
// cierre 30/07/2026, ambos statement_month='2026-07'). La identidad de
// un resumen debe usar close_date real primero, mes calendario solo
// como fallback histórico -- nunca confundir dos resúmenes distintos.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local completo de Supabase (bitácora de llamadas incluida)
// -- nunca se conecta al Supabase real. No usa ninguna base productiva.
//
// node pruebas/run_identidad_statement_closedate_20260807_tests.js
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
  'creditMovementMeta', 'creditMovementType', 'creditStatementLabel', 'fmtDate',
  'resolveCreditStatementCycleBySequence', 'resolveCreditStatementCycle',
  'resolveCreditStatementWriteTarget', 'creditWriteTargetLabel',
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'buildPaymentMatchRows',
  'describeExistingCreditStatementState', 'existingManualPaymentsForCard',
  'processCreditStatementFile',
];
const RECONCILE_FUNCTIONS = [
  'parseArgMoney', 'roundMoney', 'sumVisaStatementMovements', 'sumSignedStatementMovements',
  'buildCreditReconcileBreakdown', 'creditResolveDeclaredDates', 'creditResolveCarryInfo',
  'reconcileCreditStatementTotals', 'parseSpanishAbbrevDate', 'resolveMonthDayToDate', 'parseSpanishDayMonth',
];
const PARSE_HELPER_FUNCTIONS = ['parseLocalizedPaymentAmount'];

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
  for (const n of RECONCILE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of PARSE_HELPER_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };

// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema, nunca la lógica que
// esta corrección modifica.
// ============================================================
let creditCardAccessGranted = true;
let session = { user: { id: 'uuid-guido' } };
let location = { hostname: 'guidorpm.github.io' };
function canRepairCreditDocuments(){ return true; }
function toast(){ return undefined; }
async function refreshDashboardData(){ return undefined; }
function confirm(){ return true; }

let __movementPlan = { movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, plannedMovementInserts: [] };
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
      // Soporta insert de UN objeto (statement/documento) Y de un ARRAY
      // (movimientos en lotes de 75).
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
  validateStatementAgainstCard, deleteCreditDocument,
  findStatementForPeriod, describeExistingCreditStatementState, existingManualPaymentsForCard,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  registeredCreditPaymentsInWindow, bankRecognizedPaymentsFromPreview,
  matchRegisteredVsBankPayments, creditPaymentReconciliationSummary,
  parseLocalizedPaymentAmount, loadCreditCardsData,
  setLocation: (host) => { location.hostname = host; },
  setAccess: (granted) => { creditCardAccessGranted = granted; },
  setSession: (uid) => { session = { user: { id: uid } }; },
  setCanRepair: (v) => { canRepairCreditDocuments = () => v; },
  setFinancialResult: (fr) => { __financialResult = fr; },
  setFileHash: (h) => { __fileHash = h; },
  setStoredHash: (filePath, h) => { __storedHashByPath.set(filePath, h); },
  setMovementPlan: (plan) => { __movementPlan = plan; },
  setForceError: (entry) => { forceErrors.push(entry); },
  resetMockBackend: () => { resetMockBackend(); creditDocuments = []; creditStatements = []; creditMovements = []; creditCards = []; },
  getDb: () => db,
  getCallLog: () => callLog,
  getCreditDocuments: () => creditDocuments,
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
function consumoMov(overrides) {
  seq++;
  return Object.assign({
    id: 'cons-' + seq, card_id: 'card-5044', currency: 'ARS', amount: -1500,
    movement_date: '2026-07-05', statement_id: 'st-0207',
    notes: '[[CREDIT_META:{"movementType":"purchase","source":"process_credit_statement_file"}]]',
  }, overrides);
}
function bankPm(overrides) {
  return Object.assign({ fecha: '2026-07-05', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 1000 }, overrides);
}

// Statement real 02/07/2026 (caso real 5044 confirmado por SELECT).
function seedStatement0207(M) {
  M.seedStatements([{
    id: 'st-0207', card_id: 'card-5044', owner_id: 'uuid-guido',
    statement_month: '2026-07-01', close_date: '2026-07-02', due_date: '2026-07-13',
    status: 'paid', total_ars: 2063211.91, total_usd: 120.79,
    notes: '[[CREDIT_STATEMENT_META:{}]]',
  }]);
}
function seedSixManualPayments() {
  return [
    regMov({ id: 'r1', movement_date: '2026-07-13', currency: 'USD', amount: -120.79 }),
    regMov({ id: 'r2', movement_date: '2026-07-13', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r3', movement_date: '2026-07-17', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r4', movement_date: '2026-07-22', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r5', movement_date: '2026-07-23', currency: 'ARS', amount: -2062.79 }),
    regMov({ id: 'r6', movement_date: '2026-07-25', currency: 'ARS', amount: -280000 }),
  ];
}
function bank5044Fixture() {
  return [
    bankPm({ fecha: '2026-07-13', moneda: 'USD', importe: 120.79 }),
    bankPm({ fecha: '2026-07-13', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-17', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-22', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-23', moneda: 'ARS', importe: 2062.79 }),
    bankPm({ fecha: '2026-07-25', moneda: 'ARS', importe: 280000 }),
  ];
}

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_identidad_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };

    // ============================================================
    // (1/2) misma tarjeta + mismo mes + distinta close_date = statements
    // diferentes; 02/07 y 30/07 no colisionan.
    // ============================================================
    M.resetMockBackend();
    seedStatement0207(M);
    const lookup30 = M.findStatementForPeriod('card-5044', '2026-07', '2026-07-30');
    ok(`[${label}] (1) Misma tarjeta + mismo mes + distinta close_date real -> NO son el mismo statement`,
      lookup30.match === null && lookup30.ambiguous === false);
    ok(`[${label}] (2) 02/07 y 30/07 no colisionan (el statement de 02/07 sigue existiendo, intacto)`,
      M.getCreditStatements().length === 1 && M.getCreditStatements()[0].close_date === '2026-07-02');

    // ============================================================
    // (3) mismo PDF 30/07 reprocesado sí se reconoce como el mismo
    // ============================================================
    M.seedStatements([...M.getCreditStatements(), {
      id: 'st-3007', card_id: 'card-5044', owner_id: 'uuid-guido',
      statement_month: '2026-07-01', close_date: '2026-07-30', due_date: '2026-08-10',
      status: 'open', total_ars: 1782062.79, total_usd: 120.79, notes: '[[CREDIT_STATEMENT_META:{}]]',
    }]);
    const lookupReproc = M.findStatementForPeriod('card-5044', '2026-07', '2026-07-30');
    ok(`[${label}] (3) El mismo PDF 30/07 reprocesado SÍ se reconoce como el mismo statement (st-3007)`,
      lookupReproc.match && lookupReproc.match.id === 'st-3007' && !lookupReproc.ambiguous);

    // ============================================================
    // (4) statement histórico sin close_date mantiene fallback seguro
    // ============================================================
    M.resetMockBackend();
    M.seedStatements([{ id: 'st-historico', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-03-01', close_date: null, due_date: '2026-04-10', status: 'paid', total_ars: 1, total_usd: 0 }]);
    const lookupHist = M.findStatementForPeriod('card-5044', '2026-03', '2026-03-30');
    ok(`[${label}] (4) Statement histórico sin close_date mantiene el fallback por mes calendario`,
      lookupHist.match && lookupHist.match.id === 'st-historico');

    // ============================================================
    // (5) no se duplica ningún statement existente al procesar 30/07
    // (motor completo, doble de Supabase con bitácora).
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    seedStatement0207(M);
    const sixPayments = seedSixManualPayments();
    M.seedMovements(sixPayments);
    const reliableFinancial5044 = {
      valid: true,
      totals: { statementArs: 1782062.79, calculatedArs: 1782062.79, diffArs: 0, statementUsd: 120.79, calculatedUsd: 120.79, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
      declaredPreviousBalanceArs: null, declaredPreviousBalanceUsd: null,
    };
    M.setFinancialResult(reliableFinancial5044);
    M.setFileHash('hash-5044-3007');
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-05', descripcionOriginal: 'COMERCIO NUEVO', moneda: 'ARS', importe: -1000, categoria: 'purchase' },
    ] });
    const rProc = await M.processCreditStatementFile(makeFile('resumen5044_30jul.pdf'), CARD_5044, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' } });
    ok(`[${label}] (5) No duplica ningún statement existente: sigue habiendo 2 statements de julio (02/07 real + 30/07 nuevo), nunca 1 fusionado ni 3`,
      M.getDb().credit_card_statements.length === 2 &&
      M.getDb().credit_card_statements.some(s => s.close_date === '2026-07-02') &&
      M.getDb().credit_card_statements.some(s => s.close_date === '2026-07-30'));
    ok(`[${label}] El PDF de 30/07 NUNCA se detecta como "resumen existente detectado" del statement de 02/07`,
      rProc.statementId !== 'st-0207');

    // ============================================================
    // (6) no se mueve ningún pago manual del statement anterior
    // ============================================================
    const stillLinkedToOldStatement = M.getDb().credit_card_movements.filter(m => sixPayments.some(p => p.id === m.id) && m.statement_id === 'st-0207');
    ok(`[${label}] (6) No se mueve ningún pago manual: los 6 siguen con statement_id='st-0207'`,
      stillLinkedToOldStatement.length === 6);

    // ============================================================
    // (7-10) los 6 pagos manuales del statement anterior siguen
    // conciliando contra el reconocimiento del resumen actual (30/07):
    // 6/6, diferencia ARS 0,00, diferencia USD 0,00.
    // ============================================================
    await M.loadCreditCardsData();
    const registeredWindow = M.registeredCreditPaymentsInWindow('card-5044', '2026-07-02', '2026-07-30');
    ok(`[${label}] (7) Los 6 pagos manuales del statement anterior (02/07) siguen disponibles para conciliar contra el resumen actual (30/07)`,
      registeredWindow.length === 6);
    const bank5044 = bank5044Fixture();
    const matchResult5044 = M.matchRegisteredVsBankPayments(registeredWindow, bank5044);
    const summary5044 = M.creditPaymentReconciliationSummary(registeredWindow, bank5044, matchResult5044);
    ok(`[${label}] (8) 5044 mantiene 6/6 conciliaciones`, matchResult5044.matches.length === 6);
    ok(`[${label}] (9) Diferencia ARS 0,00`, summary5044.diffArs === 0);
    ok(`[${label}] (10) Diferencia USD 0,00`, summary5044.diffUsd === 0);

    // ============================================================
    // (11) los movimientos del statement 02/07 no se consideran
    // movimientos del 30/07.
    // ============================================================
    const newStatementId = M.getDb().credit_card_statements.find(s => s.close_date === '2026-07-30').id;
    const movementsOfNewStatement = M.getDb().credit_card_movements.filter(m => m.statement_id === newStatementId);
    const oldMovementsLeakedIntoNew = movementsOfNewStatement.filter(m => sixPayments.some(p => p.id === m.id));
    ok(`[${label}] (11) Los movimientos del statement 02/07 (incluidos los 6 pagos) nunca se consideran movimientos del 30/07`,
      oldMovementsLeakedIntoNew.length === 0);

    // ============================================================
    // Parte 4 - trazabilidad: "resumen anterior registrado" (real, aunque
    // sin PDF) vs. "trazabilidad documental" (pendiente) se informan por
    // separado -- nunca se ignora el statement real, nunca se afirma
    // continuidad documental completa sin el archivo.
    // ============================================================
    const traceForNew = await M.loadPreviousCreditStatementTrace('card-5044', newStatementId, '2026-07-30', 'uuid-guido');
    ok(`[${label}] La trazabilidad encuentra el resumen anterior REAL (02/07), nunca lo ignora por no tener PDF`,
      traceForNew.status === 'found' && traceForNew.statement.id === 'st-0207');
    const evalForNew = M.creditPreviewTraceEvaluation(traceForNew, { declaredPreviousBalanceArs: null, declaredPreviousBalanceUsd: null });
    ok(`[${label}] Informa "PDF anterior: pendiente/no vinculado" (documentalStatus) sin negar que el statement anterior existe`,
      evalForNew.documentalStatus && evalForNew.documentalStatus.code === 'documento_pendiente' && evalForNew.previousStatement.id === 'st-0207');

    // ============================================================
    // (12) no se rompe 8374 (mismo criterio, sin segundo statement en
    // conflicto -- el camino histórico normal sigue intacto).
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    const lookup8374 = M.findStatementForPeriod('card-8374', '2026-07', '2026-07-30');
    ok(`[${label}] (12) 8374 sin statements previos: no rompe, simplemente no hay match (comportamiento normal de "resumen nuevo")`,
      lookup8374.match === null && lookup8374.ambiguous === false);
    M.seedStatements([{ id: 'st-8374-jul', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-30', due_date: '2026-08-10', status: 'open', total_ars: 1522105.32, total_usd: 10.10 }]);
    const lookup8374Match = M.findStatementForPeriod('card-8374', '2026-07', '2026-07-30');
    ok(`[${label}] 8374: reprocesar el mismo cierre real (30/07) sigue reconociendo el mismo statement`,
      lookup8374Match.match && lookup8374Match.match.id === 'st-8374-jul');

    // ============================================================
    // (13) regresión de coma decimal
    // ============================================================
    ok(`[${label}] (13) Regresión de coma decimal sigue pasando`,
      M.parseLocalizedPaymentAmount('1250,50') === 1250.5 && M.parseLocalizedPaymentAmount('1.250,50') === 1250.5);

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(14) Todas las suites anteriores siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = [
    'function findStatementForPeriod(cardId,period,declaredCloseDate)',
    'const byRealCloseDate=candidates.filter(s=>dayTime(s.close_date)===declaredTime)',
    "documentalStatus.code==='documento_pendiente'",
  ];
  ok('Paridad index.html / index_operator.html en la corrección de identidad', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
