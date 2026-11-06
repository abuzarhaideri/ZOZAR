import { and, asc, eq, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';

import { getDatabase, schema, type Database } from '@/db/client';
import { generateChallenge } from '@/domain/challenge';
import { ScheduleError, nextOccurrence } from '@/domain/schedule';
import { getNotifier, type Notifier } from '@/lib/push';
import { getStorage } from '@/lib/storage';

/**
 * Scheduled work, run on a fixed interval by a Catalyst cron calling /internal/run-worker.
 *
 * Every task is idempotent and bounded. Idempotent because the trigger guarantees
 * at-least-once delivery and two overlapping runs must not double-escalate or
 * double-notify; bounded because this Lambda holds a scarce database connection and must
 * never run long enough to be killed mid-sweep.
 */

/** Deliberately small. The worker runs often, so a backlog drains over several passes
 * rather than one long invocation holding a connection open. */
const BATCH = 100;

export type TaskReport = Record<string, number>;

/**
 * Queues the next ring for every active plan that has none.
 *
 * Routes materialise on create and edit, but a recurring plan needs a fresh occurrence
 * after each one fires, and nothing in a request path runs at that moment. This is what
 * keeps a daily alarm ringing tomorrow.
 */
export async function materialiseOccurrences(database: Database = getDatabase()): Promise<TaskReport> {
  const plans = await database
    .select({
      id: schema.wakePlans.id,
      userId: schema.wakePlans.userId,
      commitmentId: schema.wakePlans.commitmentId,
      scheduleType: schema.wakePlans.scheduleType,
      scheduledDate: schema.wakePlans.scheduledDate,
      localTime: schema.wakePlans.localTime,
      timezone: schema.wakePlans.timezone,
      weekdays: schema.wakePlans.weekdays,
      difficulty: schema.wakePlans.difficulty,
      graceMinutes: schema.wakePlans.graceMinutes,
    })
    .from(schema.wakePlans)
    .where(
      and(
        eq(schema.wakePlans.isActive, true),
        // Only plans with nothing queued. A correlated NOT EXISTS keeps this to one
        // round trip instead of a query per plan.
        sql`not exists (
          select 1 from ${schema.wakeOccurrences}
          where ${schema.wakeOccurrences.wakePlanId} = ${schema.wakePlans.id}
            and ${schema.wakeOccurrences.status} = 'scheduled'
        )`,
      ),
    )
    .limit(BATCH);

  let queued = 0;
  let unschedulable = 0;

  for (const plan of plans) {
    let instant: Date | null = null;
    try {
      instant = nextOccurrence(
        {
          scheduleType: plan.scheduleType,
          scheduledDate: plan.scheduledDate,
          localTime: plan.localTime,
          timezone: plan.timezone,
          weekdays: plan.weekdays,
        },
        new Date(),
      );
    } catch (error) {
      // One malformed plan must not stop the sweep for everyone else.
      if (error instanceof ScheduleError) {
        unschedulable += 1;
        console.warn('[worker] plan cannot be scheduled', { planId: plan.id, reason: error.message });
        continue;
      }
      throw error;
    }

    // A one-time plan whose moment has passed. Deactivate it so it is not reconsidered
    // on every future pass.
    if (!instant) {
      await database
        .update(schema.wakePlans)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.wakePlans.id, plan.id));
      continue;
    }

    const inserted = await database
      .insert(schema.wakeOccurrences)
      .values({
        wakePlanId: plan.id,
        userId: plan.userId,
        commitmentId: plan.commitmentId,
        scheduledFor: instant,
        difficulty: plan.difficulty,
        graceMinutes: plan.graceMinutes,
        challengePayload: generateChallenge(plan.difficulty),
      })
      // The unique index on (wake_plan_id, scheduled_for) makes a concurrent run or a
      // retry harmless.
      .onConflictDoNothing({
        target: [schema.wakeOccurrences.wakePlanId, schema.wakeOccurrences.scheduledFor],
      })
      .returning({ id: schema.wakeOccurrences.id });

    if (inserted.length > 0) queued += 1;
  }

  return { plansConsidered: plans.length, queued, unschedulable };
}

/**
 * Escalates wakes that passed their grace period unconfirmed.
 *
 * This is the product's actual promise, so it is the one task that must not silently do
 * nothing. The status change and the notification job are written in one transaction:
 * marking an occurrence escalated without queueing the message would leave the trusted
 * person unaware, which is the exact failure the feature exists to prevent.
 */
