import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { and, eq } from 'drizzle-orm';

import { getDatabase, schema, type Database } from '@/db/client';

/**
 * Pushes events to subscribed WebSocket connections, replacing Appwrite Realtime.
 *
 * The connection registry lives in Postgres rather than DynamoDB. That keeps the stack to
 * one datastore, and the rows are tiny and short-lived; the cost is a little of the
 * connection budget, which the WebSocket Lambda's concurrency ceiling already accounts for.
 */

export type RealtimeEvent = {
  type: 'message.created' | 'message.deleted' | 'thread.updated';
  threadId: string;
  payload: Record<string, unknown>;
};

export type Realtime = {
  publishToThread(event: RealtimeEvent, excludeConnectionId?: string): Promise<number>;
};

let client: ApiGatewayManagementApiClient | undefined;

function management(): ApiGatewayManagementApiClient {
  if (client) return client;
  const endpoint = process.env.WS_ENDPOINT?.trim();
  if (!endpoint) throw new Error('Missing required environment variable: WS_ENDPOINT');
  client ??= new ApiGatewayManagementApiClient({ endpoint });
  return client;
}

function apiGatewayRealtime(database: Database = getDatabase()): Realtime {
  return {
    async publishToThread(event, excludeConnectionId) {
      const subscribers = await database
        .select({ connectionId: schema.wsConnections.connectionId })
        .from(schema.wsConnections)
        .where(eq(schema.wsConnections.threadId, event.threadId));

      const body = Buffer.from(JSON.stringify(event));
      let delivered = 0;
      const dead: string[] = [];

      await Promise.all(
        subscribers.map(async ({ connectionId }) => {
          if (connectionId === excludeConnectionId) return;
          try {
            await management().send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: body }));
            delivered += 1;
          } catch (error) {
            // 410 Gone is how API Gateway reports a connection that has closed without a
            // $disconnect reaching us. It is the authoritative signal to drop the row,
            // so a stale registry self-heals rather than growing.
            const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
            if (status === 410) {
              dead.push(connectionId);
            } else {
              console.error('[realtime] could not post to connection', { connectionId, error });
            }
          }
        }),
      );

      if (dead.length > 0) {
        await Promise.all(
          dead.map((connectionId) =>
            database.delete(schema.wsConnections).where(eq(schema.wsConnections.connectionId, connectionId)),
          ),
        );
      }

      return delivered;
    },
  };
}

let override: Realtime | undefined;
let resolved: Realtime | undefined;

export function getRealtime(): Realtime {
  if (override) return override;
  resolved ??= apiGatewayRealtime();
  return resolved;
}

export function setRealtimeForTests(implementation: Realtime | null): void {
  override = implementation ?? undefined;
}

/**
 * Publishes without letting a realtime failure fail the request that caused it.
 *
 * A message is already durably stored by the time this runs, and the client will see it on
 * its next fetch, so a WebSocket problem must never turn a successful send into an error.
 * Realtime is an optimisation here, not the source of truth.
 */
export async function publishQuietly(event: RealtimeEvent): Promise<void> {
  try {
    await getRealtime().publishToThread(event);
  } catch (error) {
    console.error('[realtime] publish failed; clients will catch up on next fetch', { error });
  }
}

/** Registers a connection as watching a thread, after confirming the caller is in it. */
export async function subscribeConnection(
  database: Database,
  connectionId: string,
  userId: string,
  threadId: string,
): Promise<boolean> {
  const [thread] = await database
    .select({ a: schema.chatThreads.participantA, b: schema.chatThreads.participantB })
    .from(schema.chatThreads)
    .where(eq(schema.chatThreads.id, threadId))
    .limit(1);

  // Participation is re-checked here and not assumed from the connect-time token: a
  // client could otherwise subscribe to any thread id it guessed.
  if (!thread || (thread.a !== userId && thread.b !== userId)) return false;

  await database
    .update(schema.wsConnections)
    .set({ threadId, lastSeenAt: new Date() })
    .where(and(eq(schema.wsConnections.connectionId, connectionId), eq(schema.wsConnections.userId, userId)));

  return true;
}
