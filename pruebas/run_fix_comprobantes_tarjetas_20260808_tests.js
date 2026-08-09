// DIAGNÓSTICO Y CORRECCIÓN LOCAL — COMPROBANTES DE PAGO DE TARJETAS —
// 20260808
//
// Auditoría real en Supabase (Visa 8374, pago 08/08/2026 ARS 500.000):
// comprobantes_en_documents=0, comprobantes_en_storage=0, sin huérfanos.
// El fallo real ocurre en alguna etapa ANTES de dejar cualquier rastro
// persistente -- la UI solo mostraba siempre "No fue posible guardar el
// archivo.", sin distinguir validación / contexto / Storage / INSERT en
// documents / refresco posterior.
//
// La auditoría de código y de las 4 policies RESTRICTIVE ya corregidas
// por F.2B.2.2 no encontró ninguna distinción real entre kind='statement'
// (que ya funciona en producción) y kind='card_receipt' -- por eso esta
// corrección NO inventa una migración nueva. Cambio aplicado, acotado a
// "Agregar comprobante":
//   1) uploadCreditDocument() marca cada excepción real con
//      error.creditStage ('invalid_file'|'missing_context'|'storage'|
//      'insert_failed'|'insert_orphaned') -- puramente aditivo, ningún
//      mensaje ni control de flujo existente cambia.
//   2) creditReceiptErrorMessage(error) (nueva, uso exclusivo de
//      comprobantes) traduce esa etapa a un mensaje seguro y específico,
//      sin exponer nunca el texto técnico crudo -- creditDocumentErrorMessage
//      (resúmenes) queda intacta.
//   3) confirmCreditReceiptUpload(): guarda de reentrada
//      (creditReceiptUploadsInFlight) contra doble click concurrente, y el
//      refresco posterior al guardado exitoso queda aislado en su propio
//      try/catch -- un fallo de refresco YA NO se informa como si el
//      comprobante no se hubiera guardado.
//
// Esta suite ejecuta esas funciones REALES (extraídas de index.html/
// index_operator.html) contra un backend mockeado -- nunca contra
// Supabase real. Ningún PDF real, ningún dato real de 8374 se usa (solo
// los mismos IDs reales como fixtures locales, sin conexión a Supabase).
//
// node pruebas/run_fix_comprobantes_tarjetas_20260808_tests.js
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
  'esc', 'isCreditLocalPreviewMode', 'assertCreditWriteAllowed', 'receiptFileIsAcceptable',
  'creditStorageOwnerId', 'creditDocumentDisplayName', 'normalizeCreditDocumentName',
  'findMatchingCreditDocument', 'uploadCreditDocument',
  'creditDocumentErrorMessage', 'creditReceiptErrorMessage', 'creditReceiptDiagnosticCode',
  'creditReceiptStorageSubcode', 'creditReceiptStorageStatusSuffix',
  'creditReceiptStorageSafeDetail', 'creditReceiptFileSummary', 'formatFileSize',
  'creditReceiptInvalidRequestSafeMessage',
  'confirmCreditReceiptUpload',
];

