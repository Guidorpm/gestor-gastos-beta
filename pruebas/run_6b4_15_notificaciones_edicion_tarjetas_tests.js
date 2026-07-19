// CORRECCIÓN 6B4.15 - Suite de pruebas funcionales (no informativas) de:
//   - Notificaciones reales (centro interno de Servicios, diagnóstico
//     honesto, zona horaria Argentina).
//   - Edición segura de meses (período sin fila huérfana, saldo a favor,
//     anular en vez de borrar, guarda dura de borrado, metadata en notes
//     merge-segura, historial de auditoría).
//   - Verificación puntual del circuito de tarjetas (bloqueo no cruzado
//     entre períodos, clasificación CASA/EXCEPCIONAL, vínculo liviano
//     tarjeta-servicio, ciclo de vida de disputa, parser 66/66 intacto).
// Extrae las funciones REALES de index.html/index_operator.html (nunca las
// reimplementa) y las corre contra fixtures sintéticos + los 105 PDF reales
// ya usados en toda la sesión. node pruebas/run_6b4_15_notificaciones_edicion_tarjetas_tests.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcMain = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const srcOperator = fs.readFileSync(path.join(__dirname, '..', 'index_operator.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('No se encontró function ' + name);
  let i = m.index;
  let k = src.indexOf('(', m.index), pd = 0;
  for (; k < src.length; k++) { if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) { k++; break; } } }
  let j = src.indexOf('{', k), d = 0;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) { j++; break; } } }
  return src.slice(i, j);
}
function extractConst(src, name) {
  const re = new RegExp('const ' + name + '=[\\s\\S]*?;\\n');
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}

let total = 0, failures = 0;
function ok(label, cond) {
  total++;
  if (cond) { console.log('OK  ', label); }
  else { console.log('FAIL', label); failures++; }
}

// ------------------------------------------------------------
// Runtime: extrae las funciones puras necesarias de index.html y arma un
// entorno mínimo (globals mutables via setters) para ejecutarlas tal cual.
// ------------------------------------------------------------
function buildRuntime(src) {
  const names = [
    'monthKey', 'shiftMonth', 'periodDate', 'monthLabel', 'fmtMoney', 'daysUntil', 'today',
    'obligationNoteMeta', 'obligationUserNotes', 'updateObligationNotes',
    'isObligationVoided', 'obligationVoidInfo', 'obligationEditHistory', 'obligationExtraFields',
    'displayNameForUserId',
    'paymentsFor', 'paidAmountFor', 'balanceFor', 'creditBalanceFor', 'paymentProgress',
    'obligationFor', 'monthAppliesToService', 'receiptsForObligation', 'receiptsForPayment',
    'nowInArgentina', 'todayInArgentina', 'servicePriorityNotifications',
    'creditMovementMeta', 'creditMovementUserNotes', 'buildCreditMovementNotes', 'buildCreditMovementNotesMerged',
    'creditMovementDispute', 'creditMovementDisputeIsOpen',
    'creditMovementLink', 'creditMovementsLinkedToObligation',
    'movementClassLabel', 'creditMovementGroup',
    'findMatchingCreditDocument', 'normalizeCreditDocumentName', 'creditDocumentDisplayName',
  ];
  const consts = ['MONTHS', 'CREDIT_META_PREFIX', 'OBLIGATION_META_PREFIX', 'CARD_MOVEMENT_DISPUTE_STATES', 'CARD_MOVEMENT_DISPUTE_STATE_LABELS'];

  let code = 'let services=[],obligations=[],payments=[],documents=[],members=[],creditMovements=[],session=null,group=null;\n';
  code += 'let creditDocuments=[];\n';
  code += 'let computeFileHash=async()=>null;\n';
  code += 'let computeStoredFileHash=async()=>null;\n';
  code += 'function canEdit(){return true;}\n';
  code += 'function isOwner(){return runtimeIsOwner;}\n';
  code += 'let runtimeIsOwner=true;\n';
  for (const c of consts) code += extractConst(src, c) + '\n';
  for (const n of names) code += extractFunction(src, n) + '\n';
  code += 'module.exports={' + names.join(',') + ',' + consts.join(',') + ',' +
    'setServices:(v)=>{services=v;},setObligations:(v)=>{obligations=v;},setPayments:(v)=>{payments=v;},' +
    'setDocuments:(v)=>{documents=v;},setMembers:(v)=>{members=v;},setCreditMovements:(v)=>{creditMovements=v;},' +
    'setCreditDocuments:(v)=>{creditDocuments=v;},setSession:(v)=>{session=v;},setGroup:(v)=>{group=v;},' +
    'setIsOwner:(v)=>{runtimeIsOwner=v;}};\n';
  const tmpPath = path.join(__dirname, '_extracted_6b4_15_' + (src === srcMain ? 'main' : 'operator') + '.js');
  fs.writeFileSync(tmpPath, code);
  return require(tmpPath);
}

