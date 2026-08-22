// ============================================================
// DIAGNÓSTICO ESTÁTICO — BUGFIX #13 FASE 1: "Argentina Virtual no
// permite Dar de baja" (20260821)
// ------------------------------------------------------------
// Esta prueba NO ejecuta nada contra Supabase real (no hay acceso de
// ejecución en esta sesión). Originalmente (FASE 1) auditaba el TEXTO
// REAL de dropService()/reactivateService() para documentar, sin
// corregir todavía, la hipótesis principal: el UPDATE no usaba
// .select() ni revisaba cuántas filas afectó -- si RLS bloqueaba la
// fila, PostgREST respondía éxito con 0 filas modificadas, sin ningún
// error, y el frontend mostraba "Servicio dado de baja" aunque nada
// hubiera cambiado.
//
// ACTUALIZADO (BUGFIX #13 FASE 2, 20260821): esa hipótesis se confirmó
// con el diagnóstico real 6b16 (caso real Argentina Virtual) y SE
// CORRIGIÓ -- ver pruebas/run_bugfix_13_validacion_baja_reactivacion_tests.js
// para la cobertura completa de la corrección. Los casos de acá abajo se
// actualizaron para verificar que la corrección real siga en pie
// (ya no documentan el bug viejo como "hallazgo pendiente").
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

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {

  caso(`[${label}] dropService(serviceId) existe y sigue siendo async function`, () => {
    assert.ok(text.includes('async function dropService(serviceId){'));
  });

  caso(`[${label}] dropService pide targetActive=false a applyServiceActiveUpdate, que hace el UPDATE real filtrando por .eq('id',serviceId) -- mismo serviceId recibido como parámetro, sin lookup por nombre`, () => {
    const dropBlock = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(');
    assert.ok(dropBlock.includes('applyServiceActiveUpdate(serviceId,false)'));
    const updateBlock = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(updateBlock.includes(".from('services')") && updateBlock.includes('.update({active:targetActive})') && updateBlock.includes(".eq('id',serviceId)"));
  });

  caso(`[${label}] CORREGIDO (FASE 2): el UPDATE ahora usa .select('id,active') y valida explícitamente la fila devuelta (0 filas / >1 fila / id o estado que no coincide ya NO se interpretan como éxito)`, () => {
    const block = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(block.includes(".select('id,active')"), 'debe pedir explícitamente la fila afectada');
    assert.ok(block.includes('rows.length===0'), 'debe rechazar 0 filas afectadas');
    assert.ok(block.includes('rows.length>1'), 'debe rechazar más de 1 fila afectada');
    assert.ok(block.includes('row.id!==serviceId||row.active!==targetActive'), 'debe validar que la fila devuelta coincida en id y estado');
  });

  caso(`[${label}] mismo patrón corregido en reactivateService -- consistente, no es un caso aislado de dropService`, () => {
    const block = extract(text, 'async function reactivateService(serviceId){', '\nfunction openPaymentDetail(');
    assert.ok(block.includes('applyServiceActiveUpdate(serviceId,true)'));
  });

  caso(`[${label}] manejo de error actual: console.error preserva code/message/details/hint completos, el toast de error real sigue mostrando solo error.message (sin exponer code/details/hint), y el caso "0 filas"/">1 fila" muestra el mensaje genérico pedido`, () => {
    const dropBlock = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(');
    assert.ok(dropBlock.includes("console.error('Error dando de baja el servicio:',describeServiceUpdateError(err));"), 'el objeto completo de error (code/message/details/hint) SÍ se loguea en consola');
    assert.ok(dropBlock.includes("toast(err?.message||'No se pudo dar de baja el servicio');"));
    assert.ok(dropBlock.includes("if(!result.ok)return toast('No se pudo confirmar el cambio del servicio.');"), 'el caso de UPDATE no confirmado debe mostrar el mensaje genérico, no un detalle técnico');
  });

  caso(`[${label}] no existe deleteService() ni ningún DELETE FROM services -- mejora #10 (baja no destructiva) sigue vigente sin cambios`, () => {
    assert.ok(!text.includes('function deleteService('));
    assert.ok(!/from\('services'\)\.delete\(/.test(text));
  });

  caso(`[${label}] no hay ningún tratamiento especial hardcodeado para "Argentina Virtual" (ni por nombre ni por id) -- descarta un handler especial por servicio`, () => {
    assert.ok(!text.includes('Argentina Virtual'));
  });

  caso(`[${label}] active se compara siempre con igualdad estricta (===false/===true/!==false) en todos los renderers -- descarta coerción de string/null como causa de inconsistencia visual`, () => {
    const occurrences = (text.match(/\.active\s*={2,3}\s*(false|true)/g) || []).length;
    assert.ok(occurrences > 5, `se esperaban múltiples comparaciones estrictas de .active, encontradas: ${occurrences}`);
    assert.ok(!/\.active\s*\?\s*/.test(extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(')));
  });

  caso(`[${label}] el botón "Dar de baja" solo se ofrece cuando canEdit() es true (rol admin/operator en el espacio abierto) -- no depende de is_private del servicio`, () => {
    const block = extract(text, 'function openFolder(serviceId){', "const dropBtn=document.getElementById('dropServiceBtn');");
    assert.ok(block.includes("${canEdit()?`"), 'los botones de baja/reactivación siguen condicionados a canEdit()');
  });

  caso(`[${label}] serviceId llega a dropService/reactivateService por closure desde el mismo "s.id"/"serviceId" con el que se abrió la carpeta (openFolder), nunca por búsqueda de nombre`, () => {
    const wiring = extract(text, "const dropBtn=document.getElementById('dropServiceBtn');", '// MEJORA #10');
    assert.ok(wiring.includes('dropService(serviceId)'));
    assert.ok(wiring.includes('reactivateService(serviceId)'));
  });
}

caso('paridad exacta index.html / index_operator.html: dropService+reactivateService son byte-idénticas entre titular y operador', () => {
  const blockIndex = extract(indexText, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(');
  const blockOperator = extract(operatorText, 'async function dropService(serviceId){', '\nfunction openPaymentDetail(');
  assert.strictEqual(blockIndex, blockOperator);
});

caso('preservación BUGFIX #12: effectivePeriodAmount/openCorrectHistoricalPaymentModal siguen presentes sin cambios (este diagnóstico no tocó nada de #12)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('effectivePeriodAmount'));
    assert.ok(text.includes('id="correctSamePeriodQuestion"'));
  }
});

caso('Tarjetas intacta: renderCreditCardsModule/bindCreditCardsModule/roundMoney byte-idénticas al backup previo a este diagnóstico', () => {
  const ROOT2 = path.join(__dirname, '..');
  const backupDir = path.join(ROOT2, 'respaldos_publicacion', 'antes_bugfix_13_diagnostico_argentina_virtual_20260821_223000');
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix13diag'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix13diag']]) {
    const before = fs.readFileSync(path.join(backupDir, suffix), 'utf8');
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(text, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
});

caso('el diagnóstico 6b16 existe, es un único archivo nuevo, y es 100% de solo lectura (todo statement top-level empieza con SELECT/WITH, sin INSERT/UPDATE/DELETE/UPSERT/CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE/DO/EXECUTE/CALL fuera de literales de texto)', () => {
  const sqlPath = path.join(ROOT, 'migraciones', '6b16_DIAGNOSTICO_ARGENTINA_VIRTUAL_BAJA_SOLO_LECTURA_20260821.sql');
  assert.ok(fs.existsSync(sqlPath), 'debe existir el archivo de diagnóstico 6b16');
  let sql = fs.readFileSync(sqlPath, 'utf8');
  sql = sql.replace(/--[^\n]*/g, '');
  sql = sql.replace(/'(?:[^']|'')*'/g, "''");
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  assert.ok(statements.length > 0, 'debe haber al menos un statement');
  const forbidden = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO\s|EXECUTE|CALL)\b/i;
  for (const stmt of statements) {
    const kw = (stmt.match(/^\(?\s*(\w+)/) || [, ''])[1].toUpperCase();
    assert.ok(kw === 'SELECT' || kw === 'WITH', `todo statement debe empezar con SELECT/WITH, encontrado: "${kw}" en: ${stmt.slice(0, 80)}`);
    assert.ok(!forbidden.test(stmt), `no debe haber palabras clave de escritura fuera de literales: ${stmt.slice(0, 80)}`);
  }
});

caso('el diagnóstico 6b16 usa el obligation_id histórico solo como pista (no como service_id hardcodeado en ningún UPDATE/lógica de decisión)', () => {
  const sqlPath = path.join(ROOT, 'migraciones', '6b16_DIAGNOSTICO_ARGENTINA_VIRTUAL_BAJA_SOLO_LECTURA_20260821.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('535ca587-80ef-4415-b3bd-5b83cb727c67'), 'debe usar el obligation_id histórico como punto de partida');
  assert.ok(!/UPDATE\s+public\.services/i.test(sql.replace(/--[^\n]*/g, '')), 'no debe existir ningún UPDATE real sobre services');
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
  console.log('AVISO: diagnóstico estático únicamente. NO se ejecutó SQL, NO se modificó Supabase, NO se modificaron datos reales.');
  if (fail > 0) process.exitCode = 1;
}

run();
