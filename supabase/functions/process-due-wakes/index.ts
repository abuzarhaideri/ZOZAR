// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { corsHeaders, json } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cronSecret = Deno.env.get('CRON_SECRET');
const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');

async function sendExpoPush(messages: Record<string, unknown>[]) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
  return payload;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (cronSecret && request.headers.get('Authorization') !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const { data: due, error: dueError } = await admin
    .from('wake_occurrences')
    .select('id, user_id, commitment_id, scheduled_for, grace_period_minutes, wake_plan:wake_plans!inner(circle_id)')
    .in('status', ['scheduled', 'ringing'])
    .lte('scheduled_for', new Date(now.getTime() - 60_000).toISOString())
    .limit(100);
  if (dueError) return json({ error: dueError.message }, 500);

  let escalated = 0;
  let attempted = 0;
  const failures: string[] = [];

  for (const occurrence of due ?? []) {
    const dueAt = new Date(new Date(occurrence.scheduled_for).getTime() + occurrence.grace_period_minutes * 60_000);
    if (dueAt > now) continue;

    const { data: claimed, error: claimError } = await admin
      .from('wake_occurrences')
      .update({ status: 'escalated', escalated_at: now.toISOString() })
      .eq('id', occurrence.id)
      .in('status', ['scheduled', 'ringing'])
      .select('id, user_id, commitment_id, scheduled_for')
      .maybeSingle();
    if (claimError || !claimed) continue;
    escalated += 1;

    const circleId = occurrence.wake_plan?.circle_id;
    if (!circleId) continue;
    const { data: members } = await admin.from('circle_members').select('user_id').eq('circle_id', circleId).eq('status', 'active');
    const recipientIds = (members ?? []).map((member) => member.user_id);
    if (!recipientIds.length) continue;

    const { data: tokens } = await admin.from('device_tokens').select('user_id, expo_push_token').in('user_id', recipientIds).eq('is_active', true);
    const pushMessages = (tokens ?? []).map((token) => ({
      to: token.expo_push_token,
      sound: 'default',
      title: 'ZO-ZAR missed wake',
      body: 'Your trusted person did not confirm their wake plan.',
      data: { type: 'missed_wake', occurrenceId: claimed.id },
      channelId: 'zo-zar-trusted-alerts',
    }));
    if (!pushMessages.length) continue;

    const { data: deliveries } = await admin.from('notification_deliveries').upsert(
      recipientIds.map((recipientId) => ({ occurrence_id: claimed.id, recipient_user_id: recipientId, status: 'pending', attempt_count: 1 })),
      { onConflict: 'occurrence_id,recipient_user_id,channel', ignoreDuplicates: true },
    ).select('id, recipient_user_id');
    attempted += pushMessages.length;

    try {
      const pushResult = await sendExpoPush(pushMessages);
      const tickets = pushResult?.data ?? [];
      for (let index = 0; index < (deliveries ?? []).length; index += 1) {
        const delivery = deliveries[index];
        const ticket = tickets[index];
        await admin.from('notification_deliveries').update({
          status: ticket?.status === 'ok' ? 'sent' : 'failed',
          provider_ticket_id: ticket?.id ?? null,
          error_message: ticket?.message ?? ticket?.details?.error ?? null,
          sent_at: ticket?.status === 'ok' ? now.toISOString() : null,
        }).eq('id', delivery.id);
      }
    } catch (error) {
      failures.push(`${claimed.id}: ${error.message}`);
      await admin.from('notification_deliveries').update({ status: 'failed', error_message: error.message }).eq('occurrence_id', claimed.id).eq('status', 'pending');
    }
  }

  return json({ processedAt: now.toISOString(), escalated, attempted, failures });
});