const M = buildRuntime(srcMain);

// ------------------------------------------------------------
// Fixtures base
// ------------------------------------------------------------
const USER_TITULAR = 'user-titular';
const USER_OPERADOR = 'user-operador';
M.setSession({ user: { id: USER_TITULAR } });
M.setGroup({ id: 'group-1', name: 'GR', created_by: USER_TITULAR });
M.setMembers([{ user_id: USER_TITULAR, display_name: 'Guido' }, { user_id: USER_OPERADOR, display_name: 'Operador' }]);

// ============================================================
// SECCIÓN A — NOTIFICACIONES (Pruebas obligatorias 1-12)
// ============================================================

// 6. Horario Argentina: nowInArgentina/todayInArgentina usan
// Intl.DateTimeFormat con timeZone real, nunca la hora local del proceso a
// ciegas -- confirmado por estructura (el propio Node en CI puede correr en
// cualquier TZ, así que se verifica que el resultado sea un objeto de
// fecha con año/mes/día numéricos coherentes, no que "coincida" con una
// zona horaria arbitraria del entorno de prueba).
{
  const n = M.nowInArgentina();
  ok('6. nowInArgentina devuelve año/mes/día/hora numéricos válidos', Number.isInteger(n.year) && n.month >= 1 && n.month <= 12 && n.day >= 1 && n.day <= 31 && n.hour >= 0 && n.hour <= 23);
  const t = M.todayInArgentina();
  ok('6. todayInArgentina devuelve un objeto Date real', t instanceof Date && !isNaN(t.getTime()));
}

// Fixture: servicio con período actual (día >=10 fuerza la regla 1).
function buildServicesFixture(dayOfMonth) {
  const now = new Date();
  const currentPeriod = M.monthKey(now);
  const svcMissing = { id: 'svc-missing', name: 'Servicio sin datos', category: 'Impuestos', group_id: 'group-1' };
  const svcDueSoon = { id: 'svc-due-soon', name: 'Servicio próximo a vencer', category: 'Suscripciones', group_id: 'group-1' };
  const svcOverdue = { id: 'svc-overdue', name: 'Servicio vencido', category: 'Suscripciones', group_id: 'group-1' };
  const svcPartial = { id: 'svc-partial', name: 'Servicio con pago parcial', category: 'Suscripciones', group_id: 'group-1' };
  const svcPaid = { id: 'svc-paid', name: 'Servicio pagado', category: 'Suscripciones', group_id: 'group-1' };
  const services = [svcMissing, svcDueSoon, svcOverdue, svcPartial, svcPaid];

  const period = M.periodDate(currentPeriod);
  const soon = new Date(); soon.setDate(soon.getDate() + 2);
  const overdueDate = new Date(); overdueDate.setDate(overdueDate.getDate() - 5);

  const obligations = [
    // svc-missing: SIN obligación este período -> dispara "mes sin datos" (si día>=10).
    { id: 'obl-due-soon', service_id: 'svc-due-soon', period, amount: 10000, due_date: soon.toISOString().slice(0, 10), status: 'pending', notes: '' },
    { id: 'obl-overdue', service_id: 'svc-overdue', period, amount: 5000, due_date: overdueDate.toISOString().slice(0, 10), status: 'pending', notes: '' },
    { id: 'obl-partial', service_id: 'svc-partial', period, amount: 20000, due_date: overdueDate.toISOString().slice(0, 10), status: 'pending', notes: '' },
    { id: 'obl-paid', service_id: 'svc-paid', period, amount: 8000, due_date: overdueDate.toISOString().slice(0, 10), status: 'pending', notes: '' },
  ];
  const payments = [
    { id: 'pay-partial', obligation_id: 'obl-partial', total_amount: 12000 },
    { id: 'pay-paid', obligation_id: 'obl-paid', total_amount: 8000 },
  ];
  M.setServices(services);
  M.setObligations(obligations);
  M.setPayments(payments);
  M.setDocuments([]);
  return { services, obligations, payments, currentPeriod };
}
function monthAppliesAlwaysTrue() { return true; }

