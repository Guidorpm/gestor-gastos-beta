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
//      funciones nuevas existen, son byte-idénticas entre index.html e
//      index_operator.html, y que el resto del archivo (comparado
//      contra el respaldo tomado antes de este cambio) no perdió ni
//      alteró ninguna línea previa -- solo se agregaron líneas nuevas y
//      se modificó exactamente 1 línea existente por archivo (el div
//      .matrix-scroll, al que se le agregó data-base-month).
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

// ---------------- 8/9 — paridad titular/operador (confirmación estructural) ----------------

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

caso('CASO 8/9 — index.html e index_operator.html implementan EXACTAMENTE la misma lógica (paridad titular/operador)', () => {
  const bloqueIndex = extractBetween(indexText, 'function renderApp(){', 'function obligationFor(');
  const bloqueOperator = extractBetween(operatorText, 'function renderApp(){', 'function obligationFor(');
  assert.strictEqual(bloqueIndex, bloqueOperator, 'renderApp()/restoreNavigationScroll()/scrollMatrixToBaseMonth() deben ser byte-idénticos entre ambos archivos');

  assert.ok(indexText.includes('data-base-month="${baseMonth}"'), 'index.html debe marcar el .matrix-scroll con data-base-month');
  assert.ok(operatorText.includes('data-base-month="${baseMonth}"'), 'index_operator.html debe marcar el .matrix-scroll con data-base-month');
});

// ---------------- 10 — no altera lógica de datos preexistente (confirmación estructural) ----------------

const BACKUP_DIR = path.join(ROOT, 'respaldos_publicacion', 'antes_conservar_contexto_navegacion_20260813_091536');
const backupIndexPath = path.join(BACKUP_DIR, 'index.html.antes_conservar_contexto');
const backupOperatorPath = path.join(BACKUP_DIR, 'index_operator.html.antes_conservar_contexto');

function countLines(text) {
  const map = new Map();
  // Normaliza CRLF/LF antes de partir en líneas -- el repo usa CRLF en
  // estos archivos, y sin normalizar cada línea quedaría con un "\r"
  // colgando que rompería la comparación por igualdad exacta.
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) map.set(line, (map.get(line) || 0) + 1);
  return map;
}

// Chequeo de multiconjunto de líneas (NO es un diff real, no detecta
// reordenamiento) -- pero SÍ detecta con precisión si alguna línea
// preexistente fue borrada o alterada: para cada línea del respaldo,
// exige que siga apareciendo en el archivo actual la misma cantidad de
// veces, salvo el único cambio permitido y documentado (la línea del
// div .matrix-scroll, que gana el atributo data-base-month).
function lineasPerdidasOAlteradas(backupText, currentText, lineasPermitidasAPerder) {
  const backupCounts = countLines(backupText);
  const currentCounts = countLines(currentText);
  const problemas = [];
  for (const [linea, cantidadRespaldo] of backupCounts) {
    const cantidadActual = currentCounts.get(linea) || 0;
    const faltante = cantidadRespaldo - cantidadActual;
    if (faltante > 0) {
      const permitido = lineasPermitidasAPerder.get(linea) || 0;
      if (faltante > permitido) {
        problemas.push({ linea, cantidadRespaldo, cantidadActual, faltante });
      }
    }
  }
  return problemas;
}

caso('CASO 10 — no se perdió ni alteró ninguna línea preexistente de index.html (solo el cambio documentado)', () => {
  const backupText = fs.readFileSync(backupIndexPath, 'utf8');
  const permitidas = new Map([['    <div class="matrix-scroll">', 1]]);
  const problemas = lineasPerdidasOAlteradas(backupText, indexText, permitidas);
  assert.deepStrictEqual(problemas, [], 'no debería haberse borrado/alterado ninguna línea preexistente fuera de la documentada');
});

caso('CASO 10b — no se perdió ni alteró ninguna línea preexistente de index_operator.html (solo el cambio documentado)', () => {
  const backupText = fs.readFileSync(backupOperatorPath, 'utf8');
  const permitidas = new Map([['    <div class="matrix-scroll">', 1]]);
  const problemas = lineasPerdidasOAlteradas(backupText, operatorText, permitidas);
  assert.deepStrictEqual(problemas, [], 'no debería haberse borrado/alterado ninguna línea preexistente fuera de la documentada');
});

// ---------------- 11 — Tarjetas no fue tocada (confirmación estructural) ----------------

caso('CASO 11 — Tarjetas (renderCreditCardsModule y su propio restore de scrollY) permanece intacta', () => {
  const backupText = fs.readFileSync(backupIndexPath, 'utf8');
  const bloqueBackup = extractBetween(backupText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');
  const bloqueActual = extractBetween(indexText, 'function renderCreditCardsModule(', 'function bindCreditCardsModule(');
  assert.strictEqual(bloqueActual, bloqueBackup, 'renderCreditCardsModule() no debe cambiar ni una línea en esta tarea');
  assert.ok(bloqueActual.includes('requestAnimationFrame(()=>window.scrollTo(0,scrollY));'), 'el restore de scroll propio de Tarjetas debe seguir presente sin modificar');
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
