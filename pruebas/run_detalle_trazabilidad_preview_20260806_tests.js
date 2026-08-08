// CIERRE FUNCIONAL DE LA VISTA PREVIA DE RESÚMENES — 20260806
// Detalle completo (secciones A-E) y trazabilidad real de solo lectura
// contra el resumen anterior.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local completo de Supabase (bitácora de llamadas incluida,
// con soporte de SELECT además de insert/update/delete/storage) -- nunca
// se conecta al Supabase real.
//
// node pruebas/run_detalle_trazabilidad_preview_20260806_tests.js
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
  'processCreditStatementFile',
];
const RECONCILE_FUNCTIONS = [
  'parseArgMoney', 'roundMoney', 'sumVisaStatementMovements', 'sumSignedStatementMovements',
  'buildCreditReconcileBreakdown', 'creditResolveDeclaredDates', 'creditResolveCarryInfo',
  'reconcileCreditStatementTotals', 'parseSpanishAbbrevDate', 'resolveMonthDayToDate', 'parseSpanishDayMonth',
];
// Funciones nuevas de la vista previa (CIERRE FUNCIONAL 20260806): detalle
// completo (A-E) y trazabilidad real con el resumen anterior.
const PREVIEW_FUNCTIONS = [
  'fmtDate', 'esc', 'formatARS', 'formatUSD', 'fmtUsd',
  'resolveCreditStatementCycleBySequence', 'resolveCreditStatementCycle',
  'resolveCreditStatementWriteTarget', 'creditWriteTargetLabel',
  'creditPreviewMovementTableHtml', 'creditPreviewGroupedConsumptionsHtml',
  'creditPreviewSimpleTableHtml', 'creditPreviewCompositionHtml', 'creditPreviewDetailHtml',
  'creditPreviewTraceabilityHtml', 'directStatementResultHtml',
  'buildPreviewMovementDetail', 'creditPreviewStatusLabels',
  'loadPreviousCreditStatementTrace', 'creditPreviewTraceEvaluation',
  // CIERRE INTEGRAL TRAZABILIDAD DE TARJETAS 20260806: conciliación de
  // pagos, ahora también calculada dentro de processCreditStatementFile
  // y renderizada por directStatementResultHtml.
  'creditMovementMeta', 'creditMovementType', 'creditStatementLabel',
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'creditPaymentReconciliationHtml', 'buildPaymentMatchRows',
  'describeExistingCreditStatementState', 'existingManualPaymentsForCard',
];