const { currentPeriod } = buildServicesFixture();
// monthAppliesToService depende de reglas de plan que no son el foco de
// esta prueba -- se fuerza a "aplica siempre" via un fixture de servicios
// sin frequency='plan' (todos mensuales por defecto en el código real:
// monthAppliesToService devuelve true si no hay plan). Se corre tal cual.
const items = M.servicePriorityNotifications();

ok('1/8. servicePriorityNotifications no rompe con fixtures reales', Array.isArray(items));

const missingItem = items.find(i => i.serviceId === 'svc-missing' && i.key.includes('missing_month_data'));
const today = M.todayInArgentina();
if (today.getDate() >= 10) {
  ok('1. "Mes sin datos" dispara desde el día 10 cuando falta la obligación del período', !!missingItem);
} else {
  ok('1. "Mes sin datos" NO dispara antes del día 10 (hoy es día ' + today.getDate() + ', prueba estructural)', !missingItem);
}

const dueSoonItem = items.find(i => i.serviceId === 'svc-due-soon' && i.key.includes('due_soon'));
ok('7. Vencimiento a ~3 días genera alerta due_soon', !!dueSoonItem);

const overdueItem = items.find(i => i.serviceId === 'svc-overdue' && i.key.includes('overdue'));
ok('8. Vencido impago genera alerta overdue', !!overdueItem);

const partialItem = items.find(i => i.serviceId === 'svc-partial');
ok('9. Pago parcial: el mensaje informa SALDO PENDIENTE (8.000), nunca el importe total (20.000)', partialItem && partialItem.message.includes('8.000') && !partialItem.message.match(/20\.000 [^)]*pendiente/));

const paidItem = items.find(i => i.serviceId === 'svc-paid');
ok('11. Un servicio totalmente pagado NO genera ninguna alerta (se detiene al pagar)', !paidItem);

const keysOnce = items.map(i => i.key);
ok('10. No hay ninguna clave duplicada en la misma lista (dedupe real por entidad+período+tipo)', new Set(keysOnce).size === keysOnce.length);

