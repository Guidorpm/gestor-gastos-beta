// CORRECCIÓN DEFINITIVA DEL PANEL DE PENDIENTES DE FABIANA — 20260805
//
// Extrae y ejecuta las funciones REALES de index.html/index_operator.html
// (nunca reimplementa la lógica). Las cifras del caso real de Fabiana
// (GR, 7 obligaciones, $263.925,77 total) se usan como FIXTURE de
// prueba -- no están hardcodeadas en el código productivo, solo acá.
//
// node pruebas/run_panel_pendientes_fabiana_20260805_tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const FILES = {
  'index.html': path.join(__dirname, '..', 'index.html'),
  'index_operator.html': path.join(__dirname, '..', 'index_operator.html')
};

let total = 0, failures = 0;
function ok(label, cond) { total++; if (cond) console.log('OK  ', label); else { console.log('FAIL', label); failures++; } }
function approxEq(a, b, eps) { return Math.abs(Number(a) - Number(b)) < (eps || 0.01); }

function extractFunction(src, name) {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(src);
  if (!m) return null;
  let i = m.index;
  let k = src.indexOf('(', m.index), pdepth = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pdepth++; else if (src[k] === ')') { pdepth--; if (pdepth === 0) { k++; break; } } }
  let j = src.indexOf('{', k), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
  return src.slice(i, j);
}

const FN_NAMES = [
  'paidAmountForWithAllocations', 'dashboardPaidFor', 'dashboardBalanceFor',
  'calculateRealObligationBalance', 'isServiceVisibleForCurrentContext',
  'getVisibleObligationsForCurrentContext', 'serviceObligationRowsForMonth',
  'monthKey', 'hasOwnerSpaces', 'hasAnyActiveGroupAccess'
];

function buildRuntime(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fns = FN_NAMES.map(n => {
    const f = extractFunction(src, n);
    if (!f) throw new Error('No se pudo extraer ' + n + ' de ' + filePath);
    return f;
  }).join('\n');
  const body = `
    let session = { user: { id: 'fabiana-uuid' } };
    let groups = [];
    let spacesDashboard = { ownedGroupIds: [], authorizedGroupIds: [], services: [], obligations: [], payments: [], paymentAllocations: [], documents: [], paymentAllocationsLoadError: false };
    ${fns}
    module.exports = {
      setSession: (s) => { session = s; },
      setGroups: (g) => { groups = g; },
      setSpacesDashboard: (s) => { spacesDashboard = s; },
      calculateRealObligationBalance, isServiceVisibleForCurrentContext,
      getVisibleObligationsForCurrentContext, serviceObligationRowsForMonth,
      hasOwnerSpaces, hasAnyActiveGroupAccess, dashboardBalanceFor
    };
  `;
  const m = new Module(filePath, null);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  m._compile(body, filePath);
  return m.exports;
}

// ------------------------------------------------------------
// FIXTURE: caso real de Fabiana (GR), evidencia confirmada en Supabase
// 20260805. Los UUID/importes son los reales del pedido -- usados
// EXCLUSIVAMENTE como datos de prueba.
// ------------------------------------------------------------
const GR_GROUP_ID = '9359fc90-bc68-450a-9f8e-7f0da12b6ffb';
const CASA_GROUP_ID = 'casa-group-uuid-0000-000000000000';
const GUIDO_UUID = 'guido-uuid-0000-0000-000000000000';
const FABIANA_UUID = 'fabiana-uuid';

const grGroup = { id: GR_GROUP_ID, name: 'GR', status: 'active', created_by: GUIDO_UUID };
const casaGroup = { id: CASA_GROUP_ID, name: 'Casa', status: 'active', created_by: GUIDO_UUID };

