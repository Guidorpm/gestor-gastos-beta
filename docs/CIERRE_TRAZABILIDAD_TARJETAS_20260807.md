# Cierre — Trazabilidad e importación segura de resúmenes de tarjetas
## Visa 5044 / Visa 8374 — publicado a producción

**Fecha:** 2026-08-07/08
**Rama productiva:** `main` (GitHub Pages, root)
**Commit:** `88d08580b1c5966b95dbafbecba02ce528780350`
**URL productiva:** https://guidorpm.github.io/gestor-gastos-beta/

---

### Causa inicial

Manual testing on Visa 5044 surfaced a chain of related but distinct bugs in the credit-card statement upload/reconciliation/traceability flow, each found only after the previous one was fixed:

1. **Doble conteo de pagos**: `registeredCreditPaymentsInWindow` no filtraba por `source==='manual_payment'`, contando reconocimientos bancarios como si fueran pagos nuevos registrados.
2. **Titular contaminado**: el regex de limpieza no toleraba el separador `*` real de los PDF de Banco Provincia.
3. **Identidad de statement confundida por mes calendario**: `findStatementForPeriod` solo comparaba `statement_month`, sin mirar `close_date` real — un PDF de cierre 30/07 se confundía con el statement existente de cierre 02/07 (mismo mes calendario, "Julio").
4. **`statement_month` sin semántica única**: auditoría real de Supabase demostró que no es una función fija de `close_date` ni de `due_date` — es un ciclo/período que debe resolverse por secuencia real de la tarjeta.
5. **Bug crítico de escritura**: el resumen preseleccionado en pantalla (`contextStatement`) se usaba sin condición como destino de escritura, pudiendo actualizar un resumen real distinto (Julio) con los datos de un PDF de otro ciclo (Agosto).

### Problemas corregidos (en orden)

- **Doble evidencia del pago**: filtro estricto por `source==='manual_payment'` en la ventana de pagos registrados; nueva tabla de conciliación 1 fila por hecho económico.
- **Titular**: regex tolera `*` como separador real.
- **Identidad por close_date**: `findStatementForPeriod(cardId, period, declaredCloseDate)` prioriza el cierre real por sobre el mes calendario, con fallback histórico seguro para statements sin `close_date`.
- **Resolución de ciclo/período**: `resolveCreditStatementCycle` — prioridad 1 (período explícito declarado por el PDF), prioridad 2 (secuencia real: resumen anterior + 1 mes), prioridad 3 (fallback débil documentado). Nunca usa `due_date` ni `close_date` como regla fija/universal.
- **Protección de `contextStatement`**: `resolveCreditStatementWriteTarget` — el resumen preseleccionado en pantalla solo se reutiliza para escritura si su `close_date` real coincide con el declarado por el PDF actual; si no, siempre resuelve por identidad real (`findStatementForPeriod`). Ante ambigüedad real, bloquea antes de escribir.

### Resultado validado — Visa 5044, PDF cierre 30/07/2026

- Período detectado: **Agosto 2026**.
- `statement_month`: `2026-08-01`. `close_date`: `2026-07-30`. `due_date`: `2026-08-10`.
- Destino de guardado: **NUEVO RESUMEN — Agosto 2026** → **INSERT nuevo**, nunca UPDATE del statement de Julio (`a09c57ae-4420-4f38-a6aa-15cbd0808f9f`).
- Conciliación: 6 pagos registrados / 6 reconocimientos bancarios / **6/6 conciliados**, diferencia ARS 0,00, USD 0,00.
- Trazabilidad: "Aplicado a: Julio 2026 — cierre 02/07/2026" / "Reconocido en: Agosto 2026 — cierre 30/07/2026". PDF anterior pendiente/no vinculado; trazabilidad documental incompleta solo por documento faltante (el statement real nunca se ignora).
- Statement de Julio (02/07): protegido — sus 42 movimientos y 6 pagos manuales reales (ARS 1.782.062,79 / USD 120,79) quedan intactos, sin mover, copiar, recrear ni modificar.
- Visa 8374: no se rompe — el mismo motor genérico resuelve correctamente su propia secuencia real (Junio→Julio).

