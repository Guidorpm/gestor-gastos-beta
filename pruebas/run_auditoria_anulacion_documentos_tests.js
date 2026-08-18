// ============================================================
// PRUEBA LOCAL — Auditoría + diseño de anulación no destructiva de
// factura/comprobante (mejora #6, FASE 1, 20260817)
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta es una iteración de SOLO AUDITORÍA + DISEÑO --
// todavía no existe ninguna propuesta de migración (el esquema real de
// public.documents no fue confirmado por Guido todavía), así que esta
// suite NO prueba comportamiento de anulación que todavía no existe.
// Prueba exclusivamente:
//   1) que el diagnóstico read-only preparado es 100% de solo lectura;
//   2) que no se coló ninguna sentencia destructiva en ningún archivo de
//      esta mejora;
//   3) que efectivamente NO se creó ninguna propuesta de migración
//      (correcto, según la regla explícita: sin schema real confirmado,
//      no se propone una migración final);
//   4) que el frontend (index.html/index_operator.html) no fue tocado.
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const diagnosticPath = path.join(ROOT, 'migraciones', '6b12_DIAGNOSTICO_ANULACION_DOCUMENTOS_SOLO_LECTURA_20260817.sql');
const consolidatedPath = path.join(ROOT, 'migraciones', '6b12_DIAGNOSTICO_ANULACION_DOCUMENTOS_CONSOLIDADO_SOLO_LECTURA_20260817.sql');
const sql = fs.readFileSync(diagnosticPath, 'utf8');
const consolidatedSql = fs.existsSync(consolidatedPath) ? fs.readFileSync(consolidatedPath, 'utf8') : null;

// Tokenizador mínimo consciente de comillas/comentarios reales de SQL --
// usado para contar sentencias/; de forma confiable (a diferencia de un
// split ingenuo por línea, que se rompe si un valor de texto contiene un
// "--" literal dentro de una cadena, como ocurre en
// policy_functions_limitation del archivo consolidado).
function countRealStatements(text) {
  let depth = 0, inString = false, semicolons = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") { i++; continue; }
        inString = false;
      }
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';') semicolons++;
  }
  return { semicolons, finalParenDepth: depth, endsInsideString: inString };
}

// Igual que en un motor SQL real: el contenido de un literal de texto
// ('...') nunca es código ejecutable, aunque mencione una palabra como
// "CREATE FUNCTION" en prosa (como hace policy_functions_limitation, a
// propósito, para describir qué hace pg_get_functiondef()). Se reemplaza
// el contenido de cada string por espacios (conserva longitud/posiciones,
// no arrastra los delimitadores de comillas) antes de auditar comandos
// peligrosos, para no confundir dato con código -- mismo criterio que ya
// usa countRealStatements() para contar sentencias reales.
function stripStringLiteralsAndComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") { out += '  '; i++; continue; }
        inString = false;
        out += ' ';
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') { out += text[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (ch === "'") { inString = true; out += ' '; continue; }
    out += ch;
  }
  return out;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

caso('CASO 1 — el diagnóstico 6b12 es 100% de solo lectura (sin INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE reales)', () => {
  const codeLines = sql.split('\n').filter(l => !/^\s*--/.test(l));
  const withoutPrivilegeCalls = codeLines.join('\n').replace(/has_table_privilege\([^)]*\)/g, '');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(withoutPrivilegeCalls), 'el diagnóstico debe seguir siendo 100% de solo lectura');
});

caso('CASO 2 — no hay ninguna sentencia DELETE contra public.documents', () => {
  assert.ok(!/DELETE\s+FROM\s+public\.documents/i.test(sql));
});