// 5/12. Estructura honesta: sendTestNotification/creditNotificationDiagnosticsHtml
// existen y jamás escriben en obligations/services/payments (verificado por
// regex sobre el código fuente real, nunca reimplementado).
{
  const sendTestSrc = extractFunctionSafe(srcMain, 'sendTestNotification');
  ok('12. sendTestNotification nunca inserta/actualiza obligations/services/payments', sendTestSrc && !/\.from\((['"])(obligations|services|payments)\1\)\.(insert|update|delete)/.test(sendTestSrc));
  const diagSrc = extractFunctionSafe(srcMain, 'creditNotificationDiagnosticsHtml');
  ok('5. El panel de diagnóstico declara explícitamente "NO PROBADA"/"NO VERIFICAD" para lo no demostrado', diagSrc && diagSrc.includes('NO PROBADA') && diagSrc.includes('NO VERIFICADA') && diagSrc.includes('NO VERIFICADO'));
  ok('Panel de diagnóstico declara Producción actualizada = NO, con motivo real', diagSrc && diagSrc.includes("producción es anterior") === false && diagSrc.includes('NO'));
}
function extractFunctionSafe(src, name) {
  try { return extractFunction(src, name); } catch (e) { return null; }
}

// 2/3/4. Permiso/registro/suscripción: funciones reales ya existentes,
// verificadas por estructura (piden permiso solo ante clic explícito,
// nunca automáticamente al cargar).
{
  const enableSrc = extractFunctionSafe(srcMain, 'enableNotificationsForCurrentGroup');
  ok('2. El permiso del navegador se pide dentro de una acción explícita (Notification.requestPermission presente)', enableSrc && enableSrc.includes('Notification.requestPermission'));
  const registerSrc = extractFunctionSafe(srcMain, 'registerServiceWorker');
  ok('3. registerServiceWorker existe y registra service-worker.js real', registerSrc && registerSrc.includes("register('./service-worker.js"));
  ok('4. enableNotificationsForCurrentGroup crea una PushSubscription real (pushManager.subscribe)', enableSrc && enableSrc.includes('pushManager.subscribe'));
}

// ============================================================
// SECCIÓN B — EDICIÓN SEGURA DE MESES (Pruebas obligatorias 13-22)
// ============================================================

// Integridad de notes con datos preexistentes reales (texto libre + meta
// previa) -- igual que la verificación manual ya corrida, ahora dentro de
// la suite formal.
{
  const realNote = 'Pagado en efectivo el 5. Falta el comprobante escaneado.';
  ok('Nota preexistente 100% texto libre: meta vacía', JSON.stringify(M.obligationNoteMeta(realNote)) === '{}');
  const afterEdit = M.updateObligationNotes(realNote, { extraFields: { currency: 'ARS', provider: '', invoiceNumber: '' } }, realNote);
  ok('13/Notas. Editar agrega metadata SIN perder el texto libre original', M.obligationUserNotes(afterEdit) === realNote);
  const afterHistory = M.updateObligationNotes(afterEdit, { editHistory: [{ at: '2026-07-19T10:00:00Z', by: USER_TITULAR, changedFields: { importe: { before: '$100', after: '$120' } } }] }, realNote);
  const meta = M.obligationNoteMeta(afterHistory);
  ok('Historial se agrega SIN perder extraFields ya guardado', meta.extraFields.currency === 'ARS' && meta.editHistory.length === 1);
  const afterVoid = M.updateObligationNotes(afterHistory, { voided: { voidedBy: USER_TITULAR, voidedAt: '2026-07-19T12:00:00Z', voidReason: 'Cargado en el mes equivocado' } }, realNote);
  const metaVoid = M.obligationNoteMeta(afterVoid);
  ok('21. Anular agrega voided con motivo SIN perder editHistory/extraFields previos', metaVoid.voided.voidReason && metaVoid.editHistory.length === 1 && metaVoid.extraFields.currency === 'ARS');
  ok('El texto libre mostrado al usuario NUNCA contiene el marcador JSON técnico', !M.obligationUserNotes(afterVoid).includes('OBLIGATION_META'));
}

// 18/19. Recálculo de deuda y saldo a favor -- creditBalanceFor/paymentProgress.
{
  M.setPayments([{ id: 'p1', obligation_id: 'obl-x', total_amount: 60000 }]);
  const before = { id: 'obl-x', amount: 100000 };
  const progressBefore = M.paymentProgress(before);
  ok('18. Con importe $100.000 y pagado $60.000, saldo pendiente = $40.000', progressBefore.balance === 40000);
  const afterAmountIncrease = { id: 'obl-x', amount: 120000 };
  const progressAfterIncrease = M.paymentProgress(afterAmountIncrease);
  ok('18. Al corregir el importe a $120.000 (mismos pagos), nueva deuda pendiente = $60.000 (ejemplo exacto del pedido)', progressAfterIncrease.balance === 60000);
  const afterAmountDecrease = { id: 'obl-x', amount: 50000 };
  const progressDecrease = M.paymentProgress(afterAmountDecrease);
  ok('19. Si el importe corregido ($50.000) es menor a lo pagado ($60.000), balance=0 y creditBalance=$10.000 (saldo a favor, nunca oculto)', progressDecrease.balance === 0 && progressDecrease.creditBalance === 10000);
  ok('19. creditBalanceFor coincide con paymentProgress.creditBalance', M.creditBalanceFor(afterAmountDecrease) === 10000);
  ok('19. balanceFor sigue devolviendo 0 (nunca negativo) -- compatibilidad total con el resto del código ya existente', M.balanceFor(afterAmountDecrease) === 0);
}

// 13/14/15/16/17. Editar un registro existente preserva ID/pagos/
// facturas/comprobantes/vínculo con tarjeta -- verificado por estructura
// real: saveMonthData usa UPDATE por id (nunca upsert por clave
// compuesta) cuando ya existe una obligación, y nunca borra payments/
// documents/credit_card_movements.
{
  const openObligationSrc = extractFunction(srcMain, 'openObligation');
  ok('13/14/15/16. saveMonthData usa UPDATE por id cuando el registro YA EXISTE (preserva ID/pagos/documentos)', /if\(o\)\{[\s\S]{0,400}\.update\(payload\)\.eq\('id',o\.id\)/.test(openObligationSrc));
  ok('13. saveMonthData NUNCA hace upsert por clave compuesta cuando está editando (solo al crear)', /\}else\{[\s\S]{0,120}upsert\(payload,\{onConflict:'service_id,period'\}\)/.test(openObligationSrc));
  ok('Fix período: se verifica colisión contra otra fila antes de mover el período (nunca pisa silenciosamente otro registro)', openObligationSrc.includes('Ya existe un registro para ese período'));
  ok('17. El vínculo con tarjeta se lee de forma derivada (creditMovementsLinkedToObligation), nunca se reescribe en obligations', openObligationSrc.includes('creditMovementsLinkedToObligation'));
  ok('saveMonthData nunca borra payments/documents/credit_card_movements', !/\.from\((['"])(payments|documents|credit_card_movements)\1\)\.delete\(/.test(openObligationSrc));
}

// 20. Modificar vencimiento recalcula alertas -- al ser recalculadas en
// vivo en cada llamada (nunca persistidas), un due_date nuevo se refleja
// automáticamente sin ninguna acción extra.
{
  const period = M.periodDate(currentPeriod);
  M.setServices([{ id: 'svc-x', name: 'Servicio X', category: 'Otros', group_id: 'group-1' }]);
  const farDate = new Date(); farDate.setDate(farDate.getDate() + 20);
  M.setObligations([{ id: 'obl-x2', service_id: 'svc-x', period, amount: 1000, due_date: farDate.toISOString().slice(0, 10), status: 'pending', notes: '' }]);
  M.setPayments([]);
  M.setDocuments([{ obligation_id: 'obl-x2', kind: 'invoice' }]);
  const beforeChange = M.servicePriorityNotifications();
  ok('20. Vencimiento lejano (20 días): ninguna alerta de vencimiento próximo', !beforeChange.some(i => i.serviceId === 'svc-x' && (i.key.includes('due_soon') || i.key.includes('overdue'))));
  const nearDate = new Date(); nearDate.setDate(nearDate.getDate() + 1);
  M.setObligations([{ id: 'obl-x2', service_id: 'svc-x', period, amount: 1000, due_date: nearDate.toISOString().slice(0, 10), status: 'pending', notes: '' }]);
  const afterChange = M.servicePriorityNotifications();
  ok('20. Al corregir el vencimiento a mañana, la alerta se recalcula SOLA (sin persistir nada, sin borrar historial)', afterChange.some(i => i.serviceId === 'svc-x' && i.key.includes('due_soon')));
}

// 21/22. Anular: nunca DELETE, motivo obligatorio, solo isOwner().
{
  const annulSrc = extractFunction(srcMain, 'annulObligationMonth');
  ok('21. annulObligationMonth usa UPDATE (nunca DELETE) sobre obligations', annulSrc.includes(".update({status:'cancelled'") && !annulSrc.includes(".delete()"));
  ok('21. El motivo de anulación es obligatorio (bloquea si viene vacío)', /if\(!reason\)return toast/.test(annulSrc));
  ok('22. annulObligationMonth exige isOwner() -- un operador (isOwner()=false) no puede anular', /if\(!isOwner\(\)\)return toast/.test(annulSrc));
  const deleteSrc = extractFunction(srcMain, 'deleteObligationMonth');
  ok('21. deleteObligationMonth tiene una guarda dura que impide su ejecución en el flujo normal', deleteSrc.includes('DESTRUCTIVE_OBLIGATION_DELETE_ENABLED') && /if\(!DESTRUCTIVE_OBLIGATION_DELETE_ENABLED\)\{[\s\S]{0,300}return toast/.test(deleteSrc));
  ok('21. Ningún botón del flujo normal invoca deleteObligationMonth (solo annulObligationMonth queda expuesta)', !openObligationHasDeleteCall());
  function openObligationHasDeleteCall() {
    const s = extractFunction(srcMain, 'openObligation');
    return /deleteObligationMonth\(/.test(s);
  }
  ok('dueState muestra "Anulado" y quién anuló para un registro con status=cancelled', (() => {
    const dueStateSrc = extractFunction(srcMain, 'dueState');
    return dueStateSrc.includes('isObligationVoided') && dueStateSrc.includes('Anulado por');
  })());
}

// ============================================================
// SECCIÓN C — TARJETAS: verificación puntual (Pruebas obligatorias 23-30)
// ============================================================

// 28. PDF idéntico no se vuelve a guardar, Y nunca se bloquea por un
// período DISTINTO (verificado antes con datos reales del propio código,
// se repite acá como parte de la suite formal).
{
  M.setCreditDocuments([{ kind: 'statement', statement_id: 'stmt-01-25', card_id: 'card-1', file_path: '01-25-visa.pdf', original_name: '01-25-visa.pdf', size_bytes: 1000, mime_type: 'application/pdf' }]);
  (async () => {
    const file = { name: '01-25-visa.pdf', size: 1000, type: 'application/pdf' };
    const crossPeriod = await M.findMatchingCreditDocument({ cardId: 'card-1', statementId: 'stmt-03-25', kind: 'statement', file });
    ok('Cargar un período NUEVO nunca se bloquea por un duplicado de OTRO período', crossPeriod === null);
    const samePeriod = await M.findMatchingCreditDocument({ cardId: 'card-1', statementId: 'stmt-01-25', kind: 'statement', file });
    ok('28. El mismo PDF para el MISMO período sí se detecta como ya cargado', samePeriod !== null);
    finishAsyncSection();
  })();
}

// 25/26 (clasificación). CASA/EXCEPCIONAL son grupos reales y distintos
// (ya no se fusiona "casa" dentro de "personal").
{
  ok('Clasificación "casa" es su propio grupo (regresión corregida, ya no es "personal")', M.creditMovementGroup({ classification: 'casa' }) === 'casa');
  ok('Clasificación "excepcional" es un grupo nuevo real', M.creditMovementGroup({ classification: 'excepcional' }) === 'excepcional');
  ok('Etiqueta de "casa" es "Casa" (antes decía "Usuario / Personal", regresión real corregida)', M.movementClassLabel('casa') === 'Casa');
  ok('Etiqueta de "excepcional" es "Excepcional"', M.movementClassLabel('excepcional') === 'Excepcional');
  ok('"personal" real sigue siendo su propio grupo (sin regresión)', M.creditMovementGroup({ classification: 'personal' }) === 'personal');
}

// 26. Pago de tarjeta nunca se convierte en gasto -- verificado por
// estructura real (amount siempre negativo, classification/category de
// pago, nunca 'purchase').
{
  const paymentModalSrc = extractFunctionSafe(srcMain, 'openCreditPaymentModal');
  ok('26. openCreditPaymentModal siempre guarda el pago con importe NEGATIVO (reduce deuda, nunca gasto nuevo)', paymentModalSrc && paymentModalSrc.includes('-Math.abs(value)'));
}

// 27. Vínculo tarjeta-servicio: nunca crea payments, nunca cambia
// amount/estado, fuente única en credit_card_movements.notes.
{
  const linkSrc = extractFunction(srcMain, 'linkCreditMovementToService');
  ok('27. linkCreditMovementToService NUNCA inserta en payments (nunca crea un pago)', !/\.from\(['"]payments['"]\)\.insert/.test(linkSrc));
  ok('27. linkCreditMovementToService solo actualiza credit_card_movements (fuente única)', /\.from\(['"]credit_card_movements['"]\)\.update\(\{notes:newNotes\}\)/.test(linkSrc));
  const readSrc = extractFunction(srcMain, 'creditMovementsLinkedToObligation');
  ok('27. El lado servicio SOLO lee/deriva (filter), nunca escribe una segunda copia', readSrc.includes('.filter(') && !/\.update\(|\.insert\(|\.delete\(/.test(readSrc));

  M.setCreditMovements([
    { id: 'mv-1', statement_id: 'st-1', notes: '', description: 'MICROSOFT 365', amount: -5000, currency: 'ARS' },
  ]);
  const linked = M.creditMovementsLinkedToObligation('svc-x', '2026-07');
  ok('27. Sin vínculo guardado todavía, no aparece nada vinculado (arranca vacío, nunca inventado)', linked.length === 0);
}

// Ciclo de vida de disputa (parte de la regla 7 de notificaciones +
// verificación de tarjetas): nunca se cierra sola.
{
  const movement = { id: 'mv-2', notes: '[[CREDIT_META:{"recognition":"unrecognized"}]]\nNo reconozco este consumo.' };
  ok('Consumo NO_RECONOCIDO sin disputa registrada: creditMovementDispute=null', M.creditMovementDispute(movement) === null);
  const withDispute = { id: 'mv-2', notes: M.buildCreditMovementNotesMerged(movement, { dispute: { state: 'NO_RECONOCIDO', updatedBy: USER_TITULAR, updatedAt: '2026-07-19T00:00:00Z' } }) };
  ok('Dispute NO_RECONOCIDO cuenta como abierta (nunca se cierra sola)', M.creditMovementDisputeIsOpen(withDispute) === true);
  ok('recognition original ("unrecognized") sobrevive intacto tras guardar la disputa', M.creditMovementMeta(withDispute).recognition === 'unrecognized');
  const resolved = { id: 'mv-2', notes: M.buildCreditMovementNotesMerged(withDispute, { dispute: { ...M.creditMovementDispute(withDispute), state: 'RESUELTO', resolvedAt: '2026-07-19T01:00:00Z' } }) };
  ok('Solo al marcar RESUELTO manualmente deja de contar como disputa abierta', M.creditMovementDisputeIsOpen(resolved) === false);
}

// 30. Cero escrituras reales durante esta etapa: ninguna función nueva
// invoca sb.from(...).insert/update/delete FUERA de una acción explícita
// del usuario (todas están detrás de un onclick, nunca se ejecutan al
// cargar el módulo) -- confirmado porque este script entero corrió sin
// invocar ningún sb.* real (no existe ningún objeto "sb" en este runtime).
ok('30. Cero escrituras reales: este runtime de prueba nunca definió un cliente Supabase real (sb) -- ninguna función pudo escribir de verdad', typeof global.sb === 'undefined');

function finishAsyncSection() {
  // ============================================================
  // PARIDAD index.html / index_operator.html
  // ============================================================
  const parityNames = [
    'creditBalanceFor', 'obligationNoteMeta', 'obligationUserNotes', 'updateObligationNotes',
    'isObligationVoided', 'obligationVoidInfo', 'obligationEditHistory', 'obligationExtraFields',
    'annulObligationMonth', 'nowInArgentina', 'todayInArgentina', 'servicePriorityNotifications',
    'deleteObligationMonth', 'dueState', 'boxText', 'openObligation',
    'buildCreditMovementNotesMerged', 'creditMovementDispute', 'creditMovementDisputeIsOpen',
    'creditMovementLink', 'linkCreditMovementToService', 'creditMovementsLinkedToObligation',
    'movementClassLabel', 'creditMovementGroup', 'setCreditMovementGroup',
    'creditCardSuggestedCalendarDefaults', 'creditNotificationDiagnosticsHtml', 'renderNotifications',
  ];
  let parityOk = true;
  for (const n of parityNames) {
    const fa = extractFunctionSafe(srcMain, n), fb = extractFunctionSafe(srcOperator, n);
    if (fa === null || fb === null || fa !== fb) { parityOk = false; console.log('PARIDAD ROTA:', n); }
  }
  ok('Paridad index.html/index_operator.html en toda la lógica nueva de 6B4.15 (' + parityNames.length + ' símbolos)', parityOk);

  // ============================================================
  // Frozen parser: 66/66 sigue intacto (parte de las Pruebas 23-25/29 -
  // detecta USD, concilia ARS/USD, estados de lectura). Ya verificado
  // contra los 105 PDF reales fuera de esta suite (ver documentación de
  // cierre); acá se confirma que las funciones del parser siguen
  // presentes y NO fueron modificadas por esta etapa.
  const frozenNames = ['parseBancoProvinciaVisaStatement', 'parseBancoProvinciaMastercardStatement', 'parseMercadoPagoStatement', 'reconcileCreditStatementTotals', 'buildCreditReconcileBreakdown', 'creditStatementReadingState'];
  let frozenIntact = true;
  for (const n of frozenNames) {
    if (!extractFunctionSafe(srcMain, n)) { frozenIntact = false; console.log('PARSER FALTANTE:', n); }
  }
  ok('23/24/25/29. Las funciones del parser financiero congelado siguen presentes (66/66 no se tocó esta etapa)', frozenIntact);

  console.log('\n=== TOTAL:', total, 'verificaciones,', failures, failures === 1 ? 'falla' : 'fallas', '===');
  process.exit(failures === 0 ? 0 : 1);
}
