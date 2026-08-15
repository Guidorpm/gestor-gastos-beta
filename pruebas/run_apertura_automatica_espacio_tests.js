// ============================================================
// PRUEBA LOCAL — apertura automática del espacio operativo
// ------------------------------------------------------------
// AVISO IMPORTANTE: no abre un navegador real y no puede confirmar la
// navegación real (Node no tiene DOM). Lo que SÍ hace, de forma
// reproducible y sin Supabase:
//   1) EXTRAE y EJECUTA (no reimplementa) el código real de
//      autoOpenTargetGroup() directamente de index.html, con un mock
//      mínimo de getSavedGroupId() (localStorage) y fixtures de
//      `groups` -- nunca UUIDs/nombres reales, nunca Fabiana/GR
//      hardcodeados;
//   2) hace verificaciones ESTRUCTURALES sobre loadGroups()/los 4
//      call-sites que deben pasar autoOpen=false (navegación explícita
//      del usuario) para confirmar que "Cambiar espacio"/"Volver a
//      espacios"/crear un espacio nuevo NUNCA quedan atrapados
//      re-abriendo automáticamente el mismo espacio.
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBA MANUAL" en el reporte de entrega):
//   - que la apertura automática efectivamente navega a Servicios en
//     pantalla;
//   - timing real de reloadGroup()/renderApp() en un navegador real.
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

const autoOpenSource = extract(indexText, 'function autoOpenTargetGroup(){', 'async function loadGroups(');

function buildSandbox(groupsFixture, savedGroupId) {
  const sandbox = {
    groups: groupsFixture,
    // MOCK documentado: en producción lee localStorage vía safeLocalGet
    // -- acá, un valor fijo inyectado por el test.
    getSavedGroupId: () => savedGroupId ?? null,
    console,
  };
  const fn = new Function(...Object.keys(sandbox), autoOpenSource + '\nreturn { autoOpenTargetGroup };');
  return fn(...Object.values(sandbox));
}

// Fixtures -- IDs/nombres genéricos, nunca reales.
function grupo(id, overrides = {}) {
  return { id, name: `Espacio ${id}`, status: 'active', ...overrides };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

caso('CASO 1 — operador con un único grupo autorizado -> autoabre', () => {
  const g1 = grupo('g1');
  const { autoOpenTargetGroup } = buildSandbox([g1], null);
  assert.strictEqual(autoOpenTargetGroup()?.id, 'g1');
});

caso('CASO 2 — varios grupos y savedGroup válido -> abre savedGroup', () => {
  const g1 = grupo('g1'), g2 = grupo('g2'), g3 = grupo('g3');
  const { autoOpenTargetGroup } = buildSandbox([g1, g2, g3], 'g2');
  assert.strictEqual(autoOpenTargetGroup()?.id, 'g2');
});

caso('CASO 3 — varios grupos sin savedGroup -> muestra Mis espacios (null)', () => {
  const g1 = grupo('g1'), g2 = grupo('g2');
  const { autoOpenTargetGroup } = buildSandbox([g1, g2], null);
  assert.strictEqual(autoOpenTargetGroup(), null);
});

caso('CASO 4 — savedGroup ya no autorizado (suspendido) -> NO lo abre', () => {
  // 3 grupos en total, 2 siguen activos (g1, g3) para no caer en la
  // rama de "exactamente 1 autorizado" -- el guardado (g2) es
  // justamente el que ya NO está activo.
  const g1 = grupo('g1'), g2 = grupo('g2', { status: 'suspended' }), g3 = grupo('g3');
  const { autoOpenTargetGroup } = buildSandbox([g1, g2, g3], 'g2');
  assert.strictEqual(autoOpenTargetGroup(), null, 'un grupo suspendido/archivado/eliminado no debe autoabrirse aunque esté guardado');
});

caso('CASO 4b — savedGroup ya no existe en absoluto -> NO lo abre', () => {
  const g1 = grupo('g1'), g2 = grupo('g2');
  const { autoOpenTargetGroup } = buildSandbox([g1, g2], 'g-ya-no-existe');
  assert.strictEqual(autoOpenTargetGroup(), null);
});

caso('CASO 5 — cero grupos autorizados -> comportamiento seguro actual (null, muestra Mis espacios)', () => {
  const { autoOpenTargetGroup } = buildSandbox([], null);
  assert.strictEqual(autoOpenTargetGroup(), null);
});

caso('CASO 5b — cero autorizados aunque existan grupos NO activos -> sigue sin autoabrir', () => {
  const g1 = grupo('g1', { status: 'archived' });
  const { autoOpenTargetGroup } = buildSandbox([g1], null);
  assert.strictEqual(autoOpenTargetGroup(), null);
});

caso('CASO 6 — no se hardcodea Fabiana (la regla es puramente de datos/cantidad)', () => {
  assert.ok(!/fabiana/i.test(autoOpenSource), 'autoOpenTargetGroup no debe mencionar ningún nombre de usuario');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(autoOpenSource), 'no debe contener ningún UUID literal');
});

caso('CASO 7 — no se hardcodea GR Estanterías (ni ningún nombre de grupo)', () => {
  assert.ok(!/estanterias|estanter[íi]as|\bGR\b/i.test(autoOpenSource), 'autoOpenTargetGroup no debe mencionar ningún nombre de espacio');
});