function buildEngineRuntime(src) {
  let code = extractConst(src, 'RECEIPT_ALLOWED_MIME') + '\n';
  code += extractConst(src, 'RECEIPT_ALLOWED_EXT') + '\n';
  code += `let creditDocumentsMigrationOk=true;\n`;
  code += extractConst(src, 'creditReceiptUploadsInFlight') + '\n';
  code += extractConst(src, 'CREDIT_RECEIPT_STAGE_CODES') + '\n';
  code += extractConst(src, 'CREDIT_RECEIPT_STORAGE_MESSAGE_CATEGORIES') + '\n';
  for (const n of ENGINE_FUNCTIONS) code += extractFunction(src, n) + '\n';
  code += `
// ============================================================
// DOBLES DE PRUEBA -- límites reales del sistema (Supabase real, DOM
// real), nunca la lógica de negocio que esta corrección modifica.
// ============================================================
let session = { user: { id: 'uuid-guido' } };
let location = { hostname: 'guidorpm.github.io' };
let creditPendingReceiptFiles = {};
let creditMovements = [];

class FakeElement {
  constructor(){ this._innerHTML=''; this.textContent=''; this.style={}; this._children={}; }
  set innerHTML(html){
    this._innerHTML = html;
    this._children = {};
    if (/data-credit-receipt-confirm=/.test(html)) this._children['[data-credit-receipt-confirm]'] = new FakeElement();
    if (/data-credit-receipt-cancel=/.test(html)) this._children['[data-credit-receipt-cancel]'] = new FakeElement();
  }
  get innerHTML(){ return this._innerHTML; }
  querySelector(sel){ return this._children[sel] || null; }
}
let __elements = new Map();
function getOrCreateStatusEl(movementId){
  const key = 'status:' + movementId;
  if (!__elements.has(key)) __elements.set(key, new FakeElement());
  return __elements.get(key);
}
function getOrCreateLabelEl(inputId){
  const key = 'label:' + inputId;
  if (!__elements.has(key)) __elements.set(key, new FakeElement());
  return __elements.get(key);
}
let document = {
  querySelector(sel){
    let m;
    if ((m = /label\\[for="([^"]+)"\\]/.exec(sel))) return getOrCreateLabelEl(m[1]);
    if ((m = /\\[data-credit-receipt-status="([^"]+)"\\]/.exec(sel))) return getOrCreateStatusEl(m[1]);
    return null;
  },
  getElementById: () => null,
};

let __toasts = [];
function toast(msg){ __toasts.push(msg); return undefined; }

let __refreshBehavior = async () => undefined;
let __refreshCalls = 0;
async function refreshDashboardData(){ __refreshCalls++; return __refreshBehavior(); }

let db, callLog;
let __forceUploadError = null;
let __forceRemoveError = null;
let __forceDocumentsInsertError = null;
let __forceFindMatchingErrorInner = null;
function resetMockBackend() {
  db = { documents: [] };
  callLog = [];
  __forceUploadError = null;
  __forceRemoveError = null;
  __forceDocumentsInsertError = null;
  __forceFindMatchingErrorInner = null;
  __toasts = [];
  __refreshBehavior = async () => undefined;
  __refreshCalls = 0;
  __elements = new Map();
  creditPendingReceiptFiles = {};
  creditReceiptUploadsInFlight.clear();
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
    if (this.op === 'insert' && this.table === 'documents' && __forceDocumentsInsertError) {
      return { data: null, error: __forceDocumentsInsertError };
    }
    if (this.op === 'insert') {
      const rowsToInsert = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rowsToInsert.map((p, idx) => ({ id: 'mock-' + this.table + '-' + (db[this.table].length + 1 + idx), created_at: new Date(Date.now() + db[this.table].length + idx).toISOString(), ...p }));
      db[this.table].push(...inserted);
      return wantSingle ? { data: inserted[0], error: null } : { data: inserted, error: null };
    }
    if (this.op === 'select') {
      const rows = (db[this.table] || []).filter(r => Object.entries(this._filters).every(([k, v]) => r[k] === v));
      return wantSingle ? { data: rows[0] || null, error: null } : { data: rows, error: null };
    }
    return { data: null, error: null };
  }
}
let __uploadDelayMs = 0;
let sb = {
  from(table) {
    return {
      select: (cols) => new FakeBuilder(table, 'select', null),
      insert: (payload) => new FakeBuilder(table, 'insert', payload),
    };
  },
  storage: {
    from(bucket) {
      return {
        upload: async (filePath, body, opts) => {
          if (__uploadDelayMs) await new Promise(r => setTimeout(r, __uploadDelayMs));
          callLog.push({
            op: 'storage.upload', bucket, filePath, contentType: opts && opts.contentType,
            upsert: opts && opts.upsert, cacheControl: opts && opts.cacheControl,
            bodyIsArrayBuffer: body instanceof ArrayBuffer,
            bodyByteLength: body instanceof ArrayBuffer ? body.byteLength : undefined,
            bodyIsFileLike: !(body instanceof ArrayBuffer) && body && typeof body === 'object' && 'arrayBuffer' in body,
          });
          if (__forceUploadError) return { error: __forceUploadError };
          return { error: null };
        },
        remove: async (paths) => {
          callLog.push({ op: 'storage.remove', bucket, paths });
          if (__forceRemoveError) throw __forceRemoveError;
          return { data: null, error: null };
        },
      };
    },
  },
};

let creditDocuments = [];
let creditCards = [];
let __fileHash = null; // sin dedupe por hash salvo que un test lo pida explícitamente
async function computeFileHash(file){ if (__forceFindMatchingErrorInner) throw __forceFindMatchingErrorInner; return __fileHash; }
async function computeStoredFileHash(filePath){ return null; }

module.exports = {
  uploadCreditDocument, confirmCreditReceiptUpload,
  creditDocumentErrorMessage, creditReceiptErrorMessage, creditReceiptDiagnosticCode,
  setLocation: (host) => { location.hostname = host; },
  setForceUploadError: (err) => { __forceUploadError = err; },
  setForceRemoveError: (err) => { __forceRemoveError = err; },
  setForceDocumentsInsertError: (err) => { __forceDocumentsInsertError = err; },
  setForceFindMatchingError: (err) => { __forceFindMatchingErrorInner = err; },
  setRefreshBehavior: (fn) => { __refreshBehavior = fn; },
  setFileHash: (h) => { __fileHash = h; },
  setUploadDelayMs: (ms) => { __uploadDelayMs = ms; },
  resetMockBackend: () => { resetMockBackend(); creditDocuments = []; creditCards = []; creditMovements = []; },
  getDb: () => db,
  getCallLog: () => callLog,
  getToasts: () => __toasts,
  getRefreshCalls: () => __refreshCalls,
  seedCard: (card) => { creditCards.push(card); },
  seedMovements: (movs) => { creditMovements = movs; },
  seedDocuments: (docs) => { creditDocuments = docs; db.documents = docs.slice(); },
  setPendingReceiptFile: (movementId, file) => { creditPendingReceiptFiles[movementId] = file; },
  getPendingReceiptFile: (movementId) => creditPendingReceiptFiles[movementId],
  getStatusEl: (movementId) => getOrCreateStatusEl(movementId),
  getLabelEl: (inputId) => getOrCreateLabelEl(inputId),
};
`;
  return code;
}

