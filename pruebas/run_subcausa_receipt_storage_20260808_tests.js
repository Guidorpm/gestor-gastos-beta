// AUDITORÍA DEFINITIVA DE RECEIPT_STORAGE — SUBCAUSA — 20260808
//
// Diagnóstico LOCAL únicamente (no forma parte de ninguna publicación
// todavía). Objetivo: subclasificar el código genérico RECEIPT_STORAGE
// (ya publicado en fa8eb69) usando la estructura REAL del error que
// devuelve sb.storage.from('documents').upload() en
// @supabase/supabase-js@2 -- confirmada leyendo el bundle real servido
// por el CDN del proyecto (index.html línea 13), versión resuelta al
// auditar: 2.112.2. Clases reales encontradas en ese bundle:
//   StorageApiError    { name, message, status, statusCode, code }
//   StorageUnknownError{ name, message, originalError }  (fallo de red,
//                        nunca hubo respuesta HTTP real)
// Nunca se inventó una estructura de otra versión: se citan literalmente
// los constructores extraídos del bundle real en el propio código fuente
// (ver comentarios en creditReceiptStorageSubcode, index.html).
//
// Esta suite NO toca Storage real ni Supabase real -- todos los "errores"
// de Storage acá son objetos JS construidos a mano con exactamente la
// forma real documentada arriba.
//
// node pruebas/run_subcausa_receipt_storage_20260808_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcMain = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');

function extractConst(src, name) {
  const re = new RegExp(`const ${name}=[\\s\\S]*?;\\r?\\n`);
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}
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

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }

// Réplica EXACTA de las clases reales de storage-js (ver comentario arriba
// -- extraídas del bundle real, no inventadas) para construir fixtures
// realistas de error.
class StorageError extends Error {
  constructor(message, namespace = 'storage', status, statusCode) {
    super(message);
    this.__isStorageError = true;
    this.namespace = namespace;
    this.name = 'StorageError';
    this.status = status;
    this.statusCode = statusCode;
  }
}
class StorageApiError extends StorageError {
  constructor(message, status, statusCode, code) {
    super(message, 'storage', status, statusCode);
    this.name = 'StorageApiError';
    this.code = code;
  }
}
class StorageUnknownError extends StorageError {
  constructor(message, originalError) {
    super(message, 'storage');
    this.name = 'StorageUnknownError';
    this.originalError = originalError;
  }
}

