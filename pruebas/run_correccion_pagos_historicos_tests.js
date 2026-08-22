// ============================================================
// PRUEBA LOCAL — Corrección trazable de pagos históricos
// (mejora #7, FASE 2: implementación local + propuesta Supabase,
// NO EJECUTAR MIGRACIÓN, 20260818)
// ------------------------------------------------------------
// AVISO IMPORTANTE: la migración migraciones/
// 6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql NO
// fue ejecutada contra Supabase (sin acceso de ejecución en esta sesión,
// y detenida a propósito hasta autorización explícita). Lo que esta
// prueba SÍ hace, de forma reproducible:
//
//   1) Extrae y ejecuta las funciones REALES de index.html/index_operator.html
//      (paidAmountForWithAllocations/effectiveObligationAmount/
//      obligationHasSecondStagePayment/paymentAppliedDueStage/
//      obligationExtraFields/historicalCorrectionAuxiliaryCandidates/etc.)
//      en un sandbox, nunca reimplementadas a mano -- incluye el caso
//      MODELADO 49.733,00 + 0,69 -> 49.907,71 (CASO 35/36), usando la
//      lógica real de cálculo de saldo/crédito, con datos SINTÉTICOS que
//      imitan el caso real de Edesur, nunca datos reales.
//
//   2) Audita ESTÁTICAMENTE el contenido real del RPC/tabla/RLS
//      propuestos (migración 6b13_PROPUESTA) y del frontend nuevo
//      (openCorrectHistoricalPaymentModal/loadPaymentCorrectionsHistory/
//      botón condicionado a isOwner()/Tarjetas/annulPayment intactos).
//
// Lo que esta prueba NO puede confirmar (requiere Postgres/Supabase real,
// fuera de alcance de esta iteración):
//   - que la función PL/pgSQL propuesta compile y se comporte exactamente
//     así en Postgres real (RAISE EXCEPTION real, FOR UPDATE real, etc.);
//   - que las policies RLS reales permitan/bloqueen tal como se espera.
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
const migrationPath = path.join(ROOT, 'migraciones', '6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql');
// Normalizado a LF: git normaliza los .sql a CRLF al hacer commit/checkout
// (el archivo real en disco puede quedar LF si nunca volvió a pasar por un
// `git add`) -- normalizar acá evita que un marcador multilínea deje de
// matchear solo por el line-ending real en disco.
const migrationSql = fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Sandbox de las funciones reales del frontend ----------------

const fnRoundServiceMoney = extract(indexText, 'function roundServiceMoney(value){', '\n');
const fnServiceMoneyCents = extract(indexText, 'function serviceMoneyCents(value){', '\n');
const blockPaidAmounts = extract(indexText, 'function paidAmountForWithAllocations(', 'function paidAmountAsOfWithAllocations(');
const blockPaymentNotes = extract(indexText, 'function paymentNoteMetadata(rawNotes){', 'function obligationHasSecondStagePayment(');
const blockEffectiveAmount = extract(indexText, 'function obligationHasSecondStagePayment(', 'function dashboardPaidFor(obligationId){');
const blockObligationMeta = extract(indexText, 'const OBLIGATION_META_PREFIX=', '// CORRECCIÓN 6B4.16 - Objetivo 3');
const blockAuxiliaryCandidates = extract(indexText, 'function historicalCorrectionAuxiliaryCandidates(', 'async function loadPaymentCorrectionsHistory(');

// paidAmountAsOfWithAllocations/todayDateString no son necesarias para el
// caso modelado (obligationHasSecondStagePayment ya detecta 'second' y
// effectiveObligationAmount corta antes de necesitarlas), pero se
// declaran como stubs mínimos y DOCUMENTADOS para que el bloque
// extraído (que las referencia dentro de una rama no alcanzada por estos
// casos) no rompa al parsear/ejecutar.
const REAL_SOURCE = [
  fnRoundServiceMoney, fnServiceMoneyCents, blockPaidAmounts, blockPaymentNotes,
  blockEffectiveAmount, blockObligationMeta, blockAuxiliaryCandidates,
].join('\n');

function buildSandbox({ payments = [], paymentAllocations = [], documents = [], contributions = [] } = {}) {
  const sandbox = {
    payments, paymentAllocations, documents, contributions,
    // stubs mínimos, documentados arriba -- solo para que el parser no
    // falle; nunca se ejecutan en los casos de esta suite.
    todayDateString: () => '1970-01-01',
    paidAmountAsOfWithAllocations: () => 0,
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { paidAmountForWithAllocations, effectiveObligationAmount, obligationHasSecondStagePayment, paymentAppliedDueStage, paymentNoteMetadata, obligationNoteMeta, obligationExtraFields, roundServiceMoney, serviceMoneyCents, historicalCorrectionAuxiliaryCandidates };');
  return fn(...Object.values(sandbox));
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — MIGRACIÓN PROPUESTA (tabla/constraints/RLS/RPC): auditoría
// estática de texto real, CASO 1-32 según el pedido de Guido.
// ============================================================

const fnBody = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', '$function$;');

caso('CASO 1 — la migración propuesta existe y conserva el 6b13 de diagnóstico consolidado sin tocarlo', () => {
  assert.ok(fs.existsSync(migrationPath));
  assert.ok(fs.existsSync(path.join(ROOT, 'migraciones', '6b13_DIAGNOSTICO_CORRECCION_PAGOS_HISTORICOS_SOLO_LECTURA_20260818.sql')));
  assert.ok(fs.existsSync(path.join(ROOT, 'migraciones', '6b13_DIAGNOSTICO_CORRECCION_PAGOS_HISTORICOS_CONSOLIDADO_SOLO_LECTURA_20260818.sql')));
});

caso('CASO 2 — titular ve la acción "Corregir pago histórico" (gateada por isOwner(), no canEdit())', () => {
  // AJUSTE (mejora #11, 20260819): el botón ahora también exige
  // p.voided!==true (un pago ya anulado no debe ofrecer "Corregir pago
  // histórico", ver mejora #11) -- sigue siendo isOwner() la condición
  // real de titularidad, solo se le sumó ese AND adicional.
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes("${isOwner()&&p.voided!==true?'<button class=\"btn soft\" id=\"correctHistoricalPaymentBtn\">Corregir pago histórico</button>':''}"));
  }
});

caso('CASO 3 — el operador NO ve la acción (el botón depende de isOwner(), nunca de canEdit()/role==="operator")', () => {
  for (const text of [indexText, operatorText]) {
    const btnBlock = extract(text, 'id="correctHistoricalPaymentBtn"', '\n');
    assert.ok(!/canEdit\(\)/.test(text.slice(text.indexOf('id="correctHistoricalPaymentBtn"') - 40, text.indexOf('id="correctHistoricalPaymentBtn"'))), 'el botón no debe depender de canEdit()');
  }
});

