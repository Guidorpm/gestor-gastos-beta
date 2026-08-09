// CIERRE DEFINITIVO DE TARJETAS — 20260806
// Validación central de identidad, período directo y versión vigente segura.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local completo de Supabase (bitácora de llamadas incluida)
// -- nunca se conecta al Supabase real.
//
// node pruebas/run_cierre_definitivo_tarjetas_20260806_tests.js
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
      const row = { id: 'mock-' + this.table + '-' + (db[this.table].length + 1), created_at: new Date(Date.now() + db[this.table].length).toISOString(), ...this.payload };
      db[this.table].push(row);
      return wantSingle ? { data: row, error: null } : { data: [row], error: null };
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
  seedCard: (card) => { creditCards.push(card); },
  seedDocuments: (docs) => { creditDocuments = docs; db.documents = docs.slice(); },
  seedStatements: (stmts) => { creditStatements = stmts; db.credit_card_statements = stmts.slice(); },
};
`;
  return code;
}

function makeFile(name, { size = 1000, type = 'application/pdf' } = {}) {
  return { name, size, type, arrayBuffer: async () => new ArrayBuffer(size) };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_cierre_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    const reliableFinancial = {
      valid: true, totals: { statementArs: 985251.36, calculatedArs: 985251.36, diffArs: 0, statementUsd: 10.1, calculatedUsd: 10.1, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    };
    const unreliableFinancial = {
      valid: false, reason: 'mismatch', totals: { statementArs: 500, calculatedArs: 999, diffArs: 499, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    };

    // ============================================================
    // IDENTIDAD (1-6)
    // ============================================================
    const engineSrc = extractFunction(src, 'processCreditStatementFile');
    ok(`[${label}] (1) processCreditStatementFile llama a validateStatementAgainstCard`, /validateStatementAgainstCard\(identity,card\)/.test(engineSrc));

    M.setLocation('guidorpm.github.io');
    M.setAccess(true);
    M.setSession('uuid-guido');

    // (2) 5044 no puede cargarse dentro de 8374
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.setFinancialResult(reliableFinancial);
    const r2 = await M.processCreditStatementFile(makeFile('resumen5044.pdf'), CARD_8374, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (2) 5044 no puede cargarse dentro de 8374 (MISMATCH)`, r2.stage === 'mismatch' && r2.state === 'mismatch');
    ok(`[${label}] Cero escrituras al intentar cargar 5044 dentro de 8374`, M.getCallLog().length === 0);

    // (3) 8374 no puede cargarse dentro de 5044
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialResult(reliableFinancial);
    const r3 = await M.processCreditStatementFile(makeFile('resumen8374.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '8374', confidence: 'high' },
    });
    ok(`[${label}] (3) 8374 no puede cargarse dentro de 5044 (MISMATCH)`, r3.stage === 'mismatch');
    ok(`[${label}] (4) MISMATCH produce cero escrituras`, M.getCallLog().filter(c => ['insert', 'update', 'delete', 'storage.upload'].includes(c.op)).length === 0);

    // (5) UNCERTAIN sin confirmación produce cero escrituras
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialResult(reliableFinancial);
    const r5 = await M.processCreditStatementFile(makeFile('archivo_ambiguo.pdf'), CARD_5044, {
      identity: { period: null, brandFamily: 'unknown', issuerFamily: 'unknown', last4: null, confidence: 'uncertain' },
    });
    ok(`[${label}] (5) UNCERTAIN sin confirmación produce cero escrituras`, r5.stage === 'uncertain_unconfirmed' && r5.state === 'review_required' && M.getCallLog().length === 0);

    // (6) MATCH permite continuar
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-match-ok');
    const r6 = await M.processCreditStatementFile(makeFile('resumen5044.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (6) MATCH permite continuar (documento guardado)`, M.getDb().documents.length === 1 && r6.stage === 'done');

    // ============================================================
    // PERÍODO DIRECTO (7-13)
    // ============================================================
    // CORRECCIÓN CONFIRMACIÓN EXPLÍCITA 20260808 - runDirectStatementUpload
    // se separó en runDirectStatementPreview (vista previa, siempre
    // previewOnly:true) y runDirectStatementSave (guardado real,
    // previewOnly:false) -- ambas preservan exactamente estas mismas
    // líneas de transmisión de contexto (statementId/selectedPeriod), se
    // verifica sobre la primera, que es la que efectivamente arma el
    // contexto por primera vez.
    const directFnSrc = extractFunction(src, 'runDirectStatementPreview');
    const openDirectFnSrc = extractFunction(src, 'openDirectStatementUploadModal');
    ok(`[${label}] (7) El botón directo transmite selectedStatementId`, /statementId:directUploadState\.selectedStatementId\|\|null/.test(directFnSrc));
    ok(`[${label}] (8) Transmite selectedPeriod`, /selectedPeriod:directUploadState\.selectedPeriod\|\|directUploadState\.manualPeriod\|\|null/.test(directFnSrc));
    ok(`[${label}] El statement recibido se valida contra la tarjeta ANTES de guardarlo como contexto (nunca se acepta arbitrario)`,
      /selectedStatement&&selectedStatement\.card_id===card\.id/.test(openDirectFnSrc));

    // (9) El statement recibido pertenece a la tarjeta seleccionada -- un
    // statementId de OTRA tarjeta nunca se acepta.
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedCard(CARD_8374);
    M.seedStatements([{ id: 'st-8374-jul', card_id: 'card-8374', statement_month: '2026-07-01', status: 'open', total_ars: 1, total_usd: 0, notes: '[[CREDIT_STATEMENT_META:{}]]' }]);
    M.setFinancialResult(reliableFinancial);
    const r9 = await M.processCreditStatementFile(makeFile('x.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
      statementId: 'st-8374-jul',
    });
    ok(`[${label}] (9) Un statementId de otra tarjeta se rechaza (invalid_statement_context), cero escrituras`, r9.stage === 'invalid_statement_context' && M.getCallLog().length === 0);

    // (10) PDF de julio no puede vincularse a agosto
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedStatements([{ id: 'st-5044-ago', card_id: 'card-5044', statement_month: '2026-08-01', status: 'open', total_ars: 1, total_usd: 0, notes: '[[CREDIT_STATEMENT_META:{}]]' }]);
    M.setFinancialResult(reliableFinancial);
    const r10 = await M.processCreditStatementFile(makeFile('julio.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
      statementId: 'st-5044-ago',
    });
    ok(`[${label}] (10) PDF de julio no puede vincularse al resumen de agosto (period_mismatch)`, r10.stage === 'period_mismatch' && M.getCallLog().length === 0);

    // (11) PDF sin período exige confirmación
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedStatements([{ id: 'st-5044-jul', card_id: 'card-5044', statement_month: '2026-07-01', status: 'open', total_ars: 1, total_usd: 0, notes: '[[CREDIT_STATEMENT_META:{}]]' }]);
    M.setFinancialResult(reliableFinancial);
    const r11a = await M.processCreditStatementFile(makeFile('sin_periodo.pdf'), CARD_5044, {
      identity: { period: null, brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
      statementId: 'st-5044-jul',
    });
    ok(`[${label}] (11) PDF sin período con contexto exige confirmación explícita`, r11a.stage === 'period_confirmation_required' && M.getCallLog().length === 0);
    M.setFileHash('hash-11-confirmado');
    const r11b = await M.processCreditStatementFile(makeFile('sin_periodo.pdf'), CARD_5044, {
      identity: { period: null, brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
      statementId: 'st-5044-jul', manualConfirmed: true,
    });
    ok(`[${label}] Con confirmación explícita, el mismo caso continúa normalmente`, r11b.stage === 'done');

    // (12) período manual no se inventa: sin PDF, sin contexto, sin selección -> corta
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialResult(reliableFinancial);
    const r12 = await M.processCreditStatementFile(makeFile('sin_nada.pdf'), CARD_5044, {
      identity: { period: null, brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (12) Sin período en ningún lado, nunca se inventa (period_required), cero escrituras`, r12.stage === 'period_required' && M.getCallLog().length === 0);

    // (13) período seleccionado visible en el modal
    const renderDirectFnSrc = extractFunction(src, 'renderDirectStatementUploadModalBody');
    ok(`[${label}] (13) El período seleccionado queda visible en el modal (contextLabel)`, /contextLabel=directUploadState\.selectedPeriod\?monthLabel/.test(renderDirectFnSrc) && /resumen seleccionado/.test(renderDirectFnSrc));

    // ============================================================
    // VERSIÓN VIGENTE (14-22)
    // ============================================================
    // CORRECCIÓN IDENTIDAD DE STATEMENT 20260807: close_date ahora
    // alineado con declaredCloseDate de reliableFinancial/unreliableFinancial
    // ('2026-07-30') -- estas pruebas reprocesan el MISMO resumen (misma
    // tarjeta+cierre real), nunca un cierre distinto; con close_date
    // real como criterio de identidad, un valor arbitrario distinto ya
    // no matchearía como el mismo statement (correctamente).
    const existingStatement = { id: 'st-8374-jul', card_id: 'card-8374', statement_month: '2026-07-01', status: 'open', total_ars: 500000.5, total_usd: 3, close_date: '2026-07-30', due_date: '2026-07-10', notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-aceptado-v1","sourceFileName":"v1.pdf"}]]notas humanas' };
    const identityOpts8374 = { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '8374', confidence: 'high' } };

    // (14) PDF nuevo conciliado queda como nueva versión vigente
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement }]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-aceptado-v1');
    M.setFileHash('hash-v2-conciliado');
    M.setFinancialResult(reliableFinancial);
    const r14 = await M.processCreditStatementFile(makeFile('v2-bueno.pdf'), CARD_8374, identityOpts8374);
    const vigenteAfter14 = M.getDb().documents.filter(d => d.statement_id === 'st-8374-jul').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    ok(`[${label}] (14) PDF nuevo conciliado queda como nueva versión vigente`, vigenteAfter14 && vigenteAfter14.id !== 'doc-v1' && r14.stage === 'done');

    // (15-22) PDF nuevo NO conciliado
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement }]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-aceptado-v1');
    M.setFileHash('hash-v2-dudoso');
    M.setFinancialResult(unreliableFinancial);
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [{ fecha: '2026-07-06', descripcionOriginal: 'X', moneda: 'ARS', importe: 1 }] });
    const r15 = await M.processCreditStatementFile(makeFile('v2-dudoso.pdf'), CARD_8374, identityOpts8374);
    const statementAfter15 = M.getDb().credit_card_statements.find(s => s.id === 'st-8374-jul');
    const newDoc15 = M.getDb().documents.find(d => d.id !== 'doc-v1');
    ok(`[${label}] (15) PDF nuevo NO conciliado no reemplaza la versión vigente`, statementAfter15.notes.includes('hash-aceptado-v1'));
    ok(`[${label}] (16) PDF no conciliado queda preservado con statement_id null`, newDoc15 && newDoc15.statement_id === null);
    ok(`[${label}] (17) sourceFileHash aceptado no cambia ante un PDF no conciliado`, statementAfter15.notes.includes('"sourceFileHash":"hash-aceptado-v1"') && !statementAfter15.notes.includes('hash-v2-dudoso'));
    ok(`[${label}] (18) sourceFileName aceptado no cambia`, statementAfter15.notes.includes('"sourceFileName":"v1.pdf"'));
    ok(`[${label}] (19) Totales anteriores no cambian`, statementAfter15.total_ars === 500000.5 && statementAfter15.total_usd === 3);
    ok(`[${label}] (20) No se insertan movimientos dudosos`, M.getDb().credit_card_movements.length === 0);
    ok(`[${label}] (21) La interfaz informa archivo pendiente de revisión`, /pendiente/i.test(r15.resultMessage || '') && r15.state === 'review_required');
    ok(`[${label}] (22) Ningún documento anterior se borra`, M.getDb().documents.some(d => d.id === 'doc-v1') && M.getDb().documents.length === 2);
    ok(`[${label}] Las notas humanas del statement vigente se preservan intactas`, statementAfter15.notes.includes('notas humanas'));

    // ============================================================
    // IDEMPOTENCIA (23-26)
    // ============================================================
    // (23) reprocesar el mismo PDF ACEPTADO no duplica
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement }]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-aceptado-v1');
    M.setFileHash('hash-aceptado-v1');
    M.setFinancialResult(reliableFinancial);
    await M.processCreditStatementFile(makeFile('v1.pdf'), CARD_8374, identityOpts8374);
    ok(`[${label}] (23) Reprocesar el mismo PDF aceptado no duplica documentos`, M.getDb().documents.length === 1);
    ok(`[${label}] Reprocesar el mismo PDF aceptado no duplica statements`, M.getDb().credit_card_statements.length === 1);

    // (24) reintentar el mismo PDF PENDIENTE no duplica
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement }]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-aceptado-v1');
    M.setFileHash('hash-pendiente-repetido');
    M.setFinancialResult(unreliableFinancial);
    await M.processCreditStatementFile(makeFile('dudoso.pdf'), CARD_8374, identityOpts8374);
    ok(`[${label}] Primer intento del PDF dudoso queda pendiente (huérfano de la tarjeta)`, M.getDb().documents.length === 2);
    await M.processCreditStatementFile(makeFile('dudoso.pdf'), CARD_8374, identityOpts8374);
    ok(`[${label}] (24) Reintentar el mismo PDF pendiente no duplica`, M.getDb().documents.length === 2);

    // (25) mismo PDF renombrado se reconoce por hash (ya cubierto por el hallazgo de hash; se re-verifica acá en el contexto del cierre)
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement }]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/nombreviejo.pdf', original_name: 'nombreviejo.pdf', size_bytes: 999, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/nombreviejo.pdf', 'hash-aceptado-v1');
    M.setFileHash('hash-aceptado-v1');
    M.setFinancialResult(reliableFinancial);
    await M.processCreditStatementFile(makeFile('RENOMBRADO_2026_07.pdf', { size: 77777 }), CARD_8374, identityOpts8374);
    ok(`[${label}] (25) Mismo PDF renombrado (otro nombre y tamaño) se reconoce por hash, sin duplicar`, M.getDb().documents.length === 1);

    // (26) no depende de unique_violation como camino normal
    ok(`[${label}] (26) No depende de unique_violation como camino normal (se busca el statement ANTES de subir)`,
      /Paso 4 — localizar el statement/.test(engineSrc) && engineSrc.indexOf('findStatementForPeriod(card.id,period)') < engineSrc.indexOf("uploadCreditDocument(file,{cardId:card.id,statementId:uploadStatementId"));

    // ============================================================
    // ACCESOS (27-30)
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-guido');
    M.setAccess(true);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-guido-sube');
    const r27 = await M.processCreditStatementFile(makeFile('resumen.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (27) Guido puede subir`, r27.stage === 'done' && M.getDb().documents.length === 1);

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-julieta');
    M.setAccess(true);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-julieta-sube');
    const r28 = await M.processCreditStatementFile(makeFile('resumen.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (28) Julieta puede subir las tarjetas delegadas (acceso concedido)`, r28.stage === 'done' && M.getDb().documents[0].uploaded_by === 'uuid-julieta');

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-fabiana');
    M.setAccess(false);
    const r29 = await M.processCreditStatementFile(makeFile('resumen.pdf'), CARD_5044, {
      identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' },
    });
    ok(`[${label}] (29) Fabiana no puede subir`, r29.stage === 'access_denied' && M.getCallLog().length === 0);
    M.setAccess(true);

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedDocuments([{ id: 'doc-del', kind: 'statement', statement_id: 'st-x', card_id: 'card-5044', file_path: 'x', original_name: 'x.pdf', size_bytes: 1, mime_type: 'application/pdf', uploaded_by: 'uuid-guido' }]);
    M.setCanRepair(false);
    M.setSession('uuid-julieta');
    await M.deleteCreditDocument('doc-del');
    ok(`[${label}] (30) Julieta no puede eliminar documentos (canRepairCreditDocuments respetado)`, M.getCallLog().filter(c => c.op === 'delete').length === 0);
    M.setCanRepair(true);

    fs.unlinkSync(runtimePath);
  }

  // ============================================================
  // REGRESIÓN (31-38)
  // ============================================================
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 5000);
    let syntaxOk = false;
    try { scripts.forEach(s => new Function(s)); syntaxOk = scripts.length > 0; } catch (e) { console.error('  ->', e.message); }
    ok(`[${label}] (35) Sintaxis JavaScript válida`, syntaxOk);
  }
  const parityMarkers = ['validateStatementAgainstCard(identity,card)', 'pendingReprocess', 'contextStatement', 'period_confirmation_required', 'period_required'];
  ok('(36) Paridad index.html / index_operator.html en los marcadores de esta corrección', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));
  console.log('(37) HTTP 200 se verifica por separado con curl contra el servidor levantado.');
  console.log('(38) "Localhost continúa con cero escrituras" ya cubierto por run_correccion_final_tarjetas_20260806_tests.js (pruebas 1-6) -- reutilizado, no reimplementado acá.');
  console.log('(31/32/33/34) Mantener 67/67, 99/99, 83/83 y 50/50 se verifica ejecutando esas suites por separado en la misma sesión de regresión.');

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