function run(label, src) {
  const code = extractConst(src, 'RECEIPT_ALLOWED_MIME') + '\n' +
    extractConst(src, 'RECEIPT_ALLOWED_EXT') + '\n' +
    extractConst(src, 'CREDIT_RECEIPT_STORAGE_MESSAGE_CATEGORIES') + '\n' +
    extractFunction(src, 'creditReceiptStorageSubcode') + '\n' +
    extractFunction(src, 'creditReceiptStorageStatusSuffix') + '\n' +
    extractFunction(src, 'creditReceiptStorageSafeDetail') + '\n' +
    extractFunction(src, 'creditReceiptFileSummary') + '\n' +
    extractFunction(src, 'creditReceiptInvalidRequestSafeMessage') + '\n' +
    extractFunction(src, 'formatFileSize') + '\n' +
    extractFunction(src, 'esc') + '\n' +
    extractFunction(src, 'receiptFileIsAcceptable') + '\n' +
    `module.exports={creditReceiptStorageSubcode,creditReceiptStorageStatusSuffix,creditReceiptStorageSafeDetail,creditReceiptFileSummary,creditReceiptInvalidRequestSafeMessage,receiptFileIsAcceptable};\n`;
  const tmpFile = path.join(__dirname, `_extracted_subcausa_${label.replace(/[^a-z0-9]/gi, '_')}.js`);
  fs.writeFileSync(tmpFile, code);
  delete require.cache[require.resolve(tmpFile)];
  const M = require(tmpFile);

  // ------------------------------------------------------------
  // Casos reales de StorageApiError, tal como los construye storage-js
  // real (ver Vt() en el bundle: status=HTTP numérico, statusCode=
  // body.statusCode||body.code||status+'', code=body.code)
  // ------------------------------------------------------------
  const cases = [
    { name: 'RLS (RLS violation, statusCode=42501 típico de Postgres)', err: new StorageApiError('new row violates row-level security policy', 400, '42501'), expect: 'RECEIPT_STORAGE_RLS' },
    { name: 'RLS (variante con status 403)', err: new StorageApiError('new row violates row-level security policy for table "objects"', 403, '403'), expect: 'RECEIPT_STORAGE_RLS' },
    { name: 'Duplicado (409, upsert:false)', err: new StorageApiError('The resource already exists', 409, '409'), expect: 'RECEIPT_STORAGE_DUPLICATE' },
    { name: 'Invalid key (400)', err: new StorageApiError('Invalid key: credit-cards/../bad', 400, 'InvalidKey'), expect: 'RECEIPT_STORAGE_INVALID_KEY' },
    { name: 'Bucket not found (400)', err: new StorageApiError('Bucket not found', 400, '400'), expect: 'RECEIPT_STORAGE_INVALID_KEY' },
    { name: 'Tamaño (413, límite global del proyecto -- nunca el del bucket, que es null)', err: new StorageApiError('The object exceeded the maximum allowed size', 413, '413'), expect: 'RECEIPT_STORAGE_SIZE' },
    { name: 'Auth (401, JWT vencido/ausente)', err: new StorageApiError('Missing authorization header', 401, '401'), expect: 'RECEIPT_STORAGE_AUTH' },
    { name: 'Auth (403 genérico sin RLS en el mensaje)', err: new StorageApiError('Unauthorized', 403, '403'), expect: 'RECEIPT_STORAGE_AUTH' },
    { name: 'Red/CORS/DNS (StorageUnknownError -- nunca hubo respuesta HTTP)', err: new StorageUnknownError('Failed to fetch', new TypeError('Failed to fetch')), expect: 'RECEIPT_STORAGE_NETWORK' },
    { name: 'Desconocido (500 genérico del servidor)', err: new StorageApiError('Internal Server Error', 500, '500'), expect: 'RECEIPT_STORAGE_UNKNOWN' },
  ];
  for (const c of cases) {
    const got = M.creditReceiptStorageSubcode(c.err);
    ok(`[${label}] ${c.name} -> ${c.expect}`, got === c.expect);
  }

  // ------------------------------------------------------------
  // El status HTTP real (información pública y segura) se agrega como
  // sufijo cuando existe; StorageUnknownError no tiene status -- no debe
  // inventarse uno.
  // ------------------------------------------------------------
  ok(`[${label}] sufijo con status HTTP real cuando existe`, M.creditReceiptStorageStatusSuffix(new StorageApiError('x', 403, '403')) === ' · HTTP 403');
  ok(`[${label}] sin sufijo cuando no hay status HTTP real (StorageUnknownError)`, M.creditReceiptStorageStatusSuffix(new StorageUnknownError('x', new Error('y'))) === '');

  // ------------------------------------------------------------
  // Nunca se filtra información sensible: el código resultante nunca
  // contiene el mensaje crudo completo, ni "Bearer", ni "eyJ" (prefijo
  // típico de un JWT), ni una URL.
  // ------------------------------------------------------------
  const sensitiveErr = new StorageApiError('new row violates row-level security policy for table "objects" (Bearer eyJhbGciOiJIUzI1NiJ9.secretpayload https://xyzcompany.supabase.co/storage/v1/object/documents/...)', 400, '42501');
  const sensitiveCode = M.creditReceiptStorageSubcode(sensitiveErr) + M.creditReceiptStorageStatusSuffix(sensitiveErr);
  ok(`[${label}] el código nunca incluye "Bearer"/JWT/URL del mensaje crudo`, !/Bearer|eyJ|https?:\/\//.test(sensitiveCode));

  // ------------------------------------------------------------
  // Filenames reales de iPhone: la sanitización de uploadCreditDocument
  // (safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_')) ya cubre estos casos
  // -- se verifica acá que NINGUNO de ellos podría generar una Storage key
  // inválida por sí solo.
  // ------------------------------------------------------------
  function sanitize(name) { return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
  const iphoneNames = [
    'IMG_4821.HEIC',
    'Foto 08-08-2026, 14 32 05.jpg',              // espacios + comas
    "Comprobante (Banco) - Guido's pago.pdf",      // paréntesis + apóstrofe
    'Screenshot_2026-08-08 a las 2.32.05 p. m..png', // puntos múltiples
    'comprobante/con/barras.pdf',                   // barras (segmentos falsos)
    'comprobante_日本語_中文.pdf',                    // unicode
    '',                                             // nombre vacío (blob sin nombre)
  ];
  for (const n of iphoneNames) {
    const safe = sanitize(n);
    ok(`[${label}] filename "${n || '(vacío)'}" sanitizado no contiene caracteres fuera de [a-zA-Z0-9._-]`, /^[a-zA-Z0-9._-]*$/.test(safe));
  }
  ok(`[${label}] HEIC pasa receiptFileIsAcceptable por extensión aunque el navegador no informe el MIME`, M.receiptFileIsAcceptable({ name: 'IMG_4821.HEIC', type: '' }));
  ok(`[${label}] HEIC con MIME real image/heic también pasa`, M.receiptFileIsAcceptable({ name: 'IMG_4821.HEIC', type: 'image/heic' }));
  ok(`[${label}] MIME vacío + extensión reconocida pasa (típico de Safari iOS)`, M.receiptFileIsAcceptable({ name: 'foto.jpg', type: '' }));
  ok(`[${label}] MIME application/octet-stream + extensión reconocida pasa`, M.receiptFileIsAcceptable({ name: 'foto.jpg', type: 'application/octet-stream' }));

  // ------------------------------------------------------------
  // AUDITORÍA LOCAL HTTP 400 20260808-D — creditReceiptStorageSafeDetail:
  // el caso real (8374, HTTP 400, RECEIPT_STORAGE_UNKNOWN) es exactamente
  // el escenario "sin código y sin mensaje reconocible" -- debe devolver
  // null (nunca inventar un detalle), nunca el mensaje crudo.
  // ------------------------------------------------------------
  {
    const withCode = new StorageApiError('Bad Request', 400, '400', 'InvalidRequest');
    ok(`[${label}] safeDetail: error.code público se muestra tal cual`, M.creditReceiptStorageSafeDetail(withCode) === 'Storage code: InvalidRequest');

    const withSuspiciousCode = new StorageApiError('x', 400, '400', 'eyJhbGciOiJIUzI1NiJ9.payload');
    ok(`[${label}] safeDetail: un "code" con forma de JWT NUNCA se muestra como si fuera un código real`, M.creditReceiptStorageSafeDetail(withSuspiciousCode) !== `Storage code: ${withSuspiciousCode.code}`);

    const withUrlCode = new StorageApiError('x', 400, '400', 'https://internal.example.com/leak');
    ok(`[${label}] safeDetail: un "code" con URL nunca se muestra tal cual`, M.creditReceiptStorageSafeDetail(withUrlCode) !== `Storage code: ${withUrlCode.code}`);

    const mimeMsg = new StorageApiError('Unsupported mime type detected', 400, '400');
    ok(`[${label}] safeDetail: mensaje reconocido -> categoría segura (mime type)`, M.creditReceiptStorageSafeDetail(mimeMsg) === 'Detalle seguro: Tipo de archivo no admitido');

    const malformedMsg = new StorageApiError('The request could not be parsed: malformed body', 400, '400');
    ok(`[${label}] safeDetail: mensaje reconocido -> categoría segura (malformed)`, M.creditReceiptStorageSafeDetail(malformedMsg) === 'Detalle seguro: Solicitud mal formada');

    const boundaryMsg = new StorageApiError('unexpected end of multipart boundary', 400, '400');
    ok(`[${label}] safeDetail: mensaje reconocido -> categoría segura (multipart/boundary)`, M.creditReceiptStorageSafeDetail(boundaryMsg) === 'Detalle seguro: Error al procesar el archivo enviado');

    const unrecognizedMsg = new StorageApiError('something completely unexpected happened internally', 400, '400');
    ok(`[${label}] safeDetail: mensaje no reconocido -> null (nunca se inventa una categoría)`, M.creditReceiptStorageSafeDetail(unrecognizedMsg) === null);

    // "Bad Request" es el texto de razón HTTP genérico (fallback real de
    // storage-js cuando el body de la respuesta no es JSON válido, ver
    // Vt() en el bundle) -- coincide legítimamente con el patrón
    // "bad request" -> no es un bug del clasificador, es información
    // real (aunque poco específica, igual de específica que el status).
    const genericBadRequest = new StorageApiError('Bad Request', 400, '400');
    ok(`[${label}] safeDetail: "Bad Request" (fallback real de statusText) sí coincide con la categoría genérica`, M.creditReceiptStorageSafeDetail(genericBadRequest) === 'Detalle seguro: Solicitud mal formada');

    // Caso realmente sin ninguna señal aprovechable: sin code, mensaje que
    // no coincide con ninguna de las 5 categorías conocidas -- éste es el
    // escenario que NO debe inventar nada (posible causa real de 8374 si
    // el mensaje real de Supabase fue distinto de los patrones cubiertos).
    const noUsableSignal = new StorageApiError('Internal error', 400, '400');
    ok(`[${label}] safeDetail: sin code ni mensaje reconocible -> null, no inventa nada`, M.creditReceiptStorageSafeDetail(noUsableSignal) === null);

    // Nunca debe aparecer "Bearer", un JWT (prefijo eyJ) o una URL en NINGÚN
    // resultado de safeDetail, sin importar qué contenga error.message.
    const sensitiveMsg = new StorageApiError('failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc at https://xyz.supabase.co/storage/v1/object/documents/secret', 400, '400');
    const detail = M.creditReceiptStorageSafeDetail(sensitiveMsg);
    ok(`[${label}] safeDetail: mensaje con Bearer/JWT/URL nunca se filtra crudo`, detail === null || !/Bearer|eyJ|https?:\/\//.test(detail));
  }

  // ------------------------------------------------------------
  // AUDITORÍA LOCAL HTTP 400 20260808-D — creditReceiptFileSummary: nunca
  // expone ruta local (file.name de un <input type=file> nunca la trae),
  // siempre extensión+tamaño+MIME (o "MIME vacío").
  // ------------------------------------------------------------
  {
    ok(`[${label}] fileSummary: JPEG normal`, M.creditReceiptFileSummary({ name: 'foto.jpg', size: 182 * 1024, type: 'image/jpeg' }) === 'Archivo: JPG · 182.0 KB · image/jpeg');
    ok(`[${label}] fileSummary: HEIC con MIME vacío (caso típico iPhone)`, M.creditReceiptFileSummary({ name: 'IMG_4821.HEIC', size: 1.4 * 1024 * 1024, type: '' }) === `Archivo: HEIC · ${M.creditReceiptFileSummary({ name: 'x', size: 1.4 * 1024 * 1024, type: 'x' }).split(' · ')[1]} · MIME vacío`);
    ok(`[${label}] fileSummary: nunca contiene "/" ni "\\\\" propios de una ruta de archivo (más allá del MIME, que sí lleva "/")`, !/[a-zA-Z]:\\|\/(Users|home|var|private)\//.test(M.creditReceiptFileSummary({ name: 'foto.jpg', size: 100, type: 'image/jpeg' })));
    ok(`[${label}] fileSummary: PDF de resumen (mismo formato que un comprobante)`, M.creditReceiptFileSummary({ name: 'resumen.pdf', size: 500 * 1024, type: 'application/pdf' }).startsWith('Archivo: PDF ·'));
  }

  // ------------------------------------------------------------
  // AUDITORÍA LOCAL InvalidRequest 20260809 —
  // creditReceiptInvalidRequestSafeMessage: caso real confirmado (8374,
  // HTTP 400, code='InvalidRequest') -- sanitiza error.message, NUNCA lo
  // muestra crudo, y solo actúa para code+status exactos.
  // ------------------------------------------------------------
  {
    const invalidReq = (message) => new StorageApiError(message, 400, '400', 'InvalidRequest');

    ok(`[${label}] InvalidRequest: solo actúa cuando code==='InvalidRequest' Y status===400`, M.creditReceiptInvalidRequestSafeMessage(new StorageApiError('x', 403, '403', 'InvalidRequest')) === null);
    ok(`[${label}] InvalidRequest: nunca actúa para otros códigos`, M.creditReceiptInvalidRequestSafeMessage(new StorageApiError('x', 400, '400', 'BucketNotFound')) === null);

    ok(`[${label}] InvalidRequest: mensaje corto normal se muestra sanitizado`, M.creditReceiptInvalidRequestSafeMessage(invalidReq('The request body is not valid multipart/form-data')) === 'Detalle Storage: The request body is not valid multipart/form-data');

    ok(`[${label}] InvalidRequest: mensaje vacío -> oculto por seguridad`, M.creditReceiptInvalidRequestSafeMessage(invalidReq('')) === 'Detalle Storage: oculto por seguridad');

    const withUrl = M.creditReceiptInvalidRequestSafeMessage(invalidReq('failed while fetching https://xyzcompany.supabase.co/storage/v1/object/documents/secret-path?token=abc123'));
    ok(`[${label}] InvalidRequest: URL completa nunca aparece cruda`, !/https?:\/\//.test(withUrl));

    const withBearer = M.creditReceiptInvalidRequestSafeMessage(invalidReq('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.signature123456 rejected'));
    ok(`[${label}] InvalidRequest: "Bearer ..." nunca aparece crudo`, !/Bearer\s+eyJ/i.test(withBearer));

    const withJwt = M.creditReceiptInvalidRequestSafeMessage(invalidReq('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c invalid'));
    ok(`[${label}] InvalidRequest: estructura de JWT (3 segmentos con puntos) nunca aparece cruda`, !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(withJwt));

    const withQuerystring = M.creditReceiptInvalidRequestSafeMessage(invalidReq('bad request for path?apikey=sbp_1234567890abcdef&signature=xyz'));
    ok(`[${label}] InvalidRequest: querystring con posible apikey nunca aparece cruda`, !/apikey=|signature=/i.test(withQuerystring));

    const withNewlines = M.creditReceiptInvalidRequestSafeMessage(invalidReq('line one\nline two\r\nline three\ttabbed'));
    ok(`[${label}] InvalidRequest: saltos de línea/tabs se reemplazan por espacios (una sola línea)`, withNewlines && !/[\r\n\t]/.test(withNewlines));

    const longMsg = 'x'.repeat(300);
    const withLongMsg = M.creditReceiptInvalidRequestSafeMessage(invalidReq(longMsg));
    ok(`[${label}] InvalidRequest: mensaje largo se trunca (nunca supera ~180 caracteres totales con el prefijo)`, withLongMsg.length <= 180);

    const withSecretWord = M.creditReceiptInvalidRequestSafeMessage(invalidReq('internal secret password leaked in log'));
    ok(`[${label}] InvalidRequest: mensaje con palabras sensibles residuales -> oculto por seguridad (red de seguridad final)`, withSecretWord === 'Detalle Storage: oculto por seguridad');

    // Ningún resultado, para ningún caso de esta batería, puede contener
    // patrones sensibles -- barrido final sobre todos los casos anteriores.
    const allResults = [withUrl, withBearer, withJwt, withQuerystring, withNewlines, withLongMsg, withSecretWord];
    ok(`[${label}] InvalidRequest: ningún resultado de la batería contiene Bearer/JWT/URL/apikey crudos`, allResults.every(r => !/Bearer\s+eyJ|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|https?:\/\/|apikey=/i.test(r)));
  }

  // ------------------------------------------------------------
  // Confirma que la clasificación previa (subcode RLS/AUTH/DUPLICATE/
  // NETWORK/UNKNOWN) sigue intacta -- esta corrección es puramente
  // aditiva, no reemplaza nada de lo ya publicado.
  // ------------------------------------------------------------
  {
    ok(`[${label}] clasificación previa intacta: RLS`, M.creditReceiptStorageSubcode(new StorageApiError('new row violates row-level security policy', 400, '42501')) === 'RECEIPT_STORAGE_RLS');
    ok(`[${label}] clasificación previa intacta: caso real 8374 (InvalidRequest) sigue cayendo en UNKNOWN (no se reclasifica el subcode, solo se agrega detalle)`, M.creditReceiptStorageSubcode(new StorageApiError('Bad Request', 400, '400', 'InvalidRequest')) === 'RECEIPT_STORAGE_UNKNOWN');
  }

  fs.unlinkSync(tmpFile);
}

// ------------------------------------------------------------
// Ruta EXACTA del caso real (UUID confirmados en la evidencia de esta
// tarea) -- construida con la MISMA fórmula que uploadCreditDocument
// (index.html): `credit-cards/${ownerId}/${cardId}/${statementId||'sin-resumen'}/${sub}/...`
// ------------------------------------------------------------
{
  const ownerId = 'b679a4b0-ffa1-4288-b8aa-e49414235192';
  const cardId = '9a78fd9a-de1b-4668-b1cd-408ea06ef3f2';
  const statementId = '0d2d1be7-68ca-4954-ae49-6f55f6f23cb8';
  const movementId = '33c05fe9-1aac-49d1-9763-e1cba357ab80';
  const sub = `payments/${movementId}`;
  const filePath = `credit-cards/${ownerId}/${cardId}/${statementId || 'sin-resumen'}/${sub}/1786200000000_abc123_comprobante.pdf`;
  const segments = filePath.split('/');
  ok('ruta real: segmento[0]=credit-cards', segments[0] === 'credit-cards');
  ok('ruta real: segmento[1]=owner_id real', segments[1] === ownerId);
  ok('ruta real: segmento[2]=card_id real', segments[2] === cardId);
  ok('ruta real: segmento[3]=statement_id real', segments[3] === statementId);
  ok('ruta real: segmento[4]=payments', segments[4] === 'payments');
  ok('ruta real: segmento[5]=movement_id real', segments[5] === movementId);
  console.log(`Ruta real construida: ${filePath}`);
  console.log(`(Nota: storage.foldername() de Postgres es 1-indexado -- estos mismos valores caen en foldername[1..6], como describe la policy.)`);
}

// ------------------------------------------------------------
// Comparación literal statement vs card_receipt: mismas opciones de
// upload() -- se verifica leyendo el código fuente real, no se simula.
// ------------------------------------------------------------
{
  const uploadCallRegex = /\.upload\(filePath,file,\{contentType:file\.type,upsert:false,cacheControl:'3600'\}\)/;
  const mainMatches = (srcMain.match(new RegExp(uploadCallRegex.source, 'g')) || []).length;
  ok('index.html: existe UNA sola forma de llamar a .upload() en uploadCreditDocument (statement y card_receipt comparten la misma línea de código, no hay dos ramas distintas)', mainMatches === 1);
  const operatorMatches = (srcOperator.match(new RegExp(uploadCallRegex.source, 'g')) || []).length;
  ok('index_operator.html: misma verificación', operatorMatches === 1);
}

// ------------------------------------------------------------
// AUDITORÍA LOCAL LEGIBILIDAD 20260809 — el diagnóstico inline de
// comprobantes quedaba en una sola línea y se cortaba horizontalmente
// porque reutilizaba .obligation-pill (white-space:nowrap, pensada para
// una insignia corta). Verificaciones de código fuente real (CSS y
// markup), no de renderizado visual real (no hay navegador en esta
// suite) -- confirman que la causa fue corregida sin tocar
// .obligation-pill (que se sigue usando igual en el resto de la app).
// ------------------------------------------------------------
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const cssMatch = /\.credit-receipt-diagnostic\{([^}]*)\}/.exec(src);
  ok(`[${label}] existe la clase .credit-receipt-diagnostic`, !!cssMatch);
  const cssBody = cssMatch ? cssMatch[1] : '';
  ok(`[${label}] .credit-receipt-diagnostic: white-space:normal (nunca nowrap)`, /white-space:normal/.test(cssBody));
  ok(`[${label}] .credit-receipt-diagnostic: overflow-wrap:anywhere (permite wrap seguro de textos largos/sin espacios)`, /overflow-wrap:anywhere/.test(cssBody));
  ok(`[${label}] .credit-receipt-diagnostic: display:block (nunca inline-flex de una insignia)`, /display:block/.test(cssBody));
  ok(`[${label}] .obligation-pill (insignias del resto de la app) sigue intacta, todavía con white-space:nowrap`, /\.obligation-pill\{[^}]*white-space:nowrap[^}]*\}/.test(src));

  const catchBlockMatch = /if\(status\)status\.innerHTML=`<div class="credit-receipt-diagnostic">[\s\S]{0,400}?<\/div>\s*<div style="margin-top:8px">/.exec(src);
  ok(`[${label}] el catch de confirmCreditReceiptUpload usa el nuevo contenedor .credit-receipt-diagnostic (ya no <span class="obligation-pill violet"> envolviendo todo)`, !!catchBlockMatch);
  ok(`[${label}] cada dato (Código/HTTP/Storage code/Detalle/Archivo) se arma como <div> propio, no concatenado con <br><small>`, src.includes('diagnosticLines.map(l=>`<div>${l}</div>`)'));
  ok(`[${label}] la línea "Código:" y la línea "HTTP:" quedan separadas (no concatenadas en un solo string)`, src.includes("`Código: ${esc(codeOnly)}`") && src.includes("httpPart.replace('HTTP','HTTP:')"));

  ok(`[${label}] el toast sigue armándose (no se tocó esa línea) y sigue siendo un string plano de una sola línea, más corto que el inline`, /toast\(`\$\{creditReceiptErrorMessage\(error\)\} \(Código: \$\{creditReceiptDiagnosticCode\(error\)\}\)\$\{safeDetail\?` · \$\{safeDetail\}`:''\}`\);/.test(src));

  ok(`[${label}] uploadCreditDocument/.upload() siguen byte a byte iguales (contentType/upsert/cacheControl)`, src.includes(".upload(filePath,file,{contentType:file.type,upsert:false,cacheControl:'3600'})"));
}

run('index.html', srcMain);
run('index_operator.html', srcOperator);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
process.exit(failures ? 1 : 0);