export async function escalateMissedWakes(database: Database = getDatabase()): Promise<TaskReport> {
  const overdue = await database
    .select({
      id: schema.wakeOccurrences.id,
      userId: schema.wakeOccurrences.userId,
      wakePlanId: schema.wakeOccurrences.wakePlanId,
      scheduledFor: schema.wakeOccurrences.scheduledFor,
    })
    .from(schema.wakeOccurrences)
    .where(
      and(
        inArray(schema.wakeOccurrences.status, ['scheduled', 'ringing']),
        // grace_minutes is per occurrence, so the deadline is computed in SQL rather than
        // filtered in memory over every pending row.
        sql`${schema.wakeOccurrences.scheduledFor} + make_interval(mins => ${schema.wakeOccurrences.graceMinutes}) < now()`,
      ),
    )
    .orderBy(asc(schema.wakeOccurrences.scheduledFor))
    .limit(BATCH);

  let escalated = 0;
  let notified = 0;

  for (const occurrence of overdue) {
    // Who is protecting this wake, if anyone.
    const [plan] = await database
      .select({ connectionId: schema.wakePlans.connectionId })
      .from(schema.wakePlans)
      .where(eq(schema.wakePlans.id, occurrence.wakePlanId))
      .limit(1);

    let trustedUserId: string | null = null;
    if (plan?.connectionId) {
      const [connection] = await database
        .select({
          requesterId: schema.connections.requesterId,
          recipientId: schema.connections.recipientId,
          status: schema.connections.status,
        })
        .from(schema.connections)
        .where(eq(schema.connections.id, plan.connectionId))
        .limit(1);

      // Only a still-accepted connection counts. A revoked trusted person must not be
      // messaged, and a pending one never agreed to this.
      if (connection?.status === 'accepted') {
        trustedUserId =
          connection.requesterId === occurrence.userId ? connection.recipientId : connection.requesterId;
      }
    }

    const [sleeper] = await database
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, occurrence.userId))
      .limit(1);

    await database.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.wakeOccurrences)
        .set({
          status: trustedUserId ? 'escalated' : 'missed',
          escalatedAt: trustedUserId ? new Date() : null,
          updatedAt: new Date(),
        })
        // Re-check the status inside the update so two overlapping runs cannot both claim
        // the same occurrence.
        .where(
          and(
            eq(schema.wakeOccurrences.id, occurrence.id),
            inArray(schema.wakeOccurrences.status, ['scheduled', 'ringing']),
          ),
        )
        .returning({ id: schema.wakeOccurrences.id });

      if (!claimed) return;
      escalated += 1;

      if (!trustedUserId) return;

      await tx
        .insert(schema.notificationJobs)
        .values({
          userId: trustedUserId,
          kind: 'missed_wake',
          payload: {
            occurrenceId: occurrence.id,
            sleeperName: sleeper?.displayName ?? 'Someone you look out for',
            scheduledFor: occurrence.scheduledFor.toISOString(),
          },
          // One job per occurrence, forever. This is what stops a retried run from
          // notifying the same person twice about the same morning.
          dedupeKey: `missed_wake:${occurrence.id}`,
        })
        .onConflictDoNothing({ target: schema.notificationJobs.dedupeKey });

      notified += 1;
    });
  }

  return { overdue: overdue.length, escalated, notified };
}

const MAX_ATTEMPTS = 5;

/**
 * Delivers queued notifications.
 *
 * Jobs are a durable outbox rather than a direct send, because a push that fails because
 * FCM was briefly unavailable still has to arrive. Backoff is exponential so a sustained
 * outage does not become a tight retry loop.
 */
