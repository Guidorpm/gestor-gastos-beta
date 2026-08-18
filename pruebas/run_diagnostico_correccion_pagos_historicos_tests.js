// ============================================================
// PRUEBA LOCAL — Diagnóstico read-only de corrección de pagos históricos
// (mejora #7, FASE 1: auditoría + diseño, NO programar todavía, 20260818)
// ------------------------------------------------------------
// Este diagnóstico NO fue ejecutado contra Supabase (sin acceso de
// ejecución en esta sesión, y detenido a propósito hasta autorización
// explícita). Esta prueba audita ESTÁTICAMENTE el contenido real del
// archivo SQL preparado -- confirma que es 100% de solo lectura y que
// cubre los puntos pedidos, nunca ejecuta nada contra una base real.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migrationPath = path.join(ROOT, 'migraciones', '6b13_DIAGNOSTICO_CORRECCION_PAGOS_HISTORICOS_SOLO_LECTURA_20260818.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const consolidatedPath = path.join(ROOT, 'migraciones', '6b13_DIAGNOSTICO_CORRECCION_PAGOS_HISTORICOS_CONSOLIDADO_SOLO_LECTURA_20260818.sql');
const consolidatedSql = fs.readFileSync(consolidatedPath, 'utf8');
const indexPath = path.join(ROOT, 'index.html');
const operatorPath = path.join(ROOT, 'index_operator.html');
const indexText = fs.readFileSync(indexPath, 'utf8');
const operatorText = fs.readFileSync(operatorPath, 'utf8');

// Igual que en la suite de auditoría de mejora #6: quita el contenido de
// comentarios de línea (--) y de literales de cadena ('...') antes de
// buscar palabras clave peligrosas, para no confundir un string literal
// (ej. 'INSERT' pasado a has_table_privilege) con código SQL real.
function stripCommentsAndStringLiterals(text) {
  const withoutLineComments = text
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return withoutLineComments.replace(/'(?:[^']|'')*'/g, "''");
}

const codeOnly = stripCommentsAndStringLiterals(sql);

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — 100% READ-ONLY
// ============================================================

caso('CASO 1 — el diagnóstico 6b13 es 100% de solo lectura (sin INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE como código real)', () => {
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(codeOnly), 'no debe quedar ningún comando de escritura como código SQL real');
});

caso('CASO 2 — no crea, altera ni borra ninguna policy', () => {
  assert.ok(!/CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i.test(codeOnly));
});

caso('CASO 3 — no otorga ni revoca privilegios (GRANT/REVOKE) como código real', () => {
  assert.ok(!/\bGRANT\b|\bREVOKE\b/i.test(codeOnly));
});

caso('CASO 4 — no modifica RLS (ENABLE/DISABLE ROW LEVEL SECURITY)', () => {
  assert.ok(!/ENABLE\s+ROW|DISABLE\s+ROW/i.test(codeOnly));
});

caso('CASO 5 — no toca Storage (sin storage.objects/storage.buckets/remove)', () => {
  assert.ok(!/storage\.objects|storage\.buckets/i.test(sql));
  assert.ok(!/\.remove\(/.test(sql));
});

caso('CASO 6 — el archivo se declara explícitamente NO EJECUTAR sin autorización', () => {
  assert.ok(/NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA/i.test(sql));
});

caso('CASO 7 — está compuesto exclusivamente por sentencias SELECT top-level (27 declaradas)', () => {
  const selects = (sql.match(/^SELECT/gm) || []).length;
  assert.strictEqual(selects, 27, `se esperaban 27 SELECT top-level, se encontraron ${selects}`);
});

caso('CASO 8 — el UUID del caso Mercado Pago NO está hardcodeado (búsqueda por evidencia, no por id)', () => {
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'no debe contener ningún UUID literal');
});

// ============================================================
// PARTE B — COBERTURA DE CONTENIDO (los 14 puntos pedidos sobre payments
// + los puntos A-G de payment_allocations + documents + caso Mercado Pago)
// ============================================================

caso('CASO 9 — cubre columnas/tipos de payments (information_schema.columns)', () => {
  assert.ok(/table_name='payments'/.test(sql));
  assert.ok(sql.includes('is_nullable') && sql.includes('column_default'));
});

caso('CASO 10 — cubre PK de payments', () => {
  assert.ok(/constraint_type='PRIMARY KEY'/.test(sql) && /table_name='payments'/.test(sql));
});

