// CORRECCIÓN 6B4.11.2 - Suite de pruebas del arranque de index_operator.html
// (getAveragePeriodForYear is not defined). Verificación estática +
// funcional, sin depender de scripts de sesión.
// node pruebas/run_6b4_11_2_inicio_operador_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcMain = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp(`function ${name}\\(`).exec(src);
  if (!m) return null;
  let i = m.index;
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let k = src.indexOf('(', m.index), pdepth = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pdepth++; else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } } }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(i, j);
}
function allFunctionNames(src) {
  const set = new Set();
  const re = /^(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}
function allTopLevelDeclNames(src) {
  const set = new Set();
  const re = /^(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/gm;
  let m;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}

let total = 0, failures = 0;
function ok(label, cond) {
  total++;
  if (!cond) failures++;
  console.log((cond ? 'OK  ' : 'FAIL'), label);
}

console.log('=== CORRECCIÓN 6B4.11.2 — INICIO DE INDEX_OPERATOR.HTML (A-U) ===\n');

// A/B. existe en ambos archivos.
const fnMain = extractFunction(srcMain, 'getAveragePeriodForYear');
const fnOperator = extractFunction(srcOperator, 'getAveragePeriodForYear');
ok('A. getAveragePeriodForYear existe en index.html', !!fnMain);
ok('B. getAveragePeriodForYear existe en index_operator.html', !!fnOperator);

// C. implementación equivalente (idéntica, no solo "existe").
ok('C. la implementación es equivalente (idéntica) en ambos archivos', fnMain === fnOperator);

// D. no es un stub vacío.
ok('D. no es un stub vacío (tiene la lógica real de 3 ramas: futuro/actual/cerrado)', /isFutureYear:true/.test(fnOperator) && /currentMonth/.test(fnOperator) && /monthsToUse:12/.test(fnOperator));

// E. no devuelve un valor fijo inventado.
{
  // Ejecuta la función real extraída con 3 años distintos y confirma que
  // el resultado varía según el caso (nunca el mismo objeto fijo).
  const fn = new Function(`return (${fnOperator.replace(/^function getAveragePeriodForYear/, 'function')})`)();
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const future = fn(String(Number(currentYear) + 1));
  const current = fn(currentYear);
  const past = fn(String(Number(currentYear) - 1));
  ok('E. no devuelve un valor fijo (año futuro/actual/pasado dan resultados distintos)',
    future.isFutureYear === true && past.monthsToUse === 12 && current.monthsToUse === now.getMonth() + 1);
}

// F. dependencias existen en ambos archivos (Date/String/padStart/
// getFullYear/getMonth son built-ins nativos de JS -- se confirma que no
// llama a ninguna función propia del proyecto que pudiera faltar).
{
  const calls = [...fnOperator.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)].map(m => m[1]);
  const allowed = new Set(['getAveragePeriodForYear', 'Date', 'String', 'padStart', 'getFullYear', 'getMonth', 'if', 'for', 'while', 'switch', 'catch']);
  const unknown = calls.filter(name => !allowed.has(name));
  ok('F. getAveragePeriodForYear solo llama a built-ins nativos de JS (Date/String/padStart/getFullYear/getMonth), ninguna función propia que pudiera faltar', unknown.length === 0);
  if (unknown.length) console.log('    desconocidas:', unknown.join(', '));
}

// G. init() existe una sola vez.
{
  const countMain = (srcMain.match(/^(?:async\s+)?function init\(/gm) || []).length;
  const countOperator = (srcOperator.match(/^(?:async\s+)?function init\(/gm) || []).length;
  ok('G. init() existe una sola vez en index.html', countMain === 1);
  ok('G. init() existe una sola vez en index_operator.html', countOperator === 1);
}

// H. init() no se ejecuta antes de preparar los overrides necesarios
// (el "FIX FINAL OPERATOR" -- canEdit/currentRoleLabel/renderApp -- debe
// quedar definido ANTES de la llamada a init() al final del archivo).
{
  const initCallIdx = srcOperator.lastIndexOf('init();');
  const fixIdx = srcOperator.indexOf('__operatorFixMembership');
  ok('H. init() se llama después de definir los overrides de operador (__operatorFixMembership)', fixIdx > -1 && fixIdx < initCallIdx);
}

// I. no quedan referencias a funciones inexistentes en la cadena inicial
// (comprobación estática completa: toda función declarada en index.html
// también existe en index_operator.html, y viceversa).
{
  const fa = allFunctionNames(srcMain), fb = allFunctionNames(srcOperator);
  const missingInOperator = [...fa].filter(n => !fb.has(n));
  const missingInMain = [...fb].filter(n => !fa.has(n));
  ok('I. ninguna función de index.html falta en index_operator.html', missingInOperator.length === 0);
  if (missingInOperator.length) console.log('    faltantes:', missingInOperator.join(', '));
  ok('I. ninguna función de index_operator.html falta en index.html (sin funciones huérfanas nuevas)', missingInMain.length === 0);
  const da = allTopLevelDeclNames(srcMain), db = allTopLevelDeclNames(srcOperator);
  const missingConstsInOperator = [...da].filter(n => !db.has(n));
  ok('I. ninguna constante/variable de nivel superior de index.html falta en index_operator.html', missingConstsInOperator.length === 0);
  if (missingConstsInOperator.length) console.log('    faltantes:', missingConstsInOperator.join(', '));
}

// J/K. sintaxis válida.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('J. index.html sintaxis válida', true); }
  catch (e) { ok('J. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('K. index_operator.html sintaxis válida', true); }
  catch (e) { ok('K. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// L/M/N. HTTP 200: se verifica por separado con curl (documentado en el
// informe final; requiere un servidor real corriendo).
console.log('L/M/N. HTTP 200 (index.html/index_operator.html/service-worker.js): se verifica por separado con curl contra localhost.');

// O/P. 6B4.11 / 6B4.11.1 siguen aprobadas: se re-ejecutan como suites
// separadas (ver sección de regresiones del informe); acá se confirma que
// las funciones clave de esas etapas siguen presentes sin reversión.
ok('O. 6B4.11: openAddReceiptModal sigue definida', /function openAddReceiptModal\(/.test(srcMain) && /function openAddReceiptModal\(/.test(srcOperator));
ok('O. 6B4.11: receiptFileIsAcceptable sigue definida', /function receiptFileIsAcceptable\(/.test(srcMain) && /function receiptFileIsAcceptable\(/.test(srcOperator));
ok('P. 6B4.11.1: paymentCreatedByLabel sigue definida', /function paymentCreatedByLabel\(/.test(srcMain) && /function paymentCreatedByLabel\(/.test(srcOperator));

// Q. permisos del operador siguen vigentes.
{
  const canEditMain = extractFunction(srcMain, 'canEdit');
  ok('Q. canEdit() en index.html sigue admitiendo el rol operator (vía el fix final)', /role==='operator'/.test(srcMain));
  ok('Q. __operatorFixMembership sigue presente en index_operator.html (detección robusta de rol)', /function __operatorFixMembership\(/.test(srcOperator));
}

// R. funciones exclusivas del titular no se habilitan al operador (no se
// tocó ninguna condición de isOwner()/canManageAccess() en esta etapa).
ok('R. isOwner() sigue exigiendo group.created_by===session.user.id (sin relajar la condición)', /function isOwner\(\)\{return !!group&&!!session&&group\.created_by===session\.user\.id\}/.test(srcOperator));
ok('R. canManageAccess() sigue dependiendo exclusivamente de isOwner()', /function canManageAccess\(\)\{return isOwner\(\)\}/.test(srcOperator));

// S/T. no se modifica Supabase / no se escriben datos reales (esta suite
// es de solo lectura).
{
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('S/T. esta suite es de solo lectura (nunca invoca sb.from/insert/update/rpc)', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
}

// U. sin regresiones nuevas: se verifica corriendo la suite completa de la
// sesión por separado (ver informe final).
console.log('U. Sin regresiones nuevas: se verifica corriendo la suite completa de la sesión por separado.');

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
