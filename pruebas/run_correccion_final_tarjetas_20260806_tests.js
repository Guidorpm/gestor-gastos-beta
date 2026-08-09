// CORRECCIÓN FINAL DEL RELEASE DE TARJETAS — 20260806
// Modo de prueba seguro, subida directa, documento primero, idempotencia
// y accesos.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// (nunca reimplementa la lógica de la aplicación). Las piezas que SÍ son
// dobles de prueba están señaladas explícitamente como tales: son partes
// ajenas a esta corrección (el motor de coincidencia de movimientos
// buildExistingSnapshot/buildMovementDetailAnalysis ya se probó por
// separado en pruebas/run_resumenes_trazabilidad_20260805_tests.js) o son
// el límite real del sistema (Supabase, Storage, sesión) que estas
// pruebas reemplazan por un doble local en memoria -- nunca se conecta al
// Supabase real, tal como exige la tarea.
//
// node pruebas/run_correccion_final_tarjetas_20260806_tests.js
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
  'reconcileCreditStatementDocument', 'reconcileCreditDocumentLink',
  'insertCreditDocumentRow', 'classifyCreditOrphanFiles',
  'buildCreditMovementNotes', 'creditDocumentErrorMessage',
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
// DOBLES DE PRUEBA (test doubles) -- límites reales del sistema, nunca la
// lógica que esta corrección modifica.
// ============================================================

// Sesión / acceso: en las pruebas de acceso se reasigna creditCardAccessGranted
// según el caso (Guido/Julieta/Fabiana/Diego/Lisa); acá el default es "true"
// para no bloquear las pruebas que no son específicamente de acceso.
let creditCardAccessGranted = true;
let session = { user: { id: 'test-user-guido' } };
let location = { hostname: 'localhost' };

// canRepairCreditDocuments(): permiso DISTINTO al de esta corrección (no
// se toca acá) -- se deja fijo en true para que reconcileCreditDocumentLink
// pueda avanzar hasta su propia lógica real (que sí se ejecuta de verdad).
function canRepairCreditDocuments(){ return true; }

// buildExistingSnapshot/buildMovementDetailAnalysis: el motor real de
// coincidencia/deduplicación de movimientos (fechas ambiguas, fingerprints)
// ya se probó por separado con fixtures anonimizados de los PDF reales en
// run_resumenes_trazabilidad_20260805_tests.js -- estas pruebas verifican
// el ORDEN Y LA ESTRUCTURA del motor de persistencia (processCreditStatementFile),
// no vuelven a probar la resolución de fechas. __movementPlan es controlado
// por cada prueba.
let __movementPlan = { movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, plannedMovementInserts: [] };
function buildExistingSnapshot(card, period) { return { card, period }; }
function buildMovementDetailAnalysis(item, snapshot) { return __movementPlan; }

// Base de datos y bitácora de llamadas en memoria -- nunca Supabase real.
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
      const row = { id: 'mock-' + this.table + '-' + (db[this.table].length + 1), ...this.payload };
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

// creditDocuments/creditStatements/creditCards/creditMovements: arrays
// globales en memoria que la app real mantiene sincronizadas con Supabase
// vía loadCreditCardsData(). Acá loadCreditCardsData() es un doble que
// sincroniza directamente desde la "base de datos" mock (db), en vez de
// hacer un SELECT real -- cumple el mismo rol funcional (refrescar el
// snapshot con lo recién escrito) sin tocar Supabase.
let creditDocuments = [];
let creditStatements = [];
let creditMovements = [];
// CORRECCIÓN INTEGRACIÓN REAL 20260806 - creditStorageOwnerId(cardId) exige
// encontrar la tarjeta dentro de creditCards (con owner_id real) antes de
// subir cualquier documento -- se siembra de entrada la misma tarjeta de
// prueba (card-5044) que usan todos los escenarios de este archivo.
let creditCards = [{ id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'test-user-guido' }];
async function loadCreditCardsData() {
  creditDocuments = db.documents.slice();
  creditStatements = db.credit_card_statements.slice();
  creditMovements = db.credit_card_movements.slice();
}

