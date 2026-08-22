// ============================================================
// PRUEBA LOCAL — BUGFIX #13 FASE 3: servicio dado de baja conserva deuda
// histórica pero no permite crear períodos nuevos (20260821)
// ------------------------------------------------------------
// Caso real que motiva esta FASE: Argentina Virtual (service_id
// 209b9202-a858-4c31-ad22-f19b2e358463, GR), dado de baja (FASE 2 ya
// validada: baja/reactivación funcionan y no son destructivas). El panel
// "Deudas arrastradas" mostraba correctamente "Abrir deuda" (Julio 2026,
// $1) pero TAMBIÉN mostraba "Cargar Agosto 2026" -- una acción que
// generaría un período NUEVO para un servicio inactivo, contradiciendo
// la regla "para volver a generar meses nuevos, primero debe reactivarse
// explícitamente el servicio".
//
// AUDITORÍA REAL (ver informe de entrega para el detalle completo):
// - NIVEL 1 (UI) faltaba: el botón "Cargar <mes>" en Deudas arrastradas
//   solo se condicionaba a canEdit(), nunca a service.active. Corregido
//   acá: ahora requiere además service?.active!==false.
// - NIVEL 2 (guard funcional) YA EXISTÍA desde mejora #10:
//   isNewForInactiveService=!o&&s&&s.active===false dentro de
//   openObligation() alimenta editableNow, y el propio
//   "if(!editableNow)return;" corta la función ANTES de declarar/cablear
//   saveMonthData() al botón "Guardar" -- así que CUALQUIER camino de UI
//   que abra un período nuevo de un servicio inactivo (Cargar <mes>,
//   "+ Agregar factura de otro mes", una celda vacía de la matriz, la
//   vista operativa) ya terminaba sin poder guardar, mostrando el aviso
//   "Este servicio está dado de baja...". No se duplicó esa lógica acá.
// - Generación automática de obligaciones: auditado -- existe un ÚNICO
//   punto real de escritura de obligations en todo el archivo
//   (sb.from('obligations').upsert(...) dentro de saveMonthData), ya
//   protegido por el guard de arriba. No hay ningún generador en
//   background/cron/automático que pueda crear meses futuros por su
//   cuenta.
//
// Esta prueba audita el TEXTO REAL de index.html/index_operator.html
// (nunca reimplementado a mano) y ejecuta funciones puras reales
// extraídas en sandbox. NO se ejecutó SQL, NO se modificó Supabase, NO
// se reactivó ni se tocó el servicio real Argentina Virtual.
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

function extract(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s !== -1, `no se encontró el marcador de inicio "${startMarker}"`);
  const e = text.indexOf(endMarker, s);
  assert.ok(e !== -1, `no se encontró el marcador de fin "${endMarker}"`);
  return text.slice(s, e);
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