caso('CASO 3 — no hay ninguna sentencia DELETE/remove contra storage.objects ni el bucket "documents"', () => {
  assert.ok(!/DELETE\s+FROM\s+storage\.objects/i.test(sql));
  assert.ok(!/\.remove\(/i.test(sql), 'no debe invocar ninguna operación de borrado de Storage');
});

caso('CASO 4 — no hay ninguna modificación de payments en esta mejora', () => {
  assert.ok(!/UPDATE\s+public\.payments/i.test(sql));
  assert.ok(!/INSERT\s+INTO\s+public\.payments/i.test(sql));
  assert.ok(!/DELETE\s+FROM\s+public\.payments/i.test(sql));
});

caso('CASO 5 — no hay ninguna modificación de payment_allocations en esta mejora', () => {
  assert.ok(!/UPDATE\s+public\.payment_allocations/i.test(sql));
  assert.ok(!/INSERT\s+INTO\s+public\.payment_allocations/i.test(sql));
  assert.ok(!/DELETE\s+FROM\s+public\.payment_allocations/i.test(sql));
});

caso('CASO 6 — el diagnóstico no referencia nada de Tarjetas', () => {
  assert.ok(!/creditCard|credit_card|carried_balance|\bstatement\b|\bmovement\b|conciliaci/i.test(sql), 'el diagnóstico de documents no debe mezclar nada de Tarjetas');
});

caso('CASO 7 — el diagnóstico audita explícitamente candidatos a columna de anulación en documents (sin asumir que no existen)', () => {
  assert.ok(/column_name ILIKE '%void%'/.test(sql));
  assert.ok(/column_name ILIKE '%delet%'/.test(sql) || /column_name ILIKE '%active%'/.test(sql));
});

caso('CASO 8 — el diagnóstico audita Storage (policies + metadata del bucket) sin ejecutar ninguna operación destructiva', () => {
  assert.ok(sql.includes("schemaname='storage' AND tablename='objects'"));
  assert.ok(sql.includes("FROM storage.buckets"));
});

caso('CASO 9 — el diagnóstico también audita payments.voided (convención ya existente) como referencia de diseño, sin modificarla', () => {
  assert.ok(sql.includes("table_name='payments'"));
  assert.ok(!/UPDATE\s+public\.payments\s+SET/i.test(sql));
});

caso('CASO 10 — la propuesta de migración de anulación existe AHORA (FASE 2, autorizada con el esquema real ya confirmado por Guido) -- ya no aplica "sin schema real no se propone"', () => {
  // AJUSTE (mejora #6, FASE 2, 20260817): esta prueba se escribió en la
  // FASE 1 (solo auditoría), cuando el esquema real de documents todavía
  // no estaba confirmado -- en ese momento, no proponer una migración
  // final era lo correcto. Guido ejecutó el diagnóstico consolidado,
  // confirmó el esquema real, y autorizó explícitamente la FASE 2
  // (implementación + migración preparada). La premisa de este caso
  // cambió por diseño, no por error -- ahora se prueba lo esperado en la
  // FASE 2: que la propuesta SÍ exista y quede marcada NO EJECUTAR.
  const proposalPath = path.join(ROOT, 'migraciones', '6b12_PROPUESTA_ANULACION_DOCUMENTOS_NO_EJECUTAR_20260817.sql');
  assert.ok(fs.existsSync(proposalPath), 'la propuesta de migración debe existir en la FASE 2, ya autorizada con schema real confirmado');
  const proposalSql = fs.readFileSync(proposalPath, 'utf8');
  assert.ok(/NO EJECUTAR SIN AUTORIZACIÓN/i.test(proposalSql));
});

caso('CASO 11 — Tarjetas permanece byte-idéntica tras la FASE 2 (el frontend SÍ cambió, a propósito, pero nunca en Tarjetas)', () => {
  // AJUSTE (mejora #6, FASE 2, 20260817): esta prueba originalmente
  // exigía que index.html/index_operator.html tuvieran el MISMO SHA-256
  // que antes de la FASE 1 -- válido mientras la mejora fuera solo
  // auditoría. La FASE 2 (autorizada explícitamente) sí modifica el
  // frontend de Servicios (helpers de anulación, documentCard, etc.) --
  // la garantía real que sigue importando es que Tarjetas nunca cambió,
  // no que el archivo entero se congele para siempre.
  const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_auditoria_anulacion_documentos_20260817_093227', 'index.html.antes_implementar_anulacion_documentos');
  const beforeOperatorPath = path.join(ROOT, 'respaldos_publicacion', 'antes_auditoria_anulacion_documentos_20260817_093227', 'index_operator.html.antes_implementar_anulacion_documentos');
  // Ese backup específico (de la FASE 1, auditoría) no guardó copias
  // completas de los HTML -- se usa en cambio el respaldo de la FASE 2
  // (antes de implementar), que sí las tiene y es el punto de
  // comparación correcto para "¿Tarjetas cambió durante la
  // implementación real?".
  const phase2BeforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', 'index.html.antes_implementar_anulacion_documentos');
  const phase2BeforeOperatorPath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', 'index_operator.html.antes_implementar_anulacion_documentos');
  assert.ok(fs.existsSync(phase2BeforePath) && fs.existsSync(phase2BeforeOperatorPath), 'debe existir el respaldo previo a la implementación real de la FASE 2');
  const before = fs.readFileSync(phase2BeforePath, 'utf8');
  const beforeOperator = fs.readFileSync(phase2BeforeOperatorPath, 'utf8');
  const currentIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const currentOperator = fs.readFileSync(path.join(ROOT, 'index_operator.html'), 'utf8');
  const extractLocal = (text, start, end) => {
    const i = text.indexOf(start);
    assert.ok(i !== -1, `no se encontró "${start}"`);
    const j = text.indexOf(end, i);
    assert.ok(j !== -1, `no se encontró "${end}"`);
    return text.slice(i, j);
  };
  for (const [now, ref, label] of [[currentIndex, before, 'index.html'], [currentOperator, beforeOperator, 'index_operator.html']]) {
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney', 'deleteCreditDocument']) {
      assert.strictEqual(
        extractLocal(now, `function ${fnName}(`, '\nfunction '),
        extractLocal(ref, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
});

caso('CASO 12 — el comportamiento destructivo actual (deleteStoredDocument/annulPayment) sigue documentado y sin cambios (evidencia real de por qué hace falta esta mejora)', () => {
  const indexText = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const operatorText = fs.readFileSync(path.join(ROOT, 'index_operator.html'), 'utf8');
  for (const text of [indexText, operatorText]) {
    // deleteStoredDocument sigue siendo un DELETE real de la fila + remove()
    // físico del archivo -- el único mecanismo hoy ante una carga
    // equivocada, sin motivo ni trazabilidad.
    const fnDelete = text.slice(text.indexOf('async function deleteStoredDocument('), text.indexOf('async function deleteStoredDocument(') + 1200).replace(/\r\n/g, '\n');
    assert.ok(fnDelete.includes("from('documents')\n    .delete()"));
    assert.ok(fnDelete.includes("storage\n    .from('documents')\n    .remove("));
    assert.ok(!/motivo|reason/i.test(fnDelete), 'confirmado: hoy no pide motivo -- por eso hace falta el rediseño');
  }
});

// ============================================================
// CORRECCIÓN (20260817b) -- dos huecos de cobertura cerrados: búsqueda de
// funciones de policies limitada a public (no incluía private), y
// filtro de Storage demasiado angosto (solo bucket 'documents' literal,
// podía esconder una policy genérica). Estos casos verifican
// específicamente que la corrección quedó aplicada.
// ============================================================

caso('CASO 13 — la búsqueda de funciones de policies cubre public Y private (no solo public)', () => {
  assert.ok(/n\.nspname IN \('public','private'\)/.test(sql), 'debe buscar funciones en ambos esquemas, no solo public');
  // Debe combinar el texto de las policies de documents Y de storage.objects
  // (para no perder funciones invocadas únicamente desde Storage).
  assert.ok(sql.includes("schemaname='public' AND tablename='documents'") && sql.includes("schemaname='storage' AND tablename='objects'"));
});

caso('CASO 14 — la limitación de la búsqueda por texto (no es un parser real) queda documentada explícitamente', () => {
  assert.ok(/LIMITACIÓN EXPLÍCITA/.test(sql), 'debe documentar que es una coincidencia de texto, no una resolución garantizada');
  assert.ok(!/require|import\s+.*parser|npm/i.test(sql), 'no debe inventar ni depender de un parser SQL externo');
});

caso('CASO 15 — Storage: se siguen trayendo TODAS las policies de storage.objects (sin filtrar de entrada por bucket) y se agregan las 2 columnas derivadas pedidas', () => {
  // El WHERE de la consulta de Storage debe seguir sin filtrar por texto
  // de bucket -- filtrar de entrada escondería justo las policies
  // genéricas que el pedido quiere poder detectar.
  const storageBlock = sql.slice(sql.indexOf('-- 12)'), sql.indexOf('-- 13)'));
  assert.ok(storageBlock.includes("WHERE schemaname='storage' AND tablename='objects'"));
  assert.ok(!/WHERE schemaname='storage' AND tablename='objects' AND/.test(storageBlock), 'no debe agregar un AND que filtre por bucket en el WHERE -- las columnas derivadas son el filtro, no el WHERE');
  assert.ok(storageBlock.includes('menciona_documents_directamente'));
  assert.ok(storageBlock.includes('posible_policy_generica'));
});

caso('CASO 16 — los constraints usan conrelid = \'public.documents\'::regclass (no la forma dependiente de search_path) en el código real, no solo en el comentario que explica el cambio', () => {
  const withoutComments = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(withoutComments.includes("WHERE conrelid = 'public.documents'::regclass"));
  assert.ok(!/conrelid::regclass::text\s*=\s*'documents'/.test(withoutComments), 'no debe quedar la forma vieja dependiente de search_path como código real (mencionarla en un comentario explicando el cambio sí está bien)');
});

caso('CASO 17 — el diagnóstico sigue siendo 100% SELECT/WITH...SELECT tras la corrección (14 sentencias reales, contando el WITH...SELECT de la consulta 9 como una sola)', () => {
  const withoutComments = sql.split('\n').filter(l => !/^\s*--/.test(l) && l.trim() !== '').join('\n');
  // Cuenta ";" reales de fin de sentencia -- excluye cualquier ";" que
  // pudiera colarse dentro de una línea de comentario (ya filtrada arriba).
  const statementCount = (withoutComments.match(/;/g) || []).length;
  assert.strictEqual(statementCount, 14, 'deben ser exactamente 14 sentencias tras agregar la consulta 9b');
});

// ============================================================
// VERSIÓN CONSOLIDADA (20260817d) -- misma auditoría que el diagnóstico
// de 14 SELECT, empaquetada en UNA sola sentencia SELECT jsonb_build_object
// para copiar el resultado completo de un solo golpe. NO reemplaza al
// diagnóstico de 14 SELECT (sigue existiendo, sigue probado arriba).
// ============================================================

caso('CASO 18 — el archivo consolidado existe', () => {
  assert.ok(consolidatedSql !== null, 'debe existir migraciones/6b12_DIAGNOSTICO_ANULACION_DOCUMENTOS_CONSOLIDADO_SOLO_LECTURA_20260817.sql');
});

caso('CASO 19 — tiene exactamente UNA sentencia top-level, y es SELECT (jsonb_build_object)', () => {
  const stats = countRealStatements(consolidatedSql);
  assert.strictEqual(stats.semicolons, 1, 'debe haber exactamente un ";" real (fuera de comentarios/strings)');
  assert.strictEqual(stats.finalParenDepth, 0, 'los paréntesis deben quedar balanceados (sintaxis bien formada)');
  assert.strictEqual(stats.endsInsideString, false, 'ninguna cadena debe quedar sin cerrar');
  const trimmed = consolidatedSql.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));
  assert.strictEqual(trimmed[0], 'SELECT jsonb_build_object(', 'la única sentencia real debe ser un SELECT jsonb_build_object(...)');
});

caso('CASO 20 — devuelve un único objeto JSON/JSONB consolidado con todas las secciones necesarias', () => {
  const requiredKeys = [
    'documents_columns', 'documents_void_columns', 'documents_constraints',
    'documents_indexes', 'documents_triggers', 'documents_rls',
    'documents_policies', 'documents_authenticated_privileges',
    'policy_functions', 'policy_functions_limitation',
    'document_relationship_counts', 'payments_void_columns',
    'storage_policies', 'storage_bucket',
  ];
  for (const key of requiredKeys) {
    assert.ok(consolidatedSql.includes(`'${key}'`), `falta la sección '${key}' en el jsonb_build_object`);
  }
});

caso('CASO 21 — la búsqueda de funciones cubre public Y private, igual que el diagnóstico de 14 SELECT', () => {
  assert.ok(/n\.nspname IN \('public','private'\)/.test(consolidatedSql));
  assert.ok(consolidatedSql.includes("schemaname='public' AND tablename='documents'") && consolidatedSql.includes("schemaname='storage' AND tablename='objects'"));
});

caso('CASO 22 — conserva las policies genéricas de Storage: NO filtra de entrada solo bucket_id=\'documents\'', () => {
  const storageBlock = consolidatedSql.slice(consolidatedSql.indexOf("'storage_policies'"), consolidatedSql.indexOf("'storage_bucket'"));
  assert.ok(storageBlock.includes("WHERE schemaname='storage' AND tablename='objects'"));
  assert.ok(!/WHERE schemaname='storage' AND tablename='objects'\s+AND/.test(storageBlock), 'el WHERE no debe agregar un filtro de bucket -- las columnas derivadas son el filtro, no el WHERE');
  assert.ok(storageBlock.includes('menciona_documents_directamente'));
  assert.ok(storageBlock.includes('posible_policy_generica'));
});

caso('CASO 23 — usa conrelid = \'public.documents\'::regclass (no depende de search_path)', () => {
  assert.ok(consolidatedSql.includes("WHERE conrelid = 'public.documents'::regclass"));
});

caso('CASO 24 — el archivo consolidado es 100% de solo lectura (sin INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE como código real -- las menciones dentro de valores de texto, como "CREATE FUNCTION" en policy_functions_limitation, no cuentan como código)', () => {
  const codeOnly = stripStringLiteralsAndComments(consolidatedSql)
    .replace(/has_table_privilege\([^)]*\)/g, '');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(codeOnly), 'no debe quedar ningún comando de escritura como código SQL real');
});

