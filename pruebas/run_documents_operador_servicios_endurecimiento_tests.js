// ============================================================
// PRUEBA LOCAL — endurecimiento (REVISIÓN 2) de operator_insert_documents /
// operator_update_documents / operator_delete_documents sobre
// public.documents (Servicios)
// ------------------------------------------------------------
// Simulación PURA en JS de la lógica de las 3 policies propuestas en
// migraciones/6b_ENDURECIMIENTO_PUBLIC_DOCUMENTS_OPERADOR_SERVICIOS_20260811.sql
// (revisión 2, con la corrección de coherencia obligation_id/payment_id
// y el aislamiento completo de Tarjetas por statement_id/movement_id/kind).
//
// AVISO — esto es una prueba ESTRUCTURAL/LÓGICA, NO una prueba de RLS en
// vivo: no se conecta a Supabase, no ejecuta SQL, no escribe nada real.
// Reimplementa la MISMA expresión booleana que la migración usa en
// WITH CHECK (INSERT, y fila nueva de UPDATE) y en USING (fila vieja de
// UPDATE, y fila de DELETE):
//
//   card_id IS NULL
//   AND statement_id IS NULL
//   AND movement_id IS NULL
//   AND kind IN ('invoice', 'receipt')
//   AND document_service_id(obligation_id, payment_id) IS NOT NULL
//   AND (
//     obligation_id IS NULL OR payment_id IS NULL
//     OR (
//       obligation_service_id(obligation_id) IS NOT NULL
//       AND payment_service_id(payment_id) IS NOT NULL
//       AND obligation_service_id(obligation_id) = payment_service_id(payment_id)
//     )
//   )
//   AND group_id = service_group_id(document_service_id(obligation_id, payment_id))
//   AND can_operate_service(document_service_id(obligation_id, payment_id))
//
// Helpers reales reutilizados (NO redefinidos en la migración; acá solo
// se MODELAN con datos de prueba locales):
//   private.document_service_id(obligation_id, payment_id)
//     = coalesce(obligation_service_id(obligation_id), payment_service_id(payment_id))
//     (definición LIVE real confirmada por Guido -- documentServiceId())
//   private.obligation_service_id(obligationId)  -> obligationServiceId()
//   private.payment_service_id(paymentId)        -> paymentServiceId()
//     (resuelve vía el obligation_id de ese pago -- modelo local, la
//     definición real exacta de payment_service_id no fue mostrada, solo
//     su existencia y su rol dentro de document_service_id)
//   private.service_group_id(serviceId)          -> serviceGroupId()
//   private.can_operate_service(serviceId)       -> canOperateService()
//     = is_group_operator(group_id) AND can_view_service(service.id)
//     (misma suposición de modelado de is_group_operator ya documentada
//     en los tests anteriores de esta sesión -- NO confirmada contra el
//     cuerpo real de is_group_operator)
//   private.can_view_service(serviceId)          -> canViewService()
//     = (is_group_owner(group_id) OR membership activa)
//       AND (NOT is_private OR is_group_owner(group_id))
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---------------- Fixtures locales ----------------

const GRP_GR = 'grp-gr';
const GRP_OTRO = 'grp-otro';

const SVC_NORMAL_GR = 'svc-normal-gr';
const SVC_PRIVADO_GR = 'svc-privado-gr';
const SVC_OTRO_GRUPO = 'svc-otro-grupo';

const USER_GUIDO = 'user-guido';
const USER_FABIANA = 'user-fabiana';
const USER_OTRO_TITULAR = 'user-otro-titular';

const GROUPS = {
  [GRP_GR]: { id: GRP_GR, created_by: USER_GUIDO },
  [GRP_OTRO]: { id: GRP_OTRO, created_by: USER_OTRO_TITULAR },
};

const SERVICES = {
  [SVC_NORMAL_GR]: { id: SVC_NORMAL_GR, group_id: GRP_GR, is_private: false },
  [SVC_PRIVADO_GR]: { id: SVC_PRIVADO_GR, group_id: GRP_GR, is_private: true },
  [SVC_OTRO_GRUPO]: { id: SVC_OTRO_GRUPO, group_id: GRP_OTRO, is_private: false },
};

const OBLIGATIONS = {
  'ob-normal': { id: 'ob-normal', service_id: SVC_NORMAL_GR },
  'ob-privado': { id: 'ob-privado', service_id: SVC_PRIVADO_GR },
  'ob-otro-grupo': { id: 'ob-otro-grupo', service_id: SVC_OTRO_GRUPO },
};

// payment_id -> obligation_id al que pertenece ese pago (de ahí se deriva
// su servicio real, vía obligation_service_id).
const PAYMENTS = {
  'pay-normal': { id: 'pay-normal', obligation_id: 'ob-normal' },
  'pay-privado': { id: 'pay-privado', obligation_id: 'ob-privado' },
  'pay-otro-grupo': { id: 'pay-otro-grupo', obligation_id: 'ob-otro-grupo' },
};