caso('CASO 4 — RPC exige auth.uid() obligatorio, server-side', () => {
  assert.ok(fnBody.includes('IF auth.uid() IS NULL THEN'));
  assert.ok(fnBody.includes("RAISE EXCEPTION 'No se pudo identificar al usuario autenticado'"));
});

caso('CASO 5 — RPC verifica titularidad server-side vía las funciones centrales REALES confirmadas (private.is_group_owner + private.payment_group_id), nunca solo esconder el botón', () => {
  assert.ok(fnBody.includes('v_group_id := private.payment_group_id(p_payment_id);'));
  assert.ok(fnBody.includes('IF NOT private.is_group_owner(v_group_id) THEN'));
  assert.ok(fnBody.includes("RAISE EXCEPTION 'Solo el titular del espacio puede corregir un pago histórico'"));
});

caso('CASO 6 — RPC NO hace DELETE de payments', () => {
  assert.ok(!/DELETE\s+FROM\s+public\.payments/i.test(fnBody));
});

caso('CASO 7 — RPC solo LEE documents (para validar que el auxiliar no tenga comprobantes antes de anularlo), nunca escribe (sin INSERT/UPDATE/DELETE sobre documents)', () => {
  assert.ok(fnBody.includes('FROM public.documents'), 'debe consultar documents para validar el pago auxiliar (v_aux_documents_count)');
  assert.ok(!/INSERT\s+INTO\s+public\.documents|UPDATE\s+public\.documents|DELETE\s+FROM\s+public\.documents/i.test(fnBody));
});

caso('CASO 8 — RPC NO llama a storage.remove() ni referencia Storage', () => {
  assert.ok(!/storage\.objects|storage\.buckets|\.remove\(/i.test(fnBody));
});

caso('CASO 9 — el payment_id principal se conserva (solo UPDATE, nunca INSERT/DELETE sobre payments)', () => {
  assert.ok(fnBody.includes('UPDATE public.payments'));
  assert.ok(!/INSERT\s+INTO\s+public\.payments/i.test(fnBody));
});

caso('CASO 10 — total_amount del payment principal cambia al nuevo importe', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payments', 'WHERE id = p_payment_id;');
  assert.ok(updateBlock.includes('total_amount = p_new_total_amount'));
});

caso('CASO 11 — la única payment_contribution cambia al MISMO valor nuevo (invariante contribution = total_amount)', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payment_contributions', 'WHERE id = v_single_contribution_id;');
  assert.ok(updateBlock.includes('amount = p_new_total_amount'));
});

caso('CASO 12 — mismatch previo entre contribution y total_amount bloquea la corrección', () => {
  assert.ok(fnBody.includes('v_single_contribution_amount IS DISTINCT FROM v_payment.total_amount'));
  assert.ok(fnBody.includes('inconsistencia previa'));
});

caso('CASO 13 — múltiples (o cero) contributions bloquean la corrección', () => {
  assert.ok(fnBody.includes('v_contributions_count <> 1'));
});

caso('CASO 14 — allocations activas del payment principal bloquean la corrección', () => {
  assert.ok(fnBody.includes('v_active_allocations_count > 0'));
  assert.ok(fnBody.includes('fuera de alcance de la versión 1'));
});

caso('CASO 15 — payment voided bloquea la corrección', () => {
  assert.ok(fnBody.includes('v_payment.voided IS TRUE'));
  assert.ok(fnBody.includes("RAISE EXCEPTION 'No se puede corregir un pago anulado'"));
});

caso('CASO 16 — motivo vacío bloquea la corrección', () => {
  assert.ok(fnBody.includes("v_reason = ''"));
  assert.ok(fnBody.includes("RAISE EXCEPTION 'La corrección requiere un motivo'"));
});

caso('CASO 17 — importe <= 0 bloquea la corrección', () => {
  assert.ok(fnBody.includes('p_new_total_amount IS NULL OR p_new_total_amount <= 0'));
});

caso('CASO 18 — mismo importe anterior/nuevo bloquea la corrección (no-op rechazado)', () => {
  assert.ok(fnBody.includes('p_new_total_amount = v_payment.total_amount'));
  assert.ok(fnBody.includes('debe ser distinto del importe actual'));
});

caso('CASO 19 — obligation_id NUNCA se modifica (no aparece en el UPDATE de payments)', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payments', 'WHERE id = p_payment_id;');
  assert.ok(!/obligation_id\s*=/.test(updateBlock));
});

caso('CASO 20 — created_by NUNCA se modifica', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payments', 'WHERE id = p_payment_id;');
  assert.ok(!/created_by\s*=/.test(updateBlock));
});

caso('CASO 21 — created_at NUNCA se modifica', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payments', 'WHERE id = p_payment_id;');
  assert.ok(!/created_at\s*=/.test(updateBlock));
});

caso('CASO 22 — paid_at NUNCA se modifica en esta versión', () => {
  const updateBlock = extract(fnBody, 'UPDATE public.payments', 'WHERE id = p_payment_id;');
  assert.ok(!/paid_at\s*=/.test(updateBlock));
  assert.ok(!fnBody.includes('p_paid_at'), 'el RPC no debe aceptar siquiera un parámetro de paid_at en v1');
});

caso('CASO 23 — appliedDueStage queda preservado si el usuario NO lo corrige (rama ELSE conserva la metadata existente sin tocarla)', () => {
  const block = extract(fnBody, "IF p_applied_due_stage = 'second' THEN", 'v_new_payment_notes := CASE');
  assert.ok(block.includes('ELSE'));
  assert.ok(block.includes('v_new_payment_meta := v_payment_meta;'));
});

caso('CASO 24 — appliedDueStage pasa a "second" cuando el usuario lo indica explícitamente, vía merge (nunca reemplaza notes entero)', () => {
  assert.ok(fnBody.includes("jsonb_build_object('appliedDueStage','second')"));
  assert.ok(fnBody.includes('v_payment_meta || jsonb_build_object'));
});

caso('CASO 25 — appliedDueStage NUNCA se fuerza de vuelta a "first" automáticamente (solo acepta NULL o "second")', () => {
  assert.ok(fnBody.includes("p_applied_due_stage IS NOT NULL AND p_applied_due_stage <> 'second'"));
});

caso('CASO 26 — el segundo vencimiento se actualiza reutilizando el MISMO formato OBLIGATION_META ya publicado (mismo prefijo, mismo merge)', () => {
  assert.ok(fnBody.includes("'[[OBLIGATION_META:'"));
  assert.ok(fnBody.includes("regexp_match(v_obligation_notes, '^\\[\\[OBLIGATION_META:(\\{.*?\\})\\]\\]"));
});

caso('CASO 27 — el segundo vencimiento exige fecha para tener efecto (replica la regla real de effectiveObligationAmount)', () => {
  assert.ok(fnBody.includes('v_touch_second_due := p_second_due_amount IS NOT NULL'));
  const block = extract(fnBody, 'IF v_touch_second_due THEN', 'END IF;');
  assert.ok(block.includes('IF p_second_due_date IS NULL THEN'));
});

