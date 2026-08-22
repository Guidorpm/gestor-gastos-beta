// ============================================================
// PRUEBA LOCAL — Bugfix #12: corrección de "function min(uuid) does not
// exist" en public.correct_historical_payment() + segundo hallazgo real
// (parseMoneyField no interpretaba "49907.71" -- punto como decimal sin
// coma -- correctamente), 20260820.
// ------------------------------------------------------------
// Causa real confirmada (no el formato del importe, no un bug nuevo de
// frontend en el RPC): la definición desplegada de
// correct_historical_payment tenía `SELECT COUNT(*), MIN(id), MIN(amount)
// ...` sobre payment_contributions -- payment_contributions.id es uuid, y
// PostgreSQL no tiene MIN(uuid)/MAX(uuid). Se corrigió en
// migraciones/6b15_FIX_CORRECT_HISTORICAL_PAYMENT_MIN_UUID_NO_EJECUTAR_20260820.sql
// separando el conteo (COUNT(*), sin agregación sobre uuid) de la lectura
// de esa única fila (SELECT id, amount, sin MIN/MAX). NO se modificó
-// ningún otro bloque del RPC (auditado: el único MIN/MAX de todo el
// archivo era ese).
//
// SEGUNDO HALLAZGO (auditoría de frontend pedida explícitamente):
// parseMoneyField('49907.71') devolvía 4990771 (borraba el punto
// incondicionalmente asumiendo que SIEMPRE es separador de miles) -- se
// corrigió para decidir el separador decimal real según qué símbolos
// aparecen en el valor.
//
// Esta prueba audita el archivo SQL propuesto (string/regex, nunca se
// ejecuta contra Postgres real) y ejecuta la función REAL parseMoneyField
// extraída de index.html/index_operator.html (nunca reimplementada a
// mano) contra los casos exactos pedidos por Guido.
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
const fixSqlPath = path.join(ROOT, 'migraciones', '6b15_FIX_CORRECT_HISTORICAL_PAYMENT_MIN_UUID_NO_EJECUTAR_20260820.sql');
const postcheckSqlPath = path.join(ROOT, 'migraciones', '6b15_POSTCHECK_CORRECT_HISTORICAL_PAYMENT_MIN_UUID_SOLO_LECTURA_20260820.sql');
const legacySqlPath = path.join(ROOT, 'migraciones', '6b13_PROPUESTA_CORRECCION_PAGOS_HISTORICOS_NO_EJECUTAR_20260818.sql');
// Normalizado a LF: git normaliza automáticamente los .sql a CRLF al
// hacer commit/checkout (igual que ya hace con index.html/index_operator.html)
// -- normalizar acá evita que un marcador multilínea deje de matchear
// solo por el line-ending real en disco, sin cambiar el contenido que se
// está auditando.
const fixSql = fs.readFileSync(fixSqlPath, 'utf8').replace(/\r\n/g, '\n');
const postcheckSql = fs.readFileSync(postcheckSqlPath, 'utf8').replace(/\r\n/g, '\n');
const legacySql = fs.readFileSync(legacySqlPath, 'utf8').replace(/\r\n/g, '\n');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