### `owner_id`

`credit_card_statements.owner_id` es `uuid NOT NULL DEFAULT auth.uid()` (confirmado por diagnóstico real de Supabase, `migraciones/6b_FINAL_F_2B_2_MIGRACION_ACCESO_TARJETAS.sql`). El INSERT del motor no lo envía explícitamente; para el guardado puntual de Guido (autenticado como titular real de la tarjeta), el DEFAULT resuelve correctamente `owner_id = owner real de la tarjeta`. El soporte robusto para operadores delegados (fijar `owner_id` explícito desde `credit_cards`) queda documentado como pendiente futuro — no se tocó en esta publicación.

### Constraint de Supabase

`UNIQUE(owner_id, card_id, statement_month)` — **sin cambios**. Con el ciclo correctamente resuelto (Agosto ≠ Julio), no hay colisión real; nunca hizo falta una migración.

### Pruebas ejecutadas

Regresión completa contra el código publicado (mismo resultado que en el worktree de desarrollo): 13 suites de Tarjetas/trazabilidad, todas sin fallas — `run_carga_real_5044_8374_20260807_tests.js` (41), `run_cierre_definitivo_tarjetas_20260806_tests.js` (75), `run_correccion_critica_statementid_20260807_tests.js` (47), `run_correccion_definitiva_ciclo_periodo_20260807_tests.js` (57), `run_correccion_final_tarjetas_20260806_tests.js` (99), `run_correccion_final_trazabilidad_5044_20260807_tests.js` (41), `run_correccion_titular_relacion_pago_20260807_tests.js` (37), `run_detalle_trazabilidad_preview_20260806_tests.js` (63), `run_doble_evidencia_pagos_20260807_tests.js` (81), `run_identidad_statement_closedate_20260807_tests.js` (35), `run_integracion_real_tarjetas_20260806_tests.js` (67), `run_panel_pendientes_fabiana_20260805_tests.js` (50), `run_resumenes_trazabilidad_20260805_tests.js` (83), `run_trazabilidad_pagos_decimales_20260806_tests.js` (91). Fallas preexistentes y no relacionadas (`run_6b4_11_3_permisos_navegacion_tests.js`, `run_6b4_11_2_inicio_operador_tests.js`, `run_6b4_16_cierre_v1_tests.js`, `run_hotfix_payment_allocations_deudas_tests.js`) sin cambios, fuera de alcance.

### Commit y publicación

- Commit `88d08580b1c5966b95dbafbecba02ce528780350`, basado directamente en `origin/main@90f736b` (fast-forward limpio, sin merge ni force push).
- Push a `main`, verificado en vivo en `https://guidorpm.github.io/gestor-gastos-beta/index.html` e `index_operator.html` — contenido idéntico byte a byte al commit.

### Limitaciones pendientes

1. `owner_id` no se envía explícitamente en el INSERT — depende del `DEFAULT auth.uid()`, seguro para el titular pero no para un operador delegado futuro (documentado, sin implementar).
2. Verificación de producción hecha de forma estática (HTTP + contenido + sintaxis) — no se hizo click-through interactivo en navegador (login, apertura de Tarjetas) desde este entorno; eso queda para la verificación manual de Guido.
3. `main` local (en `C:\Proyectos\gestor-gastos-beta`, distinto de este commit) sigue teniendo un commit sin pushear (`04261bc`, "release v1.0.0") y cambios sin commitear no relacionados (control de acceso a Tarjetas para operadores delegados) — no se tocaron, quedan exactamente como estaban para que Guido los retome cuando quiera.

### Única acción siguiente para Guido

1. Abrir producción.
2. Entrar a Tarjetas.
3. Elegir Visa 5044.
4. "Subir resumen".
5. Cargar el PDF cierre 30/07.
6. **Detenerse en la vista previa antes de confirmar la escritura** — revisión visual final antes del primer INSERT real.