const svcArgentinaVirtual = { id: 'svc-argentina-virtual', group_id: GR_GROUP_ID, name: 'Argentina Virtual', active: true, is_private: false };
const svcMovistar = { id: 'svc-movistar', group_id: GR_GROUP_ID, name: 'Movistar', active: true, is_private: false };
const svcDux = { id: 'svc-dux', group_id: GR_GROUP_ID, name: 'DUX', active: true, is_private: false };
const svcBritanico = { id: 'svc-britanico', group_id: GR_GROUP_ID, name: 'Británico', active: false, is_private: false };
const svcPrivadoGR = { id: 'svc-privado-gr', group_id: GR_GROUP_ID, name: 'Sueldos', active: true, is_private: true };
const svcCasaAlquiler = { id: 'svc-casa-alquiler', group_id: CASA_GROUP_ID, name: 'Alquiler', active: true, is_private: false };

const obligations = [
  { id: '32a80fe2-2d47-44d0-8802-24e0933c6176', service_id: svcArgentinaVirtual.id, group_id: GR_GROUP_ID, service_name: 'Argentina Virtual', period: '2026-04-01', amount: 20583.00, status: 'pending', due_date: '2026-04-10' },
  { id: 'ad66b9b8-cdf9-42e2-adc8-bd8be98543db', service_id: svcArgentinaVirtual.id, group_id: GR_GROUP_ID, service_name: 'Argentina Virtual', period: '2026-06-01', amount: 21610.00, status: 'pending', due_date: '2026-06-10' },
  { id: '535ca587-80ef-4415-b3bd-5b83cb727c67', service_id: svcArgentinaVirtual.id, group_id: GR_GROUP_ID, service_name: 'Argentina Virtual', period: '2026-07-01', amount: 43220.00, status: 'pending', due_date: '2026-07-10' },
  { id: '49d6c5dd-ae4c-475c-88cb-8b76d5ff378c', service_id: svcMovistar.id, group_id: GR_GROUP_ID, service_name: 'Movistar', period: '2026-04-01', amount: 32192.12, status: 'pending', due_date: '2026-04-15' },
  { id: '3ed9979e-2bb4-4ff6-b0f5-74d67e4f2506', service_id: svcMovistar.id, group_id: GR_GROUP_ID, service_name: 'Movistar', period: '2026-06-01', amount: 34689.68, status: 'pending', due_date: '2026-06-15' },
  { id: '22cde57f-087a-4faf-a219-71a90248431e', service_id: svcMovistar.id, group_id: GR_GROUP_ID, service_name: 'Movistar', period: '2026-07-01', amount: 69038.97, status: 'pending', due_date: '2026-07-15' },
  { id: '1488745b-2535-4fb2-a075-aac702e8774a', service_id: svcDux.id, group_id: GR_GROUP_ID, service_name: 'DUX', period: '2026-08-01', amount: 42592.00, status: 'pending', due_date: '2026-08-10' },
  // Británico: servicio inactivo Y obligación cancelled -- doble motivo de exclusión, ya corregido en Supabase.
  { id: 'britanico-obl-0000', service_id: svcBritanico.id, group_id: GR_GROUP_ID, service_name: 'Británico', period: '2026-08-01', amount: 15000, status: 'cancelled', due_date: '2026-08-05' },
  // Servicio privado de GR (SOLO TITULAR): pendiente, pero solo visible para el titular real (created_by).
  { id: 'privado-obl-0000', service_id: svcPrivadoGR.id, group_id: GR_GROUP_ID, service_name: 'Sueldos', period: '2026-08-01', amount: 900000, status: 'pending', due_date: '2026-08-05' },
  // Obligación cancelled "normal" (no Británico) -- no debe aparecer.
  { id: 'cancelled-obl-0000', service_id: svcArgentinaVirtual.id, group_id: GR_GROUP_ID, service_name: 'Argentina Virtual', period: '2026-05-01', amount: 5000, status: 'cancelled', due_date: '2026-05-10' },
  // Obligación de un servicio inactivo "normal" (no Británico) -- no debe aparecer.
  { id: 'inactivo-obl-0000', service_id: svcBritanico.id, group_id: GR_GROUP_ID, service_name: 'Británico', period: '2026-03-01', amount: 3000, status: 'pending', due_date: '2026-03-10' },
  // Obligación de Casa -- NO debe aparecer en la vista de Fabiana (sin membership ahí).
  { id: 'casa-obl-0000', service_id: svcCasaAlquiler.id, group_id: CASA_GROUP_ID, service_name: 'Alquiler', period: '2026-08-01', amount: 900000, status: 'pending', due_date: '2026-08-01' }
];

