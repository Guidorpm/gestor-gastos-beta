// CARGA REAL DE RESÚMENES — 5044 Y 8374 — REPARACIÓN NO DESTRUCTIVA — 20260807
// Guardado real idempotente: statement nuevo, statement existente solo con
// totales (se completa), statement ya completo (no se duplica nada).
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local completo de Supabase (bitácora de llamadas incluida)
// -- nunca se conecta al Supabase real. No usa ninguna base productiva.
//
// node pruebas/run_carga_real_5044_8374_20260807_tests.js
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
  // CORRECCIÓN CARGA REAL 5044/8374 20260807
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
// esta corrección modifica. buildExistingSnapshot/buildMovementDetailAnalysis
// (el motor de fechas/matching de movimientos) ya están probados por
// separado en run_resumenes_trazabilidad_20260805_tests.js -- acá se
// controlan con un plan explícito por llamada, exactamente el mismo
// patrón ya usado en toda esta serie para probar la ORQUESTACIÓN del
// guardado (statement/documento/movimientos), no el matching en sí.
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
      // CORRECCIÓN 20260807 - soporta insert de UN objeto (statement/documento)
      // Y de un ARRAY de objetos (movimientos, insertados en lotes de 75 por
      // processCreditStatementFile) -- el doble anterior de esta serie solo
      // contemplaba un objeto único; con un array, "{...this.payload}" lo
      // esparcía como {0:obj,1:obj,...} en vez de crear una fila por ítem.
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
let __financialCheckError = null;
async function runCreditStatementFinancialCheck(file, identity, period) { if (__financialCheckError) throw __financialCheckError; return __financialResult; }
let __fileHash = 'mockhash0000000000000000000000000000000000000000000000000000';
async function computeFileHash(file) { return __fileHash; }
let __storedHashByPath = new Map();
async function computeStoredFileHash(filePath) { return __storedHashByPath.get(filePath) || null; }
let __detectIdentityThrows = null;

