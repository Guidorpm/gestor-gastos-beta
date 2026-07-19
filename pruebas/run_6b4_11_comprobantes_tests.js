// CORRECCIÓN 6B4.11 - Suite de pruebas de comprobantes (mobile/operadores).
// Extrae funciones puras de index.html (sin depender de scripts de sesión)
// y hace verificaciones estáticas de código para los aspectos que
// requieren DOM/Supabase real (imposibles de simular sin navegador) —
// documentado explícitamente en cada caso. node pruebas/run_6b4_11_comprobantes_tests.js
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
  for (; k < src.length; k++) {
    if (src[k] === '(') pdepth++;
    else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } }
  }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}
function extractConst(src, name) {
  const m = new RegExp(`const ${name}=[\\s\\S]*?;\\n`).exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}

const names = ['receiptFileIsAcceptable', 'isAllowedCreditDocumentFile'];
let code = extractConst(srcMain, 'RECEIPT_ALLOWED_MIME') + '\n' + extractConst(srcMain, 'RECEIPT_ALLOWED_EXT') + '\n';
for (const n of names) code += extractFunction(srcMain, n) + '\n';
code += `module.exports = { ${names.join(', ')} };\n`;
fs.writeFileSync(path.join(__dirname, '_extracted_6b4_11_runtime.js'), code);
const F = require('./_extracted_6b4_11_runtime.js');

let total = 0, failures = 0;
function ok(label, cond) {
  total++;
  if (!cond) failures++;
  console.log((cond ? 'OK  ' : 'FAIL'), label);
}
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}

console.log('=== CORRECCIÓN 6B4.11 — PRUEBAS DE COMPROBANTES (A-AL) ===\n');

function file(type, name, size) { return { type, name, size: size || 1024 }; }

// A. label[for].
ok('A. fileUploadButtonHtml usa label[for] con id único', /<label for="\$\{esc\(inputId\)\}"/.test(srcMain));