function buildEngineRuntime(src) {
  let code = extractConst(src, 'CREDIT_STATEMENT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_META_PREFIX') + '\n';
  code += extractConst(src, 'RECEIPT_ALLOWED_MIME') + '\n';
  code += extractConst(src, 'RECEIPT_ALLOWED_EXT') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_PARSER_VERSION') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'ISSUER_FAMILY_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_PREVIEW_DATE_CONFIDENCE_LABELS') + '\n';
  code += extractConst(src, 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS') + '\n';
  for (const n of RECONCILE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of PREVIEW_FUNCTIONS) code += extractFunction(src, n) + '\n';
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

// buildExistingSnapshot/buildMovementDetailAnalysis son el motor de fechas
// y matching (extractMovementDates/matchMovementsOneToOne/etc), ya
// probado por separado en run_resumenes_trazabilidad_20260805_tests.js.
// Acá se dobla por un plan controlable: lo que se prueba en este archivo
// es que la vista previa (buildPreviewMovementDetail y el renderizado)
// USA correctamente lo que ese motor ya devuelve, no que el motor mismo
// resuelva fechas -- eso no se reimplementa ni se vuelve a verificar acá.
let __movementPlan = { movementDetailState: 'NO_MOVEMENT_DETAIL_REQUIRED', datesResolved: true, persistableMovements: [] };
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
    if (this.op === 'select') {
      const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return wantSingle ? { data: rows[0] || null, error: null } : { data: rows, error: null };
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
  buildPreviewMovementDetail, creditPreviewStatusLabels,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  creditPreviewGroupedConsumptionsHtml, creditPreviewSimpleTableHtml,
  creditPreviewCompositionHtml, creditPreviewDetailHtml, creditPreviewTraceabilityHtml,
  directStatementResultHtml, formatARS, formatUSD, shiftMonth, periodDate,
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

// ============================================================
// FIXTURES -- reproducen (con montos/fechas de ejemplo, nunca los PDF
// reales) la forma exacta que ya devuelve buildMovementDetailAnalysis:
// persistableMovements con las cifras ya confirmadas por el usuario
// (5044: 12 consumos/6 pagos/1 devolución; 8374: 5+9 consumos/5 pagos/1
// devolución).
// ============================================================
let seq = 0;
function pm(overrides) {
  seq++;
  return Object.assign({
    descripcionOriginal: 'CONSUMO GENERICO ' + seq,
    fecha: '2026-07-05',
    fechaConfianza: 'alta',
    fechaOrigen: 'linea',
    fechaEvidencia: null,
    moneda: 'ARS',
    importe: 1000,
    categoria: 'consumo',
    categoriaParserOriginal: 'purchase',
    subtipo: null,
    origen: 'pdf',
    esIndividual: true,
    computaComoGasto: true,
    firma: 'sig-' + seq,
    motivoPersistible: 'nuevo',
    cardLast4: '5044',
    cardHolderLabel: null,
    installment: null,
  }, overrides);
}

function build5044Fixture() {
  const consumos = Array.from({ length: 12 }, (_, i) => pm({
    descripcionOriginal: `COMERCIO 5044 ${i + 1}`,
    fecha: `2026-07-${String(2 + i).padStart(2, '0')}`,
    moneda: i === 11 ? 'USD' : 'ARS',
    importe: i === 11 ? 9.99 : 1000 + i * 37,
    cardLast4: '5044',
  }));
  const pagos = Array.from({ length: 6 }, (_, i) => pm({
    descripcionOriginal: `PAGO RECIBIDO ${i + 1}`,
    fecha: `2026-07-${String(10 + i).padStart(2, '0')}`,
    moneda: 'ARS',
    importe: -(50000 + i * 100),
    categoria: 'pago', categoriaParserOriginal: 'payment',
    cardLast4: '5044',
  }));
  const devoluciones = [pm({
    descripcionOriginal: 'DEV. IMP. RG 5617 anterior',
    fecha: '2026-07-16', moneda: 'ARS', importe: -1234.56,
    categoria: 'devolucion', categoriaParserOriginal: 'refund',
    cardLast4: '5044',
  })];
  const cargos = [
    pm({ descripcionOriginal: 'SELLADO DE LEY', fecha: '2026-07-30', moneda: 'ARS', importe: 150.25, categoria: 'impuesto', categoriaParserOriginal: 'tax', cardLast4: '5044' }),
    pm({ descripcionOriginal: 'INTERES POR PAGO MINIMO', fecha: '2026-07-30', moneda: 'ARS', importe: 300.75, categoria: 'interes', categoriaParserOriginal: 'interest', cardLast4: '5044' }),
  ];
  const movements = [...consumos, ...pagos, ...devoluciones, ...cargos];
  const sum = (items, currency) => Math.round(items.filter(m => m.moneda === currency).reduce((s, m) => s + m.importe, 0) * 100) / 100;
  const consumosArs = sum(consumos, 'ARS'), consumosUsd = sum(consumos, 'USD');
  const pagosArs = Math.abs(sum(pagos, 'ARS'));
  const devolucionesArs = Math.abs(sum(devoluciones, 'ARS'));
  const cargosArs = Math.round((150.25 + 300.75) * 100) / 100;
  const saldoAnterior = 200000;
  const statementArs = Math.round((saldoAnterior - pagosArs - devolucionesArs + consumosArs + cargosArs) * 100) / 100;
  const statementUsd = consumosUsd;
  const fr = {
    valid: true,
    totals: { statementArs, calculatedArs: statementArs, diffArs: 0, statementUsd, calculatedUsd: statementUsd, diffUsd: 0 },
    breakdown: { saldoAnterior, saldoAnteriorUsd: 0, consumosArs, consumosUsd, impuestos: 150.25, percepciones: 0, intereses: 300.75, interesesFinanciacion: 0, interesesPunitorios: 0, comisiones: 0, ajustes: 0, devoluciones: devolucionesArs },
    movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    declaredPreviousBalanceArs: saldoAnterior, declaredPreviousBalanceUsd: 0,
  };
  return { movements, fr };
}

function build8374Fixture() {
  const consumos8374 = Array.from({ length: 5 }, (_, i) => pm({
    descripcionOriginal: `COMERCIO 8374 ${i + 1}`,
    fecha: `2026-07-${String(3 + i).padStart(2, '0')}`,
    moneda: 'ARS', importe: 2000 + i * 25,
    cardLast4: '8374', cardHolderLabel: 'GUIDO',
  }));
  const consumos4597 = Array.from({ length: 9 }, (_, i) => pm({
    descripcionOriginal: i === 7 ? 'CAPCUT PRO SUSCRIPCION (movimiento que cruza de página en el PDF)' : `COMERCIO 4597 ${i + 1}`,
    fecha: `2026-07-${String(4 + i).padStart(2, '0')}`,
    moneda: i === 7 ? 'USD' : 'ARS', importe: i === 7 ? 9.99 : 1500 + i * 18,
    cardLast4: '4597', cardHolderLabel: 'JULIETA',
  }));
  const consumos = [...consumos8374, ...consumos4597];
  const pagos = Array.from({ length: 5 }, (_, i) => pm({
    descripcionOriginal: `PAGO RECIBIDO ${i + 1}`,
    fecha: `2026-07-${String(11 + i).padStart(2, '0')}`,
    moneda: 'ARS', importe: -(30000 + i * 200),
    categoria: 'pago', categoriaParserOriginal: 'payment', cardLast4: '8374',
  }));
  const devoluciones = [pm({
    descripcionOriginal: 'DEV. IMP. RG 5617 anterior',
    fecha: '2026-07-18', moneda: 'ARS', importe: -876.5,
    categoria: 'devolucion', categoriaParserOriginal: 'refund', cardLast4: '8374',
  })];
  const cargos = [
    pm({ descripcionOriginal: 'SELLADO DE LEY', fecha: '2026-07-30', moneda: 'ARS', importe: 90.1, categoria: 'impuesto', categoriaParserOriginal: 'tax', cardLast4: '8374' }),
    pm({ descripcionOriginal: 'INTERES POR PAGO MINIMO', fecha: '2026-07-30', moneda: 'ARS', importe: 210.4, categoria: 'interes', categoriaParserOriginal: 'interest', cardLast4: '8374' }),
    pm({ descripcionOriginal: 'RG 5617 - PERCEPCION IIBB', fecha: '2026-07-30', moneda: 'ARS', importe: 65.0, categoria: 'impuesto', categoriaParserOriginal: 'tax', cardLast4: '8374' }),
  ];
  const movements = [...consumos, ...pagos, ...devoluciones, ...cargos];
  const sum = (items, currency) => Math.round(items.filter(m => m.moneda === currency).reduce((s, m) => s + m.importe, 0) * 100) / 100;
  const consumosArs = sum(consumos, 'ARS'), consumosUsd = sum(consumos, 'USD');
  const pagosArs = Math.abs(sum(pagos, 'ARS'));
  const devolucionesArs = Math.abs(sum(devoluciones, 'ARS'));
  const cargosArs = Math.round((90.1 + 210.4 + 65.0) * 100) / 100;
  const saldoAnterior = 150000;
  const statementArs = Math.round((saldoAnterior - pagosArs - devolucionesArs + consumosArs + cargosArs) * 100) / 100;
  const statementUsd = consumosUsd;
  const fr = {
    valid: true,
    totals: { statementArs, calculatedArs: statementArs, diffArs: 0, statementUsd, calculatedUsd: statementUsd, diffUsd: 0 },
    breakdown: { saldoAnterior, saldoAnteriorUsd: 0, consumosArs, consumosUsd, impuestos: 155.1, percepciones: 0, intereses: 210.4, interesesFinanciacion: 0, interesesPunitorios: 0, comisiones: 0, ajustes: 0, devoluciones: devolucionesArs },
    movements: [], declaredCloseDate: '2026-07-30', declaredDueDate: '2026-08-10',
    declaredPreviousBalanceArs: saldoAnterior, declaredPreviousBalanceUsd: 0,
  };
  return { movements, fr };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

async function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildEngineRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_detalletraza_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    const CARD_5044 = { id: 'card-5044', brand: 'visa', last4: '5044', owner_id: 'uuid-guido' };
    const CARD_8374 = { id: 'card-8374', brand: 'visa', last4: '8374', owner_id: 'uuid-guido' };
    const identity5044 = { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '5044', confidence: 'high' };
    const identity8374 = { period: '2026-07', brandFamily: 'visa', issuerFamily: 'banco_provincia', last4: '8374', confidence: 'high' };

    // ============================================================
    // 5044 (1-8)
    // ============================================================
    const { movements: mv5044, fr: fr5044 } = build5044Fixture();
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, persistableMovements: mv5044 });
    const detail5044 = M.buildPreviewMovementDetail(CARD_5044, '2026-07', identity5044, fr5044);
    const status5044 = M.creditPreviewStatusLabels(fr5044, detail5044);
    const result5044 = {
      previewOnly: true, financialResult: fr5044, movementDetail: detail5044, previewStatus: status5044,
      previousTrace: { status: 'not_found', statement: null, previousPeriod: '2026-06' },
      previousTraceEvaluation: { state: 'not_found', label: 'NO SE ENCONTRÓ EL RESUMEN ANTERIOR. LA CONTINUIDAD QUEDARÁ PENDIENTE HASTA CARGARLO.' },
      identity: identity5044, period: '2026-07', hash: 'a'.repeat(64),
      resultMessage: 'Vista previa procesada. No se guardó nada (modo de prueba local).',
    };
    const html5044 = M.directStatementResultHtml(result5044);

    ok(`[${label}] (1) 5044: muestra 12 consumos individuales bajo "TARJETA 5044"`,
      html5044.includes('TARJETA 5044') && Array.from({ length: 12 }, (_, i) => `COMERCIO 5044 ${i + 1}`).every(d => html5044.includes(d)));
    ok(`[${label}] 5044: no oculta el consumo en USD`, html5044.includes(M.formatUSD(9.99)));
    ok(`[${label}] (2) 5044: muestra los 6 pagos individualmente`,
      Array.from({ length: 6 }, (_, i) => `PAGO RECIBIDO ${i + 1}`).every(d => html5044.includes(d)));
    ok(`[${label}] (3) 5044: muestra la devolución "DEV. IMP. RG 5617 anterior"`, html5044.includes('DEV. IMP. RG 5617 anterior'));
    ok(`[${label}] (4) 5044: muestra impuestos y cargos individualmente`,
      html5044.includes('SELLADO DE LEY') && html5044.includes('INTERES POR PAGO MINIMO'));
    ok(`[${label}] (5) 5044: composición ARS visible (saldo anterior, pagos, devoluciones, consumos, cargos, saldo final)`,
      html5044.includes('Saldo anterior') && html5044.includes('Menos pagos') && html5044.includes('Menos devoluciones') &&
      html5044.includes('Más consumos') && html5044.includes('Más impuestos y cargos') && html5044.includes('Saldo final leído') &&
      html5044.includes(M.formatARS(fr5044.breakdown.saldoAnterior)));
    ok(`[${label}] (6) 5044: composición USD visible en la misma tabla`,
      html5044.includes(M.formatUSD(fr5044.breakdown.consumosUsd)));
    ok(`[${label}] (7) 5044: diferencia ARS 0,00`, html5044.includes(M.formatARS(0)) && fr5044.totals.diffArs === 0);
    ok(`[${label}] (8) 5044: diferencia USD 0,00`, html5044.includes(M.formatUSD(0)) && fr5044.totals.diffUsd === 0);

    // ============================================================
    // 8374 (9-17)
    // ============================================================
    const { movements: mv8374, fr: fr8374 } = build8374Fixture();
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, persistableMovements: mv8374 });
    const detail8374 = M.buildPreviewMovementDetail(CARD_8374, '2026-07', identity8374, fr8374);
    const status8374 = M.creditPreviewStatusLabels(fr8374, detail8374);
    const result8374 = {
      previewOnly: true, financialResult: fr8374, movementDetail: detail8374, previewStatus: status8374,
      previousTrace: { status: 'not_found', statement: null, previousPeriod: '2026-06' },
      previousTraceEvaluation: { state: 'not_found', label: 'NO SE ENCONTRÓ EL RESUMEN ANTERIOR. LA CONTINUIDAD QUEDARÁ PENDIENTE HASTA CARGARLO.' },
      identity: identity8374, period: '2026-07', hash: 'b'.repeat(64),
      resultMessage: 'Vista previa procesada. No se guardó nada (modo de prueba local).',
    };
    const html8374 = M.directStatementResultHtml(result8374);

    ok(`[${label}] (9) 8374: muestra los 5 consumos de la tarjeta 8374 agrupados bajo "TARJETA 8374 — GUIDO"`,
      html8374.includes('TARJETA 8374 — GUIDO') && Array.from({ length: 5 }, (_, i) => `COMERCIO 8374 ${i + 1}`).every(d => html8374.includes(d)));
    ok(`[${label}] (10) 8374: muestra los 9 consumos de la tarjeta 4597 agrupados bajo "TARJETA 4597 — JULIETA"`,
      html8374.includes('TARJETA 4597 — JULIETA') && [0, 1, 2, 3, 4, 5, 6, 8].every(i => html8374.includes(`COMERCIO 4597 ${i + 1}`)));
    const consumoDescs = mv8374.filter(m => m.categoriaParserOriginal === 'purchase').map(m => m.descripcionOriginal);
    ok(`[${label}] (11) 8374: los 14 consumos (5+9) aparecen individualmente, nunca agregados`,
      consumoDescs.length === 14 && consumoDescs.every(d => html8374.includes(d)));
    ok(`[${label}] (12) 8374: conserva el movimiento de 4597 que cruza de página`,
      html8374.includes('CAPCUT PRO SUSCRIPCION (movimiento que cruza de página en el PDF)') && html8374.includes(M.formatUSD(9.99)));
    ok(`[${label}] (13) 8374: muestra los 5 pagos individualmente`,
      Array.from({ length: 5 }, (_, i) => `PAGO RECIBIDO ${i + 1}`).every(d => html8374.includes(d)));
    ok(`[${label}] (14) 8374: muestra la devolución "DEV. IMP. RG 5617 anterior"`, html8374.includes('DEV. IMP. RG 5617 anterior'));
    ok(`[${label}] (15) 8374: muestra impuestos/intereses/RG 5617 actual individualmente`,
      html8374.includes('SELLADO DE LEY') && html8374.includes('INTERES POR PAGO MINIMO') && html8374.includes('RG 5617 - PERCEPCION IIBB'));
    ok(`[${label}] (16) 8374: diferencia ARS 0,00`, html8374.includes(M.formatARS(0)) && fr8374.totals.diffArs === 0);
    ok(`[${label}] (17) 8374: diferencia USD 0,00`, html8374.includes(M.formatUSD(0)) && fr8374.totals.diffUsd === 0);

    // ============================================================
    // TRAZABILIDAD (18-23) -- CIERRE INTEGRAL TRAZABILIDAD DE TARJETAS
    // 20260806 PARTE B: selección por close_date real (firma actualizada
    // de loadPreviousCreditStatementTrace: cardId, currentStatementId,
    // currentCloseDate, ownerId).
    // ============================================================
    M.resetMockBackend();
    const previousStatementRow = { id: 'st-8374-jun', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-06-30', due_date: '2026-07-10', total_ars: 150000, total_usd: 0 };
    M.seedStatements([previousStatementRow]);
    const trace18 = await M.loadPreviousCreditStatementTrace('card-8374', null, '2026-07-30', 'uuid-guido');
    const selectCalls18 = M.getCallLog().filter(c => c.op === 'select');
    ok(`[${label}] (18) Encuentra el resumen anterior mediante una consulta SELECT real (card_id, close_date más cercano y anterior)`,
      trace18.status === 'found' && trace18.statement.id === 'st-8374-jun' &&
      selectCalls18.length === 1 && selectCalls18[0].table === 'credit_card_statements' &&
      selectCalls18[0].filters.card_id === 'card-8374');

    const evalMatch = M.creditPreviewTraceEvaluation(trace18, { declaredPreviousBalanceArs: 150000, declaredPreviousBalanceUsd: 0 });
    ok(`[${label}] (19) Marca CONTINUIDAD VERIFICADA cuando el saldo anterior declarado coincide (tolerancia $0,01)`,
      evalMatch.state === 'verified' && evalMatch.label === 'CONTINUIDAD VERIFICADA');

    const evalDiff = M.creditPreviewTraceEvaluation(trace18, { declaredPreviousBalanceArs: 150500, declaredPreviousBalanceUsd: 0 });
    ok(`[${label}] (20) Marca DIFERENCIA CON EL RESUMEN ANTERIOR cuando no coincide`,
      evalDiff.state === 'difference' && evalDiff.label === 'DIFERENCIA CON EL RESUMEN ANTERIOR');

    M.resetMockBackend();
    const trace21 = await M.loadPreviousCreditStatementTrace('card-8374', null, '2026-07-30', 'uuid-guido');
    const evalAbsent = M.creditPreviewTraceEvaluation(trace21, { declaredPreviousBalanceArs: 150000, declaredPreviousBalanceUsd: 0 });
    ok(`[${label}] (21) Informa claramente cuando no hay resumen anterior ("NO SE ENCONTRÓ...")`,
      trace21.status === 'not_found' && /NO SE ENCONTRÓ EL RESUMEN ANTERIOR/.test(evalAbsent.label));

    ok(`[${label}] (22) loadPreviousCreditStatementTrace no realiza ninguna escritura`,
      M.getCallLog().filter(c => ['insert', 'update', 'delete', 'storage.upload', 'storage.remove'].includes(c.op)).length === 0);

    // (23) nunca usa el mismo PDF (mismo close_date que el actual) como si
    // fuera el anterior -- close_date debe ser ESTRICTAMENTE anterior.
    M.resetMockBackend();
    M.seedStatements([{ id: 'st-8374-jul-otro', card_id: 'card-8374', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-30', due_date: '2026-08-10', total_ars: 999999, total_usd: 0 }]);
    const trace23 = await M.loadPreviousCreditStatementTrace('card-8374', null, '2026-07-30', 'uuid-guido');
    ok(`[${label}] (23) Nunca usa un statement con el MISMO close_date que el actual como "resumen anterior" -- solo close_date estrictamente anterior`,
      trace23.status === 'not_found' && trace23.statement === null);

    // ============================================================
    // SEGURIDAD (24-29) -- end-to-end en modo vista previa local
    // ============================================================
    M.resetMockBackend();
    M.seedCard(CARD_5044);
    M.setLocation('localhost');
    M.setAccess(true);
    M.setSession('uuid-guido');
    M.setFinancialResult(fr5044);
    M.setMovementPlan({ movementDetailState: 'DETAILED_COMPLETE', datesResolved: true, persistableMovements: mv5044 });
    const rSec = await M.processCreditStatementFile(makeFile('resumen5044.pdf'), CARD_5044, {
      previewOnly: true, identity: identity5044,
    });
    const writeOps = M.getCallLog().filter(c => ['insert', 'update', 'delete', 'storage.upload', 'storage.remove'].includes(c.op));
    ok(`[${label}] (24) Vista previa: cero operaciones insert`, M.getCallLog().filter(c => c.op === 'insert').length === 0);
    ok(`[${label}] (25) Vista previa: cero operaciones update`, M.getCallLog().filter(c => c.op === 'update').length === 0);
    ok(`[${label}] (26) Vista previa: cero operaciones delete`, M.getCallLog().filter(c => c.op === 'delete').length === 0);
    ok(`[${label}] (27) Vista previa: cero storage.upload`, M.getCallLog().filter(c => c.op === 'storage.upload').length === 0);
    ok(`[${label}] (28) Vista previa: cero storage.remove`, M.getCallLog().filter(c => c.op === 'storage.remove').length === 0);
    ok(`[${label}] Vista previa: cero escrituras en total (${writeOps.length} encontradas)`, writeOps.length === 0);
    ok(`[${label}] (29) Mantiene el aviso "no se guardó nada" y calcula detalle + trazabilidad también en preview`,
      rSec.stage === 'preview_complete' && /No se guard[oó] nada/i.test(rSec.resultMessage || '') &&
      !!rSec.movementDetail && !!rSec.previewStatus && !!rSec.previousTrace && !!rSec.previousTraceEvaluation);

    fs.unlinkSync(runtimePath);
  }

  // ============================================================
  // REGRESIÓN (30-31) -- HTTP 200 se verifica con el servidor levantado
  // ============================================================
  console.log('\n(30) index.html HTTP 200 se verifica por separado con curl contra el servidor local levantado.');
  console.log('(31) index_operator.html HTTP 200 se verifica por separado con curl contra el servidor local levantado.');

  const parityMarkers = ['function buildPreviewMovementDetail', 'function loadPreviousCreditStatementTrace', 'function creditPreviewTraceEvaluation', 'function directStatementResultHtml', 'function creditPreviewDetailHtml'];
  ok('Paridad index.html / index_operator.html en las funciones nuevas de esta corrección', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));

  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
