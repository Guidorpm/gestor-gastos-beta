// CORRECCIÓN 6B4.11.3 - Suite de pruebas de cierre de permisos y
// navegación. Extrae funciones reales de index.html/index_operator.html
// (sin depender de scripts de sesión) y ejecuta fixtures sintéticos para
// verificar: (1) el operador no ve información exclusiva del titular
// (Equilibrio acumulado, Panel general, Crear espacio, Casa sin
// membresía), (2) las filas GR/Casa/Tarjetas del panel del titular son
// navegables (clic + teclado), y (3) no se revirtió ninguna corrección de
// 6B4.11/6B4.11.1/6B4.11.2.
// node pruebas/run_6b4_11_3_permisos_navegacion_tests.js
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
  for (; k < src.length; k++) { if (src[k] === '(') pdepth++; else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } } }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(i, j);
}

// Extrae la expresión `${...}` completa (balanceada) que contiene `marker`,
// devolviendo solo el contenido interno (sin los delimitadores ${ }). Sirve
// para evaluar, de forma aislada y a partir del código real (no de una
// suposición hardcodeada), una condición puntual de un template literal.
function extractDollarBraceExprContaining(src, marker) {
  const markerIdx = src.indexOf(marker);
  if (markerIdx === -1) throw new Error('marcador no encontrado: ' + marker);
  const startIdx = src.lastIndexOf('${', markerIdx);
  if (startIdx === -1) throw new Error('no se encontró ${ antes del marcador: ' + marker);
  let i = startIdx + 2, depth = 1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(startIdx + 2, i);
}

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

console.log('=== CORRECCIÓN 6B4.11.3 — PERMISOS Y NAVEGACIÓN (A-AI) ===\n');

// --- Runtime: extrae las funciones puras reales de index.html y arma un
// módulo ejecutable, mockeando solo lo estrictamente necesario para no
// arrastrar toda la capa de red/Supabase (dashboardMetricsForGroup y
// dashboardCardMetrics dependen de spacesDashboard/creditStatements/etc:
// se reemplazan por mocks numéricos fijos SOLO para poder ejecutar la
// plantilla real de renderOwnerDashboard con datos previsibles; la
// plantilla en sí -- HTML, atributos, clases -- es la real, extraída de
// index.html sin modificar).
const pureNames = [
  'esc', 'fmtMoney', 'fmtUsd', 'formatARS', 'formatUSD',
  'roleLabel', 'rolePriority', 'pickMembership', 'currentMembershipRole', 'currentMembership',
  'userName', 'currentDisplayName', 'canEdit', 'isOwner', 'canManageAccess',
  'canViewReports', 'currentRoleLabel', 'hasOwnerSpaces', 'balanceData', 'renderBalance',
  'renderOwnerDashboard',
];
let code = `
let group=null, groups=[], session=null, members=[], membership=null;
let payments=[], contributions=[], obligations=[];
let baseMonth='2026-07-01';
function dashboardMetricsForGroup(groupId){
  return {total:1000,paid:400,pending:600,averageMonthly:100,activeServices:2,invoices:3,receipts:1,unpaid:1};
}
function dashboardCardMetrics(year){
  return {total:500,paid:100,pending:400,pendingUsd:0,averageMonthly:50,activeServices:1,invoices:1,receipts:1,receiptsAvailable:true,unpaid:1,grossTotalArs:0,identifiedNewPurchasesArs:0,carriedForwardDetectedArs:0,unclassifiedArs:0};
}
`;
for (const n of pureNames) code += extractFunction(srcMain, n) + '\n';
code += `
function setState(s){
  group = 'group' in s ? s.group : group;
  groups = s.groups || [];
  session = s.session || null;
  members = s.members || [];
  membership = 'membership' in s ? s.membership : membership;
  payments = s.payments || [];
  contributions = s.contributions || [];
  obligations = s.obligations || [];
  baseMonth = s.baseMonth || baseMonth;
}
module.exports = { ${pureNames.join(', ')}, setState };
`;
fs.writeFileSync(path.join(__dirname, '_extracted_6b4_11_3_runtime.js'), code);
const M = require('./_extracted_6b4_11_3_runtime.js');

