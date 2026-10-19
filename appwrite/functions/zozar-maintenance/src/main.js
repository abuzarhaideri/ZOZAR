import { GoogleAuth } from 'google-auth-library';
import { Client, ID, Permission, Query, Role, Storage, TablesDB } from 'node-appwrite';

const table = { plans: 'wake_plans', occurrences: 'wake_occurrences', connections: 'connections', messages: 'messages', tokens: 'device_tokens', jobs: 'notification_jobs' };

function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing function variable ${name}`); return value; }

function context(req) {
  const dynamicKey = req.headers['x-appwrite-key'];
  if (!dynamicKey) throw new Error('Appwrite did not provide a function API key.');
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || env('APPWRITE_ENDPOINT'))
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || env('APPWRITE_PROJECT_ID'))
    .setKey(dynamicKey);
  return { tables: new TablesDB(client), storage: new Storage(client), databaseId: env('APPWRITE_DATABASE_ID'), bucketId: env('APPWRITE_STORAGE_BUCKET_ID') };
}

async function rows(ctx, tableId, queries) {
  return (await ctx.tables.listRows({ databaseId: ctx.databaseId, tableId, queries: [...queries, Query.limit(500)], total: false })).rows;
}

async function fcmAccessToken() {
  const credentials = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT_JSON'));
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  return { token: await auth.getAccessToken(), projectId: process.env.FIREBASE_PROJECT_ID || credentials.project_id };
}

async function sendPush(token, notification, data = {}) {
  const auth = await fcmAccessToken();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, notification, data } }) });
  if (!response.ok) throw new Error(`FCM ${response.status}: ${await response.text()}`);
}

async function enqueue(ctx, userId, kind, payload, dedupeKey) {
  const existing = await rows(ctx, table.jobs, [Query.equal('dedupeKey', [dedupeKey])]);
  if (existing[0]) return;
  await ctx.tables.createRow({ databaseId: ctx.databaseId, tableId: table.jobs, rowId: ID.unique(), data: { userId, token: null, kind, payload: JSON.stringify(payload), status: 'pending', attempts: 0, nextAttemptAt: new Date().toISOString(), dedupeKey, lastError: null } });
}

async function processJobs(ctx, log) {
  const now = new Date().toISOString();
  const jobs = await rows(ctx, table.jobs, [Query.equal('status', ['pending', 'retry']), Query.lessThanEqual('nextAttemptAt', now)]);
  for (const job of jobs) {
    try {
      const tokens = job.token ? [{ token: job.token }] : await rows(ctx, table.tokens, [Query.equal('userId', [job.userId]), Query.equal('isActive', [true])]);
      const payload = JSON.parse(job.payload);
      await Promise.all(tokens.map((item) => sendPush(item.token, payload.notification, payload.data)));
      await ctx.tables.updateRow({ databaseId: ctx.databaseId, tableId: table.jobs, rowId: job.$id, data: { status: 'sent', attempts: Number(job.attempts) + 1, lastError: null } });
    } catch (caught) {
      const attempts = Number(job.attempts) + 1;
      const status = attempts >= 5 ? 'failed' : 'retry';
      const delayMinutes = Math.min(60, 2 ** attempts);
      await ctx.tables.updateRow({ databaseId: ctx.databaseId, tableId: table.jobs, rowId: job.$id, data: { status, attempts, nextAttemptAt: new Date(Date.now() + delayMinutes * 60000).toISOString(), lastError: String(caught).slice(0, 1000) } });
      log(`Push job ${job.$id} moved to ${status}`);
    }
  }
}

async function processWakes(ctx) {
  const now = new Date();
  const active = await rows(ctx, table.occurrences, [Query.equal('status', ['scheduled', 'ringing']), Query.lessThanEqual('scheduledFor', now.toISOString())]);
  for (const occurrence of active) {
    const deadline = new Date(occurrence.scheduledFor).getTime() + Number(occurrence.graceMinutes ?? 10) * 60000;
    if (Date.now() < deadline) {
      if (occurrence.status === 'scheduled') await ctx.tables.updateRow({ databaseId: ctx.databaseId, tableId: table.occurrences, rowId: occurrence.$id, data: { status: 'ringing', triggeredAt: now.toISOString() } });
      continue;
    }
    await ctx.tables.updateRow({ databaseId: ctx.databaseId, tableId: table.occurrences, rowId: occurrence.$id, data: { status: 'escalated', escalatedAt: now.toISOString() } });
    const plan = await ctx.tables.getRow({ databaseId: ctx.databaseId, tableId: table.plans, rowId: occurrence.wakePlanId });
    if (!plan.connectionId) continue;
    const connection = await ctx.tables.getRow({ databaseId: ctx.databaseId, tableId: table.connections, rowId: plan.connectionId });
    const trustedId = connection.requesterId === occurrence.userId ? connection.recipientId : connection.requesterId;
    if (trustedId) await enqueue(ctx, trustedId, 'missed-wake', { notification: { title: 'ZO-ZAR wake support', body: 'Your trusted person may have missed their wake alarm.' }, data: { kind: 'missed-wake', occurrenceId: occurrence.$id } }, `missed:${occurrence.$id}:${trustedId}`);
  }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localToUtc(year, month, day, hour, minute, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const viewed = localParts(new Date(candidate), timeZone);
    const viewedUtc = Date.UTC(Number(viewed.year), Number(viewed.month) - 1, Number(viewed.day), Number(viewed.hour), Number(viewed.minute));
    candidate += desired - viewedUtc;
  }
  return new Date(candidate);
}

function nextScheduledFor(plan, after = new Date()) {
  const [hour, minute] = String(plan.localTime).split(':').map(Number);
  const timeZone = plan.timezone || 'UTC';
  const current = localParts(after, timeZone);
  const base = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day)));
  const allowed = new Set((plan.weekdays ?? []).map(Number));
  const oneTimeDate = plan.scheduledDate ? String(plan.scheduledDate).split('-').map(Number) : null;
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(base.getTime() + offset * 86400000);
    if (plan.scheduleType === 'once' && (!oneTimeDate || day.getUTCFullYear() !== oneTimeDate[0] || day.getUTCMonth() + 1 !== oneTimeDate[1] || day.getUTCDate() !== oneTimeDate[2])) continue;
    if (plan.scheduleType === 'weekly' && !allowed.has(day.getUTCDay())) continue;
    const candidate = localToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timeZone);
    if (candidate.getTime() > after.getTime() + 30000) return candidate;
  }
  return null;
}

async function prepareRecurringOccurrences(ctx) {
  const plans = await rows(ctx, table.plans, [Query.equal('isActive', [true])]);
  for (const plan of plans) {
    const active = await rows(ctx, table.occurrences, [Query.equal('wakePlanId', [plan.$id]), Query.equal('status', ['scheduled', 'ringing']), Query.greaterThan('scheduledFor', new Date().toISOString())]);
    if (active[0]) continue;
    const scheduledFor = nextScheduledFor(plan);
    if (!scheduledFor) continue;
    await ctx.tables.createRow({
      databaseId: ctx.databaseId,
      tableId: table.occurrences,
      rowId: ID.unique(),
      data: { wakePlanId: plan.$id, userId: plan.userId, commitmentId: plan.commitmentId ?? null, scheduledFor: scheduledFor.toISOString(), difficulty: plan.difficulty, graceMinutes: plan.graceMinutes, challengePayload: '{}', status: 'scheduled', triggeredAt: null, confirmedAt: null, escalatedAt: null, snoozeCount: 0 },
      permissions: [Permission.read(Role.user(plan.userId)), Permission.update(Role.user(plan.userId)), Permission.delete(Role.user(plan.userId))],
    });
  }
}

async function cleanupExpired(ctx, log) {
  const expired = await rows(ctx, table.messages, [Query.lessThanEqual('expiresAt', new Date().toISOString())]);
  for (const message of expired) {
    if (message.voicePath) {
      try { await ctx.storage.deleteFile({ bucketId: ctx.bucketId, fileId: message.voicePath }); }
      catch (caught) { log(`Voice cleanup will retry for ${message.voicePath}: ${caught}`); continue; }
    }
    await ctx.tables.deleteRow({ databaseId: ctx.databaseId, tableId: table.messages, rowId: message.$id });
  }
}

export default async ({ req, res, log, error }) => {
  try {
    const ctx = context(req);
    await processWakes(ctx);
    await prepareRecurringOccurrences(ctx);
    await processJobs(ctx, log);
    if (new Date().getUTCMinutes() % 15 === 0) await cleanupExpired(ctx, log);
    return res.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (caught) {
    error(caught instanceof Error ? caught.stack ?? caught.message : String(caught));
    return res.json({ ok: false, error: caught instanceof Error ? caught.message : String(caught) }, 500);
  }
};