caso('CASO 28 — la actualización de segundo vencimiento preserva TODA la metadata existente salvo extraFields.secondDueDate/secondAmount (merge sobre v_obligation_meta, nunca reemplazo entero -- editHistory/voided/currency/provider quedan intactos)', () => {
  assert.ok(fnBody.includes("v_previous_extra || jsonb_build_object("));
  assert.ok(fnBody.includes("v_new_obligation_meta := v_obligation_meta || jsonb_build_object('extraFields', v_new_extra)"), 'v_new_obligation_meta debe construirse SIEMPRE mergeando sobre v_obligation_meta (parseado de lo existente), nunca desde un objeto vacío');
});

caso('CASO 29 — la interpretación insegura de notes existentes (payment u obligation) rechaza la corrección en vez de arriesgar datos', () => {
  assert.ok((fnBody.match(/de forma segura -- corrección cancelada/g) || []).length >= 2, 'debe existir el guard tanto para payments.notes como para obligations.notes');
});

caso('CASO 30 — el pago auxiliar debe pertenecer a la MISMA obligación', () => {
  assert.ok(fnBody.includes('v_aux_payment.obligation_id <> v_payment.obligation_id'));
});

caso('CASO 31 — un pago auxiliar con documentos asociados se rechaza (nunca se anula automáticamente)', () => {
  const block = extract(fnBody, 'SELECT COUNT(*) INTO v_aux_documents_count', 'SELECT COUNT(*), COALESCE(SUM(amount)');
  assert.ok(block.includes('v_aux_documents_count > 0'));
});

caso('CASO 32 — un pago auxiliar con allocations activas se rechaza', () => {
  assert.ok(fnBody.includes('v_aux_active_allocations_count > 0'));
});

caso('CASO 33 — el pago auxiliar se ANULA vía public.void_payment() (UPDATE no destructivo), nunca se elimina', () => {
  assert.ok(fnBody.includes('PERFORM public.void_payment(p_void_auxiliary_payment_id'));
  assert.ok(!/DELETE\s+FROM\s+public\.payments\s+WHERE\s+id\s*=\s*p_void_auxiliary_payment_id/i.test(fnBody));
});

caso('CASO 34 — la contribution del pago auxiliar NUNCA se toca (ni se borra ni se actualiza)', () => {
  assert.ok(!/UPDATE\s+public\.payment_contributions[\s\S]{0,200}v_aux_payment/.test(fnBody));
  assert.ok(!/DELETE\s+FROM\s+public\.payment_contributions/i.test(fnBody));
});

caso('CASO 35 — se registra trazabilidad en payment_corrections (INSERT único, después de que todas las mutaciones tuvieron éxito)', () => {
  assert.ok(fnBody.includes('INSERT INTO public.payment_corrections'));
  const insertIdx = fnBody.indexOf('INSERT INTO public.payment_corrections');
  const updatePaymentsIdx = fnBody.indexOf('UPDATE public.payments');
  assert.ok(insertIdx > updatePaymentsIdx, 'el INSERT de auditoría debe ocurrir después del UPDATE de payments');
});

caso('CASO 36 — el historial es append-only: trigger BEFORE UPDATE OR DELETE rechaza incondicionalmente ambas operaciones', () => {
  assert.ok(migrationSql.includes('BEFORE UPDATE OR DELETE ON public.payment_corrections'));
  const triggerFnBody = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_payment_corrections_immutability()', '$function$;');
  assert.ok(triggerFnBody.includes("TG_OP = 'UPDATE'"));
  assert.ok(triggerFnBody.includes("TG_OP = 'DELETE'"));
  assert.ok((triggerFnBody.match(/RAISE EXCEPTION/g) || []).length === 2);
});

caso('CASO 37 — todo el RPC es UNA sola función PL/pgSQL (transacción implícita única) -- si cualquier paso falla, todo revierte, sin savepoints/subtransacciones manuales que rompan la atomicidad', () => {
  assert.ok(!/SAVEPOINT|COMMIT|BEGIN;/i.test(fnBody));
  const createFunctionCount = (migrationSql.match(/CREATE OR REPLACE FUNCTION public\.correct_historical_payment/g) || []).length;
  assert.strictEqual(createFunctionCount, 1);
});

caso('CASO 38 — sincroniza la obligación al final (reutiliza sync_obligation_payment_status ya existente, mismo nombre real que usa el frontend)', () => {
  assert.ok(fnBody.includes('PERFORM public.sync_obligation_payment_status(v_obligation.id);'));
});

caso('CASO 39 — la tabla payment_corrections tiene columnas explícitas (no JSON) para los importes/fechas principales', () => {
  const tableBlock = extract(migrationSql, 'CREATE TABLE public.payment_corrections (', ');');
  for (const col of ['previous_total_amount numeric(14,2)', 'new_total_amount numeric(14,2)', 'previous_contribution_amount numeric(14,2)', 'new_contribution_amount numeric(14,2)', 'previous_second_due_amount numeric(14,2)', 'new_second_due_amount numeric(14,2)', 'previous_second_due_date date', 'new_second_due_date date', 'reason text NOT NULL', 'corrected_by uuid NOT NULL', 'corrected_at timestamptz NOT NULL']) {
    assert.ok(tableBlock.includes(col), `falta la columna explícita: ${col}`);
  }
});

caso('CASO 40 — RLS habilitado en payment_corrections, con SELECT titular-only reutilizando private.is_group_owner(private.payment_group_id(...)) -- sin JOIN manual paralelo', () => {
  assert.ok(migrationSql.includes('ALTER TABLE public.payment_corrections ENABLE ROW LEVEL SECURITY;'));
  const policyBlock = extract(migrationSql, 'CREATE POLICY payment_corrections_select_owner_only', 'CREATE OR REPLACE FUNCTION public.correct_historical_payment');
  assert.ok(policyBlock.includes('FOR SELECT'));
  assert.ok(policyBlock.includes('private.is_group_owner(private.payment_group_id(payment_corrections.payment_id))'));
  assert.ok(!/JOIN\s+public\.groups/i.test(policyBlock), 'no debe reimplementar la titularidad con un JOIN manual a groups');
});

caso('CASO 41 — NO existe ninguna policy de INSERT/UPDATE/DELETE para "authenticated" en payment_corrections (la única vía de escritura es el RPC SECURITY DEFINER)', () => {
  assert.ok(!/CREATE POLICY[\s\S]{0,200}FOR (INSERT|UPDATE|DELETE)[\s\S]{0,200}payment_corrections/i.test(migrationSql));
  assert.ok(!/FOR (INSERT|UPDATE|DELETE)\s+TO authenticated/i.test(migrationSql));
});

