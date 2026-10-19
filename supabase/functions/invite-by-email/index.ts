// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { corsHeaders, json } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Only POST is supported' }, 405);

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

  const body = await request.json().catch(() => null);
  const circleId = body?.circleId;
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!circleId || !email || !email.includes('@')) return json({ error: 'circleId and a valid email are required' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: circle, error: circleError } = await admin.from('circles').select('id, owner_id, name').eq('id', circleId).maybeSingle();
  if (circleError || !circle || circle.owner_id !== caller.id) return json({ error: 'Circle not found' }, 404);

  const { data: recipient, error: recipientError } = await admin.from('profiles').select('id, email, display_name').eq('email', email).maybeSingle();
  if (recipientError || !recipient) return json({ error: 'The recipient must create a ZO-ZAR account before being invited' }, 404);
  if (recipient.id === caller.id) return json({ error: 'You cannot invite yourself' }, 400);

  const { count, error: countError } = await admin.from('circle_members').select('id', { count: 'exact', head: true }).eq('circle_id', circleId).eq('status', 'active');
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) >= 3) return json({ error: 'A trusted circle may have at most three active members' }, 409);

  const { data: existing, error: existingError } = await admin.from('circle_members').select('id, status').eq('circle_id', circleId).eq('user_id', recipient.id).maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);
  if (existing?.status === 'active') return json({ error: 'This person is already an active trusted-circle member' }, 409);

  const { data: member, error: memberError } = await admin.from('circle_members').upsert({
    circle_id: circleId,
    user_id: recipient.id,
    invited_email: email,
    invited_by: caller.id,
    status: 'pending',
  }, { onConflict: 'circle_id,user_id' }).select().single();
  if (memberError) return json({ error: memberError.message }, 500);

  return json({ member, message: `Invitation created for ${recipient.display_name || email}. The recipient can accept it in ZO-ZAR.` }, 201);
});