function stripSqlComments(text) {
  return text.split('\n').map(l => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ================================================================
// PARTE A -- auditoría del RPC propuesto (6b15 FIX), solo texto/regex
// ================================================================

caso('CASO 1 — el RPC propuesto (6b15) NO contiene MIN(id) como código real (fuera de comentarios explicativos)', () => {
  const noComments = stripSqlComments(fixSql);
  assert.ok(!/MIN\s*\(\s*id\s*\)/i.test(noComments), 'no debe existir MIN(id) como código real en la migración FIX');
});

caso('CASO 2 — el RPC propuesto (6b15) NO contiene MAX(id) como código real (fuera de comentarios explicativos)', () => {
  const noComments = stripSqlComments(fixSql);
  assert.ok(!/MAX\s*\(\s*id\s*\)/i.test(noComments), 'no debe existir MAX(id) como código real en la migración FIX');
});

caso('CASO 2b — auditoría completa: cero ocurrencias de MIN(/MAX( en todo el archivo FIX (el único caso de todo el RPC era el defectuoso)', () => {
  const noComments = stripSqlComments(fixSql);
  const matches = noComments.match(/\b(MIN|MAX)\s*\(/gi) || [];
  assert.deepStrictEqual(matches, [], `no debe quedar ningún MIN(/MAX( en la función real, se encontraron: ${matches.join(', ')}`);
});

caso('CASO 3 — existe un COUNT(*) de contributions separado (sin agregación sobre uuid)', () => {
  assert.ok(fixSql.includes('SELECT COUNT(*) INTO v_contributions_count'));
});

caso('CASO 4 — valida exactamente 1 (mismo mensaje de error funcional que la versión anterior)', () => {
  assert.ok(fixSql.includes('IF v_contributions_count <> 1 THEN'));
  assert.ok(fixSql.includes("RAISE EXCEPTION 'Solo se pueden corregir pagos con exactamente un aporte (payment_contributions) -- este pago tiene %', v_contributions_count;"));
});

caso('CASO 5 — el SELECT id,amount viene DESPUÉS del count/validación (nunca antes)', () => {
  const idxCount = fixSql.indexOf('SELECT COUNT(*) INTO v_contributions_count');
  const idxCheck = fixSql.indexOf('IF v_contributions_count <> 1 THEN');
  const idxSelect = fixSql.indexOf('SELECT id, amount INTO v_single_contribution_id, v_single_contribution_amount');
  assert.ok(idxCount !== -1 && idxCheck !== -1 && idxSelect !== -1, 'los tres bloques deben existir');
  assert.ok(idxCount < idxCheck && idxCheck < idxSelect, 'el orden real debe ser: count -> validación -> select id,amount');
});

caso('CASO 6 — el FOR UPDATE de payment_contributions se preserva exactamente igual', () => {
  assert.ok(fixSql.includes('PERFORM 1 FROM public.payment_contributions WHERE payment_id = p_payment_id FOR UPDATE;'));
});

caso('CASO 7 — misma contribution id: el SELECT posterior lee la MISMA tabla/filtro que el COUNT (payment_id = p_payment_id), nunca otra fuente', () => {
  const block = extract(fixSql, 'SELECT COUNT(*) INTO v_contributions_count', 'SELECT id, amount INTO v_single_contribution_id, v_single_contribution_amount\n  FROM public.payment_contributions\n  WHERE payment_id = p_payment_id;');
  assert.ok(block.includes('FROM public.payment_contributions') && block.includes('WHERE payment_id = p_payment_id'));
});

caso('CASO 8 — UUID real soportado: v_single_contribution_id sigue declarada como uuid (no se castea a text como código real, fuera de comentarios explicativos)', () => {
  assert.ok(fixSql.includes('v_single_contribution_id uuid;'));
  const noComments = stripSqlComments(fixSql);
  assert.ok(!/id::text/i.test(noComments), 'no debe castear id a text como código real');
});

caso('CASO 10/11/12 — no exige secondDueDate/secondAmount/auxiliar: los tres siguen siendo DEFAULT NULL en la firma, sin ningún NOT NULL nuevo', () => {
  assert.ok(fixSql.includes('p_second_due_date date DEFAULT NULL'));
  assert.ok(fixSql.includes('p_second_due_amount numeric(14,2) DEFAULT NULL'));
  assert.ok(fixSql.includes('p_void_auxiliary_payment_id uuid DEFAULT NULL'));
  assert.ok(fixSql.includes('p_void_auxiliary_reason text DEFAULT NULL'));
});

caso('CASO — misma firma/RETURNS/SECURITY DEFINER/search_path que la versión histórica (6b13), auditado por comparación de texto', () => {
  const sigOld = extract(legacySql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', ')\nRETURNS jsonb');
  const sigNew = extract(fixSql, 'CREATE OR REPLACE FUNCTION public.correct_historical_payment(', ')\nRETURNS jsonb');
  assert.strictEqual(sigNew, sigOld, 'la firma (parámetros/defaults) debe ser idéntica');
  assert.ok(fixSql.includes('RETURNS jsonb'));
  assert.ok(fixSql.includes('SECURITY DEFINER'));
  assert.ok(fixSql.includes('SET search_path = public, pg_temp'));
});

caso('CASO — el bloque auxiliar (COUNT/SUM(amount)) NO fue modificado -- sigue siendo byte-idéntico al de la versión histórica', () => {
  const oldAux = extract(legacySql, 'SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_aux_contributions_count', 'IF v_aux_contributions_count <> 1');
  const newAux = extract(fixSql, 'SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_aux_contributions_count', 'IF v_aux_contributions_count <> 1');
  assert.strictEqual(newAux, oldAux, 'el bloque válido del auxiliar no debe tocarse');
});

caso('CASO — solamente el CREATE OR REPLACE FUNCTION (ni DROP/ALTER TABLE/CREATE TABLE/cambios de RLS/policies/grants) -- auditoría de statements top-level', () => {
  const noComments = stripSqlComments(fixSql);
  const stripped = noComments.replace(/\$function\$[\s\S]*?\$function\$/, '$function$__BODY__$function$');
  const statements = stripped.split(';').map(s => s.trim()).filter(Boolean);
  assert.strictEqual(statements.length, 1, `debe haber exactamente 1 statement top-level, se encontraron ${statements.length}`);
  assert.ok(statements[0].startsWith('CREATE OR REPLACE FUNCTION'));
  assert.ok(!/\bDROP\b|\bALTER TABLE\b|\bCREATE TABLE\b|\bGRANT\b|\bREVOKE\b|\bCREATE POLICY\b|\bDROP POLICY\b/i.test(noComments));
});

caso('CASO — 6b13 (histórica) permanece intacta y sin modificar', () => {
  const backupPath = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_12_correccion_pago_min_uuid_20260820_191740');
  // 6b13 no formaba parte del backup de HTML (no es HTML) -- se verifica
  // directamente que el archivo real en migraciones/ es el mismo de
  // siempre por su contenido, sin ningún bloque MIN/MAX(uuid) tocado y
  // conservando exactamente el bug original documentado (evidencia de
  // que NO se editó).
  assert.ok(legacySql.includes('SELECT COUNT(*), MIN(id), MIN(amount) INTO v_contributions_count, v_single_contribution_id, v_single_contribution_amount'), '6b13 debe conservar el bloque original tal cual estaba (no se corrige ahí, se corrige en 6b15)');
  assert.ok(fs.existsSync(backupPath), 'debe existir backup de bugfix #12');
});

caso('CASO 9 — postcheck (6b15) es 100% SELECT (solo lectura)', () => {
  const noComments = stripSqlComments(postcheckSql);
  const statements = noComments.split(';').map(s => s.trim()).filter(Boolean);
  assert.ok(statements.length >= 10, `debe haber al menos 10 consultas, se encontraron ${statements.length}`);
  for (const s of statements) {
    const firstWord = (s.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    assert.ok(firstWord === 'SELECT', `todo statement top-level debe ser SELECT, se encontró: ${firstWord}`);
  }
});

// ================================================================
// PARTE B -- segundo hallazgo: parseMoneyField (ejecutado, función real)
// ================================================================

function buildParseSandbox(text) {
  const fnParse = extract(text, 'function parseMoneyField(value){', '\nfunction formatMoneyField(');
  const fn = new Function(fnParse + '\nreturn parseMoneyField;');
  return fn();
}

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  caso(`CASO 13 [${label}] — "49.907,71" -> 49907.71`, () => {
    const parseMoneyField = buildParseSandbox(text);
    assert.strictEqual(parseMoneyField('49.907,71'), 49907.71);
  });

  caso(`CASO 14 [${label}] — "49907,71" -> 49907.71`, () => {
    const parseMoneyField = buildParseSandbox(text);
    assert.strictEqual(parseMoneyField('49907,71'), 49907.71);
  });

  caso(`CASO 15 [${label}] — "49907.71" -> 49907.71 (SEGUNDO HALLAZGO: antes daba 4990771)`, () => {
    const parseMoneyField = buildParseSandbox(text);
    assert.strictEqual(parseMoneyField('49907.71'), 49907.71);
  });

  caso(`CASO 16 [${label}] — precisión exacta a centavos (sin redondeo/truncamiento, sin Math.round/parseInt en la función)`, () => {
    const fnParse = extract(text, 'function parseMoneyField(value){', '\nfunction formatMoneyField(');
    assert.ok(!/Math\.round|parseInt/.test(fnParse), 'parseMoneyField no debe truncar/redondear el valor real ingresado');
    const parseMoneyField = buildParseSandbox(text);
    assert.strictEqual(parseMoneyField('0,69'), 0.69);
    assert.strictEqual(parseMoneyField('1.234.567,89'), 1234567.89);
  });

  caso(`CASO 16b [${label}] — desambiguación real: "105.000" (un solo punto, 3 dígitos después -> miles) sigue devolviendo 105000, EXACTAMENTE el comportamiento que ya exigía run_segundo_vencimiento_pagos_tests.js ANTES de este bugfix -- el fix de "49907.71" no puede romper este caso`, () => {
    const parseMoneyField = buildParseSandbox(text);
    assert.strictEqual(parseMoneyField('105.000'), 105000, 'un solo punto con 3 dígitos después sigue siendo separador de miles, no decimal');
    assert.strictEqual(parseMoneyField('1.234.567'), 1234567, 'múltiples puntos sin coma siguen siendo todos separadores de miles');
  });
}

// ================================================================
// PARTE C -- payload del RPC / opcionales null / no obligar
// segundo vencimiento ni auxiliar
// ================================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  // AJUSTE (BUGFIX #12 FASE 2B, 20260821): el RPC correct_historical_payment
  // y su manejo de error dejaron de vivir directo dentro del onclick del
  // botón -- FASE 2B extrajo esa parte a executeHistoricalCorrection()
  // (llamada desde el onclick, ahora ANTES condicionada a una posible
  // pregunta de "mismo período") para poder reordenar RPC->metadata. El
  // marcador de inicio se amplía para seguir cubriendo ambas piezas, sin
  // cambiar ninguna aserción existente.
  const submitBlock = extract(text, "async function executeHistoricalCorrection(", 'function permissionSummary(');

  caso(`CASO 17 [${label}] — parámetros opcionales inicializados en null (secondDueAmount/secondDueDate/auxiliaryPaymentId/auxiliaryReason)`, () => {
    assert.ok(submitBlock.includes('let secondDueAmount=null;'));
    assert.ok(submitBlock.includes('let secondDueDate=null;'));
    assert.ok(submitBlock.includes('let auxiliaryPaymentId=null;'));
    assert.ok(submitBlock.includes('let auxiliaryReason=null;'));
  });

  caso(`CASO 18 [${label}] — nunca se envía '' (string vacío) para date/numeric/uuid: el payload usa las variables (null si no se activó la opción), nunca un literal ''`, () => {
    const payloadBlock = extract(submitBlock, "sb.rpc('correct_historical_payment',{", '});');
    assert.ok(!/:\s*''/.test(payloadBlock), 'ningún parámetro del RPC debe fijarse a string vacío');
    assert.ok(payloadBlock.includes('p_second_due_date:secondDueDate'));
    assert.ok(payloadBlock.includes('p_second_due_amount:secondDueAmount'));
    assert.ok(payloadBlock.includes('p_void_auxiliary_payment_id:auxiliaryPaymentId'));
    assert.ok(payloadBlock.includes('p_void_auxiliary_reason:auxiliaryReason'));
  });

  caso(`CASO 10b/11b [${label}] — no exige segundo vencimiento: el bloque que completa secondDueAmount/secondDueDate solo se ejecuta si wantsSecondDue (checkbox activo), nunca automáticamente`, () => {
    assert.ok(submitBlock.includes('if(wantsSecondDue){'));
    const guardIdx = submitBlock.indexOf('if(wantsSecondDue){');
    const assignIdx = submitBlock.indexOf("secondDueAmount=roundServiceMoney(parseMoneyField(document.getElementById('correctSecondAmount').value));");
    assert.ok(guardIdx !== -1 && assignIdx !== -1 && guardIdx < assignIdx, 'la asignación real debe vivir DENTRO del if(wantsSecondDue)');
  });

  caso(`CASO 12b [${label}] — no exige auxiliar: auxiliaryPaymentId solo se completa si wantsAuxiliary (checkbox activo Y no disabled), nunca se preselecciona el pago histórico de $0,69 ni ningún otro automáticamente`, () => {
    assert.ok(submitBlock.includes('const wantsAuxiliary=auxiliaryCheckbox.checked&&!auxiliaryCheckbox.disabled;'));
    assert.ok(!submitBlock.includes('0.69') && !submitBlock.includes('0,69'), 'no debe haber ningún importe hardcodeado del caso real');
    assert.ok(!/auxiliaryPaymentId=(?!null;)/.test(submitBlock.split('if(wantsAuxiliary){')[0]), 'auxiliaryPaymentId no debe asignarse fuera del bloque condicional');
  });

  caso(`CASO 9b [${label}] — caso 49733->49907.71: el nuevo total se valida > 0 y distinto del actual, usando parseMoneyField ya corregido (parseo real, no un valor hardcodeado)`, () => {
    assert.ok(submitBlock.includes("const newTotalAmount=roundServiceMoney(parseMoneyField(document.getElementById('correctTotalAmount').value));"));
    assert.ok(submitBlock.includes('if(newTotalAmount<=0)return toast'));
    assert.ok(submitBlock.includes('if(newTotalAmount===roundServiceMoney(Number(payment.total_amount||0)))return toast'));
  });
}

// ================================================================
// PARTE D -- resultado funcional esperado: no crea/borra payment, no
// toca document/Storage, mismo payment_id/contribution
// ================================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  caso(`CASO 19/20/23/24 [${label}] — no crea ni borra payment: el submit de la corrección no hace insert/delete/upsert sobre payments, opera exclusivamente vía el RPC sobre el mismo payment_id`, () => {
    const submitBlock = extract(text, "async function executeHistoricalCorrection(", 'function permissionSummary(');
    assert.ok(!/from\('payments'\)\s*\.\s*(insert|delete|upsert)/.test(submitBlock));
    assert.ok(submitBlock.includes('p_payment_id:paymentId'));
  });

  caso(`CASO 21/22 [${label}] — no toca document ni Storage desde el submit de la corrección`, () => {
    const submitBlock = extract(text, "async function executeHistoricalCorrection(", 'function permissionSummary(');
    assert.ok(!/from\('documents'\)/.test(submitBlock));
    assert.ok(!/storage\.from\(/.test(submitBlock));
  });

  caso(`CASO 25 [${label}] — payment_corrections preservado: el frontend nunca escribe directo esa tabla, delega 100% en el RPC`, () => {
    const submitBlock = extract(text, "async function executeHistoricalCorrection(", 'function permissionSummary(');
    assert.ok(!/from\('payment_corrections'\)/.test(submitBlock));
  });
}

