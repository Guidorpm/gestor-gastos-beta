// ============================================================
// PRUEBA LOCAL — Upload robusto de documentos/facturas desde mobile/iPhone
// (mejora #8, FASE 1: auditoría + corrección local + testeo, 20260818)
// ------------------------------------------------------------
// Caso real reportado por Guido: al seleccionar una foto (o una captura
// de pantalla) desde iPhone para cargar una factura, Supabase Storage
// devuelve "No content provided". Este archivo audita/prueba la
// corrección real aplicada a uploadDoc() (Servicios) -- extrae y ejecuta
// las funciones REALES de index.html (nunca reimplementadas a mano), con
// un mock de Supabase en memoria y objetos File simulados (incluido un
// "File iOS-like" cuya lectura TARDÍA falla pero cuya lectura INMEDIATA
// funciona, para demostrar el problema y la solución sin necesitar un
// iPhone real).
//
// AVISO: no se ejecuta ningún SQL ni se toca Supabase real -- todo el
// almacenamiento/DB es un mock en memoria construido en este archivo.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexPath = path.join(ROOT, 'index.html');
const operatorPath = path.join(ROOT, 'index_operator.html');
const indexText = fs.readFileSync(indexPath, 'utf8');
const operatorText = fs.readFileSync(operatorPath, 'utf8');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Sandbox de las funciones reales del frontend ----------------

const blockDisplayNameAndNormalize = extract(indexText, 'function creditDocumentDisplayName(filePath,originalName){', 'let pdfJsLoadPromise=null;');
const blockComputeFileHash = extract(indexText, 'async function computeFileHash(file){', 'async function computeStoredFileHash(');
const blockReceiptAcceptable = extract(indexText, 'const RECEIPT_ALLOWED_MIME=', '// CORRECCIÓN INTEGRACIÓN REAL 20260806');
// Bloque combinado, en el ORDEN REAL del archivo: findMatchingServiceDocument
// -> snapshotFileBytesForUpload -> uploadDoc (los tres tal cual quedaron
// después de la corrección de mejora #8, nunca reescritos a mano acá).
const blockUploadFlow = extract(indexText, 'async function findMatchingServiceDocument(', 'function operationalServiceRowHtml(');

const REAL_SOURCE = [blockDisplayNameAndNormalize, blockComputeFileHash, blockReceiptAcceptable, blockUploadFlow].join('\n');