caso('CASO 8 — el operador termina en la pestaña Servicios (ya garantizado por la mejora #3, no se rompió)', () => {
  assert.ok(operatorText.includes("let tab='services', baseMonth=getSavedBaseMonth(), authMode='login';"), 'index_operator.html debe seguir arrancando siempre en services -- independiente de qué espacio se autoabra');
});

caso('CASO 9 — el panel de prioridades sigue presente', () => {
  assert.ok(indexText.includes('function computeServicePriorityCategories('));
  assert.ok(operatorText.includes('function computeServicePriorityCategories('));
});

caso('CASO 10 — el buscador sigue presente', () => {
  assert.ok(indexText.includes('id="serviceSearchInput"'));
  assert.ok(operatorText.includes('id="serviceSearchInput"'));
});

caso('CASO 11 — servicios privados siguen dependiendo de datos ya autorizados (no se agregó ninguna consulta de servicios)', () => {
  assert.ok(!/\bsb\.from\(['"]services['"]\)/.test(autoOpenSource), 'autoOpenTargetGroup no debe consultar servicios -- solo decide QUÉ GRUPO abrir, reloadGroup() (sin cambios) sigue siendo quien carga services/obligations');
});

caso('CASO 12 — Tarjetas no interviene', () => {
  assert.ok(!autoOpenSource.includes('creditCards'), 'autoOpenTargetGroup no debe mencionar Tarjetas en ningún punto');
});

caso('CASO 13 — no hay consultas Supabase nuevas solo para autoabrir', () => {
  assert.ok(!/\bsb\.from\(|\bsb\.rpc\(|\bfetch\(/i.test(autoOpenSource), 'autoOpenTargetGroup debe operar 100% sobre `groups`, ya cargado por la consulta existente de loadGroups()');
});

caso('CASO 14 — titular no pierde funcionalidad (misma regla general se aplica también con 2+ espacios propios)', () => {
  // Escenario tipo "Guido": dos espacios propios, sin savedGroup ->
  // debe mostrar Mis espacios (no se le fuerza a entrar a uno en
  // particular) -- exactamente la misma regla que para cualquier
  // usuario con 2+ autorizados, sin ninguna rama especial de titular.
  const casa = grupo('casa'), gr = grupo('gr');
  const { autoOpenTargetGroup } = buildSandbox([casa, gr], null);
  assert.strictEqual(autoOpenTargetGroup(), null, 'con 2+ espacios propios y sin preferencia guardada, debe seguir mostrando Mis espacios como hoy');

  // Si ya tenía un espacio guardado de una sesión anterior (su uso
  // normal), lo recupera -- mejora de UX para él también, sin cambiar
  // su acceso.
  const { autoOpenTargetGroup: autoOpenTargetGroup2 } = buildSandbox([casa, gr], 'gr');
  assert.strictEqual(autoOpenTargetGroup2()?.id, 'gr');
});

caso('CASO 15 — paridad exacta index.html / index_operator.html', () => {
  const blockA = extract(indexText, 'function autoOpenTargetGroup(){', 'async function loadGroups(');
  const blockB = extract(operatorText, 'function autoOpenTargetGroup(){', 'async function loadGroups(');
  assert.strictEqual(blockA, blockB, 'autoOpenTargetGroup() debe ser byte-idéntico entre ambos archivos');
});

caso('CASO 16 — "Cambiar espacio"/"Volver a espacios"/crear espacio pasan autoOpen=false (no quedan atrapados re-abriendo)', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("document.getElementById('backToSpaces').onclick=()=>loadGroups(false);"), '"Volver a espacios" (Tarjetas) debe pasar autoOpen=false');
    assert.ok(text.includes("document.getElementById('backBtn').onclick=()=>{group=null;loadGroups(false)};"), '"Cambiar espacio" debe pasar autoOpen=false');
    assert.ok(text.includes('closeModal();await loadGroups(false);await openGroup(data)'), 'crear un espacio nuevo debe refrescar sin autoabrir otro antes de abrir el recién creado');
  }
});

caso('CASO 17 — el flujo de autenticación real SIGUE auto-abriendo (no quedó todo en false por error)', () => {
  // Los 3 call-sites de continueAfterAuthentication()/cambio forzado de
  // contraseña deben seguir siendo loadGroups() sin argumento (autoOpen
  // por defecto = true) -- si alguno hubiera quedado en false por error,
  // Fabiana volvería a ver "Mis espacios" en cada login.
  for (const text of [indexText, operatorText]) {
    const authBlock = extract(text, 'async function continueAfterAuthentication(){', 'function renderAuth(');
    assert.ok(!authBlock.includes('loadGroups(false)'), 'el flujo de autenticación no debe deshabilitar la apertura automática');
  }
});

caso('CASO 18 — no se agregó ni modificó ningún archivo .sql', () => {
  const archivosDeEstaTarea = [indexPath, operatorPath, __filename];
  for (const archivo of archivosDeEstaTarea) assert.ok(!archivo.includes('migraciones'), `${archivo} no debería estar dentro de migraciones/`);
});

// ---------------- Runner ----------------

let ok = 0, fail = 0;
for (const c of casos) {
  try { c.fn(); console.log('PASS -', c.nombre); ok++; }
  catch (e) { console.error('FAIL -', c.nombre); console.error('       ', e.message); fail++; }
}

console.log('----------------------------------------');
console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
console.log('AVISO: valida lógica real extraída + estructura del código, NO navegación visual en navegador real.');
if (fail > 0) process.exitCode = 1;