const MEMBERSHIPS = [
  { user_id: USER_FABIANA, group_id: GRP_GR, role: 'operator', active: true },
];

// ---------------- Modelado de los helpers reales (solo lectura simulada) ----------------

function isGroupOwner(userId, groupId) {
  const g = GROUPS[groupId];
  return !!g && g.created_by === userId;
}

// SUPOSICIÓN DE MODELADO -- ver aviso al inicio del archivo.
function isGroupOperator(userId, groupId) {
  if (isGroupOwner(userId, groupId)) return true;
  return MEMBERSHIPS.some(m => m.user_id === userId && m.group_id === groupId && m.active &&
    (m.role === 'operator' || m.role === 'admin'));
}

function isGroupMember(userId, groupId) {
  if (isGroupOwner(userId, groupId)) return true;
  return MEMBERSHIPS.some(m => m.user_id === userId && m.group_id === groupId && m.active);
}

function canViewService(userId, serviceId) {
  const s = SERVICES[serviceId];
  if (!s) return false;
  const ownerOk = isGroupOwner(userId, s.group_id) || isGroupMember(userId, s.group_id);
  const privacyOk = !s.is_private || isGroupOwner(userId, s.group_id);
  return ownerOk && privacyOk;
}

function canOperateService(userId, serviceId) {
  const s = SERVICES[serviceId];
  if (!s) return false;
  return isGroupOperator(userId, s.group_id) && canViewService(userId, serviceId);
}

function serviceGroupId(serviceId) {
  const s = SERVICES[serviceId];
  return s ? s.group_id : null;
}

function obligationServiceId(obligationId) {
  if (obligationId == null) return null;
  const o = OBLIGATIONS[obligationId];
  return o ? o.service_id : null;
}

function paymentServiceId(paymentId) {
  if (paymentId == null) return null;
  const p = PAYMENTS[paymentId];
  if (!p) return null;
  return obligationServiceId(p.obligation_id);
}

// private.document_service_id: coalesce(obligation_service_id, payment_service_id)
function documentServiceId(obligationId, paymentId) {
  const viaObligation = obligationServiceId(obligationId);
  if (viaObligation != null) return viaObligation;
  return paymentServiceId(paymentId);
}

// ---------------- Reimplementación fiel de la expresión CORREGIDA (revisión 2) ----------------
function documentsOperatorPolicyAllows(userId, row) {
  if (row.card_id != null) return false;
  if (row.statement_id != null) return false;
  if (row.movement_id != null) return false;
  if (!['invoice', 'receipt'].includes(row.kind)) return false;

  const serviceId = documentServiceId(row.obligation_id, row.payment_id);
  if (serviceId == null) return false;

  // Coherencia: si AMBOS obligation_id y payment_id vienen informados,
  // ambos deben resolver a un servicio existente y AL MISMO servicio.
  if (row.obligation_id != null && row.payment_id != null) {
    const os = obligationServiceId(row.obligation_id);
    const ps = paymentServiceId(row.payment_id);
    if (os == null || ps == null || os !== ps) return false;
  }

  if (row.group_id !== serviceGroupId(serviceId)) return false;
  return canOperateService(userId, serviceId);
}

// ---------------- Los 15 casos exigidos (A-O) ----------------

const casos = [];
function caso(nombre, fn) {
  casos.push({ nombre, fn });
}

caso('CASO A — servicio normal GR + operador + obligation_id válido -> PERMITIR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), true);
});

caso('CASO B — servicio normal GR + operador + payment_id válido (sin obligation_id) -> PERMITIR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: null, payment_id: 'pay-normal', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), true);
});

caso('CASO C — obligation_id y payment_id del MISMO servicio -> PERMITIR', () => {
  // pay-normal pertenece a ob-normal -- mismo patrón real de uploadDoc()
  // para comprobantes de pago (ambos IDs juntos, mismo servicio).
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: 'ob-normal', payment_id: 'pay-normal', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), true);
});

caso('CASO D — obligation_id y payment_id de servicios DISTINTOS -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: 'ob-normal', payment_id: 'pay-otro-grupo', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false,
    'document_service_id() resolvería vía obligation_id (svc-normal-gr) e ignoraría que payment_id apunta a otro servicio si no se verificara coherencia explícitamente -- este es el hallazgo bloqueante corregido en esta revisión');
});

caso('CASO E — obligation_id autorizado + payment_id de servicio privado -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: 'ob-normal', payment_id: 'pay-privado', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false);
});

caso('CASO F — obligation_id autorizado + payment_id de otro grupo -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: 'ob-normal', payment_id: 'pay-otro-grupo', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false);
});

caso('CASO G — card_id no nulo -> DENEGAR', () => {
  const row = { card_id: 'card-1', statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false);
});