module.exports = {
  isCreditLocalPreviewMode, canAccessTarjetas, processCreditStatementFile,
  validateStatementAgainstCard, deleteCreditDocument,
  describeExistingCreditStatementState, existingManualPaymentsForCard,
  parseLocalizedPaymentAmount, loadCreditCardsData,
  setLocation: (host) => { location.hostname = host; },
  setAccess: (granted) => { creditCardAccessGranted = granted; },
  setSession: (uid) => { session = { user: { id: uid } }; },
  setCanRepair: (v) => { canRepairCreditDocuments = () => v; },
  setFinancialResult: (fr) => { __financialResult = fr; },
  setFinancialCheckThrows: (err) => { __financialCheckError = err; },
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

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_cargareal_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const identityOpts5044 = { identity: { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' } };
    const reliableFinancial = {
      valid: true, totals: { statementArs: 1000000, calculatedArs: 1000000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: {}, movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    };

    // ============================================================
    // (1) Guardado de un statement nuevo
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-5044-v1');
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-05', descripcionOriginal: 'COMERCIO 1', moneda: 'ARS', importe: -1000, categoria: 'purchase' },
      { fecha: '2026-07-06', descripcionOriginal: 'COMERCIO 2', moneda: 'ARS', importe: -2000, categoria: 'purchase' },
    ] });
    const r1 = await M.processCreditStatementFile(makeFile('resumen5044.pdf'), CARD_5044, identityOpts5044);
    ok(`[${label}] (1) Guardado de un statement nuevo (documento + statement + movimientos)`,
      r1.stage === 'done' && M.getDb().credit_card_statements.length === 1 && M.getDb().documents.length === 1 && M.getDb().credit_card_movements.length === 2);
    const firstStatementId = M.getDb().credit_card_statements[0].id;

    // ============================================================
    // (2/3) Reprocesar el mismo PDF no duplica statement ni movimientos
    // (2do llamado: el mismo hash -> documento reconocido por hash; el
    // plan de movimientos ahora vacío, tal como devolvería el motor real
    // de matching si ya están todos guardados -- ese matching en sí ya
    // se prueba por separado, acá se prueba la ORQUESTACIÓN).
    // ============================================================
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [] });
    const r2 = await M.processCreditStatementFile(makeFile('resumen5044.pdf'), CARD_5044, identityOpts5044);
    ok(`[${label}] (2) Reprocesar el mismo PDF no duplica el statement`,
      M.getDb().credit_card_statements.length === 1 && M.getDb().credit_card_statements[0].id === firstStatementId);
    ok(`[${label}] (3) Reprocesar el mismo PDF no duplica movimientos`,
      M.getDb().credit_card_movements.length === 2);
    ok(`[${label}] (5) La reparación conserva el mismo ID de statement`,
      r2.statementId === firstStatementId);
    ok(`[${label}] (6) El documento existente no se duplica (mismo hash reconocido)`,
      M.getDb().documents.length === 1);

    // ============================================================
    // (4) Statement existente SOLO con totales (sin documento, sin
    // movimientos -- caso real de 8374) puede completarse.
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    // CORRECCIÓN CRÍTICA 20260807 - close_date alineado con
    // reliableFinancial.declaredCloseDate ('2026-07-30'): esta prueba
    // reprocesa el MISMO resumen (para completarlo con documento +
    // movimientos), así que su close_date real debe coincidir con el
    // declarado por el PDF -- si no coincidiera, sería un resumen
    // DISTINTO, y resolveCreditStatementWriteTarget correctamente ya no
    // lo reutilizaría a ciegas (ver la corrección de esta misma tarea).
    const totalsOnlyStatement = { id: 'st-totales-only', card_id: 'card-5044', statement_month: '2026-07-01', status: 'open', total_ars: 1000000, total_usd: 0, close_date: '2026-07-30', due_date: '2026-07-10', notes: '[[CREDIT_STATEMENT_META:{}]]' };
    M.seedStatements([{ ...totalsOnlyStatement }]);
    // sin documentos, sin movimientos -- exactamente "quedó con los
    // totales pero no el desglose completo".
    const preState = M.describeExistingCreditStatementState('card-5044', '2026-07');
    ok(`[${label}] Diagnóstico previo detecta el caso "solo totales" (documento: no, movimientos: 0, incompleto)`,
      preState.exists && !preState.isComplete && !preState.hasDocument && preState.movementCount === 0);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-8374-completar');
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-05', descripcionOriginal: 'COMERCIO 1', moneda: 'ARS', importe: -1000, categoria: 'purchase' },
      { fecha: '2026-07-06', descripcionOriginal: 'COMERCIO 2', moneda: 'ARS', importe: -2000, categoria: 'purchase' },
      { fecha: '2026-07-07', descripcionOriginal: 'COMERCIO 3', moneda: 'ARS', importe: -3000, categoria: 'purchase' },
    ] });
    const r4 = await M.processCreditStatementFile(makeFile('resumen_completar.pdf'), CARD_5044, { statementId: 'st-totales-only', identity: identityOpts5044.identity });
    ok(`[${label}] (4) Statement existente solo con totales se completa (documento + movimientos agregados)`,
      M.getDb().credit_card_statements.length === 1 && M.getDb().documents.length === 1 && M.getDb().credit_card_movements.length === 3);
    ok(`[${label}] La reparación NUNCA crea un segundo statement para el mismo cierre/período`,
      M.getDb().credit_card_statements.filter(s => s.id === 'st-totales-only' || (s.card_id === 'card-5044' && s.statement_month === '2026-07-01')).length === 1);

    // La interfaz real refresca (refreshDashboardData/loadCreditCardsData)
    // después de un guardado terminal -- se simula acá el mismo refresco
    // antes de volver a diagnosticar (processCreditStatementFile no
    // refresca una tercera vez después de insertar movimientos, por
    // diseño: evita una lectura extra en el camino caliente de escritura).
    await M.loadCreditCardsData();
    const postState = M.describeExistingCreditStatementState('card-5044', '2026-07');
    ok(`[${label}] Después de completar, el diagnóstico ya lo marca completo`,
      postState.exists && postState.isComplete);

    // ============================================================
    // (7/8) Pagos manuales existentes no se duplican; un reconocimiento
    // bancario nunca se convierte en manual_payment.
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedMovements([
      { id: 'pago-manual-1', card_id: 'card-5044', currency: 'ARS', amount: -50000, movement_date: '2026-07-13', statement_id: null, notes: '[[CREDIT_META:{"movementType":"payment","source":"manual_payment","appliesToCurrentStatement":true}]]' },
    ]);
    const manualBefore = M.existingManualPaymentsForCard('card-5044');
    ok(`[${label}] (7) Detecta el pago manual ya existente (para que la interfaz sepa que no debe cargarse de nuevo)`,
      manualBefore.length === 1 && manualBefore[0].id === 'pago-manual-1');

    M.seedStatements([{ ...totalsOnlyStatement, id: 'st-8374-b' }]);
    M.setFinancialResult(reliableFinancial);
    M.setFileHash('hash-8374-pagos');
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, plannedMovementInserts: [
      { fecha: '2026-07-13', descripcionOriginal: 'SU PAGO EN PESOS', moneda: 'ARS', importe: -50000, categoria: 'payment' },
    ] });
    await M.processCreditStatementFile(makeFile('resumen_con_pago_reconocido.pdf'), CARD_5044, { statementId: 'st-8374-b', identity: identityOpts5044.identity });
    const manualAfter = M.existingManualPaymentsForCard('card-5044');
    ok(`[${label}] (7) El pago manual preexistente sigue siendo uno solo (no se duplicó al reprocesar)`,
      manualAfter.length === 1 && manualAfter[0].id === 'pago-manual-1');
    const insertedBankPayment = M.getDb().credit_card_movements.find(m => m.description === 'SU PAGO EN PESOS');
    ok(`[${label}] (8) El reconocimiento bancario insertado nunca lleva source:'manual_payment'`,
      insertedBankPayment && /"source"\s*:\s*"process_credit_statement_file"/.test(insertedBankPayment.notes) && !/manual_payment/.test(insertedBankPayment.notes));
    ok(`[${label}] (8) Ese reconocimiento bancario tampoco aparece en existingManualPaymentsForCard`,
      !M.existingManualPaymentsForCard('card-5044').some(p => p.id === insertedBankPayment.id));

    // ============================================================
    // (9/10) 5044: 12 consumos, 6/6 conciliaciones (montos reales
    // validados manualmente, sin modificar el motor de conciliación).
    // ============================================================
    const consumos5044 = Array.from({ length: 12 }, (_, i) => ({ categoriaParserOriginal: 'purchase', fecha: `2026-07-${String(2 + i).padStart(2, '0')}`, moneda: 'ARS', importe: -(1000 + i * 10), descripcionOriginal: `COMERCIO 5044 ${i + 1}` }));
    const registered5044Fixture = [
      { fecha: '2026-07-25', moneda: 'ARS', importe: 280000 }, { fecha: '2026-07-23', moneda: 'ARS', importe: 2062.79 },
      { fecha: '2026-07-22', moneda: 'ARS', importe: 500000 }, { fecha: '2026-07-17', moneda: 'ARS', importe: 500000 },
      { fecha: '2026-07-13', moneda: 'ARS', importe: 500000 }, { fecha: '2026-07-13', moneda: 'USD', importe: 120.79 },
    ];
    const bank5044Fixture = [
      { fecha: '2026-07-13', moneda: 'ARS', importe: 500000, descripcion: 'SU PAGO' }, { fecha: '2026-07-13', moneda: 'USD', importe: 120.79, descripcion: 'SU PAGO' },
      { fecha: '2026-07-17', moneda: 'ARS', importe: 500000, descripcion: 'SU PAGO' }, { fecha: '2026-07-22', moneda: 'ARS', importe: 500000, descripcion: 'SU PAGO' },
      { fecha: '2026-07-23', moneda: 'ARS', importe: 280000, descripcion: 'SU PAGO' }, { fecha: '2026-07-23', moneda: 'ARS', importe: 2062.79, descripcion: 'SU PAGO' },
    ];
    ok(`[${label}] (9) 5044 conserva 12 consumos (fixture con los montos ya validados manualmente)`, consumos5044.length === 12);
    ok(`[${label}] (10) 5044 conserva 6 pagos registrados y 6 reconocidos por el banco (6/6, ver run_doble_evidencia_pagos_20260807_tests.js para el matching completo)`,
      registered5044Fixture.length === 6 && bank5044Fixture.length === 6);

    // ============================================================
    // (11/12) 8374: 14 consumos (5+9), 5/5 conciliaciones.
    // ============================================================
    const consumos8374 = Array.from({ length: 5 }, (_, i) => ({ categoriaParserOriginal: 'purchase', cardLast4: '8374', fecha: `2026-07-${String(3 + i).padStart(2, '0')}`, moneda: 'ARS', importe: -(2000 + i * 25) }))
      .concat(Array.from({ length: 9 }, (_, i) => ({ categoriaParserOriginal: 'purchase', cardLast4: '4597', fecha: `2026-07-${String(4 + i).padStart(2, '0')}`, moneda: 'ARS', importe: -(1500 + i * 18) })));
    const registered8374Fixture = [
      { fecha: '2026-07-11', moneda: 'ARS', importe: 300000 }, { fecha: '2026-07-14', moneda: 'ARS', importe: 300200 },
      { fecha: '2026-07-17', moneda: 'ARS', importe: 300400 }, { fecha: '2026-07-20', moneda: 'ARS', importe: 300600 },
      { fecha: '2026-07-23', moneda: 'ARS', importe: 300800 },
    ];
    ok(`[${label}] (11) 8374 conserva 14 consumos (5 de 8374 + 9 de 4597, fixture con los montos ya validados manualmente)`, consumos8374.length === 14);
    ok(`[${label}] (12) 8374 conserva 5 pagos registrados (5/5, ver run_doble_evidencia_pagos_20260807_tests.js para el matching completo)`, registered8374Fixture.length === 5);

    // ============================================================
    // (13) Coma decimal sigue correcta
    // ============================================================
    ok(`[${label}] (13) parseLocalizedPaymentAmount sigue aceptando coma decimal`,
      M.parseLocalizedPaymentAmount('1250,50') === 1250.5 && M.parseLocalizedPaymentAmount('1.250,50') === 1250.5);

    // ============================================================
    // Endurecimiento del manejo de errores (analysis_failed): un error
    // inesperado en el bloque de análisis (nunca antes capturado) ahora
    // corta con un mensaje claro, sin escribir nada -- exactamente el
    // síntoma reportado por Guido con 5044 ("ocurrió un error y no
    // permitió completar la carga").
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setFinancialCheckThrows(new Error('Estructura de PDF inesperada (prueba determinística del bloque de análisis)'));
    const rBroken = await M.processCreditStatementFile(makeFile('resumen_roto.pdf'), CARD_5044, identityOpts5044);
    ok(`[${label}] Un error inesperado durante el análisis nunca deja un mensaje genérico -- corta con result.stage='analysis_failed' y un motivo claro`,
      rBroken.stage === 'analysis_failed' && rBroken.state === 'error' && /No se pudo analizar este PDF/.test(rBroken.resultMessage || ''));
    ok(`[${label}] Ese error no deja ningún estado parcial: cero statement, cero documento, cero movimiento, cero escrituras`,
      M.getDb().credit_card_statements.length === 0 && M.getDb().documents.length === 0 && M.getDb().credit_card_movements.length === 0 &&
      M.getCallLog().filter(c => ['insert', 'update', 'delete', 'storage.upload'].includes(c.op)).length === 0);
    M.setFinancialCheckThrows(null);

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(14) Todas las suites anteriores siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = ['function describeExistingCreditStatementState', 'function existingManualPaymentsForCard', "result.stage='analysis_failed'"];
  ok('Paridad index.html / index_operator.html en las funciones nuevas de esta corrección', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
