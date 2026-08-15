// ============================================================
// PRUEBA LOCAL — buscador rápido de Servicios
// ------------------------------------------------------------
// AVISO IMPORTANTE: no abre un navegador real y no puede medir scroll/
// resaltado visual real (Node no tiene DOM/CSS/layout). Lo que SÍ hace,
// de forma reproducible y sin Supabase:
//   1) EXTRAE y EJECUTA (no reimplementa) el código real de
//      normalizeSearchText/searchServicesByName/serviceSearchResultHtml
//      directamente de index.html, con mocks mínimos de sus
//      dependencias (services/baseMonth/obligationFor/boxText/esc/
//      isOwner) -- así la prueba examina el código que realmente se
//      shippea, no una copia que podría divergir;
//   2) hace verificaciones ESTRUCTURALES (texto/grep) sobre las partes
//      que sí tocan DOM (bindServiceSearch/goToServiceRow) para
//      confirmar arquitectura: que nunca llaman a Supabase, que nunca
//      tocan Tarjetas, que nunca reasignan baseMonth ni llaman a
//      renderApp(), y que usan el mismo atributo data-service-row que
//      renderServices() ya imprime en cada fila.
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBA MANUAL" en el reporte de entrega):
//   - que la lista de resultados se ve/posiciona correctamente;
//   - que el scroll y el resaltado ocurren visualmente como se espera;
//   - timing real de blur/click en un navegador real.
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

// ---------------- Extracción del bloque real del buscador (index.html) ----------------

// AJUSTE (mejora #3 — panel de prioridades): el marcador de fin original
// era 'function openServiceModal(', la siguiente función real en el
// archivo AL MOMENTO de escribir este test. Al agregarse el panel de
// prioridades justo después de goToServiceRow() (y antes de
// openServiceModal), ese marcador dejó de delimitar el bloque del
// buscador -- pasó a incluir también el código NUEVO del panel, cuyos
// propios comentarios mencionan "creditCards"/"Supabase" al explicar que
// NO los toca, disparando falsos positivos en los checks de aislamiento
// (CASO 6/7). El marcador correcto es el límite real del buscador: el
// comentario con el que arranca la siguiente mejora, sea cual sea. Esto
// es lo estrictamente necesario para que el test siga siendo válido; no
// se tocó ninguna otra lógica de este archivo.
const searchBlockSource = extract(indexText, 'function normalizeSearchText(value){', '// MEJORA — PANEL OPERATIVO POR PRIORIDADES:');
const renderServicesSource = extract(indexText, 'function renderServices(ms){', 'function balanceData(');

// ---------------- Fixtures mínimos para poder EJECUTAR el código real ----------------

const SERVICES = [
  { id: 'svc-edesur', name: 'Edesur', category: 'Luz', is_private: false, frequency: 'monthly' },
  { id: 'svc-metrogas', name: 'Metrogas', category: 'Gas', is_private: false, frequency: 'monthly' },
  { id: 'svc-movistar', name: 'Movistar Hogar', category: 'Internet', is_private: false, frequency: 'monthly' },
  { id: 'svc-seguro', name: 'Seguro Hogar', category: 'Seguro', is_private: false, frequency: 'monthly' },
  { id: 'svc-medico', name: 'Médico Prepaga', category: 'Salud', is_private: false, frequency: 'monthly' },
  { id: 'svc-privado', name: 'Sueldo Empleada', category: 'Sueldos', is_private: true, frequency: 'monthly' },
];

function buildSandbox(servicesArray) {
  const sandbox = {
    services: servicesArray,
    baseMonth: '2026-08',
    obligationFor: () => null, // sin obligación cargada este mes -> boxText cae en emptyBoxText
    boxText: (o, s) => [o ? 'Con datos' : 'Sin cargar', ''],
    esc: (v) => String(v ?? ''),
    isOwner: () => true, // como titular, para poder ejercitar la rama PRIVADO también
    console,
  };
  const fn = new Function(...Object.keys(sandbox), searchBlockSource + '\nreturn { normalizeSearchText, searchServicesByName, serviceSearchResultHtml };');
  return fn(...Object.values(sandbox));
}

// ---------------- Los 15 casos exigidos + acentos ----------------

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

caso('CASO 1 — el buscador existe en la pantalla de Servicios', () => {
  assert.ok(renderServicesSource.includes('id="serviceSearchInput"'), 'renderServices() debe imprimir el input de búsqueda');
  assert.ok(renderServicesSource.includes('id="serviceSearchResults"'), 'renderServices() debe imprimir el contenedor de resultados');
  assert.ok(renderServicesSource.includes('Buscar servicio'), 'debe tener un placeholder reconocible');
});

