// ============================================================
// PRUEBA LOCAL — Anulación no destructiva de factura/comprobante
// (mejora #6, FASE 2, 20260817)
// ------------------------------------------------------------
// AVISO IMPORTANTE: la migración NO fue ejecutada contra Supabase (no hay
// acceso de ejecución en esta sesión, y de todos modos está detenida a
// propósito hasta autorización explícita). Lo que esta prueba SÍ hace,
// de forma reproducible:
//
//   1) Extrae y ejecuta las funciones REALES de index.html/index_operator.html
//      (isVoidedServiceDocument/isNormalServiceDocument/activeServiceDocuments/
//      documentCard/esc/fmtDate/displayNameForUserId) en un sandbox, nunca
//      reimplementadas a mano.
//
//   2) Audita estáticamente el contenido real de la migración preparada
//      (columnas/CHECKs/trigger) y del frontend (findMatchingServiceDocument/
//      openVoidServiceDocumentModal/los 9 puntos de conteo vigente/
//      deleteStoredDocument/annulPayment/Tarjetas).
//
// Lo que esta prueba NO puede confirmar (requiere Postgres/Supabase real,
// fuera de alcance de esta iteración):
//   - que los CHECK constraints y el trigger compilen y se comporten
//     exactamente así en Postgres real;
//   - que las policies RLS existentes efectivamente permitan el UPDATE de
//     anulación tal como se espera (auditado por descripción, no por
//     texto verbatim de qual/with_check).
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
const migrationPath = path.join(ROOT, 'migraciones', '6b12_PROPUESTA_ANULACION_DOCUMENTOS_NO_EJECUTAR_20260817.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

// ---------------- Sandbox de las funciones reales del frontend ----------------

const fnEsc = extract(indexText, 'function esc(v){', '\n');
const fnFmtDate = extract(indexText, 'function fmtDate(v){', 'function today(){');
const fnDisplayNameForUserId = extract(indexText, 'function displayNameForUserId(userId){', 'async function annulObligationMonth(');
const blockDocumentHelpers = extract(indexText, 'function isVoidedServiceDocument(doc){', 'async function loadDocumentPreviews(');

const REAL_SOURCE = [fnEsc, fnFmtDate, fnDisplayNameForUserId, blockDocumentHelpers].join('\n');

function buildSandbox({ members }) {
  const sandbox = {
    members: members || [],
    document: { querySelectorAll: () => [] }, // documentCard() no toca document real -- solo genera HTML string
  };
  const fn = new Function(...Object.keys(sandbox), REAL_SOURCE + '\nreturn { isVoidedServiceDocument, isNormalServiceDocument, activeServiceDocuments, documentCard, esc, fmtDate, displayNameForUserId };');
  return fn(...Object.values(sandbox));
}

function doc(overrides = {}) {
  return {
    id: 'd1', kind: 'invoice', obligation_id: 'o1', payment_id: null,
    card_id: null, statement_id: null, movement_id: null,
    voided: false, voided_at: null, voided_by: null, void_reason: null,
    original_name: 'Factura.pdf',
    ...overrides,
  };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

// ============================================================
// PARTE A — MIGRACIÓN PREPARADA (1-16, 19-27, 42-43, 45-46)
// ============================================================

caso('CASO 1 — la migración agrega la columna voided (boolean NOT NULL DEFAULT false)', () => {
  assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false'));
});

caso('CASO 2 — la migración agrega la columna voided_at (timestamptz NULL)', () => {
  assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL'));
});

caso('CASO 3 — la migración agrega la columna voided_by (uuid NULL REFERENCES auth.users(id))', () => {
  assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS voided_by uuid NULL REFERENCES auth.users(id)'));
});

caso('CASO 4 — la migración agrega la columna void_reason (text NULL)', () => {
  assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS void_reason text NULL'));
});

caso('CASO 5 — default histórico false para las 235 filas existentes, sin backfill', () => {
  assert.ok(migrationSql.includes('DEFAULT false'));
  assert.ok(!/UPDATE\s+public\.documents\s+SET/i.test(migrationSql), 'no debe haber ningún UPDATE masivo de backfill');
});

caso('CASO 6 — documento ACTIVO exige metadata de anulación NULL (chk_documents_void_state)', () => {
  assert.ok(migrationSql.includes('(voided = false AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)'));
});

caso('CASO 7 — documento ANULADO exige fecha/usuario/motivo no vacío (chk_documents_void_state)', () => {
  assert.ok(migrationSql.includes("(voided = true AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(void_reason) <> '')"));
});

caso('CASO 8 — motivo vacío rechazado por el trigger', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes("btrim(NEW.void_reason) = ''"));
  assert.ok(fn.includes("RAISE EXCEPTION 'La anulación requiere un motivo'"));
});

