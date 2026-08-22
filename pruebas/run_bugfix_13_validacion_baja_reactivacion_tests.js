// ============================================================
// PRUEBA LOCAL — BUGFIX #13 FASE 2: validación robusta del UPDATE en
// dropService()/reactivateService() (20260821)
// ------------------------------------------------------------
// Motivo real (diagnóstico 6b16, caso real Argentina Virtual): el UPDATE
// anterior de services.active solo revisaba "error" -- si RLS bloqueaba
// la fila (USING/WITH CHECK no matchea), PostgREST responde éxito con 0
// filas afectadas y error=null, así que el código mostraba "Servicio
// dado de baja"/"Servicio reactivado" aunque en la base no hubiera
// cambiado nada. Se agregó .select('id,active') y se valida
// explícitamente: error==null, exactamente 1 fila, mismo id, mismo
// estado solicitado -- deliberadamente SIN .single()/.maybeSingle() (ver
// comentario real en el código: .single() confunde "0 filas" con "más de
// 1 fila" bajo el mismo código de error genérico PGRST116).
//
// Esta prueba ejecuta la función REAL applyServiceActiveUpdate() extraída
// de index.html/index_operator.html (nunca reimplementada a mano) contra
// un mock de "sb" en memoria que permite controlar exactamente qué
// devuelve el UPDATE (0/1/2 filas, fila que no coincide, error real) --
// nunca contra Supabase real. NO se ejecutó SQL, NO se modificó
// Supabase, NO se tocó el registro real de Argentina Virtual
// (service_id 209b9202-a858-4c31-ad22-f19b2e358463).
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

// ---------------- Sandbox de la función real ----------------

function buildRealSource(text) {
  return extract(text, 'function describeServiceUpdateError(err){', '\nasync function dropService(');
}

const REAL_SOURCE_INDEX = buildRealSource(indexText);
const REAL_SOURCE_OPERATOR = buildRealSource(operatorText);

// Mock mínimo de la cadena real .from('services').update({...}).eq('id',...).select('id,active')
// -- captura exactamente qué se pidió y devuelve la respuesta que el caso de prueba controla.
function buildFakeSb(response, calls) {
  return {
    from(table) {
      calls.table = table;
      return {
        update(payload) {
          calls.updatePayload = payload;
          return {
            eq(col, val) {
              calls.eqCol = col;
              calls.eqVal = val;
              return {
                select(cols) {
                  calls.selectCols = cols;
                  return Promise.resolve(response);
                }
              };
            }
          };
        }
      };
    }
  };
}