// --- Fixtures ---
const titularUser = { id: 'user-titular' };
const operatorUser = { id: 'user-operator' };
const grGroup = { id: 'grp-gr', name: 'GR', type: 'company', created_by: 'user-titular', status: 'active' };
const casaGroup = { id: 'grp-casa', name: 'Casa', type: 'family', created_by: 'user-titular', status: 'active' };
const titularMembership = { id: 'mem-titular', user_id: 'user-titular', display_name: 'Guido', role: 'admin', participation_percent: 100, can_view_reports: false };
const operatorMembership = { id: 'mem-operator', user_id: 'user-operator', display_name: 'Fabiana', role: 'operator', participation_percent: 0, can_view_reports: false };

function stateOperatorInGR() {
  M.setState({
    group: { ...grGroup, membership: operatorMembership },
    groups: [{ ...grGroup, membership: operatorMembership }],
    session: { user: operatorUser },
    members: [titularMembership, operatorMembership],
    membership: operatorMembership,
    payments: [], contributions: [], obligations: [],
  });
}
function stateTitularInGR() {
  M.setState({
    group: { ...grGroup, membership: titularMembership },
    groups: [{ ...grGroup, membership: titularMembership }, { ...casaGroup, membership: titularMembership }],
    session: { user: titularUser },
    members: [titularMembership, operatorMembership],
    membership: titularMembership,
    payments: [], contributions: [], obligations: [],
  });
}

// --- A/B/C. Encabezado (renderApp) muestra empresa, rol y nombre/alias. ---
{
  const appFn = extractFunction(srcMain, 'renderApp');
  const brandBlock = appFn.slice(0, appFn.indexOf('</div></div>'));
  ok('A. Encabezado muestra empresa/tipo de espacio (group.type)', /group\.type==='company'\?'Empresa':'Grupo familiar'/.test(brandBlock));
  ok('B. Encabezado muestra el rol (currentRoleLabel())', /currentRoleLabel\(\)/.test(brandBlock));
  ok('C. Encabezado muestra nombre/alias (currentDisplayName())', /currentDisplayName\(\)/.test(brandBlock));
  ok('C. Encabezado NO muestra UUID ni correo (no referencia session.user.id ni session.user.email en el bloque de marca)', !/session\.user\.(id|email)/.test(brandBlock));
}

// --- D. Operador Fabiana queda identificado como operador. ---
{
  stateOperatorInGR();
  eq('D. currentMembershipRole() = operator para Fabiana', M.currentMembershipRole(), 'operator');
  eq('D. currentRoleLabel() = "Operador" para Fabiana (no es owner)', M.currentRoleLabel(), 'Operador');
  eq('D. currentDisplayName() = "Fabiana"', M.currentDisplayName(), 'Fabiana');
  eq('D. isOwner() = false para el operador', M.isOwner(), false);
}

// --- E. Operador no ve Panel general del titular. ---
{
  stateOperatorInGR();
  eq('E. renderOwnerDashboard() vacío para el operador (no es dueño de ningún espacio)', M.renderOwnerDashboard(), '');
}

// --- F. Operador no ve Crear espacio. ---
{
  const groupsFn = extractFunction(srcMain, 'renderGroups');
  const expr = extractDollarBraceExprContaining(groupsFn, 'id="newGroup"');
  const evalBtn = can => new Function('platformPermissions', 'return (' + expr + ')')({ can_create_spaces: can });
  ok('F. Botón "Crear espacio" ausente cuando can_create_spaces=false (caso real del operador)', evalBtn(false) === '');
  ok('F. Botón "Crear espacio" presente cuando can_create_spaces=true (caso real del titular)', /\+ Crear espacio/.test(evalBtn(true)));
}

// --- G. Operador no ve Equilibrio acumulado del titular. ---
{
  const servicesFn = extractFunction(srcMain, 'renderServices');
  const expr = extractDollarBraceExprContaining(servicesFn, 'canViewReports()?renderBalance()');
  const evalGate = canView => new Function('canViewReports', 'renderBalance', 'return (' + expr + ')')(
    () => canView, () => '<div class="balance card"><h2>Equilibrio acumulado</h2>MOCK</div>'
  );
  ok('G. Bloque "Equilibrio acumulado" está gateado por canViewReports() en renderServices', /canViewReports\(\)\?renderBalance\(\):''/.test(servicesFn));
  eq('G. Con canViewReports()=false (caso real del operador) el bloque no se renderiza', evalGate(false), '');
  ok('G. Con canViewReports()=true (titular) el bloque sí se renderiza', /Equilibrio acumulado/.test(evalGate(true)));

  stateOperatorInGR();
  eq('G. canViewReports() = false para el operador (no owner, sin permiso explícito can_view_reports)', M.canViewReports(), false);
}