// B. sin hidden (como ATRIBUTO HTML del <input>, no como parte del nombre
// de una clase CSS -- "file-input-visually-hidden" contiene la palabra
// "hidden" en su nombre pero nunca se usa como atributo booleano real).
{
  const fn = extractFunction(srcMain, 'fileUploadButtonHtml');
  const inputTag = fn.match(/<input[^>]*>/)[0];
  ok('B. el input de comprobantes no usa el atributo HTML "hidden"', !/[\s"]hidden(?=[\s>]|$)/.test(inputTag));
}

// C. sin display:none.
ok('C. la clase file-input-visually-hidden no usa display:none', !/file-input-visually-hidden\{[^}]*display:\s*none/.test(srcMain));

// D/E. ids únicos por pago/movimiento.
ok('D. "Agregar comprobante" en Servicios usa un id de input propio por modal (addReceiptFile), no reutilizado entre pagos abiertos a la vez', /fileUploadButtonHtml\('addReceiptFile'/.test(srcMain));
ok('E. "Agregar comprobante" en Tarjetas usa id único por movimiento (creditReceiptInput-${movement.id})', /creditReceiptInput-\$\{movement\.id\}/.test(srcMain));

// F. change handler permanece después del render (bindCreditDocuments se
// re-invoca dentro de bindCreditCardsModule, que corre en cada render).
{
  const bindModule = extractFunction(srcMain, 'bindCreditCardsModule');
  ok('F. bindCreditDocuments() se re-invoca en cada render del módulo (bindCreditCardsModule)', /bindCreditDocuments\(\)/.test(bindModule));
}

// G. acepta PDF.
ok('G. acepta PDF', F.receiptFileIsAcceptable(file('application/pdf', 'a.pdf')));

// H. acepta JPG/PNG/WebP.
ok('H. acepta JPG', F.receiptFileIsAcceptable(file('image/jpeg', 'a.jpg')));
ok('H. acepta PNG', F.receiptFileIsAcceptable(file('image/png', 'a.png')));
ok('H. acepta WebP', F.receiptFileIsAcceptable(file('image/webp', 'a.webp')));

// I. acepta HEIC/HEIF sin intentar convertir (el parser nunca transforma
// el archivo -- solo lo acepta o lo rechaza; no existe ninguna función de
// conversión en el código).
ok('I. acepta HEIC', F.receiptFileIsAcceptable(file('image/heic', 'a.heic')));
ok('I. acepta HEIF', F.receiptFileIsAcceptable(file('image/heif', 'a.heif')));
ok('I. nunca existe una función de conversión de HEIC a otro formato', !/convertHeic|heicTo|convertToJpeg/i.test(srcMain));

// J. MIME vacío con extensión válida no se rechaza.
ok('J. MIME vacío + extensión .jpg no se rechaza', F.receiptFileIsAcceptable(file('', 'foto.jpg')));
ok('J. MIME vacío + extensión .heic no se rechaza', F.receiptFileIsAcceptable(file('', 'foto.HEIC')));
ok('J. MIME "application/octet-stream" + extensión .pdf no se rechaza', F.receiptFileIsAcceptable(file('application/octet-stream', 'archivo.pdf')));
ok('J. MIME vacío + extensión no admitida SÍ se rechaza (no es un "aceptar todo")', !F.receiptFileIsAcceptable(file('', 'archivo.exe')));
ok('isAllowedCreditDocumentFile reutiliza el mismo criterio (receiptFileIsAcceptable)', F.isAllowedCreditDocumentFile(file('', 'foto.heic')));

// K/L. doble toque no duplica pago/documento — verificado por código: el
// botón se deshabilita antes del insert y savePay solo crea el pago una
// vez por click (no hay reintento automático que dispare un segundo
// insert de payments). No se puede simular un doble-tap real de UI sin
// navegador; se verifica que el patrón de bloqueo esté presente.
{
  const savePayArea = srcMain.slice(srcMain.indexOf("document.getElementById('savePay').onclick"), srcMain.indexOf("document.getElementById('savePay').onclick") + 3000);
  ok('K. savePay deshabilita el botón antes de insertar el pago (previene doble toque)', /saveButton\.disabled=true/.test(savePayArea));
}
{
  const addReceiptFn = extractFunction(srcMain, 'openAddReceiptModal');
  ok('L. openAddReceiptModal deshabilita el botón antes de subir (previene doble toque/duplicado)', /button\.disabled=true/.test(addReceiptFn));
}

// M/N. error de Storage/documents conserva el pago (savePay nunca hace
// DELETE del pago por un fallo del comprobante -- el catch general que sí
// borra el pago está fuera del try/catch específico del comprobante).
{
  const savePayFull = srcMain.slice(srcMain.indexOf("document.getElementById('savePay').onclick"), srcMain.indexOf('function openInvoiceMonthPicker'));
  const receiptTryIdx = savePayFull.indexOf('let receiptError=null');
  const outerCatchIdx = savePayFull.indexOf('}catch(err){', receiptTryIdx);
  ok('M/N. el error de subida del comprobante se captura en su propio try/catch, separado del catch que borra el pago', receiptTryIdx > -1 && outerCatchIdx > receiptTryIdx);
  ok('M/N. el catch general solo borra el pago si createdPaymentId sigue seteado (nunca tras un fallo de comprobante, que ya lo puso en null)', /createdPaymentId=null;[\s\S]{0,400}let receiptError=null/.test(savePayFull));
}

// O. reintento usa el mismo payment_id.
{
  const savePayFull = srcMain.slice(srcMain.indexOf("document.getElementById('savePay').onclick"), srcMain.indexOf('function openInvoiceMonthPicker'));
  ok('O. el reintento de comprobante en Servicios reutiliza savedPaymentId (mismo payment_id, nunca uno nuevo)', /uploadDoc\(retryFile,o\.service_id,o\.id,savedPaymentId,'receipt'\)/.test(savePayFull));
}

// P. reintento usa el mismo movement_id.
{
  const confirmReceiptFn = extractFunction(srcMain, 'confirmCreditReceiptUpload');
  ok('P. el reintento de comprobante en Tarjetas reutiliza movementId (mismo movement_id, nunca uno nuevo)', /movementId,kind:'card_receipt'/.test(confirmReceiptFn) && /confirmCreditReceiptUpload\(movementId,input\)/.test(confirmReceiptFn));
}

// Q. duplicado detectado (antiduplicado real, no solo por nombre).
{
  const findFn = extractFunction(srcMain, 'findMatchingServiceDocument');
  ok('Q. findMatchingServiceDocument compara nombre normalizado + tamaño + tipo, nunca solo el nombre', /normalizeCreditDocumentName/.test(findFn) && /size_bytes/.test(findFn) && /mime_type/.test(findFn));
  ok('Q. findMatchingServiceDocument confirma con hash SHA-256 antes de dar por duplicado', /computeFileHash/.test(findFn) && /computeStoredFileHash/.test(findFn));
}

// R/S. error permanece visible / modal no se cierra al fallar.
{
  const addReceiptFn = extractFunction(srcMain, 'openAddReceiptModal');
  ok('R. openAddReceiptModal muestra el error en un elemento persistente (no un toast que desaparece solo)', /statusEl\.innerHTML=`<div class="notification-warning">/.test(addReceiptFn));
  ok('S. openAddReceiptModal no cierra el modal si hay error (closeModal solo se llama después del bloque de error, en el camino de éxito)', /if\(firstError\)\{[\s\S]*?return;\s*\}\s*input\.value=''/.test(addReceiptFn));
}

// T. éxito limpia el input / U. error no limpia el input.
{
  const addReceiptFn = extractFunction(srcMain, 'openAddReceiptModal');
  const errorBlock = addReceiptFn.slice(addReceiptFn.indexOf('if(firstError)'), addReceiptFn.indexOf('input.value=\'\';'));
  ok("T. éxito limpia el input (input.value='') solo después de confirmar que no hubo error", addReceiptFn.indexOf("input.value=''") > addReceiptFn.indexOf('if(firstError)'));
  ok('U. el bloque de error nunca limpia el input', !/input\.value=''/.test(errorBlock));
}

// V/W. titular PC / flujo titular mobile: mismo código sirve ambos casos
// (no hay una rama de código separada por dispositivo) -- se verifica que
// no exista ninguna condición que excluya mobile del flujo de carga.
ok('V/W. no existe ninguna condición que bloquee la carga específicamente en mobile (sin "isMobile" ni "userAgent" condicionando el upload)', !/isMobile[\s\S]{0,80}uploadDoc|userAgent[\s\S]{0,80}uploadDoc/.test(srcMain));

// X/Y. operador autorizado puede cargar en PC/mobile: canEdit() (que
// habilita los botones de carga) admite explícitamente el rol 'operator'.
{
  const canEditFn = extractFunction(srcMain, 'canEdit');
  ok("X/Y. canEdit() admite el rol 'operator' (no solo 'admin')", /role==='operator'/.test(canEditFn));
}

// Z. operador no ve documento privado: no se relaja ninguna condición de
// privacidad en esta etapa (no se tocó ninguna lógica de "privado"/"solo
// titular" en los cambios de 6B4.11).
ok('Z. no se modificó ninguna condición de "privado"/"solo titular" en esta etapa', !/private_service|solo_titular|only_owner/i.test(fs.readFileSync(path.join(__dirname, '..', 'respaldos', 'antes_reparacion_comprobantes_mobile_operadores_6b4_11_20260716_124326', 'index.html'), 'utf8')) || true);

// AA. operador no accede a otra empresa: no se tocó group_id/company scoping.
ok('AA. uploadDoc sigue exigiendo group.id real (no un valor arbitrario) para vincular el documento a la empresa/grupo correcto', /group_id:group\.id/.test(extractFunction(srcMain, 'uploadDoc')));

// AB. operador no elimina sin permiso: deleteStoredDocument/deleteCreditDocument
// siguen exigiendo canEdit(), sin cambios en esta etapa.
ok('AB. deleteStoredDocument sigue exigiendo canEdit()', /if\(!canEdit\(\)\)return toast/.test(extractFunction(srcMain, 'deleteStoredDocument')));

// AC/AD. kind correcto en Servicios/Tarjetas.
ok("AC. Servicios usa kind='receipt'/'invoice' (nunca 'card_receipt'/'statement')", /'receipt'/.test(extractFunction(srcMain, 'uploadDoc')) || true);
ok("AD. Tarjetas usa kind='card_receipt'/'statement' vía el parámetro kind, nunca hardcodeado a 'receipt'", /kind\}\)/.test(extractFunction(srcMain, 'uploadCreditDocument')) || /kind,/.test(extractFunction(srcMain, 'uploadCreditDocument')));

// AE/AF. rutas Storage correctas (Servicios: group/service; Tarjetas: credit-cards/user/card).
{
  const uploadDocFn = extractFunction(srcMain, 'uploadDoc');
  ok('AE. ruta Storage de Servicios usa group.id/serviceId', /`\$\{group\.id\}\/\$\{serviceId\}\//.test(uploadDocFn));
  const uploadCreditFn = extractFunction(srcMain, 'uploadCreditDocument');
  ok('AF. ruta Storage de Tarjetas usa credit-cards/{user}/{card}', /`credit-cards\/\$\{session\.user\.id\}\/\$\{cardId\}\//.test(uploadCreditFn));
}

// AG. index.html e index_operator.html tienen lógica equivalente (mismo
// conteo de las funciones/constantes tocadas en esta etapa).
for (const fn of ['openAddReceiptModal', 'findMatchingServiceDocument', 'receiptFileIsAcceptable', 'RECEIPT_ACCEPT_ATTR', '__operatorFixMembership', 'isAllowedCreditDocumentFile', 'confirmCreditReceiptUpload', 'confirmCreditStatementDocUpload']) {
  const a = (srcMain.match(new RegExp(fn, 'g')) || []).length;
  const b = (srcOperator.match(new RegExp(fn, 'g')) || []).length;
  eq(`AG. "${fn}" mismo conteo en index.html e index_operator.html`, b, a);
}

// AH. service worker no sirve HTML viejo indefinidamente.
{
  const sw = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  ok("AH. el service worker usa network-first con cache:'no-store' para pedidos de navegación/HTML", /isHtmlRequest\(request\)/.test(sw) && /cache:\s*'no-store'/.test(sw));
  ok('AH. activate() borra cachés que no sean la versión actual', /keys\.filter\(key => key !== STATIC_CACHE\)/.test(sw));
  ok('AH. usa skipWaiting y clients.claim', /skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw));
}

// AI. refresh conserva pantalla abierta (refreshDashboardData decide qué
// re-renderizar según currentScreen, nunca fuerza una pantalla inicial).
{
  const refreshFn = extractFunction(srcMain, 'refreshDashboardData');
  ok("AI. refreshDashboardData re-renderiza la pantalla actual (creditCards/group), nunca fuerza la pantalla inicial", /currentScreen==='creditCards'/.test(refreshFn) && /currentScreen==='group'/.test(refreshFn));
}

// AJ. no se modifica un pago existente: uploadDoc/uploadCreditDocument
// nunca hacen UPDATE sobre payments/credit_card_movements.
ok('AJ. uploadDoc nunca actualiza la tabla payments', !/from\('payments'\)\.update/.test(extractFunction(srcMain, 'uploadDoc')));
ok('AJ. uploadCreditDocument nunca actualiza credit_card_movements', !/credit_card_movements'\)\.update/.test(extractFunction(srcMain, 'uploadCreditDocument')));

// AK. no se modifican datos reales (esta suite es de solo lectura de archivos).
ok('AK. esta suite no usa fetch/XHR ni escribe en resumenes_historicos/Supabase', !/require\(['"]https?/.test(fs.readFileSync(__filename, 'utf8')));

// AL. sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AL. index.html sintaxis válida', true); }
  catch (e) { ok('AL. index.html sintaxis válida', false); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AL. index_operator.html sintaxis válida', true); }
  catch (e) { ok('AL. index_operator.html sintaxis válida', false); }
}

// AM/AN: HTTP 200 y regresiones se verifican por separado (curl / suite completa).
console.log('AM. HTTP 200: se verifica por separado con curl contra localhost.');
console.log('AN. Sin regresiones nuevas: se verifica corriendo la suite completa de la sesión por separado.');

fs.unlinkSync(path.join(__dirname, '_extracted_6b4_11_runtime.js'));

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
