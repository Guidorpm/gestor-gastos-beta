// ============================================================
// MEJORA 6B4.8 — PENDIENTE. NO DESPLEGADO. Diseño conceptual únicamente.
// ------------------------------------------------------------
// Esta función NO se creó como Edge Function real, NO se desplegó, y NO
// contiene secretos ni claves reales. Es el plan (Fase 13, CASO B) para el
// día en que se decida enviar avisos push de obligaciones de tarjetas con
// el navegador cerrado.
//
// Requisitos antes de poder desplegarla de verdad (ninguno resuelto acá):
//   1. Aplicar (con autorización explícita) la migración conceptual
//      6b4_8_PENDIENTE_push_tarjetas.sql — o decidir una alternativa.
//   2. Generar claves VAPID reales propias (nunca reusar las de otro
//      proyecto) y cargarlas como variables de entorno de la función,
//      nunca en el código fuente.
//   3. Configurar un cron real (pg_cron o Supabase Scheduled Functions)
//      que invoque esta función una vez por día, a las 10:00 hora
//      Argentina (America/Argentina/Buenos_Aires) — cuidado con el
//      offset UTC, que en Argentina es fijo (-03:00, sin horario de
//      verano), a diferencia de otras zonas.
//   4. Probar primero contra un usuario de prueba, nunca contra todos los
//      usuarios reales en el primer intento.
//
// Pseudocódigo de la lógica (nunca ejecutado):
// ------------------------------------------------------------
/*
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

export default async function handler(req) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY); // nunca la clave publishable

  // 1) Traer todas las tarjetas activas con sus resúmenes.
  const { data: cards } = await supabase.from('credit_cards').select('*').eq('active', true);

  for (const card of cards) {
    const { data: statements } = await supabase
      .from('credit_card_statements')
      .select('*')
      .eq('card_id', card.id);

    // 2) Reutilizar EXACTAMENTE la misma lógica de calendario/estado
    //    documental que ya vive en index.html (creditCardCalendarProfile,
    //    creditProjectPeriodDates, creditDocumentStatusForPeriod) — nunca
    //    reimplementarla distinta acá, para que el server y el cliente
    //    siempre coincidan en qué está "pendiente".
    const profile = creditCardCalendarProfile(buildSamplesFrom(statements));
    const targetPeriod = nextPeriodAfterLatest(statements);
    const docStatus = creditDocumentStatusForPeriod(card, statements, targetPeriod);

    // ACTUALIZACIÓN 6B4.9 (diseño, no ejecutado): además del estado
    // documental, esta función eventualmente también debería considerar
    // las obligaciones nuevas de 6B4.9 (CARD_USD_PAYMENT_DECISION_PENDING,
    // CARD_PERCEPTION_REVIEW_PENDING, CARD_REVERSAL_EXPECTED,
    // CARD_CARRY_DIFFERENCE) usando la misma reconcileConsecutiveCreditStatements
    // ya implementada en el cliente — no se agrega esa lógica acá todavía
    // porque esta función entera sigue sin desplegarse.
    if (!['statement_expected', 'statement_overdue', 'missing_document'].includes(docStatus.code)) continue;

    // 3) Deduplicación: ya se avisó hoy este mismo card_id+period+tipo?
    const alreadySentToday = await supabase
      .from('card_notification_deliveries')
      .select('id')
      .eq('card_id', card.id).eq('period', targetPeriod).eq('notification_type', docStatus.code)
      .gte('sent_at', startOfTodayInTZ(ARGENTINA_TZ))
      .maybeSingle();
    if (alreadySentToday.data) continue;

    // 4) Respetar la preferencia del usuario (nunca enviar si está
    //    desactivada) — leer user_metadata.gestor_notifications.enabled
    //    del dueño de la tarjeta antes de nada.
    const owner = await getCardOwner(card);
    if (!owner?.user_metadata?.gestor_notifications?.enabled) continue;

    // 5) Buscar sus suscripciones activas (ver migración pendiente) y
    //    enviar un push con la MISMA forma que ya consume el service
    //    worker (title/body/tag/data.cardId/data.period).
    const subs = await getActiveSubscriptionsForUser(owner.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify({
          title: 'Gestor de Gastos',
          body: docStatus.message,
          tag: `${card.id}:${targetPeriod}:${docStatus.code}`,
          data: { cardId: card.id, period: targetPeriod, notificationType: docStatus.code },
        }));
        await logDelivery(card.id, targetPeriod, docStatus.code, 'sent');
      } catch (err) {
        // Suscripción vencida/inválida (410/404): eliminarla, nunca
        // reintentar indefinidamente contra un endpoint muerto.
        if (err.statusCode === 410 || err.statusCode === 404) await deleteSubscription(sub);
        await logDelivery(card.id, targetPeriod, docStatus.code, 'error', err.message);
      }
    }
  }
}
*/
// ============================================================
// Nada de este archivo se ejecutó ni se desplegó. Queda como documentación
// de diseño para una decisión futura explícita.
// ============================================================