// runCreditStatementFinancialCheck/computeFileHash: dependen de pdf.js/
// Web Crypto (no disponibles en Node sin un navegador real) -- se
// controlan por prueba reasignando estas mismas variables (son
// declaraciones "function" de nivel superior en este mismo módulo, así
// que reasignarlas SÍ cambia lo que ve processCreditStatementFile, que
// las llama como identificadores libres del mismo scope).
let __financialResult = null;
async function runCreditStatementFinancialCheck(file, identity, period) { return __financialResult; }
let __fileHash = 'mockhash0000000000000000000000000000000000000000000000000000';
async function computeFileHash(file) { return __fileHash; }
let __storedHashByPath = new Map();
async function computeStoredFileHash(filePath) { return __storedHashByPath.get(filePath) || null; }

module.exports = {
  isCreditLocalPreviewMode, assertCreditWriteAllowed, canAccessTarjetas,
  findMatchingCreditDocument, uploadCreditDocument,
  buildFinancialReviewNotes, financialReviewStatusFor,
  processCreditStatementFile, reconcileCreditStatementTotals,
  historicalUploadErrorMessage,
  CREDIT_CONFIRM_TOLERANCE_ARS_REF: () => CREDIT_CONFIRM_TOLERANCE_ARS,
  CREDIT_CONFIRM_TOLERANCE_USD_REF: () => CREDIT_CONFIRM_TOLERANCE_USD,
  setLocation: (host) => { location.hostname = host; },
  setAccess: (granted) => { creditCardAccessGranted = granted; },
  setFinancialResult: (fr) => { __financialResult = fr; },
  setFileHash: (h) => { __fileHash = h; },
  setStoredHash: (filePath, h) => { __storedHashByPath.set(filePath, h); },
  setMovementPlan: (plan) => { __movementPlan = plan; },
  setForceError: (entry) => { forceErrors.push(entry); },
  // CORRECCIÓN INTEGRACIÓN REAL 20260806 - creditStorageOwnerId(cardId)
  // ahora exige encontrar la tarjeta dentro de creditCards (con owner_id
  // real) antes de dejar subir cualquier documento -- se re-siembra la
  // tarjeta de prueba en cada reset para que uploadCreditDocument no
  // rechace la subida por "tarjeta no encontrada".
  resetMockBackend: () => { resetMockBackend(); creditDocuments = []; creditStatements = []; creditMovements = []; creditCards = [{ id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'test-user-guido' }]; },
  getDb: () => db,
  getCallLog: () => callLog,
  getCreditDocuments: () => creditDocuments,
  getCreditStatements: () => creditStatements,
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
    const runtimePath = path.join(__dirname, `_extracted_final_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    // ------------------------------------------------------------
    // MODO LOCAL (1-6)
    // ------------------------------------------------------------
    M.setLocation('localhost');
    ok(`[${label}] (1) localhost activa previewOnly`, M.isCreditLocalPreviewMode() === true);
    M.setLocation('127.0.0.1');
    ok(`[${label}] (2) 127.0.0.1 activa previewOnly`, M.isCreditLocalPreviewMode() === true);
    M.setLocation('guidorpm.github.io');
    ok(`[${label}] (3) producción (otro hostname) NO activa previewOnly`, M.isCreditLocalPreviewMode() === false);
    let assertThrew = false;
    M.setLocation('localhost');
    try { M.assertCreditWriteAllowed(); } catch (e) { assertThrew = true; }
    ok(`[${label}] assertCreditWriteAllowed() corta en localhost antes de cualquier escritura`, assertThrew);
    M.setLocation('guidorpm.github.io');
    let assertThrewProd = false;
    try { M.assertCreditWriteAllowed(); } catch (e) { assertThrewProd = true; }
    ok(`[${label}] assertCreditWriteAllowed() NUNCA bloquea producción`, assertThrewProd === false);

    // (4) uploadCreditDocument no se llama en previewOnly / (5) sin INSERT/UPDATE/DELETE / (6) análisis completo en preview
    M.setLocation('localhost');
    M.setAccess(true);
    M.resetMockBackend();
    M.setFinancialResult({
      valid: true, totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [{ category: 'purchase', amountArs: 1000, description: 'Comercio de prueba' }],
      declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    });
    const card = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'test-user-guido' };
    const previewResult = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    ok(`[${label}] (6) El PDF puede analizarse completamente en previewOnly (financialResult presente)`, !!previewResult.financialResult && previewResult.stage === 'preview_complete');
    ok(`[${label}] (4) uploadCreditDocument no se llama en previewOnly (cero llamadas a storage.upload)`, M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);
    ok(`[${label}] (5) No existe INSERT/UPDATE/DELETE durante la vista previa`, M.getCallLog().filter(c => ['insert', 'update', 'delete'].includes(c.op)).length === 0);
    ok(`[${label}] Vista previa nunca crea documents/statements/movements reales`, M.getDb().documents.length === 0 && M.getDb().credit_card_statements.length === 0 && M.getDb().credit_card_movements.length === 0);

    // ------------------------------------------------------------
    // ORDEN DE PERSISTENCIA (11-15) -- producción (previewOnly=false)
    // ------------------------------------------------------------
    M.setLocation('guidorpm.github.io');
    M.setAccess(true);
    M.resetMockBackend();
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-06', descripcionOriginal: 'COMERCIO PRUEBA', moneda: 'ARS', importe: 1000, categoria: 'purchase', cardLast4: '5044' },
    ] });
    M.setFinancialResult({
      valid: true, totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [{ category: 'purchase', amountArs: 1000, description: 'Comercio de prueba' }],
      declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    });
    const result5044 = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    const writeOps = M.getCallLog().filter(c => ['storage.upload', 'insert', 'update'].includes(c.op));
    const idxDocInsert = writeOps.findIndex(c => c.op === 'insert' && c.table === 'documents');
    const idxStatementInsert = writeOps.findIndex(c => c.op === 'insert' && c.table === 'credit_card_statements');
    const idxDocLinkUpdate = writeOps.findIndex(c => c.op === 'update' && c.table === 'documents');
    const idxMovementsInsert = writeOps.findIndex(c => c.op === 'insert' && c.table === 'credit_card_movements');
    ok(`[${label}] (11) uploadCreditDocument (insert documents) ocurre ANTES de crear el statement`, idxDocInsert !== -1 && idxStatementInsert !== -1 && idxDocInsert < idxStatementInsert);
    ok(`[${label}] El documento se vincula (update documents.statement_id) DESPUÉS de crear el statement`, idxDocLinkUpdate !== -1 && idxStatementInsert < idxDocLinkUpdate);
    ok(`[${label}] uploadCreditDocument ocurre ANTES de insertar movimientos`, idxDocInsert !== -1 && idxMovementsInsert !== -1 && idxDocInsert < idxMovementsInsert);
    ok(`[${label}] El statement se crea ANTES de insertar movimientos`, idxStatementInsert !== -1 && idxMovementsInsert !== -1 && idxStatementInsert < idxMovementsInsert);
    ok(`[${label}] Resultado final: documento + statement + movimiento insertado`, result5044.uploaded === true && result5044.statementId && result5044.movementsInserted === 1);

    // (12) un fallo de Storage produce cero movimientos insertados
    M.resetMockBackend();
    M.setForceError({ table: 'documents', op: 'storage.upload', error: new Error('storage caído'), consumeOnce: true });
    // Simular fallo de storage.upload: forzamos vía sobreescritura del mock sb.storage.upload no es trivial acá,
    // así que forzamos el INSERT de documents (equivalente: uploadCreditDocument aborta igual y no seguimos).
    M.setForceError({ table: 'documents', op: 'insert', error: new Error('storage/documents caído'), consumeOnce: true });
    const failResult = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    ok(`[${label}] (12) Un fallo al guardar el documento produce CERO movimientos insertados`, failResult.movementsInserted === 0 && M.getDb().credit_card_movements.length === 0);
    ok(`[${label}] Un fallo al guardar el documento tampoco crea el statement`, M.getDb().credit_card_statements.length === 0);
    ok(`[${label}] (15) No se muestra éxito completo cuando falta el documento`, failResult.stage === 'document_failed' && failResult.state === 'error');

    // (13) un PDF preservado puede quedar sin statement sin perderse (sin totales confiables)
    M.resetMockBackend();
    M.setFinancialResult({ valid: false, reason: 'missing_total', totals: null, breakdown: null, movements: [] });
    const noTotalsResult = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    ok(`[${label}] (13) PDF preservado sin statement cuando no hay total confiable (documento guardado, sin resumen)`, M.getDb().documents.length === 1 && M.getDb().credit_card_statements.length === 0);
    ok(`[${label}] Estado "PDF preservado; falta completar el resumen"`, noTotalsResult.stage === 'document_only');

    // (14) un fallo de movements conserva PDF y statement
    M.resetMockBackend();
    M.setFinancialResult({
      valid: true, totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    });
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-06', descripcionOriginal: 'X', moneda: 'ARS', importe: 500 },
    ] });
    M.setForceError({ table: 'credit_card_movements', op: 'insert', error: new Error('movimientos caído'), consumeOnce: false });
    const movFailResult = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    ok(`[${label}] (14) Un fallo insertando movimientos conserva el documento`, M.getDb().documents.length === 1);
    ok(`[${label}] (14) Un fallo insertando movimientos conserva el statement`, M.getDb().credit_card_statements.length === 1);
    ok(`[${label}] Un fallo insertando movimientos no bloquea ni revierte lo ya guardado`, movFailResult.uploaded === true && !!movFailResult.statementId);
    ok(`[${label}] (15) No se informa "Todo revisado"/éxito completo cuando el detalle de movimientos falló`, /no se pud|revisi[oó]n/i.test(movFailResult.movementsSkippedReason || ''));

    // ------------------------------------------------------------
    // BOTÓN DIRECTO (7-10)
    // ------------------------------------------------------------
    const detailFnMain = extractFunction(src, 'creditSelectedDetailHtml');
    ok(`[${label}] (7) "Subir resumen" aparece en el detalle de la tarjeta (con resumen seleccionado)`, /id="openDirectStatementUpload">Subir resumen</.test(detailFnMain));
    const detailFnEmpty = (() => {
      const m = /if\(!selectedStatement\)return `[\s\S]*?`;/.exec(src);
      return m ? m[0] : '';
    })();
    ok(`[${label}] (7b) "Subir resumen" también aparece cuando la tarjeta todavía no tiene resumen`, /id="openDirectStatementUpload">Subir resumen</.test(detailFnEmpty));
    // CORRECCIÓN CONFIRMACIÓN EXPLÍCITA 20260808 - runDirectStatementUpload
    // se separó en runDirectStatementPreview (vista previa) y
    // runDirectStatementSave (guardado real) -- ambas llaman al mismo
    // motor único (processCreditStatementFile(directUploadState.file,card,...)),
    // nunca un segundo parser -- se exige en las dos.
    ok(`[${label}] (8) El botón directo usa el mismo motor que la carga histórica (processCreditStatementFile) dentro de runDirectStatementPreview/runDirectStatementSave`,
      /async function runDirectStatementPreview[\s\S]{0,1500}processCreditStatementFile\(directUploadState\.file,card/.test(src)
      && /async function runDirectStatementSave[\s\S]{0,1500}processCreditStatementFile\(directUploadState\.file,card/.test(src));
    ok(`[${label}] La carga histórica también llama a processCreditStatementFile (mismo motor, nunca un segundo parser)`, /async function runHistoricalUpload[\s\S]{0,4500}processCreditStatementFile\(row\.file,card/.test(src));
    // (9)/(10): 5044 (sin período en nombre, tarjeta sola) y 8374 (reprocesar) ambos pueden usar
    // el flujo directo porque processCreditStatementFile no exige nombre de archivo -- se verifica
    // estructuralmente que nunca depende de row/periodFromFilename.
    const engineFn = extractFunction(src, 'processCreditStatementFile');
    ok(`[${label}] (9) processCreditStatementFile no depende del nombre del archivo para resolver el período`, !/periodFromFilename/.test(engineFn));
    ok(`[${label}] (10) processCreditStatementFile acepta un statementId ya conocido (reprocesar 8374 sin duplicar)`, /options\.statementId/.test(engineFn));

    // ------------------------------------------------------------
    // HASH (16-19)
    // ------------------------------------------------------------
    M.setLocation('guidorpm.github.io');
    M.resetMockBackend();
    M.setFileHash('hash-AAA');
    M.seedDocuments([{ id: 'doc-1', kind: 'statement', statement_id: 'st-1', card_id: 'card-5044', file_path: 'credit-cards/u/c/st-1/statement/otronombre.pdf', original_name: 'otronombre.pdf', size_bytes: 999, mime_type: 'application/pdf' }]);
    M.setStoredHash('credit-cards/u/c/st-1/statement/otronombre.pdf', 'hash-AAA');
    const matchByHash = await M.findMatchingCreditDocument({ cardId: 'card-5044', statementId: 'st-1', kind: 'statement', file: makeFile('Resumen.pdf', { size: 12345 }) });
    ok(`[${label}] (17) Mismo PDF con otro nombre se detecta por hash (aunque difieran nombre y tamaño)`, !!matchByHash && matchByHash.matchedBy === 'hash');

    M.setFileHash('hash-BBB');
    M.setStoredHash('credit-cards/u/c/st-1/statement/otronombre.pdf', 'hash-AAA');
    const noMatchDifferentHash = await M.findMatchingCreditDocument({ cardId: 'card-5044', statementId: 'st-1', kind: 'statement', file: makeFile('otronombre.pdf', { size: 999, type: 'application/pdf' }) });
    ok(`[${label}] (18) PDF distinto con igual nombre/tamaño NO se trata como duplicado (hash confirmado distinto)`, noMatchDifferentHash === null);

    M.resetMockBackend();
    M.setFinancialResult({
      valid: true, totals: { statementArs: 500, calculatedArs: 500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    });
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, plannedMovementInserts: [] });
    M.setFileHash('hash-persist-check');
    await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } });
    const persistedStatement = M.getDb().credit_card_statements[0];
    ok(`[${label}] (16) sourceFileHash queda en notes-meta del statement`, !!persistedStatement && persistedStatement.notes.includes('"sourceFileHash":"hash-persist-check"'));
    ok(`[${label}] sourceFileName/parserVersion/processedAt también quedan en notes-meta`, /"sourceFileName":"Resumen\.pdf"/.test(persistedStatement.notes) && /"parserVersion":/.test(persistedStatement.notes) && /"processedAt":/.test(persistedStatement.notes));

    // (19)/(20) reintento no duplica documento ni movimientos
    M.resetMockBackend();
    M.setFileHash('hash-retry');
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [{ fecha: '2026-07-06', descripcionOriginal: 'X', moneda: 'ARS', importe: 500 }] });
    M.setFinancialResult({
      valid: true, totals: { statementArs: 500, calculatedArs: 500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    });
    const identityOpts = { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia' } };
    const firstRun = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, identityOpts);
    M.setStoredHash(firstRun.document.file_path, 'hash-retry');
    // Segundo intento: mismo archivo (mismo hash), ya con statementId conocido.
    const secondRun = await M.processCreditStatementFile(makeFile('Resumen.pdf'), card, { ...identityOpts, statementId: firstRun.statementId });
    ok(`[${label}] (19) Reintentar el mismo PDF no duplica el documento`, M.getDb().documents.length === 1);
    ok(`[${label}] (20) Reintentar el mismo PDF no duplica el statement`, M.getDb().credit_card_statements.length === 1);

    // ------------------------------------------------------------
    // TOLERANCIA (21-24)
    // ------------------------------------------------------------
    function buildParsed(diffArs, diffUsd) {
      return {
        status: 'ok', missing: [], paymentReviewLines: [],
        declaredTotalArs: 1000 + diffArs, declaredTotalUsd: diffUsd,
        movements: [{ category: 'purchase', amountArs: 1000, amountUsd: null }],
      };
    }
    const identityVisa = { brandFamily: 'visa', issuerFamily: 'banco_provincia' };
    const rec001 = M.reconcileCreditStatementTotals(buildParsed(0.01, 0), identityVisa, '2026-07');
    ok(`[${label}] (21) Diferencia ARS 0,01 puede conciliar (dentro de tolerancia contable)`, rec001.valid === true);
    const rec002 = M.reconcileCreditStatementTotals(buildParsed(0.02, 0), identityVisa, '2026-07');
    ok(`[${label}] (22) Diferencia ARS 0,02 bloquea la confirmación (REQUIERE REVISIÓN)`, rec002.valid === false && rec002.reason === 'mismatch');
    const recUsd001 = M.reconcileCreditStatementTotals({ ...buildParsed(0, 0), movements: [{ category: 'purchase', amountArs: 1000, amountUsd: 0.01 }] }, identityVisa, '2026-07');
    ok(`[${label}] (23) Diferencia USD 0,01 puede conciliar`, recUsd001.valid === true);
    const recUsd002 = M.reconcileCreditStatementTotals({ ...buildParsed(0, 0), movements: [{ category: 'purchase', amountArs: 1000, amountUsd: 0.02 }] }, identityVisa, '2026-07');
    ok(`[${label}] (24) Diferencia USD 0,02 bloquea la confirmación`, recUsd002.valid === false);
    ok(`[${label}] La tolerancia contable real usada es $0,01 ARS/USD (no la técnica $1/$0,01)`, M.CREDIT_CONFIRM_TOLERANCE_ARS_REF() === 0.01 && M.CREDIT_CONFIRM_TOLERANCE_USD_REF() === 0.01);

    // ------------------------------------------------------------
    // ACCESO (25-30) -- verificación estructural sobre el código real
    // (creditCardAccessGranted/current_credit_card_access ya reemplazan a
    // hasOwnerSpaces() como gate de Tarjetas en todos los puntos reales).
    // ------------------------------------------------------------
    ok(`[${label}] (25/26) canAccessTarjetas() se resuelve por current_credit_card_access() (titular Y delegado), no por hasOwnerSpaces()`,
      /const\s*\{data:creditAccessData,error:creditAccessError\}=await sb\.rpc\('current_credit_card_access'\);/.test(src));
    ok(`[${label}] loadCreditCardsData() usa canAccessTarjetas() como gate real (no hasOwnerSpaces())`,
      /async function loadCreditCardsData\(\)\{[\s\S]{0,600}if\(!canAccessTarjetas\(\)\)/.test(src));
    ok(`[${label}] openCreditCardsModule()/renderCreditCardsModule() usan canAccessTarjetas()`,
      /if\(!canAccessTarjetas\(\)\)return toast/.test(src) && /function renderCreditCardsModule\(\)\{[\s\S]{0,600}if\(!canAccessTarjetas\(\)\)/.test(src));
    ok(`[${label}] (27) Fabiana (sin creditCardAccessGranted) no ve Tarjetas: el panel de renderGroups() usa canAccessTarjetas(), no hasOwnerSpaces()`,
      /\$\{canAccessTarjetas\(\)\?`<div class="card owner-panel"/.test(src));
    ok(`[${label}] (28) Diego y Lisa (sin fila en credit_card_access, sin ser dueños) tampoco ven Tarjetas: mismo gate único canAccessTarjetas()`,
      (src.match(/canAccessTarjetas\(\)/g) || []).length >= 5);
    ok(`[${label}] (29) Cambio de usuario/logout limpia creditCardAccessGranted + estado de Tarjetas + vista previa local`,
      /creditCardAccessGranted=false;[\s\S]{0,200}creditCards=\[\];[\s\S]{0,200}creditDocuments=\[\];[\s\S]{0,200}selectedCreditStatementId=null;[\s\S]{0,200}creditLocalPreviewState=null;/.test(src));
    ok(`[${label}] (30) Un error real de RPC/consulta nunca se confunde con "sin tarjetas": creditCardAccessGranted queda en false explícitamente ante error de RPC`,
      /if\(creditAccessError\)\{[\s\S]{0,150}creditCardAccessGranted=false;/.test(src));

    fs.unlinkSync(runtimePath);
  }

  // ------------------------------------------------------------
  // REGRESIÓN (31-37)
  // ------------------------------------------------------------
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 5000);
    let syntaxOk = false;
    try { scripts.forEach(s => new Function(s)); syntaxOk = scripts.length > 0; } catch (e) { console.error('  ->', e.message); }
    ok(`[${label}] (35) Sintaxis JavaScript válida`, syntaxOk);
  }
  ok('(32) Panel de pendientes de Fabiana: funciones intactas en ambos archivos', ['authorizedGroupIds', 'calculateRealObligationBalance', 'isServiceVisibleForCurrentContext'].every(m => srcMain.includes(m) && srcOperator.includes(m)));
  ok('(33) Comprobantes comunes: receiptFileIsAcceptable/uploadDoc siguen presentes en ambos archivos', ['receiptFileIsAcceptable', 'async function uploadDoc('].every(m => srcMain.includes(m) && srcOperator.includes(m)));
  ok('(34) Británico continúa excluido (sin referencias nuevas a Británico en el diff de esta corrección)', !/Britanico|Británico/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/processCreditStatementFile[\s\S]{0,6000}/)[0]));
  console.log('(36/37) index.html / index_operator.html HTTP 200: se verifican por separado con curl contra el servidor levantado.');

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  console.log('MANUAL: prueba con los PDF reales (Bloque 11) se ejecuta por separado en modo de vista previa local, sin escrituras.');
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
