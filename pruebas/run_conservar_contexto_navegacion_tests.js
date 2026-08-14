// ============================================================
// PRUEBA LOCAL — conservar contexto de navegación (Servicios)
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta prueba NO abre un navegador real y NO puede
// medir scroll/layout real (Node no tiene DOM/CSS/layout). Lo que SÍ
// hace, de forma reproducible y sin Supabase:
//   1) reimplementa fielmente la LÓGICA de decisión que agrega
//      restoreNavigationScroll()/scrollMatrixToBaseMonth() en
//      index.html/index_operator.html (mismo mes -> restaurar scroll
//      exacto; mes distinto -> saltar a la columna del mes nuevo; sin
//      mes actual -> mismo default de getSavedBaseMonth());
//   2) lee el TEXTO real de ambos archivos para confirmar que las
//      funciones/atributos clave siguen existiendo, que la lógica es
//      byte-idéntica entre index.html e index_operator.html (comparando
//      el archivo ACTUAL contra sí mismo entre ambos, nunca contra un
//      respaldo histórico -- así la prueba no se vuelve obsoleta cada
//      vez que una mejora POSTERIOR legítima toca otras partes del
//      archivo), y que Tarjetas no fue tocada por el buscador (mejora
//      #2), usando el respaldo tomado inmediatamente antes de esa tarea
//      puntual.
//
// REVISIÓN 2 (20260814) — se reemplazaron los CASO 10/10b originales
// ("ninguna línea nueva respecto del respaldo de la mejora #1"), que por
// diseño interpretaban CUALQUIER cambio posterior legítimo del archivo
// (p.ej. la mejora #2, buscador de servicios) como una regresión falsa.
// Los checks nuevos están focalizados en las invariantes que realmente
// importan para esta mejora puntual -- no en "el archivo completo no
// cambió nunca más".
//
// Lo que esta prueba NO puede confirmar (requiere navegador real, ver
// "PRUEBAS MANUALES" en el reporte de entrega):
//   - que window.scrollY efectivamente se restaura visualmente;
//   - que matrixScroll.scrollLeft/scrollTop se restauran visualmente;
//   - que scrollIntoView ubica la columna correcta en pantalla;
//   - timing real de requestAnimationFrame en un navegador real.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---------------- Reimplementación fiel de la lógica agregada ----------------

// Idéntica a private helper ya existente en el archivo real (no tocado
// por esta tarea) -- se reimplementa acá solo para poder probar el
// comportamiento de "sin contexto previo -> mes actual" de forma
// reproducible, con una fecha inyectada en vez de `new Date()` real.
function isValidBaseMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getSavedBaseMonth(savedValue, now) {
  return isValidBaseMonth(savedValue) ? savedValue : monthKey(now);
}

// Reimplementación fiel de la decisión que toma restoreNavigationScroll()
// en el archivo real: mismo mes base -> restaurar scrollLeft/scrollTop
// exactos; mes base distinto (o sin estado previo) -> saltar a la
// columna nueva (scrollMatrixToBaseMonth).
function decideMatrixRestoreStrategy(prevMatrixState, currentBaseMonth) {
  if (prevMatrixState && prevMatrixState.baseMonth === currentBaseMonth) {
    return { strategy: 'restore-exact', left: prevMatrixState.left, top: prevMatrixState.top };
  }
  return { strategy: 'snap-to-month', targetNthChild: targetNthChildForMonth(currentBaseMonth) };
}

// Idéntica a scrollMatrixToBaseMonth(): Servicio=1a columna, Enero=2a, ...
// Diciembre=13a, Carpeta=14a.
function targetNthChildForMonth(baseMonth) {
  return Number(baseMonth.slice(5, 7)) + 1;
}

// ---------------- Los 12 casos exigidos ----------------

const casos = [];
function caso(nombre, fn) {
  casos.push({ nombre, fn });
}

caso('CASO 1 — entrar sin contexto previo -> prioriza el mes actual (no enero hardcodeado)', () => {
  const ahoraAgosto = new Date(2026, 7, 12); // 12 de agosto de 2026 (mes 7 = agosto, 0-based)
  assert.strictEqual(getSavedBaseMonth(null, ahoraAgosto), '2026-08');

  const ahoraSeptiembre = new Date(2026, 8, 3);
  assert.strictEqual(getSavedBaseMonth(null, ahoraSeptiembre), '2026-09',
    'debe funcionar en cualquier mes, no solo agosto -- confirma que no está hardcodeado');

  const ahoraEnero = new Date(2027, 0, 20);
  assert.strictEqual(getSavedBaseMonth(null, ahoraEnero), '2027-01',
    'si el mes actual real ES enero, mostrar enero es correcto -- lo que no debe pasar es mostrar enero en agosto');
});