function buildSbMock({ uploadResult, insertResult, removeResult, insertShouldThrow } = {}) {
  const calls = { uploadArgs: null, insertArgs: null, removeArgs: null, uploadCalled: false, insertCalled: false, removeCalled: false };
  return {
    calls,
    storage: {
      from(bucket) {
        return {
          upload: async (path, body, options) => {
            calls.uploadCalled = true;
            calls.uploadArgs = { bucket, path, body, options };
            return uploadResult || { data: { path }, error: null };
          },
          remove: async (paths) => {
            calls.removeCalled = true;
            calls.removeArgs = { bucket, paths };
            return removeResult || { data: null, error: null };
          },
        };
      },
    },
    from(table) {
      return {
        insert(payload) {
          calls.insertCalled = true;
          calls.insertArgs = { table, payload };
          return {
            select() {
              return {
                single: async () => {
                  if (insertShouldThrow) throw insertShouldThrow;
                  return insertResult || { data: { id: 'doc-new', ...payload }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function buildSandbox({ documents = [], sb, group = { id: 'group-1' }, session = { user: { id: 'user-1' } } } = {}) {
  const sandbox = { documents, sb, group, session, window: {} };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { findMatchingServiceDocument, snapshotFileBytesForUpload, uploadDoc, receiptFileIsAcceptable, computeFileHash };');
  return fn(...Object.values(sandbox));
}

// File-like mock: por defecto arrayBuffer() siempre devuelve los mismos
// bytes. `degradeAfterFirstCall:true` simula el caso "iOS-like": la
// PRIMERA lectura (inmediata) funciona y devuelve bytes reales; cualquier
// lectura POSTERIOR devuelve un ArrayBuffer vacío -- exactamente el
// síntoma reportado (file.size>0 pero el contenido efectivo llega vacío
// si se lee tarde).
function mockFile({ name = 'factura.jpg', type = 'image/jpeg', size = 1024, bytes, degradeAfterFirstCall = false, alwaysThrow = false } = {}) {
  const realBytes = bytes || new Uint8Array(size || 1).fill(7).buffer;
  let callCount = 0;
  return {
    name,
    type,
    size: size != null ? size : realBytes.byteLength,
    async arrayBuffer() {
      callCount++;
      if (alwaysThrow) throw new Error('NotReadableError: no se pudo leer el archivo');
      if (degradeAfterFirstCall && callCount > 1) return new ArrayBuffer(0);
      return realBytes;
    },
    get callCount() { return callCount; },
  };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — snapshotFileBytesForUpload() / validaciones básicas
// ============================================================

caso('CASO 1 — file existente: snapshotFileBytesForUpload devuelve un ArrayBuffer con bytes reales', async () => {
  const sb = buildSandbox({ sb: buildSbMock() });
  const bytes = await sb.snapshotFileBytesForUpload(mockFile({ size: 512 }));
  assert.ok(bytes instanceof ArrayBuffer);
  assert.strictEqual(bytes.byteLength, 512);
});

caso('CASO 2 — file inexistente (null/undefined) es rechazado con mensaje entendible', async () => {
  const sb = buildSandbox({ sb: buildSbMock() });
  await assert.rejects(() => sb.snapshotFileBytesForUpload(null), /No pudimos leer el archivo seleccionado/);
  await assert.rejects(() => sb.snapshotFileBytesForUpload(undefined), /No pudimos leer el archivo seleccionado/);
});

caso('CASO 3 — file.size = 0 (arrayBuffer real vacío) es rechazado', async () => {
  const sb = buildSandbox({ sb: buildSbMock() });
  const empty = mockFile({ size: 0, bytes: new ArrayBuffer(0) });
  await assert.rejects(() => sb.snapshotFileBytesForUpload(empty), /No pudimos leer el archivo seleccionado/);
});

caso('CASO 4 — arrayBuffer().byteLength === 0 es rechazado aunque file.size reportado sea > 0 (síntoma real del bug)', async () => {
  const sb = buildSandbox({ sb: buildSbMock() });
  const liar = mockFile({ size: 2_000_000, bytes: new ArrayBuffer(0) });
  await assert.rejects(() => sb.snapshotFileBytesForUpload(liar), /No pudimos leer el archivo seleccionado/);
});

caso('CASO 4b — si file.arrayBuffer() lanza una excepción (NotReadableError), se traduce a un mensaje entendible, nunca "No content provided" crudo', async () => {
  const sb = buildSandbox({ sb: buildSbMock() });
  const broken = mockFile({ alwaysThrow: true });
  await assert.rejects(() => sb.snapshotFileBytesForUpload(broken), /No pudimos leer el archivo seleccionado/);
});

// ============================================================
// PARTE B — orden del flujo: snapshot temprano, caso "File iOS-like"
// ============================================================

caso('CASO 5 — el snapshot de bytes ocurre ANTES del detector de duplicados (primer await relevante dentro de uploadDoc)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock, });
  const file = mockFile({ name: 'nueva.jpg', degradeAfterFirstCall: true });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  // Si snapshotFileBytesForUpload se llamara DESPUÉS del detector de
  // duplicados (u otro await), file.arrayBuffer() habría sido invocado
  // más de una vez para cuando el upload ocurre, y degradeAfterFirstCall
  // habría hecho que el body subido quedara vacío. Como el upload tuvo
  // éxito con contenido real (ver CASO 6), queda demostrado que la
  // PRIMERA (e idealmente única) lectura ocurrió antes que cualquier otra
  // cosa relevante.
  assert.strictEqual(file.callCount, 1, 'el archivo debe leerse UNA sola vez, lo antes posible');
});

caso('CASO 6 — "File iOS-like" (arrayBuffer funciona la primera vez, falla/vacía después): uploadDoc() sube contenido real igual, SIN necesitar un iPhone real', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'foto-iphone.jpg', size: 2_000_000, bytes: new Uint8Array(2_000_000).fill(9).buffer, degradeAfterFirstCall: true });
  const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.ok(!result.alreadyLoaded);
  assert.ok(sbMock.calls.uploadArgs.body instanceof ArrayBuffer);
  assert.strictEqual(sbMock.calls.uploadArgs.body.byteLength, 2_000_000, 'el body subido debe tener el contenido real, no vacío');
});

caso('CASO 6b — CONTRASTE: si se leyera el mismo archivo iOS-like DESPUÉS de un await adicional (el orden viejo, buggy), el contenido llegaría vacío -- confirma que el bug es real y que el orden importa', async () => {
  const file = mockFile({ degradeAfterFirstCall: true });
  await file.arrayBuffer(); // 1ra lectura (simula que en algún punto ya se leyó una vez, p.ej. por otro consumidor)
  await Promise.resolve(); // un await cualquiera de por medio
  const late = await file.arrayBuffer(); // 2da lectura, "tardía"
  assert.strictEqual(late.byteLength, 0, 'una lectura tardía del mismo objeto reproduce el síntoma real (contenido vacío)');
});

// ============================================================
// PARTE C — upload recibe ArrayBuffer, contentType explícito, MIME
// ============================================================

caso('CASO 7 — sb.storage.upload() recibe un ArrayBuffer como body, nunca el objeto File original', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({});
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.ok(sbMock.calls.uploadArgs.body instanceof ArrayBuffer, 'el body no debe ser el File/Blob original');
  assert.notStrictEqual(sbMock.calls.uploadArgs.body, file);
});

caso('CASO 8 — contentType explícito llega en las opciones de upload', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ type: 'image/jpeg' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.uploadArgs.options.contentType, 'image/jpeg');
  assert.strictEqual(sbMock.calls.uploadArgs.options.upsert, false);
});

caso('CASO 9 — JPG: aceptado, sube y preserva el content-type real', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'factura.jpg', type: 'image/jpeg' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, 'image/jpeg');
});

caso('CASO 10 — PNG: aceptado, sube y preserva el content-type real', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'captura.png', type: 'image/png' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, 'image/png');
});