caso('CASO 42 — el RPC es SECURITY DEFINER con search_path fijo (buena práctica de seguridad estándar)', () => {
  const fullFunctionDecl = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', 'AS $function$');
  assert.ok(fullFunctionDecl.includes('SECURITY DEFINER'));
  assert.ok(fullFunctionDecl.includes('SET search_path = public, pg_temp'));
});

caso('CASO 43 — constraints razonables en payment_corrections: importes > 0, motivo no vacío, largo máximo, previous<>new, correction/voided payment distintos', () => {
  assert.ok(migrationSql.includes('chk_payment_corrections_amounts_positive'));
  assert.ok(migrationSql.includes('chk_payment_corrections_amount_changed'));
  assert.ok(migrationSql.includes('chk_payment_corrections_reason_not_blank'));
  assert.ok(migrationSql.includes('chk_payment_corrections_reason_length'));
  assert.ok(migrationSql.includes('chk_payment_corrections_voided_payment_distinct'));
});

caso('CASO 44 — no hay backfill ni DML sobre datos existentes en la migración (fuera de los cuerpos de función, que solo se ejecutan al invocarse)', () => {
  const withoutFunctionBodies = migrationSql
    .replace(extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_payment_corrections_immutability()', '$function$;'), '')
    .replace(extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', '$function$;'), '');
  const withoutComments = withoutFunctionBodies.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/^\s*(INSERT INTO|UPDATE\s+public\.(payments|obligations|documents|payment_contributions|payment_allocations)|DELETE\s+FROM)/im.test(withoutComments));
});

caso('CASO 45 — la migración se declara NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA', () => {
  assert.ok(/NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA/i.test(migrationSql));
});

caso('CASO 46 — ninguna referencia a Tarjetas como código real en la migración propuesta (solo aparece, si acaso, en un comentario explicando por qué NO se copia ese patrón)', () => {
  const withoutComments = migrationSql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/card_id|statement_id|movement_id|credit_card|carried_balance/i.test(withoutComments));
});

// ============================================================
// PARTE A2 — REVISIÓN FINAL PRE-MIGRACIÓN (20260818): private.is_group_owner
// centralizado, FKs no destructivas, locks explícitos, void_payment real,
// valores "previous" server-side. Ver reporte de entrega.
// ============================================================

caso('CASO 76 — ausencia de un owner-check manual/paralelo: ya no queda ningún JOIN a public.groups dentro del cuerpo del RPC (reemplazado por private.is_group_owner)', () => {
  assert.ok(!/JOIN\s+public\.groups/i.test(fnBody));
  assert.ok(!fnBody.includes('v_is_owner'), 'la variable v_is_owner del check manual anterior ya no debe existir');
});

caso('CASO 77 — FK payment_corrections.payment_id usa ON DELETE RESTRICT (nunca CASCADE) -- el historial no puede desaparecer si se borra el payment corregido', () => {
  const tableBlock = extract(migrationSql, 'CREATE TABLE public.payment_corrections (', ');');
  assert.ok(tableBlock.includes('payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT'));
  assert.ok(!/payment_id uuid NOT NULL REFERENCES public\.payments\(id\) ON DELETE CASCADE/.test(tableBlock));
});

caso('CASO 78 — FK payment_corrections.related_voided_payment_id usa ON DELETE RESTRICT (nunca CASCADE) -- el historial no puede desaparecer si se borra el pago auxiliar anulado', () => {
  const tableBlock = extract(migrationSql, 'CREATE TABLE public.payment_corrections (', ');');
  assert.ok(tableBlock.includes('related_voided_payment_id uuid NULL REFERENCES public.payments(id) ON DELETE RESTRICT'));
});

caso('CASO 79 — la migración documenta explícitamente la protección: un DELETE de annulPayment() sobre un payment con historial de corrección debe fallar por la FK, y eso es deliberado', () => {
  assert.ok(migrationSql.includes('protección DELIBERADA'));
  assert.ok(migrationSql.includes('annulPayment()'));
});

caso('CASO 80 — payment_corrections.obligation_id usa ON DELETE RESTRICT (revisión 20260818b: CASCADE fue descartado -- ver CASO 80b/80c para el razonamiento completo)', () => {
  const tableBlock = extract(migrationSql, 'CREATE TABLE public.payment_corrections (', ');');
  assert.ok(tableBlock.includes('obligation_id uuid NOT NULL REFERENCES public.obligations(id) ON DELETE RESTRICT'));
  assert.ok(!/obligation_id uuid NOT NULL REFERENCES public\.obligations\(id\) ON DELETE CASCADE/.test(tableBlock));
});

caso('CASO 80b — el comentario SQL ya NO afirma una protección transitiva no demostrada ("el RESTRICT de payment_id ya bloquea la cadena completa")', () => {
  assert.ok(!migrationSql.includes('el RESTRICT de payment_id ya bloquea la cadena completa'));
  assert.ok(migrationSql.includes('quedó DESCARTADA por no estar demostrada'));
});

caso('CASO 80c — el SQL documenta explícitamente POR QUÉ obligation_id no puede ser CASCADE: Postgres no garantiza el orden entre triggers de FK independientes que referencian la misma fila padre', () => {
  assert.ok(migrationSql.includes('Postgres') && migrationSql.includes('NO garantiza el orden de ejecución entre triggers de FK'));
});

caso('CASO 80d — ninguna de las 3 FK principales de payment_corrections (payment_id/related_voided_payment_id/obligation_id) usa CASCADE en ningún punto del archivo', () => {
  assert.ok(!/(payment_id|related_voided_payment_id|obligation_id) uuid[^,]*REFERENCES public\.(payments|obligations)\(id\) ON DELETE CASCADE/.test(migrationSql));
});

caso('CASO 80e — escenario conceptual documentado: una obligación con un pago corregido debe bloquear su propio DELETE (directo o en cascada desde deleteService()), nunca borrar la correction silenciosamente', () => {
  assert.ok(migrationSql.includes('deleteService()'));
  assert.ok(migrationSql.includes('empezaría a FALLAR'));
  assert.ok(migrationSql.includes('EFECTO COLATERAL ACEPTADO A PROPÓSITO'));
});

caso('CASO 81 — locks explícitos: se bloquean las filas de payment_contributions del principal ANTES de leerlas (evita TOCTOU entre el chequeo y el UPDATE)', () => {
  assert.ok(fnBody.includes('PERFORM 1 FROM public.payment_contributions WHERE payment_id = p_payment_id FOR UPDATE;'));
});

caso('CASO 82 — locks explícitos: se bloquean las filas de payment_contributions del auxiliar ANTES de leerlas', () => {
  assert.ok(fnBody.includes('PERFORM 1 FROM public.payment_contributions WHERE payment_id = p_void_auxiliary_payment_id FOR UPDATE;'));
});

caso('CASO 83 — locks explícitos mínimos completos: payment principal, obligation y payment auxiliar (si existe) están FOR UPDATE', () => {
  assert.ok(fnBody.includes('SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;'));
  assert.ok(fnBody.includes('SELECT * INTO v_obligation FROM public.obligations WHERE id = v_payment.obligation_id FOR UPDATE;'));
  assert.ok(fnBody.includes('SELECT * INTO v_aux_payment FROM public.payments WHERE id = p_void_auxiliary_payment_id FOR UPDATE;'));
});

