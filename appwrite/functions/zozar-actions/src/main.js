import { Client, ID, Permission, Query, Role, Storage, TablesDB, Users } from 'node-appwrite';
import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'node:crypto';

const ids = {
  profiles: 'profiles', connections: 'connections', threads: 'chat_threads', messages: 'messages',
  plans: 'wake_plans', occurrences: 'wake_occurrences', deviceTokens: 'device_tokens', jobs: 'notification_jobs',
};

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing function variable ${name}`);
  return value;
}

function clients(req) {
  const dynamicKey = req.headers['x-appwrite-key'];
  if (!dynamicKey) throw new Error('Appwrite did not provide a function API key.');
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT || env('APPWRITE_ENDPOINT'))
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || env('APPWRITE_PROJECT_ID'))
    .setKey(dynamicKey);
  return { tables: new TablesDB(client), storage: new Storage(client), users: new Users(client), databaseId: env('APPWRITE_DATABASE_ID'), bucketId: env('APPWRITE_STORAGE_BUCKET_ID') };
}

function permissions(...userIds) {
  return [...new Set(userIds.filter(Boolean))].flatMap((id) => [Permission.read(Role.user(id)), Permission.update(Role.user(id)), Permission.delete(Role.user(id))]);
}

function mediaPermissions(ownerId, readerIds) {
  return [Permission.read(Role.user(ownerId)), Permission.update(Role.user(ownerId)), Permission.delete(Role.user(ownerId)), ...[...new Set(readerIds.filter(Boolean))].map((id) => Permission.read(Role.user(id)))];
}

function expiresAt(retention) {
  return new Date(Date.now() + (retention === '7d' ? 7 : 30) * 86400000).toISOString();
}

async function list(tables, databaseId, tableId, queries) {
  return (await tables.listRows({ databaseId, tableId, queries, total: false })).rows;
}

async function requireThread(context, userId, threadId) {
  const thread = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.threads, rowId: threadId });
  if (thread.participantA !== userId && thread.participantB !== userId) throw new Error('You are not a participant in this chat.');
  return thread;
}

async function createMessage(context, thread, senderId, type, body, voicePath = null) {
  return context.tables.createRow({
    databaseId: context.databaseId, tableId: ids.messages, rowId: ID.unique(),
    data: { threadId: thread.$id, senderId, type, body, voicePath, createdAt: new Date().toISOString(), expiresAt: expiresAt(thread.retention) },
    permissions: permissions(thread.participantA, thread.participantB),
  });
}

async function sendPush(context, userId, notification, data) {
  const credentials = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT_JSON'));
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  const accessToken = await auth.getAccessToken();
  const projectId = process.env.FIREBASE_PROJECT_ID || credentials.project_id;
  const tokens = await list(context.tables, context.databaseId, ids.deviceTokens, [Query.equal('userId', [userId]), Query.equal('isActive', [true])]);
  await Promise.all(tokens.map(async ({ token }) => {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, notification, data } }) });
    if (!response.ok) throw new Error(`FCM ${response.status}: ${await response.text()}`);
  }));
}

async function queuePush(context, userId, kind, notification, data, dedupeKey) {
  const existing = await list(context.tables, context.databaseId, ids.jobs, [Query.equal('dedupeKey', [dedupeKey])]);
  if (existing[0]) return;
  await context.tables.createRow({
    databaseId: context.databaseId,
    tableId: ids.jobs,
    rowId: ID.unique(),
    data: { userId, token: null, kind, payload: JSON.stringify({ notification, data }), status: 'pending', attempts: 0, nextAttemptAt: new Date().toISOString(), dedupeKey, lastError: null },
  });
}

async function deliverOrQueue(context, userId, kind, notification, data, dedupeKey) {
  try { await sendPush(context, userId, notification, data); }
  catch { await queuePush(context, userId, kind, notification, data, dedupeKey); }
}

export default async ({ req, res, error }) => {
  try {
    const userId = req.headers['x-appwrite-user-id'];
    if (!userId) return res.json({ error: 'Authentication is required.' }, 401);
    const { action, payload = {} } = req.bodyJson ?? JSON.parse(req.bodyText || '{}');
    const context = clients(req);

    if (action === 'invite') {
      const email = String(payload.email ?? '').trim().toLowerCase();
      if (!email) throw new Error('Enter an email address.');
      const [requester, target] = await Promise.all([
        context.tables.getRow({ databaseId: context.databaseId, tableId: ids.profiles, rowId: userId }),
        context.users.list({ queries: [Query.equal('email', [email])], total: false }),
      ]);
      const recipient = target.users[0];
      if (recipient?.$id === userId) throw new Error('Choose someone other than yourself.');
      const recipientProfile = recipient ? await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.profiles, rowId: recipient.$id }) : null;
      const connection = await context.tables.createRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: ID.unique(), data: { requesterId: userId, recipientId: recipient?.$id ?? null, requesterEmail: requester.email, recipientEmail: email, requesterDisplayName: requester.displayName, recipientDisplayName: recipientProfile?.displayName ?? null, status: 'pending' }, permissions: permissions(userId, recipient?.$id) });
      if (recipient?.$id) await deliverOrQueue(context, recipient.$id, 'invitation', { title: 'ZO-ZAR invitation', body: `${requester.displayName} invited you to be a trusted person.` }, { kind: 'invitation', connectionId: connection.$id }, `invitation:${connection.$id}:${recipient.$id}`);
      return res.json({ connection });
    }

    if (action === 'claim-invitations') {
      const profile = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.profiles, rowId: userId });
      const pending = await list(context.tables, context.databaseId, ids.connections, [Query.equal('recipientEmail', [profile.email]), Query.equal('status', ['pending'])]);
      await Promise.all(pending.map((row) => context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: row.$id, data: { recipientId: userId, recipientDisplayName: profile.displayName }, permissions: permissions(row.requesterId, userId) })));
      return res.json({ claimed: pending.length });
    }

    if (action === 'respond-invitation') {
      const connection = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: payload.connectionId });
      if (connection.recipientId !== userId || connection.status !== 'pending') throw new Error('This invitation is no longer available.');
      const status = payload.accept ? 'accepted' : 'declined';
      await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: connection.$id, data: { status } });
      if (payload.accept) {
        const [participantA, participantB] = [connection.requesterId, connection.recipientId].sort();
        const existing = await list(context.tables, context.databaseId, ids.threads, [Query.equal('participantA', [participantA]), Query.equal('participantB', [participantB])]);
        if (!existing[0]) await context.tables.createRow({ databaseId: context.databaseId, tableId: ids.threads, rowId: ID.unique(), data: { participantA, participantB, retention: '30d', retentionChangedBy: userId, retentionChangedAt: new Date().toISOString() }, permissions: permissions(participantA, participantB) });
      }
      return res.json({ status });
    }

    if (action === 'remove-connection') {
      const connection = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: payload.connectionId });
      if (connection.requesterId !== userId && connection.recipientId !== userId) throw new Error('Trusted person was not found.');
      await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: connection.$id, data: { status: 'revoked' } });
      return res.json({ status: 'revoked' });
    }

    if (action === 'send-message') {
      const thread = await requireThread(context, userId, payload.threadId);
      const body = String(payload.body ?? '').trim();
      if (!body) throw new Error('Write a message first.');
      const message = await createMessage(context, thread, userId, 'text', body);
      const recipientId = thread.participantA === userId ? thread.participantB : thread.participantA;
      await deliverOrQueue(context, recipientId, 'chat', { title: 'New ZO-ZAR message', body: body.slice(0, 120) }, { kind: 'chat', threadId: thread.$id }, `message:${message.$id}:${recipientId}`);
      return res.json({ message });
    }

    if (action === 'finalize-voice-message') {
      const thread = await requireThread(context, userId, payload.threadId);
      await context.storage.updateFile({ bucketId: context.bucketId, fileId: payload.fileId, permissions: permissions(thread.participantA, thread.participantB) });
      const duration = Math.min(30, Math.max(1, Number(payload.durationSeconds) || 1));
      const message = await createMessage(context, thread, userId, 'voice', `Voice note · 0:${String(duration).padStart(2, '0')}`, payload.fileId);
      const recipientId = thread.participantA === userId ? thread.participantB : thread.participantA;
      await deliverOrQueue(context, recipientId, 'chat', { title: 'New ZO-ZAR voice note', body: 'Your trusted person sent a voice note.' }, { kind: 'chat', threadId: thread.$id }, `voice:${message.$id}:${recipientId}`);
      return res.json({ message });
    }

    if (action === 'set-chat-retention') {
      if (!['7d', '30d'].includes(payload.retention)) throw new Error('Choose one week or one month.');
      const thread = await requireThread(context, userId, payload.threadId);
      const updated = await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.threads, rowId: thread.$id, data: { retention: payload.retention, retentionChangedBy: userId, retentionChangedAt: new Date().toISOString() } });
      await createMessage(context, updated, userId, 'system', `Messages now disappear after ${payload.retention === '7d' ? '1 week' : '1 month'}.`);
      return res.json({ retention: payload.retention });
    }

    if (action === 'complete-wake') {
      const occurrence = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.occurrences, rowId: payload.occurrenceId });
      if (occurrence.userId !== userId) throw new Error('No active wake occurrence is available to confirm.');
      if (occurrence.status === 'confirmed') return res.json({ status: 'confirmed' });
      if (!['scheduled', 'ringing'].includes(occurrence.status)) throw new Error('No active wake occurrence is available to confirm.');
      await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.occurrences, rowId: occurrence.$id, data: { status: 'confirmed', confirmedAt: new Date().toISOString() } });
      return res.json({ status: 'confirmed' });
    }

    if (action === 'snooze-wake') {
      const occurrence = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.occurrences, rowId: payload.occurrenceId });
      if (occurrence.userId !== userId) throw new Error('This alarm cannot be snoozed.');
      if (Number(occurrence.snoozeCount ?? 0) >= 1) return res.json({ snoozeCount: 1 });
      await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.occurrences, rowId: occurrence.$id, data: { status: 'ringing', snoozeCount: 1 } });
      const plan = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.plans, rowId: occurrence.wakePlanId });
      if (plan.connectionId) {
        const connection = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.connections, rowId: plan.connectionId });
        const trustedId = connection.requesterId === userId ? connection.recipientId : connection.requesterId;
        if (trustedId) await deliverOrQueue(context, trustedId, 'snooze', { title: 'ZO-ZAR snooze alert', body: 'Your trusted person used their one five-minute snooze.' }, { kind: 'snooze', occurrenceId: occurrence.$id }, `snooze:${occurrence.$id}:${trustedId}`);
      }
      return res.json({ snoozeCount: 1 });
    }

    if (action === 'upsert-device-token') {
      const token = String(payload.token ?? '');
      if (!token) throw new Error('A Firebase token is required.');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const existing = await list(context.tables, context.databaseId, ids.deviceTokens, [Query.equal('tokenHash', [tokenHash])]);
      const data = { userId, token, tokenHash, platform: payload.platform, isActive: true, lastSeenAt: new Date().toISOString() };
      if (existing[0]) await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.deviceTokens, rowId: existing[0].$id, data, permissions: permissions(userId) });
      else await context.tables.createRow({ databaseId: context.databaseId, tableId: ids.deviceTokens, rowId: ID.unique(), data, permissions: permissions(userId) });
      return res.json({ saved: true });
    }

    if (action === 'set-profile-photo') {
      const profile = await context.tables.getRow({ databaseId: context.databaseId, tableId: ids.profiles, rowId: userId });
      const [outgoing, incoming] = await Promise.all([
        list(context.tables, context.databaseId, ids.connections, [Query.equal('requesterId', [userId]), Query.equal('status', ['accepted'])]),
        list(context.tables, context.databaseId, ids.connections, [Query.equal('recipientId', [userId]), Query.equal('status', ['accepted'])]),
      ]);
      const readers = [...outgoing.map((row) => row.recipientId), ...incoming.map((row) => row.requesterId)];
      await context.storage.updateFile({ bucketId: context.bucketId, fileId: payload.fileId, permissions: mediaPermissions(userId, readers) });
      await context.tables.updateRow({ databaseId: context.databaseId, tableId: ids.profiles, rowId: userId, data: { photoFileId: payload.fileId } });
      if (profile.photoFileId && profile.photoFileId !== payload.fileId) await context.storage.deleteFile({ bucketId: context.bucketId, fileId: profile.photoFileId }).catch(() => undefined);
      return res.json({ photoFileId: payload.fileId });
    }

    return res.json({ error: 'Unknown action.' }, 404);
  } catch (caught) {
    error(caught instanceof Error ? caught.stack ?? caught.message : String(caught));
    return res.json({ error: caught instanceof Error ? caught.message : 'Request failed.' }, 400);
  }
};