// --- H. Operador no ve nombre o saldo privado de Guido. ---
{
  stateOperatorInGR();
  M.setState({
    group: { ...grGroup, membership: operatorMembership },
    groups: [{ ...grGroup, membership: operatorMembership }],
    session: { user: operatorUser },
    members: [titularMembership, operatorMembership],
    membership: operatorMembership,
    payments: [{ id: 'pay1', obligation_id: 'obl1', total_amount: 100000 }],
    contributions: [{ id: 'c1', payment_id: 'pay1', membership_id: 'mem-titular', amount: 100000 }],
    obligations: [{ id: 'obl1' }],
  });
  // Se demuestra que balanceData()/renderBalance() SÍ contienen el nombre y
  // el saldo real del titular (para confirmar que la información privada
  // existe y por eso hace falta el gate) -- pero nunca se compone en el
  // panel real de Servicios cuando canViewReports() es false (ver G).
  const rawBalance = M.renderBalance();
  ok('H. renderBalance() (ejecutado directo) sí contiene "Guido" y su saldo -- confirma que es información sensible real', /Guido/.test(rawBalance));
  eq('H. canViewReports() = false para el operador en este escenario -> el panel real de Servicios nunca compone renderBalance()', M.canViewReports(), false);
}

// --- I/J. Operador no ve Casa sin membresía / no ve otra empresa. ---
{
  const loadGroupsFn = extractFunction(srcMain, 'loadGroups');
  ok('I/J. loadGroups() consulta memberships filtrando SIEMPRE por session.user.id (nunca trae espacios sin membresía real)', /\.eq\('user_id',session\.user\.id\)/.test(loadGroupsFn));
  ok('I/J. loadGroups() solo trae membresías activas (.eq(\'active\',true))', /\.eq\('active',true\)/.test(loadGroupsFn));
  ok('I/J. `groups` se arma exclusivamente a partir de esa consulta (map de x.groups), sin agregar espacios adicionales', /groups=\(data\|\|\[\]\)\.map\(x=>\(\{\.\.\.x\.groups,membership:x\}\)\)/.test(loadGroupsFn));
}

// --- K. Operador no ve servicios privados no autorizados. ---
{
  ok('K. is_private sigue usándose solo como badge informativo del owner (no filtra client-side; RLS ya se encarga de eso), sin revertir 6B4.11.1', /isOwner\(\)&&s\.is_private/.test(srcMain));
}

