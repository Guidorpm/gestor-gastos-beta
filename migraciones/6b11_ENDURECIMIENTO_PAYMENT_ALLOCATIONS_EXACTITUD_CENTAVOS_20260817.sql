-- ============================================================
-- MIGRACIÓN PREPARADA -- NO EJECUTAR SIN AUTORIZACIÓN EXPRESA DE GUIDO
-- ------------------------------------------------------------
-- Objetivo: eliminar la tolerancia de +0.01 en la validación de
-- sobreimputación de public.check_payment_allocation_integrity()
-- (trigger trg_check_payment_allocation_integrity, BEFORE INSERT/UPDATE
-- sobre public.payment_allocations).
--
-- Motivo: payments.total_amount y payment_allocations.allocated_amount
-- son numeric(14,2) -- PostgreSQL compara estos valores de forma EXACTA,
-- sin ruido binario (a diferencia de double precision/float). La
-- tolerancia de +0.01 no cumple ninguna función de precisión numérica
-- acá -- solo permite, en el peor caso, sobreimputar exactamente un
-- centavo sobre un pago (payment_total=100.00, allocations=100.01 ->
-- 100.01 > 100.01 es FALSE, se acepta). El código cliente
-- (index.html/index_operator.html) ya viene tratando esa misma clase de
-- tolerancia de un centavo como un bug de precisión en TODA la capa de
-- Servicios (ver serviceMoneyCents()/comparaciones en centavos enteros,
-- mejora "EXACTITUD A CENTAVOS") y explícitamente NUNCA aprovecha esta
-- tolerancia del lado del trigger (el cliente ya valida
-- serviceMoneyCents(amountRequested)>serviceMoneyCents(maxApplicable)
-- antes de intentar cualquier INSERT/UPDATE en payment_allocations) --
-- endurecer el trigger no reduce ninguna funcionalidad real hoy en uso,
-- solo cierra el único punto del sistema donde un centavo de
-- sobreimputación seguía siendo técnicamente posible.
--
-- ALCANCE: esta migración reemplaza ÚNICAMENTE el cuerpo de la función
-- (CREATE OR REPLACE FUNCTION, misma firma, mismo nombre) -- el trigger
-- trg_check_payment_allocation_integrity YA apunta a esta función por
-- nombre y no necesita recrearse. Toda la lógica existente se conserva
-- exactamente igual (pago existente, is_active, suma de allocations
-- activas excluyendo la propia fila en UPDATE, validación de moneda,
-- mismos mensajes de error, RETURNS trigger, LANGUAGE plpgsql) -- el
-- ÚNICO cambio real es la comparación:
--   allocated_total + NEW.allocated_amount > payment_total + 0.01
-- por:
--   allocated_total + NEW.allocated_amount > payment_total
-- Sin agregar ninguna otra tolerancia (ni +0.001, ni epsilon, ni ROUND
-- arbitrario) -- numeric(14,2) no la necesita.
--
-- COMPATIBILIDAD HISTÓRICA: esta migración NO hace UPDATE ni DELETE
-- sobre payment_allocations/payments/obligations, no corrige datos
-- existentes, no crea ni recrea el trigger, no toca RLS/policies/grants.
-- Afecta EXCLUSIVAMENTE los INSERT/UPDATE de payment_allocations que
-- ocurran DESPUÉS de aplicarse -- el trigger es BEFORE INSERT/UPDATE, así
-- que filas ya existentes nunca vuelven a evaluarse contra esta función
-- salvo que se las actualice explícitamente (lo cual sigue sin ocurrir
-- por esta migración).
--
-- PRERREQUISITO: antes de ejecutar esta migración, correr
-- migraciones/6b11_DIAGNOSTICO_auditoria_completa_payment_allocations_solo_lectura.sql
-- y confirmar que NINGÚN pago real tiene hoy una allocation activa cuyo
-- total supere su payment_total. Si esa auditoría encontrara una
-- sobreimputación histórica real, DETENERSE -- no ejecutar esta
-- migración hasta decidir, por separado, qué hacer con esos datos (esta
-- migración nunca los corrige ni los toca).
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_payment_allocation_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  payment_total numeric(14,2);
  allocated_total numeric(14,2);
  obligation_currency_real text;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT total_amount INTO payment_total
  FROM public.payments
  WHERE id = NEW.payment_id;

  IF payment_total IS NULL THEN
    RAISE EXCEPTION 'El pago % no existe', NEW.payment_id;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO allocated_total
  FROM public.payment_allocations
  WHERE payment_id = NEW.payment_id
    AND is_active
    AND id <> NEW.id;

  IF allocated_total + NEW.allocated_amount > payment_total THEN
    RAISE EXCEPTION
      'La suma de asignaciones (%) supera el importe del pago (%)',
      allocated_total + NEW.allocated_amount,
      payment_total;
  END IF;

  obligation_currency_real :=
    COALESCE(public.obligation_currency(NEW.obligation_id), 'ARS');

  IF obligation_currency_real <> NEW.currency THEN
    RAISE EXCEPTION
      'La moneda de la asignación (%) no coincide con la moneda de la obligación (%)',
      NEW.currency,
      obligation_currency_real;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- ROLLBACK (conceptual, NO ejecutar salvo necesidad real -- ver reporte
-- de entrega): volver a aplicar exactamente el mismo CREATE OR REPLACE
-- de arriba, pero con la condición original:
--   IF allocated_total + NEW.allocated_amount > payment_total + 0.01 THEN
-- en vez de:
--   IF allocated_total + NEW.allocated_amount > payment_total THEN
-- Todo lo demás del cuerpo queda idéntico. Como CREATE OR REPLACE
-- FUNCTION nunca borra el trigger que la usa, revertir es un segundo
-- CREATE OR REPLACE, sin tocar el trigger en ningún sentido.
-- ============================================================
