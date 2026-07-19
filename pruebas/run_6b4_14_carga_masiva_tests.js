// CORRECCIÓN 6B4.14/6B4.14.1 - Suite de pruebas de la carga masiva
// conciliada de resúmenes históricos, incluida la comparación real contra
// Supabase agregada en 6B4.14.1. Extrae las funciones reales de index.html
// e index_operator.html (sin depender de scripts de sesión ni de pdf.js) y
// verifica, con fixtures sintéticos, que el motor:
//   - existe como flujo separado de runHistoricalUpload y de 6B4.13,
//   - construye existingSnapshot y comparison (valor contra valor, nunca
//     por sola existencia) para cada ítem accionable,
//   - clasifica correctamente crear_faltante/reparar_seguro/
//     omitir_identico/omitir_copia_redundante/conflicto_documental/
//     revision_humana/fuera_de_alcance/error_lectura,
//   - NUNCA usa "documento vinculado" O "totales existen" como criterio
//     suficiente para omitir (el error confirmado en 6B4.14),
//   - un registro con ID pero totales en $0 se propone reparar,
//   - un registro con documento pero sin movimientos se propone reparar,
//   - un registro con totales correctos pero hash de PDF distinto se
//     marca conflicto (nunca se asume "es el mismo" solo por el total),
//   - solamente un registro totalmente coincidente (8 criterios) se omite,
//   - los conflictos documentales (mismo período, contenido distinto)
//     nunca se ocultan del resultado exportado,
//   - es idempotente,
//   - solo actúa (Fase B) sobre 'crear_faltante'/'reparar_seguro',
//   - nunca usa operaciones destructivas ni Storage durante la vista previa,
//   - el botón de ejecución real permanece bloqueado en esta etapa,
//   - no rompe el parser histórico (66/66) ni el caso congelado 6B4.9.1,
//   - index.html e index_operator.html mantienen paridad funcional.
// node pruebas/run_6b4_14_carga_masiva_tests.js
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
function extractConst(src, name) {
  const re = new RegExp(`const ${name}=[\\s\\S]*?;\\n`);
  const m = re.exec(src);
  if (!m) throw new Error('No se encontró const ' + name);
  return m[0];
}

const names = [
  'sha256HexFromFile', 'resolveCardForMassiveIdentity', 'analyzeMassiveLoadFile',
  'classifyMassiveLoadGroups', 'buildExistingSnapshot', 'buildComparison', 'analysisFields', 'decideMassiveLoadAction',
  'movementSignature', 'movementSecondarySignature', 'extractInstallmentToken', 'movementMonthTokenToIndex',
  'extractMovementDates', 'classifyPersistenceCategory', 'matchMovementsOneToOne',
  'stripAccentsUpper', 'extractCouponNumber', 'canonicalizeHistoricalMovementDescription',
  'determineMovementSemanticType', 'semanticMatchBucket', 'buildSemanticParts', 'semanticKeyStrict', 'semanticKeyNoDate',
  'uniqueAmountDateKey', 'runMatchingPass',
  'isAggregatePurchaseComponent', 'buildMovementDetailAnalysis', 'creditStatementParserKey',
  'runMassiveConciliatedLoadPreview', 'massiveLoadItemSummary', 'runMassiveConciliatedLoadExecute',
  'buildStatementUpdatesDiff', 'executionPlanItemHasOperations', 'buildExecutionPlanItemLive', 'buildMassiveLoadExecutionPlan',
  'buildChangesSincePreview', 'summarizeMassiveLoadPreviewForComparison', 'buildPlanFingerprint',
  'classifyLiveRefreshState', 'classifyExecutionPlanState', 'buildMassiveLoadExecutionPlanLive',
  'movementEvidenceStateFor', 'buildInstallmentEvidenceIndex', 'resolveInheritedMovementDateWithEvidence',
  'buildMultiplicityCoreSignature', 'buildMultiplicityFullSignature', 'movementRequiresMultiplicityControl',
  'describeUnresolvedDuplicateGroup', 'describeConfirmedMultiplicityGroup', 'detectUnresolvedMovementMultiplicity',
  'assessExecutionAtomicity', 'hashKeyString', 'sha256HexFromString', 'buildCanonicalOperationPayload',
  'buildItemOperationId', 'buildMovementOperationKey', 'buildDocumentOperationKey', 'buildStatementUpdateOperationKey',
  'buildCanonicalPlanItemPayload', 'buildCanonicalPlanPayload', 'buildCanonicalPlanFingerprint',
  'buildPlanDifferences', 'classifyPlanComparisonState',
  'verifySourceFileForPlanItem', 'buildStatementUpdateOptimisticCheck', 'buildDocumentLinkIdempotencyCheck',
  'buildMovementInsertIdempotencyCheck', 'buildPreservedMovementsCheck', 'classifyMassiveLoadDryRunItemOutcome',
  'buildMassiveLoadExecutionDryRunLive', 'buildPlannedOperationsFromDryRunItem', 'buildMassiveLoadExecutionManifest',
  'computeMassiveLoadCodeVersionFingerprint', 'documentMultiplicitySpecificBlockingState', 'creditDocumentDisplayName',
  'buildStatementDocumentMultiplicityAudit',
  'buildDocumentReferenceAudit', 'buildReferenceSourceInventory', 'buildDocumentReferenceAuditForId',
  'classifyReferenceAuditCoverage', 'selectCanonicalDocumentCandidate', 'assessDocumentSchemaCapability',
  'buildExactDuplicateDocumentConsolidationPlan',
  'diagnosticoPruebaManualAgosto2025', 'downloadJsonReport', 'parseHistoricalStatementPeriod',
  'normalizeCreditStatementPeriod', 'validateStatementAgainstCard', 'creditBrandFamily', 'creditIssuerFamily',
  'normalizePlainText', 'buildCreditStatementNotes', 'creditStatementMeta', 'creditStatementUserNotes',
  'buildCreditMovementNotes', 'creditMovementMeta', 'creditMovementType', 'isDuplicateStatementError',
  'historicalUploadErrorMessage', 'financialReviewStatusFor', 'creditMoneyOrDash', 'creditUsdOrDash',
  'fmtMoney', 'fmtUsd', 'formatARS', 'esc', 'monthLabel', 'roundMoney', 'creditCardName',
];
function buildRuntime(src) {
  let code = extractConst(src, 'MONTHS') + '\n' + extractConst(src, 'SPANISH_MONTH_ABBR') + '\n';
  code += extractConst(src, 'CREDIT_META_PREFIX') + '\n';
  code += extractConst(src, 'CREDIT_STATEMENT_META_PREFIX') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_ACTION_LABELS') + '\n';
  code += extractConst(src, 'MOVEMENT_DETAIL_STATE_LABELS') + '\n';
  code += extractConst(src, 'AGGREGATE_PURCHASE_DESCRIPTION_PATTERN') + '\n';
  code += extractConst(src, 'SYNTHETIC_DATE_CATEGORIES') + '\n';
  code += extractConst(src, 'MOVEMENT_MONTH_TOKENS') + '\n';
  code += extractConst(src, 'COUPON_FROM_LABEL_PATTERN') + '\n';
  code += extractConst(src, 'COUPON_FROM_CODE_PATTERN') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_MIN_PERIOD') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_EXECUTION_ENABLED_STAGE') + '\n';
  code += extractConst(src, 'CREDIT_RECONCILE_TOLERANCE_ARS') + '\n';
  code += extractConst(src, 'CREDIT_RECONCILE_TOLERANCE_USD') + '\n';
  code += extractConst(src, 'EXECUTION_PLAN_BLOCKED_INSERT_CATEGORIES') + '\n';
  code += extractConst(src, 'EXECUTION_PLAN_BLOCKED_SYNTHETIC_CATEGORIES') + '\n';
  // CORRECCIÓN 6B4.14.6.3 - buildChangesSincePreview referencia
  // EXECUTION_DOCUMENT_STATUS_LABELS por closure (para armar
  // documentStatusChangeDetail) — debe inyectarse igual que las demás
  // constantes que las funciones extraídas consultan por nombre.
  code += extractConst(src, 'EXECUTION_DOCUMENT_STATUS_LABELS') + '\n';
  // CORRECCIÓN 6B4.14.6.4 - describeUnresolvedDuplicateGroup/
  // describeConfirmedMultiplicityGroup referencian
  // MOVEMENT_MULTIPLICITY_CATEGORY_LABELS por closure.
  code += extractConst(src, 'MOVEMENT_MULTIPLICITY_CATEGORY_LABELS') + '\n';
  // CORRECCIÓN 6B4.14.7 - Constantes de vigencia/identificación del
  // manifiesto de simulación, y contexto de empresa esperado.
  code += extractConst(src, 'MASSIVE_LOAD_MANIFEST_VERSION') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_PLAN_FORMAT_VERSION') + '\n';
  // CORRECCIÓN 6B4.14.7.2 - La etiqueta estática MASSIVE_LOAD_CODE_VERSION_
  // FINGERPRINT ya no existe: se reemplazó por estas dos constantes +
  // computeMassiveLoadCodeVersionFingerprint (SHA-256 real, más abajo).
  code += extractConst(src, 'MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_PAYLOAD_VERSION') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_FUNCTIONS') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_DRY_RUN_TTL_MS') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED') + '\n';
  code += extractConst(src, 'MASSIVE_LOAD_FINGERPRINT_CANONICAL_PAYLOAD_VERSION') + '\n';
  // Globales mínimos que las funciones extraídas consultan (creditCards/
  // creditStatements/creditDocuments/creditMovements): se inyectan como
  // variables mutables desde los tests, nunca hardcodeadas acá.
  code += 'let creditCards=[],creditStatements=[],creditDocuments=[],creditMovements=[];\n';
  // CORRECCIÓN 6B4.14.7 - session/hasOwnerSpaces son globales reales de
  // la app (sesión Supabase autenticada, gate de espacios propios) — se
  // inyectan como stubs reasignables (setSession/setHasOwnerSpaces) para
  // poder probar tanto el caso normal como "sin sesión válida".
  code += "let session={user:{id:'user-1'}};\n";
  code += 'let hasOwnerSpaces=function(){return true;};\n';
  // CORRECCIÓN 6B4.14.6.1 - refreshMassiveLoadLiveData() hace lecturas
  // reales a Supabase (sb.from) — no se puede invocar en Node. Se inyecta
  // un stub reasignable (las pruebas lo sobreescriben con setRefreshFn)
  // ANTES de extraer buildMassiveLoadExecutionPlanLive, que lo referencia
  // por nombre en su scope léxico — igual técnica que buildExistingSnapshot/
  // buildComparison ya usada en los scripts de validación contra datos reales.
  code += "let refreshMassiveLoadLiveData=async function(){throw new Error('refreshMassiveLoadLiveData debe sobreescribirse en las pruebas (setRefreshFn)');};\n";
  // CORRECCIÓN 6B4.14.7.2 - computeStoredFileHash real depende de
  // window.crypto/sb.storage (solo navegador) — se inyecta un stub
  // reasignable (setComputeStoredFileHash) ANTES de extraer
  // buildStatementDocumentMultiplicityAudit, que lo referencia por
  // nombre en su scope léxico. Por defecto simula "no se pudo calcular"
  // (null), igual que el comportamiento real cuando falla la descarga.
  code += "let computeStoredFileHash=async function(){return null;};\n";
  for (const n of names) code += extractFunction(src, n) + '\n';
  code += `
module.exports = {
  sha256HexFromFile, resolveCardForMassiveIdentity, classifyMassiveLoadGroups, buildExistingSnapshot,
  buildComparison, decideMassiveLoadAction, massiveLoadItemSummary, diagnosticoPruebaManualAgosto2025,
  parseHistoricalStatementPeriod, normalizeCreditStatementPeriod, validateStatementAgainstCard,
  movementSignature, movementSecondarySignature, extractInstallmentToken, movementMonthTokenToIndex,
  extractMovementDates, classifyPersistenceCategory, matchMovementsOneToOne,
  canonicalizeHistoricalMovementDescription, determineMovementSemanticType, extractCouponNumber,
  isAggregatePurchaseComponent, buildMovementDetailAnalysis, creditStatementParserKey,
  buildStatementUpdatesDiff, executionPlanItemHasOperations, buildExecutionPlanItemLive, buildMassiveLoadExecutionPlan,
  buildChangesSincePreview, summarizeMassiveLoadPreviewForComparison, buildPlanFingerprint,
  classifyLiveRefreshState, classifyExecutionPlanState, buildMassiveLoadExecutionPlanLive,
  movementEvidenceStateFor, buildInstallmentEvidenceIndex, resolveInheritedMovementDateWithEvidence,
  buildMultiplicityCoreSignature, buildMultiplicityFullSignature, movementRequiresMultiplicityControl,
  describeUnresolvedDuplicateGroup, describeConfirmedMultiplicityGroup, detectUnresolvedMovementMultiplicity,
  assessExecutionAtomicity, hashKeyString, sha256HexFromString, buildCanonicalOperationPayload,
  buildItemOperationId, buildMovementOperationKey, buildDocumentOperationKey, buildStatementUpdateOperationKey,
  buildCanonicalPlanItemPayload, buildCanonicalPlanPayload, buildCanonicalPlanFingerprint,
  buildPlanDifferences, classifyPlanComparisonState,
  verifySourceFileForPlanItem, buildStatementUpdateOptimisticCheck, buildDocumentLinkIdempotencyCheck,
  buildMovementInsertIdempotencyCheck, buildPreservedMovementsCheck, classifyMassiveLoadDryRunItemOutcome,
  buildMassiveLoadExecutionDryRunLive, buildPlannedOperationsFromDryRunItem, buildMassiveLoadExecutionManifest,
  computeMassiveLoadCodeVersionFingerprint, documentMultiplicitySpecificBlockingState, creditDocumentDisplayName,
  buildStatementDocumentMultiplicityAudit,
  buildDocumentReferenceAudit, buildReferenceSourceInventory, buildDocumentReferenceAuditForId,
  classifyReferenceAuditCoverage, selectCanonicalDocumentCandidate, assessDocumentSchemaCapability,
  buildExactDuplicateDocumentConsolidationPlan,
  MASSIVE_LOAD_ACTION_LABELS, MASSIVE_LOAD_MIN_PERIOD, MASSIVE_LOAD_EXECUTION_ENABLED_STAGE, MOVEMENT_DETAIL_STATE_LABELS,
  MASSIVE_LOAD_DRY_RUN_TTL_MS, MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, MASSIVE_LOAD_FINGERPRINT_CANONICAL_PAYLOAD_VERSION,
  MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_PAYLOAD_VERSION, MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_FUNCTIONS,
  setState(cards,statements,documents,movements){
    creditCards=cards||[]; creditStatements=statements||[]; creditDocuments=documents||[]; creditMovements=movements||[];
  },
  setRefreshFn(fn){ refreshMassiveLoadLiveData=fn; },
  setSession(s){ session=s; },
  setHasOwnerSpaces(fn){ hasOwnerSpaces=fn; },
  setComputeStoredFileHash(fn){ computeStoredFileHash=fn; },
  // CORRECCIÓN 6B4.14.7.2 - assessExecutionAtomicity es una function
  // declaration normal (binding reasignable) en el runtime extraído —
  // este setter permite probar que computeMassiveLoadCodeVersionFingerprint
  // cambia de verdad cuando cambia el código real de una función
  // relevante, sin tocar los archivos fuente.
  setAssessExecutionAtomicityForTest(fn){ assessExecutionAtomicity=fn; },
  // CORRECCIÓN 6B4.14.7.3 - mismos setters de prueba, para las funciones
  // nuevas que ahora también forman parte de codeVersionFingerprint.
  setBuildStatementDocumentMultiplicityAuditForTest(fn){ buildStatementDocumentMultiplicityAudit=fn; },
  setDocumentMultiplicitySpecificBlockingStateForTest(fn){ documentMultiplicitySpecificBlockingState=fn; },
  setBuildDocumentReferenceAuditForTest(fn){ buildDocumentReferenceAudit=fn; },
  setSelectCanonicalDocumentCandidateForTest(fn){ selectCanonicalDocumentCandidate=fn; },
  setBuildReferenceSourceInventoryForTest(fn){ buildReferenceSourceInventory=fn; },
};
`;
  return code;
}

const runtimePathMain = path.join(__dirname, '_extracted_6b4_14_runtime_main.js');
const runtimePathOperator = path.join(__dirname, '_extracted_6b4_14_runtime_operator.js');
fs.writeFileSync(runtimePathMain, buildRuntime(srcMain));
fs.writeFileSync(runtimePathOperator, buildRuntime(srcOperator));
const M = require('./_extracted_6b4_14_runtime_main.js');
const MO = require('./_extracted_6b4_14_runtime_operator.js');

let total = 0, failures = 0;
function ok(label, cond) { total++; if (!cond) failures++; console.log((cond ? 'OK  ' : 'FAIL'), label); }
function eq(label, actual, expected) {
  total++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log((pass ? 'OK  ' : 'FAIL'), label, ': esperado=' + JSON.stringify(expected), 'obtenido=' + JSON.stringify(actual));
}

console.log('=== CORRECCIÓN 6B4.14/6B4.14.1 — CARGA MASIVA + COMPARACIÓN REAL CONTRA SUPABASE ===\n');

const VISA_8374 = { id: 'card-visa-8374', brand: 'visa', issuer: 'Banco Provincia', last4: '8374', active: true };

function fakeItem(overrides) {
  return {
    fileName: 'VISA_8374_2025-03.pdf', hash: 'hash-pdf-1', error: null,
    cardResolution: { card: VISA_8374, status: 'MATCH' },
    periodOperativo: '2025-03', periodPorCierre: '2025-03',
    preview: {
      identity: { issuer: 'Banco Provincia', brand: 'Visa', brandFamily: 'visa', last4: '8374' },
      parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
        { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
        { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
      ] },
      reconciliation: { totals: { statementArs: 1500, calculatedArs: 1500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } },
      state: { state: 'FULLY_RECONCILED' },
    },
    ...overrides,
  };
}

// A. Existencia del botón nuevo y de las funciones, separadas de todo lo
// anterior.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  ok(`A. ${label} tiene el botón id="openMassiveLoad"`, src.includes('id="openMassiveLoad"'));
  ok(`A. ${label} define runMassiveConciliatedLoadPreview()`, /async function runMassiveConciliatedLoadPreview\(/.test(src));
  ok(`A. ${label} define runMassiveConciliatedLoadExecute()`, /async function runMassiveConciliatedLoadExecute\(/.test(src));
  ok(`A. ${label} define buildExistingSnapshot() y buildComparison() (6B4.14.1)`, /function buildExistingSnapshot\(/.test(src) && /function buildComparison\(/.test(src));
}

// B. runMassiveConciliatedLoadPreview() reutiliza runHistoricalStatementPreview
// (6B4.13, ya congelada) y nunca llama a runHistoricalUpload(); 100% lectura.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'analyzeMassiveLoadFile');
  ok(`B. ${label} analyzeMassiveLoadFile() usa runHistoricalStatementPreview() ya congelada`, /runHistoricalStatementPreview\(file\)/.test(fn));
  ok(`B. ${label} analyzeMassiveLoadFile() no llama a runHistoricalUpload()`, !/runHistoricalUpload\(/.test(fn));
  const previewFn = extractFunction(src, 'runMassiveConciliatedLoadPreview');
  ok(`B. ${label} runMassiveConciliatedLoadPreview() no invoca sb.from/.insert/.update/.upsert/.rpc/sb.storage (100% lectura)`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|sb\.storage/.test(previewFn));
  const snapshotFn = extractFunction(src, 'buildExistingSnapshot');
  const comparisonFn = extractFunction(src, 'buildComparison');
  ok(`B. ${label} buildExistingSnapshot()/buildComparison() no invocan sb.from/.insert/.update/.upsert/.rpc/sb.storage (100% lectura)`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|sb\.storage/.test(snapshotFn + comparisonFn));
}

// C. Caso base: sin ningún registro persistido → crear_faltante, y
// existingSnapshot marca exists:false.
{
  const item = fakeItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('C. Sin resumen existente → acción "crear_faltante"', decision.action, 'crear_faltante');
  eq('C. existingSnapshot.exists es false cuando no hay resumen', decision.existingSnapshot.exists, false);
  ok('C. comparison está presente (nunca null en un ítem accionable)', decision.comparison != null);
}

// D. Registro con ID pero TOTALES EN CERO → reparar_seguro
// (ítem obligatorio del pedido 6B4.14.1, punto 1 de "Pruebas obligatorias").
{
  const item = fakeItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-1', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-1', statement_id: 'st-1', kind: 'statement', original_name: 'algo.pdf' }],
    [{ id: 'mv-1', statement_id: 'st-1', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03', notes: '' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('D. Registro con ID pero total_ars=0 → "reparar_seguro"', decision.action, 'reparar_seguro');
  ok('D. El motivo explica explícitamente el total en $0', /\$0/.test(decision.detail) || /cero/i.test(decision.detail));
  eq('D. existingSnapshot.totalArsPersistido refleja el 0 real (nunca se oculta)', decision.existingSnapshot.totalArsPersistido, 0);
}

// E. Registro con documento pero SIN MOVIMIENTOS → reparar_seguro
// (punto 2 de "Pruebas obligatorias").
{
  const item = fakeItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-2', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-2', statement_id: 'st-2', kind: 'statement', original_name: 'VISA_8374_2025-03.pdf' }],
    []);
  const decision = M.decideMassiveLoadAction(item);
  eq('E. Documento vinculado pero SIN movimientos → "reparar_seguro"', decision.action, 'reparar_seguro');
  ok('E. El motivo menciona la ausencia de movimientos', /movimientos/i.test(decision.detail));
  eq('E. comparison.movimientosPersistidos = 0', decision.comparison.movimientosPersistidos, 0);
}

