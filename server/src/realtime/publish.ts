import { and, eq, inArray } from 'drizzle-orm';

import { getDatabase, schema, type Database } from '@/db/client';
import { getNotifier } from '@/lib/push';

/**
 * Pushes events to the other people in a conversation.
 *
 * This used to be API Gateway WebSockets: clients held a socket, a registry table mapped
 * socket to thread, and the server posted frames to each one. Catalyst has no equivalent
 * — serverless functions cannot accept a socket at all, and AppSail caps every request at
 * thirty seconds and recycles instances after five minutes, so a long-lived connection
 * cannot exist there no matter how it is written. Cross-instance fan-out has nothing to
 * sit on either, since Catalyst offers no pub/sub.
 *
 * So realtime is now a silent FCM data message: the server wakes the recipient's app and
 * the app fetches. The device already holds an FCM connection for alarms, so this adds no
 * new transport and no new credential.
 *
 * What changes for the product: delivery is near-real-time rather than instant, and a
 * device with notifications revoked will not be nudged — it still sees the message on its
 * next fetch. Nothing is lost, because the message was durably stored before this ran;
 * this only decides how quickly the other phone finds out.
 */

export type RealtimeEvent = {
  type: 'message.created' | 'message.deleted' | 'thread.updated';
  threadId: string;
  payload: Record<string, unknown>;
};

export type Realtime = {
  /**
   * Returns the number of devices nudged.
   *
   * `excludeUserId` defaults to the event's own `senderId`, so the person who caused the
   * event is not woken by it.
   */
  publishToThread(event: RealtimeEvent, excludeUserId?: string): Promise<number>;
};

function pushRealtime(database: Database = getDatabase()): Realtime {
  return {
    async publishToThread(event, excludeUserId) {
      const [thread] = await database
        .select({ a: schema.chatThreads.participantA, b: schema.chatThreads.participantB })
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.id, event.threadId))
        .limit(1);
      if (!thread) return 0;

      const sender = typeof event.payload.senderId === 'string' ? event.payload.senderId : undefined;
      const excluded = excludeUserId ?? sender;
      const recipients = [thread.a, thread.b].filter(
        (id): id is string => typeof id === 'string' && id !== excluded,
      );
      if (recipients.length === 0) return 0;

      const devices = await database
        .select({ id: schema.deviceTokens.id, token: schema.deviceTokens.token })
        .from(schema.deviceTokens)
        .where(
          and(inArray(schema.deviceTokens.userId, recipients), eq(schema.deviceTokens.isActive, true)),
        );
      if (devices.length === 0) return 0;

      const notifier = getNotifier();
      // Every value in an FCM data payload must be a string, so the event is flattened
      // rather than nested. The client reads these keys and refetches; the payload is
      // deliberately only an identifier, never message content, so a push cannot leak a
      // conversation to a notification log.
      const data: Record<string, string> = {
        type: event.type,
        threadId: event.threadId,
        ...(typeof event.payload.messageId === 'string' ? { messageId: event.payload.messageId } : {}),
      };

      const stale: string[] = [];
      let delivered = 0;

      await Promise.all(
        devices.map(async (device) => {
          const result = await notifier.send({
            token: device.token,
            title: 'ZO-ZAR',
            body: 'New activity',
            data,
            silent: true,
          });
          if (result.ok) {
            delivered += 1;
          } else if (result.invalidToken) {
            // The FCM equivalent of API Gateway's 410 Gone: the token will never work
            // again, so the row is deactivated and the registry self-heals.
            stale.push(device.id);
          } else {
            console.error('[realtime] could not nudge device', { deviceId: device.id, error: result.error });
          }
        }),
      );

      if (stale.length > 0) {
        await database
          .update(schema.deviceTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(schema.deviceTokens.id, stale));
      }

      return delivered;
    },
  };
}

let override: Realtime | undefined;
let resolved: Realtime | undefined;

export function getRealtime(): Realtime {
  if (override) return override;
  resolved ??= pushRealtime();
  return resolved;
}

export function setRealtimeForTests(implementation: Realtime | null): void {
  override = implementation ?? undefined;
}

/**
 * Publishes without letting a realtime failure fail the request that caused it.
 *
 * A message is already durably stored by the time this runs, and the client will see it on
 * its next fetch, so a push problem must never turn a successful send into an error.
 * Realtime is an optimisation here, not the source of truth.
 */
export async function publishQuietly(event: RealtimeEvent): Promise<void> {
  try {
    await getRealtime().publishToThread(event);
  } catch (error) {
    console.error('[realtime] publish failed; clients will catch up on next fetch', { error });
  }
}