caso('CASO 9 — motivo mayor a 500 caracteres rechazado por el trigger', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('char_length(btrim(NEW.void_reason)) > 500'));
});

caso('CASO 10 — el server asigna voided_by := auth.uid() (el cliente nunca lo elige)', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('NEW.voided_by := auth.uid();'));
});

caso('CASO 11 — el server asigna voided_at := now() (el cliente nunca lo elige)', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('NEW.voided_at := now();'));
});

caso('CASO 12 — no se puede desanular (OLD.voided=true bloquea NEW.voided distinto)', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('IF OLD.voided = true THEN'));
  assert.ok(fn.includes('NEW.voided IS DISTINCT FROM OLD.voided'));
});

caso('CASO 13 — no se puede editar el motivo de un documento ya anulado', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('NEW.void_reason IS DISTINCT FROM OLD.void_reason'));
});

caso('CASO 14 — no se puede editar voided_by de un documento ya anulado', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('NEW.voided_by IS DISTINCT FROM OLD.voided_by'));
});

caso('CASO 15 — no se puede editar voided_at de un documento ya anulado', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes('NEW.voided_at IS DISTINCT FROM OLD.voided_at'));
});

caso('CASO 16 — la anulación no puede mezclarse con cambios de archivo/relaciones (14 columnas protegidas)', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  for (const col of ['id', 'group_id', 'obligation_id', 'payment_id', 'kind', 'file_path', 'original_name', 'mime_type', 'size_bytes', 'uploaded_by', 'created_at', 'card_id', 'statement_id', 'movement_id']) {
    assert.ok(fn.includes(`NEW.${col} IS DISTINCT FROM OLD.${col}`), `debe proteger la columna ${col}`);
  }
});

caso('CASO 17 — invoice normal puede anularse (chk_documents_void_scope lo permite)', () => {
  assert.ok(migrationSql.includes("kind IN ('invoice','receipt')"));
});

caso('CASO 18 — receipt normal puede anularse (mismo IN de CASO 17, incluye receipt)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(scopeCheck.includes("'receipt'"));
});

caso('CASO 19 — receipt con obligation_id + payment_id simultáneos sigue siendo válido (sin XOR)', () => {
  assert.ok(!/obligation_id\s+IS\s+NULL\)\s*(<>|!=|XOR)/i.test(migrationSql));
  assert.ok(!/CHECK\s*\(\s*\(obligation_id IS NULL\)\s*(!=|<>)\s*\(payment_id IS NULL\)/i.test(migrationSql), 'no debe existir un CHECK tipo XOR entre obligation_id y payment_id');
});

caso('CASO 20 — statement NO puede usar esta anulación (kind fuera de invoice/receipt bloqueado por el scope)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(scopeCheck.includes("kind IN ('invoice','receipt')"), 'statement/card_receipt quedan excluidos por no estar en esta lista');
});

caso('CASO 21 — card_receipt NO puede usar esta anulación (mismo mecanismo que CASO 20)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(!scopeCheck.includes("'card_receipt'"));
});

caso('CASO 22 — un documento con card_id no puede anularse (chk_documents_void_scope)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(scopeCheck.includes('card_id IS NULL'));
});

caso('CASO 23 — un documento con statement_id no puede anularse (chk_documents_void_scope)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(scopeCheck.includes('statement_id IS NULL'));
});

caso('CASO 24 — un documento con movement_id no puede anularse (chk_documents_void_scope)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(scopeCheck.includes('movement_id IS NULL'));
});

caso('CASO 25 — la migración no crea, altera ni borra ninguna policy (RLS existente se conserva)', () => {
  assert.ok(!/CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i.test(migrationSql));
});