caso('CASO 11 — cubre FK y ON DELETE de payments (pg_get_constraintdef)', () => {
  assert.ok(sql.includes("con.conrelid='public.payments'::regclass AND con.contype='f'"));
});

caso('CASO 12 — cubre CHECK constraints de payments', () => {
  assert.ok(sql.includes("con.conrelid='public.payments'::regclass AND con.contype='c'"));
});

caso('CASO 13 — cubre UNIQUE constraints de payments', () => {
  assert.ok(sql.includes("con.conrelid='public.payments'::regclass AND con.contype='u'"));
});

caso('CASO 14 — cubre índices reales de payments (pg_indexes)', () => {
  assert.ok(sql.includes("tablename='payments'") && sql.includes('pg_indexes'));
});

caso('CASO 15 — cubre triggers reales de payments (pg_trigger)', () => {
  assert.ok(sql.includes("t.tgrelid='public.payments'::regclass"));
});

caso('CASO 16 — cubre RLS habilitado en payments (pg_class.relrowsecurity)', () => {
  assert.ok(sql.includes('relrowsecurity') && sql.includes("oid='public.payments'::regclass"));
});

caso('CASO 17 — cubre policies SELECT/INSERT/UPDATE/DELETE de payments (pg_policies)', () => {
  assert.ok(sql.includes("tablename='payments'") && sql.includes('pg_policies'));
  assert.ok(sql.includes('qual, with_check'));
});

caso('CASO 18 — cubre grants efectivos de authenticated sobre payments (has_table_privilege)', () => {
  assert.ok(sql.includes("has_table_privilege('authenticated','public.payments','SELECT')"));
  assert.ok(sql.includes("has_table_privilege('authenticated','public.payments','INSERT')"));
  assert.ok(sql.includes("has_table_privilege('authenticated','public.payments','UPDATE')"));
  assert.ok(sql.includes("has_table_privilege('authenticated','public.payments','DELETE')"));
});

caso('CASO 19 — cubre funciones usadas por policies (pg_proc en public/private)', () => {
  assert.ok(sql.includes("n.nspname IN ('public','private')"));
});

caso('CASO 20 — cubre historial/auditoría ya existente en payments (columnas completas, incluye voided_at/voided_by/void_reason si existen -- sin asumir su ausencia)', () => {
  const sectionA1 = sql.slice(sql.indexOf('-- A1)'), sql.indexOf('-- A2)'));
  assert.ok(sectionA1.includes('column_name'), 'A1 debe listar TODAS las columnas, sin filtrar por nombre conocido');
});

caso('CASO 21 — cubre payment_allocations: qué ocurre si total_amount cambia (auditoría real de sobregiro potencial)', () => {
  assert.ok(sql.includes("FROM public.payments p") && sql.includes('JOIN public.payment_allocations pa'));
  assert.ok(sql.includes('remanente_sin_asignar'));
});

caso('CASO 22 — confirma si existe o no un trigger en payments que revalide allocations al cambiar total_amount (riesgo central de la mejora)', () => {
  const sectionB4 = sql.slice(sql.indexOf('-- B4)'), sql.indexOf('-- B5)'));
  assert.ok(sectionB4.includes("t.tgrelid='public.payments'::regclass"));
});

caso('CASO 23 — cubre FK/ON DELETE real de payment_allocations y payment_contributions hacia payments (annulPayment asume CASCADE sin confirmación SQL previa)', () => {
  assert.ok(sql.includes("con.conrelid='public.payment_allocations'::regclass AND con.contype='f'"));
  assert.ok(sql.includes("con.conrelid='public.payment_contributions'::regclass AND con.contype='f'"));
});

caso('CASO 24 — cubre consistencia payment_contributions vs total_amount', () => {
  assert.ok(sql.includes('contributions_total'));
});

caso('CASO 25 — cubre relación documents.payment_id -> payments.id (FK real + huérfanos)', () => {
  assert.ok(sql.includes("con.conrelid='public.documents'::regclass AND con.contype='f'"));
  assert.ok(sql.includes('LEFT JOIN public.payments p ON p.id=d.payment_id'));
});

caso('CASO 26 — diagnóstico específico del caso Mercado Pago: búsqueda por importe con tolerancia, sin asumir la diferencia como interés/recargo/comisión', () => {
  assert.ok(sql.includes('BETWEEN 49000.00 AND 50500.00'));
  assert.ok(!/\binteres\b|\brecargo\b|\bcomision\b/i.test(sql.replace(/--.*$/gm, '')), 'el diagnóstico no debe presuponer la clasificación contable de la diferencia');
});