function buildSandbox(realSource, response) {
  const calls = {};
  const consoleErrors = [];
  const fakeConsole = { error: (...args) => consoleErrors.push(args) };
  const sb = buildFakeSb(response, calls);
  const fn = new Function('sb', 'console', realSource + '\nreturn {applyServiceActiveUpdate};');
  const { applyServiceActiveUpdate } = fn(sb, fakeConsole);
  return { applyServiceActiveUpdate, calls, consoleErrors };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

for (const [label, REAL_SOURCE] of [['index.html', REAL_SOURCE_INDEX], ['index_operator.html', REAL_SOURCE_OPERATOR]]) {

  caso(`[${label}] CASO 1 — baja usa UPDATE active=false: el payload real enviado al UPDATE es exactamente {active:false}`, async () => {
    const { applyServiceActiveUpdate, calls } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: false }], error: null });
    await applyServiceActiveUpdate('s-1', false);
    assert.deepStrictEqual(calls.updatePayload, { active: false });
    assert.strictEqual(calls.table, 'services');
    assert.strictEqual(calls.eqCol, 'id');
    assert.strictEqual(calls.eqVal, 's-1');
  });

  caso(`[${label}] CASO 2 — baja pide respuesta del UPDATE: se encadena .select('id,active'), nunca un UPDATE ciego sin retorno`, async () => {
    const { applyServiceActiveUpdate, calls } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: false }], error: null });
    await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(calls.selectCols, 'id,active');
  });

  caso(`[${label}] CASO 3 — baja exige EXACTAMENTE 1 fila: 1 fila coincidente -> ok:true`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: false }], error: null });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, true);
  });

  caso(`[${label}] CASO 4 — baja verifica MISMO serviceId: si la fila devuelta trae un id distinto (inconsistencia), no confirma éxito`, async () => {
    const { applyServiceActiveUpdate, consoleErrors } = buildSandbox(REAL_SOURCE, { data: [{ id: 'otro-id', active: false }], error: null });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, false);
    assert.ok(consoleErrors.length > 0, 'debe loguear la inconsistencia en consola');
  });

  caso(`[${label}] CASO 5 — baja verifica active=false: si la fila devuelta sigue con active=true (no se aplicó de verdad), no confirma éxito`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: true }], error: null });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, false);
  });

  caso(`[${label}] CASO 6 — 0 filas (ej. RLS bloqueó silenciosamente, caso real Argentina Virtual) NO muestra éxito`, async () => {
    const { applyServiceActiveUpdate, consoleErrors } = buildSandbox(REAL_SOURCE, { data: [], error: null });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, false);
    assert.ok(consoleErrors.some(args => JSON.stringify(args).includes('s-1')), 'debe loguear el serviceId real en el caso de 0 filas');
  });

  caso(`[${label}] CASO 7 — más de 1 fila (inconsistencia, aunque el filtro por id debería impedirlo) NO muestra éxito`, async () => {
    const { applyServiceActiveUpdate, consoleErrors } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: false }, { id: 's-1', active: false }], error: null });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, false);
    assert.ok(consoleErrors.some(args => JSON.stringify(args).includes('filasAfectadas')), 'debe loguear explícitamente que fueron más de una fila');
  });

  caso(`[${label}] CASO 8 — error real de Supabase (RLS/red/etc.) NO muestra éxito, y se preserva code/message/details/hint en consola (nunca solo un string fijo)`, async () => {
    const errorReal = { code: '42501', message: 'permission denied for table services', details: 'detalle real', hint: 'revisar policy' };
    const { applyServiceActiveUpdate, consoleErrors } = buildSandbox(REAL_SOURCE, { data: null, error: errorReal });
    const result = await applyServiceActiveUpdate('s-1', false);
    assert.strictEqual(result.ok, false);
    const logged = JSON.stringify(consoleErrors);
    assert.ok(logged.includes('42501') && logged.includes('permission denied') && logged.includes('detalle real') && logged.includes('revisar policy'), 'code/message/details/hint deben preservarse completos en consola');
  });

  caso(`[${label}] CASO 9 — éxito real (1 fila, mismo id, estado correcto): ok:true, listo para que el caller recién ahí haga closeModal/refreshDashboardData/toast de éxito`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [{ id: 'svc-real', active: false }], error: null });
    const result = await applyServiceActiveUpdate('svc-real', false);
    assert.strictEqual(result.ok, true);
  });

  caso(`[${label}] CASO 10 — reactivación usa UPDATE active=true`, async () => {
    const { applyServiceActiveUpdate, calls } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: true }], error: null });
    await applyServiceActiveUpdate('s-1', true);
    assert.deepStrictEqual(calls.updatePayload, { active: true });
  });

  caso(`[${label}] CASO 11 — reactivación exige exactamente 1 fila: 0 filas no confirma éxito`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [], error: null });
    const result = await applyServiceActiveUpdate('s-1', true);
    assert.strictEqual(result.ok, false);
  });

  caso(`[${label}] CASO 12 — reactivación verifica mismo serviceId`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [{ id: 'otro', active: true }], error: null });
    const result = await applyServiceActiveUpdate('s-1', true);
    assert.strictEqual(result.ok, false);
  });

  caso(`[${label}] CASO 13 — reactivación verifica active=true en la fila devuelta`, async () => {
    const { applyServiceActiveUpdate } = buildSandbox(REAL_SOURCE, { data: [{ id: 's-1', active: false }], error: null });
    const result = await applyServiceActiveUpdate('s-1', true);
    assert.strictEqual(result.ok, false, 'si la fila devuelta sigue en active=false, no debe confirmarse la reactivación');
  });
}

