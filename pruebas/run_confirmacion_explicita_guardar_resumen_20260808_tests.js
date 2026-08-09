// CONFIRMACIÓN EXPLÍCITA ANTES DEL GUARDADO DE RESÚMENES DE TARJETA —
// 20260808
//
// La auditoría real (Visa 5044, PDF cierre 30/07) encontró que el único
// botón de "Subir resumen" combinaba análisis Y escritura real en un solo
// click, porque runDirectStatementUpload() decidía previewOnly a partir
// de isCreditLocalPreviewMode() (host localhost/127.0.0.1) -- en
// producción eso daba siempre false, así que el primer y único click ya
// intentaba escribir de una, sin ningún paso de confirmación intermedio.
//
// Corrección: dos funciones separadas --
//   runDirectStatementPreview() -- SIEMPRE previewOnly:true, sin importar
//     el host. Nunca escribe.
//   runDirectStatementSave()    -- la ÚNICA vía hacia previewOnly:false,
//     exige que la vista previa ya haya terminado en 'preview_complete'
//     y vuelve a correr el motor completo (nunca reconstruye nada desde
//     el HTML ya renderizado).
// Un único botón visible por vez (ver renderDirectStatementUploadModalBody),
// cuya acción depende de data-action='preview'|'save'.
//
// Esta suite ejecuta esas funciones REALES (extraídas de index.html/
// index_operator.html) contra el backend mockeado ya establecido en esta
// serie -- nunca contra Supabase real.
//
// node pruebas/run_confirmacion_explicita_guardar_resumen_20260808_tests.js
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
function extractLet(src, name) {
  const re = new RegExp(`let ${name}=[\\s\\S]*?;\\r?\\n`);
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró let ' + name);
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
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'buildPaymentMatchRows',
  'describeExistingCreditStatementState', 'existingManualPaymentsForCard',
  'resolveCreditStatementCycleBySequence', 'resolveCreditStatementCycle',
  'resolveCreditStatementWriteTarget', 'creditWriteTargetLabel',
  'esc', 'formatARS', 'formatUSD', 'fmtUsd', 'fileUploadButtonHtml',
  'creditPreviewMovementTableHtml', 'creditPreviewGroupedConsumptionsHtml',
  'creditPreviewSimpleTableHtml', 'creditPreviewCompositionHtml', 'creditPreviewDetailHtml',
  'creditPreviewTraceabilityHtml', 'directStatementResultHtml', 'creditPaymentReconciliationHtml',
  'processCreditStatementFile', 'classifyCreditDirectSaveOutcome',
  'renderDirectStatementUploadModalBody', 'runDirectStatementPreview', 'runDirectStatementSave',
  'detectCreditStatementIdentity', 'extractPdfTextForIdentity',
  'creditProductHints', 'creditProductFamily', 'detectPrimaryBrandMention', 'detectPrimaryProductMention',
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
  code += extractConst(src, 'RECEIPT_ACCEPT_ATTR') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_PARSER_VERSION') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS') + '\n';
  code += extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'ISSUER_FAMILY_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_DATE_CONFIDENCE_LABELS') + '\n';
  for (const n of PARSE_HELPER_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of RECONCILE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `let creditDocumentsMigrationOk=true;\n`;
  code += extractLet(src, 'directUploadState') + '\n';
  code += extractLet(src, 'creditLocalPreviewState') + '\n';
  code += extractConst(src, 'CREDIT_DIRECT_SAVE_NOTHING_WRITTEN_STAGES') + '\n';
  code += extractConst(src, 'CREDIT_DIRECT_SAVE_PARTIAL_STAGES') + '\n';
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };

// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase real, DOM
// real), nunca la lógica de negocio que esta corrección modifica.
// document/modal son stubs mínimos: runDirectStatementPreview/Save no
// dependen de un DOM real (solo mutan directUploadState y llaman
// processCreditStatementFile) -- bindDirectStatementUploadModal/
// refreshDirectStatementUploadModal si se llegaran a invocar no deben
// romper, pero esta suite los evita a propósito para poder inspeccionar
// directUploadState directamente entre pasos.
// ============================================================
let creditCardAccessGranted = true;
let session = { user: { id: 'uuid-guido' } };
let location = { hostname: 'guidorpm.github.io' };
function canRepairCreditDocuments(){ return true; }
function toast(){ return undefined; }
async function refreshDashboardData(){ return undefined; }
function confirm(){ return true; }
let document = { getElementById: () => null };
function modal(){ return undefined; }
function closeModal(){ return undefined; }
function refreshDirectStatementUploadModal(){ return undefined; }