caso('CASO 84 — se usa la firma REAL confirmada de void_payment: exactamente 2 argumentos posicionales (uuid, text), sin argumentos con nombre inventados', () => {
  assert.ok(fnBody.includes('PERFORM public.void_payment(p_void_auxiliary_payment_id, btrim(p_void_auxiliary_reason));'));
  assert.ok(!/void_payment\([^)]*p_payment_id\s*:=/.test(fnBody), 'no debe llamarse con argumentos nombrados que no coincidan con la firma real');
});

caso('CASO 85 — ningún parámetro del RPC permite falsificar valores "previous_*"/corrected_by/corrected_at desde el cliente (no existen en la firma)', () => {
  const signature = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', ')\nRETURNS jsonb');
  assert.ok(!/p_previous_|p_corrected_by|p_corrected_at/i.test(signature));
});

caso('CASO 86 — todos los valores "previous_*" insertados en payment_corrections provienen de variables server-side (filas ya bloqueadas), nunca de un parámetro p_*', () => {
  const insertBlock = extract(fnBody, 'INSERT INTO public.payment_corrections (', 'RETURNING id INTO v_correction_id;');
  const valuesBlock = insertBlock.slice(insertBlock.indexOf('VALUES ('));
  assert.ok(valuesBlock.includes('v_payment.total_amount'));
  assert.ok(valuesBlock.includes('v_single_contribution_amount'));
  assert.ok(valuesBlock.includes('v_previous_applied_due_stage'));
  assert.ok(valuesBlock.includes('v_previous_second_due_amount'));
  assert.ok(valuesBlock.includes('v_previous_second_due_date'));
  assert.ok(valuesBlock.includes('auth.uid()'), 'corrected_by debe venir de auth.uid(), nunca de un parámetro');
  assert.ok(!/\bp_previous/.test(valuesBlock));
});

// ---- OBLIGATION_META: réplica fiel en JS del algoritmo SQL propuesto ----
// (sección "15" del RPC -- mismo regex ^\[\[OBLIGATION_META:(\{.*?\})\]\]
// [\r\n]*, mismo criterio de merge, misma reconstrucción de notes). Esto
// NO es ejecución real de Postgres -- es una simulación fiel del
// algoritmo, para poder probar los casos límite pedidos (notes vacías,
// solo metadata, texto+metadata, metadata+texto, editHistory,
// extraFields, notes inválidas) sin acceso a una base real.
function sqlObligationMetaMergeSimulation(existingNotes, newSecondDueDate, newSecondDueAmount) {
  const notes = existingNotes || '';
  const match = notes.match(/^\[\[OBLIGATION_META:(\{.*?\})\]\][\r\n]*/);
  let meta, freeText;
  if (match) {
    try {
      meta = JSON.parse(match[1]);
    } catch {
      throw new Error('No se pudo interpretar la metadata existente de la obligación (notes) de forma segura -- corrección cancelada');
    }
    freeText = notes.slice(match[0].length);
  } else {
    meta = {};
    freeText = notes;
  }
  const previousExtra = (meta.extraFields && typeof meta.extraFields === 'object') ? meta.extraFields : {};
  const newExtra = { ...previousExtra, secondDueDate: newSecondDueDate, secondAmount: newSecondDueAmount };
  const newMeta = { ...meta, extraFields: newExtra };
  const newNotes = Object.keys(newMeta).length === 0
    ? freeText
    : `[[OBLIGATION_META:${JSON.stringify(newMeta)}]]${freeText.trim() ? '\n' + freeText : ''}`;
  return { newNotes, meta, freeText, previousExtra, newExtra };
}

caso('CASO 87 — OBLIGATION_META: notes vacías/null -> se crea el marcador nuevo sin texto libre', () => {
  const r = sqlObligationMetaMergeSimulation(null, '2026-08-20', 49907.71);
  assert.strictEqual(r.newNotes, '[[OBLIGATION_META:{"extraFields":{"secondDueDate":"2026-08-20","secondAmount":49907.71}}]]');
});

caso('CASO 88 — OBLIGATION_META: notes con SOLO metadata (sin texto libre) -> preserva otras extraFields y no agrega texto libre inexistente', () => {
  const r = sqlObligationMetaMergeSimulation('[[OBLIGATION_META:{"extraFields":{"currency":"ARS"}}]]', '2026-08-20', 49907.71);
  assert.strictEqual(r.freeText, '');
  assert.deepStrictEqual(r.newExtra, { currency: 'ARS', secondDueDate: '2026-08-20', secondAmount: 49907.71 });
  assert.ok(!r.newNotes.includes('\nundefined'));
});

caso('CASO 89 — OBLIGATION_META: metadata + texto (orden real que produce el frontend) -> el texto libre se preserva exactamente, después del marcador', () => {
  const r = sqlObligationMetaMergeSimulation('[[OBLIGATION_META:{"extraFields":{}}]]\nFactura pagada en dos cuotas', '2026-08-20', 49907.71);
  assert.strictEqual(r.freeText, 'Factura pagada en dos cuotas');
  assert.ok(r.newNotes.endsWith('\nFactura pagada en dos cuotas'));
});

caso('CASO 90 — OBLIGATION_META: texto SIN marcador al inicio -> se trata todo como texto libre humano y se antepone un marcador nuevo, sin perder ni una palabra del texto original', () => {
  const original = 'Nota histórica cargada antes de que existiera OBLIGATION_META';
  const r = sqlObligationMetaMergeSimulation(original, '2026-08-20', 49907.71);
  assert.strictEqual(r.freeText, original);
  assert.ok(r.newNotes.includes(original));
  assert.ok(r.newNotes.startsWith('[[OBLIGATION_META:'));
});

caso('CASO 91 — OBLIGATION_META: preserva editHistory existente sin alterarlo (solo se reemplaza la clave extraFields, nunca el objeto completo)', () => {
  const editHistory = [{ at: '2026-08-01T00:00:00.000Z', by: 'u1', changedFields: { importe: { before: '$1', after: '$2' } } }];
  const existing = `[[OBLIGATION_META:${JSON.stringify({ editHistory, extraFields: { currency: 'ARS' } })}]]`;
  const r = sqlObligationMetaMergeSimulation(existing, '2026-08-20', 49907.71);
  const parsedNew = JSON.parse(r.newNotes.match(/^\[\[OBLIGATION_META:(\{.*?\})\]\]/)[1]);
  assert.deepStrictEqual(parsedNew.editHistory, editHistory);
});