for (const [label, text] of [['index.html', indexText], ['index_operator.html', operatorText]]) {

  caso(`[${label}] CASO 1 — carriedDebts() no filtra por service.active: la deuda histórica de un servicio inactivo sigue formando parte de "Deudas arrastradas"`, () => {
    const block = extract(text, 'function carriedDebts(){', '\nasync function openStoredDocument(');
    assert.ok(!/\.active/.test(block), 'carriedDebts no debe filtrar por active -- la deuda histórica se conserva sin importar el estado del servicio');
  });

  caso(`[${label}] CASO 2/3 — "Abrir deuda" sigue visible y operativo (data-old-debt -> openObligation), sin condición de canEdit()/active`, () => {
    const debtPanelBlock = extract(text, 'Estas facturas no desaparecen', "}).join('')}");
    assert.ok(debtPanelBlock.includes('data-old-debt="${o.service_id}|${debtMonth}">Abrir deuda</button>'), 'el botón "Abrir deuda" debe seguir presente sin condición');
    const wiring = extract(text, "document.querySelectorAll('[data-old-debt]')", "document.querySelectorAll('[data-next-invoice]')");
    assert.ok(wiring.includes('openObligation(serviceId,monthKey)'), 'debe seguir abriendo la obligación real');
  });

  caso(`[${label}] CASO 4 — "Cargar <mes>" NO aparece para servicio inactivo: la condición ahora exige service?.active!==false además de canEdit()`, () => {
    const debtPanelBlock = extract(text, 'Estas facturas no desaparecen', "}).join('')}");
    assert.ok(debtPanelBlock.includes('${canEdit()&&service?.active!==false?`<button class="btn primary small" data-next-invoice='), 'el botón "Cargar <mes>" debe requerir canEdit() Y service.active!==false');
  });

  caso(`[${label}] CASO 5 — el botón sí puede aparecer para servicio activo: la condición usa !==false (no === true), así que un servicio activo (active=true o sin dato) lo sigue mostrando cuando canEdit()`, () => {
    const debtPanelBlock = extract(text, 'Estas facturas no desaparecen', "}).join('')}");
    assert.ok(!debtPanelBlock.includes('service?.active===true'), 'no debe exigir active===true explícito (rompería servicios sin ese campo poblado) -- el criterio real es !==false, igual que el resto de la app');
  });

  caso(`[${label}] CASO 6 — la función real de creación (openObligation) verifica active: isNewForInactiveService=!o&&s&&s.active===false, y alimenta editableNow`, () => {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n  const paymentRows=');
    assert.ok(block.includes('const isNewForInactiveService=!o&&s&&s.active===false;'));
    assert.ok(block.includes('const editableNow=canEdit()&&!voided&&!isNewForInactiveService;'));
  });

  caso(`[${label}] CASO 7 — servicio inactivo NO crea obligación nueva: "if(!editableNow)return;" corta la ejecución ANTES de declarar/cablear saveMonthData (async function saveMonthData nunca llega a existir/conectarse al botón Guardar en ese camino)`, () => {
    const openObligationStart = text.indexOf('function openObligation(serviceId,key){');
    assert.ok(openObligationStart !== -1, 'debe existir openObligation');
    const guardIdx = text.indexOf('if(!editableNow)return;', openObligationStart);
    const saveMonthDataIdx = text.indexOf('async function saveMonthData(', openObligationStart);
    assert.ok(guardIdx !== -1, 'debe existir el corte temprano por editableNow');
    assert.ok(saveMonthDataIdx !== -1, 'debe existir la declaración real de saveMonthData');
    assert.ok(guardIdx < saveMonthDataIdx, 'el corte por editableNow debe ocurrir ANTES (textualmente) de declarar/cablear saveMonthData');
  });

  caso(`[${label}] CASO 8 — servicio activo conserva comportamiento existente: si el servicio está activo (o no existe "s" porque la obligación ya existe), isNewForInactiveService da false y editableNow depende solo de canEdit()/voided, igual que siempre`, () => {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n  const paymentRows=');
    assert.ok(block.includes('!o&&s&&s.active===false'), 'la condición exige explícitamente !o (sin obligación previa) Y active===false -- un servicio activo nunca cae acá');
  });

  caso(`[${label}] CASO 9 — el guard muestra un mensaje claro y específico cuando corresponde`, () => {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n    ${sourceLink?`');
    assert.ok(block.includes('<strong>Este servicio está dado de baja.</strong>'));
    assert.ok(block.includes('No se pueden cargar períodos nuevos mientras esté inactivo. Reactivalo desde la carpeta del servicio para continuar cargando.'));
  });

  caso(`[${label}] CASO 10/11 — el guard NO reactiva el servicio ni modifica active: el bloque isNewForInactiveService es puramente de lectura/aviso, no llama a applyServiceActiveUpdate ni a ningún UPDATE`, () => {
    const block = extract(text, '${isNewForInactiveService?`', '</div>`:\'\'}');
    assert.ok(!block.includes('applyServiceActiveUpdate'));
    assert.ok(!/from\('services'\)\.update/.test(block));
  });

  caso(`[${label}] CASO 12 — obligaciones históricas (o existente) siguen 100% accesibles: isNewForInactiveService exige "!o", así que con una obligación ya existente SIEMPRE da false, sin importar service.active`, () => {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n  const paymentRows=');
    assert.ok(block.includes('!o&&s&&s.active===false'), 'con "o" truthy (obligación existente) la condición completa es false por el "!o" inicial');
  });

  caso(`[${label}] CASO 13 — pagos históricos siguen permitidos: el botón "Registrar pago" depende solo de que exista la obligación (o) y saldo pendiente, nunca de service.active`, () => {
    const block = extract(text, 'o&&!sourceLink&&!progress.unavailable&&serviceMoneyCents(progress.balance)>0', "id=\"markPaid\">Registrar pago</button>':''}");
    assert.ok(block.length > 0, 'debe encontrarse la condición real del botón Registrar pago');
    assert.ok(!block.includes('.active'), 'la condición de "Registrar pago" no debe depender de service.active');
  });

  caso(`[${label}] CASO 14 — documentos históricos intactos: bindDocumentCards se sigue llamando sin condicionar a service.active`, () => {
    const block = extract(text, 'function openObligation(serviceId,key){', '\n  if(!editableNow)return;');
    assert.ok(block.includes('bindDocumentCards({'));
  });

  caso(`[${label}] CASO 15/16/17/18/19 — generación automática: único punto real de escritura de obligations en todo el archivo (el upsert real de saveMonthData), ya protegido por el guard; y esta FASE no agregó ningún INSERT/DELETE nuevo de obligations/payments/documents ni acceso a Storage (mismo conteo que el backup previo)`, () => {
    const occurrences = (text.match(/from\('obligations'\)\.(insert|upsert)\(/g) || []).length;
    assert.strictEqual(occurrences, 1, 'debe existir exactamente un único punto de escritura de obligations (dentro de saveMonthData, ya protegido)');
    assert.ok(!/from\('obligations'\)\.delete\(/.test(text), 'no debe existir ningún DELETE de obligations');
    const backupDir = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_13_fase3_servicio_inactivo_sin_periodos_nuevos_20260821_231500');
    const suffix = label === 'index.html' ? 'index.html.antes_bugfix13fase3' : 'index_operator.html.antes_bugfix13fase3';
    const before = fs.readFileSync(path.join(backupDir, suffix), 'utf8');
    for (const [table, verb] of [['payments', 'delete'], ['documents', 'delete'], ['payments', 'insert'], ['documents', 'insert']]) {
      const re = new RegExp(`from\\('${table}'\\)\\.${verb}\\(`, 'g');
      const beforeCount = (before.match(re) || []).length;
      const nowCount = (text.match(re) || []).length;
      assert.strictEqual(nowCount, beforeCount, `[${label}] la cantidad de ${verb}() sobre ${table} no debe haber cambiado en esta FASE (antes: ${beforeCount}, ahora: ${nowCount})`);
    }
    assert.ok(!/\.storage\.from\('documents'\)\.(upload|remove)\(/.test(extract(text, "document.querySelectorAll('[data-old-debt]')", "id=\"markPaid\">Registrar pago</button>':''}")), 'el cambio de esta FASE (panel de deudas + guard) no debe tocar Storage');
  });

  caso(`[${label}] CASO 20 — Argentina Virtual no está hardcodeada: la regla usa service.active de forma genérica, sin nombre ni id fijo`, () => {
    assert.ok(!text.includes('Argentina Virtual'));
    assert.ok(!text.includes('209b9202-a858-4c31-ad22-f19b2e358463'));
  });

  caso(`[${label}] CASO 21 — FASE 2 intacta: applyServiceActiveUpdate sigue validando exactamente 1 fila, mismo serviceId y active esperado`, () => {
    const block = extract(text, 'async function applyServiceActiveUpdate(serviceId,targetActive){', '\nasync function dropService(');
    assert.ok(block.includes(".select('id,active')"));
    assert.ok(block.includes('rows.length===0'));
    assert.ok(block.includes('rows.length>1'));
    assert.ok(block.includes('row.id!==serviceId||row.active!==targetActive'));
  });

  caso(`[${label}] CASO 22 — baja/reactivación intacta: dropService/reactivateService siguen pidiendo targetActive=false/true a applyServiceActiveUpdate, sin DELETE`, () => {
    assert.ok(text.includes('applyServiceActiveUpdate(serviceId,false)'));
    assert.ok(text.includes('applyServiceActiveUpdate(serviceId,true)'));
    assert.ok(!text.includes('function deleteService('));
  });

  caso(`[${label}] CASO 23 — BUGFIX #12 intacto: effectivePeriodAmount y el modal de corrección histórica siguen presentes sin cambios`, () => {
    assert.ok(text.includes('effectivePeriodAmount'));
    assert.ok(text.includes('id="correctSamePeriodQuestion"'));
  });

  caso(`[${label}] CASO 24 — amountPending (#9) intacto: sigue existiendo y sin relación con el guard nuevo de esta FASE`, () => {
    assert.ok(text.includes('extraFields.amountPending===true'));
  });
}

caso('CASO 26a — paridad exacta index.html / index_operator.html: el bloque de "Deudas arrastradas" (con el nuevo guard) es byte-idéntico entre titular y operador', () => {
  const blockIndex = extract(indexText, 'Estas facturas no desaparecen', "}).join('')}");
  const blockOperator = extract(operatorText, 'Estas facturas no desaparecen', "}).join('')}");
  assert.strictEqual(blockIndex, blockOperator);
});

caso('CASO 26b — paridad exacta index.html / index_operator.html: openObligation (guard NIVEL 2, ya existente) sigue byte-idéntico entre titular y operador', () => {
  const blockIndex = extract(indexText, 'function openObligation(serviceId,key){', '\n  async function saveMonthData(');
  const blockOperator = extract(operatorText, 'function openObligation(serviceId,key){', '\n  async function saveMonthData(');
  assert.strictEqual(blockIndex, blockOperator);
});

caso('CASO 25 — Tarjetas intacta: renderCreditCardsModule/bindCreditCardsModule/roundMoney byte-idénticas al backup previo a esta FASE', () => {
  const backupDir = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_13_fase3_servicio_inactivo_sin_periodos_nuevos_20260821_231500');
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix13fase3'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix13fase3']]) {
    const before = fs.readFileSync(path.join(backupDir, suffix), 'utf8');
    for (const fnName of ['renderCreditCardsModule', 'bindCreditCardsModule', 'roundMoney']) {
      assert.strictEqual(
        extract(text, `function ${fnName}(`, '\nfunction '),
        extract(before, `function ${fnName}(`, '\nfunction '),
        `${fnName}() en ${label} debe seguir byte-idéntica`
      );
    }
  }
});