caso('CASO 27 — diagnóstico específico del caso Mercado Pago: búsqueda por servicio (Edesur/Mercado Pago) sin UUID', () => {
  assert.ok(/ILIKE\s+'%edesur%'/i.test(sql));
  assert.ok(/ILIKE\s+'%mercado%pago%'/i.test(sql) || /ILIKE\s+'%mercadopago%'/i.test(sql));
});

caso('CASO 28 — diagnóstico específico del caso Mercado Pago: detecta pagos adicionales históricos para la misma obligación (posible compensación de la limitación antigua)', () => {
  const sectionE3 = sql.slice(sql.indexOf('-- E3)'), sql.indexOf('-- E4)'));
  assert.ok(sectionE3.includes('LEFT JOIN public.payments p ON p.obligation_id=o.id'), 'debe traer TODOS los payments de la obligación, no solo uno');
});

caso('CASO 29 — diagnóstico específico del caso Mercado Pago: allocations activas de los pagos candidatos (riesgo de duplicar dinero si ya se usó como crédito)', () => {
  const sectionE4 = sql.slice(sql.indexOf('-- E4)'), sql.indexOf('-- E5)'));
  assert.ok(sectionE4.includes('payment_allocations'));
});

caso('CASO 30 — diagnóstico específico del caso Mercado Pago: documentos/comprobantes asociados a los pagos candidatos', () => {
  const sectionE5 = sql.slice(sql.indexOf('-- E5)'));
  assert.ok(sectionE5.includes('FROM public.documents d'));
});

// ============================================================
// PARTE C — DIAGNÓSTICO CONSOLIDADO (una sola sentencia, JSON único)
// ------------------------------------------------------------
// El archivo consolidado NO reemplaza al de 27 SELECT (PARTE A/B arriba)
// -- ambos siguen existiendo. Esta parte audita ESTÁTICAMENTE el
// contenido real del archivo consolidado, con el mismo criterio de
// "solo lectura" ya usado arriba y en la suite de mejora #6.
// ============================================================

const consolidatedCodeOnly = stripCommentsAndStringLiterals(consolidatedSql);

caso('CASO 31 — el archivo consolidado existe', () => {
  assert.ok(fs.existsSync(consolidatedPath));
});

caso('CASO 32 — el diagnóstico original de 27 SELECT NO fue reemplazado ni borrado', () => {
  assert.ok(fs.existsSync(migrationPath));
  const selects = (sql.match(/^SELECT/gm) || []).length;
  assert.strictEqual(selects, 27);
});

caso('CASO 33 — el archivo consolidado contiene exactamente UNA sentencia top-level (un solo ";" real, fuera de comentarios)', () => {
  const withoutComments = consolidatedSql.split('\n').map(l => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.slice(0, idx);
  }).join('\n');
  const semicolons = (withoutComments.match(/;/g) || []).length;
  assert.strictEqual(semicolons, 1, `debe haber exactamente 1 ";" real, se encontraron ${semicolons}`);
});

caso('CASO 34 — la sentencia es WITH ... SELECT (no un bloque de múltiples SELECT independientes)', () => {
  const firstCodeLine = consolidatedSql.split('\n').find(l => l.trim() && !l.trim().startsWith('--'));
  assert.strictEqual(firstCodeLine.trim(), 'WITH');
  const finalSelectIdx = consolidatedSql.lastIndexOf('SELECT jsonb_build_object(');
  assert.ok(finalSelectIdx !== -1, 'debe existir un SELECT jsonb_build_object(...) final');
  assert.ok(finalSelectIdx > consolidatedSql.indexOf('mercado_pago_detail AS ('), 'el SELECT final debe venir después de la última CTE');
});