caso('CASO 92 — OBLIGATION_META: preserva extraFields existentes (currency/provider/invoiceNumber) al corregir solo secondDueDate/secondAmount', () => {
  const existing = `[[OBLIGATION_META:${JSON.stringify({ extraFields: { currency: 'USD', provider: 'Edesur', invoiceNumber: '5044' } })}]]`;
  const r = sqlObligationMetaMergeSimulation(existing, '2026-08-20', 49907.71);
  const parsedNew = JSON.parse(r.newNotes.match(/^\[\[OBLIGATION_META:(\{.*?\})\]\]/)[1]);
  assert.strictEqual(parsedNew.extraFields.currency, 'USD');
  assert.strictEqual(parsedNew.extraFields.provider, 'Edesur');
  assert.strictEqual(parsedNew.extraFields.invoiceNumber, '5044');
  assert.strictEqual(parsedNew.extraFields.secondDueDate, '2026-08-20');
  assert.strictEqual(parsedNew.extraFields.secondAmount, 49907.71);
});

caso('CASO 93 — OBLIGATION_META: notes con marcador pero JSON inválido -> RECHAZA (nunca corrompe silenciosamente), mismo criterio que el RPC (RAISE EXCEPTION real)', () => {
  const invalid = '[[OBLIGATION_META:{"extraFields":{ESTO NO ES JSON}}]]';
  assert.throws(() => sqlObligationMetaMergeSimulation(invalid, '2026-08-20', 49907.71), /No se pudo interpretar la metadata/);
});

caso('CASO 94 — el RPC real usa el MISMO patrón de regex y merge que la simulación de arriba (auditoría cruzada texto-real vs. simulación)', () => {
  assert.ok(fnBody.includes("regexp_match(v_obligation_notes, '^\\[\\[OBLIGATION_META:(\\{.*?\\})\\]\\][\\r\\n]*')"));
  assert.ok(fnBody.includes("v_new_extra := v_previous_extra || jsonb_build_object("));
  assert.ok(fnBody.includes("v_new_obligation_meta := v_obligation_meta || jsonb_build_object('extraFields', v_new_extra);"));
});

// ============================================================
// PARTE B — FRONTEND: auditoría estática (index.html / index_operator.html)
// ============================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {

  caso(`CASO 47 [${label}] — la acción se llama "Corregir pago histórico", nunca "Editar"`, () => {
    assert.ok(text.includes('Corregir pago histórico'));
    const modalBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(!/>Editar</.test(modalBlock));
  });

  caso(`CASO 48 [${label}] — openCorrectHistoricalPaymentModal verifica isOwner() server-independiente como primer guard de UX`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', 'const payment=payments.find');
    assert.ok(fnBlock.includes('if(!isOwner())return toast('));
  });

  caso(`CASO 49 [${label}] — el modal muestra el aviso pedido explícitamente por Guido`, () => {
    assert.ok(text.includes('Usá esta opción únicamente para corregir un pago que quedó registrado con datos incorrectos. La corrección quedará guardada en el historial y no se borrará el comprobante original.'));
  });

  caso(`CASO 50 [${label}] — muestra "Importe registrado actualmente", "Importe correcto" y "Motivo de corrección" como campos separados`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes('Importe registrado actualmente'));
    assert.ok(fnBlock.includes('Importe correcto *'));
    assert.ok(fnBlock.includes('Motivo de corrección *'));
  });

  caso(`CASO 51 [${label}] — checkbox "Corresponde a segundo vencimiento / importe actualizado" existe y controla la visibilidad de los campos de segundo vencimiento`, () => {
    assert.ok(text.includes('Corresponde a segundo vencimiento / importe actualizado'));
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("secondDueCheckbox.onchange=()=>secondDueFields.classList.toggle('hidden',!secondDueCheckbox.checked);"));
  });

  caso(`CASO 52 [${label}] — la fecha de segundo vencimiento se pide explícitamente en el modal cuando corresponde (nunca se autocompleta)`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes('id="correctSecondDueDate" type="date"'));
    assert.ok(fnBlock.includes("if(!secondDueDate)return toast('La fecha de segundo vencimiento es obligatoria');"));
  });

  caso(`CASO 53 [${label}] — ofrece la opción "¿Se creó otro pago para compensar este error?" con selección explícita, nunca automática`, () => {
    assert.ok(text.includes('¿Se creó otro pago para compensar este error?'));
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("if(!selected)return toast('Elegí cuál pago auxiliar anular');"), 'debe exigir selección explícita, nunca inferir el candidato automáticamente');
  });

  caso(`CASO 54 [${label}] — muestra la advertencia exacta pedida sobre el pago auxiliar ("no se eliminará... quedará marcado como anulado")`, () => {
    assert.ok(text.includes('El pago seleccionado no se eliminará. Quedará marcado como anulado y conservará su historial.'));
  });

  caso(`CASO 55 [${label}] — envía los parámetros al RPC correct_historical_payment con los nombres exactos del RPC propuesto`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("sb.rpc('correct_historical_payment',{"));
    for (const param of ['p_payment_id', 'p_new_total_amount', 'p_reason', 'p_applied_due_stage', 'p_second_due_date', 'p_second_due_amount', 'p_void_auxiliary_payment_id', 'p_void_auxiliary_reason']) {
      assert.ok(fnBlock.includes(param), `falta el parámetro ${param}`);
    }
  });

  caso(`CASO 56 [${label}] — appliedDueStage nunca se envía como 'first' (v1 solo 'second' o null)`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("p_applied_due_stage:wantsSecondDue?'second':null"));
  });

  caso(`CASO 57 [${label}] — el modal rechaza motivo vacío e importe <=0/igual al actual del lado del cliente (defensa en profundidad, el RPC vuelve a validar todo)`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("if(newTotalAmount<=0)return toast("));
    assert.ok(fnBlock.includes("if(newTotalAmount===roundServiceMoney(Number(payment.total_amount||0)))return toast("));
    assert.ok(fnBlock.includes("if(!reason)return toast("));
  });

  caso(`CASO 58 [${label}] — bloquea de entrada (antes de abrir el formulario) pagos voided/con allocations activas/con contributions inconsistentes -- UX no engañosa`, () => {
    const fnBlock = extract(text, 'function openCorrectHistoricalPaymentModal(paymentId){', 'const extra=obligationExtraFields');
    assert.ok(fnBlock.includes('if(payment.voided===true)return toast('));
    assert.ok(fnBlock.includes('if(activeAllocations.length){'));
    assert.ok(fnBlock.includes('if(pcs.length!==1){'));
  });

  caso(`CASO 59 [${label}] — historicalCorrectionAuxiliaryCandidates exige: misma obligación, distinto payment_id, vigente, sin allocations activas, sin documentos, contributions consistentes (exactamente una)`, () => {
    const fnBlock = extract(text, 'function historicalCorrectionAuxiliaryCandidates(', 'async function loadPaymentCorrectionsHistory(');
    assert.ok(fnBlock.includes('p.obligation_id!==obligationId'));
    assert.ok(fnBlock.includes('p.id===excludePaymentId'));
    assert.ok(fnBlock.includes('p.voided===true'));
    assert.ok(fnBlock.includes('paymentAllocations.some(a=>a.payment_id===p.id&&a.is_active)'));
    assert.ok(fnBlock.includes('documents.some(d=>d.payment_id===p.id)'));
    assert.ok(fnBlock.includes('pcs.length!==1'));
  });

  caso(`CASO 60 [${label}] — se agrega el bloque "Historial de correcciones" en el detalle de pago, cargado de forma asíncrona (no bloquea la apertura del modal)`, () => {
    assert.ok(text.includes('<div id="paymentCorrectionsHistory"></div>'));
    assert.ok(text.includes('Historial de correcciones'));
    assert.ok(text.includes('if(isOwner())loadPaymentCorrectionsHistory(id);'));
  });

  caso(`CASO 61 [${label}] — loadPaymentCorrectionsHistory NUNCA permite editar el historial (solo SELECT, nunca update/delete/insert sobre payment_corrections)`, () => {
    const fnBlock = extract(text, 'async function loadPaymentCorrectionsHistory(paymentId){', '\nfunction openCorrectHistoricalPaymentModal(');
    assert.ok(fnBlock.includes(".from('payment_corrections')"));
    assert.ok(fnBlock.includes('.select('));
    assert.ok(!/\.update\(|\.delete\(|\.insert\(/.test(fnBlock));
  });

  // AJUSTE (mejora #11, 20260819): annulPayment() -- el DELETE real que
  // esta suite documentaba como fuera de alcance de #7 -- fue justamente
  // lo que #11 tenía que reemplazar (anulación no destructiva vía RPC
  // void_payment). Lo que sigue siendo una garantía real de #7 es que la
  // nueva función (openAnnulPaymentModal) tampoco empiece a mezclarse con
  // el mecanismo de corrección histórica.
  caso(`CASO 62 [${label}] — openAnnulPaymentModal() (mejora #11) no se mezcla con el mecanismo de corrección histórica de #7`, () => {
    const fnBlock = extract(text, 'function openAnnulPaymentModal(paymentId){', '\n// MEJORA #7 -- CORRECCIÓN TRAZABLE');
    assert.ok(!fnBlock.includes('correct_historical_payment'), 'openAnnulPaymentModal no debe usar el mecanismo de corrección histórica');
  });

  caso(`CASO 63 [${label}] — el bloque nuevo de mejora #7 no referencia Tarjetas (creditCard/credit_card/statement/movement/card_id como código real)`, () => {
    const fnBlock = extract(text, '// MEJORA #7 -- CORRECCIÓN TRAZABLE DE PAGOS HISTÓRICOS', '\nfunction permissionSummary(');
    assert.ok(!/creditCard|credit_card|carried_balance|\bstatement_id\b|\bmovement_id\b|\bcard_id\b/i.test(fnBlock));
  });
}

caso('CASO 64 — paridad funcional exacta index.html / index_operator.html (todo el bloque nuevo de mejora #7, byte a byte)', () => {
  const blockIndex = extract(indexText, '// MEJORA #7 -- CORRECCIÓN TRAZABLE DE PAGOS HISTÓRICOS', '\nfunction permissionSummary(');
  const blockOperator = extract(operatorText, '// MEJORA #7 -- CORRECCIÓN TRAZABLE DE PAGOS HISTÓRICOS', '\nfunction permissionSummary(');
  assert.strictEqual(blockIndex, blockOperator, 'el bloque nuevo debe ser byte-idéntico entre ambos archivos');
});

caso('CASO 65 — Tarjetas permanece byte-idéntica en funciones core tras esta mejora', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_mejora_7_correccion_pagos_20260818_020000', `${f}.antes_mejora7`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
  }
});

