// ============================================================
// MEJORA 6B4.15 — PENDIENTE. NO DESPLEGADO. Diseño conceptual únicamente.
// ------------------------------------------------------------
// Esta etapa agregó reglas nuevas de notificación (mes sin datos desde el
// día 10, vencimientos graduales 3/2/1/0, pago parcial informa solo saldo
// pendiente, factura y comprobante se avisan por separado). Esas reglas
// YA están implementadas del lado cliente en index.html
// (servicePriorityNotifications) para el centro de avisos INTERNO -- pero
// ese centro interno solo se calcula cuando alguien tiene la app abierta.
// Para que un aviso llegue con la app CERRADA hace falta que el mismo
// criterio corra del lado servidor, dentro de la Edge Function real
// "send-due-notifications" (o una función equivalente) más un cron.
//
// ESTADO REAL DE LA INSPECCIÓN (honesto, no inventado):
//   - Se confirmó que la función "send-due-notifications" está desplegada
//     y responde (OPTIONS -> HTTP 200, HEAD -> HTTP 405) mediante una
//     verificación de solo lectura contra su URL pública, SIN invocar su
//     lógica real (nunca se hizo POST, nunca se envió una notificación
//     real desde esta inspección).
//   - Su CÓDIGO FUENTE no está versionado en este repositorio y no hay
//     ningún mecanismo de lectura disponible desde este entorno para
//     inspeccionarlo (no hay CLI de Supabase vinculada, no hay proyecto
//     linkeado, no hay copia local). Por lo tanto: su lógica actual queda
//     marcada explícitamente como NO VERIFICADA. Este archivo NO afirma
//     saber qué hace hoy esa función -- solo lo que el CLIENTE le pide
//     (ver sb.functions.invoke('send-due-notifications',{action:'test',...})
//     en index.html) y lo que la documentación previa (6B4.8) ya había
//     inferido: que existe infraestructura push real, por espacio
//     (group_id), para vencimientos de Servicios.
//   - NO se asume que el cron/la función ya cubran las reglas nuevas de
//     esta etapa (día 10, cascada 3/2/1/0 con el mismo texto, factura vs
//     comprobante por separado). Mientras esto no se verifique con acceso
//     real al proyecto Supabase, se declara NO VERIFICADO.
//
// Requisitos antes de poder desplegar esta propuesta de verdad (ninguno
// resuelto acá):
//   1. Acceso real de lectura al proyecto Supabase (CLI vinculada o panel)
//      para leer el código actual de send-due-notifications ANTES de
//      modificarlo -- nunca reemplazarla a ciegas.
//   2. Autorización explícita del titular para desplegar cualquier cambio
//      de Edge Function.
//   3. Cron ya configurado según 6B4.8 (10:00 America/Argentina/Buenos_Aires) --
//      confirmar que sigue apuntando a la función correcta.
//   4. Probar primero contra un usuario/espacio de prueba.
//
// Pseudocódigo de la lógica NUEVA propuesta (nunca ejecutado) -- reutiliza
// EXACTAMENTE los mismos criterios que servicePriorityNotifications() en
// index.html, para que servidor y cliente coincidan siempre en qué está
// pendiente:
// ------------------------------------------------------------
/*
import { createClient } from '@supabase/supabase-js';

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

export default async function handler(req) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY); // nunca la clave publishable

  const today = nowInArgentina(); // mismo criterio que todayInArgentina() del cliente

  const { data: groups } = await supabase.from('groups').select('*').eq('status', 'active');

  for (const group of groups) {
    const { data: services } = await supabase.from('services').select('*').eq('group_id', group.id);
    const { data: obligations } = await supabase.from('obligations')
      .select('*').eq('status', 'is', null) // nunca incluir status='cancelled' (anulados)
      .neq('status', 'cancelled');

    for (const service of services) {
      const currentPeriodKey = monthKey(today);
      const o = obligations.find(x => x.service_id === service.id && x.period === periodDate(currentPeriodKey));

      // Regla 1: mes sin datos, solo desde el día 10.
      if (today.getDate() >= 10) {
        const missing = !o || !o.amount || !o.due_date;
        if (missing) await maybeSend(group, service, currentPeriodKey, 'missing_month_data', dedupeKey(group, service, currentPeriodKey, 'missing_month_data'));
      }

      if (!o) continue;

      // Regla 2/3/4: vencimientos graduales, se detiene al pagar, informa
      // SOLO saldo pendiente en pago parcial -- misma lógica que
      // paymentProgress()/daysUntil() del cliente, replicada acá.
      const progress = computePaymentProgress(o, await paymentsFor(supabase, o.id));
      if (progress.fullyPaid) continue;
      const days = daysUntil(o.due_date, today);
      if (days < 0) await maybeSend(group, service, currentPeriodKey, 'overdue', ...);
      else if (days === 0) await maybeSend(group, service, currentPeriodKey, 'due_today', ...);
      else if (days <= 3) await maybeSend(group, service, currentPeriodKey, 'due_soon', ...);

      // Regla 5: factura y comprobante, avisos SEPARADOS.
      const hasInvoice = await documentExists(supabase, o.id, 'invoice');
      if (!hasInvoice) await maybeSend(group, service, currentPeriodKey, 'missing_invoice', ...);
      if (progress.paid > 0 && !(await hasReceipt(supabase, o.id))) {
        await maybeSend(group, service, currentPeriodKey, 'missing_receipt', ...);
      }
    }
  }

  // maybeSend: SIEMPRE deduplica contra un historial persistido real (una
  // tabla equivalente a card_notification_deliveries de 6B4.8, pero para
  // Servicios) -- clave lógica empresa+usuario+tipo+entidad+período+fecha
  // objetivo, tal como pide el pedido. Nunca reenvía la MISMA alerta el
  // mismo día. Si cambia el importe/saldo, permite una nueva evidencia.
}
*/
// ============================================================
// Nada de este archivo se ejecutó ni se desplegó. La Edge Function real
// desplegada hoy sigue siendo la existente, sin cambios, y su lógica
// actual permanece NO VERIFICADA por esta etapa.
// ============================================================
