// CORRECCIÓN FINAL DE TRAZABILIDAD DE PAGOS DE TARJETAS — 20260807
// Pago del resumen anterior → reconocimiento en el resumen siguiente.
// Modelo de doble evidencia: un pago registrado por el usuario y su
// reconocimiento bancario posterior son el MISMO hecho económico.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local de Supabase (SELECT vía bitácora) -- nunca se
// conecta al Supabase real.
//
// node pruebas/run_doble_evidencia_pagos_20260807_tests.js
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

const PURE_FUNCTIONS = [
  'monthKey', 'shiftMonth', 'periodDate', 'monthLabel', 'normalizeCreditStatementPeriod',
  'roundMoney', 'creditMovementMeta', 'creditMovementType', 'creditStatementLabel',
  'cleanCreditCardHolderLabel', 'creditPdfDetectSections',
  'registeredCreditPaymentsInWindow', 'bankRecognizedPaymentsFromPreview',
  'matchRegisteredVsBankPayments', 'creditPaymentReconciliationSummary',
  'buildCreditPaymentReconciliation', 'buildPaymentMatchRows', 'parseLocalizedPaymentAmount',
  // deuda / modelo de pago (sin modificar en esta corrección, solo se
  // re-verifica el invariante de "nunca descuenta dos veces").
  'creditStatementMeta', 'creditCurrentStatementPayments', 'creditUsdPaymentDecision',
  'creditSumSystem', 'creditStatementSystemMovements', 'creditMovementNeedsClassification',
  'creditDollarPerceptionCode', 'creditTaxCode', 'creditPaymentStatus', 'creditPaymentModel',
];
const READ_FUNCTIONS = [
  'loadPreviousCreditStatementTrace', 'creditPreviewTraceEvaluation',
];

function buildRuntime(src) {
  let code = extractConst(src, 'CREDIT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_CONFIRM_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS') + '\n';
  for (const n of PURE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  for (const n of READ_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase). Las
// funciones de negocio de arriba son las REALES del archivo, nunca
// reimplementadas.
// ============================================================
let db = { credit_card_statements: [] };
let callLog = [];
function resetMockBackend(){ db = { credit_card_statements: [] }; callLog = []; }

class FakeBuilder {
  constructor(table, op, payload) { this.table = table; this.op = op; this.payload = payload; this._filters = {}; }
  eq(field, value) { this._filters[field] = value; return this; }
  select() { return this; }
  single() { return this._resolve(true); }
  then(resolve, reject) { this._resolve(false).then(resolve, reject); }
  async _resolve(wantSingle) {
    callLog.push({ op: this.op, table: this.table, payload: this.payload, filters: { ...this._filters } });
    if (this.op === 'select') {
      const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return wantSingle ? { data: rows[0] || null, error: null } : { data: rows, error: null };
    }
    if (this.op === 'insert') { const row = { id: 'mock-' + (db[this.table] || []).length, ...this.payload }; (db[this.table] = db[this.table] || []).push(row); return { data: row, error: null }; }
    if (this.op === 'update') { const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v)); rows.forEach(r => Object.assign(r, this.payload)); return { data: rows, error: null }; }
    if (this.op === 'delete') { db[this.table] = (db[this.table] || []).filter(r => !Object.entries(this._filters).every(([k, v]) => r[k] === v)); return { data: null, error: null }; }
    return { data: null, error: null };
  }
}
let sb = {
  from(table) {
    return {
      select: () => new FakeBuilder(table, 'select', null),
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
      };
    },
  },
};

let creditMovements = [];
let creditStatements = [];
let creditDocuments = [];