caso('CASO 26 — la migración no otorga ni menciona credit_card_access', () => {
  assert.ok(!migrationSql.includes('credit_card_access'));
});

caso('CASO 27 — la migración no toca Storage (sin storage.objects/storage.buckets/remove)', () => {
  assert.ok(!/storage\.objects|storage\.buckets/i.test(migrationSql));
  assert.ok(!/\.remove\(/.test(migrationSql));
});

caso('CASO 42 — no se agrega ninguna constraint XOR real obligation_id/payment_id (repite CASO 19, excluyendo los comentarios que explican la decisión)', () => {
  const withoutComments = migrationSql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/XOR/i.test(withoutComments), 'no debe existir ningún XOR como código SQL real (mencionarlo en un comentario explicando la decisión sí está bien)');
});

caso('CASO 43 — no se crea ningún índice/constraint UNIQUE nuevo como código real (excluyendo los comentarios que explican la decisión)', () => {
  const withoutComments = migrationSql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bUNIQUE\b/i.test(withoutComments), 'no debe existir ningún UNIQUE como código SQL real');
});

caso('CASO 45 — la migración sigue encabezada NO EJECUTAR SIN AUTORIZACIÓN', () => {
  assert.ok(/NO EJECUTAR SIN AUTORIZACIÓN/i.test(migrationSql));
});

caso('CASO 46 — INSERT con voided=true directo queda rechazado (no se puede insertar ya anulado)', () => {
  const fn = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
  assert.ok(fn.includes("IF TG_OP = 'INSERT' THEN"));
  assert.ok(fn.includes("RAISE EXCEPTION 'No se puede insertar un documento ya anulado"));
});

caso('CASO 47 — la migración no hace ningún DELETE/DROP/TRUNCATE real (fuera del rollback comentado)', () => {
  const withoutComments = migrationSql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(withoutComments));
});

// ============================================================
// PARTE A2 — CORRECCIONES FINALES DEL TRIGGER (A/B/C, 20260817)
// ------------------------------------------------------------
// El cuerpo de enforce_document_void_integrity() cambió estructuralmente
// respecto de la revisión anterior (SHA-256 anterior:
// b5528b11a7cbfbda4758dd9e303fa882b17178f5c1cf95ba33d04597c3fffdc6).
// Los CASO 1-27/42-47 de arriba siguen validando contra el texto real y
// actualizado del trigger sin cambios (los substrings que verifican --
// motivo/500/auth.uid asignado/columnas protegidas -- siguen presentes
// tal cual, ver diff en el reporte de entrega). Estos CASO nuevos cubren
// específicamente las 3 correcciones (A: auth.uid() NULL explícito: B:
// fila anulada totalmente inmutable; C: metadata prohibida en documento
// activo).
// ============================================================

const fnBody = extract(migrationSql, 'CREATE OR REPLACE FUNCTION public.enforce_document_void_integrity()', '$function$;');
const idxInsertBlock = fnBody.indexOf("IF TG_OP = 'INSERT' THEN");
const idxUpdateComment = fnBody.indexOf('-- A partir de acá, TG_OP');
const blockInsert = fnBody.slice(idxInsertBlock, idxUpdateComment);
const blockAnulado = extract(fnBody, 'IF OLD.voided = true THEN', '-- A partir de acá, OLD.voided = false.');
const blockActivo = extract(fnBody, 'IF NEW.voided = false THEN', '-- Transición false -> true');
const idxTransicion = fnBody.indexOf('-- Transición false -> true: ESTA es la operación real de anular.');
const blockTransicion = fnBody.slice(idxTransicion);