// ============================================================
// PARTE B — texto real del caller (dropService/reactivateService):
// mensaje genérico sin éxito, orden correcto, sin exponer info sensible
// en el toast.
// ============================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {

  caso(`[${label}] CASO 6b/7b/8b — si applyServiceActiveUpdate no confirma (ok:false), se muestra el mensaje genérico pedido y se corta ANTES de closeModal/refreshDashboardData/toast de éxito`, () => {
    const block = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(');
    assert.ok(block.includes("if(!result.ok)return toast('No se pudo confirmar el cambio del servicio.');"));
    const failIdx = block.indexOf("if(!result.ok)return toast(");
    const closeIdx = block.indexOf('closeModal();');
    assert.ok(failIdx !== -1 && closeIdx !== -1 && failIdx < closeIdx, 'la validación debe cortar la ejecución ANTES de closeModal/refresh/toast de éxito');
  });

  caso(`[${label}] CASO 9b — éxito real: recién después de result.ok se llama closeModal()/refreshDashboardData()/toast de éxito, en ese orden`, () => {
    const block = extract(text, 'async function dropService(serviceId){', '\nasync function reactivateService(');
    const okIdx = block.indexOf('if(!result.ok)return');
    const closeIdx = block.indexOf('closeModal();');
    const refreshIdx = block.indexOf('await refreshDashboardData();');
    const toastIdx = block.indexOf("toast('Servicio dado de baja');");
    assert.ok(okIdx < closeIdx && closeIdx < refreshIdx && refreshIdx < toastIdx);
  });

  caso(`[${label}] no se expone información sensible en el toast de fallo -- nunca error.code/details/hint directo en un toast, solo el mensaje genérico`, () => {
    const block = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(!/toast\(/.test(block), 'applyServiceActiveUpdate no debe mostrar toasts -- solo el caller, con el mensaje genérico');
  });

  caso(`[${label}] CASO 14 — no existe deleteService() ni ningún DELETE FROM services (mejora #10 sigue vigente sin cambios)`, () => {
    assert.ok(!text.includes('function deleteService('));
    assert.ok(!/from\('services'\)\.delete\(/.test(text));
  });

  caso(`[${label}] CASO 15 — historial no se toca: obligations/payments/documents/Storage no aparecen en ningún punto de applyServiceActiveUpdate/dropService/reactivateService`, () => {
    const block = extract(text, 'function describeServiceUpdateError(err){', '\nfunction openPaymentDetail(');
    assert.ok(!/from\('obligations'\)|from\('payments'\)|from\('documents'\)|storage\.from\(/.test(block));
  });

  caso(`[${label}] CASO 16/17 — RLS/permisos no se tocan desde el frontend: no hay ninguna referencia a policy/GRANT/REVOKE/can_manage_service/membership en el bloque nuevo`, () => {
    const block = extract(text, 'function describeServiceUpdateError(err){', '\nfunction openPaymentDetail(');
    assert.ok(!/policy|GRANT|REVOKE|can_manage_service|membership/i.test(block));
  });

  caso(`[${label}] CASO 18 — Argentina Virtual no está hardcodeada en ningún punto del código nuevo ni del resto del archivo`, () => {
    assert.ok(!text.includes('Argentina Virtual'));
    assert.ok(!text.includes('209b9202-a858-4c31-ad22-f19b2e358463'));
  });

  caso(`[${label}] CASO 19 — BUGFIX #12 intacto: effectivePeriodAmount y el modal de corrección histórica siguen presentes sin cambios`, () => {
    assert.ok(text.includes('effectivePeriodAmount'));
    assert.ok(text.includes('id="correctSamePeriodQuestion"'));
  });

  caso(`[${label}] decisión documentada de NO usar .single()/.maybeSingle(): el comentario real explica por qué (PGRST116 confunde 0 filas con más de 1)`, () => {
    const block = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(!block.includes('.single()') && !block.includes('.maybeSingle()'));
  });
}

caso('CASO 20 — Tarjetas intacta: renderCreditCardsModule/bindCreditCardsModule/roundMoney byte-idénticas al backup previo a esta FASE', () => {
  const backupDir = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_13_validacion_update_servicios_20260821_224500');
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix13validacion'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix13validacion']]) {
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

caso('paridad exacta index.html / index_operator.html: describeServiceUpdateError+applyServiceActiveUpdate+dropService+reactivateService byte-idénticos', () => {
  const blockIndex = extract(indexText, 'function describeServiceUpdateError(err){', '\nfunction openPaymentDetail(');
  const blockOperator = extract(operatorText, 'function describeServiceUpdateError(err){', '\nfunction openPaymentDetail(');
  assert.strictEqual(blockIndex, blockOperator);
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
  console.log('AVISO: valida lógica real extraída con un mock de sb en memoria, NO ejecución real contra Postgres/Supabase. NO se modificó Supabase, NO se tocó el servicio real Argentina Virtual.');
  if (fail > 0) process.exitCode = 1;
}

run();