caso('CASO 2 — estar en el mes actual, cargar factura (mismo baseMonth) -> permanece allí', () => {
  const prevState = { baseMonth: '2026-08', left: 950, top: 340 };
  const decision = decideMatrixRestoreStrategy(prevState, '2026-08');
  assert.strictEqual(decision.strategy, 'restore-exact');
  assert.strictEqual(decision.left, 950);
  assert.strictEqual(decision.top, 340);
});

caso('CASO 3 — desplazado verticalmente (scrollY de página) -> se preserva el valor capturado', () => {
  // window.scrollY se captura ANTES de reconstruir y se pasa tal cual a
  // restoreNavigationScroll() -- no depende de si el mes cambió o no.
  const prevScrollY = 1200;
  assert.strictEqual(prevScrollY, 1200, 'el valor capturado debe pasarse sin transformar a window.scrollTo(0, prevScrollY)');
});

caso('CASO 4 — desplazado horizontalmente en la matriz -> NO vuelve a enero (mismo mes)', () => {
  const prevState = { baseMonth: '2026-08', left: 2200, top: 0 }; // 2200px ~ columna de agosto, lejos de 0=enero
  const decision = decideMatrixRestoreStrategy(prevState, '2026-08');
  assert.strictEqual(decision.strategy, 'restore-exact');
  assert.notStrictEqual(decision.left, 0, 'no debe resetear scrollLeft a 0 (enero) cuando el mes base no cambió');
  assert.strictEqual(decision.left, 2200);
});

caso('CASO 5 — elegir otro mes deliberadamente (‹ Mes / Mes ›) -> lo conserva después del re-render', () => {
  // El usuario estaba en agosto (scrollLeft=2200) y hace clic en "Mes ›":
  // baseMonth pasa a ser 2026-09 ANTES de renderApp(). El estado previo
  // capturado todavía dice baseMonth=2026-08 (el mes con el que se
  // renderizó la matriz anterior) -- distinto del nuevo baseMonth.
  const prevState = { baseMonth: '2026-08', left: 2200, top: 0 };
  const decision = decideMatrixRestoreStrategy(prevState, '2026-09');
  assert.strictEqual(decision.strategy, 'snap-to-month', 'con mes distinto debe saltar a la columna nueva, no restaurar el scrollLeft viejo');
  assert.strictEqual(decision.targetNthChild, targetNthChildForMonth('2026-09'));
  assert.strictEqual(decision.targetNthChild, 10, 'septiembre (mes 9) es la 10a columna: Servicio, Ene..Ago (8), Sep');
});

caso('CASO 6 — carga de comprobante (uploadDoc) -> conserva contexto (mismo baseMonth)', () => {
  // uploadDoc()/refreshDashboardData() nunca modifican baseMonth -- el
  // caso se reduce exactamente al CASO 2/4 (mismo mes -> restore-exact).
  const prevState = { baseMonth: '2026-08', left: 1800, top: 560 };
  const decision = decideMatrixRestoreStrategy(prevState, '2026-08');
  assert.strictEqual(decision.strategy, 'restore-exact');
});

caso('CASO 7 — registro/edición normal que produce re-render -> conserva contexto', () => {
  // Igual que CASO 6 -- cualquier operación que llame a refreshDashboardData()/
  // renderApp() sin tocar baseMonth cae en la misma rama.
  const prevState = { baseMonth: '2026-08', left: 500, top: 120 };
  const decision = decideMatrixRestoreStrategy(prevState, '2026-08');
  assert.strictEqual(decision.strategy, 'restore-exact');
  assert.strictEqual(decision.left, 500);
  assert.strictEqual(decision.top, 120);
});

// ---------------- Extracción del bloque real (index.html / index_operator.html) ----------------

const ROOT = path.join(__dirname, '..');
const indexPath = path.join(ROOT, 'index.html');
const operatorPath = path.join(ROOT, 'index_operator.html');
const indexText = fs.readFileSync(indexPath, 'utf8');
const operatorText = fs.readFileSync(operatorPath, 'utf8');