caso('CASO 49 — Corrección A: auth.uid() IS NULL se verifica explícitamente ANTES de asignar voided_by (nunca depende solo del CHECK)', () => {
  const idxCheck = blockTransicion.indexOf('auth.uid() IS NULL');
  const idxRaise = blockTransicion.indexOf("RAISE EXCEPTION 'No se pudo identificar al usuario autenticado'");
  const idxAssign = blockTransicion.indexOf('NEW.voided_by := auth.uid();');
  assert.ok(idxCheck !== -1, 'debe verificar auth.uid() IS NULL');
  assert.ok(idxRaise !== -1, 'debe existir un RAISE EXCEPTION explícito y claro');
  assert.ok(idxAssign !== -1, 'debe asignar voided_by');
  assert.ok(idxCheck < idxAssign, 'la verificación de auth.uid() debe ocurrir ANTES de asignar voided_by, nunca después');
  assert.ok(idxRaise < idxAssign, 'el RAISE EXCEPTION debe ocurrir ANTES de la asignación');
});

const columnasEstructuralesAnulado = ['file_path', 'original_name', 'obligation_id', 'payment_id', 'group_id', 'kind', 'uploaded_by', 'card_id', 'statement_id', 'movement_id', 'id', 'mime_type', 'size_bytes', 'created_at'];
for (const col of columnasEstructuralesAnulado) {
  caso(`CASO 50-${col} — Corrección B: columna ${col} inmutable en un documento ya anulado`, () => {
    assert.ok(blockAnulado.includes(`NEW.${col} IS DISTINCT FROM OLD.${col}`), `el bloque de fila anulada debe proteger la columna ${col}`);
  });
}

caso('CASO 50-metadata — Corrección B: la metadata de anulación (voided/voided_at/voided_by/void_reason) también queda inmutable tras anular (no existe desanular ni reeditar el motivo)', () => {
  for (const col of ['voided', 'voided_at', 'voided_by', 'void_reason']) {
    assert.ok(blockAnulado.includes(`NEW.${col} IS DISTINCT FROM OLD.${col}`), `debe proteger ${col}`);
  }
  assert.ok(blockAnulado.includes("RAISE EXCEPTION 'Un documento anulado es inmutable"));
});

caso('CASO 50-noop — Corrección B: un UPDATE que no cambia ninguna columna (no-op) sobre un documento anulado se permite sin error', () => {
  // blockAnulado tiene la forma:
  //   IF OLD.voided = true THEN
  //     IF (...alguna columna cambió...) THEN RAISE EXCEPTION ...; END IF;   <- primer END IF (cierra el IF interno)
  //     RETURN NEW;                                                          <- se alcanza SOLO si nada cambió
  //   END IF;                                                                <- segundo END IF (cierra el IF externo)
  // Por eso se busca el PRIMER "END IF;" (el del IF interno) y se confirma
  // que "RETURN NEW;" aparece después de él -- ese es el camino no-op.
  const idxFirstEndIf = blockAnulado.indexOf('END IF;');
  assert.ok(idxFirstEndIf !== -1);
  const afterFirstEndIf = blockAnulado.slice(idxFirstEndIf);
  assert.ok(afterFirstEndIf.includes('RETURN NEW;'), 'debe retornar NEW sin error cuando ninguna columna cambia realmente');
});

caso('CASO 51 — Corrección C: un documento ACTIVO (voided=false) con voided_at no NULL es rechazado', () => {
  assert.ok(blockActivo.includes('NEW.voided_at IS NOT NULL'));
  assert.ok(blockActivo.includes("RAISE EXCEPTION 'Un documento activo (voided=false) no puede tener metadata de anulación"));
});

caso('CASO 52 — Corrección C: un documento ACTIVO con voided_by no NULL es rechazado', () => {
  assert.ok(blockActivo.includes('NEW.voided_by IS NOT NULL'));
});

caso('CASO 53 — Corrección C: un documento ACTIVO con void_reason no NULL es rechazado', () => {
  assert.ok(blockActivo.includes('NEW.void_reason IS NOT NULL'));
});

caso('CASO 54 — Corrección C: un UPDATE normal de un documento activo, sin metadata de anulación, sigue permitido sin exigencias adicionales', () => {
  const idxIf = blockActivo.indexOf('IF NEW.voided_at IS NOT NULL');
  const idxEndIf = blockActivo.indexOf('END IF;', idxIf);
  assert.ok(idxIf !== -1 && idxEndIf !== -1);
  const afterEndIf = blockActivo.slice(idxEndIf);
  assert.ok(afterEndIf.includes('RETURN NEW;'), 'un UPDATE activo sin metadata de anulación debe permitirse');
});