caso('CASO 35 — balance de paréntesis correcto (tokenizer consciente de comentarios/strings, termina en profundidad 0)', () => {
  let depth = 0, minDepth = 0, inLineComment = false, inString = false;
  for (let i = 0; i < consolidatedSql.length; i++) {
    const c = consolidatedSql[i];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inString) {
      if (c === "'") {
        if (consolidatedSql[i + 1] === "'") { i++; continue; }
        inString = false;
      }
      continue;
    }
    if (c === '-' && consolidatedSql[i + 1] === '-') { inLineComment = true; i++; continue; }
    if (c === "'") { inString = true; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; if (depth < minDepth) minDepth = depth; continue; }
  }
  assert.strictEqual(depth, 0, 'los paréntesis deben cerrar exactamente');
  assert.strictEqual(minDepth, 0, 'nunca debe cerrarse un paréntesis que no estaba abierto');
  assert.ok(!inString, 'no debe terminar dentro de un string literal');
  assert.ok(!inLineComment, 'no debe terminar dentro de un comentario de línea');
});

caso('CASO 36 — devuelve un único objeto JSON/JSONB (jsonb_build_object en el SELECT final, con alias)', () => {
  assert.ok(/SELECT\s+jsonb_build_object\(/.test(consolidatedSql));
  assert.ok(/\)\s+AS\s+diagnostico_6b13_consolidado;/.test(consolidatedSql));
});

caso('CASO 37 — el consolidado es 100% de solo lectura (sin INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE como código real)', () => {
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(consolidatedCodeOnly), 'no debe quedar ningún comando de escritura como código SQL real');
});

caso('CASO 38 — el consolidado no crea, altera ni borra ninguna policy, ni cambia RLS', () => {
  assert.ok(!/CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY|ENABLE\s+ROW|DISABLE\s+ROW/i.test(consolidatedCodeOnly));
});

caso('CASO 39 — el consolidado no toca Storage', () => {
  assert.ok(!/storage\.objects|storage\.buckets/i.test(consolidatedSql));
  assert.ok(!/\.remove\(/.test(consolidatedSql));
});

caso('CASO 40 — el consolidado no referencia Tarjetas (cards/statements/movements/credit_card_*)', () => {
  assert.ok(!/creditCard|credit_card|carried_balance|card_receipt|\bstatements\b|\bmovements\b/i.test(consolidatedCodeOnly));
});

caso('CASO 41 — el consolidado se declara NO EJECUTAR sin autorización', () => {
  assert.ok(/NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA/i.test(consolidatedSql));
});

caso('CASO 42 — el UUID del caso Mercado Pago NO está hardcodeado en el consolidado', () => {
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(consolidatedSql));
});

caso('CASO 43 — cubre payments schema completo (columnas/PK/FK/CHECK/UNIQUE/índices/triggers/RLS) como claves JSON explícitas', () => {
  for (const key of ['payments_columns', 'payments_pk', 'payments_fk', 'payments_check', 'payments_unique', 'payments_indexes', 'payments_triggers', 'payments_rls']) {
    assert.ok(consolidatedSql.includes(`'${key}'`), `debe existir la clave ${key}`);
  }
});

caso('CASO 44 — cubre explícitamente las columnas voided/voided_at/voided_by/void_reason/notes/total_amount de payments', () => {
  assert.ok(consolidatedSql.includes('payments_focus_columns'));
  assert.ok(consolidatedSql.includes("'voided','voided_at','voided_by','void_reason','notes','total_amount'"));
});

caso('CASO 45 — cubre policies SELECT/INSERT/UPDATE/DELETE de payments Y un foco explícito en las de UPDATE (para decidir permisos de "Corregir pago")', () => {
  assert.ok(consolidatedSql.includes('payments_policies'));
  assert.ok(consolidatedSql.includes('payments_update_policies'));
  assert.ok(consolidatedSql.includes("pol.cmd IN ('UPDATE','ALL')"));
});

caso('CASO 46 — cubre funciones public/private usadas por policies (policy_functions)', () => {
  assert.ok(consolidatedSql.includes("n.nspname IN ('public','private')"));
});

caso('CASO 47 — cubre payment_allocations: schema, FK, constraints, triggers, y la definición REAL de check_payment_allocation_integrity()', () => {
  for (const key of ['allocations_columns', 'allocations_fk', 'allocations_constraints', 'allocations_triggers', 'check_integrity_function_definition']) {
    assert.ok(consolidatedSql.includes(`'${key}'`), `debe existir la clave ${key}`);
  }
  assert.ok(consolidatedSql.includes("p.proname='check_payment_allocation_integrity'"));
});

caso('CASO 48 — confirma con datos reales si existe algún trigger sobre payments que revalide allocations al cambiar total_amount', () => {
  assert.ok(consolidatedSql.includes('payments_triggers_revalidating_allocations'));
});