const fabianaGroups = [{ ...grGroup, membership: { role: 'operator', active: true } }];
const fabianaSpacesDashboard = {
  ownedGroupIds: [],
  authorizedGroupIds: [GR_GROUP_ID],
  services: [svcArgentinaVirtual, svcMovistar, svcDux, svcBritanico, svcPrivadoGR],
  obligations,
  payments: [],
  paymentAllocations: [],
  documents: [],
  paymentAllocationsLoadError: false
};

for (const [label, filePath] of Object.entries(FILES)) {
  console.log(`\n=== ${label} ===`);
  const rt = buildRuntime(filePath);
  rt.setSession({ user: { id: FABIANA_UUID } });
  rt.setGroups(fabianaGroups);
  rt.setSpacesDashboard(fabianaSpacesDashboard);

  // 1. Fabiana tiene acceso activo a GR.
  ok(`[${label}] (1) hasAnyActiveGroupAccess()===true para Fabiana (membership activa real en GR)`, rt.hasAnyActiveGroupAccess() === true);
  ok(`[${label}] (1b) hasOwnerSpaces()===false para Fabiana (no es fundadora de GR) -- confirma que el bug era real`, rt.hasOwnerSpaces() === false);

  const groupsById = new Map([[GR_GROUP_ID, grGroup], [CASA_GROUP_ID, casaGroup]]);
  const servicesById = new Map(fabianaSpacesDashboard.services.map(s => [s.id, s]));
  const authorizedSet = new Set(fabianaSpacesDashboard.authorizedGroupIds);

  // 2. Fabiana ve obligaciones no privadas de GR.
  const visibleForFabiana = rt.getVisibleObligationsForCurrentContext(obligations, servicesById, groupsById, authorizedSet, FABIANA_UUID);
  ok(`[${label}] (2) Fabiana ve las obligaciones no privadas de GR (Argentina Virtual/Movistar/DUX presentes)`,
    ['32a80fe2-2d47-44d0-8802-24e0933c6176', '49d6c5dd-ae4c-475c-88cb-8b76d5ff378c', '1488745b-2535-4fb2-a075-aac702e8774a'].every(id => visibleForFabiana.some(o => o.id === id)));

  // 3. Fabiana no ve Casa.
  ok(`[${label}] (3) Fabiana NO ve la obligación de Casa (fuera de authorizedGroupIds)`, !visibleForFabiana.some(o => o.id === 'casa-obl-0000'));

  // 4. Fabiana no ve SOLO TITULAR.
  ok(`[${label}] (4) Fabiana NO ve el servicio privado de GR (SOLO TITULAR, no es la titular real)`, !visibleForFabiana.some(o => o.id === 'privado-obl-0000'));
  const visibleForGuido = rt.getVisibleObligationsForCurrentContext(obligations, servicesById, groupsById, authorizedSet, GUIDO_UUID);
  ok(`[${label}] (4b) Guido (titular real de GR) SÍ ve el servicio privado -- confirma que el filtro es de privacidad real, no una restricción general`, visibleForGuido.some(o => o.id === 'privado-obl-0000'));

  // 12/13/14. Británico / cancelled / inactivo no aparecen.
  ok(`[${label}] (12) Británico no aparece (servicio inactivo Y obligación cancelled)`, !visibleForFabiana.some(o => o.service_name === 'Británico'));
  ok(`[${label}] (13) Obligación cancelled "normal" no aparece`, !visibleForFabiana.some(o => o.id === 'cancelled-obl-0000'));
  ok(`[${label}] (14) Obligación de servicio inactivo "normal" no aparece`, !visibleForFabiana.some(o => o.id === 'inactivo-obl-0000'));

  // 5/9/10/11. Filas reales del panel para cada mes con evidencia.
  const rowsByMonth = {};
  ['2026-04', '2026-06', '2026-07', '2026-08'].forEach(mk => { rowsByMonth[mk] = rt.serviceObligationRowsForMonth(mk); });
  const pendingRows = ['2026-04', '2026-06', '2026-07', '2026-08'].flatMap(mk => rowsByMonth[mk]).filter(r => r.kind === 'service' && ['pending', 'partial'].includes(r.paymentCode));
  ok(`[${label}] (5) Fabiana ve exactamente 7 obligaciones pendientes con la evidencia actual`, pendingRows.length === 7);
  ok(`[${label}] (9) Argentina Virtual aparece en abril, junio y julio`, ['2026-04', '2026-06', '2026-07'].every(mk => rowsByMonth[mk].some(r => r.concept === 'Argentina Virtual')));
  ok(`[${label}] (10) Movistar aparece en abril, junio y julio`, ['2026-04', '2026-06', '2026-07'].every(mk => rowsByMonth[mk].some(r => r.concept === 'Movistar')));
  ok(`[${label}] (11) DUX aparece en agosto`, rowsByMonth['2026-08'].some(r => r.concept === 'DUX'));
  ok(`[${label}] Británico no aparece en ningún mes de las filas reales del panel`, Object.values(rowsByMonth).every(rows => !rows.some(r => r.concept === 'Británico')));

  // 6/7/8. Totales reales.
  const previousMonths = ['2026-04', '2026-06', '2026-07'].flatMap(mk => rowsByMonth[mk]).filter(r => r.kind === 'service' && ['pending', 'partial'].includes(r.paymentCode));
  const previousTotal = previousMonths.reduce((sum, r) => sum + r.remainingArs, 0);
  const augustTotal = rowsByMonth['2026-08'].filter(r => r.kind === 'service' && ['pending', 'partial'].includes(r.paymentCode)).reduce((sum, r) => sum + r.remainingArs, 0);
  ok(`[${label}] (6) Meses anteriores (abril+junio+julio) totalizan $221.333,77`, approxEq(previousTotal, 221333.77, 0.01));
  ok(`[${label}] (7) Agosto totaliza $42.592,00`, approxEq(augustTotal, 42592.00, 0.01));
  ok(`[${label}] (8) Total pendiente totaliza $263.925,77`, approxEq(previousTotal + augustTotal, 263925.77, 0.01));

  // 15/16/17. Reglas de saldo real (voided / allocations / doble conteo).
  const oblBase = { id: 'obl-saldo-1', amount: 10000 };
  ok(`[${label}] (15) Pago voided no reduce deuda`,
    approxEq(rt.calculateRealObligationBalance(oblBase, [{ id: 'p1', obligation_id: 'obl-saldo-1', total_amount: 10000, voided: true }], []), 10000));
  // Pago P vinculado a su propia obligación legado ('oblLegacyHome'), con
  // una imputación INACTIVA que apunta a otra obligación distinta
  // ('oblOther'). La imputación inactiva no debe acreditar nada a
  // 'oblOther' -- y como P no tiene ninguna imputación ACTIVA, sigue
  // acreditándose por la vía legado a su propia obligación.
  const paymentsAllocInactiva = [{ id: 'p2', obligation_id: 'oblLegacyHome', total_amount: 10000, voided: false }];
  const allocInactiva = [{ payment_id: 'p2', obligation_id: 'oblOther', allocated_amount: 5000, is_active: false }];
  ok(`[${label}] (16) Una imputación inactiva no reduce la deuda de la obligación a la que apunta`,
    approxEq(rt.calculateRealObligationBalance({ id: 'oblOther', amount: 5000 }, paymentsAllocInactiva, allocInactiva), 5000));
  ok(`[${label}] (16b) El pago sigue acreditándose por la vía legado a SU PROPIA obligación (no tiene ninguna imputación ACTIVA que lo reemplace)`,
    approxEq(rt.calculateRealObligationBalance({ id: 'oblLegacyHome', amount: 10000 }, paymentsAllocInactiva, allocInactiva), 0));
  ok(`[${label}] (17) No hay doble conteo: un pago con imputación activa cuenta SOLO la imputación, nunca además el pago legado completo`,
    approxEq(rt.calculateRealObligationBalance(
      { id: 'obl-saldo-2', amount: 10000 },
      [{ id: 'p3', obligation_id: 'obl-saldo-2', total_amount: 10000, voided: false }],
      [{ payment_id: 'p3', obligation_id: 'obl-saldo-2', allocated_amount: 6000, is_active: true }]
    ), 4000));

  // 18. Error de consulta no muestra cero falso.
  const errorDashboard = { ...fabianaSpacesDashboard, paymentAllocationsLoadError: true };
  rt.setSpacesDashboard(errorDashboard);
  const rowsWithError = rt.serviceObligationRowsForMonth('2026-08');
  // Solo las filas de obligaciones REALES de agosto (con amount cargado,
  // como DUX) deben quedar 'unavailable' -- las filas sintéticas "falta
  // crear la obligación de este mes" (Argentina Virtual/Movistar, que no
  // tienen obligación en agosto en este fixture) son independientes del
  // estado de payment_allocations, no dependen de ningún cálculo
  // financiero, y correctamente siguen mostrando 'no_amount'.
  const realAugustRows = rowsWithError.filter(r => r.kind === 'service' && r.paymentLabel !== 'Falta crear la obligación de este mes');
  ok(`[${label}] (18) Con paymentAllocationsLoadError=true, las obligaciones reales del mes quedan 'unavailable' (nunca 'paid'/pending con saldo 0 falso)`,
    realAugustRows.length > 0 && realAugustRows.every(r => r.paymentCode === 'unavailable'));
  rt.setSpacesDashboard(fabianaSpacesDashboard);

  // 19. Tabla anual y panel usan el mismo cálculo (misma función real).
  const sampleObl = obligations[0];
  const viaBalance = rt.dashboardBalanceFor(sampleObl);
  const viaPanelRow = rt.serviceObligationRowsForMonth('2026-04').find(r => r.action && r.action.groupId === GR_GROUP_ID && r.concept === 'Argentina Virtual');
  ok(`[${label}] (19) dashboardBalanceFor() y la fila real del panel coinciden en el saldo (misma fuente: calculateRealObligationBalance)`,
    viaPanelRow != null && approxEq(viaBalance, viaPanelRow.remainingArs));
}

// 20. Cambio de sesión limpia pendientes anteriores (estructural: confirma
// que el logout reinicia spacesDashboard por completo).
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const logoutBlock = src.slice(src.indexOf('onAuthStateChange'), src.indexOf('onAuthStateChange') + 1600);
  ok(`[${label}] (20) El logout (onAuthStateChange, !newSession) reinicia spacesDashboard completo`,
    /spacesDashboard=\{ownedGroupIds:\[\],authorizedGroupIds:\[\][^}]*obligations:\[\][^}]*paymentAllocationsLoadError:false\}/.test(logoutBlock));
}

// 21. Sintaxis JavaScript válida.
for (const [label, filePath] of Object.entries(FILES)) {
  const src = fs.readFileSync(filePath, 'utf8');
  const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 5000);
  let syntaxOk = false;
  try { scripts.forEach(s => new Function(s)); syntaxOk = scripts.length > 0; } catch (e) { console.error('  ->', e.message); }
  ok(`[${label}] (21) Sintaxis JavaScript válida`, syntaxOk);
}

console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
console.log('MANUAL 22/23: HTTP local 200 para index.html e index_operator.html -- ver script de arranque de servidor.');
process.exitCode = failures > 0 ? 1 : 0;