// AJUSTE (mejora #11, 20260819): annulPayment() dejó de existir con ese
// nombre/implementación -- fue reemplazada por completo, de forma
// legítima y autorizada, por openAnnulPaymentModal() (ver mejora #11,
// anulación no destructiva de pagos). Ya no corresponde exigir identidad
// byte a byte contra un backup de antes de esa mejora.
//
// AJUSTE (BUGFIX #12 FASE 2B, 20260821): openCorrectHistoricalPaymentModal()
// dejó de ser byte-idéntica a partir de acá, de forma legítima y
// autorizada -- FASE 2B pidió explícitamente agregar la pregunta "¿Esta
// diferencia corresponde a este mismo período?" cuando el importe
// corregido supera el importe económico vigente, reordenar la ejecución
// en RPC-primero/metadata-después, y manejar el error parcial. Ya no
// corresponde exigir identidad byte a byte contra el backup previo a esa
// FASE -- en su lugar se verifica que el RPC y sus 8 parámetros exactos
// (ya cubiertos por CASO 55) y los guards de entrada (CASO 48/58) sigan
// intactos, y que el orden RPC-antes-que-metadata esté presente en el
// código real.
caso('CASO 66 — correct_historical_payment() sigue siendo el único RPC real de corrección de pagos históricos, invocado ANTES de cualquier escritura de metadata (orden RPC -> effectivePeriodAmount preservado tras FASE 2B)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const now = f === 'index.html' ? indexText : operatorText;
    const fnBlock = extract(now, 'function openCorrectHistoricalPaymentModal(paymentId){', '\nfunction permissionSummary(');
    const rpcIndex = fnBlock.indexOf("sb.rpc('correct_historical_payment',{");
    const metaIndex = fnBlock.indexOf("extraFields:newExtraForHistory");
    assert.ok(rpcIndex !== -1, `[${f}] debe seguir llamando al RPC correct_historical_payment`);
    assert.ok(metaIndex !== -1, `[${f}] debe seguir pudiendo guardar effectivePeriodAmount tras el RPC`);
    assert.ok(rpcIndex < metaIndex, `[${f}] el RPC debe ejecutarse ANTES que cualquier escritura de effectivePeriodAmount`);
  }
});

// ============================================================
// PARTE C — CASO MODELADO (49.733,00 + 0,69 -> 49.907,71), lógica REAL
// extraída, datos SINTÉTICOS -- CASO 35/36 del pedido de Guido.
// ============================================================

caso('CASO 67 — ANTES de corregir: dos pagos vigentes suman exactamente 49.733,69 (el registro histórico incorrecto)', () => {
  const sb = buildSandbox({});
  const paymentsBefore = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49733.00, voided: false, notes: null, paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: false, notes: null, paid_at: '2026-08-05' },
  ];
  const paid = sb.paidAmountForWithAllocations('o1', paymentsBefore, []);
  assert.strictEqual(paid, 49733.69);
});