caso('CASO H — statement_id no nulo aunque card_id sea NULL -> DENEGAR', () => {
  const row = { card_id: null, statement_id: 'stmt-1', movement_id: null, kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false,
    'La versión anterior de esta migración solo exigía card_id IS NULL -- este caso habría pasado incorrectamente sin el chequeo de statement_id');
});

caso('CASO I — movement_id no nulo aunque card_id sea NULL -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: 'mov-1', kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false,
    'Igual que H, pero vía movement_id -- ambas columnas de Tarjetas deben aislarse independientemente de card_id');
});

caso('CASO J — kind de Tarjetas (statement/card_receipt) -> DENEGAR; invoice/receipt válidos -> compatibilidad', () => {
  const rowStatement = { card_id: null, statement_id: null, movement_id: null, kind: 'statement', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowStatement), false, 'kind=statement debe denegar aunque el resto de la fila sea válida');

  const rowCardReceipt = { card_id: null, statement_id: null, movement_id: null, kind: 'card_receipt', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowCardReceipt), false, 'kind=card_receipt debe denegar aunque el resto de la fila sea válida');

  const rowInvoice = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowInvoice), true, 'kind=invoice debe seguir permitiendo (compatibilidad)');

  const rowReceipt = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowReceipt), true, 'kind=receipt debe seguir permitiendo (compatibilidad)');
});

caso('CASO K — servicio is_private=true + operador no titular -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-privado', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false);
});

caso('CASO L — group_id distinto del grupo real del servicio -> DENEGAR', () => {
  const row = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-normal', payment_id: null, group_id: GRP_OTRO };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, row), false);
});

caso('CASO M — vínculo inexistente -> DENEGAR sin error destructivo', () => {
  const rowSinVinculo = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: null, payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowSinVinculo), false);

  const rowObligacionInexistente = { card_id: null, statement_id: null, movement_id: null, kind: 'invoice', obligation_id: 'ob-no-existe', payment_id: null, group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowObligacionInexistente), false);

  const rowPagoInexistente = { card_id: null, statement_id: null, movement_id: null, kind: 'receipt', obligation_id: null, payment_id: 'pay-no-existe', group_id: GRP_GR };
  assert.strictEqual(documentsOperatorPolicyAllows(USER_FABIANA, rowPagoInexistente), false);
});

// ---------------- N y O — confirmaciones estructurales sobre el archivo SQL ----------------
// Estos dos casos NO evalúan la función de lógica -- leen el TEXTO del
// archivo .sql para confirmar, por grep estructurado, que Tarjetas y
// storage_insert_service_documents_operator no fueron tocadas en esta
// migración. Es una confirmación de alcance, no una prueba de RLS.

const SQL_PATH = path.join(__dirname, '..', 'migraciones', '6b_ENDURECIMIENTO_PUBLIC_DOCUMENTS_OPERADOR_SERVICIOS_20260811.sql');
const sqlTexto = fs.readFileSync(SQL_PATH, 'utf8');

caso('CASO N — las policies de Tarjetas permanecen sin modificación (confirmación estructural)', () => {
  assert.ok(!/DROP POLICY/.test(sqlTexto), 'el archivo no debe contener ningún DROP POLICY');
  const nombresTarjetas = [
    'documents_credit_select', 'documents_credit_insert', 'documents_credit_update', 'documents_credit_delete',
    'storage_credit_documents_insert', 'storage_credit_documents_insert_operator', 'storage_credit_documents_select_operator',
  ];
  for (const nombre of nombresTarjetas) {
    const regexAlter = new RegExp('ALTER POLICY\\s+' + nombre + '\\b');
    assert.ok(!regexAlter.test(sqlTexto), `el archivo no debe contener ALTER POLICY ${nombre}`);
  }
  // Las 3 únicas ALTER POLICY reales del archivo deben ser exactamente las de Servicios.
  const alters = sqlTexto.match(/^ALTER POLICY\s+(\S+)/gm) || [];
  const nombresAlterados = alters.map(l => l.replace(/^ALTER POLICY\s+/, ''));
  assert.deepStrictEqual(nombresAlterados.sort(), ['operator_delete_documents', 'operator_insert_documents', 'operator_update_documents'].sort(),
    'las únicas policies ALTERadas deben ser las 3 de operador de Servicios');
});

caso('CASO O — storage_insert_service_documents_operator permanece sin modificación en esta tarea (confirmación estructural)', () => {
  assert.ok(!/ALTER POLICY\s+storage_insert_service_documents_operator/.test(sqlTexto),
    'el archivo no debe contener ningún ALTER POLICY sobre storage_insert_service_documents_operator');
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
console.log('AVISO: esta prueba es estructural/lógica, NO una prueba de RLS en vivo.');

if (fail > 0) {
  process.exitCode = 1;
}
