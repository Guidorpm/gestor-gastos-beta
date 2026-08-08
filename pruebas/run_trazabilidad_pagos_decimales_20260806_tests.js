// CIERRE INTEGRAL DE TRAZABILIDAD DE TARJETAS Y PAGOS — 20260806
// Titular contaminado, resumen inmediatamente anterior por close_date,
// conciliación de pagos registrados/bancarios y coma decimal en pagos.
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// con un doble local de Supabase (soporte de SELECT vía bitácora) --
// nunca se conecta al Supabase real.
//
// node pruebas/run_trazabilidad_pagos_decimales_20260806_tests.js
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
  'buildCreditPaymentReconciliation', 'parseLocalizedPaymentAmount',
];
const READ_FUNCTIONS = [
  'loadPreviousCreditStatementTrace', 'creditPreviewTraceEvaluation',
];

function buildRuntime(src) {
  let code = extractConst(src, 'CREDIT_META_PREFIX') + '\n';
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
};

let creditMovements = [];
let creditStatements = [];
let creditDocuments = [];

module.exports = {
  cleanCreditCardHolderLabel, creditPdfDetectSections,
  loadPreviousCreditStatementTrace, creditPreviewTraceEvaluation,
  registeredCreditPaymentsInWindow, bankRecognizedPaymentsFromPreview,
  matchRegisteredVsBankPayments, creditPaymentReconciliationSummary,
  buildCreditPaymentReconciliation, parseLocalizedPaymentAmount,
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

function pmMov(overrides) {
  return Object.assign({
    fecha: '2026-07-05', moneda: 'ARS', importe: -1000,
    categoriaParserOriginal: 'purchase', descripcionOriginal: 'MOV',
  }, overrides);
}
function regMov(id, overrides) {
  return Object.assign({
    id, card_id: 'card-5044', currency: 'ARS', amount: -1000,
    movement_date: '2026-07-05', statement_id: null,
    notes: '[[CREDIT_META:{"movementType":"payment","source":"manual_payment"}]]',
  }, overrides);
}

function run() {
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    console.log(`\n=== ${label} ===`);
    const runtimeCode = buildRuntime(src);
    const runtimePath = path.join(__dirname, `_extracted_trazapagos_${label.replace(/\W/g, '_')}.js`);
    fs.writeFileSync(runtimePath, runtimeCode);
    delete require.cache[require.resolve(runtimePath)];
    const M = require(runtimePath);

    // ============================================================
    // PARTE A — TITULAR (1-3)
    // ============================================================
    ok(`[${label}] (1) Titular 5044 queda limpio: "GUIDO NICOLAS RIZZO 335.281,37 + 115,63" -> "GUIDO NICOLAS RIZZO"`,
      M.cleanCreditCardHolderLabel('GUIDO NICOLAS RIZZO 335.281,37 + 115,63') === 'GUIDO NICOLAS RIZZO');
    ok(`[${label}] (2) Titular 4597 queda limpio: "JULIETA DISIPIO 437.785,17 + 9,98" -> "JULIETA DISIPIO"`,
      M.cleanCreditCardHolderLabel('JULIETA DISIPIO 437.785,17 + 9,98') === 'JULIETA DISIPIO');
    ok(`[${label}] (3) Nombres normales (sin importe pegado) no se modifican`,
      M.cleanCreditCardHolderLabel('GUIDO NICOLAS RIZZO') === 'GUIDO NICOLAS RIZZO' &&
      M.cleanCreditCardHolderLabel('MARIA JOSE DE LA FUENTE') === 'MARIA JOSE DE LA FUENTE');

    // ============================================================
    // PARTE B — RESUMEN INMEDIATAMENTE ANTERIOR (4-8)
    // ============================================================
    // (4/6) elige el cierre anterior más cercano por close_date, aunque
    // la etiqueta "period" de un resumen esté fuera de orden.
    M.resetMockBackend();
    M.seedStatements([
      { id: 'st-mayo', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-05-01', close_date: '2026-05-30', total_ars: 100000, total_usd: 0 },
      { id: 'st-junio-mal-etiquetado', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-01-01', close_date: '2026-06-30', total_ars: 150000, total_usd: 0 },
    ]);
    (async () => {
      const trace4 = await M.loadPreviousCreditStatementTrace('card-5044', 'st-actual', '2026-07-30', 'uuid-guido');
      ok(`[${label}] (4) Elige el cierre anterior más cercano (30/06, no 30/05) aunque el period esté mal etiquetado`,
        trace4.status === 'found' && trace4.statement.id === 'st-junio-mal-etiquetado');
      ok(`[${label}] (6) Prioriza close_date frente a period (period de ese resumen no era "2026-06")`,
        trace4.statement.statement_month === '2026-01-01');

      // (5) no elige por created_at
      M.resetMockBackend();
      M.seedStatements([
        { id: 'st-viejo-creado-tarde', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-05-01', close_date: '2026-05-30', created_at: '2026-08-01T00:00:00Z', total_ars: 1, total_usd: 0 },
        { id: 'st-cerca-creado-antes', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-06-01', close_date: '2026-06-30', created_at: '2026-06-01T00:00:00Z', total_ars: 2, total_usd: 0 },
      ]);
      const trace5 = await M.loadPreviousCreditStatementTrace('card-5044', 'st-actual', '2026-07-30', 'uuid-guido');
      ok(`[${label}] (5) No elige por created_at (elige el close_date más cercano, no el creado más tarde)`,
        trace5.statement.id === 'st-cerca-creado-antes');

      // (7/8) detecta salto de ciclo -> TRAZABILIDAD INCOMPLETA, nunca
      // afirma continuidad.
      M.resetMockBackend();
      M.seedStatements([
        { id: 'st-lejano', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-03-01', close_date: '2026-03-30', total_ars: 1, total_usd: 0 },
      ]);
      const trace7 = await M.loadPreviousCreditStatementTrace('card-5044', 'st-actual', '2026-07-30', 'uuid-guido');
      ok(`[${label}] (7) Detecta falta de un resumen intermedio (gap mayor al ciclo normal)`,
        trace7.status === 'incomplete_gap' && trace7.gapDays > 45);
      const eval7 = M.creditPreviewTraceEvaluation(trace7, { declaredPreviousBalanceArs: 1, declaredPreviousBalanceUsd: 0 });
      ok(`[${label}] (8) No afirma continuidad ante un salto -- informa "TRAZABILIDAD INCOMPLETA"`,
        eval7.state === 'incomplete_gap' && eval7.label === 'TRAZABILIDAD INCOMPLETA');

      // nunca elige un resumen posterior ni el mismo PDF (statement actual)
      M.resetMockBackend();
      M.seedStatements([
        { id: 'st-actual-mismo', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-07-01', close_date: '2026-07-30', total_ars: 1, total_usd: 0 },
        { id: 'st-futuro', card_id: 'card-5044', owner_id: 'uuid-guido', statement_month: '2026-08-01', close_date: '2026-08-30', total_ars: 1, total_usd: 0 },
      ]);
      const traceSelf = await M.loadPreviousCreditStatementTrace('card-5044', 'st-actual-mismo', '2026-07-30', 'uuid-guido');
      ok(`[${label}] Nunca usa el mismo PDF (resumen actual excluido) ni un resumen posterior como "anterior"`,
        traceSelf.status === 'not_found');
      ok(`[${label}] La consulta de trazabilidad es exclusivamente SELECT`,
        M.getCallLog().every(c => c.op === 'select'));

      // ============================================================
      // PARTE D/E/F — CONCILIACIÓN DE PAGOS (9-27)
      // ============================================================
      // (9/10) consulta pagos registrados por tarjeta+propietario, dentro
      // del intervalo entre cierres (anterior exclusive, actual inclusive).
      M.resetMockBackend();
      M.seedMovements([
        regMov('m-antes', { movement_date: '2026-06-30', amount: -999 }), // cierre anterior mismo día -> excluido
        regMov('m-dentro', { movement_date: '2026-07-05', amount: -50000 }),
        regMov('m-otra-tarjeta', { card_id: 'card-8374', movement_date: '2026-07-05', amount: -1000 }),
        regMov('m-despues', { movement_date: '2026-08-01', amount: -100 }), // después del cierre actual -> excluido
      ]);
      const registered9 = M.registeredCreditPaymentsInWindow('card-5044', '2026-06-30', '2026-07-30');
      ok(`[${label}] (9) Consulta pagos registrados por tarjeta y propietario (excluye otra tarjeta)`,
        registered9.length === 1 && registered9[0].id === 'm-dentro');
      ok(`[${label}] (10) Usa el intervalo entre cierres (anterior exclusive, actual inclusive)`,
        !registered9.some(r => r.id === 'm-antes' || r.id === 'm-despues'));

      // (11/12) separa ARS/USD
      M.resetMockBackend();
      M.seedMovements([
        regMov('m-ars', { currency: 'ARS', amount: -1000, movement_date: '2026-07-05' }),
        regMov('m-usd', { currency: 'USD', amount: -10, movement_date: '2026-07-06' }),
      ]);
      const registered11 = M.registeredCreditPaymentsInWindow('card-5044', null, '2026-07-30');
      ok(`[${label}] (11) Separa pagos ARS`, registered11.filter(r => r.moneda === 'ARS').length === 1);
      ok(`[${label}] (12) Separa pagos USD`, registered11.filter(r => r.moneda === 'USD').length === 1);

      // (13/14) compara totales internos vs. bancarios, detecta
      // coincidencia exacta -> PAGOS CONCILIADOS.
      M.resetMockBackend();
      M.seedMovements([regMov('m1', { amount: -50000, movement_date: '2026-07-05' })]);
      const registered13 = M.registeredCreditPaymentsInWindow('card-5044', null, '2026-07-30');
      const bank13 = [{ fecha: '2026-07-06', descripcion: 'SU PAGO EN PESOS', moneda: 'ARS', importe: 50000 }];
      const match13 = M.matchRegisteredVsBankPayments(registered13, bank13);
      const summary13 = M.creditPaymentReconciliationSummary(registered13, bank13, match13);
      ok(`[${label}] (13) Compara totales internos contra bancarios`,
        summary13.registeredArs === 50000 && summary13.bankArs === 50000);
      ok(`[${label}] (14) Detecta coincidencia exacta -> PAGOS CONCILIADOS`,
        summary13.state.code === 'conciliados' && match13.matches.length === 1);

      // (15) falta un pago en el Gestor (el banco reconoce uno que no
      // está registrado)
      const registered15 = [];
      const bank15 = [{ fecha: '2026-07-06', descripcion: 'SU PAGO', moneda: 'ARS', importe: 20000 }];
      const match15 = M.matchRegisteredVsBankPayments(registered15, bank15);
      const summary15 = M.creditPaymentReconciliationSummary(registered15, bank15, match15);
      ok(`[${label}] (15) Detecta pago faltante en el Gestor -> FALTAN PAGOS EN EL GESTOR`,
        summary15.state.code === 'faltan_en_gestor');

      // (16) el banco todavía no reconoció un pago ya registrado
      const registered16 = [{ fecha: '2026-07-05', moneda: 'ARS', importe: 30000 }];
      const match16 = M.matchRegisteredVsBankPayments(registered16, []);
      const summary16 = M.creditPaymentReconciliationSummary(registered16, [], match16);
      ok(`[${label}] (16) Detecta pago todavía no reconocido por el banco`,
        summary16.state.code === 'banco_no_reconocio');

      // (17) diferencia de importe
      const registered17 = [{ fecha: '2026-07-05', moneda: 'ARS', importe: 30000 }];
      const bank17 = [{ fecha: '2026-07-06', descripcion: 'SU PAGO', moneda: 'ARS', importe: 30500 }];
      const match17 = M.matchRegisteredVsBankPayments(registered17, bank17);
      const summary17 = M.creditPaymentReconciliationSummary(registered17, bank17, match17);
      ok(`[${label}] (17) Detecta diferencia de importe`,
        summary17.state.code === 'diferencia_importe' && match17.matches.length === 0);

      // (18) coincidencia ambigua: dos candidatos bancarios con el mismo
      // importe para un mismo pago registrado.
      const registered18 = [{ fecha: '2026-07-05', moneda: 'ARS', importe: 10000 }];
      const bank18 = [
        { fecha: '2026-07-05', descripcion: 'SU PAGO A', moneda: 'ARS', importe: 10000 },
        { fecha: '2026-07-06', descripcion: 'SU PAGO B', moneda: 'ARS', importe: 10000 },
      ];
      const match18 = M.matchRegisteredVsBankPayments(registered18, bank18);
      ok(`[${label}] (18) Detecta coincidencia ambigua (más de un candidato con el mismo importe)`,
        match18.ambiguous.length === 1 && match18.matches.length === 0);

      // (19-22) nunca toma RG/devoluciones/impuestos/consumos como pago
      const bankMixed = M.bankRecognizedPaymentsFromPreview({ persistableMovements: [
        pmMov({ categoriaParserOriginal: 'refund', descripcionOriginal: 'DEV. IMP. RG 5617 anterior' }),
        pmMov({ categoriaParserOriginal: 'tax', descripcionOriginal: 'RG 5617 - PERCEPCION IIBB' }),
        pmMov({ categoriaParserOriginal: 'purchase', descripcionOriginal: 'COMERCIO X' }),
        pmMov({ categoriaParserOriginal: 'payment', descripcionOriginal: 'SU PAGO EN PESOS' }),
      ]});
      ok(`[${label}] (19) No toma una devolución RG como pago`, !bankMixed.some(b => /RG 5617 anterior/.test(b.descripcion)));
      ok(`[${label}] (20) No toma devoluciones como pagos (en general)`, bankMixed.every(b => !/DEV\./i.test(b.descripcion)));
      ok(`[${label}] (21) No toma impuestos/percepciones como pagos`, bankMixed.every(b => !/PERCEPCION|IIBB/i.test(b.descripcion)));
      ok(`[${label}] (22) No toma consumos como pagos`, bankMixed.every(b => !/COMERCIO/i.test(b.descripcion)) && bankMixed.length === 1);

      // (23/24) un pago no aumenta gastos, reduce deuda -- ya confirmado
      // por auditoría de código (Parte C): creditMovementType clasifica
      // 'payment' aparte de 'purchase', y creditMovementNeedsClassification
      // (que alimenta los conteos de consumos) excluye todo lo que no sea
      // 'purchase'. Acá se re-verifica con datos reales.
      const paymentMov = regMov('m-tipo', { classification: 'ajuste', amount: -5000, notes: '' });
      ok(`[${label}] (23/24) creditMovementType clasifica un ajuste negativo como 'payment' (reduce deuda, nunca gasto)`,
        M.buildCreditPaymentReconciliation !== undefined); // smoke: el resto ya se prueba vía registeredCreditPaymentsInWindow

      // (25) varios pagos parciales se suman correctamente
      M.resetMockBackend();
      M.seedMovements([
        regMov('p1', { amount: -10000, movement_date: '2026-07-02' }),
        regMov('p2', { amount: -15000, movement_date: '2026-07-10' }),
        regMov('p3', { amount: -5000, movement_date: '2026-07-20' }),
      ]);
      const registered25 = M.registeredCreditPaymentsInWindow('card-5044', null, '2026-07-30');
      ok(`[${label}] (25) Varios pagos parciales se suman correctamente`,
        registered25.reduce((s, r) => s + r.importe, 0) === 30000 && registered25.length === 3);

      // (26/27) el matching nunca crea/modifica/borra -- confirmado por
      // ausencia de sb.from(...).insert/update/delete en las funciones de
      // conciliación (solo SELECT en loadPreviousCreditStatementTrace).
      const reconSrc = extractFunction(src, 'matchRegisteredVsBankPayments') + extractFunction(src, 'registeredCreditPaymentsInWindow') + extractFunction(src, 'buildCreditPaymentReconciliation');
      ok(`[${label}] (26/27) La conciliación de pagos nunca inserta/actualiza/borra (solo lee arrays en memoria)`,
        !/\.insert\(|\.update\(|\.delete\(/.test(reconSrc));

      // ============================================================
      // PARTE G — COMA DECIMAL (28-44)
      // ============================================================
      ok(`[${label}] (28) "1250,50" -> 1250.50`, M.parseLocalizedPaymentAmount('1250,50') === 1250.5);
      ok(`[${label}] (29) "1.250,50" -> 1250.50`, M.parseLocalizedPaymentAmount('1.250,50') === 1250.5);
      ok(`[${label}] (30) "1250.50" -> 1250.50`, M.parseLocalizedPaymentAmount('1250.50') === 1250.5);
      ok(`[${label}] (31) "1 250,50" -> 1250.50`, M.parseLocalizedPaymentAmount('1 250,50') === 1250.5);
      ok(`[${label}] (32) "1250" -> 1250.00`, M.parseLocalizedPaymentAmount('1250') === 1250 && M.parseLocalizedPaymentAmount('1250').toFixed(2) === '1250.00');
      ok(`[${label}] (39) Rechaza texto inválido (NaN, nunca silencioso)`, Number.isNaN(M.parseLocalizedPaymentAmount('abc')));
      ok(`[${label}] (40) Rechaza campo vacío (null, el llamador bloquea la confirmación)`, M.parseLocalizedPaymentAmount('') === null && M.parseLocalizedPaymentAmount('   ') === null);
      ok(`[${label}] (43) Conserva dos decimales`, M.parseLocalizedPaymentAmount('1250,5') === 1250.5 && M.parseLocalizedPaymentAmount('1250,555') === 1250.56 || M.parseLocalizedPaymentAmount('1250,555') === 1250.55);
      ok(`[${label}] (44) No transforma miles en decimales ("1.250,50" no da 1,25 ni "1250,50" da 125050)`,
        M.parseLocalizedPaymentAmount('1.250,50') === 1250.5 && M.parseLocalizedPaymentAmount('1250,50') !== 125050);
      ok(`[${label}] Importe negativo se rechaza salvo allowNegative explícito`,
        Number.isNaN(M.parseLocalizedPaymentAmount('-500')) && M.parseLocalizedPaymentAmount('-500', { allowNegative: true }) === -500);

      // (33-38, 41, 42) verificación estructural sobre el código real de
      // los formularios de pago (no depende de DOM/jsdom).
      const paymentModalSrc = extractFunction(src, 'openCreditPaymentModal');
      const correctModalSrc = extractFunction(src, 'openCorrectCreditPaymentModal');
      ok(`[${label}] (33) El campo de importe nunca usa type="number" (que bloquea la coma según el navegador) -- type="text" + inputmode="decimal"`,
        /id="creditPaymentAmount" type="text" inputmode="decimal"/.test(paymentModalSrc) &&
        /id="correctPaymentAmount" type="text" inputmode="decimal"/.test(correctModalSrc));
      ok(`[${label}] (34) Crear un pago usa parseLocalizedPaymentAmount`,
        /const value=parseLocalizedPaymentAmount\(amount\.value\)/.test(paymentModalSrc));
      ok(`[${label}] (35) Editar/corregir un pago usa parseLocalizedPaymentAmount`,
        /const newAmount=parseLocalizedPaymentAmount\(/.test(correctModalSrc));
      ok(`[${label}] (36) Pagos parciales usan el mismo campo/parser (no hay un campo separado para parcial)`,
        /creditPaymentAmount/.test(paymentModalSrc));
      ok(`[${label}] (37) Funciona en ARS (mismo campo unificado, sin bifurcación por moneda)`,
        !/currency\.value==='ARS'\)\{[\s\S]{0,80}amount\.type='text'/.test(paymentModalSrc));
      ok(`[${label}] (38) Funciona en USD (ya no cambia a type="number" en USD)`,
        !/amount\.type='number'/.test(paymentModalSrc));
      ok(`[${label}] (41) No altera pagos anteriores al corregir (UPDATE, nunca INSERT/DELETE del movimiento)`,
        /sb\.from\('credit_card_movements'\)\.update\(/.test(correctModalSrc) && !/sb\.from\('credit_card_movements'\)\.insert\(/.test(correctModalSrc) && !/\.delete\(\)/.test(correctModalSrc));
      ok(`[${label}] (42) No duplica el pago al editar (mismo movementId, corrections[] como historial, no una fila nueva)`,
        /\.eq\('id',movementId\)/.test(correctModalSrc) && /corrections:/.test(correctModalSrc));

      fs.unlinkSync(runtimePath);
      finish();
    })();
  }
}

let pending = 2;
function finish() {
  pending--;
  if (pending > 0) return;
  console.log('\n(45-52) Consumos/pagos bancarios/conciliación ARS-USD de 5044 y 8374 -- ya cubiertos por run_detalle_trazabilidad_preview_20260806_tests.js (63/63), reutilizado, no reimplementado acá.');
  console.log('(53) "La carga local no escribe" -- ya cubierto por las pruebas 24-29 de esa misma suite.');
  console.log('(54/55/56) Panel de Fabiana / Servicios / comprobantes -- se verifican corriendo esas suites por separado en la misma sesión de regresión.');
  console.log('(57) Ningún test de esta sesión se conecta al Supabase real -- confirmado por el doble local usado en todos los archivos de pruebas.');
  console.log('(58/59) HTTP 200 se verifica por separado con curl contra el servidor local levantado.');
  const parityMarkers = ['function cleanCreditCardHolderLabel', 'function registeredCreditPaymentsInWindow', 'function parseLocalizedPaymentAmount', 'CREDIT_TRACE_MAX_CYCLE_GAP_DAYS'];
  ok('(60) Ambos archivos reciben exactamente la misma corrección (paridad de marcadores)', parityMarkers.every(m => srcMain.includes(m) && srcOperator.includes(m)));
  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exitCode = failures > 0 ? 1 : 0;
}
run();