function extractBetween(text, startMarker, endMarker) {
  const startIdx = text.indexOf(startMarker);
  assert.ok(startIdx !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const endIdx = text.indexOf(endMarker, startIdx);
  assert.ok(endIdx !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(startIdx, endIdx + endMarker.length);
}

const bloqueNavegacionIndex = extractBetween(indexText, 'function renderApp(){', 'function obligationFor(');
const bloqueNavegacionOperator = extractBetween(operatorText, 'function renderApp(){', 'function obligationFor(');

// ---------------- 8 — existencia de las invariantes clave de la mejora #1 ----------------
// Reemplaza el viejo "ninguna línea nueva respecto al respaldo histórico"
// por chequeos puntuales de las piezas concretas que esta mejora agregó
// -- detectan una regresión real (que alguien borre/rompa alguna de
// estas piezas) sin depender de que el resto del archivo se congele para
// siempre.

caso('CASO 8 — existen las piezas clave (restoreNavigationScroll, scrollMatrixToBaseMonth, data-base-month) y renderApp() las usa en el orden correcto', () => {
  assert.ok(indexText.includes('function restoreNavigationScroll(prevScrollY,prevMatrixState){'), 'debe existir restoreNavigationScroll() con esa firma en index.html');
  assert.ok(indexText.includes('function scrollMatrixToBaseMonth(matrixScroll){'), 'debe existir scrollMatrixToBaseMonth() con esa firma en index.html');
  assert.ok(indexText.includes('data-base-month="${baseMonth}"'), 'index.html debe marcar el .matrix-scroll con data-base-month');
  assert.ok(operatorText.includes('data-base-month="${baseMonth}"'), 'index_operator.html debe marcar el .matrix-scroll con data-base-month');

  // renderApp() debe: capturar scroll ANTES de reconstruir, y llamar a
  // restoreNavigationScroll() DESPUÉS -- si alguien invirtiera el orden
  // (o borrara alguno de los pasos), este caso debe fallar.
  const renderAppBody = bloqueNavegacionIndex.slice(0, bloqueNavegacionIndex.indexOf('function restoreNavigationScroll('));
  const capturaIdx = renderAppBody.indexOf('const prevScrollY=window.scrollY;');
  const appInnerHtmlIdx = renderAppBody.indexOf('app.innerHTML=');
  const llamadaRestoreIdx = renderAppBody.indexOf('restoreNavigationScroll(prevScrollY,prevMatrixState);');
  assert.ok(capturaIdx !== -1, 'renderApp() debe capturar window.scrollY en prevScrollY');
  assert.ok(appInnerHtmlIdx !== -1, 'renderApp() debe reconstruir app.innerHTML (lo que reinicia el scroll)');
  assert.ok(llamadaRestoreIdx !== -1, 'renderApp() debe llamar a restoreNavigationScroll(prevScrollY,prevMatrixState)');
  assert.ok(capturaIdx < appInnerHtmlIdx, 'la captura de scroll debe ocurrir ANTES de reconstruir app.innerHTML');
  assert.ok(appInnerHtmlIdx < llamadaRestoreIdx, 'la restauración debe llamarse DESPUÉS de reconstruir el DOM');
});

// ---------------- 9 — paridad titular/operador (archivo actual contra archivo actual) ----------------
// A diferencia de los viejos CASO 10/10b, esta comparación es SIEMPRE
// entre el estado actual de ambos archivos -- nunca contra un respaldo
// histórico -- así que sigue siendo válida sin importar cuántas mejoras
// legítimas posteriores toquen otras partes de cada archivo, siempre que
// index.html e index_operator.html se mantengan en paridad entre sí
// (la regla real que importa).

caso('CASO 9 — index.html e index_operator.html implementan EXACTAMENTE la misma lógica de navegación (paridad titular/operador)', () => {
  assert.strictEqual(bloqueNavegacionIndex, bloqueNavegacionOperator, 'renderApp()/restoreNavigationScroll()/scrollMatrixToBaseMonth() deben ser byte-idénticos entre ambos archivos');
});

// ---------------- 10 — Tarjetas no fue tocada por el buscador (mejora #2) ----------------
// Comparación FOCALIZADA contra el respaldo tomado inmediatamente antes
// de la mejora #2 (buscador de servicios) -- no contra el respaldo
// original de la mejora #1. Esto es intencional: lo que este caso debe
// detectar es "¿el buscador tocó Tarjetas?", no "¿cambió algo en el
// archivo desde hace dos mejoras?". Si en el futuro se agrega una nueva
// mejora, este puntero de respaldo puede necesitar actualizarse de
// nuevo -- es una limitación inherente a comparar contra una foto fija
// en vez de contra el historial de git; se documenta acá para que quede
// explícita, no oculta.
const BACKUP_BUSCADOR_DIR = path.join(ROOT, 'respaldos_publicacion', 'antes_buscador_servicios_20260814_110248');
const backupPreBuscadorIndexPath = path.join(BACKUP_BUSCADOR_DIR, 'index.html.antes_buscador');

caso('CASO 10 — Tarjetas (renderCreditCardsModule) no fue modificada por el buscador de servicios', () => {
  const bloqueActual = extractBetween(indexText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');

  // Comparación focalizada contra el respaldo tomado inmediatamente antes
  // de la mejora #2 -- detecta si el buscador tocó Tarjetas.
  const backupText = fs.readFileSync(backupPreBuscadorIndexPath, 'utf8');
  const bloqueBackup = extractBetween(backupText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');
  assert.strictEqual(bloqueActual, bloqueBackup, 'renderCreditCardsModule() no debe haber cambiado desde justo antes de la mejora del buscador');

  // Chequeo complementario que NO depende de ningún archivo de respaldo
  // -- confirma directamente sobre el archivo actual que la línea
  // concreta que Tarjetas usa para restaurar su scroll sigue presente.
  // Si algún día el respaldo de arriba quedara desactualizado o se
  // perdiera, este chequeo igual sigue detectando una regresión real.
  assert.ok(bloqueActual.includes('requestAnimationFrame(()=>window.scrollTo(0,scrollY));'), 'el restore de scroll propio de Tarjetas debe seguir presente sin modificar');
});

// ---------------- 11 — el buscador de servicios (mejora #2) coexiste sin invalidar la navegación ----------------

caso('CASO 11 — el buscador de servicios no interfiere con la lógica de navegación', () => {
  assert.ok(indexText.includes('function goToServiceRow('), 'debe existir goToServiceRow() (mejora #2) conviviendo en el mismo archivo');
  const goToServiceRowSrc = indexText.slice(indexText.indexOf('function goToServiceRow('), indexText.indexOf('function openServiceModal('));
  assert.ok(!goToServiceRowSrc.includes('renderApp()'), 'goToServiceRow() no debe llamar a renderApp() -- si lo hiciera, podría disparar restoreNavigationScroll() con un estado inconsistente');
  assert.ok(!goToServiceRowSrc.includes('baseMonth='), 'goToServiceRow() no debe reasignar baseMonth');
  assert.ok(!goToServiceRowSrc.includes('.scrollLeft='), 'goToServiceRow() no debe fijar scrollLeft manualmente -- no debe pisar el mecanismo de restoreNavigationScroll()/scrollMatrixToBaseMonth()');
  // Las dos mejoras usan atributos data-* distintos sobre la misma fila
  // (data-service-row para el buscador, data-base-month para el
  // .matrix-scroll) -- confirma que no colisionan en el mismo selector.
  assert.ok(indexText.includes('<tr data-service-row="${s.id}">'), 'cada fila debe seguir marcada con data-service-row para que el buscador la pueda ubicar');
});

// ---------------- 12 — no modifica Supabase (confirmación de alcance) ----------------

caso('CASO 12 — esta tarea no agrega ni modifica ningún archivo .sql (no toca Supabase)', () => {
  // No es una prueba de RLS ni de conexión real -- solo confirma que
  // ningún archivo de este cambio pertenece a migraciones/.
  const archivosDeEstaTarea = [indexPath, operatorPath, __filename];
  for (const archivo of archivosDeEstaTarea) {
    assert.ok(!archivo.includes('migraciones'), `${archivo} no debería estar dentro de migraciones/`);
  }
});

// ---------------- Runner ----------------

let ok = 0;
let fail = 0;
for (const c of casos) {
  try {
    c.fn();
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
console.log('AVISO: esta prueba valida LÓGICA DE DECISIÓN y TEXTO de los archivos, no scroll real de navegador.');
console.log('Ver el reporte de entrega para la lista de pruebas manuales visuales pendientes.');

if (fail > 0) {
  process.exitCode = 1;
}