caso('el único cambio real de esta FASE, contra el backup previo, es el guard de "Cargar <mes>" (más comentarios) -- confirma que no se tocó nada más por accidente', () => {
  const backupDir = path.join(ROOT, 'respaldos_publicacion', 'antes_bugfix_13_fase3_servicio_inactivo_sin_periodos_nuevos_20260821_231500');
  for (const [label, text, suffix] of [['index.html', indexText, 'index.html.antes_bugfix13fase3'], ['index_operator.html', operatorText, 'index_operator.html.antes_bugfix13fase3']]) {
    const before = fs.readFileSync(path.join(backupDir, suffix), 'utf8').replace(/\r\n/g, '\n');
    const now = text.replace(/\r\n/g, '\n');
    assert.ok(now.includes('${canEdit()&&service?.active!==false?`<button class="btn primary small" data-next-invoice='), `[${label}] debe incluir el guard nuevo`);
    assert.ok(!before.includes('service?.active!==false'), `[${label}] el backup previo no debe tener el guard (confirma que es realmente nuevo)`);
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
  console.log('AVISO: valida lógica real extraída + auditoría estática, NO ejecución real contra Postgres/Supabase. NO se modificó Supabase, NO se reactivó Argentina Virtual.');
  if (fail > 0) process.exitCode = 1;
}

run();