caso('CASO 49 — por cada payment con allocations activas: total_amount, suma allocated_amount, diferencia y cantidad', () => {
  const block = consolidatedSql.slice(consolidatedSql.indexOf('allocations_summary_per_payment AS ('), consolidatedSql.indexOf('allocations_overallocated AS ('));
  assert.ok(block.includes('payment_total_amount'));
  assert.ok(block.includes('allocated_activo_total'));
  assert.ok(block.includes('diferencia'));
  assert.ok(block.includes('cantidad_allocations_activas'));
});

caso('CASO 50 — detecta pagos actualmente sobreasignados (allocations activas > total_amount), sin asumir que no existen', () => {
  assert.ok(consolidatedSql.includes('allocations_overallocated'));
  assert.ok(consolidatedSql.includes('sub.allocated_activo_total > p.total_amount'));
});

caso('CASO 51 — cubre payment_contributions: schema, FK, constraints y triggers reales (responde si hay algo que garantice la igualdad con total_amount)', () => {
  for (const key of ['contributions_columns', 'contributions_fk', 'contributions_constraints', 'contributions_triggers']) {
    assert.ok(consolidatedSql.includes(`'${key}'`), `debe existir la clave ${key}`);
  }
});

caso('CASO 52 — pregunta A/C: por cada payment, total_amount vs. suma de contributions, diferencia y cantidad (sin asumir que siempre coinciden)', () => {
  assert.ok(consolidatedSql.includes('contributions_summary_per_payment'));
  const block = consolidatedSql.slice(consolidatedSql.indexOf('contributions_summary_per_payment AS ('), consolidatedSql.indexOf('contributions_mismatch AS ('));
  assert.ok(block.includes('contributions_total'));
  assert.ok(block.includes('cantidad_contributions'));
});

caso('CASO 53 — pregunta C aislada: subconjunto explícito de payments donde total_amount NO coincide con la suma de contributions', () => {
  assert.ok(consolidatedSql.includes('contributions_mismatch'));
  const block = consolidatedSql.slice(consolidatedSql.indexOf('contributions_mismatch AS ('), consolidatedSql.indexOf('documents_payment_fk AS ('));
  assert.ok(block.includes('p.total_amount <> COALESCE(sub.contributions_total,0)'));
});

caso('CASO 54 — cubre documents<->payments: FK real con ON DELETE, cantidad de documentos por payment, y huérfanos', () => {
  for (const key of ['documents_payment_fk', 'documents_count_per_payment', 'documents_orphans']) {
    assert.ok(consolidatedSql.includes(`'${key}'`), `debe existir la clave ${key}`);
  }
});

caso('CASO 55 — documents_count_per_payment no descarga archivos, solo cuenta filas (sin file_path ni Storage)', () => {
  const block = consolidatedSql.slice(consolidatedSql.indexOf('documents_count_per_payment AS ('), consolidatedSql.indexOf('documents_orphans AS ('));
  assert.ok(!/storage/i.test(block));
});

caso('CASO 56 — caso Mercado Pago: localiza candidatos por importe (sin UUID) cubriendo tanto ~49.907,71 (comprobante real) como ~49.733 (registro histórico)', () => {
  assert.ok(consolidatedSql.includes('mercado_pago_candidate_payments'));
  const block = consolidatedSql.slice(consolidatedSql.indexOf('mercado_pago_candidate_payments AS ('), consolidatedSql.indexOf('mercado_pago_candidate_services AS ('));
  const match = block.match(/BETWEEN\s+([\d.]+)\s+AND\s+([\d.]+)/i);
  assert.ok(match, 'debe existir un rango BETWEEN');
  const low = Number(match[1]), high = Number(match[2]);
  assert.ok(low <= 49733 && high >= 49907.71, `el rango [${low},${high}] debe cubrir 49.733 y 49.907,71`);
});

caso('CASO 57 — caso Mercado Pago: también busca por nombre de servicio (Edesur/Mercado Pago/Muebles del Plata), sin depender solo del importe', () => {
  const block = consolidatedSql.slice(consolidatedSql.indexOf('mercado_pago_candidate_services AS ('), consolidatedSql.indexOf('mercado_pago_candidate_obligations AS ('));
  assert.ok(/ILIKE\s+'%edesur%'/i.test(block));
  assert.ok(/ILIKE\s+'%mercado%pago%'/i.test(block) || /ILIKE\s+'%mercadopago%'/i.test(block));
  assert.ok(/ILIKE\s+'%muebles%plata%'/i.test(block));
});