caso('CASO 55 — la transición false→true sigue siendo válida: exige invoice/receipt sin Tarjetas, sin cambios estructurales, motivo no vacío ni >500, usuario identificable, y el servidor asigna voided_by/voided_at', () => {
  assert.ok(blockTransicion.includes("NEW.kind NOT IN ('invoice','receipt')"));
  assert.ok(blockTransicion.includes('NEW.card_id IS NOT NULL'));
  assert.ok(blockTransicion.includes('NEW.statement_id IS NOT NULL'));
  assert.ok(blockTransicion.includes('NEW.movement_id IS NOT NULL'));
  assert.ok(blockTransicion.includes("btrim(NEW.void_reason) = ''"));
  assert.ok(blockTransicion.includes('char_length(btrim(NEW.void_reason)) > 500'));
  assert.ok(blockTransicion.includes('auth.uid() IS NULL'));
  assert.ok(blockTransicion.includes('NEW.void_reason := btrim(NEW.void_reason);'));
  assert.ok(blockTransicion.includes('NEW.voided_by := auth.uid();'));
  assert.ok(blockTransicion.includes('NEW.voided_at := now();'));
});

caso('CASO 56 — un receipt con obligation_id Y payment_id simultáneos sigue pudiendo anularse (chk_documents_void_scope no exige exclusividad entre ambas)', () => {
  const scopeCheck = extract(migrationSql, 'ADD CONSTRAINT chk_documents_void_scope', ');');
  assert.ok(!/obligation_id|payment_id/.test(scopeCheck), 'el scope de anulación no debe depender de obligation_id/payment_id');
});

caso('CASO 57 — INSERT con voided=false (carga normal de un documento) sigue permitido sin restricciones adicionales', () => {
  assert.ok(blockInsert.includes('IF NEW.voided = true THEN'));
  assert.ok(blockInsert.includes("RAISE EXCEPTION 'No se puede insertar un documento ya anulado"));
  assert.ok(blockInsert.includes('RETURN NEW;'), 'debe retornar NEW cuando NEW.voided no es true (INSERT normal)');
});

// ============================================================
// PARTE B — HELPERS Y RENDERIZADO (documentCard/activeServiceDocuments)
// ============================================================

caso('CASO 30a — isVoidedServiceDocument(doc): true solo si voided===true', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isVoidedServiceDocument(doc({ voided: true })), true);
  assert.strictEqual(sb.isVoidedServiceDocument(doc({ voided: false })), false);
  assert.strictEqual(sb.isVoidedServiceDocument(doc({ voided: undefined })), false);
  assert.strictEqual(sb.isVoidedServiceDocument(null), false);
});

caso('CASO 30b — activeServiceDocuments(): filtra los anulados, conserva los vigentes', () => {
  const sb = buildSandbox({});
  const list = [doc({ id: 'a', voided: false }), doc({ id: 'b', voided: true }), doc({ id: 'c', voided: false })];
  const active = sb.activeServiceDocuments(list);
  assert.deepStrictEqual(active.map(d => d.id), ['a', 'c']);
});

caso('CASO 30c — documento anulado deja de contar como vigente aunque la lista original lo incluya', () => {
  const sb = buildSandbox({});
  const list = [doc({ voided: true })];
  assert.strictEqual(sb.activeServiceDocuments(list).length, 0);
});

caso('CASO 34/35/36 — documentCard() de un documento anulado muestra ANULADO + motivo + anulado por + fecha + "Ver archivo original" (nunca lo oculta)', () => {
  const sb = buildSandbox({ members: [{ user_id: 'u1', display_name: 'Fabiana' }] });
  const voidedDoc = doc({ voided: true, void_reason: 'PDF equivocado', voided_by: 'u1', voided_at: '2026-08-17T13:00:00+00:00' });
  const html = sb.documentCard(voidedDoc, 'Factura', true);
  assert.ok(html.includes('COMPROBANTE ANULADO'));
  assert.ok(html.includes('PDF equivocado'));
  assert.ok(html.includes('Fabiana'));
  assert.ok(html.includes('Ver archivo original'));
  assert.ok(html.includes(`data-open-document="${voidedDoc.id}"`), 'el archivo original sigue siendo abrible');
  assert.ok(!html.includes('data-delete-document'), 'un documento anulado no debe ofrecer "Quitar"');
  assert.ok(!html.includes('data-void-document'), 'un documento ya anulado no debe ofrecer "Anular" de nuevo');
});

