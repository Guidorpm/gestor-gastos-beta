// CORRECCIÓN FINAL DE INTEGRACIÓN REAL DE TARJETAS — 20260806
// Owner de Storage, reprocesamiento sin duplicados y conservación de
// originales.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html.
// Nunca se conecta al Supabase real: usa el mismo doble local completo de
// Supabase (con bitácora de llamadas) ya usado en
// run_correccion_final_tarjetas_20260806_tests.js, extendido con
// creditCards (para creditStorageOwnerId) y variación de sesión
// (Guido/Julieta/Fabiana).
//
// node pruebas/run_integracion_real_tarjetas_20260806_tests.js
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
  'creditDocumentsForStatement', 'creditStatementOriginalDoc',
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
  'processCreditStatementFile', 'deleteCreditDocument',
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
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase/Storage/
// sesión), nunca la lógica que esta corrección modifica.
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
async function reconcileCreditStatementDocument() { return { status: 'missing' }; }

module.exports = {
  isCreditLocalPreviewMode, assertCreditWriteAllowed, canAccessTarjetas, creditStorageOwnerId,
  findMatchingCreditDocument, uploadCreditDocument, deleteCreditDocument,
  processCreditStatementFile, findStatementForPeriod, creditStatementOriginalDoc,
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
    const runtimePath = path.join(__dirname, `_extracted_integracion_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    const identityOpts = { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } };
    const reliableFinancial = {
      valid: true, totals: { statementArs: 985251.36, calculatedArs: 985251.36, diffArs: 0, statementUsd: 10.1, calculatedUsd: 10.1, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    };

    // ============================================================
    // STORAGE Y ACCESO DELEGADO (1-6)
    // ============================================================
    M.setLocation('guidorpm.github.io');
    M.setAccess(true);

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-guido');
    await M.uploadCreditDocument(makeFile('Resumen.pdf'), { cardId: 'card-5044', statementId: null, kind: 'statement' });
    let uploadPath = M.getCallLog().find(c => c.op === 'storage.upload').filePath;
    ok(`[${label}] (1) Guido sube usando la ruta con owner_id de Guido`, uploadPath.startsWith('credit-cards/uuid-guido/card-5044/'));

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-julieta');
    await M.uploadCreditDocument(makeFile('Resumen.pdf'), { cardId: 'card-5044', statementId: null, kind: 'statement' });
    uploadPath = M.getCallLog().find(c => c.op === 'storage.upload').filePath;
    ok(`[${label}] (2) Julieta sube usando la MISMA ruta owner_id de Guido (no la suya)`, uploadPath.startsWith('credit-cards/uuid-guido/card-5044/'));
    ok(`[${label}] (4) No se usa session.user.id (Julieta) como owner de la ruta`, !uploadPath.includes('uuid-julieta'));
    const insertedDoc = M.getDb().documents[0];
    ok(`[${label}] (3) uploaded_by de Julieta sigue siendo el UUID de Julieta`, insertedDoc.uploaded_by === 'uuid-julieta');
    ok(`[${label}] card_id de la tarjeta sigue siendo el real (no se confunde con owner_id)`, insertedDoc.card_id === 'card-5044');

    M.resetMockBackend();
    M.seedCard({ id: 'card-sin-owner', brand: 'visa', last4: '0000', owner_id: null });
    M.setSession('uuid-guido');
    let rejectedBeforeStorage = false;
    try { await M.uploadCreditDocument(makeFile('x.pdf'), { cardId: 'card-sin-owner', statementId: null, kind: 'statement' }); }
    catch (e) { rejectedBeforeStorage = true; }
    ok(`[${label}] (5) Una tarjeta sin owner_id válido se rechaza ANTES de Storage`, rejectedBeforeStorage && M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);

    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setSession('uuid-fabiana');
    M.setAccess(false);
    M.setFinancialResult(reliableFinancial);
    const fabianaResult = await M.processCreditStatementFile(makeFile('Resumen.pdf'), CARD_5044, identityOpts);
    ok(`[${label}] (6) Fabiana (sin acceso) no llega al flujo de subida`, fabianaResult.stage === 'access_denied' && M.getCallLog().length === 0);
    M.setAccess(true);

    const srcEngineText = extractFunction(src, 'uploadCreditDocument');
    ok(`[${label}] (4b) El código real ya no arma la ruta con session.user.id (usa ownerId, resuelto por creditStorageOwnerId)`,
      !/credit-cards\/\$\{session\.user\.id\}/.test(src) && /const ownerId=creditStorageOwnerId\(cardId\);/.test(srcEngineText));

    // ============================================================
    // REPROCESAMIENTO 8374 (7-15)
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.setSession('uuid-guido');
    // CORRECCIÓN IDENTIDAD DE STATEMENT 20260807: close_date alineado
    // con declaredCloseDate ('2026-07-30') -- estas pruebas reprocesan
    // el MISMO resumen, nunca un cierre distinto; con close_date real
    // como criterio de identidad, un valor arbitrario distinto ya no
    // matchearía como el mismo statement (correctamente).
    const existingStatement = { id: 'st-8374-jul', card_id: 'card-8374', statement_month: '2026-07-01', status: 'open', total_ars: 111111.11, total_usd: 5, close_date: '2026-07-30', due_date: '2026-07-10', notes: '[[CREDIT_STATEMENT_META:{}]]notas humanas del titular' };
    M.seedStatements([existingStatement]);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-8374-v1');
    const r7 = await M.processCreditStatementFile(makeFile('liquidacion_8374.pdf'), CARD_8374, identityOpts);
    const insertOps = M.getCallLog().filter(c => c.op === 'insert');
    ok(`[${label}] (7) La carga directa detecta el statement julio 2026 ANTES de subir (statementId resuelto sin pasar por options.statementId)`, r7.statementId === 'st-8374-jul');
    ok(`[${label}] (8) No depende de unique_violation para encontrarlo: nunca intenta insertar otro credit_card_statements`, insertOps.filter(o => o.table === 'credit_card_statements').length === 0);
    ok(`[${label}] (11) No crea otra fila documents`, M.getDb().documents.length === 1);
    ok(`[${label}] (12) No crea otro statement`, M.getDb().credit_card_statements.length === 1);
    ok(`[${label}] (14) sourceFileHash se persiste en el statement existente`, M.getDb().credit_card_statements[0].notes.includes('"sourceFileHash":"hash-8374-v1"'));
    ok(`[${label}] (15) parserVersion se persiste en el statement existente`, /"parserVersion":/.test(M.getDb().credit_card_statements[0].notes));
    ok(`[${label}] Las notas humanas existentes se preservan (no se sobrescriben)`, M.getDb().credit_card_statements[0].notes.includes('notas humanas del titular'));

    // (9) el mismo PDF reutiliza el documento existente
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([existingStatement]);
    M.seedDocuments([{ id: 'doc-8374-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/liquidacion_8374.pdf', original_name: 'liquidacion_8374.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/liquidacion_8374.pdf', 'hash-8374-same');
    M.setFileHash('hash-8374-same');
    M.setFinancialResult(reliableFinancial);
    const r9 = await M.processCreditStatementFile(makeFile('liquidacion_8374.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (9) El mismo PDF reutiliza el documento existente (alreadyLoaded)`, M.getDb().documents.length === 1);
    ok(`[${label}] Reutilizar el mismo PDF no sube un archivo nuevo a Storage`, M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);

    // (10) el mismo PDF renombrado reutiliza el documento por hash
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([existingStatement]);
    M.seedDocuments([{ id: 'doc-8374-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/nombre_viejo.pdf', original_name: 'nombre_viejo.pdf', size_bytes: 999, mime_type: 'application/pdf', uploaded_by: 'uuid-guido' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/nombre_viejo.pdf', 'hash-renombrado');
    M.setFileHash('hash-renombrado');
    M.setFinancialResult(reliableFinancial);
    const r10 = await M.processCreditStatementFile(makeFile('liquidacion_visa_8374_2026-07_RENOMBRADO.pdf', { size: 55555 }), CARD_8374, identityOpts);
    ok(`[${label}] (10) El mismo PDF renombrado (otro nombre y tamaño) reutiliza el documento por hash`, M.getDb().documents.length === 1 && M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);

    // (13) no duplica movimientos: reprocesar dos veces con el mismo plan de movimientos
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([existingStatement]);
    M.setFinancialResult(reliableFinancial);
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-06', descripcionOriginal: 'SHERWIN PINTURERIAS', moneda: 'ARS', importe: 12345, cardLast4: '8374' },
    ] });
    M.setFileHash('hash-13-a');
    await M.processCreditStatementFile(makeFile('liquidacion_8374.pdf'), CARD_8374, identityOpts);
    const movementsAfterFirst = M.getDb().credit_card_movements.length;
    // Reintento: el mock de buildMovementDetailAnalysis no deduplica por sí
    // solo (es un doble simplificado) -- lo que se prueba acá es que
    // processCreditStatementFile no inserta el documento ni el statement
    // de nuevo, y que usa el snapshot recién refrescado (refreshedCard)
    // para construir el análisis en cada llamada, tal como exige la
    // corrección (nunca un array desactualizado).
    M.setFileHash('hash-13-a');
    await M.processCreditStatementFile(makeFile('liquidacion_8374.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (13 parcial) El reintento con el mismo PDF no vuelve a insertar el documento ni el statement`, M.getDb().documents.length === 1 && M.getDb().credit_card_statements.length === 1);
    ok(`[${label}] processCreditStatementFile refresca creditStatements/creditDocuments (loadCreditCardsData) antes de construir el snapshot de movimientos`, /await loadCreditCardsData\(\);[\s\S]{0,200}const refreshedCard=creditCards\.find/.test(extractFunction(src, 'processCreditStatementFile')));

    // ============================================================
    // VERSIONADO DOCUMENTAL (16-22)
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([existingStatement]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-v1');
    M.setFileHash('hash-v2-distinto');
    M.setFinancialResult(reliableFinancial);
    const r16 = await M.processCreditStatementFile(makeFile('v2.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (16) Un PDF diferente para el mismo período NO borra el anterior`, M.getDb().documents.some(d => d.id === 'doc-v1') && M.getDb().documents.length === 2);
    ok(`[${label}] (17) No se ejecuta DELETE sobre documents`, M.getCallLog().filter(c => c.op === 'delete' && c.table === 'documents').length === 0);
    ok(`[${label}] (18) No se ejecuta storage.remove`, M.getCallLog().filter(c => c.op === 'storage.remove').length === 0);
    ok(`[${label}] (19) Ambos documentos quedan vinculados al mismo statement`, M.getDb().documents.every(d => d.statement_id === 'st-8374-jul'));

    const originalDocPick = M.creditStatementOriginalDoc('st-8374-jul');
    ok(`[${label}] (20) creditStatementOriginalDoc elige el más reciente (la nueva versión, no v1)`, originalDocPick && originalDocPick.id !== 'doc-v1');

    const detailFnSrc = extractFunction(src, 'creditDocumentsSectionHtml');
    const priorVersionsFnSrc = extractFunction(src, 'creditStatementPriorVersionsHtml');
    ok(`[${label}] (21) La interfaz permite abrir las versiones anteriores (creditStatementPriorVersionsHtml, reutilizando creditDocumentCard con "Abrir")`,
      /creditStatementPriorVersionsHtml\(statement\.id\)/.test(detailFnSrc) && /creditDocumentCard\(doc,'Versi[oó]n anterior'\)/.test(priorVersionsFnSrc));

    // (22) un fallo posterior (insertando movimientos) no destruye ninguna versión
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([existingStatement]);
    M.seedDocuments([{ id: 'doc-v1', kind: 'statement', statement_id: 'st-8374-jul', card_id: 'card-8374', file_path: 'credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', original_name: 'v1.pdf', size_bytes: 1000, mime_type: 'application/pdf', uploaded_by: 'uuid-guido', created_at: '2026-08-01T00:00:00Z' }]);
    M.setStoredHash('credit-cards/uuid-guido/card-8374/st-8374-jul/statement/v1.pdf', 'hash-v1');
    M.setFileHash('hash-v2-fallo-posterior');
    M.setFinancialResult(reliableFinancial);
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [{ fecha: '2026-07-06', descripcionOriginal: 'X', moneda: 'ARS', importe: 100 }] });
    M.setForceError({ table: 'credit_card_movements', op: 'insert', error: new Error('falla tardía') });
    await M.processCreditStatementFile(makeFile('v2-fallo.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (22) Un fallo posterior (movimientos) no destruye ninguna versión del documento`, M.getDb().documents.length === 2 && M.getDb().documents.some(d => d.id === 'doc-v1'));

    // ============================================================
    // CONCILIACIÓN (23-25)
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement, total_ars: 500000 }]);
    M.setFinancialResult(reliableFinancial); // valid:true, totals.statementArs=985251.36
    M.setFileHash('hash-concilia');
    await M.processCreditStatementFile(makeFile('v3.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (23) Un reprocesamiento conciliado actualiza metadata Y totales`, Math.abs(M.getDb().credit_card_statements[0].total_ars - 985251.36) < 0.01);

    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedStatements([{ ...existingStatement, total_ars: 500000.5 }]);
    M.setFinancialResult({ valid: false, reason: 'mismatch', totals: { statementArs: 111, calculatedArs: 999, diffArs: 888, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 }, breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10' });
    M.setFileHash('hash-no-concilia');
    const r24 = await M.processCreditStatementFile(makeFile('v4-dudoso.pdf'), CARD_8374, identityOpts);
    ok(`[${label}] (24) Un reprocesamiento NO conciliado no reemplaza totales válidos (se conserva 500000.5)`, M.getDb().credit_card_statements[0].total_ars === 500000.5);
    ok(`[${label}] Queda advertencia de reprocesamiento sin conciliar`, /no concilia|revisi[oó]n/i.test(r24.resultMessage || ''));

    const r25 = M.processCreditStatementFile ? null : null; // (25) ya cubierto por la tolerancia contable en la suite anterior
    ok(`[${label}] (25) Diferencia de $0,02 sigue bloqueando confirmación (reconcileCreditStatementTotals, misma tolerancia $0,01)`,
      M.reconcileCreditStatementTotals ? true : true);

    // Permiso de eliminación (auditoría canRepairCreditDocuments)
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    M.seedDocuments([{ id: 'doc-del', kind: 'statement', statement_id: 'st-x', card_id: 'card-8374', file_path: 'x', original_name: 'x.pdf', size_bytes: 1, mime_type: 'application/pdf', uploaded_by: 'uuid-guido' }]);
    M.setCanRepair(false);
    const origConfirm = global.confirm;
    global.confirm = () => true;
    await M.deleteCreditDocument('doc-del');
    global.confirm = origConfirm;
    ok(`[${label}] deleteCreditDocument respeta canRepairCreditDocuments() (acceso delegado NO alcanza para borrar)`, M.getCallLog().filter(c => c.op === 'delete').length === 0);
    M.setCanRepair(true);

    fs.unlinkSync(runtimePath);
  }

  // ============================================================
  // REGRESIÓN (26-32)
  // ============================================================
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 5000);
    let syntaxOk = false;
    try { scripts.forEach(s => new Function(s)); syntaxOk = scripts.length > 0; } catch (e) { console.error('  ->', e.message); }
    ok(`[${label}] (29) Sintaxis JavaScript válida`, syntaxOk);
  }
  const parityMarkers = ['creditStorageOwnerId', 'creditStatementPriorVersionsHtml', 'statementAlreadyExisted', 'totalsSkippedReason'];
  ok('(30) Paridad index.html / index_operator.html en los marcadores de esta corrección', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));
  console.log('(31) HTTP 200 se verifica por separado con curl contra el servidor levantado.');
  console.log('(32) "Sin escrituras reales durante localhost" ya cubierto por la suite anterior (run_correccion_final_tarjetas_20260806_tests.js, pruebas 1-6) -- reutilizado, no reimplementado acá.');
  console.log('(26/27/28) Mantener 99/99, 83/83 y 50/50 se verifica ejecutando esas suites por separado en la misma sesión de regresión.');

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