caso('CASO 58 — caso Mercado Pago: el detalle por obligación candidata trae servicio, obligación completa (con notes), TODOS sus payments (no solo el candidato), contributions, allocations y documentos', () => {
  const block = consolidatedSql.slice(consolidatedSql.indexOf('mercado_pago_detail AS ('));
  for (const field of ['service_name', 'service_is_private', 'obligation_notes', 'suma_payments_no_anulados', "'payments'", 'contributions', 'allocations', "'documents'", 'invoice_documents']) {
    assert.ok(block.includes(field), `el detalle debe incluir ${field}`);
  }
  assert.ok(block.includes('WHERE p.obligation_id=o.id'), 'debe traer TODOS los payments de la obligación, no filtrar por el candidato puntual');
});

caso('CASO 59 — caso Mercado Pago: appliedDueStage se extrae por texto (regexp), tolerante a notes NULL o no-JSON -- nunca con ::jsonb que rompería la consulta ante un valor no válido', () => {
  const block = consolidatedSql.slice(consolidatedSql.indexOf('mercado_pago_detail AS ('));
  assert.ok(block.includes('applied_due_stage_desde_notes'));
  assert.ok(block.includes('regexp_match'));
  assert.ok(!/notes::jsonb/i.test(block), 'no debe castear notes a jsonb directamente (rompería con notes NULL o no-JSON)');
});

caso('CASO 60 — el diagnóstico no asume la clasificación contable de la diferencia (sin "interés"/"recargo"/"comisión" como código o etiqueta real)', () => {
  assert.ok(!/\binteres\b|\brecargo\b|\bcomision\b/i.test(consolidatedCodeOnly));
  assert.ok(consolidatedSql.toLowerCase().includes('no debe interpretarse'), 'debe advertir explícitamente que no hay que asumir la clasificación contable');
});

caso('CASO 61 — Tarjetas permanece byte-idéntica (frontend general SÍ cambió legítimamente en la FASE 2 autorizada de esta misma mejora, ver run_correccion_pagos_historicos_tests.js)', () => {
  // AJUSTE (mejora #7 FASE 2, 20260818): esta aserción originalmente
  // comparaba el SHA-256 de TODO index.html/index_operator.html contra el
  // backup de esta misma FASE 1 (diagnóstico, sin cambios de frontend
  // esperados en ese momento) -- esa premisa dejó de ser válida en cuanto
  // la FASE 2, autorizada explícitamente por Guido, implementó
  // "Corregir pago histórico" en el frontend. La garantía real que le
  // importa a ESTE archivo (un diagnóstico SQL puramente read-only, que
  // nunca tocó Tarjetas) se verifica comparando las funciones CORE de
  // Tarjetas contra el mismo backup de siempre, igual criterio que ya
  // usan las demás suites de esta serie.
  const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_mejora_7_correccion_pagos_20260818_020000', 'index.html.antes_mejora7');
  const beforeOperatorPath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_mejora_7_correccion_pagos_20260818_020000', 'index_operator.html.antes_mejora7');
  assert.ok(fs.existsSync(beforePath) && fs.existsSync(beforeOperatorPath), 'debe existir el respaldo de referencia previo');
  const before = fs.readFileSync(beforePath, 'utf8');
  const beforeOperator = fs.readFileSync(beforeOperatorPath, 'utf8');
  const extractLocal = (text, start, end) => {
    const i = text.indexOf(start);
    assert.ok(i !== -1, `no se encontró "${start}"`);
    const j = text.indexOf(end, i);
    assert.ok(j !== -1, `no se encontró "${end}"`);
    return text.slice(i, j);
  };
  for (const [now, ref, label] of [[indexText, before, 'index.html'], [operatorText, beforeOperator, 'index_operator.html']]) {
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extractLocal(now, `function ${fnName}(`, '\nfunction '),
        extractLocal(ref, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
});

caso('CASO 62 — ningún archivo de esta tarea toca Tarjetas (grep negativo sobre ambos SQL de mejora #7)', () => {
  assert.ok(!/creditCard|credit_card|carried_balance/i.test(sql + consolidatedSql));
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
  console.log('AVISO: valida SOLO el contenido estático del diagnóstico preparado, NO ejecución real contra Postgres/Supabase. Ningún dato fue leído ni modificado.');
  if (fail > 0) process.exitCode = 1;
}

run();