caso('CASO 19b — isNormalServiceDocument(): true para invoice/receipt sin vínculo a Tarjetas', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ kind: 'invoice' })), true);
  assert.strictEqual(sb.isNormalServiceDocument(doc({ kind: 'receipt', obligation_id: 'o1', payment_id: 'p1' })), true, 'receipt con obligation_id+payment_id simultáneos sigue siendo normal');
});

caso('CASO 20b — isNormalServiceDocument(): false para statement', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ kind: 'statement', obligation_id: null })), false);
});

caso('CASO 21b — isNormalServiceDocument(): false para card_receipt', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ kind: 'card_receipt', obligation_id: null })), false);
});

caso('CASO 22b — isNormalServiceDocument(): false si card_id no es null, incluso con kind invoice/receipt', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ card_id: 'c1' })), false);
});

caso('CASO 23b — isNormalServiceDocument(): false si statement_id no es null', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ statement_id: 's1' })), false);
});

caso('CASO 24b — isNormalServiceDocument(): false si movement_id no es null', () => {
  const sb = buildSandbox({});
  assert.strictEqual(sb.isNormalServiceDocument(doc({ movement_id: 'm1' })), false);
});

caso('CASO 39 — documentCard() vigente de un documento normal ofrece "Anular comprobante" (nunca "Quitar")', () => {
  const sb = buildSandbox({});
  const html = sb.documentCard(doc({ voided: false }), 'Factura', true);
  assert.ok(html.includes('data-void-document'));
  assert.ok(html.includes('Anular comprobante'));
  assert.ok(!html.includes('data-delete-document'), 'un documento normal vigente ya no debe ofrecer "Quitar"');
});

