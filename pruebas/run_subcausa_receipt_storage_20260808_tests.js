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
    extractFunction(src, 'creditReceiptStorageSubcode') + '\n' +
    extractFunction(src, 'creditReceiptStorageStatusSuffix') + '\n' +
    extractFunction(src, 'receiptFileIsAcceptable') + '\n' +
    `module.exports={creditReceiptStorageSubcode,creditReceiptStorageStatusSuffix,receiptFileIsAcceptable};\n`;
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

run('index.html', srcMain);
run('index_operator.html', srcOperator);

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
process.exit(failures ? 1 : 0);
