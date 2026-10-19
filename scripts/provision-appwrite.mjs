import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  Client,
  Functions,
  Permission,
  ProjectKeyScopes,
  Role,
  Runtime,
  Storage,
  TablesDB,
  TablesDBIndexType,
} from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const endpoint = process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const projectId = process.env.APPWRITE_PROJECT_ID || '6ab3b3be00371b1f265f';
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = 'zozar';
const bucketId = 'zozar-private';

if (!apiKey) throw new Error('Set APPWRITE_API_KEY for this command only. Never save it in the project.');

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tables = new TablesDB(client);
const storage = new Storage(client);
const functions = new Functions(client);

const userCreate = [Permission.create(Role.users())];

const schemas = [
  {
    id: 'profiles', name: 'Profiles', permissions: userCreate,
    columns: [varchar('email', 320, true), varchar('displayName', 128, true), varchar('timezone', 64, true), varchar('photoFileId', 36)],
    indexes: [unique('email_unique', ['email'])],
  },
  {
    id: 'commitments', name: 'Commitments', permissions: userCreate,
    columns: [varchar('userId', 36, true), varchar('title', 160, true), varchar('description', 500), datetime('startsAt', true), enumeration('status', ['planned', 'completed', 'archived'], true), datetime('completedAt')],
    indexes: [key('user_idx', ['userId']), key('user_starts_idx', ['userId', 'startsAt'])],
  },
  {
    id: 'wake_plans', name: 'Wake plans', permissions: userCreate,
    columns: [varchar('userId', 36, true), varchar('commitmentId', 36), varchar('connectionId', 36), enumeration('scheduleType', ['once', 'daily', 'weekly'], true), varchar('scheduledDate', 10), varchar('localTime', 5, true), varchar('timezone', 64, true), integer('weekdays', false, true), enumeration('difficulty', ['easy', 'medium', 'hard'], true), enumeration('soundKey', ['bright-rise', 'steady-pulse', 'summit-siren', 'default', 'zo-zar'], true), integer('graceMinutes', true), booleanColumn('isActive', true)],
    indexes: [key('user_idx', ['userId']), key('user_active_idx', ['userId', 'isActive'])],
  },
  {
    id: 'wake_occurrences', name: 'Wake occurrences', permissions: userCreate,
    columns: [varchar('wakePlanId', 36, true), varchar('userId', 36, true), varchar('commitmentId', 36), datetime('scheduledFor', true), enumeration('difficulty', ['easy', 'medium', 'hard'], true), integer('graceMinutes', true), varchar('challengePayload', 4096, true), enumeration('status', ['scheduled', 'ringing', 'confirmed', 'missed', 'escalated', 'cancelled'], true), datetime('triggeredAt'), datetime('confirmedAt'), datetime('escalatedAt'), integer('snoozeCount', true)],
    indexes: [key('user_idx', ['userId']), key('plan_idx', ['wakePlanId']), key('status_schedule_idx', ['status', 'scheduledFor'])],
  },
  {
    id: 'connections', name: 'Connections', permissions: [],
    columns: [varchar('requesterId', 36, true), varchar('recipientId', 36), varchar('requesterEmail', 320, true), varchar('recipientEmail', 320, true), varchar('requesterDisplayName', 128, true), varchar('recipientDisplayName', 128), enumeration('status', ['pending', 'accepted', 'declined', 'revoked'], true)],
    indexes: [key('requester_idx', ['requesterId']), key('recipient_idx', ['recipientId']), key('recipient_email_idx', ['recipientEmail']), unique('requester_email_unique', ['requesterId', 'recipientEmail'])],
  },
  {
    id: 'chat_threads', name: 'Chat threads', permissions: [],
    columns: [varchar('participantA', 36, true), varchar('participantB', 36, true), enumeration('retention', ['7d', '30d'], true), varchar('retentionChangedBy', 36, true), datetime('retentionChangedAt', true)],
    indexes: [key('participant_a_idx', ['participantA']), key('participant_b_idx', ['participantB']), unique('participants_unique', ['participantA', 'participantB'])],
  },
  {
    id: 'messages', name: 'Messages', permissions: [],
    columns: [varchar('threadId', 36, true), varchar('senderId', 36, true), enumeration('type', ['text', 'voice', 'system'], true), varchar('body', 4096), varchar('voicePath', 36), datetime('createdAt', true), datetime('expiresAt', true)],
    indexes: [key('thread_created_idx', ['threadId', 'createdAt']), key('expires_idx', ['expiresAt'])],
  },
  {
    id: 'device_tokens', name: 'Device tokens', permissions: [],
    columns: [varchar('userId', 36, true), varchar('token', 4096, true), varchar('tokenHash', 64, true), enumeration('platform', ['android', 'ios'], true), booleanColumn('isActive', true), datetime('lastSeenAt', true)],
    indexes: [key('user_idx', ['userId']), unique('token_hash_unique', ['tokenHash'])],
  },
  {
    id: 'notification_jobs', name: 'Notification jobs', permissions: [],
    columns: [varchar('userId', 36, true), varchar('token', 4096), varchar('kind', 64, true), varchar('payload', 8192, true), enumeration('status', ['pending', 'sent', 'retry', 'failed'], true), integer('attempts', true), datetime('nextAttemptAt', true), varchar('dedupeKey', 128, true), varchar('lastError', 1000)],
    indexes: [unique('dedupe_unique', ['dedupeKey']), key('status_next_idx', ['status', 'nextAttemptAt'])],
  },
];

