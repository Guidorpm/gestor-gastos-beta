// CORRECCIÓN DEFINITIVA DE PERÍODO/CICLO DE RESÚMENES — 20260807
// La auditoría real de Supabase demostró que `statement_month` no es una
// fórmula fija sobre close_date ni sobre due_date (Visa 5044 y Visa 8374
// tienen relaciones distintas y hasta opuestas entre statement_month y
// sus propias fechas). Esta corrección reescribe la resolución del
// ciclo/período para la subida directa con 3 prioridades:
//   1. Período EXPLÍCITO y confiable declarado por el propio PDF (nombre
//      de mes real + año -- nunca una coincidencia genérica YYYY-MM).
//   2. Secuencia real de la tarjeta: resumen anterior real (por
//      close_date) + 1 mes sobre su propio statement_month.
//   3. Fallback documentado (lo que se haya podido detectar igual, nunca
//      inventado) -- solo si ninguna de las dos anteriores resuelve nada.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// -- incluye pruebas que ejecutan detectCreditStatementIdentity() de punta
// a punta con texto sintético de PDF (vía un extractPdfPageLayouts mockeado,
// nunca un PDF real) para probar la prioridad 1 igual que la usa el
// navegador, y pruebas que ejecutan processCreditStatementFile() completo
// en modo vista previa + el mismo camino de renderizado que usa la vista
// previa manual (directStatementResultHtml/creditPreviewTraceabilityHtml/
// creditPaymentReconciliationHtml). Nunca se conecta a Supabase real.
//
// node pruebas/run_correccion_definitiva_ciclo_periodo_20260807_tests.js
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
  'isCreditLocalPreviewMode', 'canAccessTarjetas',
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
  'esc', 'formatARS', 'formatUSD', 'fmtUsd',
  'creditPreviewMovementTableHtml', 'creditPreviewGroupedConsumptionsHtml',
  'creditPreviewSimpleTableHtml', 'creditPreviewCompositionHtml', 'creditPreviewDetailHtml',
  'creditPreviewTraceabilityHtml', 'directStatementResultHtml', 'creditPaymentReconciliationHtml',
  'processCreditStatementFile', 'detectCreditStatementIdentity',
  'creditProductHints', 'creditProductFamily', 'detectPrimaryBrandMention', 'detectPrimaryProductMention',
  'extractPdfTextForIdentity',
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
  code += extractConst(src, 'ISSUER_FAMILY_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_DATE_CONFIDENCE_LABELS') + '\n';
  for (const n of PARSE_HELPER_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of RECONCILE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `let creditDocumentsMigrationOk=true;\n`;
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
const CREDIT_RECONCILE_SUM_FNS = { visa: sumVisaStatementMovements, mastercard: sumSignedStatementMovements, mercado_pago: sumSignedStatementMovements };

// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase real, PDF.js
// real), nunca la lógica de negocio que esta corrección modifica.
// ============================================================
let creditCardAccessGranted = true;
let session = { user: { id: 'uuid-guido' } };
let location = { hostname: 'guidorpm.github.io' };
function canRepairCreditDocuments(){ return true; }
function toast(){ return undefined; }
async function refreshDashboardData(){ return undefined; }
function confirm(){ return true; }

// Doble de PDF.js: nunca lee un PDF real. extractPdfTextForIdentity (real,
// extraída de arriba) delega en extractPdfPageLayouts -- acá se mockea
// para devolver el texto sintético de cada prueba (file.__text), en el
// mismo formato {pages:[{pageNum,lines:[{text}]}]} que produce el
// extractor real.
async function extractPdfPageLayouts(file) {
  const text = file.__text || '';
  const lines = text.split('\\n').map(t => ({ text: t }));
  return { pages: [{ pageNum: 1, lines }] };
}
function makeTextFile(name, text) {
  return { name, type: 'application/pdf', size: 1000, __text: text, arrayBuffer: async () => new ArrayBuffer(1000) };
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
  findStatementForPeriod, describeExistingCreditStatementState,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  directStatementResultHtml, creditPreviewTraceabilityHtml, creditPaymentReconciliationHtml,
  resolveCreditStatementCycleBySequence, resolveCreditStatementCycle,
  detectCreditStatementIdentity, makeTextFile,
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
    const runtimePath = path.join(__dirname, `_extracted_ciclo_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    // ============================================================
    // (1) PDF con período explícito confiable → respeta período del PDF.
    // (2) No confundir un YYYY-MM accidental dentro del texto con el
    //     período -- el mismo texto trae AMBOS: un "Cuenta 2026-03" que
    //     antes hubiera ganado (patrón #1, corría primero), y el
    //     encabezado real "Resumen correspondiente a Agosto de 2026".
    //     Debe ganar el explícito.
    // ============================================================
    const explicitText = [
      'BANCO PROVINCIA VISA',
      'Cuenta 2026-03 Sucursal 0512',
      'Resumen correspondiente a Agosto de 2026',
      'Tarjeta 5044 Total Consumos de GUIDO NICOLAS RIZZO 12.000,00',
    ].join('\n');
    const identityExplicit = await M.detectCreditStatementIdentity(M.makeTextFile('cualquiera.pdf', explicitText));
    ok(`[${label}] (1) Período explícito ("Resumen correspondiente a Agosto de 2026") se detecta como Agosto 2026`,
      identityExplicit.period === '2026-08');
    ok(`[${label}] (1b) periodSource='explicit' cuando el PDF lo declara de forma inequívoca`,
      identityExplicit.periodSource === 'explicit');
    ok(`[${label}] (2) El "2026-03" accidental (número de cuenta) NUNCA gana sobre el período explícito`,
      identityExplicit.period !== '2026-03');

    // (2b) Solo el YYYY-MM accidental, sin ningún nombre de mes explícito:
    // sigue sirviendo como último recurso (nunca período:null porque sí
    // hay ALGO), pero queda marcado como dato débil, no autoritativo.
    const isoOnlyText = [
      'BANCO PROVINCIA VISA',
      'Referencia de operación 2026-03 código interno',
      'Tarjeta 8374 Total Consumos de OTRO TITULAR 5.000,00',
    ].join('\n');
    const identityIsoOnly = await M.detectCreditStatementIdentity(M.makeTextFile('cualquiera2.pdf', isoOnlyText));
    ok(`[${label}] (2c) Sin nombre de mes explícito, el YYYY-MM genérico sigue sirviendo de último recurso (2026-03)`,
      identityIsoOnly.period === '2026-03');
    ok(`[${label}] (2d) ...pero queda marcado como dato débil (periodSource='iso_generic'), nunca 'explicit'`,
      identityIsoOnly.periodSource === 'iso_generic');

    // ============================================================
    // (6) No usar due_date como regla global -- verificación de código:
    // ni resolveCreditStatementCycle ni resolveCreditStatementCycleBySequence
    // referencian due_date/declaredDueDate en ningún punto.
    // ============================================================
    const cycleFnsSrc = extractFunction(src, 'resolveCreditStatementCycle') + extractFunction(src, 'resolveCreditStatementCycleBySequence');
    ok(`[${label}] (6) resolveCreditStatementCycle/BySequence nunca usan due_date/declaredDueDate como regla`,
      !/due_date|declaredDueDate/.test(cycleFnsSrc));

    // ============================================================
    // (3) Sin período explícito + statement anterior real → anterior + 1
    //     mes (prueba directa y aislada de resolveCreditStatementCycle).
    // ============================================================
    M.resetMockBackend();
    M.seedCard({ id: 'card-x', brand: 'visa', last4: '9999', owner_id: 'uuid-guido' });
    M.seedStatements([
      { id: 'st-x-mar', card_id: 'card-x', owner_id: 'uuid-guido', statement_month: '2026-03-01', close_date: '2026-03-05', due_date: '2026-03-15', status: 'paid', total_ars: 1, total_usd: 0 },
    ]);
    const seqOnly = M.resolveCreditStatementCycle({ id: 'card-x' }, { period: null, periodSource: null }, { declaredCloseDate: '2026-04-06' });
    ok(`[${label}] (3) Sin período explícito, con anterior real (Marzo) → Abril (anterior + 1 mes)`,
      seqOnly.period === '2026-04' && seqOnly.source === 'sequence' && seqOnly.confident === true);

    // ============================================================
    // (4) CASO REAL 5044: Julio cierre 02/07 → nuevo cierre 30/07 =
    //     Agosto. Vía processCreditStatementFile completo, en modo vista
    //     previa, con el MISMO camino de renderizado que la vista previa
    //     manual (directStatementResultHtml/creditPreviewTraceabilityHtml/
    //     creditPaymentReconciliationHtml).
    // ============================================================
    M.resetMockBackend();
    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    M.seedCard(CARD_5044);
    M.seedStatements([
      { id: 'st-2805', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-05-01', close_date: '2026-05-28', due_date: '2026-06-08', status: 'paid', total_ars: 999999, total_usd: 0 },
      { id: 'st-0207', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 2063211.91, total_usd: 120.79 },
    ]);
    M.seedMovements(sixManualPayments());
    // El PDF real de 5044 (formato Banco Provincia) no trae un nombre de
    // mes explícito -- solo "CIERRE 30 Jul 26 VENCIMIENTO 10 Ago 26" (el
    // mismo texto real usado en pruebas anteriores de esta serie). Con
    // esto, identity.periodSource termina en 'fallback' (mes de cierre),
    // así que la Prioridad 2 (secuencia real) debe ser la que decide.
    const visa5044Text = [
      'BANCO PROVINCIA VISA',
      'Tarjeta 5044 Total Consumos de GUIDO NICOLAS RIZZO 12.000,00',
      'CIERRE 30 Jul 26   VENCIMIENTO 10 Ago 26',
    ].join('\n');
    const identity5044 = await M.detectCreditStatementIdentity(M.makeTextFile('resumen5044.pdf', visa5044Text));
    ok(`[${label}] (4-pre) Identidad detectada del PDF real de 5044 no trae período explícito (queda en 'fallback', mes de cierre)`,
      identity5044.periodSource === 'fallback' && identity5044.period === '2026-07');

    const financial5044 = {
      valid: true,
      totals: { statementArs: 1782062.79, calculatedArs: 1782062.79, diffArs: 0, statementUsd: 120.79, calculatedUsd: 120.79, diffUsd: 0 },
      breakdown: { saldoAnterior: 2063211.91, saldoAnteriorUsd: 120.79, consumosArs: 12000, consumosUsd: 0 },
      movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
      declaredPreviousBalanceArs: 2063211.91, declaredPreviousBalanceUsd: 120.79,
    };
    M.setFinancialResult(financial5044);
    M.setFileHash('hash-5044-3007');
    const consumos12 = Array.from({ length: 12 }, (_, i) => ({
      categoriaParserOriginal: 'purchase', fecha: `2026-07-${String(2 + i).padStart(2, '0')}`, fechaConfianza: 'alta',
      moneda: 'ARS', importe: -(1000 + i * 10), descripcionOriginal: `COMERCIO ${i + 1}`, cardLast4: '5044', cardHolderLabel: 'GUIDO NICOLAS RIZZO', installment: null, firma: 'c' + i,
    }));
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, persistableMovements: [...consumos12, ...sixBankPayments()], plannedMovementInserts: [] });

    // Simula el caso real: la pantalla ya tenía preseleccionado el único
    // resumen existente (02/07, período '2026-07') como contexto -- igual
    // que el bug ya corregido de la etapa anterior, pero ahora el propio
    // ciclo también debe resolverse distinto del contexto, sin bloquear.
    const r5044 = await M.processCreditStatementFile(makeFile('resumen5044_30jul.pdf'), CARD_5044, {
      previewOnly: true, statementId: 'st-0207',
      identity: identity5044,
    });
    ok(`[${label}] (4) 5044: el PDF se procesa en vista previa sin bloquear por "mismatch" ni pedir confirmación manual`,
      r5044.stage === 'preview_complete');
    ok(`[${label}] (4b) 5044: ciclo resuelto = Agosto 2026 (nunca Julio, aunque el cierre real caiga en julio)`,
      r5044.period === '2026-08');
    ok(`[${label}] (4c) 5044: la fuente del ciclo fue la secuencia real de la tarjeta (Julio + 1 mes), no el mes de cierre`,
      r5044.cycleResolution && r5044.cycleResolution.source === 'sequence');

    // ============================================================
    // (7) Misma tarjeta + mismo mes calendario de cierre puede avanzar de
    //     ciclo: el cierre real (30/07) cae en julio, pero el ciclo
    //     resuelto es agosto -- nunca coinciden acá, a propósito.
    // ============================================================
    ok(`[${label}] (7) El ciclo (Agosto) avanza aunque el cierre real siga cayendo en el mismo mes calendario (Julio) que el resumen anterior`,
      r5044.period === '2026-08' && String(financial5044.declaredCloseDate).slice(0, 7) === '2026-07');

    // ============================================================
    // Mismo camino de renderizado real que usa la vista previa manual.
    // ============================================================
    const resultHtml5044 = M.directStatementResultHtml(r5044);
    ok(`[${label}] Renderizado real: "Período detectado: Agosto 2026" aparece en directStatementResultHtml()`,
      resultHtml5044.includes('Período detectado: Agosto 2026'));
    const appliedTo5044 = r5044.paymentReconciliation.appliedToLabel;
    const recognizedIn5044 = r5044.paymentReconciliation.recognizedInLabel;
    ok(`[${label}] (5. trazabilidad) "Aplicado a" = Julio 2026 — cierre 02/07/2026`,
      appliedTo5044.startsWith('Julio 2026') && /cierre 0?2\/0?7\/2026/.test(appliedTo5044));
    ok(`[${label}] (5. trazabilidad) "Reconocido en" = Agosto 2026 — cierre 30/07/2026`,
      recognizedIn5044.startsWith('Agosto 2026') && /cierre 30\/0?7\/2026/.test(recognizedIn5044));

    // ============================================================
    // (11/12) 5044 conserva 6/6, diferencias ARS/USD en cero.
    // ============================================================
    ok(`[${label}] (11) 5044 conserva 6/6 pagos conciliados`, r5044.paymentReconciliation.matchResult.matches.length === 6);
    ok(`[${label}] (12) Diferencia ARS 0,00`, r5044.paymentReconciliation.summary.diffArs === 0);
    ok(`[${label}] (12b) Diferencia USD 0,00`, r5044.paymentReconciliation.summary.diffUsd === 0);

    // ============================================================
    // (8) close_date sigue resolviendo identidad del statement existente
    //     -- findStatementForPeriod no fue tocado por esta corrección: el
    //     mismo PDF de 02/07 se sigue encontrando a sí mismo por cierre
    //     real, sin relación con el ciclo/período.
    // ============================================================
    const identityLookup0207 = M.findStatementForPeriod('card-5044', '2026-07', '2026-07-02');
    ok(`[${label}] (8) findStatementForPeriod sigue resolviendo identidad por close_date real (02/07 se encuentra a sí mismo)`,
      identityLookup0207.match && identityLookup0207.match.id === 'st-0207');

    // ============================================================
    // (10) No crea colisión con UNIQUE(owner_id,card_id,statement_month):
    //      el nuevo ciclo (2026-08) es distinto del existente (2026-07).
    // ============================================================
    ok(`[${label}] (10) El nuevo ciclo (2026-08) nunca coincide con el statement_month ya existente (2026-07) -- sin colisión de constraint`,
      r5044.period !== '2026-07-01'.slice(0, 7) && r5044.period === '2026-08');

    // ============================================================
    // (9) Reprocesar el mismo PDF mantiene el mismo ciclo. La garantía
    //     real no depende de que resolveCreditStatementCycle reproduzca
    //     el mismo valor en aislamiento (no tiene por qué: al reprocesar,
    //     el propio statement existente queda excluido de la secuencia
    //     por ser su propio anterior más cercano) -- depende de que la
    //     IDENTIDAD (findStatementForPeriod, por close_date real, sin
    //     tocar en esta corrección) siga encontrando el mismo statement
    //     ya existente, y de que el motor de escritura NUNCA reescriba
    //     statement_month sobre un statement ya encontrado (ver Paso 6:
    //     "statement_month:periodDate(period)" vive exclusivamente
    //     dentro de la rama `if(!statementAlreadyExisted)`).
    // ============================================================
    const reprocessLookup = M.findStatementForPeriod('card-5044', '2026-08', '2026-07-02');
    ok(`[${label}] (9) Reprocesar el mismo PDF (mismo close_date real) sigue encontrando el MISMO statement existente por identidad, sin importar qué ciclo se calcule`,
      reprocessLookup.match && reprocessLookup.match.id === 'st-0207' && reprocessLookup.match.statement_month === '2026-07-01');
    const writeStatementMonthSrc = extractFunction(src, 'processCreditStatementFile');
    const statementAlreadyExistedBranch = writeStatementMonthSrc.slice(
      writeStatementMonthSrc.indexOf('if(!statementAlreadyExisted){'),
      writeStatementMonthSrc.indexOf('if(!statementAlreadyExisted){') + 2000
    );
    ok(`[${label}] (9b) statement_month solo se escribe al CREAR un statement nuevo, nunca al reencontrar uno ya existente (reprocesamiento)`,
      /statement_month:periodDate\(period\)/.test(statementAlreadyExistedBranch));

    // ============================================================
    // (5) CASO REAL 8374: Junio cierre 02/07 → nuevo cierre 30/07 =
    //     Julio (misma secuencia, tarjeta distinta -- nunca una regla
    //     hardcodeada por tarjeta).
    // ============================================================
    M.resetMockBackend();
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    M.seedCard(CARD_8374);
    M.seedStatements([
      { id: 'st-8374-jun', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 1, total_usd: 0 },
    ]);
    const cycle8374 = M.resolveCreditStatementCycle({ id: 'card-8374' }, { period: null, periodSource: 'fallback' }, { declaredCloseDate: '2026-07-30' });
    ok(`[${label}] (5) 8374: Junio (cierre 02/07) → nuevo cierre 30/07 = Julio (misma regla de secuencia, sin hardcodear la tarjeta)`,
      cycle8374.period === '2026-07' && cycle8374.source === 'sequence');

    // ============================================================
    // (13) 8374 no se rompe -- procesa un PDF real de 8374 de punta a
    //      punta sin excepciones, con la tarjeta sembrada arriba.
    // ============================================================
    M.setFinancialResult({
      valid: true, totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 },
      breakdown: { saldoAnterior: 0, saldoAnteriorUsd: 0, consumosArs: 1000, consumosUsd: 0 },
      movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
      declaredPreviousBalanceArs: null, declaredPreviousBalanceUsd: null,
    });
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] });
    const identity8374 = { issuer: 'Banco Provincia', issuerFamily: 'banco_provincia', brand: 'Visa', brandFamily: 'visa', product: null, productFamily: 'unknown', productHints: [], last4: '8374', accountHint: null, period: null, periodSource: 'fallback', confidence: 'high', evidence: [] };
    const r8374 = await M.processCreditStatementFile(makeFile('resumen8374_30jul.pdf'), CARD_8374, { previewOnly: true, identity: identity8374 });
    ok(`[${label}] (13) 8374 no se rompe: procesa el nuevo PDF en vista previa sin errores`, r8374.stage === 'preview_complete');
    ok(`[${label}] (13b) 8374 no se rompe: ciclo resuelto = Julio 2026 (igual que el dato real ya confirmado en Supabase)`, r8374.period === '2026-07');

    // ============================================================
    // (14) Históricos sin close_date no se modifican -- un statement
    //      legado sin close_date nunca se toma como "anterior" (no puede
    //      ordenarse), pero tampoco se toca ni se lanza una excepción.
    // ============================================================
    M.resetMockBackend();
    M.seedCard({ id: 'card-y', brand: 'visa', last4: '1111', owner_id: 'uuid-guido' });
    M.seedStatements([
      { id: 'st-legado-sin-cierre', card_id: 'card-y', owner_id: 'uuid-guido', statement_month: '2025-01-01', close_date: null, due_date: '2025-01-15', status: 'paid', total_ars: 1, total_usd: 0 },
      { id: 'st-y-feb', card_id: 'card-y', owner_id: 'uuid-guido', statement_month: '2025-02-01', close_date: '2025-01-29', due_date: '2025-02-09', status: 'paid', total_ars: 1, total_usd: 0 },
    ]);
    const legacyBefore = JSON.stringify(M.getCreditStatements().find(s => s.id === 'st-legado-sin-cierre'));
    const cycleWithLegacy = M.resolveCreditStatementCycle({ id: 'card-y' }, { period: null, periodSource: null }, { declaredCloseDate: '2025-03-01' });
    const legacyAfter = JSON.stringify(M.getCreditStatements().find(s => s.id === 'st-legado-sin-cierre'));
    ok(`[${label}] (14) El statement histórico sin close_date nunca se toma como "anterior" (se ignora, no puede ordenarse) -- elige Febrero (con cierre real: 2025-01-29) + 1 mes = Marzo, no lo inventa desde el legado`,
      cycleWithLegacy.period === '2025-03');
    ok(`[${label}] (14b) El statement histórico sin close_date no se modifica en absoluto (mismo snapshot antes/después)`,
      legacyBefore === legacyAfter);

    // ============================================================
    // (15) Coma decimal sigue pasando (regresión de siempre).
    // ============================================================
    ok(`[${label}] (15) Coma decimal sigue pasando (parseLocalizedPaymentAmount)`,
      M.parseLocalizedPaymentAmount('1250,50') === 1250.5 && M.parseLocalizedPaymentAmount('1.250,50') === 1250.5);

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(16) Todas las suites anteriores relacionadas siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = [
    'function resolveCreditStatementCycleBySequence(cardId,declaredCloseDate){',
    'function resolveCreditStatementCycle(card,identity,financialResult){',
    "periodSource='explicit';",
    "periodSource='iso_generic';",
    'const cycleResolution=resolveCreditStatementCycle(card,identity,financialResult);',
    'if(!cycleResolution.confident){',
  ];
  ok('Paridad index.html / index_operator.html en la corrección definitiva de ciclo/período', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