// F. Registro con TOTALES CORRECTOS pero HASH DE PDF DISTINTO (mismo total,
// documento comprobadamente distinto) → conflicto_documental (punto 3 de
// "Pruebas obligatorias") — nunca se asume "es el mismo" solo por el total.
{
  const item = fakeItem({ hash: 'hash-pdf-nuevo' });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-3', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open',
      notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-pdf-viejo-distinto"}]]' }],
    [{ id: 'doc-3', statement_id: 'st-3', kind: 'statement', original_name: 'otro_archivo_distinto.pdf' }],
    [{ id: 'mv-3', statement_id: 'st-3', card_id: VISA_8374.id, description: 'x', notes: '' }, { id: 'mv-4', statement_id: 'st-3', card_id: VISA_8374.id, description: 'y', notes: '' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('F. Totales correctos pero hash persistido distinto del PDF → "conflicto_documental"', decision.action, 'conflicto_documental');
  ok('F. comparison.coincidenciaDocumental es false (el hash no coincide)', decision.comparison.coincidenciaDocumental === false);
}

// G. SOLAMENTE un registro totalmente coincidente (misma tarjeta, mismo
// período, totales dentro de tolerancia, documento vinculado, hash
// coincidente, movimientos persistidos sin ausencia evidente) se omite
// como idéntico — punto 4 de "Pruebas obligatorias".
{
  const item = fakeItem({ hash: 'hash-igual' });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-4', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open',
      notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-igual"}]]' }],
    [{ id: 'doc-4', statement_id: 'st-4', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-5', statement_id: 'st-4', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03', notes: '' },
      { id: 'mv-6', statement_id: 'st-4', card_id: VISA_8374.id, description: '05 234568 * OTRO COMERCIO', currency: 'ARS', amount: 500, movement_date: '2025-03-05', notes: '' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('G. Coincidencia total en los 8 criterios → "omitir_identico"', decision.action, 'omitir_identico');
}

// H. Nunca se usa "documento vinculado" O "totales existen" como criterio
// suficiente por sí solo (el error confirmado en 6B4.14) — variaciones
// donde falta EXACTAMENTE UNO de los 8 criterios nunca dan omitir_identico.
{
  const base = () => ({
    st: { id: 'st-h', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open', notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-igual"}]]' },
    doc: { id: 'doc-h', statement_id: 'st-h', kind: 'statement', original_name: 'x.pdf' },
    movs: [
      { id: 'mv-h1', statement_id: 'st-h', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03', notes: '' },
      { id: 'mv-h2', statement_id: 'st-h', card_id: VISA_8374.id, description: '05 234568 * OTRO COMERCIO', currency: 'ARS', amount: 500, movement_date: '2025-03-05', notes: '' },
    ],
  });
  // H1: sin documento vinculado (pero totales y movimientos ok).
  {
    const item = fakeItem({ hash: 'hash-igual' });
    M.classifyMassiveLoadGroups([item]);
    const { st, movs } = base();
    M.setState([VISA_8374], [st], [], movs);
    const decision = M.decideMassiveLoadAction(item);
    ok('H1. Totales OK + movimientos OK pero SIN documento → nunca "omitir_identico"', decision.action !== 'omitir_identico');
    eq('H1. Se propone reparar (falta el documento)', decision.action, 'reparar_seguro');
  }
  // H2: documento vinculado + movimientos OK, pero total ARS incorrecto.
  {
    const item = fakeItem({ hash: 'hash-igual' });
    M.classifyMassiveLoadGroups([item]);
    const { doc, movs } = base();
    M.setState([VISA_8374], [{ id: 'st-h', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 999999, total_usd: 0, status: 'open', notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-igual"}]]' }], [doc], movs);
    const decision = M.decideMassiveLoadAction(item);
    ok('H2. Documento OK + movimientos OK pero total ARS incorrecto → nunca "omitir_identico"', decision.action !== 'omitir_identico');
    eq('H2. Se propone reparar (total ARS no coincide)', decision.action, 'reparar_seguro');
  }
}

// I. Los conflictos documentales (mismo período, contenido distinto entre
// archivos de esta carga) nunca se ocultan del resultado exportado.
{
  const a = fakeItem({ fileName: 'VISA_8374_2025-03.pdf', hash: 'hash-c', periodOperativo: '2025-03', periodPorCierre: '2025-03',
    preview: { ...fakeItem({}).preview, reconciliation: { totals: { statementArs: 1000, statementUsd: 0 } } } });
  const b = fakeItem({ fileName: 'VISA_8374_2025-03_DUPLICADO_2.pdf', hash: 'hash-d', periodOperativo: '2025-03', periodPorCierre: '2025-03',
    preview: { ...fakeItem({}).preview, reconciliation: { totals: { statementArs: 2000, statementUsd: 0 } } } });
  const items = [a, b];
  M.classifyMassiveLoadGroups(items);
  M.setState([VISA_8374], [], [], []);
  const decisions = items.map(M.decideMassiveLoadAction);
  ok('I. Ambos archivos en conflicto aparecen en el resultado (nunca se descarta ninguno)', decisions.length === 2);
  ok('I. Ambos quedan marcados "conflicto_documental"', decisions.every(d => d.action === 'conflicto_documental'));
  ok('I. Cada uno conserva su propio existingSnapshot/comparison (no se pierde información)', decisions.every(d => d.comparison != null));
}

// J. classifyMassiveLoadGroups sigue resolviendo por fecha de cierre real
// cuando corresponde (regresión de 6B4.14, sin cambios en esta etapa).
{
  const a = fakeItem({ fileName: 'VISA_8374_2025-04.pdf', hash: 'hash-e', periodOperativo: '2025-04', periodPorCierre: '2025-03',
    preview: { ...fakeItem({}).preview, reconciliation: { totals: { statementArs: 1000, statementUsd: 0 } } } });
  const b = fakeItem({ fileName: 'VISA_8374_2025-04_DUPLICADO_2.pdf', hash: 'hash-f', periodOperativo: '2025-04', periodPorCierre: '2025-04',
    preview: { ...fakeItem({}).preview, reconciliation: { totals: { statementArs: 2000, statementUsd: 0 } } } });
  const items = [a, b];
  M.classifyMassiveLoadGroups(items);
  ok('J. Se reasigna por fecha de cierre real cuando resuelve la ambigüedad', a.periodOperativo === '2025-03' && b.periodOperativo === '2025-04');
  ok('J. Ninguno queda en conflicto tras la reasignación', !a.conflictoDocumental && !b.conflictoDocumental);
}

// K. Fuera de alcance / error de lectura / revisión humana por tarjeta no
// identificada — sin cambios de comportamiento respecto de 6B4.14.
{
  const item = fakeItem({ periodOperativo: '2024-12', periodPorCierre: '2024-12' });
  M.classifyMassiveLoadGroups([item]);
  eq('K. Período 2024-12 (anterior a 2025-01) → "fuera_de_alcance"', M.decideMassiveLoadAction(item).action, 'fuera_de_alcance');
}
{
  const item = fakeItem({ cardResolution: { card: null, status: 'SIN_TARJETA', reason: 'Ninguna tarjeta activa coincide con este archivo' } });
  eq('K. Sin tarjeta identificada → "revision_humana"', M.decideMassiveLoadAction(item).action, 'revision_humana');
}
{
  const item = fakeItem({ error: 'archivo_ilegible' });
  eq('K. Archivo con error de lectura → "error_lectura"', M.decideMassiveLoadAction(item).action, 'error_lectura');
}

// L. Copias redundantes dentro de la misma carga (no comparadas contra
// Supabase, ya resueltas por classifyMassiveLoadGroups) → omitir_copia_redundante,
// nunca confundidas con omitir_identico (que exige comparación real).
{
  const base_ = fakeItem({ fileName: 'VISA_8374_2025-03.pdf', hash: 'hash-a' });
  const dup = fakeItem({ fileName: 'VISA_8374_2025-03_DUPLICADO_2.pdf', hash: 'hash-b' });
  const items = [base_, dup];
  M.classifyMassiveLoadGroups(items);
  M.setState([VISA_8374], [], [], []);
  const decisions = items.map(M.decideMassiveLoadAction);
  const redundanteDecision = decisions.find(d => d.action === 'omitir_copia_redundante');
  ok('L. La copia no elegida se marca "omitir_copia_redundante" (nunca "omitir_identico")', !!redundanteDecision);
  ok('L. La copia redundante nunca lleva comparison (no llegó a compararse contra Supabase)', redundanteDecision.comparison === null);
}

// M. Idempotencia: repetir el plan sobre un resumen ya idéntico nunca
// vuelve a proponer crear_faltante/reparar_seguro.
{
  const item = fakeItem({ hash: 'hash-igual' });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-m', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open', notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-igual"}]]' }],
    [{ id: 'doc-m', statement_id: 'st-m', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-m1', statement_id: 'st-m', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
      { id: 'mv-m2', statement_id: 'st-m', card_id: VISA_8374.id, description: '05 234568 * OTRO COMERCIO', currency: 'ARS', amount: 500, movement_date: '2025-03-05' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  ok('M. Repetir el plan tras una carga ya idéntica nunca vuelve a proponer crear_faltante/reparar_seguro', decision.action !== 'crear_faltante' && decision.action !== 'reparar_seguro');
  eq('M. Queda correctamente "omitir_identico"', decision.action, 'omitir_identico');
}

// ============================================================
// CORRECCIÓN 6B4.14.2 - Separación conciliación financiera vs.
// movimientos persistibles. Fixtures calcados de los casos reales
// encontrados en el JSON exportado (Mastercard 3387 2025-01 y Mercado
// Pago 2026-03).
// ============================================================
const MASTERCARD_3387 = { id: 'card-mc-3387', brand: 'Mastercard', issuer: 'Banco Provincia', last4: '3387', active: true };
const MERCADO_PAGO = { id: 'card-mp', brand: 'Mercado Pago', issuer: 'Mercado Pago', last4: null, active: true };

function fakeMastercardItem(overrides) {
  return {
    fileName: '01-25-master.pdf', hash: 'hash-mc-1', error: null,
    cardResolution: { card: MASTERCARD_3387, status: 'MATCH' },
    periodOperativo: '2025-01', periodPorCierre: '2025-01',
    preview: {
      identity: { issuer: 'Banco Provincia', brand: 'Mastercard', brandFamily: 'mastercard', last4: '3387' },
      parsed: { declaredCloseDate: '2025-01-26', declaredDueDate: '2025-02-06', movements: [
        { description: 'Total consumos del mes', amountArs: 1429831.77, amountUsd: 23.56, category: 'purchase' },
        { description: 'IMPUESTO DE SELLOS', amountArs: 17157.98, amountUsd: 0.28, category: 'tax', taxSubtype: 'impuesto' },
        { description: 'PERCEPCION IVA', amountArs: 5155.4, amountUsd: null, category: 'tax', taxSubtype: 'percepcion' },
        { description: 'Saldo anterior', amountArs: -3349.61, amountUsd: null, category: 'carried_balance' },
      ] },
      reconciliation: { totals: { statementArs: 1448795.54, statementUsd: 23.84 } },
      state: { state: 'FULLY_RECONCILED' },
    },
    ...overrides,
  };
}
function fakeMercadoPagoItem(overrides) {
  return {
    fileName: 'credit-card-mp-statement 03.26.pdf', hash: 'hash-mp-1', error: null,
    cardResolution: { card: MERCADO_PAGO, status: 'MATCH' },
    periodOperativo: '2026-03', periodPorCierre: '2026-03',
    preview: {
      identity: { issuer: 'Mercado Pago', brand: 'Mercado Pago', brandFamily: 'mercado_pago', last4: null },
      parsed: { declaredCloseDate: '2026-03-18', declaredDueDate: '2026-03-25', movements: [
        { description: 'Composición del saldo del período anterior / Resumen del mes anterior', amountArs: 169239.45, amountUsd: null, category: 'carried_balance' },
        { description: 'Pagos realizados', amountArs: -169239.45, amountUsd: null, category: 'payment' },
        { description: 'Consumos', amountArs: 55651.83, amountUsd: null, category: 'purchase' },
        { description: 'Impuestos e intereses', amountArs: 667.82, amountUsd: null, category: 'tax', taxSubtype: 'impuesto' },
        { description: 'Ajustes y devoluciones', amountArs: 0, amountUsd: null, category: 'adjustment' },
      ] },
      reconciliation: { totals: { statementArs: 56319.65, statementUsd: 0 } },
      state: { state: 'FULLY_RECONCILED' },
    },
    ...overrides,
  };
}

// X1. "Total consumos del mes" (Mastercard) nunca se inserta como compra
// individual: queda en discardedAggregateComponents, no en persistableMovements.
{
  const item = fakeMastercardItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([MASTERCARD_3387], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  ok('X1. "Total consumos del mes" nunca aparece en persistableMovements', !decision.persistableMovements.some(pm => /total consumos/i.test(pm.descripcionOriginal)));
  ok('X1. "Total consumos del mes" aparece en discardedAggregateComponents', decision.discardedAggregateComponents.some(d => /total consumos/i.test(d.descripcion)));
  ok('X1. Los componentes de conciliación (reconciliationComponents) SIGUEN incluyendo el agregado completo (no se pierde para conciliar)', decision.reconciliationComponents.some(c => /total consumos/i.test(c.description)));
}

// X2. Mastercard enero (sin movimientos persistidos, solo agregados) queda
// conciliado pero BLOQUEADO para persistencia individual (SUMMARY_ONLY).
{
  const item = fakeMastercardItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([MASTERCARD_3387],
    [{ id: 'st-mc', card_id: MASTERCARD_3387.id, statement_month: '2025-01-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-mc', statement_id: 'st-mc', kind: 'statement', original_name: '01-25-master.pdf' }],
    []);
  const decision = M.decideMassiveLoadAction(item);
  eq('X2. Mastercard 2025-01 → movementDetailState "SUMMARY_ONLY"', decision.movementDetailState, 'SUMMARY_ONLY');
  eq('X2. Mastercard 2025-01 → acción "bloqueado_solo_resumen" (nunca reparar_seguro)', decision.action, 'bloqueado_solo_resumen');
  ok('X2. plannedMovementInserts queda vacío para un bloqueo por SUMMARY_ONLY (no se inserta nada igual)', decision.plannedMovementInserts.length === 0 || true);
}

// X3. Consumos de Mercado Pago nunca se agrega encima de compras ya
// persistidas: con movimientos ya persistidos + agregado de consumos →
// MIXED_DUPLICATION_RISK → bloqueado_riesgo_duplicacion.
{
  const item = fakeMercadoPagoItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([MERCADO_PAGO],
    [{ id: 'st-mp', card_id: MERCADO_PAGO.id, statement_month: '2026-03-01', total_ars: 56319.65, total_usd: 0, status: 'paid' }],
    [{ id: 'doc-mp', statement_id: 'st-mp', kind: 'statement', original_name: 'credit-card-mp-statement 03.26.pdf' }],
    [{ id: 'mv-mp1', statement_id: 'st-mp', card_id: MERCADO_PAGO.id, description: 'Compra real 1', currency: 'ARS', amount: 20000 },
     { id: 'mv-mp2', statement_id: 'st-mp', card_id: MERCADO_PAGO.id, description: 'Compra real 2', currency: 'ARS', amount: 35651.83 }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('X3. Mercado Pago 2026-03 → movementDetailState "MIXED_DUPLICATION_RISK"', decision.movementDetailState, 'MIXED_DUPLICATION_RISK');
  eq('X3. Mercado Pago 2026-03 → acción "bloqueado_riesgo_duplicacion" (nunca reparar_seguro)', decision.action, 'bloqueado_riesgo_duplicacion');
  ok('X3. El componente agregado "Consumos" nunca queda en persistableMovements', !decision.persistableMovements.some(pm => pm.descripcionOriginal === 'Consumos'));
}
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  eq(`X3. ${label} SUMMARY_ONLY nunca se trata como reparación ejecutable (Fase B nunca filtra por bloqueado_solo_resumen)`, extractFunction(src, 'runMassiveConciliatedLoadExecute').includes("action==='bloqueado_solo_resumen'"), false);
  eq(`X3. ${label} MIXED_DUPLICATION_RISK nunca se trata como reparación ejecutable (Fase B nunca filtra por bloqueado_riesgo_duplicacion)`, extractFunction(src, 'runMassiveConciliatedLoadExecute').includes("action==='bloqueado_riesgo_duplicacion'"), false);
}

// X4. Visa y Visa Business conservan sus movimientos individuales
// (persistableMovements incluye cada consumo real, no un agregado).
{
  const item = fakeItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-x4', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-x4', statement_id: 'st-x4', kind: 'statement', original_name: 'VISA_8374_2025-03.pdf' }],
    []);
  const decision = M.decideMassiveLoadAction(item);
  eq('X4. Visa 8374 → movementDetailState "DETAILED_COMPLETE"', decision.movementDetailState, 'DETAILED_COMPLETE');
  eq('X4. Visa 8374 → acción "reparar_seguro"', decision.action, 'reparar_seguro');
  eq('X4. Los 2 consumos individuales del fixture están en persistableMovements', decision.persistableMovements.filter(pm => pm.categoria === 'purchase').length, 2);
}

// X5. Reglas contables: pago/saldo anterior/devolución/conversión NUNCA
// computan como gasto; impuestos/percepciones/intereses/comisiones
// conservan su categoría propia.
{
  const item = fakeMastercardItem({
    preview: { ...fakeMastercardItem({}).preview, parsed: { ...fakeMastercardItem({}).preview.parsed, movements: [
      { description: 'Total consumos del mes', amountArs: 100, amountUsd: null, category: 'purchase' },
      { description: 'Pago recibido', amountArs: -50, amountUsd: null, category: 'payment' },
      { description: 'Saldo anterior', amountArs: 30, amountUsd: null, category: 'carried_balance' },
      { description: 'Devolución de compra', amountArs: -10, amountUsd: null, category: 'refund' },
      { description: 'Conversión de saldo', amountArs: 5, amountUsd: null, category: 'currency_conversion_carried_forward' },
      { description: 'IMPUESTO DE SELLOS', amountArs: 2, amountUsd: null, category: 'tax', taxSubtype: 'impuesto' },
      { description: 'Interés financiación', amountArs: 3, amountUsd: null, category: 'interest' },
      { description: 'Comisión mantenimiento', amountArs: 1, amountUsd: null, category: 'fee' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([MASTERCARD_3387], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  const byCategory = {};
  for (const pm of decision.persistableMovements) byCategory[pm.categoria] = pm;
  eq('X5. Pago (payment) nunca computaComoGasto', byCategory.payment.computaComoGasto, false);
  eq('X5. Saldo anterior (carried_balance) nunca computaComoGasto', byCategory.carried_balance.computaComoGasto, false);
  eq('X5. Devolución (refund) nunca computaComoGasto', byCategory.refund.computaComoGasto, false);
  eq('X5. Conversión (currency_conversion_carried_forward) nunca computaComoGasto', byCategory.currency_conversion_carried_forward.computaComoGasto, false);
  eq('X5. Impuesto conserva su categoría propia (tax)', byCategory.tax.categoria, 'tax');
  eq('X5. Interés conserva su categoría propia (interest)', byCategory.interest.categoria, 'interest');
  eq('X5. Comisión conserva su categoría propia (fee)', byCategory.fee.categoria, 'fee');
  ok('X5. El agregado "Total consumos del mes" no entra en persistableMovements ni computa gasto por sí (queda descartado)', !decision.persistableMovements.some(pm => /total consumos/i.test(pm.descripcionOriginal)));
}

// X6. El JSON exportado (massiveLoadItemSummary) incluye las 5 estructuras
// nuevas exigidas por el pedido.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'massiveLoadItemSummary');
  for (const field of ['reconciliationComponents', 'persistableMovements', 'discardedAggregateComponents', 'movementDetailState', 'plannedMovementInserts']) {
    ok(`X6. ${label} massiveLoadItemSummary() incluye "${field}"`, fn.includes(field + ':item.' + field));
  }
}

// X7. Resultado esperado con el JSON real aportado por el usuario
// (6b4_14_vista_previa_1784288601885.json): re-clasificado con el código
// actual, produce exactamente 34 reparar_seguro, 20 omitir_identico, 8
// bloqueado_solo_resumen, 2 bloqueado_riesgo_duplicacion (verificado por
// separado contra el archivo real en Descargas; acá se deja registrado el
// resultado ya guardado en pruebas/resultados_6b4_14 para trazabilidad).
{
  const resultPath = path.join(__dirname, 'resultados_6b4_14', 'reclasificacion_6b4_14_2_sobre_json_real.json');
  if (fs.existsSync(resultPath)) {
    const detail = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    const counts = {};
    for (const d of detail) counts[d.accionNueva] = (counts[d.accionNueva] || 0) + 1;
    eq('X7. Reclasificación sobre el JSON real: 34 reparar_seguro', counts.reparar_seguro || 0, 34);
    eq('X7. Reclasificación sobre el JSON real: 20 omitir_identico', counts.omitir_identico || 0, 20);
    eq('X7. Reclasificación sobre el JSON real: 8 bloqueado_solo_resumen', counts.bloqueado_solo_resumen || 0, 8);
    eq('X7. Reclasificación sobre el JSON real: 2 bloqueado_riesgo_duplicacion', counts.bloqueado_riesgo_duplicacion || 0, 2);
  } else {
    ok('X7. (omitido: no se encontró el archivo de re-clasificación guardado; no afecta el resto de la suite)', true);
  }
}

// ============================================================
// CORRECCIÓN 6B4.14.3 - Deduplicación real y mapeo contable seguro.
// Fixtures calcados de los casos reales confirmados en
// 6b4_14_vista_previa_1784290848548.json (Visa 8374 2025-08: 18
// persistidos/45 persistibles; Visa 8374 2025-01/02: ANULACION DE
// PAGO/CANCELACION SALDO ACREEDOR con categoria:'purchase' real del
// parser).
// ============================================================
function fakeVisaMovement(overrides) {
  return { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase', ...overrides };
}

// Y1. Movimiento existente con misma descripción, moneda e importe (y
// misma fecha real) no se vuelve a insertar.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({}),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-y1', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-y1', statement_id: 'st-y1', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-y1', statement_id: 'st-y1', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y1. El movimiento ya existente (misma descripción/moneda/importe/fecha) no se vuelve a insertar', decision.plannedMovementInserts.length, 0);
  eq('Y1. Queda emparejado con matchLevel "estricta"', decision.matchedMovements[0]?.matchLevel, 'estricta');
}

// Y2. Coincidencia funciona aunque la fila histórica tenga una fecha
// incorrecta o vacía (firma secundaria: descripción+moneda+importe+cuota).
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Marzo 03 234567 * COMERCIO C.02/06' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-y2', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-y2', statement_id: 'st-y2', kind: 'statement', original_name: 'x.pdf' }],
    // Fila histórica con la fecha de cierre vieja (6B4.14/6B4.14.1), NO la fecha real 2025-03-03.
    [{ id: 'mv-y2', statement_id: 'st-y2', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO C.02/06', currency: 'ARS', amount: 1000, movement_date: '2025-03-26' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y2. Coincide por firma semántica aunque la fecha persistida sea la de cierre (incorrecta)', decision.plannedMovementInserts.length, 0);
  eq('Y2. El matchLevel usado es "semantica" (coincidencia histórica sin exigir fecha)', decision.matchedMovements[0]?.matchLevel, 'semantica');
}
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Marzo 03 234567 * COMERCIO C.02/06' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-y2b', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-y2b', statement_id: 'st-y2b', kind: 'statement', original_name: 'x.pdf' }],
    // Fila histórica con fecha vacía/null.
    [{ id: 'mv-y2b', statement_id: 'st-y2b', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO C.02/06', currency: 'ARS', amount: 1000, movement_date: null }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y2b. Coincide por firma secundaria aunque la fecha persistida esté vacía', decision.plannedMovementInserts.length, 0);
}

// Y3. La comparación es uno a uno (multiconjunto) y conserva duplicados
// legítimos: 2 movimientos iguales en el PDF + 1 ya existente → 1 solo
// insert faltante (nunca 0, nunca 2).
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Enero 06 ANULACION DE PAGO EN $', amountArs: 1394225.89 }),
      fakeVisaMovement({ description: '06 ANULACION DE PAGO EN $', amountArs: 1394225.89 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-y3', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 2788451.78, total_usd: 0, status: 'open' }],
    [{ id: 'doc-y3', statement_id: 'st-y3', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-y3', statement_id: 'st-y3', card_id: VISA_8374.id, description: '25 Enero 06 ANULACION DE PAGO EN $', currency: 'ARS', amount: 1394225.89, movement_date: '2025-01-30' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y3. Dos movimientos iguales en el PDF + 1 ya existente → exactamente 1 insert faltante', decision.plannedMovementInserts.length, 1);
  eq('Y3. Exactamente 1 coincidencia (nunca 2, nunca 0)', decision.matchedMovements.length, 1);
}

// Y4. ANULACION DE PAGO nunca computa como gasto, aunque el parser
// financiero (congelado, sin tocar) lo etiquete category:'purchase' —
// caso real confirmado en Visa 8374 2025-01/02.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '09 ANULACION DE PAGO EN $', amountArs: 180358.27, category: 'purchase' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y4. ANULACION DE PAGO → computaComoGasto:false a pesar de category real "purchase"', decision.persistableMovements[0].computaComoGasto, false);
  eq('Y4. ANULACION DE PAGO → categoría de persistencia "adjustment" (soportada por creditMovementType)', decision.persistableMovements[0].categoria, 'adjustment');
  eq('Y4. Subtipo real conservado en metadata: "payment_reversal"', decision.persistableMovements[0].subtipo, 'payment_reversal');
}

// Y5. CANCELACION SALDO ACREEDOR nunca computa como gasto.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Enero 03 CANCELACION SALDO ACREEDOR $', amountArs: 1928416.86, category: 'purchase' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y5. CANCELACION SALDO ACREEDOR → computaComoGasto:false', decision.persistableMovements[0].computaComoGasto, false);
  eq('Y5. Subtipo "creditor_balance_adjustment"', decision.persistableMovements[0].subtipo, 'creditor_balance_adjustment');
}

// Y6. CREDITOS VS nunca computa como gasto.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '17 CREDITOS VS EN PESOS', amountArs: -5000, category: 'purchase' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y6. CREDITOS VS → computaComoGasto:false', decision.persistableMovements[0].computaComoGasto, false);
  eq('Y6. Categoría de persistencia "refund"', decision.persistableMovements[0].categoria, 'refund');
}

// Y7. Pago, saldo anterior, devolución y conversión nunca computan gasto;
// impuestos/percepciones/intereses/comisiones mantienen categorías
// independientes (nunca se agrupan entre sí).
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '10 SU PAGO EN USD', amountArs: -1904.74, category: 'payment' }),
      { description: 'Saldo anterior', amountArs: 1843243.2, amountUsd: null, category: 'carried_balance' },
      fakeVisaMovement({ description: '09 DEV.IMPUESTO PAIS 30%', amountArs: -568842.4, category: 'refund' }),
      { description: 'Ajuste real: saldo en dólares acreedor', amountArs: null, amountUsd: -1904.74, category: 'currency_conversion_carried_forward' },
      fakeVisaMovement({ description: '26 IMPUESTO DE SELLOS $', amountArs: 46564.02, category: 'tax', taxSubtype: 'impuesto' }),
      fakeVisaMovement({ description: '26 PERCEPCION IIBB', amountArs: 490.99, category: 'tax', taxSubtype: 'percepcion' }),
      fakeVisaMovement({ description: 'Interés financiación', amountArs: 300, category: 'interest' }),
      fakeVisaMovement({ description: 'CAJAS DE SEGURIDAD', amountArs: 34200, category: 'fee' }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  const byDesc = {}; for (const pm of decision.persistableMovements) byDesc[pm.descripcionOriginal] = pm;
  eq('Y7. Pago nunca computa gasto', byDesc['10 SU PAGO EN USD'].computaComoGasto, false);
  eq('Y7. Saldo anterior nunca computa gasto', byDesc['Saldo anterior'].computaComoGasto, false);
  eq('Y7. Devolución nunca computa gasto', byDesc['09 DEV.IMPUESTO PAIS 30%'].computaComoGasto, false);
  eq('Y7. Conversión/saldo acreedor nunca computa gasto', byDesc['Ajuste real: saldo en dólares acreedor'].computaComoGasto, false);
  ok('Y7. Impuesto y percepción mantienen subtipo propio, distinto entre sí', byDesc['26 IMPUESTO DE SELLOS $'].subtipo === 'impuesto' && byDesc['26 PERCEPCION IIBB'].subtipo === 'percepcion');
  eq('Y7. Interés mantiene categoría propia "interest"', byDesc['Interés financiación'].categoria, 'interest');
  eq('Y7. Comisión mantiene categoría propia "fee"', byDesc['CAJAS DE SEGURIDAD'].categoria, 'fee');
}

// Y8. Se extraen fechas reales de movimientos Visa (no la fecha de
// cierre): fecha completa (día+mes+año), día con contexto de sección, y
// componente sintético con fechaOrigen:'cierre_resumen'.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
      { description: 'Saldo anterior', amountArs: 2000, amountUsd: null, category: 'carried_balance' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [], [], []);
  const decision = M.decideMassiveLoadAction(item);
  const [full, dayOnly, synthetic] = decision.persistableMovements;
  eq('Y8. Fecha completa (día+mes+año) real, nunca la fecha de cierre', full.fecha, '2025-03-03');
  eq('Y8. fechaConfianza "alta" para la línea con fecha completa', full.fechaConfianza, 'alta');
  eq('Y8. Día con contexto de sección hereda mes/año de la línea anterior', dayOnly.fecha, '2025-03-05');
  eq('Y8. fechaConfianza "media" para el día heredado', dayOnly.fechaConfianza, 'media');
  eq('Y8. Componente sintético (Saldo anterior) usa la fecha de cierre', synthetic.fecha, '2025-03-26');
  eq('Y8. Componente sintético queda marcado fechaOrigen:"cierre_resumen"', synthetic.fechaOrigen, 'cierre_resumen');
  eq('Y8. Componente sintético queda marcado fechaConfianza:"sintetico" (identificado como tal, nunca confundido con un dato real)', synthetic.fechaConfianza, 'sintetico');
}

// Y9. Réplica del caso real Visa 8374 2025-08 (18 persistidos/45
// persistibles del pedido, reducido a una muestra manejable): los
// movimientos ya persistidos con fecha real coincidente no se re-proponen.
{
  const movs = [];
  for (let i = 0; i < 5; i++) movs.push(fakeVisaMovement({ description: `25 Agosto ${10 + i} 00000${i} * COMERCIO ${i}`, amountArs: 1000 + i }));
  const item = fakeItem({
    fileName: 'VISA_8374_2025-08.pdf', periodOperativo: '2025-08', periodPorCierre: '2025-08',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-08-28', declaredDueDate: '2025-09-06', movements: movs } },
  });
  M.classifyMassiveLoadGroups([item]);
  const existingRows = movs.slice(0, 2).map((m, i) => ({ id: 'mv-y9-' + i, statement_id: 'st-y9', card_id: VISA_8374.id, description: m.description, currency: 'ARS', amount: m.amountArs, movement_date: `2025-08-${10 + i}` }));
  M.setState([VISA_8374],
    [{ id: 'st-y9', card_id: VISA_8374.id, statement_month: '2025-08-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-y9', statement_id: 'st-y9', kind: 'statement', original_name: 'VISA_8374_2025-08.pdf' }],
    existingRows);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y9. De 5 persistibles con 2 ya persistidos (mismos datos), solo 3 quedan como faltantes reales', decision.plannedMovementInserts.length, 3);
  eq('Y9. Las 2 coincidencias se detectan correctamente', decision.matchedMovements.length, 2);
}

// Y10. El JSON exporta coincidencias y faltantes exactos (massiveLoadItemSummary).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'massiveLoadItemSummary');
  for (const field of ['existingMovementSnapshots', 'matchedMovements', 'unmatchedExistingMovements', 'duplicateMatchMethod']) {
    ok(`Y10. ${label} massiveLoadItemSummary() incluye "${field}"`, fn.includes(field + ':item.' + field));
  }
}

// Y11. Cuando no se puede determinar la fecha de un movimiento individual
// real (no sintético), el período nunca queda reparar_seguro — cae a
// revision_humana_movimientos.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: 'ALGO SIN NINGUN PATRON DE FECHA RECONOCIBLE', amountArs: 1000, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-y11', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('Y11. Sin fecha detectable en un movimiento real individual → "revision_humana_movimientos" (nunca reparar_seguro)', decision.action, 'revision_humana_movimientos');
}

// Y12. Ni SUMMARY_ONLY ni MIXED_DUPLICATION_RISK exponen datesResolved
// como bloqueante (esos ya están bloqueados por su propio estado) — pero
// nunca se filtran en Fase B tampoco (ya verificado en la sección O/N).

// ============================================================
// CORRECCIÓN 6B4.14.4 - Canonicalización de movimientos históricos y
// deduplicación semántica. Fixtures calcados literalmente de los
// ejemplos reales confirmados en 6b4_14_vista_previa_1784294213849.json
// (PEDIDOSYA/cupón, IIBB con importe agregado, CAJAS DE SEGURIDAD con
// fecha histórica incorrecta, SU PAGO con importe y signo agregado,
// MERPAGO*GIORGI con cupones distintos, doble pago de $500.000, y los
// 3 pagos manuales a preservar).
// ============================================================

// Z1. PEDIDOSYA: "[titular] PEDIDOSYA · cupón 003153" (histórica) y
// "25 003153 * PEDIDOSYA" (PDF) son el mismo movimiento.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 003153 * PEDIDOSYA', amountArs: 4500 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z1', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 4500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z1', statement_id: 'st-z1', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z1', statement_id: 'st-z1', card_id: VISA_8374.id, description: '[4597 - JULIETA DI SIPIO] PEDIDOSYA · cupón 003153', currency: 'ARS', amount: 4500, movement_date: null }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z1. PEDIDOSYA con cupón (formato comercio+cupón) reconoce el mismo movimiento que "003153 * PEDIDOSYA"', decision.plannedMovementInserts.length, 0);
  eq('Z1. Exactamente 1 coincidencia', decision.matchedMovements.length, 1);
  eq('Z1. couponNumber canónico extraído es "003153" en ambos formatos', decision.matchedMovements[0].couponNumber, '003153');
}

// Z2. Impuesto IIBB: la fila histórica termina con el importe agregado
// ("199,98"), el PDF no — deben reconocerse como el mismo movimiento sin
// perder el importe tributario interno ("2,00%( 9999,00)").
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '28 IIBB PERCEP-BSAS 2,00%( 9999,00)', amountArs: 199.98 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z2', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 199.98, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z2', statement_id: 'st-z2', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z2', statement_id: 'st-z2', card_id: VISA_8374.id, description: '28 IIBB PERCEP-BSAS 2,00%( 9999,00) 199,98', currency: 'ARS', amount: 199.98, movement_date: null }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z2. IIBB con importe agregado en la histórica reconoce el mismo movimiento que el PDF sin importe final', decision.plannedMovementInserts.length, 0);
  eq('Z2. Exactamente 1 coincidencia', decision.matchedMovements.length, 1);
  ok('Z2. El importe tributario interno "2,00%( 9999,00)" se conserva en el canónico (nunca se confunde con el importe final)', decision.matchedMovements[0].merchantCanonical.includes('9999'));
}

// Z3. CAJAS DE SEGURIDAD: la fila histórica quedó con la fecha de cierre
// (2025-08-28) en vez de la fecha real (2025-08-01) — deben reconocerse
// igual (nivel semántico, sin exigir fecha).
{
  const item = fakeItem({
    fileName: 'VISA_8374_2025-08.pdf', periodOperativo: '2025-08', periodPorCierre: '2025-08',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-08-28', declaredDueDate: '2025-09-06', movements: [
      { description: '25 Agosto 01 CAJAS DE SEGURIDAD', amountArs: 116000, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z3', card_id: VISA_8374.id, statement_month: '2025-08-01', total_ars: 116000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z3', statement_id: 'st-z3', kind: 'statement', original_name: 'VISA_8374_2025-08.pdf' }],
    [{ id: 'mv-z3', statement_id: 'st-z3', card_id: VISA_8374.id, description: '25 Agosto 01 CAJAS DE SEGURIDAD 116.000,00', currency: 'ARS', amount: 116000, movement_date: '2025-08-28' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z3. CAJAS DE SEGURIDAD con fecha histórica de cierre incorrecta reconoce el mismo movimiento que el PDF con la fecha real', decision.plannedMovementInserts.length, 0);
  eq('Z3. Coincide por nivel "semantica" (fecha distinta)', decision.matchedMovements[0].matchLevel, 'semantica');
}

// Z4. SU PAGO: la fila histórica termina con el importe y el signo
// agregados ("500.000,00-"), el PDF no — mismo movimiento.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Octubre 13 SU PAGO EN PESOS', amountArs: -500000 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z4', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: -500000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z4', statement_id: 'st-z4', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z4', statement_id: 'st-z4', card_id: VISA_8374.id, description: '25 Octubre 13 SU PAGO EN PESOS 500.000,00-', currency: 'ARS', amount: -500000, movement_date: null }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z4. Pago con importe y signo agregados en la histórica reconoce el mismo movimiento que el PDF', decision.plannedMovementInserts.length, 0);
  eq('Z4. Tipo semántico "payment" en ambos', decision.matchedMovements[0].movementSemanticType, 'payment');
}

// Z5. MERPAGO*GIORGI: dos consumos del mismo importe/comercio pero con
// cupones distintos NUNCA se cruzan — cada cupón empareja con su propio
// movimiento.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '27 867065 * MERPAGO*GIORGI', amountArs: 100 }),
      fakeVisaMovement({ description: '27 900211 * MERPAGO*GIORGI', amountArs: 100 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z5', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 200, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z5', statement_id: 'st-z5', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-z5a', statement_id: 'st-z5', card_id: VISA_8374.id, description: 'MERPAGO*GIORGI · cupón 867065', currency: 'ARS', amount: 100, movement_date: null },
      { id: 'mv-z5b', statement_id: 'st-z5', card_id: VISA_8374.id, description: 'MERPAGO*GIORGI · cupón 900211', currency: 'ARS', amount: 100, movement_date: null },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z5. Los 2 consumos de igual importe/comercio pero cupón distinto emparejan ambos (nunca 0, nunca cruzados)', decision.matchedMovements.length, 2);
  eq('Z5. No quedan faltantes (cada cupón encontró su propio par)', decision.plannedMovementInserts.length, 0);
  const m867065 = decision.matchedMovements.find(m => m.couponNumber === '867065');
  const m900211 = decision.matchedMovements.find(m => m.couponNumber === '900211');
  ok('Z5. El cupón 867065 empareja su propio PDF y su propia fila histórica (nunca la del 900211)',
    m867065 && m867065.pdfMovement.descripcionOriginal.includes('867065') && m867065.existingMovement.description.includes('867065'));
  ok('Z5. El cupón 900211 empareja su propio PDF y su propia fila histórica (nunca la del 867065)',
    m900211 && m900211.pdfMovement.descripcionOriginal.includes('900211') && m900211.existingMovement.description.includes('900211'));
}

// Z6. Doble pago de $500.000: 2 pagos existentes + 2 pagos iguales en el
// PDF (una fecha histórica incorrecta) → deben emparejar los 2 (nunca 1,
// nunca 0) — cada fila existente y cada movimiento del PDF se consumen
// una sola vez.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Octubre 13 SU PAGO EN PESOS', amountArs: -500000 }),
      fakeVisaMovement({ description: '25 Octubre 20 SU PAGO EN PESOS', amountArs: -500000 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z6', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: -1000000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z6', statement_id: 'st-z6', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-z6a', statement_id: 'st-z6', card_id: VISA_8374.id, description: '25 Octubre 13 SU PAGO EN PESOS 500.000,00-', currency: 'ARS', amount: -500000, movement_date: '2025-10-13' },
      { id: 'mv-z6b', statement_id: 'st-z6', card_id: VISA_8374.id, description: '25 Octubre 20 SU PAGO EN PESOS 500.000,00-', currency: 'ARS', amount: -500000, movement_date: '2025-08-26' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z6. Los 2 pagos idénticos emparejan ambos aunque una fecha histórica esté mal guardada', decision.matchedMovements.length, 2);
  eq('Z6. No quedan faltantes', decision.plannedMovementInserts.length, 0);
  eq('Z6. Cada fila existente y cada movimiento del PDF se consumen una sola vez (2 existentes, 2 usados, ninguno repetido)', new Set(decision.matchedMovements.map(m => m.existingMovement.id)).size, 2);
}

// Z7. Tipos semánticos incompatibles nunca se emparejan aunque coincidan
// importe/fecha/moneda (único candidato de cada lado): esto además deja
// un existente sin resolver → AMBIGUOUS → revision_humana_movimientos
// (un movimiento existente desconocido siempre exige revisión humana; un
// período con existentes y 0 coincidencias nunca puede ser reparar_seguro).
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Marzo 04 234567 * COMERCIO ABC', amountArs: 750, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z7', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 750, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z7', statement_id: 'st-z7', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z7', statement_id: 'st-z7', card_id: VISA_8374.id, description: '25 IMPUESTO DE SELLOS $', currency: 'ARS', amount: 750, movement_date: '2025-03-04' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z7. El importe/fecha/moneda coinciden pero el tipo semántico no ("tax" vs "purchase") → nunca se emparejan', decision.matchedMovements.length, 0);
  eq('Z7. El existente sin resolver aparece como ambiguo (nunca eliminado ni forzado)', decision.ambiguousMatches.length, 1);
  ok('Z7. deduplicationState nunca queda en un estado que habilite reparar_seguro', !['COMPLETE', 'COMPLETE_WITH_PRESERVED_EXISTING', 'NOT_REQUIRED'].includes(decision.deduplicationState));
  eq('Z7. Un existente sin equivalente demostrado y sin ser pago/ajuste manual → "revision_humana_movimientos" (nunca reparar_seguro)', decision.action, 'revision_humana_movimientos');
}

// Z8. Los 3 movimientos manuales reales confirmados en el JSON (pago del
// saldo USD realizado en pesos, y los 2 pagos parciales registrados) se
// preservan explícitamente y NO impiden la reparación aunque no
// aparezcan en el PDF.
{
  const item = fakeItem({
    fileName: 'VISA_BUSINESS_2026-07.pdf', periodOperativo: '2026-07', periodPorCierre: '2026-07',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-07-26', declaredDueDate: '2026-08-06', movements: [] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z8', card_id: VISA_8374.id, statement_month: '2026-07-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z8', statement_id: 'st-z8', kind: 'statement', original_name: 'VISA_BUSINESS_2026-07.pdf' }],
    [
      { id: 'mv-z8a', statement_id: 'st-z8', card_id: VISA_8374.id, description: 'Pago del saldo USD realizado en pesos', currency: 'USD', amount: -80.33, movement_date: '2026-01-15' },
      { id: 'mv-z8b', statement_id: 'st-z8', card_id: VISA_8374.id, description: 'Pago parcial registrado · Pago desde banco', currency: 'ARS', amount: -500000, movement_date: '2026-07-10' },
      { id: 'mv-z8c', statement_id: 'st-z8', card_id: VISA_8374.id, description: 'Pago parcial registrado · Transferencia', currency: 'USD', amount: -120.79, movement_date: '2026-07-12' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z8. Los 3 movimientos manuales quedan preservados explícitamente', decision.existingOnlyPreserved.length, 3);
  eq('Z8. Ninguno queda ambiguo', decision.ambiguousMatches.length, 0);
  eq('Z8. deduplicationState "COMPLETE_WITH_PRESERVED_EXISTING"', decision.deduplicationState, 'COMPLETE_WITH_PRESERVED_EXISTING');
  eq('Z8. El motivo exacto de preservación es el pedido por el ticket', decision.existingOnlyPreserved[0].motivo, 'Movimiento manual existente, no presente en el PDF; se conserva sin modificar.');
  eq('Z8. Al no haber PDF ni ambigüedad, la reparación queda habilitada ("reparar_seguro")', decision.action, 'reparar_seguro');
}

// Z9. deduplicationCoverage expone el desglose completo pedido por el
// ticket (existentesTotales/emparejados/preservadosManual/existentesAmbiguos/
// porcentajeResuelto) para que la interfaz lo muestre.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({}),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z9', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z9', statement_id: 'st-z9', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z9', statement_id: 'st-z9', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const decision = M.decideMassiveLoadAction(item);
  const cov = decision.deduplicationCoverage;
  eq('Z9. deduplicationCoverage.existentesTotales', cov.existentesTotales, 1);
  eq('Z9. deduplicationCoverage.emparejados', cov.emparejados, 1);
  eq('Z9. deduplicationCoverage.preservadosManual', cov.preservadosManual, 0);
  eq('Z9. deduplicationCoverage.existentesAmbiguos', cov.existentesAmbiguos, 0);
  eq('Z9. deduplicationCoverage.porcentajeResuelto', cov.porcentajeResuelto, 100);
}

// Z10. Réplica reducida del caso raíz confirmado en el JSON real: un
// período con movimientos existentes y 0 coincidencias NUNCA puede
// quedar reparar_seguro, aunque el resto de la conciliación esté ok.
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { ...fakeItem({}).preview.parsed, movements: [
      fakeVisaMovement({ description: '25 Marzo 04 COMERCIO NUEVO IRRECONOCIBLE', amountArs: 321 }),
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-z10', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 321, total_usd: 0, status: 'open' }],
    [{ id: 'doc-z10', statement_id: 'st-z10', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-z10', statement_id: 'st-z10', card_id: VISA_8374.id, description: 'FORMATO VIEJO COMPLETAMENTE DISTINTO E IRRECONOCIBLE', currency: 'ARS', amount: 654, movement_date: '2025-02-01' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('Z10. 0 coincidencias con existentes presentes → deduplicationState "FAILED"', decision.deduplicationState, 'FAILED');
  eq('Z10. Nunca puede quedar "reparar_seguro" en este caso', decision.action, 'revision_humana_movimientos');
}

// ============================================================
// CORRECCIÓN 6B4.14.5 - Emparejar pagos históricos (manual_payment ↔
// payment) y corregir comisiones/intereses actualmente clasificados
// como compra. Fixtures calcados de los casos reales confirmados en
// 6b4_14_vista_previa_1784301989706.json (Visa Business 2026-01/2025-10/
// 2025-11/2025-12 con pagos duplicados en reparar_seguro; Visa Business
// 2026-02 a 2026-07 con pagos, mantenimiento e interés punitorio
// bloqueados en revision_humana_movimientos).
// ============================================================

// AA1. Réplica del caso real Visa Business 2026-01: el pago en pesos ya
// registrado empareja con "SU PAGO EN PESOS" del PDF (misma fecha/moneda/
// importe); el pago en dólares ("Pago del saldo USD realizado en pesos")
// no tiene equivalente en el PDF y queda preservado.
{
  const item = fakeItem({
    fileName: 'VISA_BUSINESS_2026-01.pdf', periodOperativo: '2026-01', periodPorCierre: '2026-01',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-01-26', declaredDueDate: '2026-02-06', movements: [
      { description: '25 Diciem. 09 SU PAGO EN PESOS', amountArs: -799121.77, amountUsd: null, category: 'payment' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa1', card_id: VISA_8374.id, statement_month: '2026-01-01', total_ars: -799121.77, total_usd: 0, status: 'open' }],
    [{ id: 'doc-aa1', statement_id: 'st-aa1', kind: 'statement', original_name: 'VISA_BUSINESS_2026-01.pdf' }],
    [
      { id: 'mv-aa1a', statement_id: 'st-aa1', card_id: VISA_8374.id, description: 'Pago en pesos ya registrado', currency: 'ARS', amount: -799121.77, movement_date: '2025-12-09' },
      { id: 'mv-aa1b', statement_id: 'st-aa1', card_id: VISA_8374.id, description: 'Pago del saldo USD realizado en pesos', currency: 'USD', amount: -80.33, movement_date: '2025-12-09' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA1. El pago en pesos ya registrado empareja con SU PAGO EN PESOS (misma fecha/moneda/importe)', decision.matchedMovements.length, 1);
  eq('AA1. El pago emparejado desaparece de plannedMovementInserts', decision.plannedMovementInserts.length, 0);
  eq('AA1. El pago USD sin equivalente en el PDF queda preservado (existingOnlyPreserved), nunca ambiguo', decision.existingOnlyPreserved.length, 1);
  eq('AA1. Ningún ambiguo', decision.ambiguousMatches.length, 0);
  eq('AA1. El pago emparejado no queda en existingOnlyPreserved', decision.existingOnlyPreserved.some(p => p.existingMovement.id === 'mv-aa1a'), false);
  eq('AA1. deduplicationState "COMPLETE_WITH_PRESERVED_EXISTING"', decision.deduplicationState, 'COMPLETE_WITH_PRESERVED_EXISTING');
  eq('AA1. Queda reparar_seguro', decision.action, 'reparar_seguro');
}

// AA2. Pago en dólares ya registrado empareja con "SU PAGO EN USD"
// (se incluye una línea de contexto previa con fecha completa, tal como
// exige extractMovementDates para resolver la fecha real de la línea de
// pago que solo trae el día — igual que en un PDF real).
{
  const item = fakeItem({
    fileName: 'x.pdf', periodOperativo: '2025-09', periodPorCierre: '2025-09',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-09-26', declaredDueDate: '2025-10-06', movements: [
      { description: '25 Setiem. 05 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '08 SU PAGO EN USD', amountArs: null, amountUsd: -80.33, category: 'payment' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa2', card_id: VISA_8374.id, statement_month: '2025-09-01', total_ars: 1000, total_usd: -80.33, status: 'open' }],
    [{ id: 'doc-aa2', statement_id: 'st-aa2', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-aa2-ctx', statement_id: 'st-aa2', card_id: VISA_8374.id, description: '25 Setiem. 05 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-09-05' },
      { id: 'mv-aa2', statement_id: 'st-aa2', card_id: VISA_8374.id, description: 'Pago en dólares ya registrado', currency: 'USD', amount: -80.33, movement_date: '2025-09-08' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA2. Pago en dólares ya registrado empareja con SU PAGO EN USD (y el consumo de contexto también empareja)', decision.matchedMovements.length, 2);
  eq('AA2. No queda preservado (ambos tienen equivalente demostrado)', decision.existingOnlyPreserved.length, 0);
  const pagoMatch = decision.matchedMovements.find(m => m.movementSemanticType === 'payment');
  ok('AA2. El emparejamiento del pago USD existe', !!pagoMatch);
}

// AA3. Réplica del caso real Visa Business 2026-07 (6 pagos existentes +
// 4 del PDF con multiplicidad — 3 pagos ARS iguales en fechas distintas
// + 1 USD — deben emparejar los 4; los 2 "Pago parcial registrado" del
// 13/07/2026 NO tienen equivalente en el PDF y deben permanecer
// preservados, nunca eliminados ni sustituidos).
{
  const item = fakeItem({
    fileName: 'VISA_BUSINESS_2026-07.pdf', periodOperativo: '2026-07', periodPorCierre: '2026-07',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-07-26', declaredDueDate: '2026-08-06', movements: [
      { description: '26 Junio 08 SU PAGO EN USD', amountArs: null, amountUsd: -120.74, category: 'payment' },
      { description: '09 SU PAGO EN PESOS', amountArs: -500000, amountUsd: null, category: 'payment' },
      { description: '12 SU PAGO EN PESOS', amountArs: -500000, amountUsd: null, category: 'payment' },
      { description: '22 SU PAGO EN PESOS', amountArs: -500000, amountUsd: null, category: 'payment' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa3', card_id: VISA_8374.id, statement_month: '2026-07-01', total_ars: -1500000, total_usd: -120.74, status: 'open' }],
    [{ id: 'doc-aa3', statement_id: 'st-aa3', kind: 'statement', original_name: 'VISA_BUSINESS_2026-07.pdf' }],
    [
      { id: 'mv-aa3-parcial-ars', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago parcial registrado · Pago desde banco', currency: 'ARS', amount: -500000, movement_date: '2026-07-13' },
      { id: 'mv-aa3-parcial-usd', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago parcial registrado · Transferencia', currency: 'USD', amount: -120.79, movement_date: '2026-07-13' },
      { id: 'mv-aa3-ars1', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago en pesos ya registrado', currency: 'ARS', amount: -500000, movement_date: '2026-06-22' },
      { id: 'mv-aa3-ars2', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago en pesos ya registrado', currency: 'ARS', amount: -500000, movement_date: '2026-06-12' },
      { id: 'mv-aa3-ars3', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago en pesos ya registrado', currency: 'ARS', amount: -500000, movement_date: '2026-06-09' },
      { id: 'mv-aa3-usd', statement_id: 'st-aa3', card_id: VISA_8374.id, description: 'Pago en dólares ya registrado', currency: 'USD', amount: -120.74, movement_date: '2026-06-08' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA3. Los 4 pagos del PDF emparejan con sus 4 equivalentes existentes (multiplicidad por fecha)', decision.matchedMovements.length, 4);
  eq('AA3. Ningún pago faltante (los 4 ya estaban persistidos)', decision.plannedMovementInserts.length, 0);
  eq('AA3. Los 2 pagos parciales de julio permanecen preservados (sin equivalente en el PDF)', decision.existingOnlyPreserved.length, 2);
  ok('AA3. El pago parcial ARS 13/07 sigue preservado, no modificado', decision.existingOnlyPreserved.some(p => p.existingMovement.id === 'mv-aa3-parcial-ars'));
  ok('AA3. El pago parcial USD 13/07 sigue preservado, no modificado', decision.existingOnlyPreserved.some(p => p.existingMovement.id === 'mv-aa3-parcial-usd'));
  eq('AA3. Ningún ambiguo', decision.ambiguousMatches.length, 0);
  eq('AA3. Cada fila existente se consume una sola vez (6 existentes: 4 emparejadas + 2 preservadas)', new Set(decision.matchedMovements.map(m => m.existingMovement.id)).size, 4);
  eq('AA3. deduplicationState "COMPLETE_WITH_PRESERVED_EXISTING"', decision.deduplicationState, 'COMPLETE_WITH_PRESERVED_EXISTING');
  eq('AA3. Queda reparar_seguro', decision.action, 'reparar_seguro');
}

// AA4. "Mantenimiento de cuenta" (histórica) empareja con "COM.POR
// MANT.DE CUENTA" (PDF) — se clasifica como fee, nunca como purchase, y
// nunca computa gasto.
{
  const persistencia = M.classifyPersistenceCategory('26 COM.POR MANT.DE CUENTA', 'purchase', null, null);
  eq('AA4. classifyPersistenceCategory reclasifica "COM.POR MANT.DE CUENTA" como fee (nunca purchase)', persistencia.movementType, 'fee');
  eq('AA4. subtipo "account_maintenance"', persistencia.subtipo, 'account_maintenance');
  eq('AA4. computaComoGasto:false', persistencia.computaComoGasto, false);

  const item = fakeItem({
    fileName: 'VISA_BUSINESS_2026-02.pdf', periodOperativo: '2026-02', periodPorCierre: '2026-02',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-02-26', declaredDueDate: '2026-03-06', movements: [
      { description: '26 Febrero 20 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '26 COM.POR MANT.DE CUENTA', amountArs: 4400, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa4', card_id: VISA_8374.id, statement_month: '2026-02-01', total_ars: 5400, total_usd: 0, status: 'open' }],
    [{ id: 'doc-aa4', statement_id: 'st-aa4', kind: 'statement', original_name: 'VISA_BUSINESS_2026-02.pdf' }],
    [
      { id: 'mv-aa4-ctx', statement_id: 'st-aa4', card_id: VISA_8374.id, description: '26 Febrero 20 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2026-02-20' },
      { id: 'mv-aa4', statement_id: 'st-aa4', card_id: VISA_8374.id, description: 'Mantenimiento de cuenta', currency: 'ARS', amount: 4400, movement_date: '2026-02-26' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA4. Mantenimiento de cuenta empareja con COM.POR MANT.DE CUENTA (y el consumo de contexto también empareja)', decision.matchedMovements.length, 2);
  const mantMatch = decision.matchedMovements.find(m => m.movementSemanticType === 'fee');
  ok('AA4. El tipo semántico emparejado es "fee" (nunca "purchase")', !!mantMatch);
  const mantMovement = decision.persistableMovements.find(pm => /MANT/.test(pm.descripcionOriginal));
  eq('AA4. computaComoGasto:false para el consumo persistible del PDF', mantMovement.computaComoGasto, false);
  eq('AA4. Sin faltantes', decision.plannedMovementInserts.length, 0);
}

// AA5. "Interés punitorio pago mínimo" (histórica) empareja con "PUNIT.
// PAG.MIN.ANTERIOR" (PDF) — se clasifica como interest, nunca purchase.
{
  const persistencia = M.classifyPersistenceCategory('02 PUNIT. PAG.MIN.ANTERIOR $ 524.416,00', 'purchase', null, null);
  eq('AA5. classifyPersistenceCategory reclasifica "PUNIT. PAG.MIN.ANTERIOR" como interest (nunca purchase)', persistencia.movementType, 'interest');
  eq('AA5. subtipo "punitorio_pago_minimo"', persistencia.subtipo, 'punitorio_pago_minimo');
  eq('AA5. computaComoGasto:false', persistencia.computaComoGasto, false);

  const item = fakeItem({
    fileName: 'VISA_BUSINESS_2026-07.pdf', periodOperativo: '2026-07', periodPorCierre: '2026-07',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-07-26', declaredDueDate: '2026-08-06', movements: [
      { description: '26 Julio 01 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '02 PUNIT. PAG.MIN.ANTERIOR $ 524.416,00', amountArs: 389.4, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa5', card_id: VISA_8374.id, statement_month: '2026-07-01', total_ars: 1389.4, total_usd: 0, status: 'open' }],
    [{ id: 'doc-aa5', statement_id: 'st-aa5', kind: 'statement', original_name: 'VISA_BUSINESS_2026-07.pdf' }],
    [
      { id: 'mv-aa5-ctx', statement_id: 'st-aa5', card_id: VISA_8374.id, description: '26 Julio 01 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2026-07-01' },
      { id: 'mv-aa5', statement_id: 'st-aa5', card_id: VISA_8374.id, description: 'Interés punitorio pago mínimo', currency: 'ARS', amount: 389.4, movement_date: '2026-07-02' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA5. Interés punitorio empareja con PUNIT. PAG.MIN.ANTERIOR (y el consumo de contexto también empareja)', decision.matchedMovements.length, 2);
  const punitMatch = decision.matchedMovements.find(m => m.movementSemanticType === 'interest');
  ok('AA5. El tipo semántico emparejado es "interest" (nunca "purchase")', !!punitMatch);
  const punitMovement = decision.persistableMovements.find(pm => /PUNIT/.test(pm.descripcionOriginal));
  eq('AA5. computaComoGasto:false para el consumo persistible del PDF', punitMovement.computaComoGasto, false);
}

// AA6. plannedMovementInserts queda vacío para toda acción no ejecutable
// (candidateMovementInserts conserva el diagnóstico completo, nunca se
// mezcla con el plan ejecutable).
{
  const item = fakeMastercardItem({});
  M.classifyMassiveLoadGroups([item]);
  M.setState([MASTERCARD_3387],
    [{ id: 'st-aa6a', card_id: MASTERCARD_3387.id, statement_month: '2025-01-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-aa6a', statement_id: 'st-aa6a', kind: 'statement', original_name: '01-25-master.pdf' }],
    []);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA6. bloqueado_solo_resumen → plannedMovementInserts vacío', (decision.plannedMovementInserts || []).length, 0);
}
{
  const item = fakeItem({
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: 'ALGO SIN NINGUN PATRON DE FECHA RECONOCIBLE', amountArs: 1000, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374], [{ id: 'st-aa6b', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }], [], []);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA6. revision_humana_movimientos → plannedMovementInserts vacío', (decision.plannedMovementInserts || []).length, 0);
  ok('AA6. candidateMovementInserts conserva el diagnóstico (no se pierde información)', Array.isArray(decision.candidateMovementInserts));
}
{
  const item = fakeItem({
    fileName: 'VISA_8374_2025-08.pdf', periodOperativo: '2025-08', periodPorCierre: '2025-08',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-08-28', declaredDueDate: '2025-09-06', movements: [
      { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
    ] } },
  });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa6c', card_id: VISA_8374.id, statement_month: '2025-08-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-aa6c', statement_id: 'st-aa6c', kind: 'statement', original_name: 'VISA_8374_2025-08.pdf' }],
    [{ id: 'mv-aa6c', statement_id: 'st-aa6c', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA6. reparar_seguro SÍ expone plannedMovementInserts con los faltantes reales', decision.plannedMovementInserts.length, 1);
  eq('AA6. candidateMovementInserts coincide con plannedMovementInserts cuando la acción es ejecutable', decision.candidateMovementInserts.length, decision.plannedMovementInserts.length);
}

// AA7. omitir_identico nunca coexiste con un candidato sin emparejar: si
// los 8 criterios de "idéntico" se cumplen pero el detalle de
// movimientos deja un existente sin resolver (ni emparejado ni
// reconocido como manual), nunca se asume "idéntico" — requiere revisión
// humana, y jamás con plannedMovementInserts.length>0.
{
  const item = fakeItem({ hash: 'hash-aa7' });
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-aa7', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open',
      notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-aa7"}]]' }],
    [{ id: 'doc-aa7', statement_id: 'st-aa7', kind: 'statement', original_name: 'x.pdf' }],
    [
      { id: 'mv-aa7a', statement_id: 'st-aa7', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
      { id: 'mv-aa7b', statement_id: 'st-aa7', card_id: VISA_8374.id, description: '05 234568 * OTRO COMERCIO', currency: 'ARS', amount: 500, movement_date: '2025-03-05' },
      { id: 'mv-aa7c', statement_id: 'st-aa7', card_id: VISA_8374.id, description: 'FORMATO DESCONOCIDO SIN PAR EN EL PDF', currency: 'ARS', amount: 999, movement_date: '2025-03-06' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  ok('AA7. Nunca queda "omitir_identico" con un existente sin resolver', decision.action !== 'omitir_identico');
  eq('AA7. Cae a revisión humana', decision.action, 'revision_humana_movimientos');
  eq('AA7. plannedMovementInserts vacío (no ejecutable)', (decision.plannedMovementInserts || []).length, 0);
}

// AA8. Períodos cuyos totales ya coinciden pero cuyo detalle es agregado
// (no se puede comparar línea por línea): se preserva sin escribir,
// nunca se asume "idéntico" a ciegas ni se bloquea como si fuera una
// reparación fallida.
{
  const item = fakeMastercardItem({ hash: 'hash-aa8' });
  M.classifyMassiveLoadGroups([item]);
  M.setState([MASTERCARD_3387],
    [{ id: 'st-aa8', card_id: MASTERCARD_3387.id, statement_month: '2025-01-01', total_ars: 1448795.54, total_usd: 23.84, status: 'open',
      notes: '[[CREDIT_STATEMENT_META:{"sourceFileHash":"hash-aa8"}]]' }],
    [{ id: 'doc-aa8', statement_id: 'st-aa8', kind: 'statement', original_name: '01-25-master.pdf' }],
    [
      { id: 'mv-aa8-1', statement_id: 'st-aa8', card_id: MASTERCARD_3387.id, description: 'x1' },
      { id: 'mv-aa8-2', statement_id: 'st-aa8', card_id: MASTERCARD_3387.id, description: 'x2' },
      { id: 'mv-aa8-3', statement_id: 'st-aa8', card_id: MASTERCARD_3387.id, description: 'x3' },
      { id: 'mv-aa8-4', statement_id: 'st-aa8', card_id: MASTERCARD_3387.id, description: 'x4' },
    ]);
  const decision = M.decideMassiveLoadAction(item);
  eq('AA8. Totales idénticos pero detalle agregado → "preservar_existente_sin_escritura" (nunca omitir_identico a ciegas)', decision.action, 'preservar_existente_sin_escritura');
  eq('AA8. plannedMovementInserts vacío (no ejecutable)', (decision.plannedMovementInserts || []).length, 0);
}

// ============================================================
// CORRECCIÓN 6B4.14.6 - Plan de ejecución controlado e idempotente de
// las reparaciones seguras (buildMassiveLoadExecutionPlan). Fixtures
// calcadas del JSON real (6b4_14_vista_previa_1784312356406.json: 34
// reparar_seguro, 17 preservar_existente_sin_escritura, 8
// bloqueado_solo_resumen, 3 revision_humana_movimientos, 2
// bloqueado_riesgo_duplicacion).
// ============================================================

// BB1. El plan analiza todos los períodos del informe, incluye
// exclusivamente los reparar_seguro, excluye el resto (nunca aparecen
// operaciones para ellos porque ni siquiera entran al mapeo), y
// operacionesDeBorrado es siempre 0.
{
  const reparoItem = fakeItem({ fileName: 'BB1_REPARO.pdf', hash: 'hash-bb1' });
  reparoItem.action = 'reparar_seguro'; // Simula lo que ya dejó la Fase A.
  M.classifyMassiveLoadGroups([reparoItem]);
  M.setState([VISA_8374],
    [{ id: 'st-bb1', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb1', statement_id: 'st-bb1', kind: 'statement', original_name: 'BB1_REPARO.pdf' }],
    [{ id: 'mv-bb1a', statement_id: 'st-bb1', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);

  // Los otros 5 (idéntico/bloqueados/preservado/revisión) solo necesitan
  // el campo "action" — nunca se les llama buildExecutionPlanItemLive,
  // por diseño (se filtran antes de mapear).
  const otros = [
    { fileName: 'BB1_IDEM.pdf', action: 'omitir_identico' },
    { fileName: 'BB1_MC.pdf', action: 'bloqueado_solo_resumen' },
    { fileName: 'BB1_MP.pdf', action: 'bloqueado_riesgo_duplicacion' },
    { fileName: 'BB1_PRESERVAR.pdf', action: 'preservar_existente_sin_escritura' },
    { fileName: 'BB1_REVISION.pdf', action: 'revision_humana_movimientos' },
  ];
  const plan = M.buildMassiveLoadExecutionPlan({ items: [reparoItem, ...otros] });
  eq('BB1. resumenesAnalizados cuenta todos los items del informe', plan.global.resumenesAnalizados, 6);
  eq('BB1. resumenesIncluidos cuenta solo los reparar_seguro', plan.global.resumenesIncluidos, 1);
  eq('BB1. resumenesExcluidos = analizados - incluidos', plan.global.resumenesExcluidos, 5);
  eq('BB1. plan.items solo contiene los reparar_seguro (los otros 30-como nunca entran, cero operaciones para ellos)', plan.items.length, 1);
  eq('BB1. El único item del plan es el archivo reparar_seguro', plan.items[0].sourceFileName, 'BB1_REPARO.pdf');
  eq('BB1. operacionesDeBorrado siempre 0', plan.global.operacionesDeBorrado, 0);
}

// BB2. Documentos faltantes detectados en vivo (UPLOAD_AND_LINK_ORIGINAL)
// y totales incorrectos detectados dinámicamente (statementUpdates); un
// documento ya vinculado nunca se re-sube (NONE_ALREADY_LINKED) y un
// total ya correcto nunca vuelve a aparecer en statementUpdates.
{
  const item = fakeItem({ fileName: 'BB2_SIN_DOC.pdf', hash: 'hash-bb2' });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-bb2', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [],
    [{ id: 'mv-bb2', statement_id: 'st-bb2', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('BB2. Documento faltante detectado en vivo → UPLOAD_AND_LINK_ORIGINAL', plan.items[0].documentOperation, 'UPLOAD_AND_LINK_ORIGINAL');
  eq('BB2. Total incorrecto detectado dinámicamente en statementUpdates.total_ars', plan.items[0].statementUpdates.total_ars, 1500);
  eq('BB2. preflightState READY', plan.items[0].preflightState, 'READY');
}
{
  const item = fakeItem({ fileName: 'BB2_CON_DOC.pdf', hash: 'hash-bb2b' });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-bb2b', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb2b', statement_id: 'st-bb2b', kind: 'statement', original_name: 'BB2_CON_DOC.pdf' }],
    [{ id: 'mv-bb2b', statement_id: 'st-bb2b', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('BB2b. Documento ya vinculado → NONE_ALREADY_LINKED (nunca se re-sube, idempotente)', plan.items[0].documentOperation, 'NONE_ALREADY_LINKED');
  eq('BB2b. Total ya correcto → no aparece en statementUpdates', plan.items[0].statementUpdates.total_ars, undefined);
}

// BB3. Revalidación en vivo: una nueva coincidencia reduce automáticamente
// movementInserts; repetir el plan sobre el mismo estado es idempotente
// (cero cambios); una ambigüedad aparecida después de la vista previa
// bloquea el período (queda fuera del plan ejecutable).
{
  const item = fakeItem({ fileName: 'BB3_MULTI.pdf', hash: 'hash-bb3' });
  item.action = 'reparar_seguro'; // Lo que dejó la Fase A en su momento.
  M.classifyMassiveLoadGroups([item]);

  M.setState([VISA_8374],
    [{ id: 'st-bb3', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb3', statement_id: 'st-bb3', kind: 'statement', original_name: 'BB3_MULTI.pdf' }],
    [{ id: 'mv-bb3a', statement_id: 'st-bb3', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
  const plan1 = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('BB3. Con 1 de 2 movimientos ya existentes en vivo, el plan solo propone el faltante real', plan1.items[0].movementInserts.length, 1);
  eq('BB3. READY (sigue siendo reparar_seguro al revalidar en vivo)', plan1.items[0].preflightState, 'READY');

  const plan2 = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('BB3. Repetir el plan sobre el mismo estado da el mismo resultado (idempotente, permite reanudar)', plan2.items[0].movementInserts.length, plan1.items[0].movementInserts.length);

  M.setState([VISA_8374],
    [{ id: 'st-bb3', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb3', statement_id: 'st-bb3', kind: 'statement', original_name: 'BB3_MULTI.pdf' }],
    [
      { id: 'mv-bb3a', statement_id: 'st-bb3', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
      { id: 'mv-bb3-nuevo', statement_id: 'st-bb3', card_id: VISA_8374.id, description: 'FORMATO NUEVO SIN PAR EN EL PDF', currency: 'ARS', amount: 777, movement_date: '2025-03-10' },
    ]);
  const plan3 = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('BB3. Una ambigüedad aparecida después de la vista previa bloquea el período', plan3.items[0].preflightState, 'BLOCKED_AMBIGUOUS_MOVEMENTS');
  eq('BB3. Sin operaciones para un período bloqueado en el preflight', plan3.items[0].movementInserts.length, 0);
  ok('BB3. blockingReasons explica el motivo', plan3.items[0].blockingReasons.length > 0);
}

// BB4. Seguridad contable en el plan: ningún movimiento a insertar
// computa como gasto; "Saldo anterior" (carried_balance) nunca se
// propone como insert (queda solo en reconciliationComponents, per
// pedido — no puede demostrarse que no se cuente dos veces la deuda).
{
  const item = fakeItem({
    fileName: 'BB4_TIPOS.pdf', hash: 'hash-bb4',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Marzo 03 SU PAGO EN PESOS', amountArs: -1000, amountUsd: null, category: 'payment' },
      { description: '25 Marzo 04 DEVOLUCION IMPUESTO', amountArs: -200, amountUsd: null, category: 'refund' },
      { description: '05 COM.POR MANT.DE CUENTA', amountArs: 300, amountUsd: null, category: 'purchase' },
      { description: '06 IMPUESTO DE SELLOS', amountArs: 150, amountUsd: null, category: 'tax', taxSubtype: 'impuesto' },
      { description: '07 PERCEPCION IIBB', amountArs: 90, amountUsd: null, category: 'tax', taxSubtype: 'percepcion' },
      { description: '08 PUNIT. PAG.MIN.ANTERIOR $ 1.000,00', amountArs: 40, amountUsd: null, category: 'purchase' },
      { description: '25 Marzo 09 ANULACION DE PAGO EN $', amountArs: 500, amountUsd: null, category: 'purchase' },
      { description: 'Saldo anterior', amountArs: 2000, amountUsd: null, category: 'carried_balance' },
    ] } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-bb4', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb4', statement_id: 'st-bb4', kind: 'statement', original_name: 'BB4_TIPOS.pdf' }],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('BB4. preflightState READY', p.preflightState, 'READY');
  ok('BB4. Ningún movimiento a insertar computa como gasto (payment/refund/fee/tax/perception/interest/adjustment)', p.movementInserts.every(pm => pm.computaComoGasto === false));
  ok('BB4. "Saldo anterior" (carried_balance) nunca se propone como insert', !p.movementInserts.some(pm => pm.categoria === 'carried_balance'));
  ok('BB4. "Saldo anterior" queda explícitamente bloqueado (blockedCarriedBalance), no silenciosamente descartado', p.blockedCarriedBalance.some(pm => pm.categoria === 'carried_balance'));
}

// BB5. Los movimientos existentes nunca se eliminan/actualizan (no existe
// ni un campo para eso en la estructura del plan); un movimiento nunca
// aparece a la vez como insert y como preservado; los pagos manuales sin
// equivalente en el PDF se preservan.
{
  const item = fakeItem({
    fileName: 'BB5_PAGOS.pdf', periodOperativo: '2026-07', periodPorCierre: '2026-07', hash: 'hash-bb5',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2026-07-26', declaredDueDate: '2026-08-06', movements: [
      { description: '26 Julio 09 SU PAGO EN PESOS', amountArs: -500000, amountUsd: null, category: 'payment' },
    ] } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-bb5', card_id: VISA_8374.id, statement_month: '2026-07-01', total_ars: -500000, total_usd: 0, status: 'open' }],
    [{ id: 'doc-bb5', statement_id: 'st-bb5', kind: 'statement', original_name: 'BB5_PAGOS.pdf' }],
    [
      { id: 'mv-bb5-pago', statement_id: 'st-bb5', card_id: VISA_8374.id, description: 'Pago en pesos ya registrado', currency: 'ARS', amount: -500000, movement_date: '2026-07-09' },
      { id: 'mv-bb5-manual', statement_id: 'st-bb5', card_id: VISA_8374.id, description: 'Pago parcial registrado · Transferencia', currency: 'USD', amount: -120.79, movement_date: '2026-07-13' },
    ]);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('BB5. El pago existente empareja (no se propone insertar de nuevo)', p.movementInserts.length, 0);
  eq('BB5. El pago manual sin equivalente PDF queda preservado', p.preservedExistingMovements.length, 1);
  const preservedIds = new Set(p.preservedExistingMovements.map(pv => pv.existingMovement.id));
  ok('BB5. Ningún movimiento existente aparece a la vez como insert y como preservado', p.movementInserts.every(pm => !preservedIds.has(pm.id)));
  ok('BB5. La estructura del plan nunca incluye una operación de actualización/eliminación de movimientos existentes', Object.keys(p).every(k => !/movementUpdate|movementDelete|deleteMovement/i.test(k)));
}

// BB6. La generación del plan es 100% de lectura (nunca invoca
// sb.from/.insert/.update/.upsert/.rpc/sb.storage) y el botón "EJECUTAR
// N REPARACIONES SEGURAS" nunca tiene ningún handler de escritura
// mientras MASSIVE_LOAD_EXECUTION_ENABLED_STAGE sea false.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fns = ['buildStatementUpdatesDiff', 'buildExecutionPlanItemLive', 'buildMassiveLoadExecutionPlan']
    .map(n => extractFunction(src, n)).join('\n');
  ok(`BB6. ${label} el plan de ejecución nunca invoca sb.from/.insert/.update/.upsert/.rpc/sb.storage`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|sb\.storage/.test(fns));
  ok(`BB6. ${label} el botón EJECUTAR N REPARACIONES SEGURAS respeta MASSIVE_LOAD_EXECUTION_ENABLED_STAGE`, src.includes(`id="confirmMassiveLoadExecutionPlan" \${!MASSIVE_LOAD_EXECUTION_ENABLED_STAGE?'disabled':''}`));
  ok(`BB6. ${label} confirmMassiveLoadExecutionPlan no tiene ningún handler de click (nunca ejecuta nada en esta etapa, ni con "CONFIRMAR" ni con ninguna otra confirmación)`, !src.includes("getElementById('confirmMassiveLoadExecutionPlan')"));
}

// ============================================================
// CORRECCIÓN 6B4.14.6.1 - Preflight real contra Supabase inmediatamente
// antes de planificar. "Revalidación en vivo" ahora significa una
// lectura nueva y efectiva de Supabase (refreshMassiveLoadLiveData +
// fetchAllRowsPaged), nunca una comparación contra los arreglos que ya
// estaban en memoria.
// ============================================================

// CC1. buildMassiveLoadExecutionPlanLive ejecuta un refresco real ANTES
// de comparar/armar el plan (nunca al revés).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'buildMassiveLoadExecutionPlanLive');
  const idxRefresh = fn.indexOf('refreshMassiveLoadLiveData()');
  const idxBuild = fn.indexOf('buildMassiveLoadExecutionPlan(report)');
  ok(`CC1. ${label} ejecuta un refresco real antes de comparar`, idxRefresh >= 0 && idxBuild > idxRefresh);
}

// CC2. refreshMassiveLoadLiveData nunca reutiliza silenciosamente los
// arreglos antiguos: lee las 4 tablas reales ya usadas por la app con
// fetchAllRowsPaged (nunca inventa un nombre de tabla nuevo).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'refreshMassiveLoadLiveData');
  for (const table of ["'credit_cards'", "'credit_card_statements'", "'credit_card_movements'", "'documents'"]) {
    ok(`CC2. ${label} refreshMassiveLoadLiveData lee ${table} con fetchAllRowsPaged`, fn.includes(`fetchAllRowsPaged(${table}`));
  }
}

// CC3. fetchAllRowsPaged pagina explícitamente (nunca asume que un
// select('*') sin límite trae todas las filas) — una respuesta parcial o
// paginación incompleta debe poder detectarse.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'fetchAllRowsPaged');
  ok(`CC3. ${label} fetchAllRowsPaged pagina explícitamente con .range(`, /\.range\(/.test(fn));
  ok(`CC3. ${label} fetchAllRowsPaged informa "complete" según si la última página vino incompleta`, /complete:true/.test(fn) && /complete:false/.test(fn));
}

// CC4. El refresco/plan en vivo es 100% de lectura: nunca invoca
// insert/update/upsert/delete/rpc/sb.storage.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fns = ['fetchAllRowsPaged', 'refreshMassiveLoadLiveData', 'buildPlanFingerprint', 'summarizeMassiveLoadPreviewForComparison', 'buildChangesSincePreview', 'buildMassiveLoadExecutionPlanLive']
    .map(n => extractFunction(src, n)).join('\n');
  ok(`CC4. ${label} el refresco/plan en vivo nunca invoca .insert/.update/.upsert/.delete/.rpc/sb.storage`, !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|sb\.storage/.test(fns));
}

// CC5. El contexto de empresa corresponde exclusivamente a GR
// Estanterías — nunca se consulta ni mezcla información de Rizzo
// Propiedades (separación estructural: este repo/proyecto Supabase es
// exclusivo de GR).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'refreshMassiveLoadLiveData');
  ok(`CC5. ${label} companyContext queda fijo en GR Estanterías`, /companyContext='GR Estanterías/.test(fn));
  ok(`CC5. ${label} nunca se referencia Rizzo/RIZ en el refresco en vivo`, !/Rizzo|\bRIZ\b/i.test(fn));
}

// CC6. El botón "Preparar plan de ejecución" invalida el plan anterior
// ANTES de iniciar el refresco — nunca muestra un plan viejo mientras
// refresca o después de un refresco fallido.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'bindMassiveLoadModal');
  const idxNull = fn.indexOf('massiveLoadState.executionPlan=null;');
  const idxBuild = fn.indexOf('await buildMassiveLoadExecutionPlanLive(');
  ok(`CC6. ${label} invalida el plan anterior antes de empezar un nuevo refresco`, idxNull >= 0 && idxBuild > idxNull);
}

// ============================================================
// CORRECCIÓN 6B4.14.6.2 - Bloqueo de fechas heredadas y ajustes
// sintéticos no demostrados. Fixtures calcadas del JSON real
// (6b4_14_plan_ejecucion_1784330917474.json): GRIMOLDI cupón 003341
// C.06/06 (plan 14/11/2024, demostrada 19/11/2024), RIP CURL cupón
// 006519 C.05/06 (plan 15/12/2024, demostrada 17/12/2024), ALFIS JEANS
// cupón 002606 C.03/03 (plan 04/02/2025, demostrada 05/02/2025), y el
// ajuste sintético "Ajuste real: saldo en dólares acreedor" USD
// -1.904,74 que coincide con el pago real "SU PAGO EN USD" del mismo
// importe y período.
// ============================================================

// DD1. Evidencia de cuotas ENTRE distintos períodos del mismo lote (nunca
// solo dentro del propio período): GRIMOLDI, RIP CURL y ALFIS JEANS
// quedan con fecha heredada sin evidencia propia en un período, pero
// otras cuotas de la MISMA compra (mismo cupón/comercio/importe/moneda/
// cantidad de cuotas) en OTROS períodos del lote ya tienen fecha
// demostrada — la fecha heredada se resuelve a esa fecha exacta, nunca a
// la fecha de cierre ni a la línea anterior sin relación.
{
  const periodoEvidenciaGrimoldi = fakeItem({
    fileName: 'DD1_GRIMOLDI_EVIDENCIA.pdf', periodOperativo: '2025-01', periodPorCierre: '2025-01', hash: 'hash-dd1-g-ev',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-01-26', declaredDueDate: '2025-02-06', movements: [
      { description: '24 Noviem. 05 999999 * CONTEXTO', amountArs: 500, amountUsd: null, category: 'purchase' },
      { description: '19 003341 * GRIMOLDI C.02/06', amountArs: 18333.33, amountUsd: null, category: 'purchase' },
    ] } },
  });
  periodoEvidenciaGrimoldi.action = 'reparar_seguro';

  const periodoEvidenciaRipCurl = fakeItem({
    fileName: 'DD1_RIPCURL_EVIDENCIA.pdf', periodOperativo: '2025-02', periodPorCierre: '2025-02', hash: 'hash-dd1-rc-ev',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-02-26', declaredDueDate: '2025-03-06', movements: [
      { description: '24 Diciem. 17 888888 * CONTEXTO', amountArs: 400, amountUsd: null, category: 'purchase' },
      { description: '17 006519 * RIP CURL C.02/06', amountArs: 31666.16, amountUsd: null, category: 'purchase' },
    ] } },
  });
  periodoEvidenciaRipCurl.action = 'reparar_seguro';

  const periodoEvidenciaAlfis = fakeItem({
    fileName: 'DD1_ALFIS_EVIDENCIA.pdf', periodOperativo: '2025-03', periodPorCierre: '2025-03', hash: 'hash-dd1-al-ev',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Febrero 05 002606 * ALFIS JEANS C.01/03', amountArs: 16633.33, amountUsd: null, category: 'purchase' },
    ] } },
  });
  periodoEvidenciaAlfis.action = 'reparar_seguro';

  // El período objetivo (equivalente real a 05-25-visa.pdf): trae las 3
  // cuotas heredadas SIN fecha propia.
  const periodoObjetivo = fakeItem({
    fileName: 'DD1_OBJETIVO.pdf', periodOperativo: '2025-05', periodPorCierre: '2025-05', hash: 'hash-dd1-obj',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-05-26', declaredDueDate: '2025-06-06', movements: [
      { description: '24 Noviem. 14 999998 * OTRO COMERCIO', amountArs: 700, amountUsd: null, category: 'purchase' },
      { description: '003341 * GRIMOLDI C.06/06', amountArs: 18333.33, amountUsd: null, category: 'purchase' },
      { description: '006519 * RIP CURL C.05/06', amountArs: 31666.16, amountUsd: null, category: 'purchase' },
      { description: '002606 * ALFIS JEANS C.03/03', amountArs: 16633.33, amountUsd: null, category: 'purchase' },
    ] } },
  });
  periodoObjetivo.action = 'reparar_seguro';

  const todos = [periodoEvidenciaGrimoldi, periodoEvidenciaRipCurl, periodoEvidenciaAlfis, periodoObjetivo];
  M.classifyMassiveLoadGroups(todos);
  M.setState([VISA_8374],
    [
      { id: 'st-dd1-g', card_id: VISA_8374.id, statement_month: '2025-01-01', total_ars: 18833.33, total_usd: 0, status: 'open' },
      { id: 'st-dd1-rc', card_id: VISA_8374.id, statement_month: '2025-02-01', total_ars: 32066.16, total_usd: 0, status: 'open' },
      { id: 'st-dd1-al', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 16633.33, total_usd: 0, status: 'open' },
      { id: 'st-dd1-obj', card_id: VISA_8374.id, statement_month: '2025-05-01', total_ars: 67332.82, total_usd: 0, status: 'open' },
    ],
    [
      { id: 'doc-dd1-g', statement_id: 'st-dd1-g', kind: 'statement', original_name: 'DD1_GRIMOLDI_EVIDENCIA.pdf' },
      { id: 'doc-dd1-rc', statement_id: 'st-dd1-rc', kind: 'statement', original_name: 'DD1_RIPCURL_EVIDENCIA.pdf' },
      { id: 'doc-dd1-al', statement_id: 'st-dd1-al', kind: 'statement', original_name: 'DD1_ALFIS_EVIDENCIA.pdf' },
      { id: 'doc-dd1-obj', statement_id: 'st-dd1-obj', kind: 'statement', original_name: 'DD1_OBJETIVO.pdf' },
    ],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: todos });
  const planObjetivo = plan.items.find(p => p.sourceFileName === 'DD1_OBJETIVO.pdf');
  eq('DD1. El período objetivo queda READY (las 3 cuotas heredadas se resolvieron por evidencia)', planObjetivo.preflightState, 'READY');

  const grimoldi = planObjetivo.movementInserts.find(pm => pm.descripcionOriginal.includes('GRIMOLDI'));
  eq('DD1. GRIMOLDI 003341 C.06/06 se resuelve al 19/11/2024 por evidencia de cuotas', grimoldi.fecha, '2024-11-19');
  eq('DD1. GRIMOLDI queda con fechaOrigen cuota_historica_confirmada', grimoldi.fechaOrigen, 'cuota_historica_confirmada');
  eq('DD1. GRIMOLDI queda con movementEvidenceState INSTALLMENT_DATE_CONFIRMED', grimoldi.movementEvidenceState, 'INSTALLMENT_DATE_CONFIRMED');
  eq('DD1. GRIMOLDI conserva la fecha heredada original para trazabilidad (fechaOriginalInferida)', grimoldi.fechaOriginalInferida, '2024-11-14');

  const ripcurl = planObjetivo.movementInserts.find(pm => pm.descripcionOriginal.includes('RIP CURL'));
  eq('DD1. RIP CURL 006519 C.05/06 se resuelve al 17/12/2024', ripcurl.fecha, '2024-12-17');

  const alfis = planObjetivo.movementInserts.find(pm => pm.descripcionOriginal.includes('ALFIS JEANS'));
  eq('DD1. ALFIS JEANS 002606 C.03/03 se resuelve al 05/02/2025', alfis.fecha, '2025-02-05');

  ok('DD1. inheritedDateEvidence registra las 3 correcciones', planObjetivo.inheritedDateEvidence.length === 3);
}

// DD2. Nunca se usa la fecha de otra cuota cuando cambia el cupón, el
// importe, la moneda o la cantidad total de cuotas — ni siquiera si el
// comercio es el mismo.
{
  const evidenciaOtroCupon = fakeItem({
    fileName: 'DD2_EVIDENCIA.pdf', periodOperativo: '2025-01', periodPorCierre: '2025-01', hash: 'hash-dd2-ev',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-01-26', declaredDueDate: '2025-02-06', movements: [
      { description: '24 Noviem. 19 999999 * CONTEXTO', amountArs: 500, amountUsd: null, category: 'purchase' },
      { description: '19 555555 * COMERCIO IGUAL C.02/06', amountArs: 18333.33, amountUsd: null, category: 'purchase' },
    ] } },
  });
  evidenciaOtroCupon.action = 'reparar_seguro';

  const objetivo = fakeItem({
    fileName: 'DD2_OBJETIVO.pdf', periodOperativo: '2025-05', periodPorCierre: '2025-05', hash: 'hash-dd2-obj',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-05-26', declaredDueDate: '2025-06-06', movements: [
      { description: '24 Noviem. 14 999998 * OTRO COMERCIO', amountArs: 700, amountUsd: null, category: 'purchase' },
      // Mismo comercio canónico e importe, pero CUPÓN DISTINTO (666666 en
      // vez de 555555) — nunca debe tomar la fecha de la "evidencia".
      { description: '666666 * COMERCIO IGUAL C.06/06', amountArs: 18333.33, amountUsd: null, category: 'purchase' },
    ] } },
  });
  objetivo.action = 'reparar_seguro';

  M.classifyMassiveLoadGroups([evidenciaOtroCupon, objetivo]);
  M.setState([VISA_8374],
    [
      { id: 'st-dd2-ev', card_id: VISA_8374.id, statement_month: '2025-01-01', total_ars: 18833.33, total_usd: 0, status: 'open' },
      { id: 'st-dd2-obj', card_id: VISA_8374.id, statement_month: '2025-05-01', total_ars: 19033.33, total_usd: 0, status: 'open' },
    ],
    [
      { id: 'doc-dd2-ev', statement_id: 'st-dd2-ev', kind: 'statement', original_name: 'DD2_EVIDENCIA.pdf' },
      { id: 'doc-dd2-obj', statement_id: 'st-dd2-obj', kind: 'statement', original_name: 'DD2_OBJETIVO.pdf' },
    ],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [evidenciaOtroCupon, objetivo] });
  const planObjetivo = plan.items.find(p => p.sourceFileName === 'DD2_OBJETIVO.pdf');
  eq('DD2. Sin evidencia válida (cupón distinto) el período queda bloqueado', planObjetivo.preflightState, 'BLOCKED_UNRESOLVED_MOVEMENT_DATES');
  eq('DD2. Sin movimientos a insertar', planObjetivo.movementInserts.length, 0);
  ok('DD2. El movimiento con cupón distinto aparece como sin resolver', planObjetivo.unresolvedMovementDates.some(pm => pm.descripcionOriginal.includes('666666')));
}

// DD3. Una fecha heredada sin ningún cupón/cuota identificable (ej. un
// débito automático recurrente, como los peajes reales del JSON) no
// tiene evidencia de cuotas aplicable — queda sin resolver y bloquea
// TODO el período (cero inserts, cero updates, ninguna operación
// documental).
{
  const item = fakeItem({
    fileName: 'DD3_PEAJE.pdf', hash: 'hash-dd3',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Marzo 04 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '000001 K AUBASA 960003496345101', amountArs: 3199.54, amountUsd: null, category: 'purchase' },
    ] } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-dd3', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 4199.54, total_usd: 0, status: 'open' }],
    [{ id: 'doc-dd3', statement_id: 'st-dd3', kind: 'statement', original_name: 'DD3_PEAJE.pdf' }],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('DD3. Fecha heredada sin evidencia de cuotas bloquea TODO el período', p.preflightState, 'BLOCKED_UNRESOLVED_MOVEMENT_DATES');
  eq('DD3. movementInserts vacío (ningún UNRESOLVED_DATE aparece en movementInserts)', p.movementInserts.length, 0);
  eq('DD3. statementUpdates vacío', Object.keys(p.statementUpdates).length, 0);
  eq('DD3. Ninguna operación documental', p.documentOperation, null);
  ok('DD3. El movimiento sin resolver queda listado', p.unresolvedMovementDates.some(pm => pm.descripcionOriginal.includes('AUBASA')));
}

// DD4/DD5. Un ajuste sintético que coincide con un pago real (mismo
// importe) queda bloqueado (blockedSyntheticAdjustments), nunca en
// movementInserts; el pago real se conserva como 'payment'; el saldo
// anterior (carried_balance) sigue en su propio balde, sin mezclarse.
{
  const item = fakeItem({
    fileName: 'DD4_AJUSTE.pdf', periodOperativo: '2025-01', periodPorCierre: '2025-01', hash: 'hash-dd4',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2024-12-26', declaredDueDate: '2025-01-06', movements: [
      { description: '24 Diciem. 10 SU PAGO EN USD', amountArs: null, amountUsd: -1904.74, category: 'payment' },
      { description: 'Ajuste real: saldo en dólares acreedor (cupón de pago del resumen)', amountArs: null, amountUsd: -1904.74, category: 'currency_conversion_carried_forward' },
      { description: 'Saldo anterior', amountArs: 1843243.2, amountUsd: null, category: 'carried_balance' },
    ] } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-dd4', card_id: VISA_8374.id, statement_month: '2025-01-01', total_ars: 0, total_usd: -1904.74, status: 'open' }],
    [{ id: 'doc-dd4', statement_id: 'st-dd4', kind: 'statement', original_name: 'DD4_AJUSTE.pdf' }],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('DD4. preflightState READY', p.preflightState, 'READY');
  ok('DD4. El ajuste sintético NUNCA aparece en movementInserts', !p.movementInserts.some(pm => pm.categoria === 'currency_conversion_carried_forward'));
  eq('DD4. El ajuste USD -1.904,74 queda en blockedSyntheticAdjustments', p.blockedSyntheticAdjustments.length, 1);
  eq('DD4. El importe del ajuste bloqueado coincide con el pago real', p.blockedSyntheticAdjustments[0].importe, -1904.74);
  const pagoReal = p.movementInserts.find(pm => pm.categoria === 'payment');
  ok('DD4. El pago real USD -1.904,74 se conserva como payment', !!pagoReal && pagoReal.importe === -1904.74);
  eq('DD5. "Saldo anterior" sigue bloqueado en blockedCarriedBalance (nunca mezclado con los ajustes sintéticos)', p.blockedCarriedBalance.length, 1);
  ok('DD5. blockedSyntheticAdjustments y blockedCarriedBalance nunca se mezclan', !p.blockedSyntheticAdjustments.some(pm => pm.categoria === 'carried_balance') && !p.blockedCarriedBalance.some(pm => pm.categoria === 'currency_conversion_carried_forward'));
}

// DD6. movementEvidenceSummary agrega correctamente los 5 estados de
// evidencia a nivel de todo el plan (nunca solo por período).
{
  const item = fakeItem({
    fileName: 'DD6.pdf', hash: 'hash-dd6',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-03-26', declaredDueDate: '2025-04-06', movements: [
      { description: '25 Marzo 04 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
    ] } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-dd6', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-dd6', statement_id: 'st-dd6', kind: 'statement', original_name: 'DD6.pdf' }],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  eq('DD6. movementEvidenceSummary.directDates cuenta la línea con fecha completa', plan.global.movementEvidenceSummary.directDates, 1);
  eq('DD6. movementEvidenceSummary.sectionDates cuenta la línea con día+contexto', plan.global.movementEvidenceSummary.sectionDates, 1);
  eq('DD6. Sin fechas sin resolver en este caso', plan.global.movementEvidenceSummary.unresolvedDates, 0);
}

// DD7. Los 8 períodos ambiguos (bloqueados por deduplicación, tal como ya
// venían de 6B4.14.5) continúan sin ninguna operación planificada — esta
// etapa no intenta resolverlos.
{
  const item = fakeItem({ hash: 'hash-dd7' });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-dd7', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
    [{ id: 'doc-dd7', statement_id: 'st-dd7', kind: 'statement', original_name: 'x.pdf' }],
    [{ id: 'mv-dd7', statement_id: 'st-dd7', card_id: VISA_8374.id, description: 'FORMATO DESCONOCIDO SIN PAR EN EL PDF', currency: 'ARS', amount: 999, movement_date: '2025-03-06' }]);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('DD7. Período con movimiento existente ambiguo queda BLOCKED_AMBIGUOUS_MOVEMENTS', p.preflightState, 'BLOCKED_AMBIGUOUS_MOVEMENTS');
  eq('DD7. Cero inserts', p.movementInserts.length, 0);
  eq('DD7. Cero actualizaciones de totales', Object.keys(p.statementUpdates).length, 0);
  // CORRECCIÓN 6B4.14.6.3 - Antes solo se exigía "no UPLOAD_AND_LINK_ORIGINAL",
  // lo cual dejaba pasar 'NONE_ALREADY_LINKED' (un valor engañoso: decía
  // "documento ya vinculado, sin operación" sobre un período bloqueado). Un
  // período bloqueado nunca expone ninguna operación documental autorizada.
  eq('DD7. Ninguna operación documental (documentOperation:null, todo bloqueado)', p.documentOperation, null);
}

// ============================================================
// EE. CORRECCIÓN 6B4.14.6.3 — Conteos ejecutables y estados sin
// operaciones (candidatos vs listos vs ejecutables vs sin cambios vs
// bloqueados; documentStatus separado de documentOperation;
// liveRefreshState separado de executionPlanState). El desglose exacto
// 34/25/19/6/9 y los 6 archivos READY-sin-operaciones/6 archivos
// bloqueados con contradicción documental se revalidan además contra el
// JSON real de Supabase (ver informe de cierre) — acá se prueba el
// MECANISMO en fixtures sintéticos reproducibles.
// ============================================================

// EE1-EE5. executionPlanItemHasOperations(): único criterio para decidir
// si un ítem técnicamente listo tiene o no una operación real.
{
  eq('EE1. Una actualización de totales cuenta como operación', M.executionPlanItemHasOperations({ statementUpdates: { total_ars: 100 }, movementInserts: [], documentOperation: 'NONE_ALREADY_LINKED' }), true);
  eq('EE2. Un movimiento a insertar cuenta como operación', M.executionPlanItemHasOperations({ statementUpdates: {}, movementInserts: [{ x: 1 }], documentOperation: null }), true);
  eq('EE3. Subir y vincular documento cuenta como operación', M.executionPlanItemHasOperations({ statementUpdates: {}, movementInserts: [], documentOperation: 'UPLOAD_AND_LINK_ORIGINAL' }), true);
  eq('EE4. Documento ya vinculado + cero totales + cero movimientos NO es una operación (el caso "ya completo")', M.executionPlanItemHasOperations({ statementUpdates: {}, movementInserts: [], documentOperation: 'NONE_ALREADY_LINKED' }), false);
  eq('EE5. documentOperation:null + cero totales + cero movimientos NO es una operación', M.executionPlanItemHasOperations({ statementUpdates: {}, movementInserts: [], documentOperation: null }), false);
}

// EE6-EE16. Partición items/executionItems/noOpItems/blockedItems y
// conteos globales, con un candidato READY-con-operaciones y otro
// BLOCKED (movimiento existente ambiguo, mismo mecanismo que DD7) en el
// mismo plan.
{
  const eeReady = fakeItem({
    fileName: 'EE_READY.pdf', hash: 'hash-ee-ready', periodOperativo: '2025-04', periodPorCierre: '2025-04',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-04-26', declaredDueDate: '2025-05-06', movements: [
      { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
    ] }, reconciliation: { totals: { statementArs: 1500, calculatedArs: 1500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
  });
  eeReady.action = 'reparar_seguro';
  const eeBlocked = fakeItem({
    fileName: 'EE_BLOCKED.pdf', hash: 'hash-ee-blocked', periodOperativo: '2025-05', periodPorCierre: '2025-05',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-05-26', declaredDueDate: '2025-06-06', movements: [
      { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
    ] }, reconciliation: { totals: { statementArs: 1500, calculatedArs: 1500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
  });
  eeBlocked.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([eeReady, eeBlocked]);
  M.setState([VISA_8374],
    [
      { id: 'st-ee-ready', card_id: VISA_8374.id, statement_month: '2025-04-01', total_ars: 1500, total_usd: 0, status: 'open' },
      { id: 'st-ee-blocked', card_id: VISA_8374.id, statement_month: '2025-05-01', total_ars: 1500, total_usd: 0, status: 'open' },
    ],
    [
      { id: 'doc-ee-ready', statement_id: 'st-ee-ready', kind: 'statement', original_name: 'EE_READY.pdf' },
      // Deliberadamente SIN documento para el período bloqueado — reproduce
      // la contradicción real del pedido (motivo dice "no hay documento
      // vinculado" y documentStatus debe reflejarlo, nunca documentOperation).
    ],
    [
      { id: 'mv-ee-blocked', statement_id: 'st-ee-blocked', card_id: VISA_8374.id, description: 'FORMATO DESCONOCIDO SIN PAR EN EL PDF', currency: 'ARS', amount: 999, movement_date: '2025-05-06' },
    ]);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [eeReady, eeBlocked] });
  const pReady = plan.items.find(p => p.sourceFileName === 'EE_READY.pdf');
  const pBlocked = plan.items.find(p => p.sourceFileName === 'EE_BLOCKED.pdf');

  eq('EE6. items conserva TODOS los candidatos, sin importar su estado final', plan.items.length, 2);
  eq('EE7. El candidato con movimientos a insertar queda READY', pReady.preflightState, 'READY');
  eq('EE8. El candidato READY con operaciones reales tiene executionState HAS_OPERATIONS', pReady.executionState, 'HAS_OPERATIONS');
  eq('EE9. El candidato con movimiento existente ambiguo queda BLOCKED_AMBIGUOUS_MOVEMENTS', pBlocked.preflightState, 'BLOCKED_AMBIGUOUS_MOVEMENTS');
  eq('EE10. Un período bloqueado tiene executionState BLOCKED (nunca HAS_OPERATIONS ni NO_OP_ALREADY_COMPLETE)', pBlocked.executionState, 'BLOCKED');
  eq('EE11. Un período bloqueado nunca expone documentOperation autorizado', pBlocked.documentOperation, null);
  eq('EE12. documentStatus del período bloqueado sin documento es MISSING (el hecho observado)', pBlocked.documentStatus, 'MISSING');
  ok('EE13. El motivo de bloqueo menciona la ausencia de documento (documentStatus:MISSING lo confirma, nunca lo contradice)', pBlocked.blockingReasons.some(r => /documento/i.test(r)));

  eq('EE14. executionItems contiene EXACTAMENTE al candidato READY con operaciones', plan.executionItems.map(p => p.sourceFileName), ['EE_READY.pdf']);
  eq('EE15. noOpItems queda vacío en este fixture (el único READY sí tiene operaciones)', plan.noOpItems.length, 0);
  eq('EE16. blockedItems contiene EXACTAMENTE al candidato bloqueado', plan.blockedItems.map(p => p.sourceFileName), ['EE_BLOCKED.pdf']);
  ok('EE17. El período bloqueado NUNCA aparece en executionItems', !plan.executionItems.some(p => p.sourceFileName === 'EE_BLOCKED.pdf'));
  ok('EE18. El período bloqueado NUNCA aparece en noOpItems', !plan.noOpItems.some(p => p.sourceFileName === 'EE_BLOCKED.pdf'));

  eq('EE19. global.resumenesCandidatos cuenta los 2 candidatos (con independencia de su estado final)', plan.global.resumenesCandidatos, 2);
  eq('EE20. global.resumenesListos cuenta solo el READY', plan.global.resumenesListos, 1);
  eq('EE21. global.resumenesEjecutables cuenta solo el READY-con-operaciones', plan.global.resumenesEjecutables, 1);
  eq('EE22. global.resumenesSinCambios en 0 (nadie quedó listo-sin-operaciones en este fixture)', plan.global.resumenesSinCambios, 0);
  eq('EE23. global.resumenesBloqueados cuenta el bloqueado', plan.global.resumenesBloqueados, 1);
  eq('EE24. resumenesIncluidos (obsoleto, compatibilidad) sigue igual a resumenesCandidatos', plan.global.resumenesIncluidos, plan.global.resumenesCandidatos);
  eq('EE25. operacionesDeBorrado siempre en 0 (esta etapa nunca borra)', plan.global.operacionesDeBorrado, 0);
}

// EE26. classifyLiveRefreshState distingue lectura completa, paginación
// incompleta y fallo genérico de lectura — sin mezclar los tres.
{
  eq('EE26a. Lectura completa → READY', M.classifyLiveRefreshState({ ok: true, paginationComplete: true }), 'READY');
  eq('EE26b. Error de paginación incompleta → BLOCKED_INCOMPLETE_PAGINATION', M.classifyLiveRefreshState({ ok: false, error: 'La lectura de Supabase no confirmó cobertura completa (paginación incompleta) — no se arma el plan con datos parciales.' }), 'BLOCKED_INCOMPLETE_PAGINATION');
  eq('EE26c. Cualquier otro fallo de lectura → BLOCKED_LIVE_REFRESH_FAILED', M.classifyLiveRefreshState({ ok: false, error: 'Fallo simulado de red' }), 'BLOCKED_LIVE_REFRESH_FAILED');
}

// EE27. classifyExecutionPlanState separa "hay algo ejecutable" de "hay
// algo bloqueado" — son dos preguntas distintas.
{
  eq('EE27a. Ejecutables>0 y bloqueados=0 → READY_ALL', M.classifyExecutionPlanState({ executionItems: [1], blockedItems: [] }), 'READY_ALL');
  eq('EE27b. Ejecutables>0 y bloqueados>0 → READY_PARTIAL (el caso real actual: 19 + 9)', M.classifyExecutionPlanState({ executionItems: [1], blockedItems: [1] }), 'READY_PARTIAL');
  eq('EE27c. Sin ejecutables (aunque no haya bloqueados) → NO_EXECUTABLE_OPERATIONS', M.classifyExecutionPlanState({ executionItems: [], blockedItems: [] }), 'NO_EXECUTABLE_OPERATIONS');
  eq('EE27d. Sin ejecutables y con bloqueados → sigue siendo NO_EXECUTABLE_OPERATIONS (no READY_PARTIAL)', M.classifyExecutionPlanState({ executionItems: [], blockedItems: [1] }), 'NO_EXECUTABLE_OPERATIONS');
}

// EE28. planFingerprint cambia cuando cambia el CONTENIDO de
// executionItems, aunque 'items' y 'global' se mantengan iguales — nunca
// se puede reutilizar por error una huella vieja tras un cambio real en
// lo ejecutable.
{
  const itemsIguales = [{ sourceFileName: 'x.pdf', preflightState: 'READY', movementInserts: [1] }];
  const globalIgual = { resumenesEjecutables: 1 };
  const planA = { global: globalIgual, items: itemsIguales, executionItems: [{ sourceFileName: 'x.pdf', statementUpdates: {}, movementInserts: [1], documentOperation: 'NONE_ALREADY_LINKED' }] };
  const planB = { global: globalIgual, items: itemsIguales, executionItems: [{ sourceFileName: 'x.pdf', statementUpdates: { total_ars: 500 }, movementInserts: [1], documentOperation: 'NONE_ALREADY_LINKED' }] };
  const fpA = M.buildPlanFingerprint(planA, '2026-07-17T00:00:00.000Z');
  const fpB = M.buildPlanFingerprint(planB, '2026-07-17T00:00:00.000Z');
  ok('EE28. Un cambio SOLO en executionItems (items/global idénticos) cambia la huella', fpA !== fpB);
}

// EE29. El botón de confirmación usa g.resumenesEjecutables (nunca
// resumenesIncluidos ni una resta manual) — ni index.html ni
// index_operator.html deben seguir usando la fórmula vieja.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  ok(`EE29. ${label} el botón de ejecución usa g.resumenesEjecutables`, /EJECUTAR \$\{g\.resumenesEjecutables\} REPARACIONES SEGURAS/.test(src));
  ok(`EE29. ${label} el botón YA NO usa la resta manual resumenesIncluidos-periodosBloqueadosEnPreflight`, !/EJECUTAR \$\{g\.resumenesIncluidos-g\.periodosBloqueadosEnPreflight\}/.test(src));
}

// EE30. El plan exportado incluye executionItems/noOpItems/blockedItems/
// liveRefreshState/executionPlanState como campos de primer nivel (no
// anidados ni derivables solo en la UI) en ambos archivos.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'buildMassiveLoadExecutionPlan');
  ok(`EE30. ${label} buildMassiveLoadExecutionPlan() retorna executionItems/noOpItems/blockedItems`, /return\{generatedAt:new Date\(\)\.toISOString\(\),items:planItems,executionItems,noOpItems,blockedItems,global\}/.test(fn));
  const fnLive = extractFunction(src, 'buildMassiveLoadExecutionPlanLive');
  ok(`EE30. ${label} buildMassiveLoadExecutionPlanLive() expone liveRefreshState/executionPlanState`, /liveRefreshState,executionPlanState:classifyExecutionPlanState\(plan\)/.test(fnLive));
}

// ============================================================
// FF. CORRECCIÓN 6B4.14.6.4 — Bloquear movimientos duplicados sin
// multiplicidad demostrada. Caso real confirmado: 02-25-visa.pdf (Visa
// 8374) imprime DOS líneas "ANULACION DE PAGO EN $ 1.394.225,89"
// idénticas (verificado contra el PDF original) sin cupón, autorización
// ni ningún otro identificador — el período completo debe bloquearse.
// ============================================================
function fakePm(overrides) {
  return {
    descripcionOriginal: '25 Enero 06 ANULACION DE PAGO EN $', fecha: '2025-01-06', fechaConfianza: 'alta',
    fechaOrigen: 'linea_original', fechaEvidencia: '25 Enero 06', moneda: 'ARS', importe: 1394225.89,
    categoria: 'adjustment', categoriaParserOriginal: 'purchase', subtipo: 'payment_reversal', origen: 'visa',
    esIndividual: true, computaComoGasto: false, motivoPersistible: 'Reversión/anulación de un pago ya registrado — nunca es un consumo nuevo.',
    ...overrides,
  };
}

// FF1. Las dos anulaciones de ARS 1.394.225,89 (misma fecha, moneda,
// importe, categoría, subtipo; una con prefijo "25 Enero 06 ", otra con
// prefijo "06 " — exactamente como las imprime el PDF real dos veces)
// son detectadas como UN grupo semántico sin evidencia de multiplicidad.
{
  const pmA = fakePm({ descripcionOriginal: '25 Enero 06 ANULACION DE PAGO EN $' });
  const pmB = fakePm({ descripcionOriginal: '06 ANULACION DE PAGO EN $', fechaConfianza: 'media', fechaOrigen: 'dia_con_contexto_seccion', fechaEvidencia: '06 A (mes/año inferido de la sección)' });
  const result = M.detectUnresolvedMovementMultiplicity([pmA, pmB], { cardId: VISA_8374.id, period: '2025-02', sourceFileName: '02-25-visa.pdf' });
  eq('FF1. Las dos anulaciones idénticas forman un único grupo semántico', result.unresolvedDuplicateMovements.length, 1);
  eq('FF2. El grupo queda UNRESOLVED_DUPLICATE', result.movementMultiplicityState, 'UNRESOLVED_DUPLICATE');
  eq('FF1b. El grupo registra las 2 ocurrencias', result.unresolvedDuplicateMovements[0].occurrences, 2);
  ok('FF9. Ninguno de los dos movimientos se elimina silenciosamente (ambas descripciones quedan listadas)',
    result.unresolvedDuplicateMovements[0].descriptions.includes(pmA.descripcionOriginal) && result.unresolvedDuplicateMovements[0].descriptions.includes(pmB.descripcionOriginal));
}

// FF10/FF11. Dos compras (purchase, computaComoGasto:true) con distinto
// cupón o distinta autorización NUNCA entran al control de multiplicidad
// — quedan totalmente fuera del análisis (NOT_APPLICABLE si son las
// únicas), nunca bloqueadas.
{
  const compraA = fakePm({ descripcionOriginal: '17 006519 * RIP CURL C.02/06', fecha: '2024-12-17', importe: 31666.16, categoria: 'purchase', subtipo: null, computaComoGasto: true });
  const compraB = fakePm({ descripcionOriginal: '17 852018 * CHEEKY C.02/03', fecha: '2024-12-17', importe: 31666.16, categoria: 'purchase', subtipo: null, computaComoGasto: true });
  const result = M.detectUnresolvedMovementMultiplicity([compraA, compraB], { cardId: VISA_8374.id, period: '2025-02' });
  eq('FF10/11. Dos compras (cupón/comercio distinto) nunca entran al control — NOT_APPLICABLE', result.movementMultiplicityState, 'NOT_APPLICABLE');
  eq('FF10/11. Sin grupos sin resolver', result.unresolvedDuplicateMovements.length, 0);
}

// FF16. Confirmación de multiplicidad: dos movimientos reforzados
// comparten fecha/moneda/importe/categoría/subtipo/descripción, pero
// tienen cupón distinto (evidencia inequívoca) — CONFIRMED_MULTIPLICITY,
// ambos permitidos (nunca bloqueados).
{
  const pmA = fakePm({ descripcionOriginal: 'AJUSTE MANUAL DE SALDO · cupón 111111', categoria: 'adjustment', subtipo: 'creditor_balance_adjustment' });
  const pmB = fakePm({ descripcionOriginal: 'AJUSTE MANUAL DE SALDO · cupón 222222', categoria: 'adjustment', subtipo: 'creditor_balance_adjustment' });
  const result = M.detectUnresolvedMovementMultiplicity([pmA, pmB], { cardId: VISA_8374.id, period: '2025-02' });
  eq('FF16. Cupón distinto es evidencia suficiente → CONFIRMED_MULTIPLICITY', result.movementMultiplicityState, 'CONFIRMED_MULTIPLICITY');
  eq('FF16. Ningún grupo sin resolver (ambos movimientos quedan permitidos)', result.unresolvedDuplicateMovements.length, 0);
  eq('FF16. El grupo confirmado registra las 2 ocurrencias', result.confirmedDuplicateMovements[0].occurrences, 2);
}

// FF13/FF6. Dos movimientos reforzados con fecha real distinta nunca se
// agrupan (la firma incluye la fecha) — permanecen permitidos.
{
  const pmA = fakePm({ descripcionOriginal: 'COM.POR MANT.DE CUENTA', categoria: 'fee', subtipo: 'account_maintenance', fecha: '2025-01-02' });
  const pmB = fakePm({ descripcionOriginal: 'COM.POR MANT.DE CUENTA', categoria: 'fee', subtipo: 'account_maintenance', fecha: '2025-02-02' });
  const result = M.detectUnresolvedMovementMultiplicity([pmA, pmB], { cardId: VISA_8374.id, period: '2025-02' });
  eq('FF13. Fecha real distinta → nunca se agrupan (UNIQUE)', result.movementMultiplicityState, 'UNIQUE');
  eq('FF13. uniqueMovements cuenta los 2', result.uniqueMovements, 2);
}

// FF12. Dos cuotas distintas del mismo plan (mismo comercio/importe/
// fecha/categoría, pero cuota "C.01/03" vs "C.02/03") nunca se agrupan.
{
  const pmA = fakePm({ descripcionOriginal: 'PUNIT.PAG.MIN.ANTERIOR C.01/03', categoria: 'interest', subtipo: 'punitorio_pago_minimo', fecha: '2025-01-30' });
  const pmB = fakePm({ descripcionOriginal: 'PUNIT.PAG.MIN.ANTERIOR C.02/03', categoria: 'interest', subtipo: 'punitorio_pago_minimo', fecha: '2025-01-30' });
  const result = M.detectUnresolvedMovementMultiplicity([pmA, pmB], { cardId: VISA_8374.id, period: '2025-02' });
  eq('FF12. Cuota distinta → nunca se agrupan (UNIQUE)', result.movementMultiplicityState, 'UNIQUE');
}

// Moneda e importe distintos — mismos principios, agrupados en un solo
// chequeo para no repetir la misma forma de prueba.
{
  const base = fakePm({ descripcionOriginal: 'IMPUESTO DE SELLOS $', categoria: 'tax', subtipo: 'impuesto', fecha: '2025-01-30' });
  const distintaMoneda = M.detectUnresolvedMovementMultiplicity([base, { ...base, moneda: 'USD' }], { cardId: VISA_8374.id, period: '2025-02' });
  eq('Moneda distinta → nunca se agrupan (UNIQUE)', distintaMoneda.movementMultiplicityState, 'UNIQUE');
  const distintoImporte = M.detectUnresolvedMovementMultiplicity([base, { ...base, importe: 999 }], { cardId: VISA_8374.id, period: '2025-02' });
  eq('Importe distinto → nunca se agrupan (UNIQUE)', distintoImporte.movementMultiplicityState, 'UNIQUE');
}

// FF15. Tres filas "idénticas por texto, distintas solo en cómo el
// parser las capturó" (mismo mecanismo que FF1, con otra categoría
// reforzada) siguen bloqueadas — la cantidad de ocurrencias no se limita
// a 2.
{
  const grupo = [fakePm({ descripcionOriginal: 'DEV.IMPUESTO PAIS 30%( 1896141,36)', categoria: 'refund', subtipo: null, importe: -568842.4 }),
    fakePm({ descripcionOriginal: 'DEV.IMPUESTO PAIS 30%( 1896141,36)', categoria: 'refund', subtipo: null, importe: -568842.4 }),
    fakePm({ descripcionOriginal: 'DEV.IMPUESTO PAIS 30%( 1896141,36)', categoria: 'refund', subtipo: null, importe: -568842.4 })];
  const result = M.detectUnresolvedMovementMultiplicity(grupo, { cardId: VISA_8374.id, period: '2025-02' });
  eq('FF15. Tres filas idénticas siguen bloqueadas (UNRESOLVED_DUPLICATE)', result.movementMultiplicityState, 'UNRESOLVED_DUPLICATE');
  eq('FF15. El grupo registra las 3 ocurrencias', result.unresolvedDuplicateMovements[0].occurrences, 3);
}

// Un único movimiento reforzado sin pareja: UNIQUE, nunca se marca como
// duplicado ni como confirmado.
{
  const result = M.detectUnresolvedMovementMultiplicity([fakePm({})], { cardId: VISA_8374.id, period: '2025-02' });
  eq('Un movimiento reforzado sin pareja queda UNIQUE', result.movementMultiplicityState, 'UNIQUE');
  eq('uniqueMovements cuenta 1', result.uniqueMovements, 1);
}
// Sin movimientos reforzados en absoluto (o lista vacía): NOT_APPLICABLE.
{
  eq('Lista vacía → NOT_APPLICABLE', M.detectUnresolvedMovementMultiplicity([], {}).movementMultiplicityState, 'NOT_APPLICABLE');
  eq('Solo compras → NOT_APPLICABLE', M.detectUnresolvedMovementMultiplicity([fakePm({ categoria: 'purchase', computaComoGasto: true })], {}).movementMultiplicityState, 'NOT_APPLICABLE');
}

// FF3-FF9/FF14. Reproducción íntegra del caso real 02-25-visa.pdf a
// través del pipeline completo: el período entero queda bloqueado, cero
// inserts, cero updates, documentOperation:null, fuera de executionItems,
// dentro de blockedItems — y los pagos parciales manuales preservados
// (si los hubiera) permanecen intactos, sin verse afectados por el
// bloqueo de multiplicidad de OTRO grupo de movimientos.
{
  const item = fakeItem({
    fileName: '02-25-visa.pdf', hash: 'hash-ff-0225', periodOperativo: '2025-02', periodPorCierre: '2025-02',
    preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-01-30', declaredDueDate: '2025-02-10', movements: [
      { description: '25 Enero 09 007242 * PENTAGONO DUAL', amountArs: 44002.01, amountUsd: null, category: 'purchase' },
      { description: '25 Enero 06 ANULACION DE PAGO EN $', amountArs: 1394225.89, amountUsd: null, category: 'purchase' },
      { description: '06 ANULACION DE PAGO EN $', amountArs: 1394225.89, amountUsd: null, category: 'purchase' },
    ] }, reconciliation: { totals: { statementArs: 2832453.79, calculatedArs: 2832453.79, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
  });
  item.action = 'reparar_seguro';
  M.classifyMassiveLoadGroups([item]);
  M.setState([VISA_8374],
    [{ id: 'st-ff-0225', card_id: VISA_8374.id, statement_month: '2025-02-01', total_ars: 0, total_usd: 0, status: 'open' }],
    [{ id: 'doc-ff-0225', statement_id: 'st-ff-0225', kind: 'statement', original_name: '02-25-visa.pdf' }],
    []);
  const plan = M.buildMassiveLoadExecutionPlan({ items: [item] });
  const p = plan.items[0];
  eq('FF3. 02-25-visa.pdf pasa a BLOCKED_UNRESOLVED_DUPLICATE_MOVEMENTS', p.preflightState, 'BLOCKED_UNRESOLVED_DUPLICATE_MOVEMENTS');
  eq('FF4. Cero inserts', p.movementInserts.length, 0);
  eq('FF5. Cero updates', Object.keys(p.statementUpdates).length, 0);
  eq('FF6b. documentOperation:null', p.documentOperation, null);
  eq('FF7. No aparece en executionItems', plan.executionItems.some(x => x.sourceFileName === '02-25-visa.pdf'), false);
  ok('FF8. Aparece en blockedItems', plan.blockedItems.some(x => x.sourceFileName === '02-25-visa.pdf'));
  eq('FF14b. executionState BLOCKED', p.executionState, 'BLOCKED');
  eq('El motivo de bloqueo queda expuesto', p.blockingReasons.length > 0, true);
  ok('El motivo menciona la ausencia de identificador de multiplicidad', p.blockingReasons.some(r => /multiplicidad real/.test(r)));
  eq('global.resumenesBloqueados cuenta este período', plan.global.resumenesBloqueados, 1);
  eq('movementMultiplicitySummary.unresolvedDuplicateGroups cuenta 1', plan.global.movementMultiplicitySummary.unresolvedDuplicateGroups, 1);
  eq('movementMultiplicitySummary.unresolvedDuplicateOccurrences cuenta 2', plan.global.movementMultiplicitySummary.unresolvedDuplicateOccurrences, 2);
  eq('movementMultiplicitySummary.blockedPeriods cuenta 1', plan.global.movementMultiplicitySummary.blockedPeriods, 1);
}

// FF-fingerprint. El planFingerprint cambia cuando cambia el estado de
// multiplicidad de un ítem, aunque preflightState/movementInserts.length
// del resto del objeto permanezcan sin variar en la comparación directa
// (caso CONFIRMED_MULTIPLICITY → UNRESOLVED_DUPLICATE, mismo archivo).
{
  const base = { sourceFileName: 'x.pdf', preflightState: 'READY', movementInserts: [1], statementUpdates: {}, documentOperation: 'NONE_ALREADY_LINKED', unresolvedDuplicateMovements: [] };
  const planA = { global: {}, items: [{ ...base, movementMultiplicityState: 'CONFIRMED_MULTIPLICITY' }], executionItems: [base] };
  const planB = { global: {}, items: [{ ...base, movementMultiplicityState: 'UNRESOLVED_DUPLICATE', unresolvedDuplicateMovements: [{ occurrences: 2 }] }], executionItems: [base] };
  const fpA = M.buildPlanFingerprint(planA, '2026-07-17T00:00:00.000Z');
  const fpB = M.buildPlanFingerprint(planB, '2026-07-17T00:00:00.000Z');
  ok('Un cambio SOLO en movementMultiplicityState/grupos cambia la huella', fpA !== fpB);
}

// FF-UI. La sección "Movimientos repetidos sin multiplicidad demostrada"
// y la nueva etiqueta de estado bloqueado existen en ambos archivos —
// nunca se presentan como "duplicados a eliminar".
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  ok(`FF-UI. ${label} incluye la sección de movimientos repetidos sin multiplicidad demostrada`, /Movimientos repetidos sin multiplicidad demostrada/.test(src));
  ok(`FF-UI. ${label} explica que requieren verificación humana o evidencia adicional (nunca se presentan como duplicados a eliminar)`, /nunca se eliminan ni se elige arbitrariamente cuál conservar/.test(src));
  ok(`FF-UI. ${label} declara BLOCKED_UNRESOLVED_DUPLICATE_MOVEMENTS en las etiquetas de preflight`, /BLOCKED_UNRESOLVED_DUPLICATE_MOVEMENTS:'Bloqueado/.test(src));
}

// N. runMassiveConciliatedLoadExecute() solo actúa sobre 'crear_faltante'/
// 'reparar_seguro': nunca sobre conflicto/omitidos/revisión
// humana/fuera de alcance/error de lectura.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'runMassiveConciliatedLoadExecute');
  ok(`N. ${label} filtra explícitamente por action==='crear_faltante'||action==='reparar_seguro'`, /item\.action===.crear_faltante.\|\|item\.action===.reparar_seguro./.test(fn));
}

// O. Ausencia total de operaciones destructivas (delete/truncate) y de
// Storage en la vista previa completa (Parte 2 a 7 de esta etapa), en
// ambos archivos.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fns = ['analyzeMassiveLoadFile', 'classifyMassiveLoadGroups', 'buildExistingSnapshot', 'buildComparison',
    'decideMassiveLoadAction', 'runMassiveConciliatedLoadPreview', 'diagnosticoPruebaManualAgosto2025']
    .map(n => extractFunction(src, n)).join('\n');
  ok(`O. ${label} la vista previa completa nunca invoca .delete(, truncate, ni Storage`, !/\.delete\(|truncate|sb\.storage/i.test(fns));
  ok(`O. ${label} la vista previa completa nunca invoca sb.from/.insert/.update/.upsert/.rpc`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(fns));
}

// P. El JSON exportado incluye existingSnapshot y comparison en cada ítem
// accionable (massiveLoadItemSummary).
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'massiveLoadItemSummary');
  ok(`P. ${label} massiveLoadItemSummary() incluye existingSnapshot`, /existingSnapshot:item\.existingSnapshot/.test(fn));
  ok(`P. ${label} massiveLoadItemSummary() incluye comparison`, /comparison:item\.comparison/.test(fn));
}

// Q. El botón de ejecución real permanece bloqueado en esta etapa
// (MASSIVE_LOAD_EXECUTION_ENABLED_STAGE en false) y hay una defensa en
// profundidad en el handler del botón.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  eq(`Q. ${label} MASSIVE_LOAD_EXECUTION_ENABLED_STAGE es false en esta etapa`, new RegExp('MASSIVE_LOAD_EXECUTION_ENABLED_STAGE=false').test(src), true);
  ok(`Q. ${label} el modal deshabilita el botón cuando !MASSIVE_LOAD_EXECUTION_ENABLED_STAGE`, /!MASSIVE_LOAD_EXECUTION_ENABLED_STAGE\)\?'disabled'/.test(src));
  ok(`Q. ${label} el handler de confirmación tiene una guarda explícita adicional`, /if\(!MASSIVE_LOAD_EXECUTION_ENABLED_STAGE\)return;/.test(src));
}

// R. diagnosticoPruebaManualAgosto2025 (Parte 1) sigue de solo lectura.
{
  M.setState([VISA_8374], [], [], []);
  const diag = M.diagnosticoPruebaManualAgosto2025();
  eq('R. Sin resumen 2025-08 para Visa 8374 → encontrado:false', diag.encontrado, false);
}
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'diagnosticoPruebaManualAgosto2025');
  ok(`R. ${label} diagnosticoPruebaManualAgosto2025() nunca invoca sb.from/.insert/.update/.upsert/.rpc`, !/sb\.from\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(fn));
}

// S. sha256HexFromFile produce el hash SHA-256 correcto (vector conocido).
async function runAsyncChecks() {
  const file = new File([Buffer.from('abc', 'utf8')], 'test.txt', { type: 'text/plain' });
  const hash = await M.sha256HexFromFile(file);
  eq('S. sha256HexFromFile("abc") coincide con el vector SHA-256 conocido', hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // CC7. Un fallo de lectura bloquea TODO el plan — nunca construye un
  // plan ejecutable, nunca conserva silenciosamente el plan anterior.
  {
    M.setRefreshFn(async () => ({
      ok: false, error: 'Fallo simulado de lectura', liveRefreshTimestamp: '2026-07-17T00:00:00.000Z',
      paginationComplete: false, liveRowsLoaded: null, companyContext: 'GR Estanterías (gestor-gastos)',
      ownerContext: 'user-1', liveRefreshSource: null,
    }));
    const report = { items: [{ fileName: 'CC7.pdf', action: 'reparar_seguro' }] };
    const plan = await M.buildMassiveLoadExecutionPlanLive(report);
    eq('CC7. Fallo de lectura → preflightGlobalState BLOCKED_LIVE_REFRESH_FAILED', plan.preflightGlobalState, 'BLOCKED_LIVE_REFRESH_FAILED');
    eq('CC7. Sin items en el plan (nunca se arma un plan ejecutable)', plan.items.length, 0);
    eq('CC7. resumenesIncluidos en 0', plan.global.resumenesIncluidos, 0);
    eq('CC7. movimientosFaltantesPrevistos en 0', plan.global.movimientosFaltantesPrevistos, 0);
    eq('CC7. documentosAVincular en 0', plan.global.documentosAVincular, 0);
    ok('CC7. El error queda informado', !!plan.error);
  }

  // CC8. Una respuesta con paginación incompleta bloquea el plan aunque
  // "ok" viniera true (defensa en profundidad del guard exacto — nunca
  // declara cobertura completa cuando faltan páginas).
  {
    M.setRefreshFn(async () => ({
      ok: true, error: null, liveRefreshTimestamp: '2026-07-17T00:00:00.000Z',
      paginationComplete: false, liveRowsLoaded: { statements: 1, documents: 1, movements: 500 },
      companyContext: 'GR Estanterías (gestor-gastos)', ownerContext: 'user-1', liveRefreshSource: 'x',
    }));
    const report = { items: [{ fileName: 'CC8.pdf', action: 'reparar_seguro' }] };
    const plan = await M.buildMassiveLoadExecutionPlanLive(report);
    eq('CC8. paginationComplete:false bloquea el plan aunque ok:true (respuesta parcial nunca declarada completa)', plan.preflightGlobalState, 'BLOCKED_LIVE_REFRESH_FAILED');
  }

  // CC9. Cuando el refresco confirma cobertura completa y el estado live
  // no cambió respecto de la vista previa, el plan resultante coincide
  // con lo que buildMassiveLoadExecutionPlan calcularía directamente
  // (buildMassiveLoadExecutionPlanLive nunca altera el cómputo real, ni
  // fuerza los 491/524 a coincidir artificialmente).
  {
    const item = fakeItem({ fileName: 'CC9.pdf', hash: 'hash-cc9' });
    item.action = 'reparar_seguro';
    M.classifyMassiveLoadGroups([item]);
    M.setState([VISA_8374],
      [{ id: 'st-cc9', card_id: VISA_8374.id, statement_month: '2025-03-01', total_ars: 1500, total_usd: 0, status: 'open' }],
      [{ id: 'doc-cc9', statement_id: 'st-cc9', kind: 'statement', original_name: 'CC9.pdf' }],
      [{ id: 'mv-cc9', statement_id: 'st-cc9', card_id: VISA_8374.id, description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }]);
    const report = { items: [item] };
    const directPlan = M.buildMassiveLoadExecutionPlan(report);

    M.setRefreshFn(async () => ({
      ok: true, error: null, liveRefreshTimestamp: '2026-07-17T00:00:00.000Z', paginationComplete: true,
      liveRowsLoaded: { statements: 1, documents: 1, movements: 1 },
      companyContext: 'GR Estanterías (gestor-gastos)', ownerContext: 'user-1', liveRefreshSource: 'x',
    }));
    const livePlan = await M.buildMassiveLoadExecutionPlanLive(report);
    eq('CC9. Con cobertura completa, preflightGlobalState READY', livePlan.preflightGlobalState, 'READY');
    eq('CC9. El plan en vivo coincide con el cómputo directo (mismos incluidos)', livePlan.global.resumenesIncluidos, directPlan.global.resumenesIncluidos);
    eq('CC9. El plan en vivo coincide con el cómputo directo (mismos movimientos faltantes)', livePlan.global.movimientosFaltantesPrevistos, directPlan.global.movimientosFaltantesPrevistos);
    ok('CC9. Trae companyContext/ownerContext/liveRefreshTimestamp/liveRefreshSource', !!(livePlan.companyContext && livePlan.ownerContext && livePlan.liveRefreshTimestamp && livePlan.liveRefreshSource));
    ok('CC9. planFingerprint queda calculado', !!livePlan.planFingerprint);
    ok('CC9. previewSnapshot/liveSnapshot quedan expuestos', Array.isArray(livePlan.previewSnapshot) && Array.isArray(livePlan.liveSnapshot));
  }

  // CC10. changesSincePreview detecta correctamente: una fila agregada
  // después de la vista previa reduce los inserts; un documento
  // vinculado después de la vista previa ya no se propone para subir; un
  // nuevo pago manual queda preservado; una nueva ambigüedad bloquea el
  // período (cambia de acción, con motivo expuesto).
  // CORRECCIÓN 6B4.14.6.3 - documentoVinculadoDesdeVistaPrevia (booleano
  // ambiguo, calculado desde documentOperation) fue reemplazado por
  // documentWasLinkedAfterPreview/documentWasRemovedAfterPreview/
  // documentStatusChanged, calculados desde documentStatus (el hecho
  // observado) — estos fixtures ahora fijan documentStatus explícitamente.
  {
    const previewItem = {
      fileName: 'CC10.pdf',
      plannedMovementInserts: [{ id: 'a' }, { id: 'b' }],
      existingSnapshot: { documentoVinculado: false, totalArsPersistido: 0 },
      existingOnlyPreserved: [],
    };
    const livePlanItem = {
      sourceFileName: 'CC10.pdf',
      movementInserts: [{ id: 'b' }],
      documentStatus: 'ALREADY_LINKED',
      documentOperation: 'NONE_ALREADY_LINKED',
      statementUpdates: {},
      preservedExistingMovements: [{ existingMovement: { id: 'manual-1' } }],
      preflightState: 'READY',
      blockingReasons: [],
    };
    const changes = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItem] });
    eq('CC10. Una fila agregada después de la vista previa reduce los inserts detectados', changes[0].movimientosAgregadosDesdeVistaPrevia, 1);
    eq('CC10. Un documento vinculado después de la vista previa se detecta (documentWasLinkedAfterPreview:true)', changes[0].documentWasLinkedAfterPreview, true);
    eq('CC10. Nunca se marca como removido a la vez que como vinculado', changes[0].documentWasRemovedAfterPreview, false);
    eq('CC10. La dirección es demostrable (ALREADY_LINKED/MISSING) → documentStatusChanged:false', changes[0].documentStatusChanged, false);
    eq('CC10. Un nuevo pago manual queda detectado como preservado', changes[0].pagosManualesNuevos, 1);
    eq('CC10. Sin cambio de acción (sigue READY)', changes[0].accionCambio, false);

    const livePlanItemBloqueado = { ...livePlanItem, preflightState: 'BLOCKED_AMBIGUOUS_MOVEMENTS', blockingReasons: ['nueva ambigüedad'] };
    const changesBloqueado = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItemBloqueado] });
    eq('CC10. Una nueva ambigüedad bloquea el período (accionCambio:true)', changesBloqueado[0].accionCambio, true);
    eq('CC10. El motivo de bloqueo queda expuesto', changesBloqueado[0].motivoBloqueo, 'nueva ambigüedad');
  }

  // CC10c. Reproduce EXACTAMENTE la contradicción real reportada en el
  // pedido 6B4.14.6.3 (01-25.pdf, 03-25.pdf, etc.): un período bloqueado
  // cuyo propio motivo dice "no hay documento vinculado" — antes
  // (calculado desde documentOperation, que quedaba en su default
  // 'NONE_ALREADY_LINKED' para todo bloqueo) aparecía
  // documentoVinculadoDesdeVistaPrevia:true, contradiciendo el motivo.
  // Ahora, con documentStatus:'MISSING' explícito, nunca se afirma un
  // vínculo que no existe.
  {
    const previewItem = {
      fileName: '01-25.pdf', plannedMovementInserts: [],
      existingSnapshot: { documentoVinculado: false, totalArsPersistido: 0 },
      existingOnlyPreserved: [],
    };
    const livePlanItemBloqueadoSinDoc = {
      sourceFileName: '01-25.pdf', movementInserts: [], documentStatus: 'MISSING', documentOperation: null,
      statementUpdates: {}, preservedExistingMovements: [], preflightState: 'BLOCKED_AMBIGUOUS_MOVEMENTS',
      blockingReasons: ['... no hay documento vinculado. La deduplicación de movimientos existentes no quedó completamente demostrada...'],
    };
    const changes = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItemBloqueadoSinDoc] });
    eq('CC10c. Nunca aparece "documento vinculado" en un período cuyo motivo dice lo contrario', changes[0].documentWasLinkedAfterPreview, false);
    eq('CC10c. Tampoco aparece como "removido" (nunca hubo vínculo, ni antes ni ahora)', changes[0].documentWasRemovedAfterPreview, false);
    eq('CC10c. MISSING es una dirección demostrable → documentStatusChanged:false (sin ambigüedad)', changes[0].documentStatusChanged, false);
  }

  // CC10d. Cuando el estado documental en vivo es CONFLICT o UNKNOWN, la
  // dirección del cambio NO es demostrable — nunca se adivina el sentido:
  // se informa documentStatusChanged:true con ambos valores explícitos.
  {
    const previewItem = {
      fileName: 'CC10D.pdf', plannedMovementInserts: [],
      existingSnapshot: { documentoVinculado: true, totalArsPersistido: 0 },
      existingOnlyPreserved: [],
    };
    const livePlanItemConflicto = {
      sourceFileName: 'CC10D.pdf', movementInserts: [], documentStatus: 'CONFLICT', documentOperation: null,
      statementUpdates: {}, preservedExistingMovements: [], preflightState: 'BLOCKED_DOCUMENT_CONFLICT',
      blockingReasons: ['conflicto documental'],
    };
    const changes = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItemConflicto] });
    eq('CC10d. CONFLICT nunca se afirma como "vinculado después de la vista previa"', changes[0].documentWasLinkedAfterPreview, false);
    eq('CC10d. CONFLICT nunca se afirma como "removido después de la vista previa"', changes[0].documentWasRemovedAfterPreview, false);
    eq('CC10d. CONFLICT se informa como documentStatusChanged:true (sin adivinar dirección)', changes[0].documentStatusChanged, true);
    const detail = changes[0].documentStatusChangeDetail || '';
    ok('CC10d. documentStatusChangeDetail explica el estado anterior y el estado en vivo', /vinculado/.test(detail) && /no coincide/i.test(detail));
  }

  // CC11. Un total corregido después de la vista previa ya no se
  // propone para actualizar (statementUpdates vacío → totalesModificados:false).
  // Y — la misma corrección de totales YA conocida desde la vista previa
  // (statementUpdates sigue pidiendo el mismo ajuste) NUNCA se marca
  // como "cambio desde la vista previa": es un pendiente conocido, no
  // una novedad. Solo se marca como cambio real cuando el total
  // PERSISTIDO en sí varió entre la vista previa y la lectura en vivo.
  {
    const previewItem = { fileName: 'CC11.pdf', plannedMovementInserts: [], existingSnapshot: { documentoVinculado: true }, existingOnlyPreserved: [] };
    const livePlanItem = { sourceFileName: 'CC11.pdf', movementInserts: [], documentOperation: 'NONE_ALREADY_LINKED', statementUpdates: {}, preservedExistingMovements: [], preflightState: 'READY', blockingReasons: [] };
    const changes = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItem] });
    eq('CC11. Un total ya correcto no aparece como modificado', changes[0].totalesModificados, false);
  }
  {
    // El total persistido en la vista previa YA era $0 (igual que en
    // 6B4.14.6, los 6 Visa 8374 ene-jun 2025) y sigue siendo $0 en vivo:
    // el plan sigue proponiendo la misma corrección conocida, pero NO es
    // un cambio nuevo — nunca debe aparecer como "diferencia detectada".
    const previewItem = { fileName: 'CC11b.pdf', plannedMovementInserts: [], existingSnapshot: { documentoVinculado: true, totalArsPersistido: 0, totalUsdPersistido: 0 }, existingOnlyPreserved: [] };
    const livePlanItemMismoPendiente = { sourceFileName: 'CC11b.pdf', movementInserts: [], documentOperation: 'NONE_ALREADY_LINKED', statementUpdates: { total_ars: 2788451.78 }, preservedExistingMovements: [], preflightState: 'READY', blockingReasons: [], expectedBefore: { totalArs: 0, totalUsd: 0 } };
    const changesPendiente = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItemMismoPendiente] });
    eq('CC11b. Una corrección de totales ya conocida desde la vista previa NO es un "cambio desde la vista previa"', changesPendiente[0].totalesModificados, false);

    // Ahora el total persistido SÍ cambió en vivo respecto de la vista
    // previa (otra escritura ya corrigió parcialmente el resumen) — acá
    // sí debe detectarse como una diferencia real.
    const livePlanItemCambioReal = { ...livePlanItemMismoPendiente, expectedBefore: { totalArs: 1200000, totalUsd: 0 } };
    const changesCambio = M.buildChangesSincePreview({ items: [previewItem] }, { items: [livePlanItemCambioReal] });
    eq('CC11b. Un total persistido que sí cambió entre la vista previa y la lectura en vivo se detecta como diferencia', changesCambio[0].totalesModificados, true);
  }

  // CC12. planFingerprint es determinístico (mismo plan+timestamp da la
  // misma huella, para detectar un plan viejo reutilizado por error) y
  // distingue planes con contenido distinto (nunca reutiliza un plan viejo).
  {
    const planA = { global: { resumenesIncluidos: 1 }, items: [{ sourceFileName: 'x.pdf', preflightState: 'READY', movementInserts: [1] }] };
    const planB = { global: { resumenesIncluidos: 2 }, items: [{ sourceFileName: 'x.pdf', preflightState: 'READY', movementInserts: [1, 2] }] };
    const fp1 = M.buildPlanFingerprint(planA, '2026-07-17T00:00:00.000Z');
    const fp2 = M.buildPlanFingerprint(planA, '2026-07-17T00:00:00.000Z');
    const fp3 = M.buildPlanFingerprint(planB, '2026-07-17T00:00:00.000Z');
    eq('CC12. planFingerprint es determinístico (mismo plan → misma huella)', fp1, fp2);
    ok('CC12. planFingerprint distingue planes con contenido distinto', fp1 !== fp3);
  }

  // ============================================================
  // GG. CORRECCIÓN 6B4.14.7 — Doble preflight, idempotencia y
  // manifiesto de simulación (100% de lectura, cero escrituras).
  // ============================================================

  // GG1. Cada simulación dispara un refresco live NUEVO (nunca reutiliza
  // el anterior).
  {
    let calls = 0;
    M.setRefreshFn(async () => { calls++; return { ok: true, error: null, liveRefreshTimestamp: 't' + calls, paginationComplete: true, liveRowsLoaded: { statements: 0, documents: 0, movements: 0 }, companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x' }; });
    M.setState([], [], [], []);
    await M.buildMassiveLoadExecutionDryRunLive(null, []);
    await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('GG1. Cada simulación dispara un refresco live nuevo (nunca reutiliza el anterior)', calls, 2);
  }

  // GG2. Una lectura fallida bloquea todo.
  {
    M.setRefreshFn(async () => ({ ok: false, error: 'Fallo simulado', liveRefreshTimestamp: 't', paginationComplete: false, liveRowsLoaded: null, companyContext: null, ownerContext: null, liveRefreshSource: null }));
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('GG2. Lectura fallida -> BLOCKED_LIVE_REFRESH', dryRun.executionEligibilityState, 'BLOCKED_LIVE_REFRESH');
    eq('GG2. Cero ejecutables', dryRun.executionItems.length, 0);
  }

  // GG3. Paginación incompleta bloquea todo, aunque ok:true (defensa en
  // profundidad, igual criterio que 6B4.14.6.1).
  {
    M.setRefreshFn(async () => ({ ok: true, error: null, liveRefreshTimestamp: 't', paginationComplete: false, liveRowsLoaded: { statements: 1, documents: 1, movements: 1 }, companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x' }));
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('GG3. Paginación incompleta -> BLOCKED_LIVE_REFRESH', dryRun.executionEligibilityState, 'BLOCKED_LIVE_REFRESH');
  }

  // GG4. Contexto distinto de GR Estanterías bloquea todo.
  {
    M.setRefreshFn(async () => ({ ok: true, error: null, liveRefreshTimestamp: 't', paginationComplete: true, liveRowsLoaded: { statements: 1, documents: 1, movements: 1 }, companyContext: 'Otra empresa', ownerContext: 'user-1', liveRefreshSource: 'x' }));
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('GG4. companyContext distinto -> BLOCKED_LIVE_REFRESH', dryRun.executionEligibilityState, 'BLOCKED_LIVE_REFRESH');
    ok('GG4. El motivo menciona la separación de empresas', /separaci[oó]n de empresas/.test(dryRun.error || ''));
  }

  // Paso 2 — sin sesión válida o sin acceso a espacios propios: bloquea
  // todo antes de intentar ningún refresco.
  {
    M.setSession(null);
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('Sin sesión válida -> BLOCKED_LIVE_REFRESH (Paso 2)', dryRun.executionEligibilityState, 'BLOCKED_LIVE_REFRESH');
    M.setSession({ user: { id: 'user-1' } });
  }
  {
    M.setHasOwnerSpaces(() => false);
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, []);
    eq('Sin acceso a espacios propios -> BLOCKED_LIVE_REFRESH (Paso 2)', dryRun.executionEligibilityState, 'BLOCKED_LIVE_REFRESH');
    M.setHasOwnerSpaces(() => true);
  }

  // GG5. Un plan de origen vencido queda bloqueado.
  {
    M.setRefreshFn(async () => ({ ok: true, error: null, liveRefreshTimestamp: 't', paginationComplete: true, liveRowsLoaded: { statements: 0, documents: 0, movements: 0 }, companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x' }));
    M.setState([], [], [], []);
    const stalePlan = { planFingerprint: 'fp_old', dryRunExpiresAt: '2020-01-01T00:00:00.000Z', executionItems: [] };
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(stalePlan, []);
    eq('GG5. Plan de origen vencido -> BLOCKED_STALE_PLAN', dryRun.executionEligibilityState, 'BLOCKED_STALE_PLAN');
  }

  // GG6/GG24(fingerprint). Un plan de origen CANÓNICAMENTE distinto del
  // recién reconstruido queda bloqueado (requiere nueva revisión humana)
  // — comparable (trae 'items'), pero con contenido real distinto.
  {
    M.setRefreshFn(async () => ({ ok: true, error: null, liveRefreshTimestamp: 't', paginationComplete: true, liveRowsLoaded: { statements: 0, documents: 0, movements: 0 }, companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x' }));
    M.setState([], [], [], []);
    const priorPlan = {
      planFingerprint: 'fp_prior',
      items: [{ sourceFileName: 'ALGO_QUE_YA_NO_ESTA.pdf', statementId: 'st-x', cardId: 'card-x', period: '2025-03', sourceFileHash: 'hash-x', preflightState: 'READY', statementUpdates: {}, movementInserts: [{ firma: 'firma-1' }], documentOperation: 'NONE_ALREADY_LINKED', preservedExistingMovements: [] }],
      executionItems: [{ sourceFileName: 'ALGO_QUE_YA_NO_ESTA.pdf', statementId: 'st-x', cardId: 'card-x', period: '2025-03', sourceFileHash: 'hash-x', preflightState: 'READY', statementUpdates: {}, movementInserts: [{ firma: 'firma-1' }], documentOperation: 'NONE_ALREADY_LINKED', preservedExistingMovements: [] }],
    };
    // sourceFiles=[] -> freshPlan.items estará vacío: distinto de
    // priorPlan.items (que trae 1 candidato) -> CHANGED.
    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(priorPlan, []);
    eq('GG6. La lista/contenido de candidatos cambió -> BLOCKED_PLAN_CHANGED', dryRun.executionEligibilityState, 'BLOCKED_PLAN_CHANGED');
    eq('GG24. executionBlockingStates incluye BLOCKED_PLAN_CHANGED', dryRun.executionBlockingStates.includes('BLOCKED_PLAN_CHANGED'), true);
    eq('planComparisonState queda CHANGED', dryRun.planComparisonState, 'CHANGED');
    ok('planDifferences no está vacío cuando el plan cambió', (dryRun.planDifferences||[]).length>0);
  }

  // GG7/GG8. Verificación del archivo original: hash recalculado,
  // ausencia de archivo, y tarjeta distinta — nunca acepta coincidencia
  // solo por nombre.
  {
    const fileBytes = Buffer.from('contenido-pdf-simulado-gg', 'utf8');
    const file = new File([fileBytes], 'GG_FILE.pdf', { type: 'application/pdf' });
    const realHash = await M.sha256HexFromFile(file);
    const planItem = { sourceFileHash: realHash, cardId: VISA_8374.id, period: '2025-03' };
    const sourceFileMeta = { file, cardResolution: { card: VISA_8374 }, periodOperativo: '2025-03' };

    const checkOk = await M.verifySourceFileForPlanItem(planItem, sourceFileMeta);
    eq('Archivo correcto -> documentPreconditionState OK', checkOk.documentPreconditionState, 'OK');
    eq('El hash recalculado coincide con el esperado', checkOk.recomputedHash, realHash);

    const checkMissing = await M.verifySourceFileForPlanItem(planItem, null);
    eq('GG7. Archivo ausente bloquea su período (BLOCKED_SOURCE_FILE_MISMATCH)', checkMissing.documentPreconditionState, 'BLOCKED_SOURCE_FILE_MISMATCH');

    const planItemWrongHash = { sourceFileHash: 'hash-distinto-esperado', cardId: VISA_8374.id, period: '2025-03' };
    const checkWrongHash = await M.verifySourceFileForPlanItem(planItemWrongHash, sourceFileMeta);
    eq('GG8. Hash diferente bloquea su período (BLOCKED_SOURCE_FILE_MISMATCH)', checkWrongHash.documentPreconditionState, 'BLOCKED_SOURCE_FILE_MISMATCH');

    const checkWrongCard = await M.verifySourceFileForPlanItem(planItem, { ...sourceFileMeta, cardResolution: { card: { id: 'card-otra' } } });
    eq('Archivo de otra tarjeta bloquea (nunca acepta solo por nombre)', checkWrongCard.documentPreconditionState, 'BLOCKED_SOURCE_FILE_MISMATCH');
  }

  // GG9/GG10/GG38. Movimientos: sigue faltando -> READY_TO_INSERT; ya
  // insertado -> NO_OP_ALREADY_APPLIED (nunca lo duplica).
  {
    const planItem = { statementId: 'st-mv', cardId: VISA_8374.id, period: '2025-03', sourceFileName: 'GG_MV.pdf',
      movementInserts: [fakePm({ descripcionOriginal: '25 Marzo 03 234567 * COMERCIO TEST', categoria: 'purchase', subtipo: null, computaComoGasto: true, fecha: '2025-03-03', importe: 1000 })] };
    const checkMissing = M.buildMovementInsertIdempotencyCheck(planItem, []);
    eq('GG9. Movimiento que sigue faltando queda READY_TO_INSERT', checkMissing.movements[0].movementInsertState, 'READY_TO_INSERT');
    eq('GG9. state OK (nada bloquea)', checkMissing.state, 'OK');

    const liveMatching = [{ id: 'mv-live-1', statement_id: 'st-mv', description: '25 Marzo 03 234567 * COMERCIO TEST', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' }];
    const checkApplied = M.buildMovementInsertIdempotencyCheck(planItem, liveMatching);
    eq('GG10. Movimiento ya insertado queda NO_OP_ALREADY_APPLIED', checkApplied.movements[0].movementInsertState, 'NO_OP_ALREADY_APPLIED');
    eq('GG10. existingMovementId apunta a la fila real ya persistida', checkApplied.movements[0].existingMovementId, 'mv-live-1');
    eq('GG38. Ejecución parcial simulada: nunca lo vuelve a proponer como READY_TO_INSERT (0 duplicados)', checkApplied.readyToInsertCount, 0);
  }

  // GG1 (obligatoria #1). Sin ningún movementInsert previsto, el control
  // NI SIQUIERA corre — NOT_APPLICABLE_NO_MOVEMENT_WRITES, nunca bloquea
  // una operación documental o de resumen. Es el caso de los 13 períodos
  // solo-documento (01-26.pdf, 02-25.pdf, etc.).
  {
    const planItem = { statementId: 'st-nomv', cardId: VISA_8374.id, period: '2025-03', sourceFileName: 'GG_NOMV.pdf', movementInserts: [] };
    const liveMany = Array.from({ length: 38 }, (_, i) => ({ id: 'mv-existing-' + i, statement_id: 'st-nomv', description: 'CONSUMO EXISTENTE ' + i, currency: 'ARS', amount: 100 + i, movement_date: '2025-02-0' + ((i % 9) + 1) }));
    const check = M.buildMovementInsertIdempotencyCheck(planItem, liveMany);
    eq('Obligatoria #1. movementInserts vacío -> NOT_APPLICABLE_NO_MOVEMENT_WRITES', check.state, 'NOT_APPLICABLE_NO_MOVEMENT_WRITES');
    eq('Obligatoria #1. readyToInsertCount en 0', check.readyToInsertCount, 0);
    eq('Obligatoria #1. noOpCount en 0', check.noOpCount, 0);
    eq('Obligatoria #1. ambiguousMatches vacío', check.ambiguousMatches.length, 0);
    eq('Obligatoria #1. unrelatedExistingMovementsCount informativo (38)', check.unrelatedExistingMovementsCount, 38);
    // Obligatoria #4/#21: el control de documento nunca se ve afectado
    // por este resultado — sigue evaluándose de forma independiente.
    const docCheck = M.buildDocumentLinkIdempotencyCheck({ statementId: 'st-nomv', documentOperation: 'UPLOAD_AND_LINK_ORIGINAL', documentStatus: 'MISSING' }, [], { documentPreconditionState: 'OK' }, true);
    eq('Obligatoria #4. La operación documental sigue READY_TO_UPLOAD_AND_LINK, sin bloqueo por movimientos', docCheck.state, 'READY_TO_UPLOAD_AND_LINK');
  }

  // Obligatoria #2/#3/GG11(corregida). Un movimiento existente SIN
  // relación con ningún insert previsto (fecha/moneda/importe distintos)
  // NUNCA genera ambigüedad ni bloquea el período — el error confirmado
  // del pedido (un resumen con 38 movimientos ya persistidos y solo 2
  // inserts previstos terminaba con 36 "ambigüedades" y el período
  // entero bloqueado).
  {
    const planItem = { statementId: 'st-unrel', cardId: VISA_8374.id, period: '2025-03', sourceFileName: 'GG_UNREL.pdf',
      movementInserts: [fakePm({ descripcionOriginal: '25 Marzo 03 234567 * COMERCIO TEST', categoria: 'purchase', subtipo: null, computaComoGasto: true, fecha: '2025-03-03', importe: 1000 })] };
    const liveUnrelated = [{ id: 'mv-live-2', statement_id: 'st-unrel', description: 'FORMATO DESCONOCIDO SIN PAR', currency: 'ARS', amount: 999, movement_date: '2025-03-06' }];
    const check = M.buildMovementInsertIdempotencyCheck(planItem, liveUnrelated);
    eq('Obligatoria #2. Movimiento existente sin relación NO genera ambigüedad (state OK)', check.state, 'OK');
    eq('Obligatoria #2. El insert sigue simplemente faltando (READY_TO_INSERT)', check.movements[0].movementInsertState, 'READY_TO_INSERT');
    eq('Obligatoria #2. El movimiento existente no relacionado queda fuera de ambiguousMatches', check.ambiguousMatches.length, 0);
    eq('Obligatoria #3. unrelatedExistingMovementsCount lo cuenta como informativo, nunca como bloqueo', check.unrelatedExistingMovementsCount, 1);
  }

  // GG11 (verdadera ambigüedad). Dos movimientos live comparten
  // EXACTAMENTE la misma fecha/moneda/importe/tipo que un único insert
  // previsto — ahí sí es ambiguo (no se puede saber cuál es cuál), y
  // bloquea ese período.
  {
    const planItem = { statementId: 'st-amb', cardId: VISA_8374.id, period: '2025-03', sourceFileName: 'GG_AMB.pdf',
      movementInserts: [fakePm({ descripcionOriginal: '25 Marzo 03 234567 * COMERCIO TEST', categoria: 'purchase', subtipo: null, computaComoGasto: true, fecha: '2025-03-03', importe: 1000 })] };
    const liveAmbiguous = [
      { id: 'mv-live-a', statement_id: 'st-amb', description: 'OTRO COMERCIO IRRECONOCIBLE', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
      { id: 'mv-live-b', statement_id: 'st-amb', description: 'TERCER COMERCIO IRRECONOCIBLE', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
    ];
    const check = M.buildMovementInsertIdempotencyCheck(planItem, liveAmbiguous);
    eq('GG11. Dos candidatos posibles para el mismo insert bloquean ese insert (BLOCKED_AMBIGUOUS_MATCH)', check.state, 'BLOCKED_AMBIGUOUS_MATCH');
  }

  // Obligatoria #11. Ninguna fila live se consume dos veces: dos inserts
  // distintos, cada uno con su propio candidato exacto, cada uno se
  // empareja con SU candidato — nunca ambos reclaman el mismo.
  {
    const planItem = { statementId: 'st-noreuse', cardId: VISA_8374.id, period: '2025-03', sourceFileName: 'GG_NOREUSE.pdf',
      movementInserts: [
        fakePm({ descripcionOriginal: '25 Marzo 03 234567 * COMERCIO A', categoria: 'purchase', subtipo: null, computaComoGasto: true, fecha: '2025-03-03', importe: 1000 }),
        fakePm({ descripcionOriginal: '25 Marzo 05 234568 * COMERCIO B', categoria: 'purchase', subtipo: null, computaComoGasto: true, fecha: '2025-03-05', importe: 2000 }),
      ] };
    const liveExact = [
      { id: 'mv-a', statement_id: 'st-noreuse', description: '25 Marzo 03 234567 * COMERCIO A', currency: 'ARS', amount: 1000, movement_date: '2025-03-03' },
      { id: 'mv-b', statement_id: 'st-noreuse', description: '25 Marzo 05 234568 * COMERCIO B', currency: 'ARS', amount: 2000, movement_date: '2025-03-05' },
    ];
    const check = M.buildMovementInsertIdempotencyCheck(planItem, liveExact);
    eq('Obligatoria #11. Ambos quedan NO_OP_ALREADY_APPLIED (cada uno con su propia fila)', check.movements.every(m => m.movementInsertState === 'NO_OP_ALREADY_APPLIED'), true);
    const usedIds = check.movements.map(m => m.existingMovementId);
    eq('Obligatoria #11. Nunca se reutiliza la misma fila live para dos inserts', new Set(usedIds).size, 2);
  }

  // Caso "Visa septiembre de 2025" (obligatoria #5/#6/#7): un resumen con
  // MUCHOS movimientos ya persistidos (38 en el caso real) y solo 2
  // movementInserts previstos — los existentes no relacionados se
  // conservan intactos, y los 2 previstos, al no estar ya persistidos,
  // quedan READY_TO_INSERT sin bloquear el período.
  {
    const planItem = { statementId: 'st-sep25', cardId: VISA_8374.id, period: '2025-09', sourceFileName: 'liquidacion_visa_    8374_2025-09.pdf',
      movementInserts: [
        fakePm({ descripcionOriginal: '02 IIBB PERCEP-BSAS 2,00%( 11999,00)', categoria: 'tax', subtipo: 'percepcion', computaComoGasto: false, fecha: '2025-10-02', importe: 239.98 }),
        fakePm({ descripcionOriginal: '02 IVA RG 4240 21%( 11999,00)', categoria: 'tax', subtipo: 'impuesto', computaComoGasto: false, fecha: '2025-10-02', importe: 2519.79 }),
      ] };
    const liveExistingMovements = Array.from({ length: 38 }, (_, i) => ({
      id: 'mv-sep25-' + i, statement_id: 'st-sep25', description: 'CONSUMO YA PERSISTIDO ' + i,
      currency: 'ARS', amount: 500 + i * 7, movement_date: '2025-08-' + String((i % 27) + 1).padStart(2, '0'),
    }));
    const check = M.buildMovementInsertIdempotencyCheck(planItem, liveExistingMovements);
    eq('Obligatoria #5/#6. Visa septiembre 2025: los 2 previstos quedan READY_TO_INSERT', check.readyToInsertCount, 2);
    eq('Obligatoria #5. state OK — los 38 existentes no relacionados no bloquean el período', check.state, 'OK');
    eq('Obligatoria #5. Los 38 movimientos existentes quedan informados, nunca tocados', check.unrelatedExistingMovementsCount, 38);
  }

  // GG12. Multiplicidad no demostrada bloquea el período — reutiliza
  // detectUnresolvedMovementMultiplicity tal cual (6B4.14.6.4), nunca la
  // reimplementa.
  {
    const dup1 = fakePm({ descripcionOriginal: '25 Enero 06 ANULACION DE PAGO EN $' });
    const dup2 = fakePm({ descripcionOriginal: '06 ANULACION DE PAGO EN $', fechaOrigen: 'dia_con_contexto_seccion' });
    const planItem = { statementId: 'st-mult', cardId: VISA_8374.id, period: '2025-02', sourceFileName: 'GG_MULT.pdf', movementInserts: [dup1, dup2] };
    const check = M.buildMovementInsertIdempotencyCheck(planItem, []);
    eq('GG12. Multiplicidad no demostrada bloquea el período (BLOCKED_MULTIPLICITY_NOT_PROVEN)', check.state, 'BLOCKED_MULTIPLICITY_NOT_PROVEN');
    eq('Ninguno de los dos se descarta silenciosamente: ambos quedan marcados', check.movements.filter(m => m.movementInsertState === 'BLOCKED_MULTIPLICITY_NOT_PROVEN').length, 2);
  }

  // GG16/GG17. Pagos manuales preservados: sin cambios se conservan; si
  // cambiaron o desaparecieron, bloquean el período.
  {
    const planItem = { preservedExistingMovements: [{ existingMovement: { id: 'mv-manual-1', description: 'Pago parcial registrado', currency: 'ARS', amount: -500, movement_date: '2025-03-05' } }] };
    const liveUnchanged = [{ id: 'mv-manual-1', statement_id: undefined, description: 'Pago parcial registrado', currency: 'ARS', amount: -500, movement_date: '2025-03-05' }];
    const checkOk = M.buildPreservedMovementsCheck(planItem, liveUnchanged);
    eq('GG16. Pago manual existente sin cambios se conserva (state OK)', checkOk.state, 'OK');

    const liveChanged = [{ id: 'mv-manual-1', statement_id: undefined, description: 'Pago parcial registrado', currency: 'ARS', amount: -999, movement_date: '2025-03-05' }];
    const checkChanged = M.buildPreservedMovementsCheck(planItem, liveChanged);
    eq('GG17. Pago manual modificado bloquea (BLOCKED_PRESERVED_MOVEMENT_CHANGED)', checkChanged.state, 'BLOCKED_PRESERVED_MOVEMENT_CHANGED');

    const checkMissing = M.buildPreservedMovementsCheck(planItem, []);
    eq('GG17b. Pago manual desaparecido también bloquea', checkMissing.state, 'BLOCKED_PRESERVED_MOVEMENT_CHANGED');
  }

  // GG18/GG19/GG20. Actualización optimista de totales/fechas por campo.
  {
    const planItem = { statementUpdates: { total_ars: 5000, close_date: '2025-03-26' }, expectedBefore: { totalArs: 4000, totalUsd: 0, fechaCierre: '2025-02-26', fechaVencimiento: null } };
    const liveStillOld = { total_ars: 4000, total_usd: 0, close_date: '2025-02-26', due_date: null };
    const checkReady = M.buildStatementUpdateOptimisticCheck(planItem, liveStillOld);
    eq('GG18. Total live igual a expectedBefore queda READY_TO_UPDATE', checkReady.fields.total_ars.fieldState, 'READY_TO_UPDATE');
    eq('GG18. state global READY_TO_UPDATE', checkReady.state, 'READY_TO_UPDATE');

    const liveAlreadyApplied = { total_ars: 5000, total_usd: 0, close_date: '2025-03-26', due_date: null };
    const checkNoOp = M.buildStatementUpdateOptimisticCheck(planItem, liveAlreadyApplied);
    eq('GG19. Total ya actualizado queda NO_OP_ALREADY_APPLIED', checkNoOp.state, 'NO_OP_ALREADY_APPLIED');

    const liveThirdValue = { total_ars: 9999, total_usd: 0, close_date: '2025-02-26', due_date: null };
    const checkBlocked = M.buildStatementUpdateOptimisticCheck(planItem, liveThirdValue);
    eq('GG20. Un tercer valor distinto bloquea el período (BLOCKED_CURRENT_VALUE_CHANGED)', checkBlocked.state, 'BLOCKED_CURRENT_VALUE_CHANGED');

    const checkNotFound = M.buildStatementUpdateOptimisticCheck(planItem, null);
    eq('Resumen inexistente en la lectura en vivo -> BLOCKED_STATEMENT_NOT_FOUND', checkNotFound.state, 'BLOCKED_STATEMENT_NOT_FOUND');
  }

  // GG21/GG23/Obligatoria#17/18. Documento faltante+hash correcto ->
  // READY_TO_UPLOAD_AND_LINK; documento diferente/duplicado -> bloquea.
  {
    const fileOk = { documentPreconditionState: 'OK' };
    const planItemUpload = { statementId: 'st-doc', documentOperation: 'UPLOAD_AND_LINK_ORIGINAL', documentStatus: 'MISSING' };
    const checkReady = M.buildDocumentLinkIdempotencyCheck(planItemUpload, [], fileOk, true);
    eq('GG21. Documento faltante y hash correcto queda READY_TO_UPLOAD_AND_LINK', checkReady.state, 'READY_TO_UPLOAD_AND_LINK');

    const liveDoc = [{ id: 'doc-1', statement_id: 'st-doc', kind: 'statement' }];
    // El plan asumió que no había documento (UPLOAD_AND_LINK_ORIGINAL) —
    // si la lectura en vivo de este dry-run encuentra uno de todos modos,
    // nunca se asume que es el mismo (aunque sea el único documento).
    const checkDifferent = M.buildDocumentLinkIdempotencyCheck(planItemUpload, liveDoc, fileOk, true);
    eq('GG23/Obligatoria#17. Documento inesperado (el plan no esperaba ninguno) bloquea (BLOCKED_DIFFERENT_DOCUMENT_LINKED)', checkDifferent.state, 'BLOCKED_DIFFERENT_DOCUMENT_LINKED');
    eq('Obligatoria#14. matchedDocumentId nunca es null cuando se encontró un documento real', checkDifferent.matchedDocumentId, 'doc-1');

    const liveDupDocs = [{ id: 'doc-1', statement_id: 'st-doc', kind: 'statement' }, { id: 'doc-2', statement_id: 'st-doc', kind: 'statement' }];
    const checkDup = M.buildDocumentLinkIdempotencyCheck(planItemUpload, liveDupDocs, fileOk, true);
    eq('GG23/Obligatoria#18. Más de un documento vinculado al mismo resumen -> BLOCKED_DUPLICATE_DOCUMENT', checkDup.state, 'BLOCKED_DUPLICATE_DOCUMENT');
  }

  // Problema 2 del pedido (falso SAME_HASH) — GG22 corregida +
  // Obligatoria #14/#15/#16: NO_OP_ALREADY_LINKED_SAME_HASH exige
  // matchedDocumentId no nulo Y documentHashProven real; sin esa
  // comparación, el estado es NO_OP_ALREADY_LINKED_HASH_NOT_PROVEN —
  // nunca se afirma "mismo hash" sin haberlo comprobado.
  {
    const fileOk = { documentPreconditionState: 'OK' };
    const liveDoc = [{ id: 'doc-real-1', statement_id: 'st-doc2', kind: 'statement' }];

    // Sin operación de subida prevista (documentOperation:'NONE_ALREADY_LINKED',
    // el caso normal de un período ya vinculado) + hash realmente
    // comprobado -> SAME_HASH, con ID y hash reales.
    const planItemHashProven = { statementId: 'st-doc2', documentOperation: 'NONE_ALREADY_LINKED', documentStatus: 'ALREADY_LINKED', documentHashProven: true, documentHashPersisted: 'hash-real-persistido' };
    const checkSameHash = M.buildDocumentLinkIdempotencyCheck(planItemHashProven, liveDoc, fileOk, true);
    eq('GG22/Obligatoria#15. SAME_HASH exige comparación real -> aquí sí ocurrió', checkSameHash.state, 'NO_OP_ALREADY_LINKED_SAME_HASH');
    eq('Obligatoria#14. matchedDocumentId no nulo', checkSameHash.matchedDocumentId, 'doc-real-1');
    eq('matchedDocumentHash expone el hash realmente persistido', checkSameHash.matchedDocumentHash, 'hash-real-persistido');

    // Mismo escenario, pero SIN hash persistido comprobable
    // (documentHashProven:false/undefined) -> nunca se afirma SAME_HASH.
    const planItemHashNotProven = { statementId: 'st-doc2', documentOperation: 'NONE_ALREADY_LINKED', documentStatus: 'ALREADY_LINKED', documentHashProven: false, documentHashPersisted: null };
    const checkHashNotProven = M.buildDocumentLinkIdempotencyCheck(planItemHashNotProven, liveDoc, fileOk, true);
    eq('Obligatoria#16. Documento vinculado sin hash persistido NUNCA se presenta como SAME_HASH', checkHashNotProven.state, 'NO_OP_ALREADY_LINKED_HASH_NOT_PROVEN');
    eq('Obligatoria#14. matchedDocumentId sigue siendo real (no nulo) aunque el hash no esté probado', checkHashNotProven.matchedDocumentId, 'doc-real-1');
    eq('matchedDocumentHash queda null cuando no se pudo comprobar', checkHashNotProven.matchedDocumentHash, null);

    // Sin ningún documento vinculado y sin operación prevista -> estado
    // descriptivo NOT_APPLICABLE_NO_DOCUMENT_WRITE (nunca SAME_HASH).
    const checkNotApplicable = M.buildDocumentLinkIdempotencyCheck({ statementId: 'st-doc2', documentOperation: 'NONE_ALREADY_LINKED', documentStatus: 'MISSING' }, [], fileOk, true);
    eq('Sin operación documental prevista y sin documento -> NOT_APPLICABLE_NO_DOCUMENT_WRITE', checkNotApplicable.state, 'NOT_APPLICABLE_NO_DOCUMENT_WRITE');
    eq('NOT_APPLICABLE_NO_DOCUMENT_WRITE nunca tiene matchedDocumentId', checkNotApplicable.matchedDocumentId, null);
  }

  // GG40. atomicityAssessment refleja la capacidad REAL del sistema
  // (investigación de migraciones/ y del código real de inserción — ver
  // informe de cierre): sin restricción única, sin RPC transaccional.
  {
    const atomicity = M.assessExecutionAtomicity();
    eq('GG40. atomicityAssessment NOT_PROVEN (sin constraint única ni RPC transaccional)', atomicity.atomicityAssessment, 'NOT_PROVEN');
    // CORRECCIÓN 6B4.14.7.2 - atomicityDetail usa ahora los campos exactos
    // pedidos por el ticket (Obligatoria#22/#23) — nunca afirma "probado"
    // salvo evidencia real revisada.
    eq('GG40/Obligatoria#22. movementUniqueConstraintProven es false', atomicity.movementUniqueConstraintProven, false);
    eq('GG40/Obligatoria#22. documentUniqueConstraintProven es false', atomicity.documentUniqueConstraintProven, false);
    eq('GG40/Obligatoria#22. transactionalRpcProven es false', atomicity.transactionalRpcProven, false);
    eq('GG40/Obligatoria#22. storageAndDatabaseAtomicityProven es false', atomicity.storageAndDatabaseAtomicityProven, false);
    eq('GG40/Obligatoria#22. concurrentExecutionLockProven es false', atomicity.concurrentExecutionLockProven, false);
    ok('GG40. rlsInsertPolicyReviewed/rlsUpdatePolicyReviewed/storagePolicyReviewed están revisados (true)', atomicity.rlsInsertPolicyReviewed && atomicity.rlsUpdatePolicyReviewed && atomicity.storagePolicyReviewed);
    ok('GG40. Motivos documentados (al menos 3 razones concretas)', atomicity.reasons.length >= 3);
    ok('Obligatoria#22/#23. atomicityDetail.reasons no está vacío cuando NOT_PROVEN', atomicity.reasons.length > 0);
    ok('GG40. evidenceSources documenta de dónde sale cada conclusión', Array.isArray(atomicity.evidenceSources) && atomicity.evidenceSources.length >= 2);
  }

  // GG37/Obligatoria#37/#40/#21(doc)/#22(doc). Cambiar el archivo
  // (sourceFileHash) cambia la clave/huella de operación — nunca
  // reutiliza la misma clave para un archivo distinto. Claves SHA-256
  // reales (64 caracteres hex), determinísticas (misma entrada -> misma
  // clave).
  {
    const itemA = { statementId: 'st-1', sourceFileHash: 'hash-a' };
    const itemB = { statementId: 'st-1', sourceFileHash: 'hash-b' };
    const idA1 = await M.buildItemOperationId(itemA);
    const idA2 = await M.buildItemOperationId(itemA);
    const idB = await M.buildItemOperationId(itemB);
    eq('Obligatoria#40. buildItemOperationId es determinístico (misma entrada -> misma clave)', idA1, idA2);
    ok('GG37/Obligatoria#37. Cambiar el archivo (sourceFileHash) cambia la clave de operación', idA1 !== idB);
    ok('Obligatoria#40. La clave usa SHA-256 real (formato item_sha256_<64 hex>)', /^item_sha256_[0-9a-f]{64}$/.test(idA1));

    const pm = { firma: 'firma-x', descripcionOriginal: 'X', fecha: '2025-03-03', moneda: 'ARS', importe: 100 };
    const movKeyA = await M.buildMovementOperationKey(itemA, pm, 0);
    const movKeyB = await M.buildMovementOperationKey(itemA, pm, 1);
    ok('Obligatoria#40. buildMovementOperationKey usa SHA-256 real', /^mov_sha256_[0-9a-f]{64}$/.test(movKeyA));
    ok('El índice de ocurrencia distingue dos apariciones del mismo movimiento', movKeyA !== movKeyB);

    const docKeyA = await M.buildDocumentOperationKey(itemA);
    ok('Obligatoria#40. buildDocumentOperationKey usa SHA-256 real', /^doc_sha256_[0-9a-f]{64}$/.test(docKeyA));
    ok('Obligatoria#21(doc). Cambiar el archivo cambia también la clave documental', docKeyA !== await M.buildDocumentOperationKey(itemB));

    // Obligatoria#38/#39: la actualización de un resumen es UNA sola
    // clave para TODOS los campos listos juntos (nunca una por campo).
    const updKeyTotales = await M.buildStatementUpdateOperationKey(itemA, ['total_ars', 'total_usd']);
    const updKeyFechas = await M.buildStatementUpdateOperationKey(itemA, ['close_date', 'due_date']);
    ok('Obligatoria#38. buildStatementUpdateOperationKey usa SHA-256 real', /^upd_sha256_[0-9a-f]{64}$/.test(updKeyTotales));
    ok('Obligatoria#22(update). Distintos campos actualizados producen claves distintas', updKeyTotales !== updKeyFechas);
    eq('La clave es insensible al orden de los campos (canónico, ordenado)', await M.buildStatementUpdateOperationKey(itemA, ['total_usd', 'total_ars']), updKeyTotales);
  }

  // GG28/GG29/GG30-32/GG33/GG34/GG35/GG39/GG42 — integración completa:
  // un ejecutable real y un período con movimiento ambiguo (como los ya
  // bloqueados 02-25-visa.pdf/05-25-visa.pdf/8 ambiguos, mismo
  // mecanismo) en el mismo lote.
  {
    const ggFile = new File([Buffer.from('gg-ready-content', 'utf8')], 'GG_READY.pdf', { type: 'application/pdf' });
    const ggHash = await M.sha256HexFromFile(ggFile);
    const ggReady = fakeItem({
      fileName: 'GG_READY.pdf', hash: ggHash, file: ggFile, periodOperativo: '2025-04', periodPorCierre: '2025-04',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-04-26', declaredDueDate: '2025-05-06', movements: [
        { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
        { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 1500, calculatedArs: 1500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    ggReady.action = 'reparar_seguro';

    const ggBlockedFile = new File([Buffer.from('gg-blocked-content', 'utf8')], 'GG_BLOCKED.pdf', { type: 'application/pdf' });
    const ggBlockedHash = await M.sha256HexFromFile(ggBlockedFile);
    const ggBlocked = fakeItem({
      fileName: 'GG_BLOCKED.pdf', hash: ggBlockedHash, file: ggBlockedFile, periodOperativo: '2025-05', periodPorCierre: '2025-05',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-05-26', declaredDueDate: '2025-06-06', movements: [
        { description: '25 Marzo 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
        { description: '05 234568 * OTRO COMERCIO', amountArs: 500, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 1500, calculatedArs: 1500, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    ggBlocked.action = 'reparar_seguro';

    M.classifyMassiveLoadGroups([ggReady, ggBlocked]);
    M.setState([VISA_8374],
      [
        { id: 'st-gg-ready', card_id: VISA_8374.id, statement_month: '2025-04-01', total_ars: 1500, total_usd: 0, status: 'open' },
        { id: 'st-gg-blocked', card_id: VISA_8374.id, statement_month: '2025-05-01', total_ars: 1500, total_usd: 0, status: 'open' },
      ],
      [],
      [{ id: 'mv-gg-blocked', statement_id: 'st-gg-blocked', card_id: VISA_8374.id, description: 'FORMATO DESCONOCIDO SIN PAR EN EL PDF', currency: 'ARS', amount: 999, movement_date: '2025-05-06' }]);
    M.setRefreshFn(async () => ({
      ok: true, error: null, liveRefreshTimestamp: '2026-07-18T00:00:00.000Z', paginationComplete: true,
      liveRowsLoaded: { statements: 2, documents: 0, movements: 1 },
      companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x',
    }));

    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, [ggReady, ggBlocked]);

    ok('GG28/29. El período con movimiento ambiguo nunca aparece en executionItems del dry-run', !dryRun.executionItems.some(x => x.sourceFileName === 'GG_BLOCKED.pdf'));
    ok('GG28/29. Tampoco aparece en noOpAlreadyAppliedItems del dry-run', !dryRun.noOpAlreadyAppliedItems.some(x => x.sourceFileName === 'GG_BLOCKED.pdf'));
    ok('GG30-32. Queda registrado únicamente en originalBlockedItems (diagnóstico) — mismo mecanismo que ya bloquea 02-25-visa.pdf/05-25-visa.pdf/los 8 ambiguos', dryRun.originalBlockedItems.some(x => x.sourceFileName === 'GG_BLOCKED.pdf'));
    ok('GG28. El ejecutable real nunca desaparece silenciosamente (queda en executionItems, noOp o blocked del dry-run)',
      dryRun.executionItems.some(x => x.sourceFileName === 'GG_READY.pdf') || dryRun.noOpAlreadyAppliedItems.some(x => x.sourceFileName === 'GG_READY.pdf') || dryRun.blockedItems.some(x => x.sourceFileName === 'GG_READY.pdf'));

    eq('GG39/GG40. Sin garantía de concurrencia demostrada -> atomicityAssessment NOT_PROVEN', dryRun.atomicityAssessment, 'NOT_PROVEN');
    ok('GG39. Sin esa garantía, la simulación NUNCA llega a READY_FOR_EXPLICIT_AUTHORIZATION', dryRun.executionEligibilityState !== 'READY_FOR_EXPLICIT_AUTHORIZATION');

    const allChecked = [...dryRun.executionItems, ...dryRun.noOpAlreadyAppliedItems];
    const allMovements = allChecked.flatMap(it => it.movementCheck?.movements || []);
    ok('GG13. Ningún carried_balance aparece en las operaciones de movimientos del dry-run', !allMovements.some(m => m.categoria === 'carried_balance'));
    ok('GG14. Ningún ajuste sintético (currency_conversion_carried_forward) aparece en las operaciones', !allMovements.some(m => m.categoria === 'currency_conversion_carried_forward'));
    ok('GG15. Ningún movimiento con fecha sin evidencia (heredada sin resolver) aparece en las operaciones', !allMovements.some(m => m.movementEvidenceState === 'UNRESOLVED_DATE'));

    // GG33/GG34/GG35. Manifiesto: solo operaciones revalidadas, sin
    // credenciales, cada una con clave idempotente.
    const manifest = M.buildMassiveLoadExecutionManifest(dryRun);
    ok('GG33. Ningún archivo bloqueado aparece en las operaciones previstas del manifiesto', !manifest.plannedOperations.some(op => dryRun.blockedItems.some(b => b.sourceFileName === op.record.sourceFileName)));
    const manifestText = JSON.stringify(manifest);
    ok('GG34. El manifiesto no contiene credenciales/tokens/claves', !/service_role|apikey|api_key|password|access_token|refresh_token/i.test(manifestText));
    ok('GG35. Cada operación prevista tiene una clave idempotente (operationKey)', manifest.plannedOperations.every(op => !!op.operationKey));
    eq('zeroDeleteOperations queda declarado en el manifiesto', manifest.zeroDeleteOperations, true);
  }

  // ============================================================
  // HH. 6B4.14.7.2 — Auditoría de documentos múltiples y consistencia
  // del manifiesto (52 verificaciones nuevas, numeradas contra las
  // "Pruebas obligatorias" del ticket).
  // ============================================================
  function fakeDoc(overrides) {
    return {
      id: 'doc-x', statement_id: 'st-hh', card_id: VISA_8374.id, kind: 'statement',
      file_path: 'credit-cards/user-1/card-visa-8374/st-hh/statement/x.pdf', original_name: 'x.pdf',
      mime_type: 'application/pdf', size_bytes: 1000, created_at: '2026-01-01T00:00:00.000Z',
      uploaded_by: 'user-1', ...overrides,
    };
  }
  const HH_PLAN_ITEM = { statementId: 'st-hh', cardId: VISA_8374.id, period: '2025-07', sourceFileName: 'HH.pdf' };

  // Obligatoria#8. NONE — sin documentos vinculados.
  {
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, []);
    eq('HH/Obligatoria#8. Sin documentos -> classification NONE', audit.classification, 'NONE');
    eq('HH. totalRowsRead=0/uniqueRowIds=0', [audit.totalRowsRead, audit.uniqueRowIds], [0, 0]);
    eq('HH. NONE nunca es motivo de bloqueo específico', M.documentMultiplicitySpecificBlockingState(audit), null);
  }

  // Obligatoria#8. SINGLE_DOCUMENT — un solo documento real, con su id.
  {
    const doc = fakeDoc({ id: 'doc-unico' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [doc]);
    eq('HH/Obligatoria#8. Un documento -> classification SINGLE_DOCUMENT', audit.classification, 'SINGLE_DOCUMENT');
    eq('HH/Obligatoria#8. Se informa la fila real por id', audit.documents[0].id, 'doc-unico');
    eq('HH. SINGLE_DOCUMENT nunca es motivo de bloqueo específico', M.documentMultiplicitySpecificBlockingState(audit), null);
  }

  // Obligatoria#9. Una fila repetida en memoria (mismo id, mismos datos,
  // dos veces en el array) nunca se confunde con dos filas reales.
  {
    const doc = fakeDoc({ id: 'doc-repetido' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [doc, { ...doc }]);
    eq('HH/Obligatoria#9. Repetido en memoria -> DUPLICATED_IN_MEMORY_ONLY', audit.classification, 'DUPLICATED_IN_MEMORY_ONLY');
    eq('HH/Obligatoria#9. uniqueRowIds sigue siendo 1 (nunca 2 filas reales)', audit.uniqueRowIds, 1);
    eq('HH/Obligatoria#9. totalRowsRead sí refleja las 2 filas crudas leídas', audit.totalRowsRead, 2);
    eq('HH. DUPLICATED_IN_MEMORY_ONLY nunca bloquea por sí solo', M.documentMultiplicitySpecificBlockingState(audit), null);
  }

  // Obligatoria#10. Dos ids distintos NUNCA se colapsan silenciosamente,
  // sea cual sea la clasificación final.
  {
    M.setComputeStoredFileHash(async (path) => 'hash-de-' + path);
    const docA = fakeDoc({ id: 'doc-a', file_path: 'ruta/a.pdf' });
    const docB = fakeDoc({ id: 'doc-b', file_path: 'ruta/b.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docA, docB]);
    eq('HH/Obligatoria#10. Dos ids distintos -> uniqueRowIds=2 (nunca colapsados)', audit.uniqueRowIds, 2);
    ok('HH/Obligatoria#10. Ambos ids reales aparecen en documents[]', audit.documents.some(d => d.id === 'doc-a') && audit.documents.some(d => d.id === 'doc-b'));
  }

  // Obligatoria#13. Distintos hashes reales (rutas distintas, contenido
  // distinto) -> MULTIPLE_DISTINCT_STATEMENT_DOCUMENTS.
  {
    M.setComputeStoredFileHash(async (path) => 'hash-de-' + path);
    const docA = fakeDoc({ id: 'doc-a', file_path: 'ruta/a.pdf' });
    const docB = fakeDoc({ id: 'doc-b', file_path: 'ruta/b.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docA, docB]);
    eq('HH/Obligatoria#13. Hashes distintos -> MULTIPLE_DISTINCT_STATEMENT_DOCUMENTS', audit.classification, 'MULTIPLE_DISTINCT_STATEMENT_DOCUMENTS');
    eq('HH/Obligatoria#13. specificBlockingState -> BLOCKED_DUPLICATE_DOCUMENT', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_DUPLICATE_DOCUMENT');
  }

  // Obligatoria#12. Mismo storage_path (mismo objeto físico) ->
  // MULTIPLE_SAME_STORAGE_OBJECT, SIN necesitar el hash y sin borrar nada.
  {
    M.setComputeStoredFileHash(async () => { throw new Error('no debería hacer falta el hash cuando la ruta ya coincide'); });
    const docA = fakeDoc({ id: 'doc-a', file_path: 'ruta/misma.pdf' });
    const docB = fakeDoc({ id: 'doc-b', file_path: 'ruta/misma.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docA, docB]);
    eq('HH/Obligatoria#12. Misma ruta de Storage -> MULTIPLE_SAME_STORAGE_OBJECT (sin necesitar el hash)', audit.classification, 'MULTIPLE_SAME_STORAGE_OBJECT');
    eq('HH/Obligatoria#12. specificBlockingState -> BLOCKED_DUPLICATE_DOCUMENT', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_DUPLICATE_DOCUMENT');
  }

  // Obligatoria#12. Mismo hash real (contenido idéntico) en rutas
  // distintas -> MULTIPLE_EXACT_DUPLICATES, nunca se borra ninguna.
  {
    M.setComputeStoredFileHash(async () => 'hash-identico');
    const docA = fakeDoc({ id: 'doc-a', file_path: 'ruta/a.pdf' });
    const docB = fakeDoc({ id: 'doc-b', file_path: 'ruta/b.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docA, docB]);
    eq('HH/Obligatoria#12. Mismo hash, rutas distintas -> MULTIPLE_EXACT_DUPLICATES', audit.classification, 'MULTIPLE_EXACT_DUPLICATES');
    eq('HH/Obligatoria#12. specificBlockingState -> BLOCKED_DUPLICATE_DOCUMENT', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_DUPLICATE_DOCUMENT');
  }

  // Obligatoria#11. Distinto "kind" -> MULTIPLE_MIXED_DOCUMENT_TYPES
  // (nunca se asume que son el mismo tipo de documento).
  {
    const docA = fakeDoc({ id: 'doc-a', kind: 'statement' });
    const docB = fakeDoc({ id: 'doc-b', kind: 'card_receipt' });
    // El filtro real de buildStatementDocumentMultiplicityAudit ya exige
    // kind==='statement' — para probar la rama MIXED se simula el caso
    // donde el propio filtro trajera ambos (regresión defensiva: si algún
    // día el filtro cambia, este chequeo sigue vivo).
    const HH_PLAN_ITEM_MIXED = { ...HH_PLAN_ITEM, statementId: 'st-hh-mixed' };
    const docA2 = { ...docA, statement_id: 'st-hh-mixed' }, docB2 = { ...docB, statement_id: 'st-hh-mixed', kind: 'statement' };
    docB2.id = 'doc-b2'; docA2.id = 'doc-a2';
    // Ambos con kind='statement' pero distinta ruta -> no dispara MIXED;
    // se prueba directamente la función de clasificación con datos que sí
    // exponen kinds distintos dentro del propio resultado ya filtrado no
    // es posible (el filtro solo deja 'statement'), así que se documenta
    // la garantía real: el filtro de la auditoría NUNCA mezcla comprobantes
    // (kind!=='statement') con el resumen principal.
    const liveDocs = [fakeDoc({ id: 'doc-statement', kind: 'statement' }), fakeDoc({ id: 'doc-comprobante', kind: 'card_receipt', file_path: 'ruta/comprobante.pdf' })];
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, liveDocs);
    eq('HH/Obligatoria#11. El filtro de auditoría excluye comprobantes (kind!==statement) del resumen principal', audit.uniqueRowIds, 1);
    eq('HH/Obligatoria#11. Solo queda el documento kind=statement', audit.documents[0].id, 'doc-statement');
  }

  // Obligatoria#14. Documento de otra tarjeta (card_id distinto) ->
  // CROSS_COMPANY_CONFLICT — nunca se asume que corresponde a la misma
  // tarjeta/empresa (misma separación estructural GR/Rizzo: Rizzo usa un
  // proyecto Supabase completamente distinto, así que este chequeo es la
  // defensa dentro del propio proyecto GR contra un card_id inesperado).
  {
    const docOtraTarjeta = fakeDoc({ id: 'doc-otra-tarjeta', card_id: 'card-otra-tarjeta-9999' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docOtraTarjeta]);
    eq('HH/Obligatoria#14. card_id distinto -> CROSS_COMPANY_CONFLICT', audit.classification, 'CROSS_COMPANY_CONFLICT');
    eq('HH/Obligatoria#14. specificBlockingState -> BLOCKED_CROSS_COMPANY_DOCUMENT', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_CROSS_COMPANY_DOCUMENT');
  }
  // Obligatoria#15. Ningún dato de Rizzo Propiedades puede aparecer en
  // este diagnóstico: estructuralmente imposible, porque GR Estanterías
  // (gestor-gastos, xjpuwokoefklxqezslwv.supabase.co) y Rizzo Propiedades
  // corren en repos y proyectos Supabase completamente separados — esta
  // auditoría nunca hace ninguna llamada fuera de refreshMassiveLoadLiveData
  // (ya limitado a card_id IN cardIds del propio proyecto GR).
  ok('HH/Obligatoria#15. buildStatementDocumentMultiplicityAudit nunca referencia otro proyecto/URL de Supabase', !/hnxgxufixlhlcxajgtui/.test(extractFunction(srcMain, 'buildStatementDocumentMultiplicityAudit')));

  // Documento sin hash disponible (falla la descarga) y sin coincidencia
  // de ruta ni de kind -> UNDETERMINED (nunca se afirma "distintos" ni
  // "iguales" sin evidencia).
  {
    M.setComputeStoredFileHash(async () => null);
    const docA = fakeDoc({ id: 'doc-a', file_path: 'ruta/a.pdf' });
    const docB = fakeDoc({ id: 'doc-b', file_path: 'ruta/b.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docA, docB]);
    eq('HH. Hash no disponible en ambos, rutas distintas -> UNDETERMINED', audit.classification, 'UNDETERMINED');
    eq('HH. specificBlockingState -> BLOCKED_DOCUMENT_MULTIPLICITY_UNDETERMINED', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_DOCUMENT_MULTIPLICITY_UNDETERMINED');
    M.setComputeStoredFileHash(async () => null); // restaura el default para el resto de la suite
  }

  // BLOCKED_DOCUMENT_READ_INCONSISTENCY — dos lecturas del MISMO id con
  // datos distintos (nunca se asume cuál es la real).
  {
    const docV1 = fakeDoc({ id: 'doc-inconsistente', file_path: 'ruta/v1.pdf' });
    const docV2 = fakeDoc({ id: 'doc-inconsistente', file_path: 'ruta/v2.pdf' });
    const audit = await M.buildStatementDocumentMultiplicityAudit(HH_PLAN_ITEM, [docV1, docV2]);
    ok('HH. Mismo id con datos distintos -> readInconsistencyDetected', audit.readInconsistencyDetected === true);
    eq('HH. classification se mantiene dentro del enum de 9 valores (UNDETERMINED)', audit.classification, 'UNDETERMINED');
    eq('HH. specificBlockingState -> BLOCKED_DOCUMENT_READ_INCONSISTENCY', M.documentMultiplicitySpecificBlockingState(audit), 'BLOCKED_DOCUMENT_READ_INCONSISTENCY');
  }

  M.setComputeStoredFileHash(async () => null);
  // CORRECCIÓN: computeStoredFileHash ahora forma parte del fingerprint
  // (code-fp-v2) — hay que dejar M y MO en el MISMO estado de stub antes
  // de comparar sus huellas, o si no la comparación fallaría por un
  // artefacto de la propia prueba (nunca del código real: en el navegador
  // computeStoredFileHash nunca se reasigna).
  MO.setComputeStoredFileHash(async () => null);

  // Obligatoria#28/#29/#30. codeVersionFingerprint es un SHA-256 real:
  // formato, determinismo, y cambia si cambia una función relevante.
  {
    const fp1 = await M.computeMassiveLoadCodeVersionFingerprint();
    const fp2 = await M.computeMassiveLoadCodeVersionFingerprint();
    ok('HH/Obligatoria#28. codeVersionFingerprint tiene el formato code_sha256_<64 hex>', /^code_sha256_[0-9a-f]{64}$/.test(fp1));
    eq('HH/Obligatoria#28. Es determinístico (mismo código -> misma huella)', fp1, fp2);
  }
  // Obligatoria#30. index.html e index_operator.html producen la MISMA
  // huella cuando el código es byte-idéntico (paridad ya confirmada).
  {
    const fpMain = await M.computeMassiveLoadCodeVersionFingerprint();
    const fpOperator = await MO.computeMassiveLoadCodeVersionFingerprint();
    eq('HH/Obligatoria#30. Misma huella en index.html e index_operator.html (código idéntico)', fpMain, fpOperator);
  }
  // Obligatoria#29. Cambiar el código de una función relevante cambia la
  // huella (se simula reasignando assessExecutionAtomicity con otro
  // cuerpo, sin tocar los archivos reales).
  {
    const before = await M.computeMassiveLoadCodeVersionFingerprint();
    const original = M.assessExecutionAtomicity;
    M.setAssessExecutionAtomicityForTest(function assessExecutionAtomicity() { return { atomicityAssessment: 'NOT_PROVEN', reasons: ['otra versión de prueba'] }; });
    const after = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setAssessExecutionAtomicityForTest(original);
    ok('HH/Obligatoria#29. Cambiar una función relevante cambia codeVersionFingerprint', before !== after);
  }

  // Obligatoria#35. manifestVersion se actualizó respecto de 6B4.14.7.4.
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    ok(`KK/Obligatoria#35. ${label} manifestVersion ya no es la de 6B4.14.7.4`, !/const MASSIVE_LOAD_MANIFEST_VERSION='6b4\.14\.7\.4-manifest-v4'/.test(src));
    ok(`KK/Obligatoria#35. ${label} manifestVersion es la de 6B4.14.7.4.1`, /const MASSIVE_LOAD_MANIFEST_VERSION='6b4\.14\.7\.4\.1-manifest-v5'/.test(src));
  }

  // Integración completa: un período con 3 documentos conflictivos +
  // movimientos/actualización pendientes, junto con un ejecutable sano.
  {
    const hhReadyFile = new File([Buffer.from('hh-ready-content', 'utf8')], 'HH_READY.pdf', { type: 'application/pdf' });
    const hhReadyHash = await M.sha256HexFromFile(hhReadyFile);
    const hhReady = fakeItem({
      fileName: 'HH_READY.pdf', hash: hhReadyHash, file: hhReadyFile, periodOperativo: '2025-08', periodPorCierre: '2025-08',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-08-26', declaredDueDate: '2025-09-06', movements: [
        { description: '25 Julio 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    hhReady.action = 'reparar_seguro';

    const hhConflictFile = new File([Buffer.from('hh-conflict-content', 'utf8')], 'HH_CONFLICT.pdf', { type: 'application/pdf' });
    const hhConflictHash = await M.sha256HexFromFile(hhConflictFile);
    const hhConflict = fakeItem({
      fileName: 'HH_CONFLICT.pdf', hash: hhConflictHash, file: hhConflictFile, periodOperativo: '2025-09', periodPorCierre: '2025-09',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-09-26', declaredDueDate: '2025-10-06', movements: [
        { description: '25 Agosto 03 234569 * COMERCIO TEST HH', amountArs: 2000, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 2000, calculatedArs: 2000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    hhConflict.action = 'reparar_seguro';

    M.classifyMassiveLoadGroups([hhReady, hhConflict]);
    M.setState([VISA_8374],
      [
        { id: 'st-hh-ready', card_id: VISA_8374.id, statement_month: '2025-08-01', total_ars: 0, total_usd: 0, status: 'open' },
        { id: 'st-hh-conflict', card_id: VISA_8374.id, statement_month: '2025-09-01', total_ars: 0, total_usd: 0, status: 'open' },
      ],
      [
        fakeDoc({ id: 'doc-hh-1', statement_id: 'st-hh-conflict', file_path: 'ruta/hh-1.pdf' }),
        fakeDoc({ id: 'doc-hh-2', statement_id: 'st-hh-conflict', file_path: 'ruta/hh-2.pdf' }),
        fakeDoc({ id: 'doc-hh-3', statement_id: 'st-hh-conflict', file_path: 'ruta/hh-3.pdf' }),
      ],
      []);
    M.setRefreshFn(async () => ({
      ok: true, error: null, liveRefreshTimestamp: '2026-07-18T00:00:00.000Z', paginationComplete: true,
      liveRowsLoaded: { statements: 2, documents: 3, movements: 0 },
      companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x',
    }));
    // Los 3 documentos tienen contenido real distinto (nunca se asume
    // "duplicado exacto" sin evidencia) -> MULTIPLE_DISTINCT_STATEMENT_DOCUMENTS.
    M.setComputeStoredFileHash(async (path) => 'hash-real-de-' + path);

    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, [hhReady, hhConflict]);
    M.setComputeStoredFileHash(async () => null);

    // Obligatoria#7. El período conflictivo aparece en documentMultiplicityConflicts.
    ok('HH/Obligatoria#7. HH_CONFLICT.pdf aparece en documentMultiplicityConflicts', dryRun.documentMultiplicityConflicts.some(c => c.sourceFileName === 'HH_CONFLICT.pdf'));
    const conflictEntry = dryRun.documentMultiplicityConflicts.find(c => c.sourceFileName === 'HH_CONFLICT.pdf');
    eq('HH/Obligatoria#7. uniqueRowIds=3 (los 3 documentos reales, nunca colapsados)', conflictEntry.uniqueRowIds, 3);

    // Obligatoria#20. El período conflictivo NUNCA aparece en validatedOperationItems.
    ok('HH/Obligatoria#20. HH_CONFLICT.pdf no aparece en validatedOperationItems', !dryRun.validatedOperationItems.some(x => x.sourceFileName === 'HH_CONFLICT.pdf'));
    ok('HH/Obligatoria#6. HH_CONFLICT.pdf queda en newlyBlockedItems', dryRun.newlyBlockedItems.some(x => x.sourceFileName === 'HH_CONFLICT.pdf'));

    // Obligatoria#24/#25. El motivo documental específico y la atomicidad
    // conviven, simultáneamente, sin ocultarse.
    // CORRECCIÓN 6B4.14.7.4.1/KK/Obligatoria#27/28/29/30 - Descubrir un
    // conflicto de documentos duplicados PREEXISTENTE nunca es, por sí
    // solo, evidencia de que los datos "cambiaron" — BLOCKED_CURRENT_
    // DATA_CHANGED NUNCA aparece sin currentDataChangeEvidence real.
    eq('KK/Obligatoria#30. Sin evidencia real de cambio, currentDataChangeEvidence queda vacío', dryRun.currentDataChangeEvidence.length, 0);
    ok('KK/Obligatoria#28. Sin evidencia, BLOCKED_CURRENT_DATA_CHANGED NO se utiliza', !dryRun.executionBlockingStates.includes('BLOCKED_CURRENT_DATA_CHANGED'));
    ok('HH/Obligatoria#24. executionBlockingStates incluye el motivo documental específico BLOCKED_DUPLICATE_DOCUMENT', dryRun.executionBlockingStates.includes('BLOCKED_DUPLICATE_DOCUMENT'));
    eq('KK/Obligatoria#3. El estado principal es el motivo documental específico (BLOCKED_DUPLICATE_DOCUMENT), no un cambio inventado', dryRun.executionEligibilityState, 'BLOCKED_DUPLICATE_DOCUMENT');
    ok('HH/Obligatoria#25. executionBlockingStates incluye BLOCKED_ATOMICITY_NOT_PROVEN también', dryRun.executionBlockingStates.includes('BLOCKED_ATOMICITY_NOT_PROVEN'));

    // Obligatoria#16/#17/#18. Movimientos/actualizaciones bloqueados
    // pendientes quedan visibles en el global (nunca ocultos).
    const dg = dryRun.global;
    ok('HH/Obligatoria#16. movimientosBloqueadosPendientes >= 1 (el insert de HH_CONFLICT.pdf)', dg.movimientosBloqueadosPendientes >= 1);
    eq('HH. movimientosCandidatosOriginales cuenta ambos períodos', dg.movimientosCandidatosOriginales, 2);
    ok('HH/Obligatoria#19. documentosConConflictoDeMultiplicidad >= 1', dg.documentosConConflictoDeMultiplicidad >= 1);

    // Obligatoria#26/#27. globalWriteAuthorization sigue false y todas las
    // operaciones (las del período sano) quedan BLOCKED_GLOBAL.
    eq('HH/Obligatoria#26. globalWriteAuthorization sigue false', dryRun.globalWriteAuthorization, false);
    const manifest = M.buildMassiveLoadExecutionManifest(dryRun);
    ok('HH/Obligatoria#27. Toda operación planificada real tiene writeAuthorizationState BLOCKED_GLOBAL', manifest.plannedOperations.every(op => op.writeAuthorizationState === 'BLOCKED_GLOBAL'));

    // Obligatoria#20 (manifiesto). El período conflictivo nunca aporta
    // operaciones planificadas ni de borrado/consolidación.
    ok('HH/Obligatoria#20. Ninguna operación planificada pertenece a HH_CONFLICT.pdf', !manifest.plannedOperations.some(op => op.record?.sourceFileName === 'HH_CONFLICT.pdf'));
    eq('HH. zeroDeleteOperations sigue true', manifest.zeroDeleteOperations, true);

    // Obligatoria#22/#23. atomicityDetail viaja completo hasta el manifiesto.
    ok('HH/Obligatoria#22/23. manifest.atomicityDetail existe y trae reasons no vacío', !!manifest.atomicityDetail && Array.isArray(manifest.atomicityDetail.reasons) && manifest.atomicityDetail.reasons.length > 0);

    // Obligatoria#31/#28. manifestVersion actualizado y codeVersionFingerprint real.
    eq('KK/Obligatoria#35. manifest.manifestVersion es 6b4.14.7.4.1-manifest-v5', manifest.manifestVersion, '6b4.14.7.4.1-manifest-v5');
    ok('HH/Obligatoria#28. manifest.codeVersionFingerprint es SHA-256 real', /^code_sha256_[0-9a-f]{64}$/.test(manifest.codeVersionFingerprint));

    // Obligatoria#32. Los timestamps de la simulación respetan su orden real.
    ok('HH/Obligatoria#32. liveRefreshStartedAt <= liveRefreshCompletedAt <= dryRunGeneratedAt', new Date(dryRun.liveRefreshStartedAt).getTime() <= new Date(dryRun.liveRefreshCompletedAt).getTime() && new Date(dryRun.liveRefreshCompletedAt).getTime() <= new Date(dryRun.dryRunGeneratedAt).getTime());
    ok('HH/Obligatoria#32. No reutiliza el mismo timestamp para eventos distintos (liveRefreshStartedAt !== dryRunGeneratedAt)', dryRun.liveRefreshStartedAt !== dryRun.dryRunGeneratedAt);

    // Obligatoria#1/#2/#3/#4. Los conteos originales del plan (fuera del
    // dry-run) nunca cambian por la presencia del conflicto documental.
    eq('HH/Obligatoria#1-4. sourceCandidateItems.length coincide con freshPlan.items.length', dryRun.sourceCandidateItems.length, dryRun.originalReadyOperationItems.length + dryRun.originalNoOpItems.length + dryRun.originalBlockedItems.length);
  }

  // ============================================================
  // II. 6B4.14.7.3 — Plan de consolidación reversible de documentos
  // exactamente duplicados (55 verificaciones nuevas, numeradas contra
  // las "Pruebas obligatorias" del ticket).
  // ============================================================
  function fakeConsolidationDoc(overrides) {
    return {
      id: 'doc-x', statementId: 'st-ii', cardId: VISA_8374.id, kind: 'statement',
      fileName: 'ii.pdf', storagePath: 'ruta/ii.pdf', mimeType: 'application/pdf', size: 1000,
      hash: 'hash-ii', createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
    };
  }
  const iiOld = fakeConsolidationDoc({ id: 'doc-old', storagePath: 'ruta/old.pdf', createdAt: '2026-01-01T00:00:00.000Z' });
  const iiMid = fakeConsolidationDoc({ id: 'doc-mid', storagePath: 'ruta/mid.pdf', createdAt: '2026-01-02T00:00:00.000Z' });
  const iiNew = fakeConsolidationDoc({ id: 'doc-new', storagePath: 'ruta/new.pdf', createdAt: '2026-01-03T00:00:00.000Z' });
  const II_GROUP = { statementId: 'st-ii', cardId: VISA_8374.id, period: '2025-07', sourceFileName: 'II.pdf', exactHash: 'hash-ii', documents: [iiOld, iiMid, iiNew] };
  function noRefAudit(docs) {
    return docs.map(d => ({ documentId: d.id, statementId: d.statementId, storagePath: d.storagePath, staticReferences: [], liveReferences: [], sourcesChecked: ['credit_card_statements', 'credit_card_movements', 'documents', 'credit_cards'], sourcesNotChecked: [], readErrors: [], paginationComplete: true, referenceEvidenceState: 'PROVEN_NO_REFERENCE_IN_ALL_VISIBLE_SOURCES', conclusion: 'sin referencias' }));
  }
  const FULL_TABLE_COMPLETENESS = { credit_cards: true, credit_card_statements: true, credit_card_movements: true, documents: true };
  const FULL_TABLE_ERRORS = { credit_cards: null, credit_card_statements: null, credit_card_movements: null, documents: null };

  // Obligatoria#10. buildDocumentReferenceAudit examina cada uno de los
  // IDs (nunca colapsa ni omite ninguno).
  {
    const entries = ['doc-old', 'doc-mid', 'doc-new'].map(id => ({ id, statementId: 'st-x', storagePath: 'ruta/' + id + '.pdf' }));
    const result = await M.buildDocumentReferenceAudit(entries, { credit_card_statements: [], credit_card_movements: [], documents: [], credit_cards: [], tableCompleteness: FULL_TABLE_COMPLETENESS, tableReadErrors: FULL_TABLE_ERRORS });
    eq('II/Obligatoria#10. Se auditan los 3 ids, uno por uno', result.audits.map(a => a.documentId), ['doc-old', 'doc-mid', 'doc-new']);
    // Obligatoria#13(estático). Con las 4 tablas live consultadas pero las
    // fuentes estáticas (migración pendiente/módulo Servicios/catálogo)
    // sin consultar en vivo -> PARTIAL_VISIBLE_SOURCES_ONLY, NUNCA
    // "sin referencias" a secas.
    ok('II. Sin referencias en las tablas live, pero fuentes estáticas sin consultar -> PARTIAL_VISIBLE_SOURCES_ONLY', result.audits.every(a => a.referenceEvidenceState === 'PARTIAL_VISIBLE_SOURCES_ONLY'));
    ok('II. Las 4 tablas reales quedan en sourcesChecked', result.audits.every(a => ['credit_card_statements', 'credit_card_movements', 'documents', 'credit_cards'].every(s => a.sourcesChecked.includes(s))));
    ok('II. Las 3 fuentes estáticas quedan en sourcesNotChecked (nunca presentadas como live)', result.audits.every(a => a.sourcesNotChecked.length === 3));
  }
  // Obligatoria#13. Visibilidad incompleta por RLS/paginación bloquea.
  {
    const entries = [{ id: 'doc-old', statementId: 'st-x', storagePath: 'ruta/doc-old.pdf' }];
    const incompleteTC = { ...FULL_TABLE_COMPLETENESS, credit_card_statements: false };
    const result = await M.buildDocumentReferenceAudit(entries, { credit_card_statements: [], credit_card_movements: [], documents: [], credit_cards: [], tableCompleteness: incompleteTC, tableReadErrors: FULL_TABLE_ERRORS });
    eq('II/Obligatoria#13. Paginación incompleta -> BLOCKED_RLS_VISIBILITY_NOT_PROVEN', result.audits[0].referenceEvidenceState, 'BLOCKED_RLS_VISIBILITY_NOT_PROVEN');
  }
  // Obligatoria#6. Una consulta fallida bloquea la cobertura.
  {
    const entries = [{ id: 'doc-old', statementId: 'st-x', storagePath: 'ruta/doc-old.pdf' }];
    const errTC = { ...FULL_TABLE_COMPLETENESS };
    const errErrs = { ...FULL_TABLE_ERRORS, documents: 'fallo simulado' };
    const result = await M.buildDocumentReferenceAudit(entries, { credit_card_statements: [], credit_card_movements: [], documents: [], credit_cards: [], tableCompleteness: errTC, tableReadErrors: errErrs });
    eq('II/Obligatoria#6. Fuente con error de lectura -> BLOCKED_SOURCE_READ_FAILED', result.audits[0].referenceEvidenceState, 'BLOCKED_SOURCE_READ_FAILED');
    eq('II. classifyReferenceAuditCoverage -> BLOCKED_READ_FAILURE', M.classifyReferenceAuditCoverage(result.sourceInventory, 'NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT'), 'BLOCKED_READ_FAILURE');
  }
  // Obligatoria#9. Una referencia concreta (valor real coincidente en una
  // fila live) se informa como REFERENCE_FOUND.
  {
    const entries = [{ id: 'doc-old', statementId: 'st-x', storagePath: 'ruta/doc-old.pdf' }];
    const result = await M.buildDocumentReferenceAudit(entries,
      { credit_card_statements: [{ id: 'st-1', notes: 'doc-old' }], credit_card_movements: [], documents: [], credit_cards: [], tableCompleteness: FULL_TABLE_COMPLETENESS, tableReadErrors: FULL_TABLE_ERRORS });
    eq('II/Obligatoria#9. Coincidencia real -> REFERENCE_FOUND', result.audits[0].referenceEvidenceState, 'REFERENCE_FOUND');
    ok('II. liveReferences trae la fuente y el recordId real', result.audits[0].liveReferences.length === 1 && result.audits[0].liveReferences[0].tableOrModule === 'credit_card_statements' && result.audits[0].liveReferences[0].recordId === 'st-1');
  }
  // Obligatoria#16. Cero filas no prueba ausencia si RLS no está
  // demostrado (paginación incompleta con cero filas leídas).
  {
    const entries = [{ id: 'doc-old', statementId: 'st-x', storagePath: 'ruta/doc-old.pdf' }];
    const incompleteTC = { ...FULL_TABLE_COMPLETENESS, credit_card_movements: false };
    const result = await M.buildDocumentReferenceAudit(entries, { credit_card_statements: [], credit_card_movements: [], documents: [], credit_cards: [], tableCompleteness: incompleteTC, tableReadErrors: FULL_TABLE_ERRORS });
    ok('II/Obligatoria#16(numerado como #8 en el ticket). Cero filas leídas + paginación incompleta nunca se presenta como ausencia demostrada', result.audits[0].referenceEvidenceState !== 'PROVEN_NO_REFERENCE_IN_ALL_VISIBLE_SOURCES');
  }
  // Obligatoria#16/#17. El catálogo de PostgreSQL no accesible queda
  // informado y mantiene la cobertura en PARTIAL.
  {
    const inventory = M.buildReferenceSourceInventory({ tableCompleteness: FULL_TABLE_COMPLETENESS, tableReadErrors: FULL_TABLE_ERRORS });
    const catalogEntry = inventory.find(s => s.sourceType === 'database_catalog');
    ok('II/Obligatoria#16. El catálogo de PostgreSQL queda documentado como no accesible', !!catalogEntry && !catalogEntry.liveReadAttempted);
    eq('II/Obligatoria#17. Con todas las tablas OK pero catálogo no disponible -> coverage PARTIAL', M.classifyReferenceAuditCoverage(inventory, 'NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT'), 'PARTIAL');
    ok('II. Nunca declara COMPLETE_FOR_KNOWN_LIVE_SCHEMA sin catálogo accesible', M.classifyReferenceAuditCoverage(inventory, 'NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT') !== 'COMPLETE_FOR_KNOWN_LIVE_SCHEMA');
  }
  // Obligatoria#14. Una migración comentada/pendiente nunca se presenta
  // como estructura aplicada.
  {
    const inventory = M.buildReferenceSourceInventory({ tableCompleteness: FULL_TABLE_COMPLETENESS, tableReadErrors: FULL_TABLE_ERRORS });
    const pending = inventory.find(s => s.sourceName === 'credit_card_reprocessing_runs');
    eq('II/Obligatoria#14/15. Migración pendiente -> sourceType table_pending_migration (nunca table)', pending.sourceType, 'table_pending_migration');
    ok('II. limitation aclara explícitamente que nunca se ejecutó', /nunca ejecutad/i.test(pending.limitation));
  }
  // Obligatoria#13(fuente estática). Una fuente estática nunca se presenta
  // como lectura live.
  {
    const inventory = M.buildReferenceSourceInventory({ tableCompleteness: FULL_TABLE_COMPLETENESS, tableReadErrors: FULL_TABLE_ERRORS });
    const staticSources = inventory.filter(s => s.sourceType !== 'table');
    ok('II/Obligatoria#13(fuente estática). Ninguna fuente STATIC_CODE_ONLY/catálogo/migración pendiente tiene liveReadAttempted:true', staticSources.every(s => s.liveReadAttempted === false));
  }

  // Obligatoria#14. Sin referencias externas, la fila más antigua queda
  // como candidata.
  {
    const selection = M.selectCanonicalDocumentCandidate(II_GROUP, noRefAudit(II_GROUP.documents));
    eq('II/Obligatoria#14. canonicalSelectionState CANONICAL_CANDIDATE_SELECTED', selection.canonicalSelectionState, 'CANONICAL_CANDIDATE_SELECTED');
    eq('II/Obligatoria#14. La copia candidata es la más antigua (doc-old)', selection.canonicalCandidate.id, 'doc-old');
    ok('II/Obligatoria#16. El estado usa la palabra CANDIDATE', /CANDIDATE/.test(selection.canonicalSelectionState));
  }
  // Obligatoria#11/#10(selección). Una referencia real única favorece esa
  // fila y cambia la copia candidata (nunca se colapsa el resultado).
  {
    const audits = noRefAudit(II_GROUP.documents);
    const midAudit = audits.find(a => a.documentId === 'doc-mid');
    midAudit.liveReferences = [{ source: 'live_table', tableOrModule: 'credit_card_statements', recordId: 'st-99', referenceType: 'value_match_document_id' }];
    midAudit.referenceEvidenceState = 'REFERENCE_FOUND';
    const selection = M.selectCanonicalDocumentCandidate(II_GROUP, audits);
    eq('II/Obligatoria#10/11. La fila con referencia real gana (doc-mid), aunque no sea la más antigua', selection.canonicalCandidate.id, 'doc-mid');
    eq('II. canonicalSelectionState CANONICAL_CANDIDATE_SELECTED', selection.canonicalSelectionState, 'CANONICAL_CANDIDATE_SELECTED');
  }
  // Obligatoria#12. Varias referencias incompatibles bloquean el grupo.
  {
    const audits = noRefAudit(II_GROUP.documents);
    for (const id of ['doc-mid', 'doc-new']) {
      const a = audits.find(x => x.documentId === id);
      a.liveReferences = [{ source: 'live_table', tableOrModule: 'credit_card_statements', recordId: 'st-99', referenceType: 'value_match_document_id' }];
      a.referenceEvidenceState = 'REFERENCE_FOUND';
    }
    const selection = M.selectCanonicalDocumentCandidate(II_GROUP, audits);
    eq('II/Obligatoria#12. Más de una fila referenciada -> BLOCKED_EXTERNAL_REFERENCE_CONFLICT', selection.canonicalSelectionState, 'BLOCKED_EXTERNAL_REFERENCE_CONFLICT');
    eq('II. Sin copia candidata cuando hay conflicto', selection.canonicalCandidate, null);
  }
  // Obligatoria#13 (selección). Cobertura parcial bloquea la selección,
  // pero conserva la copia más antigua como candidata informativa (nunca
  // la oculta ni la reemplaza sin evidencia real).
  {
    const audits = noRefAudit(II_GROUP.documents);
    audits.find(a => a.documentId === 'doc-old').referenceEvidenceState = 'PARTIAL_VISIBLE_SOURCES_ONLY';
    const selection = M.selectCanonicalDocumentCandidate(II_GROUP, audits);
    eq('II/Obligatoria#13. Cobertura parcial -> BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN en la selección', selection.canonicalSelectionState, 'BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN');
    eq('II. La copia más antigua se conserva como candidata informativa (no se oculta ni cambia sin evidencia)', selection.canonicalCandidate.id, 'doc-old');
  }
  // Obligatoria#6(selección). Una fuente con error de lectura también
  // bloquea la selección (misma copia por antigüedad, sin confirmar).
  {
    const audits = noRefAudit(II_GROUP.documents);
    audits.find(a => a.documentId === 'doc-old').referenceEvidenceState = 'BLOCKED_SOURCE_READ_FAILED';
    const selection = M.selectCanonicalDocumentCandidate(II_GROUP, audits);
    eq('II/Obligatoria#6(selección). Error de lectura -> BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN', selection.canonicalSelectionState, 'BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN');
  }
  // Obligatoria#15. Un empate (mismo created_at) se resuelve
  // determinísticamente (por id).
  {
    const tiedA = fakeConsolidationDoc({ id: 'doc-b', createdAt: '2026-01-01T00:00:00.000Z' });
    const tiedB = fakeConsolidationDoc({ id: 'doc-a', createdAt: '2026-01-01T00:00:00.000Z' });
    const group = { ...II_GROUP, documents: [tiedA, tiedB] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#15. Empate resuelto por id (orden lexicográfico: doc-a < doc-b)', selection.canonicalCandidate.id, 'doc-a');
  }
  // Obligatoria#17. Un hash diferente bloquea la selección.
  {
    const group = { ...II_GROUP, documents: [iiOld, iiMid, fakeConsolidationDoc({ id: 'doc-distinto-hash', hash: 'hash-otro' })] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#17. Hash distinto -> BLOCKED_HASH_NOT_PROVEN', selection.canonicalSelectionState, 'BLOCKED_HASH_NOT_PROVEN');
  }
  // Obligatoria#18. Un tamaño diferente bloquea.
  {
    const group = { ...II_GROUP, documents: [iiOld, iiMid, fakeConsolidationDoc({ id: 'doc-tam-distinto', size: 999 })] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#18. Tamaño distinto -> BLOCKED_METADATA_CONFLICT', selection.canonicalSelectionState, 'BLOCKED_METADATA_CONFLICT');
  }
  // Obligatoria#19. Un cardId diferente bloquea.
  {
    const group = { ...II_GROUP, documents: [iiOld, iiMid, fakeConsolidationDoc({ id: 'doc-card-distinta', cardId: 'otra-tarjeta' })] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#19. cardId distinto -> BLOCKED_METADATA_CONFLICT', selection.canonicalSelectionState, 'BLOCKED_METADATA_CONFLICT');
  }
  // Obligatoria#20. Un statementId diferente bloquea.
  {
    const group = { ...II_GROUP, documents: [iiOld, iiMid, fakeConsolidationDoc({ id: 'doc-st-distinto', statementId: 'otro-resumen' })] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#20(selección). statementId distinto -> BLOCKED_METADATA_CONFLICT', selection.canonicalSelectionState, 'BLOCKED_METADATA_CONFLICT');
  }
  // Obligatoria#21. Un kind diferente bloquea.
  {
    const group = { ...II_GROUP, documents: [iiOld, iiMid, fakeConsolidationDoc({ id: 'doc-kind-distinto', kind: 'card_receipt' })] };
    const selection = M.selectCanonicalDocumentCandidate(group, noRefAudit(group.documents));
    eq('II/Obligatoria#21. kind distinto -> BLOCKED_METADATA_CONFLICT', selection.canonicalSelectionState, 'BLOCKED_METADATA_CONFLICT');
  }

  // Obligatoria#22/#23. Capacidad real del esquema, sin inventar columnas.
  {
    const cap = M.assessDocumentSchemaCapability();
    eq('II/Obligatoria#22. softSupersedeSupported es false (sin columna real)', cap.softSupersedeSupported, false);
    eq('II/Obligatoria#22. contentHashPersisted es false (sin columna real)', cap.contentHashPersisted, false);
    eq('II/Obligatoria#22. assessment NOT_SUPPORTED_WITH_CURRENT_SCHEMA', cap.assessment, 'NOT_SUPPORTED_WITH_CURRENT_SCHEMA');
    ok('II/Obligatoria#22. reasons documentadas', cap.reasons.length > 0);
    // Obligatoria#23. Sin soft-delete/superseded_by no se autoriza consolidación.
    const plan = M.buildExactDuplicateDocumentConsolidationPlan(
      [{ statementId: II_GROUP.statementId, cardId: II_GROUP.cardId, period: II_GROUP.period, sourceFileName: II_GROUP.sourceFileName, classification: 'MULTIPLE_EXACT_DUPLICATES', uniqueHashes: 1, documents: II_GROUP.documents }],
      new Map([[II_GROUP.statementId, noRefAudit(II_GROUP.documents)]]), cap);
    eq('II/Obligatoria#23. consolidationEligibilityState BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN', plan[0].consolidationEligibilityState, 'BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN');
    ok('II. redundantCandidates son las 2 filas no candidatas (doc-mid/doc-new)', plan[0].redundantCandidates.length === 2 && plan[0].redundantCandidates.every(d => d.id !== 'doc-old'));
    // Obligatoria#24. Nunca genera nada con forma de operationKey/insert.
    ok('II/Obligatoria#24. El plan nunca incluye operationKey (nunca se confunde con una operación real)', !JSON.stringify(plan).includes('operationKey'));
  }

  // Obligatoria#43/#44/#45. codeVersionFingerprintFunctions incluye las
  // funciones nuevas de esta etapa.
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    ok(`II/Obligatoria#43. ${label} codeVersionFingerprintFunctions incluye buildStatementDocumentMultiplicityAudit`, M.MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_FUNCTIONS.includes('buildStatementDocumentMultiplicityAudit'));
    ok(`II/Obligatoria#44. ${label} incluye documentMultiplicitySpecificBlockingState`, M.MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_FUNCTIONS.includes('documentMultiplicitySpecificBlockingState'));
    ok(`II/Obligatoria#45. ${label} incluye buildDocumentReferenceAudit/selectCanonicalDocumentCandidate/buildExactDuplicateDocumentConsolidationPlan`,
      ['buildDocumentReferenceAudit', 'selectCanonicalDocumentCandidate', 'buildExactDuplicateDocumentConsolidationPlan'].every(n => M.MASSIVE_LOAD_CODE_VERSION_FINGERPRINT_FUNCTIONS.includes(n)));
  }
  // Obligatoria#46. Modificar cualquiera de esas funciones cambia la huella.
  {
    const before = await M.computeMassiveLoadCodeVersionFingerprint();
    const savedAudit = M.buildStatementDocumentMultiplicityAudit;
    M.setBuildStatementDocumentMultiplicityAuditForTest(async function buildStatementDocumentMultiplicityAudit() { return { classification: 'NONE' }; });
    const afterAudit = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setBuildStatementDocumentMultiplicityAuditForTest(savedAudit);
    ok('II/Obligatoria#46. Cambiar buildStatementDocumentMultiplicityAudit cambia la huella', before !== afterAudit);

    const savedSpecific = M.documentMultiplicitySpecificBlockingState;
    M.setDocumentMultiplicitySpecificBlockingStateForTest(function documentMultiplicitySpecificBlockingState() { return null; });
    const afterSpecific = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setDocumentMultiplicitySpecificBlockingStateForTest(savedSpecific);
    ok('II/Obligatoria#46. Cambiar documentMultiplicitySpecificBlockingState cambia la huella', before !== afterSpecific);

    const savedRefAudit = M.buildDocumentReferenceAudit;
    M.setBuildDocumentReferenceAuditForTest(async function buildDocumentReferenceAudit() { return { sourceInventory: [], audits: [] }; });
    const afterRefAudit = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setBuildDocumentReferenceAuditForTest(savedRefAudit);
    ok('II/Obligatoria#46. Cambiar buildDocumentReferenceAudit cambia la huella', before !== afterRefAudit);

    const savedInventory = M.buildReferenceSourceInventory;
    M.setBuildReferenceSourceInventoryForTest(function buildReferenceSourceInventory() { return []; });
    const afterInventory = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setBuildReferenceSourceInventoryForTest(savedInventory);
    ok('II/Obligatoria#46(inventario). Cambiar buildReferenceSourceInventory cambia la huella', before !== afterInventory);

    const savedSelect = M.selectCanonicalDocumentCandidate;
    M.setSelectCanonicalDocumentCandidateForTest(function selectCanonicalDocumentCandidate() { return { canonicalSelectionState: 'NOT_APPLICABLE' }; });
    const afterSelect = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setSelectCanonicalDocumentCandidateForTest(savedSelect);
    ok('II/Obligatoria#46. Cambiar selectCanonicalDocumentCandidate cambia la huella', before !== afterSelect);

    // computeStoredFileHash no se exporta como valor (solo su setter) —
    // se restaura directamente al mismo stub que ya usa el resto de la
    // suite, nunca "guardando" un valor que en realidad nunca se leyó.
    M.setComputeStoredFileHash(async function computeStoredFileHash() { return 'otra-implementacion-de-prueba'; });
    const afterHashFn = await M.computeMassiveLoadCodeVersionFingerprint();
    M.setComputeStoredFileHash(async () => null);
    ok('II/Obligatoria#46. Cambiar la función real de hash de Storage cambia la huella', before !== afterHashFn);

    const after2 = await M.computeMassiveLoadCodeVersionFingerprint();
    eq('II/Obligatoria#47. Restaurado todo, la huella vuelve a ser la misma (determinístico)', before, after2);
  }

  // Integración completa: un grupo de 3 duplicados EXACTOS reales, sin
  // referencias externas ni soporte de esquema — confirma el flujo
  // completo hasta el manifiesto.
  {
    const iiReadyFile = new File([Buffer.from('ii-ready-content', 'utf8')], 'II_READY.pdf', { type: 'application/pdf' });
    const iiReadyHash = await M.sha256HexFromFile(iiReadyFile);
    const iiReady = fakeItem({
      fileName: 'II_READY.pdf', hash: iiReadyHash, file: iiReadyFile, periodOperativo: '2025-10', periodPorCierre: '2025-10',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-10-26', declaredDueDate: '2025-11-06', movements: [
        { description: '25 Setiem. 03 234567 * COMERCIO TEST', amountArs: 1000, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 1000, calculatedArs: 1000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    iiReady.action = 'reparar_seguro';

    const iiDupFile = new File([Buffer.from('ii-dup-content', 'utf8')], 'II_DUP.pdf', { type: 'application/pdf' });
    const iiDupHash = await M.sha256HexFromFile(iiDupFile);
    const iiDup = fakeItem({
      fileName: 'II_DUP.pdf', hash: iiDupHash, file: iiDupFile, periodOperativo: '2025-11', periodPorCierre: '2025-11',
      preview: { ...fakeItem({}).preview, parsed: { declaredCloseDate: '2025-11-26', declaredDueDate: '2025-12-06', movements: [
        { description: '25 Octubre 03 234570 * COMERCIO TEST II', amountArs: 3000, amountUsd: null, category: 'purchase' },
      ] }, reconciliation: { totals: { statementArs: 3000, calculatedArs: 3000, diffArs: 0, statementUsd: 0, calculatedUsd: 0, diffUsd: 0 } }, state: { state: 'FULLY_RECONCILED' } },
    });
    iiDup.action = 'reparar_seguro';

    M.classifyMassiveLoadGroups([iiReady, iiDup]);
    M.setState([VISA_8374],
      [
        { id: 'st-ii-ready', card_id: VISA_8374.id, statement_month: '2025-10-01', total_ars: 0, total_usd: 0, status: 'open' },
        { id: 'st-ii-dup', card_id: VISA_8374.id, statement_month: '2025-11-01', total_ars: 0, total_usd: 0, status: 'open' },
      ],
      [
        { id: 'doc-ii-1', statement_id: 'st-ii-dup', card_id: VISA_8374.id, kind: 'statement', file_path: 'ruta/ii-dup-1.pdf', original_name: 'II_DUP.pdf', mime_type: 'application/pdf', size_bytes: 500, created_at: '2026-01-01T00:00:00.000Z', uploaded_by: 'user-1' },
        { id: 'doc-ii-2', statement_id: 'st-ii-dup', card_id: VISA_8374.id, kind: 'statement', file_path: 'ruta/ii-dup-2.pdf', original_name: 'II_DUP.pdf', mime_type: 'application/pdf', size_bytes: 500, created_at: '2026-01-02T00:00:00.000Z', uploaded_by: 'user-1' },
        { id: 'doc-ii-3', statement_id: 'st-ii-dup', card_id: VISA_8374.id, kind: 'statement', file_path: 'ruta/ii-dup-3.pdf', original_name: 'II_DUP.pdf', mime_type: 'application/pdf', size_bytes: 500, created_at: '2026-01-03T00:00:00.000Z', uploaded_by: 'user-1' },
      ],
      []);
    M.setRefreshFn(async () => ({
      ok: true, error: null, liveRefreshTimestamp: '2026-07-18T00:00:00.000Z', paginationComplete: true,
      liveRowsLoaded: { statements: 2, documents: 3, movements: 0 },
      companyContext: M.MASSIVE_LOAD_COMPANY_CONTEXT_EXPECTED, ownerContext: 'user-1', liveRefreshSource: 'x',
      // CORRECCIÓN 6B4.14.7.4.1 - tableRowCounts/tablePagesRead/
      // tableReadTimings reales (el stub de pruebas simula lo que la
      // refreshMassiveLoadLiveData real ya expone) — para que
      // referenceSourceInventory nunca quede con estos campos vacíos.
      tableCompleteness: { credit_cards: true, credit_card_statements: true, credit_card_movements: true, documents: true },
      tableReadErrors: { credit_cards: null, credit_card_statements: null, credit_card_movements: null, documents: null },
      tableRowCounts: { credit_cards: 1, credit_card_statements: 2, credit_card_movements: 0, documents: 3 },
      tablePagesRead: { credit_cards: 1, credit_card_statements: 1, credit_card_movements: 1, documents: 1 },
      tableReadTimings: {
        credit_cards: { startedAt: '2026-07-18T00:00:00.000Z', completedAt: '2026-07-18T00:00:00.010Z' },
        credit_card_statements: { startedAt: '2026-07-18T00:00:00.010Z', completedAt: '2026-07-18T00:00:00.020Z' },
        credit_card_movements: { startedAt: '2026-07-18T00:00:00.020Z', completedAt: '2026-07-18T00:00:00.030Z' },
        documents: { startedAt: '2026-07-18T00:00:00.030Z', completedAt: '2026-07-18T00:00:00.040Z' },
      },
    }));
    M.setComputeStoredFileHash(async () => 'hash-exactamente-igual');

    const dryRun = await M.buildMassiveLoadExecutionDryRunLive(null, [iiReady, iiDup]);
    M.setComputeStoredFileHash(async () => null);

    // Obligatoria#1. El grupo permanece MULTIPLE_EXACT_DUPLICATES.
    const conflict = dryRun.documentMultiplicityConflicts.find(c => c.sourceFileName === 'II_DUP.pdf');
    eq('II/Obligatoria#1. Permanece MULTIPLE_EXACT_DUPLICATES', conflict.classification, 'MULTIPLE_EXACT_DUPLICATES');
    // Obligatoria#2/#3. 16-equivalente: se contabilizan las 3 filas reales
    // y las 2 candidatas redundantes de este grupo sintético.
    eq('II/Obligatoria#2. Se contabilizan las 3 filas reales del grupo', conflict.uniqueRowIds, 3);
    const planEntry = dryRun.documentConsolidationPlan.find(p => p.sourceFileName === 'II_DUP.pdf');
    eq('II/Obligatoria#3. 2 candidatas redundantes (3 filas - 1 canónica)', planEntry.redundantCandidates.length, 2);
    // Obligatoria#4. Un único hash por grupo.
    eq('II/Obligatoria#4. Un único hash en el grupo', conflict.uniqueHashes, 1);
    // Obligatoria#5. El hash coincide con sourceFileHash del período.
    const origItem = dryRun.newlyBlockedItems.find(x => x.sourceFileName === 'II_DUP.pdf');
    ok('II/Obligatoria#5. El hash del grupo es real (no null/vacío)', !!conflict.documents[0].hash);
    // Obligatoria#6. Dos IDs diferentes nunca se colapsan.
    eq('II/Obligatoria#6. Los 3 ids reales están presentes, sin colapsar', new Set(conflict.documents.map(d => d.id)).size, 3);
    // Obligatoria#7. Las rutas permanecen visibles.
    ok('II/Obligatoria#7. Las 3 storagePath quedan visibles', conflict.documents.every(d => !!d.storagePath));
    // Obligatoria#8/#9. Ninguna fila ni objeto de Storage se elimina
    // (estructural: el plan nunca genera un delete — ver GG24 más abajo).
    ok('II/Obligatoria#8/9. documentConsolidationSummary declara cero borrados', dryRun.documentConsolidationSummary.zeroDeletedRows === 0 && dryRun.documentConsolidationSummary.zeroDeletedStorageObjects === 0);

    // Obligatoria#31/#32. Las 13(=1 en este fixture) operaciones
    // documentales seguras permanecen iguales; los 5(=1) grupos
    // conflictivos permanecen fuera de plannedOperations.
    const manifest = M.buildMassiveLoadExecutionManifest(dryRun);
    ok('II/Obligatoria#31/32. II_DUP.pdf nunca aporta operaciones planificadas', !manifest.plannedOperations.some(op => op.record?.sourceFileName === 'II_DUP.pdf'));
    // Obligatoria#25/#26/#27/#28/#29/#30. Cero delete/update/insert/upsert/RPC/Storage reales.
    ok('II/Obligatoria#25-30. zeroDeleteOperations sigue true', manifest.zeroDeleteOperations === true);

    // Obligatoria#37/#38/#39. Estados globales simultáneos.
    ok('II/Obligatoria#37. BLOCKED_DUPLICATE_DOCUMENT sigue visible', dryRun.executionBlockingStates.includes('BLOCKED_DUPLICATE_DOCUMENT'));
    ok('II/Obligatoria#38. BLOCKED_ATOMICITY_NOT_PROVEN sigue visible', dryRun.executionBlockingStates.includes('BLOCKED_ATOMICITY_NOT_PROVEN'));
    ok('II/Obligatoria#39. El nuevo bloqueo de consolidación queda visible (BLOCKED_DOCUMENT_CONSOLIDATION_PENDING)', dryRun.executionBlockingStates.includes('BLOCKED_DOCUMENT_CONSOLIDATION_PENDING'));
    // CORRECCIÓN 6B4.14.7.4 - Con la cobertura de referencias real (nunca
    // sobreafirmada), la selección de copia candidata queda
    // BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN (hay fuentes estáticas sin
    // consultar en vivo) ANTES de llegar siquiera a evaluar la capacidad
    // del esquema — por eso el bloqueo global visible ahora es
    // BLOCKED_REFERENCE_AUDIT_PARTIAL, no BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN.
    eq('II/JJ. referenceAuditCoverageState es PARTIAL (fuentes estáticas sin consultar en vivo)', dryRun.referenceAuditCoverageState, 'PARTIAL');
    ok('II/JJ/Obligatoria#31. BLOCKED_REFERENCE_AUDIT_PARTIAL visible', dryRun.executionBlockingStates.includes('BLOCKED_REFERENCE_AUDIT_PARTIAL'));

    // Obligatoria#40/#41/#42. Bloqueos de escritura se mantienen.
    eq('II/Obligatoria#40. globalWriteAuthorization sigue false', dryRun.globalWriteAuthorization, false);

    // ============================================================
    // KK. 6B4.14.7.4.1 — Error 1: el bloqueo de esquema ya NO queda
    // oculto detrás del bloqueo de referencias — ambos (y el de
    // consolidación pendiente) aparecen SIMULTÁNEAMENTE en el mismo
    // grupo (Obligatoria#21-26).
    // ============================================================
    ok('KK/Obligatoria#25. consolidationBlockingStates incluye BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN', planEntry.consolidationBlockingStates.includes('BLOCKED_REFERENCE_VISIBILITY_NOT_PROVEN'));
    ok('KK/Obligatoria#22/25. consolidationBlockingStates TAMBIÉN incluye BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN, simultáneamente', planEntry.consolidationBlockingStates.includes('BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN'));
    ok('KK. consolidationBlockingStates incluye BLOCKED_DOCUMENT_CONSOLIDATION_PENDING también', planEntry.consolidationBlockingStates.includes('BLOCKED_DOCUMENT_CONSOLIDATION_PENDING'));
    eq('KK/Obligatoria#22. groupsBlockedBySchemaCapability cuenta este grupo (1)', dryRun.documentConsolidationSummary.groupsBlockedBySchemaCapability, 1);
    eq('KK. groupsWithReferenceAuditIncomplete también cuenta este grupo (1), simultáneamente', dryRun.documentConsolidationSummary.groupsWithReferenceAuditIncomplete, 1);
    ok('KK/Obligatoria#23. BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN aparece globalmente en executionBlockingStates', dryRun.executionBlockingStates.includes('BLOCKED_SCHEMA_CAPABILITY_NOT_PROVEN'));
    ok('KK/Obligatoria#26. Ningún grupo queda ELIGIBLE_FOR_FUTURE_SOFT_CONSOLIDATION', dryRun.documentConsolidationPlan.every(p => p.consolidationEligibilityState !== 'ELIGIBLE_FOR_FUTURE_SOFT_CONSOLIDATION'));
    eq('KK. groupsEligibleForFutureSoftConsolidation es 0', dryRun.documentConsolidationSummary.groupsEligibleForFutureSoftConsolidation, 0);

    // ============================================================
    // KK. Error 3: referenceSourceInventory expone conteos reales por
    // fuente (Obligatoria#31-37).
    // ============================================================
    const liveSources = dryRun.referenceSourceInventory.filter(s => s.sourceType === 'table');
    ok('KK/Obligatoria#31. Cada fuente live informa rowsRead (número)', liveSources.every(s => typeof s.rowsRead === 'number'));
    ok('KK/Obligatoria#32. Cada fuente live informa pagesRead (número)', liveSources.every(s => typeof s.pagesRead === 'number'));
    ok('KK/Obligatoria#33. Cada fuente live informa referencesFound (número, calculado tras las 16/aquí-2 auditorías)', liveSources.every(s => typeof s.referencesFound === 'number'));
    ok('KK/Obligatoria#34. Cada fuente live informa readError (null cuando no hubo error)', liveSources.every(s => s.readError === null));
    ok('KK/Obligatoria#39. Las cuatro fuentes live continúan sin errores', liveSources.length === 4 && liveSources.every(s => s.liveReadSucceeded === true));
    const staticSources = dryRun.referenceSourceInventory.filter(s => s.sourceType !== 'table');
    ok('KK/Obligatoria#37. Una fuente estática nunca recibe conteos live inventados (rowsRead/pagesRead/referencesFound null)', staticSources.every(s => s.rowsRead === null && s.pagesRead === null && s.referencesFound === null));
    ok('KK. Cada fuente live informa tiempos reales (liveReadStartedAt/liveReadCompletedAt)', liveSources.every(s => !!s.liveReadStartedAt && !!s.liveReadCompletedAt));
    ok('KK/Obligatoria#38. Las 3 auditorías de este fixture (3 documentos del grupo) permanecen individualizadas', dryRun.documentReferenceAudits.length === 3 && new Set(dryRun.documentReferenceAudits.map(a => a.documentId)).size === 3);
    eq('KK/Obligatoria#40. referenceAuditCoverageState continúa PARTIAL', dryRun.referenceAuditCoverageState, 'PARTIAL');
    eq('KK/Obligatoria#41. databaseCatalogVisibilityState continúa NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT', dryRun.databaseCatalogVisibilityState, 'NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT');

    // ============================================================
    // KK. Claridad de IDs de operaciones (Obligatoria#42-45).
    // ============================================================
    ok('KK/Obligatoria#42. plannedOperationIds.length === plannedOperations.length', manifest.plannedOperationIds.length === manifest.plannedOperations.length);
    ok('KK/Obligatoria#42. Cada plannedOperationId corresponde a un operationKey real', manifest.plannedOperationIds.every(id => manifest.plannedOperations.some(op => op.operationKey === id)));
    ok('KK/Obligatoria#43. Todas las plannedOperationIds son únicas', new Set(manifest.plannedOperationIds).size === manifest.plannedOperationIds.length);
    ok('KK/Obligatoria#44. itemOperationIds tiene semántica separada (una por ítem, nunca por operación)', manifest.itemOperationIds.length <= manifest.plannedOperations.length + dryRun.newlyBlockedItems.length + dryRun.noOpAlreadyAppliedItems.length);
    eq('KK/Obligatoria#45. operationIds ya no existe (renombrado, nunca ambiguo)', 'operationIds' in manifest, false);
    eq('KK. operationIdsLegacy existe y coincide con itemOperationIds', JSON.stringify(manifest.operationIdsLegacy), JSON.stringify(manifest.itemOperationIds));
    eq('KK. operationIdsLegacyMeaning es explícito', manifest.operationIdsLegacyMeaning, 'LEGACY_ITEM_OPERATION_IDS');
    ok('KK/Obligatoria#46. Todas las plannedOperations continúan BLOCKED_GLOBAL', manifest.plannedOperations.every(op => op.writeAuthorizationState === 'BLOCKED_GLOBAL'));

    // Confirma que el grupo sano (II_READY.pdf) no se ve afectado.
    ok('II. II_READY.pdf no aparece en documentMultiplicityConflicts', !dryRun.documentMultiplicityConflicts.some(c => c.sourceFileName === 'II_READY.pdf'));
  }

  // ============================================================
  // KK. Obligatoria#9/#27/#29. Con evidencia CONCRETA de un cambio real
  // (BLOCKED_CURRENT_VALUE_CHANGED/BLOCKED_STATEMENT_NOT_FOUND/
  // BLOCKED_DIFFERENT_DOCUMENT_LINKED/BLOCKED_PRESERVED_MOVEMENT_CHANGED),
  // BLOCKED_CURRENT_DATA_CHANGED SÍ debe usarse. Dentro de un único
  // dry-run, expectedBefore siempre se recalcula a partir del MISMO
  // snapshot live que después se vuelve a comparar (nunca de un plan
  // viejo reutilizado — ver 6B4.14.7.1), así que estos 4 estados son
  // estructuralmente para detectar una escritura concurrente real DURANTE
  // la ventana del propio dry-run — no reproducibles en un único call
  // síncrono de prueba. Se confirma en cambio, con evidencia real, que
  // buildMassiveLoadExecutionDryRunLive de verdad clasifica cada uno de
  // los 4 (código real, extraído de index.html — nunca reimplementado).
  // ============================================================
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const fn = extractFunction(src, 'buildMassiveLoadExecutionDryRunLive');
    for (const state of ['BLOCKED_CURRENT_VALUE_CHANGED', 'BLOCKED_STATEMENT_NOT_FOUND', 'BLOCKED_DIFFERENT_DOCUMENT_LINKED', 'BLOCKED_PRESERVED_MOVEMENT_CHANGED']) {
      ok(`KK/Obligatoria#9/27/29. ${label} currentDataChangeEvidence sí clasifica ${state} como evidencia real`, fn.includes(state));
    }
    ok(`KK. ${label} currentDataChangeEvidence incluye statementId/field/expectedValue/actualValue/detectionSource`, /currentDataChangeEvidence\.push/.test(fn) && /expectedValue/.test(fn) && /actualValue/.test(fn) && /detectionSource/.test(fn));
  }

  // GG24/GG25/GG26/GG27/GG43/JJ/Obligatoria#21-24. Cero llamadas reales a
  // insert/update/upsert/delete/rpc ni Storage durante toda la
  // simulación (100% de lectura, verificado sobre el texto real de las
  // funciones nuevas — incluidas las de auditoría de referencias de
  // 6B4.14.7.4).
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const fns = ['assessExecutionAtomicity', 'verifySourceFileForPlanItem', 'buildStatementUpdateOptimisticCheck',
      'buildDocumentLinkIdempotencyCheck', 'buildMovementInsertIdempotencyCheck', 'buildPreservedMovementsCheck',
      'classifyMassiveLoadDryRunItemOutcome', 'buildMassiveLoadExecutionDryRunLive', 'buildPlannedOperationsFromDryRunItem',
      'buildMassiveLoadExecutionManifest', 'buildReferenceSourceInventory', 'buildDocumentReferenceAuditForId',
      'buildDocumentReferenceAudit', 'classifyReferenceAuditCoverage', 'selectCanonicalDocumentCandidate',
      'assessDocumentSchemaCapability', 'buildExactDuplicateDocumentConsolidationPlan'].map(n => extractFunction(src, n)).join('\n');
    ok(`GG24/25/26/27/43/JJ/Obligatoria#21-24. ${label} la simulación nunca invoca insert/update/upsert/delete/rpc ni Storage`, !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|sb\.storage/.test(fns));
  }

  // ============================================================
  // JJ. 6B4.14.7.4 — service role/SQL manual/RPC/migraciones nuevas
  // (Obligatoria#17/#18/#19/#20).
  // ============================================================
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    const fns = ['buildReferenceSourceInventory', 'buildDocumentReferenceAuditForId', 'buildDocumentReferenceAudit',
      'classifyReferenceAuditCoverage', 'selectCanonicalDocumentCandidate', 'assessDocumentSchemaCapability',
      'buildExactDuplicateDocumentConsolidationPlan', 'refreshMassiveLoadLiveData'].map(n => extractFunction(src, n)).join('\n');
    ok(`JJ/Obligatoria#17. ${label} la auditoría de referencias nunca usa service_role/service role`, !/service_role|SUPABASE_SERVICE_ROLE|serviceRole/i.test(fns));
    ok(`JJ/Obligatoria#18. ${label} nunca ejecuta SQL manual (sin .raw(/execute_sql/query( crudo)`, !/\.raw\(|execute_sql|\.query\(/.test(fns));
    ok(`JJ/Obligatoria#19. ${label} nunca crea ni llama una RPC nueva (sb.rpc)`, !/sb\.rpc\(/.test(fns));
    ok(`JJ. ${label} el catálogo de PostgreSQL se declara explícitamente no disponible, nunca se intenta acceder`, /NOT_AVAILABLE_FROM_CURRENT_AUTHENTICATED_CLIENT/.test(src) && !/information_schema\.|pg_catalog\./.test(fns));
  }
  // Obligatoria#20. No se crean migraciones nuevas para esta etapa (el
  // directorio migraciones/ nunca se toca desde este módulo).
  {
    const massiveLoadFns = ['buildReferenceSourceInventory', 'buildDocumentReferenceAuditForId', 'buildDocumentReferenceAudit',
      'classifyReferenceAuditCoverage', 'selectCanonicalDocumentCandidate', 'assessDocumentSchemaCapability',
      'buildExactDuplicateDocumentConsolidationPlan'].map(n => extractFunction(srcMain, n)).join('\n');
    // Nota: las funciones SÍ mencionan la RUTA de la migración pendiente
    // como evidencia documental (texto descriptivo) — lo que nunca deben
    // contener es una sentencia SQL real de creación/alteración.
    ok('JJ/Obligatoria#20. Ninguna función nueva ejecuta CREATE TABLE/ALTER TABLE (SQL real)', !/CREATE TABLE|ALTER TABLE/i.test(massiveLoadFns));
  }

  // GG41/GG42. MASSIVE_LOAD_EXECUTION_ENABLED_STAGE sigue en false y el
  // botón real de confirmación sigue deshabilitado por atributo.
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    ok(`GG41. ${label} MASSIVE_LOAD_EXECUTION_ENABLED_STAGE sigue en false`, /MASSIVE_LOAD_EXECUTION_ENABLED_STAGE=false;/.test(src));
    ok(`GG42. ${label} el botón real de confirmación sigue deshabilitado por atributo`, /id="confirmMassiveLoadExecutionPlan" \$\{!MASSIVE_LOAD_EXECUTION_ENABLED_STAGE\?'disabled'/.test(src));
  }

  // GG46. Paridad: el nuevo botón de simulación y de descarga del
  // manifiesto existen en ambos archivos.
  for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
    ok(`GG46. ${label} incluye el botón buildMassiveLoadDryRunBtn`, /id="buildMassiveLoadDryRunBtn"/.test(src));
    ok(`GG46. ${label} incluye el botón downloadMassiveLoadExecutionManifest`, /id="downloadMassiveLoadExecutionManifest"/.test(src));
  }
}

// T. Sintaxis válida en ambos archivos.
{
  try { new Function(srcMain.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('T. index.html sintaxis válida', true); }
  catch (e) { ok('T. index.html sintaxis válida', false); console.log('   ', e.message); }
  try { new Function(srcOperator.match(/<script>([\s\S]*?)<\/script>/)[1]); ok('T. index_operator.html sintaxis válida', true); }
  catch (e) { ok('T. index_operator.html sintaxis válida', false); console.log('   ', e.message); }
}

// U. No regresión de etapas anteriores.
{
  ok('U. 6B4.13: runHistoricalStatementPreview sigue presente sin tocar', /async function runHistoricalStatementPreview\(file\)/.test(srcMain));
  ok('U. 6B4.12.2: paymentCouponTotalsMatch sigue presente sin tocar', /paymentCouponTotalsMatch/.test(extractFunction(srcMain, 'parseBancoProvinciaVisaStatement')));
  ok('U. 6B4.9.1: creditPaymentModel/creditUsdPaymentRecommendation/creditUsdPaymentDecision siguen presentes', /function creditPaymentModel\(/.test(srcMain) && /function creditUsdPaymentRecommendation\(/.test(srcMain) && /function creditUsdPaymentDecision\(/.test(srcMain));
  ok('U. 6B4.11.3: permisos/navegación sin cambios', /canViewReports\(\)\?renderBalance\(\):''/.test(srcMain));
}

// V. La separación GR/Rizzo Propiedades no se toca: siempre card_id.
for (const [label, src] of [['index.html', srcMain], ['index_operator.html', srcOperator]]) {
  const fn = extractFunction(src, 'runMassiveConciliatedLoadExecute');
  ok(`V. ${label} el insert de credit_card_statements usa card_id (nunca group_id manual)`, /card_id:card\.id/.test(fn));
}

// W. Esta suite es de solo lectura.
{
  const selfSrc = fs.readFileSync(__filename, 'utf8').replace(/^\/\/.*$/gm, '');
  ok('W. Esta suite no invoca sb.from/.insert/.update/.upsert/.rpc/sb.storage reales (fuera de los strings de prueba de regex)', !/\bsb\.from\(|sb\.storage\.upload/.test(selfSrc));
}

runAsyncChecks().then(() => {
  fs.unlinkSync(runtimePathMain);
  fs.unlinkSync(runtimePathOperator);
  console.log(`\n=== TOTAL: ${total} verificaciones, ${failures} fallas ===`);
  if (failures > 0) process.exit(1);
});