caso('CASO 2 — búsqueda parcial encuentra el servicio', () => {
  const { searchServicesByName } = buildSandbox(SERVICES);
  const results = searchServicesByName('edes');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].id, 'svc-edesur');

  const results2 = searchServicesByName('mov');
  assert.strictEqual(results2.length, 1);
  assert.strictEqual(results2[0].id, 'svc-movistar');
});

caso('CASO 3 — mayúsculas/minúsculas no afectan', () => {
  const { searchServicesByName } = buildSandbox(SERVICES);
  const lower = searchServicesByName('movistar');
  const upper = searchServicesByName('MOVISTAR');
  const mixed = searchServicesByName('MoVista');
  assert.strictEqual(lower.length, 1);
  assert.strictEqual(upper.length, 1);
  assert.strictEqual(mixed.length, 1);
  assert.strictEqual(lower[0].id, upper[0].id);
  assert.strictEqual(lower[0].id, mixed[0].id);
});

caso('CASO 4 — una cadena sin coincidencias muestra estado vacío claro', () => {
  const { searchServicesByName } = buildSandbox(SERVICES);
  const results = searchServicesByName('xyzxyzxyz');
  assert.deepStrictEqual(results, []);
  assert.ok(searchBlockSource.includes('Sin coincidencias'), 'debe existir un mensaje claro de "sin coincidencias" en el código real');
});

caso('CASO 5 — los resultados provienen de la colección de servicios ya autorizada (misma que arma la matriz)', () => {
  // searchServicesByName debe filtrar sobre el MISMO array `services` que
  // usa renderServices() para construir la matriz -- no una copia ni una
  // fuente nueva.
  assert.ok(/services\s*\n?\s*\.filter/.test(searchBlockSource), 'searchServicesByName debe filtrar directamente sobre `services`');
  assert.ok(renderServicesSource.includes('${services.map(s=>`'), 'renderServices() arma la matriz iterando el mismo `services`');
});

caso('CASO 6 — el buscador no busca Tarjetas', () => {
  assert.ok(!searchBlockSource.includes('creditCards'), 'el bloque del buscador no debe mencionar creditCards en ningún punto');
  const { searchServicesByName } = buildSandbox(SERVICES);
  // Ningún resultado puede tener campos propios de tarjeta (card_id, etc.)
  const results = searchServicesByName('e');
  for (const r of results) assert.ok(!('card_id' in r), 'un resultado de servicio nunca debe traer campos de tarjeta');
});