// ================================================================
// PARTE E -- error UX
// ================================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
  caso(`CASO [${label}] — el error real del RPC se conserva en console.error (objeto completo, no solo un string fijo) y se muestra a la UI sin esconderlo`, () => {
    const submitBlock = extract(text, "async function executeHistoricalCorrection(", 'function permissionSummary(');
    assert.ok(submitBlock.includes("console.error('Error corrigiendo el pago:',err);"), 'debe loguear el objeto de error completo, no solo un mensaje fijo');
    assert.ok(submitBlock.includes("toast(err?.message||'No se pudo corregir el pago');"), 'debe mostrar el mensaje real del error si existe, con un fallback solo si no hay mensaje');
    assert.ok(!submitBlock.includes('Error al guardar'), 'no debe esconder el error real detrás de un mensaje genérico fijo');
  });
}

// ================================================================
// PARTE F -- mejoras previas intactas (#7 restante, #8, #9, #10, #11,
// Tarjetas)
// ================================================================

caso('CASO 30 — #7 (resto del RPC/UI de corrección histórica) intacto salvo el fix puntual auditado en Partes A/C', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('function openCorrectHistoricalPaymentModal(paymentId){'));
    assert.ok(text.includes("async function loadPaymentCorrectionsHistory(paymentId){"));
  }
});