caso('CASO 68 — DESPUÉS de corregir (payment principal a 49.907,71 + appliedDueStage second, auxiliar SIN anular todavía): confirma que sin anular el auxiliar quedaría 49.908,40 -- por eso la anulación del auxiliar es obligatoria en este caso', () => {
  const sb = buildSandbox({});
  const paymentsPartial = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49907.71, voided: false, notes: '{"appliedDueStage":"second"}', paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: false, notes: null, paid_at: '2026-08-05' },
  ];
  const paid = sb.paidAmountForWithAllocations('o1', paymentsPartial, []);
  assert.strictEqual(paid, 49908.40, 'sin anular el auxiliar, el total contado sería incorrecto (49.908,40) -- por eso la corrección DEBE incluir la anulación del auxiliar en este caso real');
});

caso('CASO 69 — DESPUÉS de la corrección COMPLETA (payment principal a 49.907,71 + auxiliar voided=true): el total pagado vigente es EXACTAMENTE 49.907,71, nunca 49.733,69 ni 49.908,40', () => {
  const sb = buildSandbox({});
  const paymentsAfter = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49907.71, voided: false, notes: '{"appliedDueStage":"second"}', paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: true, notes: null, paid_at: '2026-08-05' },
  ];
  const paid = sb.paidAmountForWithAllocations('o1', paymentsAfter, []);
  assert.strictEqual(paid, 49907.71);
  assert.notStrictEqual(paid, 49733.69);
  assert.notStrictEqual(paid, 49908.40);
});

caso('CASO 70 — UN único pago económico vigente: el auxiliar anulado deja de contar como pago, aunque la fila siga existiendo (no destructivo)', () => {
  const sb = buildSandbox({});
  const paymentsAfter = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49907.71, voided: false, notes: '{"appliedDueStage":"second"}', paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: true, notes: null, paid_at: '2026-08-05' },
  ];
  assert.strictEqual(paymentsAfter.length, 2, 'la fila del auxiliar sigue existiendo -- no se elimina');
  assert.strictEqual(sb.paymentAppliedDueStage(paymentsAfter[0]), 'second');
});

caso('CASO 71 — effectiveObligationAmount() usa el segundo importe corregido (49.907,71) cuando hay un pago vigente marcado appliedDueStage=second con secondDueDate+secondAmount cargados -- mismo modelo real ya publicado, sin inventar uno nuevo', () => {
  const sb = buildSandbox({});
  const obligation = {
    id: 'o1',
    amount: 49733.69,
    due_date: '2026-08-10',
    notes: '[[OBLIGATION_META:{"extraFields":{"secondDueDate":"2026-08-20","secondAmount":49907.71}}]]',
  };
  const payments = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49907.71, voided: false, notes: '{"appliedDueStage":"second"}', paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: true, notes: null, paid_at: '2026-08-05' },
  ];
  assert.strictEqual(sb.obligationExtraFields(obligation).secondAmount, 49907.71);
  assert.strictEqual(sb.obligationHasSecondStagePayment('o1', payments), true);
  const effective = sb.effectiveObligationAmount(obligation, payments, []);
  assert.strictEqual(effective, 49907.71);
});

caso('CASO 72 — NO se genera crédito ficticio: con el importe exigible corregido a 49.907,71 y lo pagado en 49.907,71, el saldo y el crédito a favor son EXACTAMENTE 0 -- nunca 174,02 ni ningún otro remanente', () => {
  const sb = buildSandbox({});
  const obligation = {
    id: 'o1',
    amount: 49733.69,
    due_date: '2026-08-10',
    notes: '[[OBLIGATION_META:{"extraFields":{"secondDueDate":"2026-08-20","secondAmount":49907.71}}]]',
  };
  const payments = [
    { id: 'p-principal', obligation_id: 'o1', total_amount: 49907.71, voided: false, notes: '{"appliedDueStage":"second"}', paid_at: '2026-08-05' },
    { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: true, notes: null, paid_at: '2026-08-05' },
  ];
  const amount = sb.effectiveObligationAmount(obligation, payments, []);
  const paid = sb.paidAmountForWithAllocations('o1', payments, []);
  const signedBalance = sb.roundServiceMoney(amount - paid);
  const balance = Math.max(0, signedBalance);
  const creditBalance = Math.max(0, -signedBalance);
  assert.strictEqual(balance, 0);
  assert.strictEqual(creditBalance, 0);
  assert.notStrictEqual(creditBalance, 174.02, 'nunca debe aparecer un crédito ficticio de 174,02 (49907.71-49733.69) cuando el importe exigible efectivo YA es 49.907,71');
});

caso('CASO 73 — historicalCorrectionAuxiliaryCandidates(): el pago de $0,69 es candidato ANTES de anularlo (misma obligación, vigente, sin allocations/documentos, contribution consistente)', () => {
  const sb = buildSandbox({
    payments: [
      { id: 'p-principal', obligation_id: 'o1', total_amount: 49733.00, voided: false },
      { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: false },
    ],
    contributions: [
      { payment_id: 'p-principal', amount: 49733.00 },
      { payment_id: 'p-aux', amount: 0.69 },
    ],
  });
  const candidates = sb.historicalCorrectionAuxiliaryCandidates('o1', 'p-principal');
  assert.deepStrictEqual(candidates.map(p => p.id), ['p-aux']);
});

caso('CASO 74 — historicalCorrectionAuxiliaryCandidates(): un pago con documento asociado NUNCA es candidato (aunque cumpla el resto)', () => {
  const sb = buildSandbox({
    payments: [
      { id: 'p-principal', obligation_id: 'o1', total_amount: 49733.00, voided: false },
      { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: false },
    ],
    contributions: [
      { payment_id: 'p-principal', amount: 49733.00 },
      { payment_id: 'p-aux', amount: 0.69 },
    ],
    documents: [{ id: 'd1', payment_id: 'p-aux', kind: 'receipt' }],
  });
  const candidates = sb.historicalCorrectionAuxiliaryCandidates('o1', 'p-principal');
  assert.deepStrictEqual(candidates.map(p => p.id), []);
});

caso('CASO 75 — historicalCorrectionAuxiliaryCandidates(): un pago con allocation activa NUNCA es candidato', () => {
  const sb = buildSandbox({
    payments: [
      { id: 'p-principal', obligation_id: 'o1', total_amount: 49733.00, voided: false },
      { id: 'p-aux', obligation_id: 'o1', total_amount: 0.69, voided: false },
    ],
    contributions: [
      { payment_id: 'p-principal', amount: 49733.00 },
      { payment_id: 'p-aux', amount: 0.69 },
    ],
    paymentAllocations: [{ payment_id: 'p-aux', obligation_id: 'o2', allocated_amount: 0.69, is_active: true }],
  });
  const candidates = sb.historicalCorrectionAuxiliaryCandidates('o1', 'p-principal');
  assert.deepStrictEqual(candidates.map(p => p.id), []);
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
  console.log('AVISO: valida lógica real extraída + auditoría estática de la migración propuesta, NO ejecución real contra Postgres/Supabase. Caso Mercado Pago/Edesur modelado con datos SINTÉTICOS, nunca datos reales.');
  if (fail > 0) process.exitCode = 1;
}

run();