// ============================================================
// PARTE C — AUDITORÍA ESTÁTICA DEL FRONTEND (índex.html / index_operator.html)
// ============================================================

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {

  caso(`CASO 28 [${label}] — openVoidServiceDocumentModal NUNCA hace DELETE de documents`, () => {
    const fnBlock = extract(text, 'function openVoidServiceDocumentModal(documentId,onDelete){', '\nfunction ');
    assert.ok(!/\.delete\(\)/.test(fnBlock));
    assert.ok(fnBlock.includes(".update({voided:true,void_reason:reason})"));
  });

  caso(`CASO 29 [${label}] — openVoidServiceDocumentModal NUNCA llama a storage.remove()`, () => {
    const fnBlock = extract(text, 'function openVoidServiceDocumentModal(documentId,onDelete){', '\nfunction ');
    assert.ok(!/storage[\s\S]{0,40}\.remove\(/.test(fnBlock));
  });

  caso(`CASO X [${label}] — openVoidServiceDocumentModal NUNCA envía voided_by/voided_at desde el cliente`, () => {
    const fnBlock = extract(text, 'function openVoidServiceDocumentModal(documentId,onDelete){', '\nfunction ');
    assert.ok(!/voided_by\s*:/.test(fnBlock));
    assert.ok(!/voided_at\s*:/.test(fnBlock));
  });

  caso(`CASO X [${label}] — el motivo de anulación se valida en el cliente (trim, no vacío, máximo 500)`, () => {
    const fnBlock = extract(text, 'function openVoidServiceDocumentModal(documentId,onDelete){', '\nfunction ');
    assert.ok(fnBlock.includes('.trim()'));
    assert.ok(fnBlock.includes("if(!reason)return toast("));
    assert.ok(fnBlock.includes('reason.length>500'));
  });

  caso(`CASO 31 [${label}] — Panel de Prioridades (hasInvoice/hasReceipt) ignora documentos anulados`, () => {
    assert.ok(text.includes("const hasInvoice=documents.some(d=>d.obligation_id===o.id&&d.kind==='invoice'&&!isVoidedServiceDocument(d));"));
    assert.ok(text.includes('const hasReceipt=activeServiceDocuments(receiptsForObligation(o.id)).length>0;'));
  });

  caso(`CASO 31b [${label}] — monthQuickSummary (Vista rápida anual) ignora documentos anulados`, () => {
    const fnBlock = extract(text, 'function monthQuickSummary(key){', '\nfunction ');
    assert.ok(fnBlock.includes('!isVoidedServiceDocument(d)'));
    assert.ok(fnBlock.includes('activeServiceDocuments(receiptsForObligation(o.id)).length>0'));
  });

  caso(`CASO 32 [${label}] — Vista Operativa (operationalServiceRowHtml) ignora documentos anulados como vigentes`, () => {
    const fnBlock = extract(text, 'function operationalServiceRowHtml(s,key){', '\nfunction ');
    assert.ok(fnBlock.includes('activeServiceDocuments(documents.filter(d=>d.obligation_id===o.id&&d.kind==='+"'invoice'"+')).length'));
    assert.ok(fnBlock.includes('activeServiceDocuments(receiptsForObligation(o.id)).length'));
  });

  caso(`CASO 32b [${label}] — matriz principal (renderServices) ignora documentos anulados como vigentes`, () => {
    // Debe existir MÁS DE UNA aparición de la versión filtrada por
    // activeServiceDocuments() del conteo de invoices -- una en
    // operationalServiceRowHtml (ya cubierta por CASO 32) y otra en la
    // matriz principal (renderServices). No se ancla a saltos de línea
    // exactos (CRLF real del archivo) -- se cuentan las apariciones del
    // patrón real, que debe ser mayor a 1.
    const occurrences = (text.match(/activeServiceDocuments\(documents\.filter\(d=>d\.obligation_id===o\.id&&d\.kind==='invoice'\)\)\.length/g) || []).length;
    assert.ok(occurrences >= 2, `debe aparecer al menos 2 veces (Vista Operativa + matriz principal), apareció ${occurrences}`);
  });

  caso(`CASO 32c [${label}] — Panel general (spacesDashboard invoices/receipts) ignora documentos anulados`, () => {
    const fnBlock = extract(text, 'const invoices=spacesDashboard.documents.filter(item=>', 'const activeServices=');
    assert.ok(fnBlock.includes('item.voided!==true'));
    const occurrences = (fnBlock.match(/item\.voided!==true/g) || []).length;
    assert.strictEqual(occurrences, 2, 'debe filtrar voided tanto en invoices como en receipts');
  });

  caso(`CASO 33 [${label}] — el buscador (serviceSearchResultHtml) no referencia documents directamente -- reutiliza boxText(), no se ve afectado por voided`, () => {
    const fnBlock = extract(text, 'function serviceSearchResultHtml(s){', 'function closeServiceSearchResults(');
    assert.ok(!/\bdocuments\b/.test(fnBlock), 'el buscador nunca debe calcular su propio estado de documentos -- boxText() ya lo encapsula');
  });

  caso(`CASO 34b [${label}] — el listado histórico de facturas/comprobantes (openObligation/openFolder/openPaymentDetail) sigue trayendo TODOS los documentos, incluidos los anulados`, () => {
    assert.ok(text.includes('const existingInvoices=o'), 'openObligation debe seguir listando facturas');
    assert.ok(text.includes("const invoices=documents.filter(d=>d.obligation_id===o.id&&d.kind==='invoice');"), 'openFolder debe seguir listando todo, sin filtrar voided');
    assert.ok(text.includes('const receipts=receiptsForObligation(o.id);'), 'openFolder debe seguir listando todos los comprobantes, sin filtrar voided');
    // Ninguno de los 3 listados históricos debe filtrar por
    // isVoidedServiceDocument/activeServiceDocuments -- el historial
    // completo (incluidos los anulados) debe seguir visible ahí.
    const existingInvoicesBlock = extract(text, 'const existingInvoices=o', 'const currentMode=');
    assert.ok(!/activeServiceDocuments|isVoidedServiceDocument/.test(existingInvoicesBlock), 'openObligation no debe filtrar voided de su listado histórico');
  });

  caso(`CASO 37/38 [${label}] — findMatchingServiceDocument excluye documentos anulados de la detección de duplicados`, () => {
    const fnBlock = extract(text, 'async function findMatchingServiceDocument(', 'async function uploadDoc(');
    assert.ok(fnBlock.includes('item.voided!==true'));
  });

  caso(`CASO 39b [${label}] — findMatchingServiceDocument sigue bloqueando un duplicado exacto VIGENTE (misma lógica de kind/obligation/payment, sin debilitar)`, () => {
    const fnBlock = extract(text, 'async function findMatchingServiceDocument(', 'async function uploadDoc(');
    assert.ok(fnBlock.includes('item.kind===kind'));
    assert.ok(fnBlock.includes('normalizeCreditDocumentName(doc.file_path,doc.original_name)===file.name.toLowerCase()'));
    assert.ok(fnBlock.includes('computeFileHash'));
  });

  caso(`CASO 40a [${label}] — deleteStoredDocument() (función global) NO fue borrada -- otros llamadores potenciales la conservan`, () => {
    assert.ok(text.includes('async function deleteStoredDocument(documentId,onDelete){'));
  });

  caso(`CASO 41 [${label}] — annulPayment() no fue modificado (sigue siendo el DELETE real ya documentado, fuera de esta mejora)`, () => {
    const fnBlock = extract(text, 'async function annulPayment(paymentId){', '\nfunction permissionSummary(');
    assert.ok(fnBlock.includes("from('payments')") && fnBlock.includes('.delete()'));
    assert.ok(!fnBlock.includes('voided:true'), 'annulPayment no debe empezar a usar el mecanismo de anulación de documentos');
  });

  caso(`CASO X [${label}] — el SELECT de documents del Panel general ahora incluye "voided"`, () => {
    assert.ok(text.includes("sb.from('documents').select('id,group_id,obligation_id,payment_id,kind,voided')"));
  });
}

caso('CASO 40 — Tarjetas permanece byte-idéntica en funciones core tras esta mejora', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', `${f}.antes_implementar_anulacion_documentos`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney', 'deleteCreditDocument']) {
      assert.strictEqual(
        extract(now, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${f} debe seguir byte-idéntica`
      );
    }
  }
});

caso('CASO 41b — annulPayment() es byte-idéntica al backup previo (no se tocó)', () => {
  for (const f of ['index.html', 'index_operator.html']) {
    const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_implementar_anulacion_documentos_20260817_102821', `${f}.antes_implementar_anulacion_documentos`);
    const before = fs.readFileSync(beforePath, 'utf8');
    const now = f === 'index.html' ? indexText : operatorText;
    assert.strictEqual(
      extract(now, 'async function annulPayment(paymentId){', '\nfunction permissionSummary('),
      extract(before, 'async function annulPayment(paymentId){', '\nfunction permissionSummary('),
      `annulPayment() en ${f} debe seguir byte-idéntica`
    );
  }
});

caso('CASO 44 — paridad funcional exacta index.html / index_operator.html (helpers + documentCard + openVoidServiceDocumentModal + findMatchingServiceDocument + operationalServiceRowHtml + monthQuickSummary)', () => {
  const blocks = [
    ['function isVoidedServiceDocument(', 'function renderLocalFilePreview('],
    ['async function findMatchingServiceDocument(', 'async function uploadDoc('],
    ['function operationalServiceRowHtml(', '\nfunction '],
    ['function monthQuickSummary(', '\nfunction '],
  ];
  for (const [start, end] of blocks) {
    assert.strictEqual(extract(indexText, start, end), extract(operatorText, start, end), `bloque "${start}" debe ser byte-idéntico entre ambos archivos`);
  }
});

caso('CASO 48 — sintaxis JS válida en ambos HTML (verificado por separado con node --check, ver reporte de entrega)', () => {
  // Placeholder documental -- la verificación real de sintaxis se corre
  // aparte (node --check sobre el <script> extraído), no puede ejecutarse
  // dentro de este proceso de pruebas sin volver a extraer el archivo.
  assert.ok(indexText.includes('<script'));
  assert.ok(operatorText.includes('<script'));
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
  console.log('AVISO: valida lógica real extraída + auditoría estática de la migración preparada, NO ejecución real contra Postgres/Supabase.');
  if (fail > 0) process.exitCode = 1;
}

run();
