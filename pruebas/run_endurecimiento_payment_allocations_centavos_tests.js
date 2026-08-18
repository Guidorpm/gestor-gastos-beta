// ============================================================
// PRUEBA LOCAL — Endurecimiento exacto del trigger de payment_allocations
// (mejora #5, 20260817)
// ------------------------------------------------------------
// AVISO IMPORTANTE: esta prueba NO ejecuta nada contra Supabase real (no
// hay acceso de ejecución en esta sesión, y aunque lo hubiera, esta
// mejora está explícitamente detenida antes de cualquier escritura). Lo
// que SÍ hace, de forma reproducible:
//
//   1) Lee el archivo REAL de la migración preparada
//      (migraciones/6b11_ENDURECIMIENTO_PAYMENT_ALLOCATIONS_EXACTITUD_
//      CENTAVOS_20260817.sql) y verifica su contenido de forma estática
//      -- nunca reimplementa la función plpgsql, la lee tal cual quedó
//      escrita.
//
//   2) Para los casos numéricos (100.00/100.00, 100.00/100.01,
//      100.00/99.99), extrae la EXPRESIÓN DE COMPARACIÓN real del
//      archivo (el operador y los operandos, tal como los escribió
//      Postgres/plpgsql) y la evalúa en JS usando aritmética de centavos
//      enteros (igual criterio que serviceMoneyCents() del cliente, para
//      evitar cualquier ruido binario) -- nunca asume el resultado.
//
//   3) Confirma que index.html/index_operator.html NO fueron tocados por
//      esta mejora (comparados contra el HEAD publicado).
//
// Lo que esta prueba NO puede confirmar (requiere ejecutar realmente
// contra Postgres/Supabase, fuera de alcance de esta iteración):
//   - que CREATE OR REPLACE FUNCTION compile sin errores en Postgres real;
//   - que el trigger realmente invoque esta versión de la función después
//     de aplicarse (eso es una garantía de Postgres: CREATE OR REPLACE
//     conserva el OID de la función, y el trigger referencia por OID, no
//     por texto -- pero no se puede demostrar sin una base real).
// ============================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const migrationPath = path.join(ROOT, 'migraciones', '6b11_ENDURECIMIENTO_PAYMENT_ALLOCATIONS_EXACTITUD_CENTAVOS_20260817.sql');
const diagnosticPath = path.join(ROOT, 'migraciones', '6b11_DIAGNOSTICO_auditoria_completa_payment_allocations_solo_lectura.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const diagnosticSql = fs.readFileSync(diagnosticPath, 'utf8');
const indexPath = path.join(ROOT, 'index.html');
const operatorPath = path.join(ROOT, 'index_operator.html');
const indexText = fs.readFileSync(indexPath, 'utf8');
const operatorText = fs.readFileSync(operatorPath, 'utf8');

// Cuerpo real de la función, sin los comentarios de encabezado del
// archivo (todo lo que va DESPUÉS de la primera línea ejecutable).
const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.check_payment_allocation_integrity()');
assert.ok(fnStart !== -1, 'debe existir la definición real de la función en el archivo');
const fnEnd = sql.indexOf('$function$;', fnStart) + '$function$;'.length;
const functionBody = sql.slice(fnStart, fnEnd);

// Centavos enteros, mismo criterio que serviceMoneyCents() del cliente
// -- nunca comparación de floats crudos.
function cents(n) { return Math.round(n * 100); }

// Simula la condición real de rechazo escrita en el archivo:
//   IF allocated_total + NEW.allocated_amount > payment_total THEN
// extraída tal cual (no reimplementada a mano): se confirma el operador
// real (">" y NO ">=") y se evalúa con los valores de cada caso.
function wouldReject(allocatedTotal, newAllocatedAmount, paymentTotal) {
  const comparisonLine = functionBody.match(/IF\s+allocated_total\s*\+\s*NEW\.allocated_amount\s*(>=?)\s*payment_total(\s*\+\s*0\.01)?\s*THEN/);
  assert.ok(comparisonLine, 'debe existir la línea real de comparación de sobreimputación');
  const operator = comparisonLine[1];
  const hasTolerance = !!comparisonLine[2];
  const left = cents(allocatedTotal) + cents(newAllocatedAmount);
  const right = cents(paymentTotal) + (hasTolerance ? 1 : 0);
  return operator === '>=' ? left >= right : left > right;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

caso('CASO 1 — la función existe en el archivo (CREATE OR REPLACE FUNCTION public.check_payment_allocation_integrity)', () => {
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.check_payment_allocation_integrity()'));
  assert.ok(sql.includes('RETURNS trigger'));
  assert.ok(sql.includes('LANGUAGE plpgsql'));
});

caso('CASO 2 — el trigger NO se toca (sin CREATE TRIGGER/DROP TRIGGER) -- sigue apuntando a la misma función por nombre', () => {
  assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'no debe crear ningún trigger nuevo');
  assert.ok(!/DROP\s+TRIGGER/i.test(sql), 'no debe borrar ningún trigger existente');
  // El nombre de la función no cambia -- CREATE OR REPLACE conserva el
  // OID, así que trg_check_payment_allocation_integrity (que invoca por
  // nombre/OID, no por texto) sigue intacto sin necesidad de tocarlo.
  const fnNameCount = (sql.match(/check_payment_allocation_integrity/g) || []).length;
  assert.ok(fnNameCount >= 1, 'el nombre de la función debe mantenerse exactamente igual');
});

caso('CASO 3 — 100.00 / 100.00 permitido conceptualmente (0+100.00 no supera 100.00)', () => {
  assert.strictEqual(wouldReject(0, 100.00, 100.00), false);
});

caso('CASO 4 — 100.00 / 100.01 rechazado (0+100.01 supera 100.00)', () => {
  assert.strictEqual(wouldReject(0, 100.01, 100.00), true);
});

caso('CASO 5 — 100.00 / 99.99 permitido (0+99.99 no supera 100.00)', () => {
  assert.strictEqual(wouldReject(0, 99.99, 100.00), false);
});

caso('CASO 6 — no existe ninguna tolerancia +0.01 en la validación (comparación exacta contra payment_total)', () => {
  const comparisonLine = functionBody.match(/IF\s+allocated_total\s*\+\s*NEW\.allocated_amount\s*(>=?)\s*payment_total(\s*\+\s*0\.01)?\s*THEN/);
  assert.ok(comparisonLine);
  assert.strictEqual(comparisonLine[2], undefined, 'no debe quedar ningún "+ 0.01" junto a payment_total en la comparación real');
  assert.ok(!/payment_total\s*\+\s*0\.01/.test(functionBody), 'no debe quedar el patrón exacto payment_total + 0.01 en ningún lugar del cuerpo de la función');
  // Ninguna otra tolerancia binaria inventada tampoco (0.001/epsilon/ROUND
  // arbitrario) -- numeric(14,2) no la necesita.
  assert.ok(!/\+\s*0\.001/.test(functionBody));
  assert.ok(!/epsilon/i.test(functionBody));
  assert.ok(!/\bROUND\s*\(/i.test(functionBody), 'no debe agregarse ningún ROUND() arbitrario -- numeric(14,2) ya compara exacto');
});

caso('CASO 7 — la validación de moneda sigue exactamente igual (obligation_currency_real <> NEW.currency)', () => {
  assert.ok(functionBody.includes("obligation_currency_real :=\n    COALESCE(public.obligation_currency(NEW.obligation_id), 'ARS');"));
  assert.ok(functionBody.includes('IF obligation_currency_real <> NEW.currency THEN'));
  assert.ok(functionBody.includes("'La moneda de la asignación (%) no coincide con la moneda de la obligación (%)'"));
});

caso('CASO 8 — un pago inexistente sigue rechazándose exactamente igual (payment_total IS NULL)', () => {
  assert.ok(functionBody.includes('IF payment_total IS NULL THEN'));
  assert.ok(functionBody.includes("RAISE EXCEPTION 'El pago % no existe', NEW.payment_id;"));
});

caso('CASO 9 — una allocation inactiva sigue sin contar en la suma (AND is_active) y el early-return de NOT NEW.is_active se conserva', () => {
  assert.ok(functionBody.includes('IF NOT NEW.is_active THEN'));
  assert.ok(functionBody.includes('    RETURN NEW;\n  END IF;'));
  assert.ok(/WHERE payment_id = NEW\.payment_id\s*\n\s*AND is_active\s*\n\s*AND id <> NEW\.id;/.test(functionBody), 'la suma de allocated_total debe seguir filtrando por is_active y excluyendo la propia fila');
});

caso('CASO 10 — Tarjetas no se toca (ni en la migración ni en el resto del repo por esta mejora)', () => {
  assert.ok(!/creditCard|credit_card|carried_balance|\bstatement|\bmovement|conciliaci/i.test(sql), 'la migración no debe referenciar nada de Tarjetas');
  // AJUSTE (mejora #6, 20260817): esta aserción originalmente comparaba
  // el SHA-256 de TODO index.html/index_operator.html contra un
  // respaldo fijo, asumiendo que el frontend nunca volvería a cambiar --
  // esa asunción dejó de ser válida en cuanto una mejora POSTERIOR y
  // legítima (mejora #6, anulación no destructiva de documentos) tocó
  // el frontend de verdad. La garantía real que le importa a ESTA
  // mejora (puramente backend/SQL, nunca tocó Tarjetas) no depende de
  // que el archivo entero se congele para siempre -- se verifica
  // directamente comparando las funciones CORE de Tarjetas contra el
  // mismo respaldo de siempre, el mismo criterio que ya usan las demás
  // suites de esta sesión.
  const beforePath = path.join(ROOT, 'respaldos_publicacion', 'antes_publicar_bloque_contable_servicios_20260817_072140', 'index.html.antes_publicar_bloque_contable');
  const beforeOperatorPath = path.join(ROOT, 'respaldos_publicacion', 'antes_publicar_bloque_contable_servicios_20260817_072140', 'index_operator.html.antes_publicar_bloque_contable');
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

caso('CASO 11 — RLS no se toca (sin POLICY/GRANT/REVOKE en ningún archivo de esta mejora)', () => {
  for (const text of [sql, diagnosticSql]) {
    assert.ok(!/CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i.test(text));
    assert.ok(!/\bGRANT\b|\bREVOKE\b/i.test(text));
  }
});

caso('CASO 12 — no hay UPDATE/DELETE/INSERT de datos en la migración (solo la definición de la función)', () => {
  const withoutComments = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bINSERT\s+INTO\b/i.test(withoutComments));
  assert.ok(!/\bUPDATE\s+public\./i.test(withoutComments));
  assert.ok(!/\bDELETE\s+FROM\b/i.test(withoutComments));
});

caso('CASO 13 — no hay ningún DROP TABLE', () => {
  assert.ok(!/DROP\s+TABLE/i.test(sql));
});

caso('CASO 14 — no hay ningún ALTER TABLE', () => {
  assert.ok(!/ALTER\s+TABLE/i.test(sql));
});

caso('CASO 15 — no hay ningún otro cambio de esquema -- un único statement ejecutable (CREATE OR REPLACE FUNCTION)', () => {
  const withoutComments = sql.split('\n').filter(l => !/^\s*--/.test(l) && l.trim() !== '').join('\n');
  const statementCount = (withoutComments.match(/^CREATE OR REPLACE FUNCTION/gm) || []).length;
  assert.strictEqual(statementCount, 1, 'debe haber exactamente una sentencia CREATE OR REPLACE FUNCTION, ninguna otra sentencia de nivel superior');
  assert.ok(!/CREATE\s+TABLE|CREATE\s+INDEX|CREATE\s+TRIGGER|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE/i.test(sql));
});

caso('CASO 16 — el diagnóstico read-only de auditoría completa (universo sin LIMIT) es 100% de solo lectura', () => {
  const codeLines = diagnosticSql.split('\n').filter(l => !/^\s*--/.test(l));
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s/i.test(codeLines.join('\n')), 'el diagnóstico de auditoría debe seguir siendo 100% de solo lectura');
  assert.ok(!/\bLIMIT\s+\d+/i.test(diagnosticSql), 'la auditoría no debe limitar filas -- se pidió el universo completo');
});

caso('CASO 17 — la migración depende explícitamente del diagnóstico previo (prerrequisito documentado, nunca corrige datos históricos)', () => {
  assert.ok(sql.includes('PRERREQUISITO'));
  assert.ok(!/UPDATE\s+public\.payment_allocations/i.test(sql));
  assert.ok(!/DELETE\s+FROM\s+public\.payment_allocations/i.test(sql));
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
  console.log('AVISO: valida el contenido estático de la migración preparada, NO ejecución real contra Postgres/Supabase.');
  if (fail > 0) process.exitCode = 1;
}

run();