caso('CASO 25 — el archivo consolidado no referencia nada de Tarjetas', () => {
  assert.ok(!/creditCard|credit_card|carried_balance|\bstatement\b|\bmovement\b|conciliaci/i.test(consolidatedSql));
});

caso('CASO 26 — el diagnóstico original de 14 SELECT NO fue reemplazado ni borrado', () => {
  assert.ok(fs.existsSync(diagnosticPath), 'debe seguir existiendo el diagnóstico original de 14 SELECT');
});

caso('CASO 27 — Tarjetas sigue byte-idéntica tras esta consolidación (mismo criterio ajustado que CASO 11 -- el frontend de Servicios SÍ cambió en la FASE 2, autorizada, pero nunca Tarjetas)', () => {
  const phase2BeforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', 'index.html.antes_implementar_anulacion_documentos');
  const phase2BeforeOperatorPath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', 'index_operator.html.antes_implementar_anulacion_documentos');
  const before = fs.readFileSync(phase2BeforePath, 'utf8');
  const beforeOperator = fs.readFileSync(phase2BeforeOperatorPath, 'utf8');
  const currentIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const currentOperator = fs.readFileSync(path.join(ROOT, 'index_operator.html'), 'utf8');
  const extractLocal = (text, start, end) => {
    const i = text.indexOf(start);
    assert.ok(i !== -1, `no se encontró "${start}"`);
    const j = text.indexOf(end, i);
    assert.ok(j !== -1, `no se encontró "${end}"`);
    return text.slice(i, j);
  };
  for (const [now, ref, label] of [[currentIndex, before, 'index.html'], [currentOperator, beforeOperator, 'index_operator.html']]) {
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extractLocal(now, `function ${fnName}(`, '\nfunction '),
        extractLocal(ref, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
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
  console.log('AVISO: valida el diagnóstico read-only preparado y el estado actual real del frontend -- NO prueba ninguna funcionalidad de anulación de documentos todavía (no existe).');
  if (fail > 0) process.exitCode = 1;
}

run();