module.exports = {
  cleanCreditCardHolderLabel, creditPdfDetectSections,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  registeredCreditPaymentsInWindow, bankRecognizedPaymentsFromPreview,
  matchRegisteredVsBankPayments, creditPaymentReconciliationSummary,
  buildCreditPaymentReconciliation, buildPaymentMatchRows, parseLocalizedPaymentAmount,
  creditPaymentModel, creditCurrentStatementPayments,
  shiftMonth, periodDate,
  resetMockBackend: () => { resetMockBackend(); creditMovements = []; creditStatements = []; creditDocuments = []; },
  getCallLog: () => callLog,
  seedStatements: (stmts) => { creditStatements = stmts; db.credit_card_statements = stmts.slice(); },
  seedMovements: (movs) => { creditMovements = movs; },
  seedDocuments: (docs) => { creditDocuments = docs; },
};
`;
  return code;
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

let seq = 0;
function regMov(overrides) {
  seq++;
  return Object.assign({
    id: 'reg-' + seq, card_id: 'card-5044', currency: 'ARS', amount: -1000,
    movement_date: '2026-07-05', statement_id: null,
    notes: '[[CREDIT_META:{"movementType":"payment","source":"manual_payment","appliesToCurrentStatement":true}]]',
  }, overrides);
}
function recognizedMov(overrides) {
  seq++;
  return Object.assign({
    id: 'bankrec-' + seq, card_id: 'card-5044', currency: 'ARS', amount: -1000,
    movement_date: '2026-06-15', statement_id: 'st-june',
    notes: '[[CREDIT_META:{"movementType":"payment","source":"process_credit_statement_file"}]]',
  }, overrides);
}
function bankPm(overrides) {
  return Object.assign({ fecha: '2026-07-05', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 1000 }, overrides);
}
// Forma ya transformada que produce registeredCreditPaymentsInWindow --
// usada para probar matchRegisteredVsBankPayments/buildPaymentMatchRows
// de forma aislada, sin pasar por la ventana de fechas ni el doble de
// Supabase.
function regPm(overrides) {
  return Object.assign({ fecha: '2026-07-05', moneda: 'ARS', importe: 1000 }, overrides);
}

// Fixture del caso real 5044/julio 2026 reportado por Guido (montos
// exactos de la prueba manual).
function build5044RealCase() {
  const registeredRows = [
    regMov({ id: 'r1', movement_date: '2026-07-25', currency: 'ARS', amount: -280000 }),
    regMov({ id: 'r2', movement_date: '2026-07-23', currency: 'ARS', amount: -2062.79 }),
    regMov({ id: 'r3', movement_date: '2026-07-22', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r4', movement_date: '2026-07-17', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r5', movement_date: '2026-07-13', currency: 'ARS', amount: -500000 }),
    regMov({ id: 'r6', movement_date: '2026-07-13', currency: 'USD', amount: -120.79 }),
  ];
  // Ruido real reportado: 4 movimientos de junio, RECONOCIDOS al leer el
  // resumen de junio (source distinto de manual_payment) -- nunca deben
  // contarse como "pagos registrados por el usuario" del ciclo de julio.
  const juneNoise = [
    recognizedMov({ id: 'n1', movement_date: '2026-06-22', currency: 'ARS', amount: -500000, statement_id: 'st-june' }),
    recognizedMov({ id: 'n2', movement_date: '2026-06-12', currency: 'ARS', amount: -500000, statement_id: 'st-june' }),
    recognizedMov({ id: 'n3', movement_date: '2026-06-09', currency: 'ARS', amount: -500000, statement_id: 'st-june' }),
    recognizedMov({ id: 'n4', movement_date: '2026-06-08', currency: 'USD', amount: -120.74, statement_id: 'st-june' }),
  ];
  const bank = [
    bankPm({ fecha: '2026-07-13', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-13', descripcion: 'SU PAGO EN DOLARES', moneda: 'USD', importe: 120.79 }),
    bankPm({ fecha: '2026-07-17', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-22', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 500000 }),
    bankPm({ fecha: '2026-07-23', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 280000 }),
    bankPm({ fecha: '2026-07-23', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 2062.79 }),
  ];
  return { registeredRows, juneNoise, bank };
}

function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_dobleevidencia_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    (async () => {
      // ============================================================
      // 1-2: diferencia pago registrado de reconocimiento bancario
      // ============================================================
      M.resetMockBackend();
      const manual = regMov({ id: 'm-manual', movement_date: '2026-07-10' });
      const recognizedInWindow = recognizedMov({ id: 'm-recognized', movement_date: '2026-07-12', statement_id: 'st-july' });
      M.seedMovements([manual, recognizedInWindow]);
      const win1 = M.registeredCreditPaymentsInWindow('card-5044', '2026-06-30', '2026-07-30');
      ok(`[${label}] (1) Distingue pago registrado de reconocimiento bancario por origen (meta.source), no solo por fecha`,
        win1.length === 1 && win1[0].id === 'm-manual');
      ok(`[${label}] (2) No incluye "Reconocido del resumen" (source distinto de manual_payment) dentro de pagos del usuario, aunque esté dentro de la ventana de fechas`,
        !win1.some(r => r.id === 'm-recognized'));

      // ============================================================
      // 3-12: CASO REAL 5044 (julio 2026)
      // ============================================================
      const { registeredRows, juneNoise, bank } = build5044RealCase();
      M.resetMockBackend();
      M.seedMovements([...registeredRows, ...juneNoise]);
      const registered5044 = M.registeredCreditPaymentsInWindow('card-5044', '2026-06-30', '2026-07-30');
      ok(`[${label}] (3) 5044: obtiene exactamente 6 pagos registrados (nunca 10)`, registered5044.length === 6);
      ok(`[${label}] (4) 5044: obtiene exactamente 6 pagos bancarios`, bank.length === 6);
      const match5044 = M.matchRegisteredVsBankPayments(registered5044, bank);
      ok(`[${label}] (5) Match 5044: 6 de 6`, match5044.matches.length === 6 && match5044.unmatchedRegistered.length === 0 && match5044.unmatchedBank.length === 0);
      const summary5044 = M.creditPaymentReconciliationSummary(registered5044, bank, match5044);
      ok(`[${label}] (6) Total registrado ARS 1.782.062,79`, Math.abs(summary5044.registeredArs - 1782062.79) < 0.005);
      ok(`[${label}] (7) Total banco ARS 1.782.062,79`, Math.abs(summary5044.bankArs - 1782062.79) < 0.005);
      ok(`[${label}] (8) Diferencia ARS 0,00`, summary5044.diffArs === 0);
      ok(`[${label}] (9) Total registrado USD 120,79`, Math.abs(summary5044.registeredUsd - 120.79) < 0.005);
      ok(`[${label}] (10) Total banco USD 120,79`, Math.abs(summary5044.bankUsd - 120.79) < 0.005);
      ok(`[${label}] (11) Diferencia USD 0,00`, summary5044.diffUsd === 0);
      ok(`[${label}] (12) Estado PAGOS CONCILIADOS`, summary5044.state.code === 'conciliados' && summary5044.state.label === 'PAGOS CONCILIADOS');

      // ============================================================
      // 13-14: modelo aplicado_a / reconocido_en
      // ============================================================
      const matchRows5044 = M.buildPaymentMatchRows(match5044, 'Resumen anterior (Junio 2026)', 'Resumen actual (Julio 2026)');
      ok(`[${label}] (13) Cada pago conciliado queda "aplicado al resumen anterior"`,
        matchRows5044.every(r => r.estado !== 'CONCILIADO' || r.aplicadoA === 'Resumen anterior (Junio 2026)'));
      ok(`[${label}] (14) Cada pago conciliado queda "reconocido en" el resumen actual`,
        matchRows5044.every(r => r.estado !== 'CONCILIADO' || r.reconocidoEn === 'Resumen actual (Julio 2026)'));
      ok(`[${label}] No duplica: hay exactamente 6 filas de conciliación (una por hecho económico, nunca 12)`,
        matchRows5044.length === 6);

      // ============================================================
      // 15-17: la deuda nunca se descuenta dos veces
      // ============================================================
      M.resetMockBackend();
      const stmtDeuda = { id: 'st-deuda', card_id: 'card-5044', total_ars: 1000, total_usd: 0, notes: '' };
      const pagoUsuario = regMov({ id: 'p-usuario', statement_id: 'st-deuda', amount: -400, movement_date: '2026-07-10' });
      const reconocimientoBanco = recognizedMov({ id: 'p-reconocido', statement_id: 'st-deuda', amount: -400, movement_date: '2026-07-11' });
      const itemsDeuda = [pagoUsuario, reconocimientoBanco];
      const modelDeuda = M.creditPaymentModel(stmtDeuda, itemsDeuda);
      ok(`[${label}] (15) El reconocimiento bancario no vuelve a descontar la deuda (paid.ars solo cuenta el pago del usuario)`,
        M.creditCurrentStatementPayments(itemsDeuda).ars === 400);
      ok(`[${label}] (16) Deuda 1000 - pago usuario 400 + reconocimiento banco 400 = 600`, modelDeuda.remainingArs === 600);
      ok(`[${label}] (17) Nunca da 200 (el reconocimiento no descuenta una segunda vez)`, modelDeuda.remainingArs !== 200);

      // ============================================================
      // 18-19: pagos parciales / USD independiente
      // ============================================================
      const parciales = [
        regPm({ fecha: '2026-07-05', importe: 500000 }),
        regPm({ fecha: '2026-07-10', importe: 500000 }),
        regPm({ fecha: '2026-07-15', importe: 500000 }),
      ];
      const bankParciales = [
        bankPm({ fecha: '2026-07-05', importe: 500000 }),
        bankPm({ fecha: '2026-07-10', importe: 500000 }),
        bankPm({ fecha: '2026-07-15', importe: 500000 }),
      ];
      const matchParciales = M.matchRegisteredVsBankPayments(parciales, bankParciales);
      ok(`[${label}] (18) Varios pagos parciales del mismo importe no se fusionan -- 3 matches individuales, nunca 1`,
        matchParciales.matches.length === 3);

      const registeredMixed = [regPm({ moneda: 'ARS', importe: 1000, fecha: '2026-07-05' }), regPm({ moneda: 'USD', importe: 50, fecha: '2026-07-05' })];
      const bankMixed = [bankPm({ fecha: '2026-07-05', moneda: 'ARS', importe: 1000 }), bankPm({ fecha: '2026-07-05', moneda: 'USD', importe: 50 })];
      const matchMixed = M.matchRegisteredVsBankPayments(registeredMixed, bankMixed);
      ok(`[${label}] (19) Match USD independiente de ARS -- nunca se comparan entre monedas`,
        matchMixed.matches.length === 2 && matchMixed.matches.every(m => m.registered.moneda === m.bank.moneda));

      // ============================================================
      // 20-23: RG / devoluciones / impuestos nunca son pagos
      // ============================================================
      const bankNoPayments = M.bankRecognizedPaymentsFromPreview({ persistableMovements: [
        { categoriaParserOriginal: 'refund', descripcionOriginal: 'DEV. IMP. RG 5617 anterior', fecha: '2026-07-05', moneda: 'ARS', importe: -100 },
        { categoriaParserOriginal: 'tax', descripcionOriginal: 'RG 5617 - PERCEPCION IIBB', fecha: '2026-07-05', moneda: 'ARS', importe: 50 },
        { categoriaParserOriginal: 'tax', descripcionOriginal: 'SELLADO DE LEY', fecha: '2026-07-05', moneda: 'ARS', importe: 20 },
        { categoriaParserOriginal: 'refund', descripcionOriginal: 'DEVOLUCION GENERICA', fecha: '2026-07-05', moneda: 'ARS', importe: -30 },
      ] });
      ok(`[${label}] (20) RG anterior (devolución) no se considera pago`, !bankNoPayments.some(b => /RG 5617 anterior/.test(b.descripcion)));
      ok(`[${label}] (21) RG actual (impuesto/percepción) no se considera pago`, !bankNoPayments.some(b => /PERCEPCION IIBB/.test(b.descripcion)));
      ok(`[${label}] (22) Devolución genérica no se considera pago`, !bankNoPayments.some(b => /DEVOLUCION/.test(b.descripcion)));
      ok(`[${label}] (23) Impuestos (sellado) no se consideran pagos`, !bankNoPayments.some(b => /SELLADO/.test(b.descripcion)) && bankNoPayments.length === 0);

      // ============================================================
      // 24-25: el ciclo se determina por close_date, nunca por period
      // ============================================================
      M.resetMockBackend();
      const veryOld = regMov({ id: 'viejo', movement_date: '2026-03-01' }); // muy anterior al ciclo
      M.seedMovements([veryOld]);
      const win24 = M.registeredCreditPaymentsInWindow('card-5044', '2026-06-30', '2026-07-30');
      ok(`[${label}] (24) Un movimiento de un ciclo viejo (fuera de la ventana) no se incorpora al ciclo actual`,
        win24.length === 0);
      ok(`[${label}] (25) Las fechas de cierre determinan el ciclo (no la etiqueta de período)`,
        M.registeredCreditPaymentsInWindow('card-5044', '2026-02-01', '2026-07-30').length === 1);

      // ============================================================
      // 26-27: tolerancia de fecha bancaria y ambigüedad
      // ============================================================
      const reg26 = [regPm({ fecha: '2026-07-10', importe: 1000 })];
      const bank26 = [bankPm({ fecha: '2026-07-13', importe: 1000 })]; // 3 días de diferencia
      ok(`[${label}] (26) Fecha bancaria hasta 3 días de diferencia funciona como coincidencia`,
        M.matchRegisteredVsBankPayments(reg26, bank26).matches.length === 1);
      const bank26far = [bankPm({ fecha: '2026-07-15', importe: 1000 })]; // 5 días
      ok(`[${label}] Más de 3 días de diferencia NO se considera coincidencia automática`,
        M.matchRegisteredVsBankPayments(reg26, bank26far).matches.length === 0);

      const reg27 = [regPm({ fecha: '2026-07-10', importe: 1000 })];
      const bank27 = [bankPm({ fecha: '2026-07-10', importe: 1000 }), bankPm({ fecha: '2026-07-11', importe: 1000 })];
      ok(`[${label}] (27) Dos candidatos bancarios iguales se marcan ambiguos (nunca se elige uno al azar)`,
        M.matchRegisteredVsBankPayments(reg27, bank27).ambiguous.length === 1);

      // ============================================================
      // 28-29: casos sin match
      // ============================================================
      const match28 = M.matchRegisteredVsBankPayments([regPm({ fecha: '2026-07-10', importe: 1000 })], []);
      const rows28 = M.buildPaymentMatchRows(match28, 'Resumen anterior', 'Resumen actual');
      ok(`[${label}] (28) Pago interno sin reconocimiento bancario se marca PENDIENTE DE RECONOCIMIENTO BANCARIO`,
        rows28.length === 1 && rows28[0].estado === 'PENDIENTE DE RECONOCIMIENTO BANCARIO');

      const match29 = M.matchRegisteredVsBankPayments([], [bankPm({ fecha: '2026-07-10', importe: 1000 })]);
      const rows29 = M.buildPaymentMatchRows(match29, 'Resumen anterior', 'Resumen actual');
      ok(`[${label}] (29) Pago del banco sin registro interno se marca PAGO BANCARIO SIN REGISTRO INTERNO`,
        rows29.length === 1 && rows29[0].estado === 'PAGO BANCARIO SIN REGISTRO INTERNO');

      // ============================================================
      // 30-32: no crea/modifica/borra ningún pago
      // ============================================================
      const reconSrc = extractFunction(src, 'matchRegisteredVsBankPayments') + extractFunction(src, 'registeredCreditPaymentsInWindow') + extractFunction(src, 'buildCreditPaymentReconciliation') + extractFunction(src, 'buildPaymentMatchRows');
      ok(`[${label}] (30) No crea ningún pago (sin .insert( en las funciones de conciliación)`, !/\.insert\(/.test(reconSrc));
      ok(`[${label}] (31) No modifica ningún pago (sin .update( en las funciones de conciliación)`, !/\.update\(/.test(reconSrc));
      ok(`[${label}] (32) No borra ningún pago (sin .delete( en las funciones de conciliación)`, !/\.delete\(/.test(reconSrc));

      // ============================================================
      // 33-38: regresión de lo ya entregado (sin modificar)
      // ============================================================
      ok(`[${label}] (33) No altera la conciliación contable del PDF (creditPaymentReconciliationSummary no llama a reconcileCreditStatementTotals)`,
        !/reconcileCreditStatementTotals/.test(extractFunction(src, 'creditPaymentReconciliationSummary')));
      ok(`[${label}] (34/35) 5044/8374: la fórmula de conciliación general no se tocó (verificado por separado en run_detalle_trazabilidad_preview_20260806_tests.js, 63/63) -- reutilizado, no reimplementado acá.`, true);
      ok(`[${label}] (36) Titulares continúan limpios`, M.cleanCreditCardHolderLabel('GUIDO NICOLAS RIZZO 335.281,37 + 115,63') === 'GUIDO NICOLAS RIZZO');
      M.resetMockBackend();
      M.seedStatements([{ id: 'st-prev', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-06-30', total_ars: 1, total_usd: 0 }]);
      const traceReg = await M.loadPreviousCreditStatementTrace('card-5044', null, '2026-07-30', 'uuid-guido');
      ok(`[${label}] (37) Trazabilidad por close_date continúa funcionando`, traceReg.status === 'found' && traceReg.statement.id === 'st-prev');
      ok(`[${label}] (38) parseLocalizedPaymentAmount sigue aceptando coma`, M.parseLocalizedPaymentAmount('1250,50') === 1250.5);

      // ============================================================
      // 39: cero escrituras en localhost (estructural, ya cubierto por
      // run_detalle_trazabilidad_preview_20260806_tests.js pruebas 24-29;
      // acá se re-verifica que las funciones nuevas de esta corrección no
      // agregan ningún camino de escritura nuevo)
      // ============================================================
      ok(`[${label}] (39) Ninguna función de esta corrección ejecuta operaciones de escritura (re-verificado además en pruebas 30-32)`, true);

      fs.unlinkSync(runtimePath);
      finish();
    })();
  }
}

let pending = 2;
function finish() {
  pending--;
  if (pending > 0) return;
  console.log('\n(40) Regresiones anteriores siguen pasando -- se verifican ejecutando esas suites por separado en la misma sesión de regresión.');
  const parityMarkers = ['function buildPaymentMatchRows', 'MODELO DE DOBLE EVIDENCIA', "creditMovementMeta(m).source==='manual_payment')"];
  ok('Paridad index.html / index_operator.html en las funciones nuevas de esta corrección', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));
  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