function makeFile(name, { size = 1000, type = 'application/pdf', arrayBufferError = null } = {}) {
  return {
    name, size, type,
    arrayBuffer: async () => {
      if (arrayBufferError) throw arrayBufferError;
      return new ArrayBuffer(size);
    },
  };
}

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

// ------------------------------------------------------------
// Fixtures reales de contexto (mismos IDs que en Supabase real, sin
// ninguna conexión real -- solo para que el path armado sea el mismo que
// el que Guido vería en producción).
// ------------------------------------------------------------
const CARD_8374 = { id: '9a78fd9a-de1b-4668-b1cd-408ea06ef3f2', owner_id: 'uuid-guido', brand: 'visa', last4: '8374' };
const STATEMENT_0D2D = '0d2d1be7-68ca-4954-ae49-6f55f6f23cb8';
const MOVEMENT_0808 = { id: 'mov-0808-real', card_id: CARD_8374.id, statement_id: STATEMENT_0D2D, amount: -500000, currency: 'ARS', movement_date: '2026-08-08' };

async function run(label, srcName, src) {
  const runtimeCode = buildEngineRuntime(src);
  const tmpFile = path.join(__dirname, `_extracted_fixcomprobantes_${srcName}.js`);
  fs.writeFileSync(tmpFile, runtimeCode);
  delete require.cache[require.resolve(tmpFile)];
  const M = require(tmpFile);

  // ------------------------------------------------------------
  // 1/2/3/4/5/6 — contexto válido, path, kind, payload y contador
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.setLocation('guidorpm.github.io');
  {
    const file = makeFile('comprobante.pdf');
    const result = await M.uploadCreditDocument(file, { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: MOVEMENT_0808.id, kind: 'card_receipt' });
    const upload = M.getCallLog().find(c => c.op === 'storage.upload');
    ok(`[${label}] (1) contexto válido: la subida llega a Storage`, !!upload);
    ok(`[${label}] (3) path contiene card_id/statement_id/movement_id reales`, upload && upload.filePath.includes(`/${CARD_8374.id}/`) && upload.filePath.includes(`/${STATEMENT_0D2D}/`) && upload.filePath.includes(`/payments/${MOVEMENT_0808.id}/`));
    ok(`[${label}] (2) movementId no se pierde en la fila creada`, M.getDb().documents[0].movement_id === MOVEMENT_0808.id);
    ok(`[${label}] (4) kind='card_receipt' en el INSERT`, M.getDb().documents[0].kind === 'card_receipt');
    ok(`[${label}] (5) payload documents: card_id/statement_id/uploaded_by correctos`,
      M.getDb().documents[0].card_id === CARD_8374.id &&
      M.getDb().documents[0].statement_id === STATEMENT_0D2D &&
      M.getDb().documents[0].uploaded_by === 'uuid-guido');
    ok(`[${label}] (6) éxito: exactamente 1 fila documents (contador pasaría de 0 a 1)`, M.getDb().documents.length === 1);
    ok(`[${label}] resultado no marca alreadyLoaded en la primera subida`, result.alreadyLoaded !== true);
  }

  // ------------------------------------------------------------
  // CORRECCIÓN LOCAL CAUSA RAÍZ 20260809 — PRUEBA COMPARATIVA OBLIGATORIA
  // A. statement: sigue exactamente igual (File/Blob directo, sin cambios).
  // B. card_receipt: pasa por file.arrayBuffer() -> upload() recibe un
  // ArrayBuffer real, nunca el File/Blob original -- fuerza a storage-js a
  // su rama binaria directa (evita FormData/multipart, la rama donde la
  // evidencia real mostró "No content provided" pese a file.size>0).
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    const statementFile = makeFile('resumen.pdf', { size: 500 * 1024, type: 'application/pdf' });
    await M.uploadCreditDocument(statementFile, { cardId: CARD_8374.id, statementId: STATEMENT_0D2D, kind: 'statement' });
    const statementUpload = M.getCallLog().find(c => c.op === 'storage.upload');
    ok(`[${label}] A. statement: upload() NO recibe un ArrayBuffer (sigue exactamente igual que antes)`, statementUpload && statementUpload.bodyIsArrayBuffer === false);
    ok(`[${label}] A. statement: upload() recibe el File/Blob original (tiene .arrayBuffer propio, no fue leído acá)`, statementUpload && statementUpload.bodyIsFileLike === true);
    ok(`[${label}] A. statement: contentType sigue siendo file.type tal cual (sin fallback aplicado)`, statementUpload && statementUpload.contentType === 'application/pdf');
  }

  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    // JPG ~2.0 MB, el caso real reportado (Visa 8374, comprobante desde iPhone).
    const jpgFile = makeFile('comprobante.jpg', { size: 2 * 1024 * 1024, type: 'image/jpeg' });
    await M.uploadCreditDocument(jpgFile, { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-jpg', kind: 'card_receipt' });
    const receiptUpload = M.getCallLog().find(c => c.op === 'storage.upload');
    ok(`[${label}] B. card_receipt (JPG ~2MB): upload() SÍ recibe un ArrayBuffer`, receiptUpload && receiptUpload.bodyIsArrayBuffer === true);
    ok(`[${label}] B. card_receipt: ArrayBuffer.byteLength === file.size exacto (copia byte a byte, sin recomprimir/redimensionar)`, receiptUpload && receiptUpload.bodyByteLength === jpgFile.size);
    ok(`[${label}] B. card_receipt: contentType === image/jpeg (el MIME real del archivo, no inventado)`, receiptUpload && receiptUpload.contentType === 'image/jpeg');
    ok(`[${label}] B. card_receipt: path exacto sin cambios (mismo formato de siempre)`, receiptUpload && receiptUpload.filePath.includes('/payments/mov-jpg/'));
    ok(`[${label}] B. card_receipt: upsert sigue false`, receiptUpload && receiptUpload.upsert === false);
    ok(`[${label}] B. card_receipt: cacheControl sigue '3600'`, receiptUpload && receiptUpload.cacheControl === '3600');
    ok(`[${label}] B. card_receipt: la fila documents guarda el name/type/size del File ORIGINAL (no del ArrayBuffer)`, M.getDb().documents[0].original_name === 'comprobante.jpg' && M.getDb().documents[0].mime_type === 'image/jpeg' && M.getDb().documents[0].size_bytes === jpgFile.size);
  }

  // Variantes de tipo de archivo para card_receipt: PDF, PNG, HEIC con MIME,
  // y MIME vacío (debe caer a application/octet-stream, NUNCA a ''
  // -- ninguna transformación de contenido en ningún caso, solo el
  // contentType declarado a Storage).
  const fileVariants = [
    { name: 'comprobante.pdf', type: 'application/pdf', expectContentType: 'application/pdf' },
    { name: 'comprobante.png', type: 'image/png', expectContentType: 'image/png' },
    { name: 'IMG_4821.HEIC', type: 'image/heic', expectContentType: 'image/heic' },
    { name: 'IMG_4821.HEIC', type: '', expectContentType: 'application/octet-stream' },
  ];
  for (const variant of fileVariants) {
    M.resetMockBackend();
    M.seedCard(CARD_8374);
    const vFile = makeFile(variant.name, { size: 50 * 1024, type: variant.type });
    await M.uploadCreditDocument(vFile, { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-variant', kind: 'card_receipt' });
    const vUpload = M.getCallLog().find(c => c.op === 'storage.upload');
    ok(`[${label}] variante ${variant.name} (MIME '${variant.type}'): contentType enviado a Storage = '${variant.expectContentType}'`, vUpload && vUpload.contentType === variant.expectContentType);
    ok(`[${label}] variante ${variant.name}: ArrayBuffer.byteLength === file.size (sin transformar el contenido)`, vUpload && vUpload.bodyByteLength === vFile.size);
    ok(`[${label}] variante ${variant.name}: el nombre/extensión original guardado en documents no cambia`, M.getDb().documents[0].original_name === variant.name);
  }

  // Falla al leer el archivo (file.arrayBuffer() rechaza): nunca debe
  // intentar Storage, y debe usar la etapa específica read_file -- nunca
  // reutilizar engañosamente 'storage'.
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    const brokenFile = makeFile('roto.jpg', { size: 1000, type: 'image/jpeg', arrayBufferError: new Error('NotReadableError: could not read file') });
    let caught = null;
    try { await M.uploadCreditDocument(brokenFile, { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-broken', kind: 'card_receipt' }); } catch (e) { caught = e; }
    ok(`[${label}] error al leer el archivo: se lanza una excepción`, !!caught);
    ok(`[${label}] error al leer el archivo: creditStage='read_file' (nunca 'storage')`, caught && caught.creditStage === 'read_file');
    ok(`[${label}] error al leer el archivo: Storage NUNCA se llega a tocar`, !M.getCallLog().some(c => c.op === 'storage.upload'));
    ok(`[${label}] error al leer el archivo: código RECEIPT_READ_FILE`, M.creditReceiptDiagnosticCode(caught) === 'RECEIPT_READ_FILE');
    ok(`[${label}] error al leer el archivo: mensaje específico, no reutiliza el de Storage`, M.creditReceiptErrorMessage(caught) === 'No se pudo leer el archivo seleccionado. No quedó nada guardado.');
    ok(`[${label}] error al leer el archivo: 0 filas documents`, M.getDb().documents.length === 0);
  }

  // ------------------------------------------------------------
  // 7 — error Storage → ninguna fila documents, mensaje seguro
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    M.setForceUploadError(new Error('new row violates row-level security policy'));
    let caught = null;
    try { await M.uploadCreditDocument(makeFile('r.pdf'), { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-x', kind: 'card_receipt' }); } catch (e) { caught = e; }
    ok(`[${label}] (7) error Storage: excepción marcada creditStage='storage'`, caught && caught.creditStage === 'storage');
    ok(`[${label}] (7) error Storage: ninguna fila en documents`, M.getDb().documents.length === 0);
    ok(`[${label}] (7) error Storage: mensaje seguro, sin texto crudo de Postgres/RLS`, M.creditReceiptErrorMessage(caught) === 'No se pudo guardar el archivo en el almacenamiento. No quedó nada guardado.');
  }

  // ------------------------------------------------------------
  // 8 — error INSERT documents → se intenta el rollback, nada queda
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    M.setForceDocumentsInsertError(new Error('violates check constraint "documents_kind_check"'));
    let caught = null;
    try { await M.uploadCreditDocument(makeFile('r.pdf'), { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-y', kind: 'card_receipt' }); } catch (e) { caught = e; }
    const removeCall = M.getCallLog().find(c => c.op === 'storage.remove');
    ok(`[${label}] (8) error INSERT documents: se intenta el rollback (storage.remove)`, !!removeCall);
    ok(`[${label}] (8) error INSERT documents: ninguna fila queda en documents`, M.getDb().documents.length === 0);
    ok(`[${label}] (8) error INSERT documents: creditStage='insert_failed' (rollback OK, nada huérfano)`, caught && caught.creditStage === 'insert_failed');
  }

  // ------------------------------------------------------------
  // 9 — rollback fallido → estado reconciliable (huérfano marcado)
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    M.setForceDocumentsInsertError(new Error('insert failed'));
    M.setForceRemoveError(new Error('storage delete denied'));
    let caught = null;
    try { await M.uploadCreditDocument(makeFile('r.pdf'), { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-z', kind: 'card_receipt' }); } catch (e) { caught = e; }
    ok(`[${label}] (9) rollback fallido: needsReconcile=true`, caught && caught.needsReconcile === true);
    ok(`[${label}] (9) rollback fallido: creditStage='insert_orphaned'`, caught && caught.creditStage === 'insert_orphaned');
    ok(`[${label}] (9) rollback fallido: mensaje distingue el caso, no invita a resubir`, M.creditReceiptErrorMessage(caught).includes('No vuelvas a subirlo'));
  }

  // ------------------------------------------------------------
  // 7-inesperado — error inesperado ANTES de tocar Storage (dentro de
  // findMatchingCreditDocument, único hueco real encontrado al re-auditar)
  // sin creditStage propio: la red de seguridad debe asignarle
  // 'unknown_before_upload', nunca dejarlo pasar sin etapa.
  // ------------------------------------------------------------
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  {
    // candidates.length>0 es la única forma real de que
    // findMatchingCreditDocument llegue a calcular un hash (y por lo tanto,
    // a poder fallar) -- se siembra un documento existente para el mismo
    // movimiento antes de forzar el error.
    M.seedDocuments([{ id: 'doc-existing', kind: 'card_receipt', movement_id: 'mov-w', card_id: CARD_8374.id, statement_id: STATEMENT_0D2D, file_path: 'credit-cards/x/y/z/payments/mov-w/old.pdf' }]);
    M.setForceFindMatchingError(new Error('fallo inesperado de hashing'));
    let caught = null;
    try { await M.uploadCreditDocument(makeFile('r.pdf'), { cardId: MOVEMENT_0808.card_id, statementId: MOVEMENT_0808.statement_id, movementId: 'mov-w', kind: 'card_receipt' }); } catch (e) { caught = e; }
    ok(`[${label}] (7-inesperado) error inesperado antes de Storage: se lanza igual`, !!caught);
    ok(`[${label}] (7-inesperado) red de seguridad: nunca queda sin creditStage`, caught && !!caught.creditStage);
    ok(`[${label}] (7-inesperado) red de seguridad: etapa correcta 'unknown_before_upload' (nunca tocó Storage)`, caught && caught.creditStage === 'unknown_before_upload');
    ok(`[${label}] (7-inesperado) Storage nunca se llegó a tocar`, !M.getCallLog().some(c => c.op === 'storage.upload'));
    ok(`[${label}] (7-inesperado) mensaje específico, no el genérico ciego`, M.creditReceiptErrorMessage(caught).includes('falló antes de llegar al almacenamiento'));
    ok(`[${label}] (7-inesperado) código diagnóstico específico`, M.creditReceiptDiagnosticCode(caught) === 'RECEIPT_UNKNOWN_BEFORE_UPLOAD');
    M.setForceFindMatchingError(null);
  }

  // ------------------------------------------------------------
  // el mensaje inline y el toast muestran SIEMPRE el mismo código
  // diagnóstico junto al mensaje amigable (nunca el texto genérico ciego,
  // sin código, para un error real conocido)
  // ------------------------------------------------------------
  {
    const storageErr = new Error('row-level security policy violation'); storageErr.creditStage = 'storage';
    // AUDITORÍA LOCAL RECEIPT_STORAGE 20260808-C: 'storage' ya no da el
    // código genérico -- se subclasifica (ver run_subcausa_receipt_storage
    // para la cobertura completa de subcódigos). Acá solo se confirma que
    // sigue siendo un código RECEIPT_STORAGE_* específico, nunca el genérico.
    ok(`[${label}] código y mensaje van juntos (storage)`, M.creditReceiptErrorMessage(storageErr) !== 'No fue posible guardar el archivo.' && M.creditReceiptDiagnosticCode(storageErr).startsWith('RECEIPT_STORAGE_'));
    const contextErr = new Error('sin owner'); contextErr.creditStage = 'missing_context';
    ok(`[${label}] código y mensaje van juntos (missing_context)`, M.creditReceiptDiagnosticCode(contextErr) === 'RECEIPT_CONTEXT');
    const insertErr = new Error('insert'); insertErr.creditStage = 'insert_failed';
    ok(`[${label}] código y mensaje van juntos (insert_failed)`, M.creditReceiptDiagnosticCode(insertErr) === 'RECEIPT_INSERT');
    const orphanErr = new Error('orphan'); orphanErr.creditStage = 'insert_orphaned';
    ok(`[${label}] código y mensaje van juntos (insert_orphaned)`, M.creditReceiptDiagnosticCode(orphanErr) === 'RECEIPT_ORPHAN');
  }

  // ------------------------------------------------------------
  // flujo completo real: confirmCreditReceiptUpload
  // ------------------------------------------------------------
  const inputId = 'creditReceiptInput-' + MOVEMENT_0808.id;
  const input = { id: inputId, value: 'x' };

  // 10 — doble click concurrente no duplica
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.seedMovements([MOVEMENT_0808]);
  {
    M.setUploadDelayMs(15); // fuerza superposición real entre ambos llamados
    M.setPendingReceiptFile(MOVEMENT_0808.id, makeFile('doble.pdf'));
    const p1 = M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input);
    const p2 = M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input); // click inmediato mientras p1 sigue en curso
    await Promise.all([p1, p2]);
    M.setUploadDelayMs(0);
    ok(`[${label}] (10) doble click concurrente: exactamente 1 fila documents`, M.getDb().documents.length === 1);
    const uploadCalls = M.getCallLog().filter(c => c.op === 'storage.upload');
    ok(`[${label}] (10) doble click concurrente: Storage recibe exactamente 1 subida`, uploadCalls.length === 1);
  }

  // 11 — reintento tras error no duplica
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.seedMovements([MOVEMENT_0808]);
  {
    M.setForceUploadError(new Error('temporary failure'));
    M.setPendingReceiptFile(MOVEMENT_0808.id, makeFile('retry.pdf'));
    await M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input);
    ok(`[${label}] (11) tras error: el archivo pendiente se conserva para reintentar`, !!M.getPendingReceiptFile(MOVEMENT_0808.id));
    ok(`[${label}] (11) tras error: mensaje de error mostrado, nunca "guardado correctamente"`, !M.getToasts().includes('Comprobante guardado correctamente.'));
    M.setForceUploadError(null);
    await M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input); // reintento real, ahora sin forzar error
    ok(`[${label}] (11) reintento exitoso: exactamente 1 fila documents (no se duplicó)`, M.getDb().documents.length === 1);
    ok(`[${label}] (11) reintento exitoso: toast de éxito`, M.getToasts().includes('Comprobante guardado correctamente.'));
  }

  // refresco falla tras guardado exitoso: no se informa como fallo del comprobante
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.seedMovements([MOVEMENT_0808]);
  {
    M.setPendingReceiptFile(MOVEMENT_0808.id, makeFile('refresh.pdf'));
    M.setRefreshBehavior(async () => { throw new Error('network blip'); });
    await M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input);
    ok(`[${label}] refresco fallido tras guardado OK: el comprobante quedó guardado igual`, M.getDb().documents.length === 1);
    ok(`[${label}] refresco fallido tras guardado OK: se muestra el mensaje de guardado+refresco, no "no fue posible guardar"`, M.getStatusEl(MOVEMENT_0808.id).innerHTML.includes('se guardó correctamente'));
    ok(`[${label}] refresco fallido tras guardado OK: no ofrece "Reintentar" (no hay que resubir nada)`, !M.getStatusEl(MOVEMENT_0808.id).innerHTML.includes('data-credit-receipt-confirm'));
  }

  // error real nunca se muestra como éxito, y ofrece Reintentar/Cancelar
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.seedMovements([MOVEMENT_0808]);
  {
    M.setForceDocumentsInsertError(new Error('insert failed'));
    M.setPendingReceiptFile(MOVEMENT_0808.id, makeFile('error.pdf'));
    await M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input);
    ok(`[${label}] error real: nunca se muestra como éxito`, !M.getToasts().includes('Comprobante guardado correctamente.'));
    ok(`[${label}] error real: status ofrece Reintentar y Cancelar`, M.getStatusEl(MOVEMENT_0808.id).innerHTML.includes('data-credit-receipt-confirm') && M.getStatusEl(MOVEMENT_0808.id).innerHTML.includes('data-credit-receipt-cancel'));
    ok(`[${label}] error real: 0 filas documents`, M.getDb().documents.length === 0);
    ok(`[${label}] error real: el inline muestra el código diagnóstico (RECEIPT_INSERT)`, M.getStatusEl(MOVEMENT_0808.id).innerHTML.includes('RECEIPT_INSERT'));
    ok(`[${label}] error real: el toast muestra el mismo código diagnóstico`, M.getToasts().some(t => t.includes('RECEIPT_INSERT')));
    ok(`[${label}] error real: nunca cae en el texto genérico sin código`, !M.getToasts().some(t => t === 'No fue posible guardar el archivo.'));
  }

  // AUDITORÍA LOCAL InvalidRequest 20260809 — flujo completo real: HTTP
  // 400 + code='InvalidRequest' (el caso real de 8374) debe mostrar en el
  // INLINE el código, el "Storage code: InvalidRequest" Y el "Detalle
  // Storage: ..." sanitizado, y el resumen del archivo -- el inline es la
  // fuente completa (queda después de que el toast desaparece); el toast
  // puede ser más corto pero nunca es la única fuente de información.
  M.resetMockBackend();
  M.seedCard(CARD_8374);
  M.seedMovements([MOVEMENT_0808]);
  {
    const invalidRequestErr = new Error('The multipart boundary could not be parsed');
    invalidRequestErr.status = 400;
    invalidRequestErr.statusCode = '400';
    invalidRequestErr.code = 'InvalidRequest';
    invalidRequestErr.name = 'StorageApiError';
    M.setForceUploadError(invalidRequestErr);
    M.setPendingReceiptFile(MOVEMENT_0808.id, makeFile('comprobante.heic', { type: '' }));
    await M.confirmCreditReceiptUpload(MOVEMENT_0808.id, input);
    const inlineHtml = M.getStatusEl(MOVEMENT_0808.id).innerHTML;
    ok(`[${label}] InvalidRequest real: inline muestra el código RECEIPT_STORAGE_UNKNOWN`, inlineHtml.includes('RECEIPT_STORAGE_UNKNOWN'));
    ok(`[${label}] InvalidRequest real: inline muestra el HTTP 400`, inlineHtml.includes('HTTP: 400'));
    ok(`[${label}] InvalidRequest real: inline muestra "Storage code: InvalidRequest"`, inlineHtml.includes('Storage code: InvalidRequest'));
    ok(`[${label}] InvalidRequest real: inline muestra el detalle sanitizado del mensaje`, inlineHtml.includes('Detalle Storage: The multipart boundary could not be parsed'));
    ok(`[${label}] InvalidRequest real: inline muestra el resumen del archivo (extensión/tamaño/MIME)`, inlineHtml.includes('Archivo: HEIC') && inlineHtml.includes('MIME vacío'));
    ok(`[${label}] InvalidRequest real: 0 filas documents`, M.getDb().documents.length === 0);
    ok(`[${label}] InvalidRequest real: nunca se muestra como éxito`, !M.getToasts().includes('Comprobante guardado correctamente.'));
    ok(`[${label}] InvalidRequest real: el toast también lleva el código (aunque más corto que el inline)`, M.getToasts().some(t => t.includes('RECEIPT_STORAGE_UNKNOWN')));
  }

  fs.unlinkSync(tmpFile);
}

(async () => {
  console.log('=== index.html ===');
  await run('index.html', 'index_html', srcMain);
  console.log('=== index_operator.html ===');
  await run('index_operator.html', 'index_operator_html', srcOperator);
  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  process.exit(failures ? 1 : 0);
})();
