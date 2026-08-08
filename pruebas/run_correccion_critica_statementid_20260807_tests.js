// CORRECCIÓN CRÍTICA Y ACOTADA — NO REUTILIZAR STATEMENT DE CONTEXTO SI EL
// CIERRE NO COINCIDE — 20260807
//
// La auditoría del payload real encontró que `let statementId=
// contextStatement?contextStatement.id:null;` reutilizaba SIEMPRE el
// resumen preseleccionado en pantalla (el "Resumen seleccionado" que la
// UI arrastra desde selectedCreditStatementId, autoseleccionado al
// resumen más reciente existente) como destino de ESCRITURA, sin
// verificar que representara el mismo resumen bancario real que el PDF
// actual. Caso real auditado: contexto = Visa 5044 Julio (cierre
// 02/07/2026, real, 42 movimientos, 6 pagos manuales); PDF nuevo =
// Agosto (cierre 30/07/2026) -- esto hubiera actualizado Julio con los
// datos de Agosto en vez de crear un resumen nuevo.
//
// Corrección: resolveCreditStatementWriteTarget(card,contextStatement,
// period,financialResult) -- única fuente de verdad, usada tanto por el
// diagnóstico de vista previa (Destino de guardado) como por el motor
// real de escritura (Paso 4) -- solo reutiliza contextStatement.id
// cuando su close_date real coincide con el declarado por el PDF actual;
// si no, siempre cae a findStatementForPeriod (identidad real).
//
// Esta suite SÍ ejercita el motor de escritura completo (previewOnly:
// false) -- pero exclusivamente contra el backend mockeado en memoria de
// este archivo (FakeBuilder), que nunca toca Supabase real. Ningún dato
// real de Guido se lee, escribe ni modifica en ningún momento.
//
// node pruebas/run_correccion_critica_statementid_20260807_tests.js
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
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase real, Storage
// real), nunca la lógica de negocio que esta corrección modifica.
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
  findStatementForPeriod, describeExistingCreditStatementState, loadCreditCardsData,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  directStatementResultHtml, creditPreviewTraceabilityHtml, creditPaymentReconciliationHtml,
  resolveCreditStatementCycleBySequence, resolveCreditStatementCycle,
  resolveCreditStatementWriteTarget, creditWriteTargetLabel,
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

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_writetarget_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };

    // ============================================================
    // Setup común: statement real de Julio (02/07), 42 movimientos
    // simulados (usamos 6 pagos manuales + 36 genéricos para llegar a 42
    // sin datos reales), tal como el caso real auditado.
    // ============================================================
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
    const identityAgosto = { issuer: 'Banco Provincia', issuerFamily: 'banco_provincia', brand: 'Visa', brandFamily: 'visa', product: null, productFamily: 'unknown', productHints: [], last4: '5044', accountHint: null, period: '2026-07', periodSource: 'fallback', confidence: 'high', evidence: [] };

    // ============================================================
    // (1) contexto Julio cierre 02/07 + PDF Agosto cierre 30/07 → INSERT
    //     NUEVO. (2) NO UPDATE de st-0207 (equivalente mock de
    //     a09c57ae-...). Ejecuta processCreditStatementFile COMPLETO,
    //     con previewOnly:false, pero exclusivamente contra el backend
    //     mockeado de este archivo -- nunca contra Supabase real.
    // ============================================================
    const sixPaymentsBefore = seedJulioScenario(M);
    M.setFinancialResult(financial5044Agosto());
    M.setFileHash('hash-5044-agosto');
    const newConsumo = { categoriaParserOriginal: 'purchase', fecha: '2026-07-05', fechaConfianza: 'alta', moneda: 'ARS', importe: -1500000, descripcionOriginal: 'COMERCIO NUEVO', cardLast4: '5044', cardHolderLabel: 'GUIDO NICOLAS RIZZO', installment: null, firma: 'nuevo-1' };
    M.setMovementPlan({
      movementDetailState: 'DETAILED_COMPLETE', datesResolved: true,
      persistableMovements: [newConsumo, ...sixBankPayments()],
      plannedMovementInserts: [
        { fecha: '2026-07-05', descripcionOriginal: 'COMERCIO NUEVO', moneda: 'ARS', importe: -1500000, categoria: 'purchase' },
        ...sixBankPayments().map(bp => ({ fecha: bp.fecha, descripcionOriginal: bp.descripcionOriginal, moneda: bp.moneda, importe: bp.importe, categoria: 'payment' })),
      ],
    });

    const beforeStatementCount = M.getDb().credit_card_statements.length;
    const rWrite = await M.processCreditStatementFile(makeFile('resumen5044_30jul.pdf'), CARD_5044, {
      previewOnly: false, statementId: 'st-0207',
      identity: identityAgosto,
    });
    ok(`[${label}] Procesamiento completo sin errores`, rWrite.error === null && rWrite.stage !== 'analysis_failed');
    ok(`[${label}] (17) Período 5044 sigue siendo Agosto 2026`, rWrite.period === '2026-08');
    ok(`[${label}] (1) Decisión: INSERT NUEVO (no reutiliza st-0207)`,
      rWrite.writeTarget && rWrite.writeTarget.isNew === true && rWrite.statementId !== 'st-0207');
    ok(`[${label}] Se creó efectivamente un statement nuevo en la base (antes ${beforeStatementCount}, ahora ${M.getDb().credit_card_statements.length})`,
      M.getDb().credit_card_statements.length === beforeStatementCount + 1);

    const newStatement = M.getDb().credit_card_statements.find(s => s.id === rWrite.statementId);
    const julioStatement = M.getDb().credit_card_statements.find(s => s.id === 'st-0207');
    ok(`[${label}] (3) statement_month del nuevo = 2026-08-01`, newStatement && newStatement.statement_month === '2026-08-01');
    ok(`[${label}] (4) close_date del nuevo = 2026-07-30`, newStatement && newStatement.close_date === '2026-07-30');
    ok(`[${label}] (5) due_date del nuevo = 2026-08-10`, newStatement && newStatement.due_date === '2026-08-10');

    // ============================================================
    // (2) NO UPDATE de st-0207 -- ni en la bitácora de llamadas ni en sus
    //     propios campos (close_date/total_ars/total_usd intactos).
    // ============================================================
    const updateCallsOnJulio = M.getCallLog().filter(c => c.op === 'update' && c.table === 'credit_card_statements' && c.filters.id === 'st-0207');
    ok(`[${label}] (2) NO se ejecuta ningún UPDATE sobre st-0207 (equivalente mock de a09c57ae-...)`, updateCallsOnJulio.length === 0);
    ok(`[${label}] (6. protegido) st-0207 conserva su close_date real (02/07/2026, nunca sobrescrito con 30/07)`,
      julioStatement && julioStatement.close_date === '2026-07-02');
    ok(`[${label}] (6b. protegido) st-0207 conserva sus totales reales (2.063.211,91 / 120,79, nunca sobrescritos)`,
      julioStatement && julioStatement.total_ars === 2063211.91 && julioStatement.total_usd === 120.79);

    // ============================================================
    // (6) movimientos nuevos apuntarían al nuevo statement -- nunca a
    //     st-0207.
    // ============================================================
    const movementsAfter = M.getDb().credit_card_movements;
    const newMovements = movementsAfter.filter(m => m.statement_id === rWrite.statementId);
    const julioMovementsAfter = movementsAfter.filter(m => m.statement_id === 'st-0207');
    ok(`[${label}] (6) Los movimientos nuevos (consumo + reconocimientos bancarios) apuntan al statement NUEVO`,
      newMovements.length === 7);
    ok(`[${label}] (6c) Julio conserva exactamente sus 42 movimientos originales (36 genéricos + 6 pagos), ninguno de más`,
      julioMovementsAfter.length === 42);

    // ============================================================
    // (7) el documento (PDF) apunta al statement NUEVO, nunca a Julio.
    // ============================================================
    const newDocuments = M.getDb().documents.filter(d => d.statement_id === rWrite.statementId);
    const julioDocuments = M.getDb().documents.filter(d => d.statement_id === 'st-0207');
    ok(`[${label}] (7) El documento (PDF) queda vinculado al statement NUEVO`, newDocuments.length === 1);
    ok(`[${label}] (7b) Julio no recibe ningún documento nuevo`, julioDocuments.length === 0);

    // ============================================================
    // (8) los 6 pagos manuales reales permanecen exactamente iguales.
    // ============================================================
    const paymentsAfter = M.getDb().credit_card_movements.filter(m => sixPaymentsBefore.some(p => p.id === m.id));
    ok(`[${label}] (8) Los 6 pagos manuales existentes permanecen intactos (mismo statement_id, mismos importes)`,
      paymentsAfter.length === 6 && paymentsAfter.every(m => m.statement_id === 'st-0207') &&
      sixPaymentsBefore.every(before => { const after = paymentsAfter.find(m => m.id === before.id); return after && after.amount === before.amount && after.currency === before.currency; }));

    // ============================================================
    // (13/14/15) 5044 conserva 6/6, diferencias ARS/USD en cero -- se
    //     recalcula la conciliación con el array de movimientos ya
    //     refrescado (post-escritura) para confirmar que sigue 6/6.
    // ============================================================
    await M.loadCreditCardsData();
    const registered5044 = M.getCreditMovements().filter(m => m.card_id === 'card-5044');
    ok(`[${label}] (13) Siguen existiendo los 6 pagos manuales reales tras la escritura`,
      registered5044.filter(m => sixPaymentsBefore.some(p => p.id === m.id)).length === 6);
    ok(`[${label}] (14/15) rWrite.paymentReconciliation sigue 6/6, diferencia ARS/USD 0,00`,
      rWrite.paymentReconciliation.matchResult.matches.length === 6 &&
      rWrite.paymentReconciliation.summary.diffArs === 0 && rWrite.paymentReconciliation.summary.diffUsd === 0);

    // ============================================================
    // (9) mismo contexto + mismo close_date → puede reutilizar
    //     statement (nunca rompe el reprocesamiento real).
    // ============================================================
    seedJulioScenario(M);
    const sameCloseDateFinancial = { ...financial5044Agosto(), declaredCloseDate: '2026-07-02' };
    M.setFinancialResult(sameCloseDateFinancial);
    const wtSameClose = M.resolveCreditStatementWriteTarget(CARD_5044, { id: 'st-0207', close_date: '2026-07-02' }, '2026-07', sameCloseDateFinancial);
    ok(`[${label}] (9) Mismo contexto + mismo close_date real → SÍ puede reutilizar el statement existente`,
      wtSameClose.isNew === false && wtSameClose.statementId === 'st-0207');

    // ============================================================
    // (10) reprocesar el mismo PDF (mismo declaredCloseDate que Agosto,
    //      ya creado en el paso 1) es idempotente: la segunda vez
    //      encuentra el MISMO statement nuevo, no crea un tercero.
    // ============================================================
    seedJulioScenario(M);
    M.seedStatements([...M.getCreditStatements(), { ...newStatement }]);
    const beforeSecondRun = M.getDb().credit_card_statements.length;
    M.setFinancialResult(financial5044Agosto());
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] });
    const rReprocess = await M.processCreditStatementFile(makeFile('resumen5044_30jul_v2.pdf'), CARD_5044, {
      previewOnly: false, statementId: 'st-0207', identity: identityAgosto,
    });
    ok(`[${label}] (10) Reprocesar el mismo PDF (mismo cierre 30/07) es idempotente: reutiliza el statement de Agosto ya creado, no crea un tercero`,
      rReprocess.statementId === newStatement.id && M.getDb().credit_card_statements.length === beforeSecondRun);

    // ============================================================
    // (11) históricos sin close_date mantienen el fallback seguro de
    //      findStatementForPeriod (delegado, no reimplementado acá).
    // ============================================================
    M.resetMockBackend();
    M.seedCard({ id: 'card-legado', brand: 'visa', last4: '2222', owner_id: 'uuid-guido' });
    M.seedStatements([{ id: 'st-legado', card_id: 'card-legado', owner_id: 'uuid-guido', statement_month: '2020-01-01', close_date: null, due_date: '2020-01-10', status: 'paid', total_ars: 1, total_usd: 0 }]);
    const wtLegado = M.resolveCreditStatementWriteTarget({ id: 'card-legado' }, null, '2020-01', { declaredCloseDate: null });
    ok(`[${label}] (11) Un statement histórico sin close_date sigue siendo encontrable por el fallback seguro de findStatementForPeriod (por período)`,
      wtLegado.isNew === false && wtLegado.statementId === 'st-legado');

    // ============================================================
    // (12) ante identidad ambigua se bloquea antes de escribir.
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.seedStatements([
      { id: 'st-amb-1', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-09-01', close_date: null, due_date: '2026-09-10', status: 'paid', total_ars: 1, total_usd: 0 },
      { id: 'st-amb-2', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-09-01', close_date: null, due_date: '2026-09-11', status: 'paid', total_ars: 1, total_usd: 0 },
    ]);
    const beforeAmbiguous = JSON.stringify(M.getDb());
    M.setFinancialResult({ ...financial5044Agosto(), declaredCloseDate: null, declaredDueDate: null });
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] });
    const rAmbiguous = await M.processCreditStatementFile(makeFile('ambiguo.pdf'), CARD_5044, {
      previewOnly: false, selectedPeriod: '2026-09',
      identity: { period: '2026-09', periodSource: 'fallback', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high', evidence: [] },
    });
    ok(`[${label}] (12) Ante identidad ambigua (2 candidatos reales) se bloquea con review_required, nunca escribe`,
      rAmbiguous.stage === 'review_required' && JSON.stringify(M.getDb()) === beforeAmbiguous);

    // ============================================================
    // (16) 8374 no se rompe -- una tarjeta distinta, sin contexto de
    //      pantalla, sigue resolviendo INSERT NUEVO normalmente.
    // ============================================================
    M.resetMockBackend();
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    M.seedCard(CARD_8374);
    M.seedStatements([{ id: 'st-8374-jun', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-07-02', due_date: '2026-07-13', status: 'paid', total_ars: 1, total_usd: 0 }]);
    M.setFinancialResult({ ...financial5044Agosto(), declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10' });
    M.setMovementPlan({ movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [], plannedMovementInserts: [] });
    const r8374 = await M.processCreditStatementFile(makeFile('resumen8374_30jul.pdf'), CARD_8374, {
      previewOnly: false,
      identity: { period: null, periodSource: 'fallback', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '8374', confidence: 'high', evidence: [] },
    });
    ok(`[${label}] (16) 8374 no se rompe: procesa sin errores`, r8374.error === null && r8374.stage !== 'analysis_failed');
    ok(`[${label}] (16b) 8374 no se rompe: resuelve INSERT NUEVO para Julio 2026 (Junio + 1 mes), consistente con el dato real`,
      r8374.writeTarget && r8374.writeTarget.isNew === true && r8374.period === '2026-07');

    fs.unlinkSync(runtimePath);
  }

  console.log('\n(18) Todas las suites relacionadas siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = [
    'function resolveCreditStatementWriteTarget(card,contextStatement,period,financialResult){',
    'const contextMatchesDeclaredCloseDate=!!(contextStatement&&contextStatement.close_date&&declaredCloseDate&&',
    'function creditWriteTargetLabel(result){',
    'const writeTarget=resolveCreditStatementWriteTarget(card,contextStatement,period,financialResult);',
  ];
  ok('Paridad index.html / index_operator.html en la corrección crítica de statementId', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