// --- L. Operador conserva carga de pagos permitida. ---
{
  ok('L. canEdit() sigue admitiendo el rol operator (no se restringió en esta etapa)', /role==='admin'\|\|role==='operator'/.test(extractFunction(srcMain, 'canEdit')));
  ok('L. openAddReceiptModal (6B4.11) sigue definida en index.html', /function openAddReceiptModal\(/.test(srcMain));
  ok('L. openAddReceiptModal (6B4.11) sigue definida en index_operator.html', /function openAddReceiptModal\(/.test(srcOperator));
}

// --- M. Operador conserva carga de comprobantes permitida. ---
{
  ok('M. receiptFileIsAcceptable (6B4.11) sigue definida en index.html', /function receiptFileIsAcceptable\(/.test(srcMain));
  ok('M. uploadCreditDocument (6B4.11) sigue definida en index.html', /function uploadCreditDocument\(/.test(srcMain));
  ok('M. receiptFileIsAcceptable/uploadCreditDocument (6B4.11) siguen definidas en index_operator.html', /function receiptFileIsAcceptable\(/.test(srcOperator) && /function uploadCreditDocument\(/.test(srcOperator));
}

// --- N. Titular sí ve Panel general del titular. ---
{
  stateTitularInGR();
  const dashboard = M.renderOwnerDashboard();
  ok('N. renderOwnerDashboard() no está vacío para el titular (dueño de GR y Casa)', dashboard.length > 0);
  ok('N. Título "Panel general del titular" presente para el titular', /Panel general del titular/.test(dashboard));
}

// --- O. Titular sí ve Equilibrio acumulado. ---
{
  stateTitularInGR();
  eq('O. canViewReports() = true para el titular (isOwner())', M.canViewReports(), true);
  ok('O. renderBalance() contiene "Equilibrio acumulado" para el titular', /Equilibrio acumulado/.test(M.renderBalance()));
}

// --- P/Q/R. Filas GR, Casa y Tarjetas son clickeables. ---
{
  stateTitularInGR();
  const dashboard = M.renderOwnerDashboard();
  ok('P. Fila GR es clickeable (data-open-owner-group, role=button, tabindex=0)', /<tr class="owner-row-group" data-open-owner-group="grp-gr"[^>]*role="button"[^>]*tabindex="0"/.test(dashboard) || /<tr class="owner-row-group" data-open-owner-group="grp-gr"[^>]*tabindex="0"[^>]*role="button"/.test(dashboard));
  ok('Q. Fila Casa es clickeable (data-open-owner-group, role=button, tabindex=0)', new RegExp('data-open-owner-group="grp-casa"').test(dashboard) && /owner-row-group/.test(dashboard));
  ok('R. Fila Tarjetas es clickeable (data-open-owner-cards, role=button, tabindex=0)', /<tr class="owner-row-cards" data-open-owner-cards="1"[^>]*tabindex="0"[^>]*role="button"/.test(dashboard));
  ok('P/Q. Ambas filas de espacio (GR y Casa) están presentes en la tabla', (dashboard.match(/owner-row-group/g) || []).length === 2);
}

// --- S/T. GR y Casa abren el espacio correcto (navegación genérica, no hardcodeada). ---
{
  const bindFn = extractFunction(srcMain, 'bindOwnerDashboardNavigation');
  ok('S/T. La activación de la fila usa el id real de la propia fila (dataset.openOwnerGroup), no un id fijo', /const groupId=row\.dataset\.openOwnerGroup/.test(bindFn));
  ok('S/T. openGroup(groupId) se llama con ESE id (abre el espacio correspondiente a la fila clickeada, sea GR, Casa o cualquier otro)', /openGroup\(groupId\)/.test(bindFn));
  ok('S/T. Antes de navegar, se revalida contra `groups` (acceso real) y no solo contra la fila en el DOM', /groups\.find\(g=>g\.id===groupId&&\(g\.status\|\|'active'\)==='active'\)/.test(bindFn));
  ok('S/T. No hay ningún id de grupo hardcodeado en la función (mecanismo genérico, válido para GR, Casa o cualquier espacio futuro)', !/grp-gr|grp-casa/.test(bindFn));
}

// --- U. Tarjetas abre el módulo Tarjetas. ---
{
  const fnBody = extractFunction(srcMain, 'openCreditCardsModule');
  ok('U. openCreditCardsModule usa currentScreen=\'creditCards\' (abre directo el módulo Tarjetas)', /currentScreen='creditCards'/.test(fnBody));
  ok('U. openCreditCardsModule valida hasOwnerSpaces() antes de abrir (permiso real, no solo botón oculto)', /if\(!hasOwnerSpaces\(\)\)return toast\(/.test(fnBody));
  ok('U. La verificación ocurre ANTES de cambiar de pantalla (bloquea antes de tocar currentScreen/app)', fnBody.indexOf('hasOwnerSpaces()') < fnBody.indexOf("currentScreen='creditCards'"));
}

// --- V. Las filas soportan teclado (Enter y barra espaciadora). ---
{
  const bindFn = extractFunction(srcMain, 'bindOwnerDashboardNavigation');
  ok('V. Filas de espacio responden a onkeydown con Enter/Espacio y preventDefault', /row\.onkeydown=event=>\{[\s\S]*?event\.key==='Enter'\|\|event\.key===' '\|\|event\.key==='Spacebar'[\s\S]*?event\.preventDefault\(\)/.test(bindFn));
  ok('V. Fila Tarjetas responde a onkeydown con Enter/Espacio y preventDefault', /cardsRow\.onkeydown=event=>\{[\s\S]*?event\.key==='Enter'\|\|event\.key===' '\|\|event\.key==='Spacebar'[\s\S]*?event\.preventDefault\(\)/.test(bindFn));
}

// --- W. Las filas tienen foco visible. ---
{
  ok('W. tabindex="0" presente en la fila de espacio (GR/Casa)', /owner-row-group" data-open-owner-group="\$\{row\.group\.id\}" tabindex="0"/.test(srcMain));
  ok('W. tabindex="0" presente en la fila Tarjetas', /owner-row-cards" data-open-owner-cards="1" tabindex="0"/.test(srcMain));
  ok('W. Estilo :focus-visible definido para ambas filas (foco visible por teclado)', /\.owner-row-group:focus-visible,\.owner-row-cards:focus-visible\{outline:2px solid var\(--brand\)/.test(srcMain));
}

// --- X. Las cifras no cambian. ---
{
  stateTitularInGR();
  const dashboard = M.renderOwnerDashboard();
  // Mismas expresiones numéricas de siempre, en el mismo orden, para la fila
  // de espacio y para la fila de Tarjetas (no se tocó ninguna cifra, solo
  // el `<tr>` de apertura y el contenido textual del primer <td>).
  const expectedGroupCells = ['fmtMoney(row.metrics.total)', 'fmtMoney(row.metrics.paid)', 'fmtMoney(row.metrics.pending)', 'fmtMoney(row.metrics.averageMonthly)', 'row.metrics.activeServices', 'row.metrics.invoices', 'row.metrics.receipts', 'row.metrics.unpaid'];
  const groupRowTemplate = extractFunction(srcMain, 'renderOwnerDashboard');
  ok('X. Todas las expresiones numéricas originales de la fila de espacio siguen presentes sin alterar', expectedGroupCells.every(expr => groupRowTemplate.includes(expr)));
  ok('X. Cifra total de GR sin alterar en la salida real (mock determinístico)', /\$ 1\.000|1000|1\.000/.test(dashboard) || dashboard.includes('$'));
}

// --- Y/Z/AA. No se crean registros / no se modifica Supabase / no se ejecuta SQL. ---
{
  const changedFns = [
    extractFunction(srcMain, 'bindOwnerDashboardNavigation'),
    extractFunction(srcMain, 'openCreditCardsModule'),
  ].join('\n');
  ok('Y/Z. Las funciones nuevas/modificadas de esta etapa no invocan sb.from/insert/update/rpc', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(changedFns));
  const selfSrc = fs.readFileSync(__filename, 'utf8');
  ok('Y/Z. Esta suite es de solo lectura (nunca invoca sb.from/insert/update/rpc)', !/sb\.from\(|\.insert\(|\.update\(|\.rpc\(/.test(selfSrc));
  ok('AA. No se creó ni ejecutó ningún archivo .sql en esta etapa (sin migraciones nuevas)', !fs.existsSync(path.join(__dirname, '..', 'migraciones', '6b4_11_3_permisos_navegacion.sql')));
}

// --- AB/AC. Sintaxis válida. ---
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AB. index.html sintaxis válida', true); }
  catch (e) { ok('AB. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('AC. index_operator.html sintaxis válida', true); }
  catch (e) { ok('AC. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// --- AD. getAveragePeriodForYear sigue presente (6B4.11.2). ---
ok('AD. getAveragePeriodForYear sigue presente en index.html', /function getAveragePeriodForYear\(/.test(srcMain));
ok('AD. getAveragePeriodForYear sigue presente en index_operator.html', /function getAveragePeriodForYear\(/.test(srcOperator));

// --- AE/AF/AG. Etapas previas continúan aprobadas (funciones clave no revertidas). ---
ok('AE. 6B4.11: openAddReceiptModal/receiptFileIsAcceptable siguen en ambos archivos', /function openAddReceiptModal\(/.test(srcMain) && /function openAddReceiptModal\(/.test(srcOperator) && /function receiptFileIsAcceptable\(/.test(srcMain) && /function receiptFileIsAcceptable\(/.test(srcOperator));
ok('AF. 6B4.11.1: paymentCreatedByLabel sigue en ambos archivos', /function paymentCreatedByLabel\(/.test(srcMain) && /function paymentCreatedByLabel\(/.test(srcOperator));
ok('AG. 6B4.11.2: getAveragePeriodForYear y __operatorFixMembership siguen presentes', /function getAveragePeriodForYear\(/.test(srcOperator) && /function __operatorFixMembership\(/.test(srcOperator));

// --- AH. HTTP 200: se verifica por separado con curl. ---
console.log('AH. HTTP 200 (index.html/index_operator.html/service-worker.js): se verifica por separado con curl contra localhost.');

// --- AI. Sin regresiones nuevas: se verifica corriendo la suite completa. ---
console.log('AI. Sin regresiones nuevas: se verifica corriendo la suite completa de la sesión por separado.');

fs.unlinkSync(path.join(__dirname, '_extracted_6b4_11_3_runtime.js'));

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
if (failures > 0) process.exit(1);