function varchar(keyName, size, required = false, array = false) { return { key: keyName, type: 'varchar', size, required, array }; }
function datetime(keyName, required = false) { return { key: keyName, type: 'datetime', required }; }
function enumeration(keyName, elements, required = false) { return { key: keyName, type: 'enum', elements, required }; }
function integer(keyName, required = false, array = false) { return { key: keyName, type: 'integer', required, array }; }
function booleanColumn(keyName, required = false) { return { key: keyName, type: 'boolean', required }; }
function key(keyName, attributes) { return { key: keyName, type: TablesDBIndexType.Key, attributes, orders: attributes.map(() => 'ASC') }; }
function unique(keyName, attributes) { return { key: keyName, type: TablesDBIndexType.Unique, attributes, orders: attributes.map(() => 'ASC') }; }

async function exists(operation) {
  try { return await operation(); }
  catch (caught) { if (caught?.code === 404) return null; throw caught; }
}

async function ensureDatabase() {
  if (await exists(() => tables.get({ databaseId }))) return;
  await tables.create({ databaseId, name: 'ZO-ZAR', enabled: true });
  console.log('Created database zozar');
}

async function ensureTables() {
  for (const schema of schemas) {
    if (await exists(() => tables.getTable({ databaseId, tableId: schema.id }))) continue;
    await tables.createTable({ databaseId, tableId: schema.id, name: schema.name, permissions: schema.permissions, rowSecurity: true, enabled: true, columns: schema.columns, indexes: schema.indexes });
    console.log(`Created table ${schema.id}`);
  }
}

async function ensureBucket() {
  if (await exists(() => storage.getBucket({ bucketId }))) return;
  await storage.createBucket({ bucketId, name: 'ZO-ZAR private files', permissions: [Permission.create(Role.users())], fileSecurity: true, enabled: true, maximumFileSize: 10 * 1024 * 1024, allowedFileExtensions: ['jpg', 'jpeg', 'png', 'm4a', 'aac'], encryption: true, antivirus: true, transformations: true });
  console.log('Created private storage bucket');
}

const dynamicScopes = [
  ProjectKeyScopes.UsersRead,
  ProjectKeyScopes.DatabasesRead,
  ProjectKeyScopes.TablesRead,
  ProjectKeyScopes.RowsRead,
  ProjectKeyScopes.RowsWrite,
  ProjectKeyScopes.BucketsRead,
  ProjectKeyScopes.FilesRead,
  ProjectKeyScopes.FilesWrite,
];

async function ensureFunction(functionId, name, schedule, execute) {
  const existing = await exists(() => functions.get({ functionId }));
  if (!existing) {
    await functions.create({ functionId, name, runtime: Runtime.Node22, execute, schedule, timeout: 60, enabled: true, logging: true, entrypoint: 'src/main.js', commands: 'npm install', scopes: dynamicScopes, deploymentRetention: 3 });
    console.log(`Created function ${functionId}`);
  }
  const variables = await functions.listVariables({ functionId, total: false });
  for (const [variableId, keyName, value] of [
    ['database-id', 'APPWRITE_DATABASE_ID', databaseId],
    ['storage-bucket-id', 'APPWRITE_STORAGE_BUCKET_ID', bucketId],
  ]) {
    if (!variables.variables.some((variable) => variable.key === keyName)) {
      await functions.createVariable({ functionId, variableId: `${functionId}-${variableId}`, key: keyName, value, secret: false });
    }
  }
}

function packageFunction(functionId) {
  const source = resolve('appwrite/functions', functionId);
  const temporary = mkdtempSync(join(tmpdir(), `zozar-${functionId}-`));
  const archive = join(temporary, `${functionId}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);
  return { archive, temporary };
}

async function deployFunction(functionId) {
  const { archive, temporary } = packageFunction(functionId);
  try {
    const deployment = await functions.createDeployment({ functionId, code: InputFile.fromPath(archive), activate: true, entrypoint: 'src/main.js', commands: 'npm install' });
    console.log(`Queued deployment ${deployment.$id} for ${functionId}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

await ensureDatabase();
await ensureTables();
await ensureBucket();
await ensureFunction('zozar-actions', 'ZO-ZAR actions', '', [Role.users()]);
await ensureFunction('zozar-maintenance', 'ZO-ZAR maintenance', '* * * * *', []);
await deployFunction('zozar-actions');
await deployFunction('zozar-maintenance');

console.log(JSON.stringify({ endpoint, projectId, databaseId, bucketId, actionsFunctionId: 'zozar-actions', maintenanceFunctionId: 'zozar-maintenance' }, null, 2));