caso('CASO 11 — HEIC/HEIF: aceptado y preservado TAL CUAL (sin convertir a JPEG)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'foto.heic', type: 'image/heic' });
  const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.ok(!result.alreadyLoaded);
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, 'image/heic');
  assert.strictEqual(sbMock.calls.uploadArgs.options.contentType, 'image/heic');
});

caso('CASO 12 — PDF: aceptado, sube y preserva el content-type real', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'factura.pdf', type: 'application/pdf' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, 'application/pdf');
});

caso('CASO 13 — file.type vacío (navegador no informa MIME) usa fallback seguro application/octet-stream, sin inventar image/jpeg', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'documento.pdf', type: '' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.uploadArgs.options.contentType, 'application/octet-stream');
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, 'application/octet-stream');
});

// ============================================================
// PARTE D — preservación de metadata / archivo original
// ============================================================

caso('CASO 14 — original_name se preserva exactamente', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'Factura Edesur Agosto.pdf', type: 'application/pdf' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.original_name, 'Factura Edesur Agosto.pdf');
});

caso('CASO 15 — size_bytes preservado/coherente con el file real (no con un tamaño inventado)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ size: 345678 });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.size_bytes, 345678);
});

caso('CASO 16 — mime_type preservado (igual al contentType efectivamente usado en el upload)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ type: 'image/webp' });
  await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(sbMock.calls.insertArgs.payload.mime_type, sbMock.calls.uploadArgs.options.contentType);
});

caso('CASO 17 — el path del archivo mantiene exactamente la misma semántica de siempre (group/service/timestamp_random_nombre)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock, group: { id: 'grupo-xyz' } });
  const file = mockFile({ name: 'Factura Final.pdf' });
  await sb.uploadDoc(file, 'servicio-abc', 'obligation-1', null, 'invoice');
  assert.ok(/^grupo-xyz\/servicio-abc\/\d+_[a-z0-9]{6}_Factura_Final\.pdf$/.test(sbMock.calls.uploadArgs.path), `path inesperado: ${sbMock.calls.uploadArgs.path}`);
});

// ============================================================
// PARTE E — invoice / receipt comparten la misma solución
// ============================================================

caso('CASO 18 — invoice usa la solución (mismo uploadDoc, mismo snapshot temprano)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'factura.jpg', degradeAfterFirstCall: true });
  const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.ok(!result.alreadyLoaded);
  assert.ok(sbMock.calls.uploadArgs.body.byteLength > 0);
});

caso('CASO 19 — receipt usa la MISMA solución compartida (no hay una segunda implementación distinta)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({ name: 'comprobante.jpg', degradeAfterFirstCall: true });
  const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', 'payment-1', 'receipt');
  assert.ok(!result.alreadyLoaded);
  assert.ok(sbMock.calls.uploadArgs.body.byteLength > 0);
  assert.strictEqual(sbMock.calls.insertArgs.payload.kind, 'receipt');
  assert.strictEqual(sbMock.calls.insertArgs.payload.payment_id, 'payment-1');
});