export async function deliverNotifications(
  database: Database = getDatabase(),
  notifier: Notifier = getNotifier(),
): Promise<TaskReport> {
  const due = await database
    .select({
      id: schema.notificationJobs.id,
      userId: schema.notificationJobs.userId,
      kind: schema.notificationJobs.kind,
      payload: schema.notificationJobs.payload,
      attempts: schema.notificationJobs.attempts,
    })
    .from(schema.notificationJobs)
    .where(
      and(
        inArray(schema.notificationJobs.status, ['pending', 'retry']),
        lte(schema.notificationJobs.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(asc(schema.notificationJobs.nextAttemptAt))
    .limit(BATCH);

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let deactivated = 0;

  for (const job of due) {
    const devices = await database
      .select({ id: schema.deviceTokens.id, token: schema.deviceTokens.token })
      .from(schema.deviceTokens)
      .where(and(eq(schema.deviceTokens.userId, job.userId), eq(schema.deviceTokens.isActive, true)));

    const payload = job.payload as { sleeperName?: string; occurrenceId?: string };
    const message = {
      title: 'Missed wake-up',
      body: `${payload.sleeperName ?? 'Someone'} did not confirm their alarm.`,
      data: { kind: job.kind, occurrenceId: payload.occurrenceId ?? '' },
    };

    let anyDelivered = false;
    let lastError = '';

    for (const device of devices) {
      const result = await notifier.send({ token: device.token, ...message });
      if (result.ok) {
        anyDelivered = true;
        continue;
      }
      lastError = result.error;
      if (result.invalidToken) {
        // FCM says this token is dead. Retrying it forever would mean the job never
        // settles, so the device is deactivated instead.
        await database
          .update(schema.deviceTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.deviceTokens.id, device.id));
        deactivated += 1;
      }
    }

    const attempts = job.attempts + 1;

    // No active device is a terminal state, not a transient one: there is nothing to
    // retry until the user signs in again, which creates a new job of its own.
    if (devices.length === 0) {
      await settle(database, job.id, 'failed', attempts, 'no active device tokens');
      failed += 1;
      continue;
    }

    if (anyDelivered) {
      await settle(database, job.id, 'sent', attempts, null);
      sent += 1;
      continue;
    }

    if (attempts >= MAX_ATTEMPTS) {
      await settle(database, job.id, 'failed', attempts, lastError || 'delivery failed');
      failed += 1;
      continue;
    }

    // 1, 2, 4, 8 minutes.
    const delayMinutes = 2 ** (attempts - 1);
    await database
      .update(schema.notificationJobs)
      .set({
        status: 'retry',
        attempts,
        lastError: (lastError || 'delivery failed').slice(0, 1000),
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        updatedAt: new Date(),
      })
      .where(eq(schema.notificationJobs.id, job.id));
    retried += 1;
  }

  return { due: due.length, sent, retried, failed, deactivated };
}

async function settle(
  database: Database,
  id: string,
  status: 'sent' | 'failed',
  attempts: number,
  error: string | null,
): Promise<void> {
  await database
    .update(schema.notificationJobs)
    .set({ status, attempts, lastError: error?.slice(0, 1000) ?? null, updatedAt: new Date() })
    .where(eq(schema.notificationJobs.id, id));
}

/**
 * Deletes expired messages and the audio they referenced.
 *
 * Reads already filter on expiry, so this is about honouring the retention promise in
 * storage rather than only in the API. The S3 object is removed before the row, because
 * losing the row first would orphan the object with nothing left pointing at it.
 */
export async function sweepExpiredMessages(database: Database = getDatabase()): Promise<TaskReport> {
  const expired = await database
    .select({ id: schema.messages.id, voiceKey: schema.messages.voiceKey })
    .from(schema.messages)
    .where(lt(schema.messages.expiresAt, new Date()))
    .limit(BATCH);

  if (expired.length === 0) return { messages: 0, objects: 0 };

  const storage = getStorage();
  let objects = 0;

  // Only rows whose audio is actually gone may be deleted. A row is the one remaining
  // pointer to its object, so dropping it after a failed removal would strand the file in
  // the bucket with nothing left to find it by — the retention promise would be broken in
  // storage while looking satisfied in the database.
  const deletable: string[] = [];
  let stranded = 0;

  for (const message of expired) {
    if (!message.voiceKey) {
      deletable.push(message.id);
      continue;
    }
    try {
      await storage.remove(message.voiceKey);
      objects += 1;
      deletable.push(message.id);
    } catch (error) {
      stranded += 1;
      console.error('[worker] could not remove expired voice note; retrying next pass', {
        key: message.voiceKey,
        error,
      });
    }
  }

  if (deletable.length > 0) {
    await database.delete(schema.messages).where(inArray(schema.messages.id, deletable));
  }

  return { messages: deletable.length, objects, stranded };
}

/** Housekeeping: spent refresh tokens and WebSocket rows left behind by connections that
 * dropped without a $disconnect. Neither is correctness-critical, but both grow forever. */
export async function sweepStaleRows(database: Database = getDatabase()): Promise<TaskReport> {
  const expiredTokens = await database
    .delete(schema.refreshTokens)
    .where(
      or(
        lt(schema.refreshTokens.expiresAt, new Date()),
        and(
          isNotNull(schema.refreshTokens.revokedAt),
          lt(schema.refreshTokens.revokedAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      ),
    )
    .returning({ id: schema.refreshTokens.id });

  const staleConnections = await database
    .delete(schema.wsConnections)
    .where(lt(schema.wsConnections.lastSeenAt, new Date(Date.now() - 24 * 3600_000)))
    .returning({ connectionId: schema.wsConnections.connectionId });

  return { refreshTokens: expiredTokens.length, wsConnections: staleConnections.length };
}

/** Runs every task, reporting each independently so one failure does not hide the others'
 * results in the Catalyst logs. */
export async function runAllTasks(): Promise<Record<string, TaskReport | { error: string }>> {
  const tasks = {
    materialiseOccurrences,
    escalateMissedWakes,
    deliverNotifications: () => deliverNotifications(),
    sweepExpiredMessages,
    sweepStaleRows,
  };

  const report: Record<string, TaskReport | { error: string }> = {};
  for (const [name, task] of Object.entries(tasks)) {
    try {
      report[name] = await task();
    } catch (error) {
      console.error(`[worker] ${name} failed`, error);
      report[name] = { error: (error as Error)?.message ?? String(error) };
    }
  }
  return report;
}