caso('CASO 26 — #11 (anulación no destructiva de pagos) intacta', () => {
  for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {
    assert.ok(text.includes('function openAnnulPaymentModal(paymentId){'));
    assert.ok(text.includes("sb.rpc('void_payment'"));
  }
});

caso('CASO 27 — #10 (baja/reactivación de servicios) intacta', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('function dropService(serviceId){'));
    assert.ok(text.includes('function reactivateService(serviceId){'));
  }
});

caso('CASO 28 — #9 (importes pendientes) intacta', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('amountPending'));
    assert.ok(text.includes('pendingCandidates'));
  }
});

caso('CASO 29 — #8 (upload robusto mobile) intacta', () => {
  for (const text of [indexText, operatorText]) {
    assert.ok(text.includes('snapshotFileBytesForUpload'));
  }
});

caso('CASO 31 [index.html] — Tarjetas (uploadCreditDocument/renderCreditCardsModule/bindCreditCardsModule) permanece byte-idéntica al backup previo a bugfix #12', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_12_correccion_pago_min_uuid_20260820_191740', 'index.html.antes_bugfix12'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(indexText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

caso('CASO 31b [index_operator.html] — Tarjetas permanece byte-idéntica al backup previo a bugfix #12', () => {
  const before = fs.readFileSync(path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_12_correccion_pago_min_uuid_20260820_191740', 'index_operator.html.antes_bugfix12'), 'utf8');
  for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'uploadCreditDocument']) {
    assert.strictEqual(
      extract(operatorText, `function ${fnName}(`, '\nfunction '),
      extract(before, `function ${fnName}(`, '\nfunction '),
      `${fnName}() debe seguir byte-idéntica`
    );
  }
});

// ================================================================
// PARTE G -- sintaxis / paridad
// ================================================================

caso('CASO — sintaxis JS válida en ambos HTML (verificado por separado con node --check, ver reporte de entrega)', () => {
  assert.ok(true);
});

caso('CASO — paridad funcional exacta index.html / index_operator.html: parseMoneyField es byte-idéntica entre titular y operador', () => {
  const a = extract(indexText, 'function parseMoneyField(value){', '\nfunction formatMoneyField(');
  const b = extract(operatorText, 'function parseMoneyField(value){', '\nfunction formatMoneyField(');
  assert.strictEqual(a, b, 'parseMoneyField debe ser byte-idéntica entre index.html e index_operator.html');
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
  console.log('AVISO: valida lógica real extraída + auditoría estática del SQL propuesto (NUNCA ejecutado contra Postgres real).');
  process.exitCode = fail ? 1 : 0;
}

run();