// Doble de PDF.js: nunca lee un PDF real. extractPdfTextForIdentity (real,
// extraída arriba) delega en extractPdfPageLayouts -- se mockea acá para
// devolver el texto sintético de cada prueba (file.__text), en el mismo
// formato {pages:[{pageNum,lines:[{text}]}]} que produce el extractor
// real. Sin __text (archivo real de una prueba que no necesita detección
// de identidad propia), devuelve texto vacío -- detectCreditStatementIdentity
// ya maneja ese caso (identity 'uncertain', sin período).
async function extractPdfPageLayouts(file) {
  const text = file.__text || '';
  const lines = text.split('\\n').map(t => ({ text: t }));
  return { pages: [{ pageNum: 1, lines }] };
}

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
  findStatementForPeriod, describeExistingCreditStatementState, loadCreditCardsData,
  renderDirectStatementUploadModalBody, runDirectStatementPreview, runDirectStatementSave,
  classifyCreditDirectSaveOutcome,
  getDirectUploadState: () => directUploadState,
  setDirectUploadState: (obj) => { directUploadState = obj; },
  parseLocalizedPaymentAmount,
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

function makeFile(name, { size = 1000, type = 'application/pdf', text = '' } = {}) {
  return { name, size, type, __text: text, arrayBuffer: async () => new ArrayBuffer(size) };
}
// Texto sintético real de Banco Provincia Visa (nunca un PDF real): sin
// nombre de mes explícito (periodSource:'fallback'), exactamente el caso
// real auditado -- detectCreditStatementIdentity resuelve identidad
// (last4/marca/emisor) y CIERRE/VENCIMIENTO reales; resolveCreditStatementCycle
// es quien decide el ciclo real por secuencia, no este texto.
function visaStatementText(last4, closeDDMonYY, dueDDMonYY) {
  return [
    'BANCO PROVINCIA VISA',
    `Tarjeta ${last4} Total Consumos de GUIDO NICOLAS RIZZO 12.000,00`,
    `CIERRE ${closeDDMonYY}   VENCIMIENTO ${dueDDMonYY}`,
  ].join('\n');
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

const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
const identityAgosto = { issuer: 'Banco Provincia', issuerFamily: 'banco_provincia', brand: 'Visa', brandFamily: 'visa', product: null, productFamily: 'unknown', productHints: [], last4: '5044', accountHint: null, period: '2026-07', periodSource: 'fallback', confidence: 'high', evidence: [] };

function seedJulioScenario(M) {
  M.resetMockBackend();
  M.seedCard(CARD_5044);
  M.seedStatements([
    { id: 'st-0207', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 2063211.91, total_usd: 120.79, notes: '[[CREDIT_STATEMENT_META:{}]]' },
  ]);
  const sixPayments = sixManualPayments();
  const genericMovs = Array.from({ length: 36 }, (_, i) => ({
    id: 'gm-' + i, card_id: 'card-5044', statement_id: 'st-0207', currency: 'ARS', amount: -(100 + i),
    movement_date: '2026-07-0' + ((i % 9) + 1), notes: '[[CREDIT_META:{"movementType":"purchase"}]]',
  }));
  M.seedMovements([...sixPayments, ...genericMovs]);
  return sixPayments;
}
function financial5044Agosto() {
  return {
    valid: true,
    totals: { statementArs: 1500000, calculatedArs: 1500000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
    breakdown: { saldoAnterior: 0, saldoAnteriorUsd: 0, consumosArs: 1500000, consumosUsd: 0 },
    movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    declaredPreviousBalanceArs: 2063211.91, declaredPreviousBalanceUsd: 120.79,
  };
}
function setAgostoMovementPlan(M) {
  const newConsumo = { categoriaParserOriginal: 'purchase', fecha: '2026-07-05', fechaConfianza: 'alta', moneda: 'ARS', importe: -1500000, descripcionOriginal: 'COMERCIO NUEVO', cardLast4: '5044', cardHolderLabel: 'GUIDO NICOLAS RIZZO', installment: null, firma: 'nuevo-1' };
  M.setMovementPlan({
    movementDetailState: 'DETAILED_COMPLETE', datesResolved: true,
    persistableMovements: [newConsumo, ...sixBankPayments()],
    plannedMovementInserts: [
      { fecha: '2026-07-05', descripcionOriginal: 'COMERCIO NUEVO', moneda: 'ARS', importe: -1500000, categoria: 'purchase' },
      ...sixBankPayments().map(bp => ({ fecha: bp.fecha, descripcionOriginal: bp.descripcionOriginal, moneda: bp.moneda, importe: bp.importe, categoria: 'payment' })),
    ],
  });
}

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_confirmexplicita_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    // ============================================================
    // (9) localhost y producción tienen el mismo flujo de dos pasos --
    //     se repite el mismo escenario con ambos hosts.
    // ============================================================
    for (const host of ['localhost', 'guidorpm.github.io']) {
      const sixPaymentsBefore = seedJulioScenario(M);
      M.setFinancialResult(financial5044Agosto());
      M.setFileHash('hash-5044-agosto-' + host);
      setAgostoMovementPlan(M);
      M.setLocation(host);
      M.setDirectUploadState({ card: CARD_5044, file: makeFile('resumen5044_30jul.pdf', { text: visaStatementText('5044', '30 Jul 26', '10 Ago 26') }), status: 'idle', result: null, error: null, saveOutcome: null, saveError: null, selectedStatementId: 'st-0207', selectedPeriod: '2026-07', manualConfirmed: false, manualPeriod: '' });

      // ============================================================
      // (1) primer click SIEMPRE usa previewOnly:true, sin importar el
      //     host.
      // ============================================================
      await M.runDirectStatementPreview();
      const afterPreview = M.getDirectUploadState();
      ok(`[${label}][${host}] (1) El primer paso (runDirectStatementPreview) termina en preview_complete (previewOnly:true real)`,
        afterPreview.result && afterPreview.result.stage === 'preview_complete');

      // ============================================================
      // (2/3/4) la vista previa nunca escribe: sin Storage, sin
      //     statement nuevo, sin movimientos nuevos.
      // ============================================================
      ok(`[${label}][${host}] (2) La vista previa NO llama a Storage (cero storage.upload en la bitácora)`,
        M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);
      ok(`[${label}][${host}] (3) La vista previa NO crea ningún statement nuevo (siguen existiendo solo los 1 sembrados)`,
        M.getDb().credit_card_statements.length === 1);
      ok(`[${label}][${host}] (4) La vista previa NO crea ningún movimiento nuevo (siguen existiendo solo los 42 sembrados)`,
        M.getDb().credit_card_movements.length === 42);

      // ============================================================
      // (5) "Guardar resumen" (data-action=save) solo aparece tras
      //     preview_complete -- nunca antes.
      // ============================================================
      const htmlBeforePreview = (() => {
        const snapshot = M.getDirectUploadState();
        M.setDirectUploadState({ ...snapshot, result: null, status: 'idle' });
        const html = M.renderDirectStatementUploadModalBody();
        M.setDirectUploadState(snapshot);
        return html;
      })();
      ok(`[${label}][${host}] (5a) Antes de la vista previa, el HTML NUNCA incluye data-action="save"`,
        !htmlBeforePreview.includes('data-action="save"'));
      const htmlAfterPreview = M.renderDirectStatementUploadModalBody();
      ok(`[${label}][${host}] (5b) Tras preview_complete, el HTML incluye el botón "Guardar resumen" (data-action="save")`,
        htmlAfterPreview.includes('data-action="save"') && htmlAfterPreview.includes('Guardar resumen'));
      ok(`[${label}][${host}] (5c) Tras preview_complete, el HTML muestra "todavía no se realizó ningún cambio"`,
        htmlAfterPreview.includes('todavía no se realizó ningún cambio'));

      // ============================================================
      // (6) click en "Guardar resumen" usa previewOnly:false -- escritura
      //     real contra el backend mockeado.
      //
      // En localhost, el guardado real SIGUE bloqueado -- pero por una
      // guardia SEPARADA y PREEXISTENTE (assertCreditWriteAllowed(),
      // basada en el hostname, nunca tocada por esta corrección), no por
      // el flujo de dos pasos en sí. runDirectStatementSave() pide
      // explícitamente previewOnly:false iguial en ambos hosts -- la
      // diferencia real de resultado en localhost viene de esa guardia
      // preexistente, que sigue plenamente vigente (es exactamente la
      // protección que impide escribir por accidente incluso si algo
      // pidiera previewOnly:false en localhost).
      // ============================================================
      const beforeSaveStatementCount = M.getDb().credit_card_statements.length;
      await M.runDirectStatementSave();
      const afterSave = M.getDirectUploadState();
      if (host === 'localhost') {
        ok(`[${label}][${host}] (6-localhost) El guardado real sigue bloqueado en localhost por la guardia preexistente (assertCreditWriteAllowed) -- nunca escribe, sin importar el flujo de dos pasos`,
          afterSave.saveOutcome === 'error' && M.getDb().credit_card_statements.length === beforeSaveStatementCount);
      } else {
        ok(`[${label}][${host}] (6) runDirectStatementSave ejecuta el guardado real (previewOnly:false): se crea un statement nuevo`,
          M.getDb().credit_card_statements.length === beforeSaveStatementCount + 1);
        ok(`[${label}][${host}] (6b) El guardado se clasifica como 'saved' (nunca simula éxito falsamente)`,
          afterSave.saveOutcome === 'saved');

        // ============================================================
        // (10) caso 5044: Agosto 2026 / cierre 30/07 / nuevo statement.
        // ============================================================
        const newStatement = M.getDb().credit_card_statements.find(s => s.id === afterSave.result.statementId);
        ok(`[${label}][${host}] (10) 5044: statement_month del nuevo = 2026-08-01, close_date = 2026-07-30, due_date = 2026-08-10`,
          newStatement && newStatement.statement_month === '2026-08-01' && newStatement.close_date === '2026-07-30' && newStatement.due_date === '2026-08-10');
        ok(`[${label}][${host}] (10b) 5044: el statement de Julio (st-0207) NO fue modificado`,
          M.getDb().credit_card_statements.find(s => s.id === 'st-0207').close_date === '2026-07-02');

        // ============================================================
        // (12) los 6 pagos manuales existentes no se duplican ni
        //      modifican.
        // ============================================================
        const paymentsAfter = M.getDb().credit_card_movements.filter(m => sixPaymentsBefore.some(p => p.id === m.id));
        ok(`[${label}][${host}] (12) Los 6 pagos manuales existentes permanecen intactos tras el guardado (mismo id, statement_id, importe)`,
          paymentsAfter.length === 6 && paymentsAfter.every(m => m.statement_id === 'st-0207') &&
          sixPaymentsBefore.every(before => { const after = paymentsAfter.find(m => m.id === before.id); return after && after.amount === before.amount; }));
      }

      // ============================================================
      // (7) doble click queda bloqueado: reintentar guardar después de
      //     ya haber terminado (saveOutcome ya resuelto) es un no-op.
      // ============================================================
      const dbCountBeforeSecondSave = M.getDb().credit_card_statements.length;
      await M.runDirectStatementSave();
      ok(`[${label}][${host}] (7) Reintentar "Guardar resumen" después de un guardado ya resuelto es un no-op (no crea un segundo statement)`,
        M.getDb().credit_card_statements.length === dbCountBeforeSecondSave);
    }

    // ============================================================
    // (7b) doble click EN VUELO: si status ya es 'saving', un segundo
    //      llamado se ignora (guard de reentrada por status).
    // ============================================================
    seedJulioScenario(M);
    M.setFinancialResult(financial5044Agosto());
    M.setFileHash('hash-5044-doble-click');
    setAgostoMovementPlan(M);
    M.setLocation('guidorpm.github.io');
    M.setDirectUploadState({ card: CARD_5044, file: makeFile('resumen5044_30jul.pdf', { text: visaStatementText('5044', '30 Jul 26', '10 Ago 26') }), status: 'idle', result: null, error: null, saveOutcome: null, saveError: null, selectedStatementId: 'st-0207', selectedPeriod: '2026-07', manualConfirmed: false, manualPeriod: '' });
    await M.runDirectStatementPreview();
    M.setDirectUploadState({ ...M.getDirectUploadState(), status: 'saving' }); // simula "ya está guardando"
    const dbCountDuringFlight = M.getDb().credit_card_statements.length;
    await M.runDirectStatementSave(); // debe ser no-op: status!=='idle'
    ok(`[${label}] (7b) Con status='saving' (guardado ya en curso), un segundo llamado a runDirectStatementSave es un no-op`,
      M.getDb().credit_card_statements.length === dbCountDuringFlight);

    // ============================================================
    // (8) error de guardado nunca se presenta como éxito. Fallo real,
    //     sin ningún efecto secundario: una tarjeta real pero SIN
    //     owner_id real registrado -- uploadCreditDocument
    //     (creditStorageOwnerId) lanza ANTES de tocar Storage,
    //     reproduciendo fielmente "no se pudo guardar el PDF original"
    //     sin escribir nada. El análisis de Paso 1-3 (vista previa) no
    //     depende de owner_id -- solo Paso 4/5 (la escritura real) lo
    //     exige, así que la vista previa debe seguir terminando bien.
    // ============================================================
    M.resetMockBackend();
    const CARD_SIN_OWNER = { id: 'card-sin-owner', brand: 'visa', last4: '9999', owner_id: null };
    M.seedCard(CARD_SIN_OWNER);
    M.setFinancialResult(financial5044Agosto());
    M.setFileHash('hash-5044-error-guardado');
    setAgostoMovementPlan(M);
    M.setDirectUploadState({ card: CARD_SIN_OWNER, file: makeFile('resumen_sin_owner.pdf', { text: visaStatementText('9999', '30 Jul 26', '10 Ago 26') }), status: 'idle', result: null, error: null, saveOutcome: null, saveError: null, selectedStatementId: null, selectedPeriod: null, manualConfirmed: false, manualPeriod: '' });
    await M.runDirectStatementPreview();
    ok(`[${label}] (8-pre) La vista previa igual termina en preview_complete (owner_id solo se exige al guardar, nunca al analizar)`,
      M.getDirectUploadState().result && M.getDirectUploadState().result.stage === 'preview_complete');
    const dbCountBeforeErrorSave = M.getDb().credit_card_statements.length;
    await M.runDirectStatementSave();
    const afterErrorSave = M.getDirectUploadState();
    ok(`[${label}] (8) Un fallo real de guardado (owner_id ausente, falla ANTES de Storage) se clasifica 'error', nunca 'saved'`,
      afterErrorSave.saveOutcome === 'error');
    ok(`[${label}] (8b) Ese fallo real no crea ningún statement (nada escrito)`,
      M.getDb().credit_card_statements.length === dbCountBeforeErrorSave);
    const htmlAfterError = M.renderDirectStatementUploadModalBody();
    ok(`[${label}] (8c) El HTML tras el error muestra "Error de guardado", nunca "Guardado exitoso"`,
      htmlAfterError.includes('Error de guardado') && !htmlAfterError.includes('Guardado exitoso'));

    // ============================================================
    // (11) 8374 no se rompe -- mismo flujo de dos pasos.
    // ============================================================
    M.resetMockBackend();
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    M.seedCard(CARD_8374);
    M.seedStatements([{ id: 'st-8374-jun', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 1, total_usd: 0 }]);
    M.setFinancialResult({ ...financial5044Agosto(), declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10' });
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] });
    M.setDirectUploadState({
      card: CARD_8374, file: makeFile('resumen8374_30jul.pdf', { text: visaStatementText('8374', '30 Jul 26', '10 Ago 26') }), status: 'idle', result: null, error: null, saveOutcome: null, saveError: null,
      selectedStatementId: null, selectedPeriod: null, manualConfirmed: false, manualPeriod: '',
    });
    await M.runDirectStatementPreview();
    ok(`[${label}] (11) 8374: la vista previa resuelve Julio 2026 (Junio + 1 mes), sin errores`,
      M.getDirectUploadState().result.stage === 'preview_complete' && M.getDirectUploadState().result.period === '2026-07');
    await M.runDirectStatementSave();
    ok(`[${label}] (11b) 8374: el guardado real se completa ('saved'), no se rompe`,
      M.getDirectUploadState().saveOutcome === 'saved' && M.getDb().credit_card_statements.length === 2);

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(todas las suites anteriores relacionadas) se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = [
    'async function runDirectStatementPreview(){',
    'async function runDirectStatementSave(){',
    'function classifyCreditDirectSaveOutcome(stage){',
    "previewOnly:true,",
    "previewOnly:false,",
  ];
  ok('Paridad index.html / index_operator.html en la confirmación explícita de guardado', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