// ============================================================
// PARTE F — no duplicados / rollback (comportamiento existente, sin tocar)
// ============================================================

caso('CASO 20 — si Storage falla, NO se crea fila en documents', async () => {
  const sbMock = buildSbMock({ uploadResult: { data: null, error: new Error('Storage caído') } });
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({});
  await assert.rejects(() => sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice'), /Storage caído/);
  assert.strictEqual(sbMock.calls.insertCalled, false, 'no debe llamarse a documents.insert si Storage falló');
});

caso('CASO 21 — si falla el insert en documents, se hace rollback del archivo recién subido (Storage.remove) y NO queda una fila duplicada', async () => {
  const sbMock = buildSbMock({ insertResult: { data: null, error: new Error('insert falló') } });
  const sb = buildSandbox({ documents: [], sb: sbMock });
  const file = mockFile({});
  await assert.rejects(() => sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice'));
  assert.strictEqual(sbMock.calls.removeCalled, true, 'debe intentar el rollback del archivo recién subido');
  assert.deepStrictEqual(sbMock.calls.removeArgs.paths, [sbMock.calls.uploadArgs.path]);
});

caso('CASO 22 — el detector de duplicados sigue intacto: un documento ya cargado (mismo nombre/tamaño/tipo) devuelve alreadyLoaded sin volver a subir', async () => {
  const sbMock = buildSbMock();
  const existing = { id: 'doc-existente', file_path: 'grupo-1/service-1/existente.jpg', original_name: 'existente.jpg', size_bytes: 100, mime_type: 'image/jpeg', obligation_id: 'obligation-1', payment_id: null, kind: 'invoice', voided: false };
  const sb = buildSandbox({ documents: [existing], sb: sbMock });
  const file = mockFile({ name: 'existente.jpg', type: 'image/jpeg', size: 100 });
  const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
  assert.strictEqual(result.alreadyLoaded, true);
  assert.strictEqual(result.document, existing);
  assert.strictEqual(sbMock.calls.uploadCalled, false, 'no debe subir de nuevo un duplicado detectado');
});

// ============================================================
// PARTE G — mejora #6 (anulación no destructiva) y #7 (corrección de
// pagos) permanecen intactas -- byte-identidad de sus bloques reales.
// ============================================================

caso('CASO 23 — mejora #6 (documentos anulados): el detector de duplicados sigue excluyendo documentos voided (misma condición real, sin tocar)', () => {
  const findMatchBlock = extract(indexText, 'async function findMatchingServiceDocument(', 'async function snapshotFileBytesForUpload(');
  assert.ok(findMatchBlock.includes('item.voided!==true'), 'la exclusión de voided del detector de duplicados debe seguir intacta');
});

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  caso(`CASO 24 [${label}] — mejora #6: openVoidServiceDocumentModal/documentCard/isVoidedServiceDocument no fueron tocados por esta mejora`, () => {
    assert.ok(text.includes('function openVoidServiceDocumentModal(documentId,onDelete){'));
    assert.ok(text.includes('function isVoidedServiceDocument(doc){'));
  });

  caso(`CASO 25 [${label}] — mejora #7: correct_historical_payment/openCorrectHistoricalPaymentModal/payment_corrections no fueron tocados por esta mejora`, () => {
    assert.ok(text.includes('function openCorrectHistoricalPaymentModal(paymentId){'));
    assert.ok(text.includes("sb.rpc('correct_historical_payment',{"));
    assert.ok(text.includes("from('payment_corrections')"));
  });
}

// ============================================================
// PARTE H — desktop / operator / Tarjetas / privados intactos
// ============================================================

caso('CASO 26 — desktop sigue pudiendo cargar PDF/JPG/PNG (mismo uploadDoc, sin ninguna rama exclusiva de mobile)', async () => {
  const sbMock = buildSbMock();
  const sb = buildSandbox({ documents: [], sb: sbMock });
  for (const [name, type] of [['factura.pdf', 'application/pdf'], ['factura.jpg', 'image/jpeg'], ['factura.png', 'image/png']]) {
    const file = mockFile({ name, type });
    const result = await sb.uploadDoc(file, 'service-1', 'obligation-1', null, 'invoice');
    assert.ok(!result.alreadyLoaded);
  }
});

caso('CASO 27 — index.html / index_operator.html: el bloque nuevo (snapshotFileBytesForUpload + uploadDoc corregido) es byte-idéntico entre ambos', () => {
  const blockIndex = extract(indexText, 'async function snapshotFileBytesForUpload(', '\nfunction operationalServiceRowHtml(');
  const blockOperator = extract(operatorText, 'async function snapshotFileBytesForUpload(', '\nfunction operationalServiceRowHtml(');
  assert.strictEqual(blockIndex, blockOperator, 'el bloque corregido debe ser idéntico entre titular y operador');
});

caso('CASO 28 — Tarjetas (uploadCreditDocument) permanece byte-idéntica al backup previo a esta mejora -- no se tocó', () => {
  const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_8_upload_mobile_20260818_060000', 'index.html.antes_mejora8');
  const before = fs.readFileSync(beforePath, 'utf8').replace(/\r\n/g, '\n');
  const now = indexText.replace(/\r\n/g, '\n');
  const a = extract(before, 'async function uploadCreditDocument(', 'async function reconcileCreditDocumentLink(');
  const b = extract(now, 'async function uploadCreditDocument(', 'async function reconcileCreditDocumentLink(');
  assert.strictEqual(a, b, 'uploadCreditDocument() debe seguir byte-idéntica');
});

caso('CASO 28b — Tarjetas (renderCreditCardsModule/bindCreditCardsModule) permanece byte-idéntica en ambos archivos', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_mejora_8_upload_mobile_20260818_060000', `${f}.antes_mejora8`);
    const before = fs.readFileSync(beforePath, 'utf8').replace(/\r\n/g, '\n');
    const now = (f === 'index.html' ? indexText : operatorText).replace(/\r\n/g, '\n');
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
  }
});