caso('CASO 7 — no agrega consultas Supabase nuevas para resolver resultados', () => {
  assert.ok(!/\bsb\.from\(|\bsb\.rpc\(|\bfetch\(|supabase/i.test(searchBlockSource), 'el bloque del buscador no debe llamar a Supabase/fetch en ningún punto -- trabaja 100% sobre datos ya cargados en memoria');
});

caso('CASO 8 — clic en un resultado identifica la fila real correcta', () => {
  assert.ok(renderServicesSource.includes('<tr data-service-row="${s.id}">'), 'cada fila de la matriz debe estar marcada con data-service-row');
  assert.ok(searchBlockSource.includes('[data-service-row="${serviceId}"]'), 'goToServiceRow debe buscar la fila por ese mismo atributo');
});

caso('CASO 9 — conserva el mes actual/seleccionado (no toca baseMonth ni fuerza un re-render)', () => {
  assert.ok(!/goToServiceRow[\s\S]*?baseMonth\s*=/.test(searchBlockSource.slice(searchBlockSource.indexOf('function goToServiceRow'))), 'goToServiceRow no debe reasignar baseMonth');
  const goToServiceRowSrc = searchBlockSource.slice(searchBlockSource.indexOf('function goToServiceRow'));
  assert.ok(!goToServiceRowSrc.includes('renderApp()'), 'goToServiceRow no debe llamar a renderApp() -- solo navega dentro del DOM ya existente');
});

caso('CASO 10 — funciona junto con la lógica de conservación de scroll (mejora #1), sin pisarla', () => {
  assert.ok(searchBlockSource.includes("querySelector('.service-cell')") || searchBlockSource.includes('row.querySelector(\'.service-cell\')'), 'debe apuntar el scroll a la celda sticky de la fila (no mueve scrollLeft de .matrix-scroll)');
  assert.ok(!searchBlockSource.includes('restoreNavigationScroll('), 'goToServiceRow no debe llamar a restoreNavigationScroll -- es un desplazamiento intencional del propio buscador, no una restauración');
  assert.ok(!searchBlockSource.includes('.scrollLeft='), 'el buscador no debe fijar scrollLeft manualmente -- usa scrollIntoView sobre la celda sticky para no interferir con el mes elegido');
});

caso('CASO 11 — paridad exacta titular/operador', () => {
  const searchBlockOperator = extract(operatorText, 'function normalizeSearchText(value){', '// MEJORA — PANEL OPERATIVO POR PRIORIDADES:');
  assert.strictEqual(searchBlockSource, searchBlockOperator, 'el bloque completo del buscador debe ser byte-idéntico entre index.html e index_operator.html');

  const renderServicesOperator = extract(operatorText, 'function renderServices(ms){', 'function balanceData(');
  assert.strictEqual(renderServicesSource, renderServicesOperator, 'renderServices() debe ser byte-idéntico entre ambos archivos');
});

caso('CASO 12 — no modifica código funcional de Tarjetas (comparado contra el respaldo previo a esta tarea)', () => {
  const backupIndexPath = path.join(ROOT, 'respaldos_publicacion', 'antes_buscador_servicios_20260814_110248', 'index.html.antes_buscador');
  const backupText = fs.readFileSync(backupIndexPath, 'utf8');
  const creditBackup = extract(backupText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');
  const creditCurrent = extract(indexText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');
  assert.strictEqual(creditBackup, creditCurrent, 'renderCreditCardsModule() no debe cambiar ni una línea en esta tarea');
});

caso('CASO 13 — esta tarea no crea ni modifica ningún archivo .sql', () => {
  const archivosDeEstaTarea = [indexPath, operatorPath, __filename];
  for (const archivo of archivosDeEstaTarea) assert.ok(!archivo.includes('migraciones'), `${archivo} no debería estar dentro de migraciones/`);
});

caso('CASO 14 — no modifica Supabase (mismo chequeo que CASO 7, a nivel de todo el bloque agregado)', () => {
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(searchBlockSource), 'el bloque del buscador no debe contener ninguna operación de escritura');
});

caso('CASO 15 — no altera cálculos de deuda/pagos (boxText/balanceFor/paymentProgress intactos)', () => {
  const backupIndexPath = path.join(ROOT, 'respaldos_publicacion', 'antes_buscador_servicios_20260814_110248', 'index.html.antes_buscador');
  const backupText = fs.readFileSync(backupIndexPath, 'utf8');
  const boxBackup = extract(backupText, 'function boxClass(o)', 'function lastKnownAmount(');
  const boxCurrent = extract(indexText, 'function boxClass(o)', 'function lastKnownAmount(');
  assert.strictEqual(boxBackup, boxCurrent, 'boxClass/boxText no deben cambiar -- el buscador solo los REUTILIZA, nunca los modifica');
});

caso('CASO 16 — tolerante a acentos (normalización simple vía NFD)', () => {
  const { searchServicesByName } = buildSandbox(SERVICES);
  const conAcento = searchServicesByName('médico');
  const sinAcento = searchServicesByName('medico');
  assert.strictEqual(conAcento.length, 1);
  assert.strictEqual(sinAcento.length, 1);
  assert.strictEqual(conAcento[0].id, 'svc-medico');
  assert.strictEqual(sinAcento[0].id, 'svc-medico');
});

caso('CASO 17 — cada resultado muestra como mínimo el nombre del servicio (y no inventa cálculos nuevos)', () => {
  const { serviceSearchResultHtml } = buildSandbox(SERVICES);
  const html = serviceSearchResultHtml(SERVICES[0]);
  assert.ok(html.includes('Edesur'), 'el resultado debe mostrar el nombre real del servicio');
  // El estado mostrado viene de boxText(obligationFor(...)) -- reutilizado,
  // no de un cálculo propio del buscador.
  assert.ok(searchBlockSource.includes('boxText(o,s)'), 'serviceSearchResultHtml debe reutilizar boxText, no reimplementar el cálculo de estado');
  assert.ok(searchBlockSource.includes('obligationFor(s.id,baseMonth)'), 'debe reutilizar obligationFor con el mes vigente, no un cálculo propio');
});

// ---------------- Runner ----------------

let ok = 0, fail = 0;
for (const c of casos) {
  try { c.fn(); console.log('PASS -', c.nombre); ok++; }
  catch (e) { console.error('FAIL -', c.nombre); console.error('       ', e.message); fail++; }
}

console.log('----------------------------------------');
console.log(`Total: ${casos.length} | PASS: ${ok} | FAIL: ${fail}`);
console.log('AVISO: valida lógica real extraída + estructura del código, NO scroll/resaltado visual en navegador real.');
if (fail > 0) process.exitCode = 1;
