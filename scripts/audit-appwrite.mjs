#!/usr/bin/env node
/**
 * Read-only audit of the Appwrite project, run before migrating to Aiven.
 *
 * Usage:
 *   APPWRITE_API_KEY=your_key npm run audit:appwrite
 *
 * Everything else is read from .env.local.
 *
 * Reports how much data actually exists so the migration can be sized: a few test rows
 * need a single-pass script, while real history needs batching, resumable checkpoints and
 * a verification pass. Guessing wrong in either direction wastes effort.
 *
 * This script only ever calls list and get. It creates, updates and deletes nothing, so it
 * is safe to run against production as often as you like.
 *
 * Usage:
 *   APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node scripts/audit-appwrite.mjs
 *
 * The API key needs read scope on databases, storage and users. Create one in the Appwrite
 * console under Overview > Integrations > API keys. Do not commit it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Client, Query, Storage, TablesDB, Users } from 'node-appwrite';

/**
 * Reads .env.local for the resource ids.
 *
 * Only the API key has to be supplied by hand. The project, database and bucket ids are
 * already in .env.local because the app shipped with them — they are public client
 * configuration, not secrets. Making the operator retype them was needless friction and
 * an easy way to audit the wrong project.
 *
 * The API key is deliberately NOT read from a file: it is a real credential, it does not
 * belong in a client env file, and it should live only in the shell for the one command
 * that needs it.
 */
function readEnvLocal() {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  try {
    const values = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return values;
  } catch {
    return {};
  }
}

const local = readEnvLocal();

const first = (...values) => values.map((v) => v?.trim()).find((v) => v);

const config = {
  endpoint: first(process.env.APPWRITE_ENDPOINT, 'https://sgp.cloud.appwrite.io/v1'),
  projectId: first(process.env.APPWRITE_PROJECT_ID, local.EXPO_PUBLIC_APPWRITE_PROJECT_ID),
  apiKey: first(process.env.APPWRITE_API_KEY),
  databaseId: first(process.env.APPWRITE_DATABASE_ID, local.EXPO_PUBLIC_APPWRITE_DATABASE_ID, 'zozar'),
  bucketId: first(
    process.env.APPWRITE_STORAGE_BUCKET_ID,
    local.EXPO_PUBLIC_APPWRITE_STORAGE_BUCKET_ID,
    'zozar-private',
  ),
};

const TABLES = [
  'profiles',
  'commitments',
  'wake_plans',
  'wake_occurrences',
  'connections',
  'chat_threads',
  'messages',
  'device_tokens',
  'notification_jobs',
];

function fail(message) {
  console.error(`\nerror: ${message}\n`);
  process.exit(1);
}

if (!config.projectId) {
  fail('No project id. Set APPWRITE_PROJECT_ID, or put EXPO_PUBLIC_APPWRITE_PROJECT_ID in .env.local.');
}
if (!config.apiKey) {
  fail(
    'APPWRITE_API_KEY is not set.\n\n' +
      'Create a read-scoped key in the Appwrite console under\n' +
      '  Overview > Integrations > API keys\n' +
      'with read access to databases, storage and users, then run:\n\n' +
      '  APPWRITE_API_KEY=your_key npm run audit:appwrite\n',
  );
}

const client = new Client()
  .setEndpoint(config.endpoint)
  .setProject(config.projectId)
  .setKey(config.apiKey);

const tablesDb = new TablesDB(client);
const storage = new Storage(client);
const users = new Users(client);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Appwrite returns `total` only when explicitly asked, and a page of rows alongside it.
 * One row is enough to sample the shape without pulling the table down. */
async function auditTable(tableId) {
  try {
    const result = await tablesDb.listRows({
      databaseId: config.databaseId,
      tableId,
      queries: [Query.limit(1), Query.orderAsc('$createdAt')],
      total: true,
    });
    const oldest = result.rows[0]?.$createdAt ?? null;

    let newest = null;
    if (result.total > 1) {
      const recent = await tablesDb.listRows({
        databaseId: config.databaseId,
        tableId,
        queries: [Query.limit(1), Query.orderDesc('$createdAt')],
        total: false,
      });
      newest = recent.rows[0]?.$createdAt ?? null;
    } else {
      newest = oldest;
    }

    return { tableId, total: result.total, oldest, newest, error: null };
  } catch (error) {
    return { tableId, total: null, oldest: null, newest: null, error: describe(error) };
  }
}

function describe(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.message ?? String(error)}${code}`;
}

function day(iso) {
  return iso ? iso.slice(0, 10) : '—';
}

async function auditStorage() {
  let count = 0;
  let bytes = 0;
  let cursor = null;

  try {
    for (;;) {
      const queries = [Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await storage.listFiles({ bucketId: config.bucketId, queries, total: false });
      if (page.files.length === 0) break;
      for (const file of page.files) {
        count += 1;
        bytes += file.sizeOriginal ?? 0;
      }
      cursor = page.files.at(-1).$id;
      // Paginating by cursor rather than offset, because offset paging degrades and
      // silently caps out on large buckets.
      if (page.files.length < 100) break;
    }
    return { count, bytes, error: null };
  } catch (error) {
    return { count, bytes, error: describe(error) };
  }
}

async function auditUsers() {
  try {
    const result = await users.list({ queries: [Query.limit(1)], total: true });
    return { total: result.total, error: null };
  } catch (error) {
    return { total: null, error: describe(error) };
  }
}

async function main() {
  console.log('ZO-ZAR Appwrite audit (read-only)');
  console.log(`  endpoint ${config.endpoint}`);
  console.log(`  project  ${config.projectId}`);
  console.log(`  database ${config.databaseId}`);
  console.log(`  bucket   ${config.bucketId}\n`);

  const accounts = await auditUsers();
  if (accounts.error) {
    console.log(`auth accounts: unavailable — ${accounts.error}`);
  } else {
    console.log(`auth accounts: ${accounts.total}`);
  }

  const results = [];
  for (const tableId of TABLES) {
    results.push(await auditTable(tableId));
  }

  console.log('\ntable                 rows    oldest       newest');
  console.log('─'.repeat(54));
  let totalRows = 0;
  for (const row of results) {
    if (row.error) {
      console.log(`${row.tableId.padEnd(21)} ${'—'.padStart(5)}   ${row.error}`);
      continue;
    }
    totalRows += row.total;
    console.log(
      `${row.tableId.padEnd(21)} ${String(row.total).padStart(5)}   ${day(row.oldest).padEnd(12)} ${day(row.newest)}`,
    );
  }
  console.log('─'.repeat(54));
  console.log(`${'total'.padEnd(21)} ${String(totalRows).padStart(5)}`);

  const files = await auditStorage();
  if (files.error) {
    console.log(`\nstorage: ${files.count} files counted before failing — ${files.error}`);
  } else {
    console.log(`\nstorage: ${files.count} files, ${formatBytes(files.bytes)}`);
  }

  // The thresholds are judgement calls, not science: the point is whether a single pass
  // can finish well inside Appwrite's rate limits and a Lambda-free local run.
  console.log('\nverdict');
  if (totalRows === 0 && files.count === 0) {
    console.log('  Nothing to migrate. Start the Aiven schema clean and re-register.');
  } else if (totalRows < 1000 && files.count < 200) {
    console.log('  Small. A single-pass migration script is sufficient.');
    console.log(`  ${totalRows} rows and ${files.count} files will move in one run.`);
  } else {
    console.log('  Large enough to need batching, resumable checkpoints and a verification pass.');
    console.log(`  ${totalRows} rows and ${files.count} files.`);
  }
  console.log('');
}

main().catch((error) => fail(describe(error)));