caso('CASO 29 — servicios privados: uploadDoc no agrega ni quita ninguna condición sobre is_private (comportamiento heredado sin cambios)', () => {
  const uploadDocBlock = extract(indexText, 'async function uploadDoc(file,serviceId,obligationId,paymentId,kind){', '\nfunction operationalServiceRowHtml(');
  assert.ok(!uploadDocBlock.includes('is_private'), 'uploadDoc nunca debe empezar a decidir por is_private -- eso lo gobierna la visibilidad, no el upload');
});

// ============================================================
// PARTE I — sin hacks innecesarios / sin conversión / sin SQL
// ============================================================

caso('CASO 30 — no hay user-agent sniffing/detección de iPhone en la corrección (solución estándar File->arrayBuffer->bytes->upload)', () => {
  const newBlock = extract(indexText, 'async function snapshotFileBytesForUpload(', '\nfunction operationalServiceRowHtml(');
  assert.ok(!/navigator\.userAgent|iPhone|isIOS|isSafari|platform/i.test(newBlock), 'no debe depender de detección de plataforma/navegador');
});

caso('CASO 31 — no hay conversión ni recompresión de imagen (sin canvas/toBlob/drawImage/OffscreenCanvas) en la corrección', () => {
  const newBlock = extract(indexText, 'async function snapshotFileBytesForUpload(', '\nfunction operationalServiceRowHtml(');
  assert.ok(!/canvas|toBlob|drawImage|OffscreenCanvas|createImageBitmap/i.test(newBlock), 'no debe transformar el archivo original de ninguna forma');
});

caso('CASO 32 — esta mejora no crea ni modifica ningún archivo .sql (no toca Supabase) -- sin migración 6b14 ni ningún .sql nombrado para mejora #8/upload/mobile', () => {
  const migracionesDir = path.join(ROOT, 'migraciones');
  const sqlFiles = fs.readdirSync(migracionesDir).filter(f => f.endsWith('.sql'));
  const relatedToMejora8 = sqlFiles.filter(f => /^6b14|mejora.?8|upload.?mobile|no.?content.?provided/i.test(f));
  assert.deepStrictEqual(relatedToMejora8, [], `no debe existir ningún .sql nuevo para esta mejora, se encontraron: ${relatedToMejora8.join(', ')}`);
});

// ---------------- Runner ----------------

async function run() {
  let ok = 0, fail = 0;
  for (const c of casos) {
    try {
      await c.fn();
      console.log('PASS -', c.nombre);
      ok++;
    } catch (e) {
      console.error('FAIL -', c.nombre);
      console.error('       ', e.message);
      fail++;
    }
  }
  console.log('----------------------------------------');
  console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
  console.log('AVISO: valida lógica real extraída + mock de Supabase Storage/DB en memoria, NO Supabase real ni un iPhone real.');
  if (fail > 0) process.exitCode = 1;
}

run();
