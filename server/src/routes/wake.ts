import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema, type Database } from '@/db/client';
import { generateChallenge } from '@/domain/challenge';
import { ScheduleError, nextOccurrence } from '@/domain/schedule';
import { badRequest, conflict, parseBody, timezoneSchema, type AppEnv } from '@/lib/http';
import { requireOwned, requireSomeFields, session, uuidParam } from '@/lib/resources';

export const wakePlanRoutes = new Hono<AppEnv>();
export const wakeOccurrenceRoutes = new Hono<AppEnv>();

/**
 * Three active plans per account.
 *
 * This limit existed only in the client before, where it was advice rather than a rule:
 * anything holding an Appwrite session could have written a fourth. It belongs here.
 */
const MAX_WAKE_PLANS = 3;

const PLAN_COLUMNS = {
  id: schema.wakePlans.id,
  userId: schema.wakePlans.userId,
  commitmentId: schema.wakePlans.commitmentId,
  connectionId: schema.wakePlans.connectionId,
  scheduleType: schema.wakePlans.scheduleType,
  scheduledDate: schema.wakePlans.scheduledDate,
  localTime: schema.wakePlans.localTime,
  timezone: schema.wakePlans.timezone,
  weekdays: schema.wakePlans.weekdays,
  difficulty: schema.wakePlans.difficulty,
  soundKey: schema.wakePlans.soundKey,
  graceMinutes: schema.wakePlans.graceMinutes,
  isActive: schema.wakePlans.isActive,
  createdAt: schema.wakePlans.createdAt,
  updatedAt: schema.wakePlans.updatedAt,
} as const;

const OCCURRENCE_COLUMNS = {
  id: schema.wakeOccurrences.id,
  wakePlanId: schema.wakeOccurrences.wakePlanId,
  userId: schema.wakeOccurrences.userId,
  commitmentId: schema.wakeOccurrences.commitmentId,
  scheduledFor: schema.wakeOccurrences.scheduledFor,
  difficulty: schema.wakeOccurrences.difficulty,
  graceMinutes: schema.wakeOccurrences.graceMinutes,
  challengePayload: schema.wakeOccurrences.challengePayload,
  status: schema.wakeOccurrences.status,
  triggeredAt: schema.wakeOccurrences.triggeredAt,
  confirmedAt: schema.wakeOccurrences.confirmedAt,
  escalatedAt: schema.wakeOccurrences.escalatedAt,
  snoozeCount: schema.wakeOccurrences.snoozeCount,
} as const;

const scheduleFields = {
  scheduleType: z.enum(['once', 'daily', 'weekly']),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').nullish(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM.'),
  timezone: timezoneSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  soundKey: z.enum(['bright-rise', 'steady-pulse', 'summit-siren', 'default', 'zo-zar']).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
  commitmentId: z.uuid().nullish(),
  connectionId: z.uuid().nullish(),
  isActive: z.boolean().optional(),
};

type PlanRow = {
  id: string;
  scheduleType: 'once' | 'daily' | 'weekly';
  scheduledDate: string | null;
  localTime: string;
  timezone: string;
  weekdays: number[];
  difficulty: 'easy' | 'medium' | 'hard';
  graceMinutes: number;
  isActive: boolean;
  userId: string;
  commitmentId: string | null;
};

/**
 * Creates the occurrence row for a plan's next ring, if there is one.
 *
 * The challenge is generated and stored now rather than at ring time, because the device
 * has to be able to ring and accept an answer with no network. A one-time plan whose
 * moment has passed yields nothing, which is why `nextOccurrence` returning null is a
 * normal outcome here and not an error.
 *
 * The unique index on (wake_plan_id, scheduled_for) makes this safe to call repeatedly: a
 * retried request or a concurrent worker sweep cannot double-book the same instant.
 *
 * On conflict it revives a *cancelled* row rather than doing nothing. Pausing a plan
 * cancels its queued occurrence, and resuming recomputes the very same instant, so
 * `onConflictDoNothing` left the plan with no scheduled occurrence at all — the alarm was
 * silently dead for good. The `setWhere` guard keeps that revival narrow: a confirmed,
 * missed or escalated occurrence is never resurrected, because that would erase a wake
 * the user actually completed, and an already-scheduled one is left untouched.
 */
async function materialiseNextOccurrence(database: Database, plan: PlanRow): Promise<void> {
  if (!plan.isActive) return;

  let instant: Date | null;
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
    if (error instanceof ScheduleError) throw badRequest(error.message);
    throw error;
  }
  if (!instant) return;

  await database
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
    .onConflictDoUpdate({
      target: [schema.wakeOccurrences.wakePlanId, schema.wakeOccurrences.scheduledFor],
      set: {
        status: 'scheduled',
        difficulty: plan.difficulty,
        graceMinutes: plan.graceMinutes,
        commitmentId: plan.commitmentId,
        challengePayload: generateChallenge(plan.difficulty),
        // A revived occurrence starts clean, or it would inherit the snooze count and
        // timestamps from the run that was cancelled.
        triggeredAt: null,
        confirmedAt: null,
        escalatedAt: null,
        snoozeCount: 0,
        updatedAt: new Date(),
      },
      setWhere: eq(schema.wakeOccurrences.status, 'cancelled'),
    });
}

/** Rejects a schedule the recurrence logic cannot act on, before anything is written. A
 * weekly plan with no weekdays would otherwise store cleanly and then never ring. */
function assertSchedulable(input: {
  scheduleType: 'once' | 'daily' | 'weekly';
  scheduledDate?: string | null;
  weekdays?: number[];
}): void {
  if (input.scheduleType === 'once' && !input.scheduledDate) {
    throw badRequest('A one-time wake plan needs a date.');
  }
  if (input.scheduleType === 'weekly' && (input.weekdays ?? []).length === 0) {
    throw badRequest('A weekly wake plan needs at least one weekday.');
  }
}

async function loadPlan(database: Database, id: string) {
  const [found] = await database.select(PLAN_COLUMNS).from(schema.wakePlans).where(eq(schema.wakePlans.id, id)).limit(1);
  return found;
}

wakePlanRoutes.get('/', async (c) => {
  const database = getDatabase();
  const plans = await database
    .select(PLAN_COLUMNS)
    .from(schema.wakePlans)
    .where(eq(schema.wakePlans.userId, session(c).userId))
    .orderBy(asc(schema.wakePlans.createdAt));

  if (plans.length === 0) return c.json({ wakePlans: [], occurrences: [] });

  // The client renders each plan with its next ring, so returning both in one response
  // saves the app a request per plan.
  const occurrences = await database
    .select(OCCURRENCE_COLUMNS)
    .from(schema.wakeOccurrences)
    .where(
      and(
        inArray(
          schema.wakeOccurrences.wakePlanId,
          plans.map((plan) => plan.id),
        ),
        eq(schema.wakeOccurrences.status, 'scheduled'),
      ),
    )
    .orderBy(asc(schema.wakeOccurrences.scheduledFor));

  return c.json({ wakePlans: plans, occurrences });
});

wakePlanRoutes.post('/', async (c) => {
  const body = await parseBody(c, z.object(scheduleFields));
  assertSchedulable(body);

  const database = getDatabase();
  const current = session(c);

  const [existing] = await database
    .select({ total: count() })
    .from(schema.wakePlans)
    .where(eq(schema.wakePlans.userId, current.userId));

  if ((existing?.total ?? 0) >= MAX_WAKE_PLANS) {
    throw conflict(`You can save up to ${MAX_WAKE_PLANS} wake plans.`);
  }

  const [created] = await database
    .insert(schema.wakePlans)
    .values({
      userId: current.userId,
      commitmentId: body.commitmentId ?? null,
      connectionId: body.connectionId ?? null,
      scheduleType: body.scheduleType,
      scheduledDate: body.scheduledDate ?? null,
      localTime: body.localTime,
      timezone: body.timezone,
      weekdays: body.weekdays ?? [],
      ...(body.difficulty && { difficulty: body.difficulty }),
      ...(body.soundKey && { soundKey: body.soundKey }),
      ...(body.graceMinutes !== undefined && { graceMinutes: body.graceMinutes }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    })
    .returning(PLAN_COLUMNS);

  if (!created) throw new Error('Insert returned no row.');
  await materialiseNextOccurrence(database, created);

  return c.json({ wakePlan: created }, 201);
});

wakePlanRoutes.patch('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();

  const body = requireSomeFields(
    await parseBody(
      c,
      z.object({
        ...scheduleFields,
        scheduleType: scheduleFields.scheduleType.optional(),
        localTime: scheduleFields.localTime.optional(),
        timezone: timezoneSchema.optional(),
      }),
    ),
    'Provide at least one field to update.',
  );

  const existing = await requireOwned(current, () => loadPlan(database, id));

  // Validate the schedule as it will be after the patch, not as it was sent: changing
  // only `scheduleType` to weekly must fail if the stored plan has no weekdays.
  const merged = {
    scheduleType: body.scheduleType ?? existing.scheduleType,
    scheduledDate: body.scheduledDate !== undefined ? body.scheduledDate : existing.scheduledDate,
    weekdays: body.weekdays ?? existing.weekdays,
  };
  assertSchedulable(merged);

  const [updated] = await database
    .update(schema.wakePlans)
    .set({
      ...(body.commitmentId !== undefined && { commitmentId: body.commitmentId }),
      ...(body.connectionId !== undefined && { connectionId: body.connectionId }),
      ...(body.scheduleType !== undefined && { scheduleType: body.scheduleType }),
      ...(body.scheduledDate !== undefined && { scheduledDate: body.scheduledDate }),
      ...(body.localTime !== undefined && { localTime: body.localTime }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.weekdays !== undefined && { weekdays: body.weekdays }),
      ...(body.difficulty !== undefined && { difficulty: body.difficulty }),
      ...(body.soundKey !== undefined && { soundKey: body.soundKey }),
      ...(body.graceMinutes !== undefined && { graceMinutes: body.graceMinutes }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.wakePlans.id, id), eq(schema.wakePlans.userId, current.userId)))
    .returning(PLAN_COLUMNS);

  if (!updated) throw new Error('Update returned no row.');

  // The stored schedule changed, so any occurrence already queued for the old time is
  // wrong. Cancel the pending ones and queue the new next ring.
  await cancelScheduled(database, id);
  await materialiseNextOccurrence(database, updated);

  return c.json({ wakePlan: updated });
});

wakePlanRoutes.post('/:id/active', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(c, z.object({ active: z.boolean() }));

  await requireOwned(current, () => loadPlan(database, id));

  const [updated] = await database
    .update(schema.wakePlans)
    .set({ isActive: body.active, updatedAt: new Date() })
    .where(and(eq(schema.wakePlans.id, id), eq(schema.wakePlans.userId, current.userId)))
    .returning(PLAN_COLUMNS);

  if (!updated) throw new Error('Update returned no row.');

  // Pausing must stop the alarm that is already queued, or the user pauses a plan and it
  // rings anyway. Resuming queues the next one.
  await cancelScheduled(database, id);
  await materialiseNextOccurrence(database, updated);

  return c.json({ wakePlan: updated });
});

wakePlanRoutes.delete('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();

  await requireOwned(current, () => loadPlan(database, id));

  // Occurrences cascade on delete, so the queued alarm goes with the plan.
  await database
    .delete(schema.wakePlans)
    .where(and(eq(schema.wakePlans.id, id), eq(schema.wakePlans.userId, current.userId)));

  return c.body(null, 204);
});

async function cancelScheduled(database: Database, wakePlanId: string): Promise<void> {
  await database
    .update(schema.wakeOccurrences)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(schema.wakeOccurrences.wakePlanId, wakePlanId),
        eq(schema.wakeOccurrences.status, 'scheduled'),
      ),
    );
}

wakeOccurrenceRoutes.get('/', async (c) => {
  const current = session(c);
  const planFilter = c.req.query('wakePlanId');

  if (planFilter !== undefined && !z.uuid().safeParse(planFilter).success) {
    throw badRequest('wakePlanId must be a UUID.');
  }

  const rows = await getDatabase()
    .select(OCCURRENCE_COLUMNS)
    .from(schema.wakeOccurrences)
    .where(
      planFilter
        ? and(
            eq(schema.wakeOccurrences.userId, current.userId),
            eq(schema.wakeOccurrences.wakePlanId, planFilter),
          )
        : eq(schema.wakeOccurrences.userId, current.userId),
    )
    .orderBy(desc(schema.wakeOccurrences.scheduledFor))
    .limit(100);

  return c.json({ occurrences: rows });
});

wakeOccurrenceRoutes.get('/:id', async (c) => {
  const id = uuidParam(c);
  const row = await requireOwned(session(c), async () => {
    const [found] = await getDatabase()
      .select(OCCURRENCE_COLUMNS)
      .from(schema.wakeOccurrences)
      .where(eq(schema.wakeOccurrences.id, id))
      .limit(1);
    return found;
  });
  return c.json({ occurrence: row });
});

/**
 * Confirms a wake.
 *
 * This is the status the trusted-person escalation reads, so it has to be decided here
 * rather than on the device that may have overslept. Confirming is idempotent: the client
 * may retry after a dropped connection, and the second call must not be an error.
 *
 * An occurrence that already escalated can still be confirmed — waking late is better
 * than not waking, and the escalation timestamp is retained so the history stays honest.
 */
wakeOccurrenceRoutes.post('/:id/confirm', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();

  const existing = await requireOwned(current, async () => {
    const [found] = await database
      .select({ userId: schema.wakeOccurrences.userId, status: schema.wakeOccurrences.status, confirmedAt: schema.wakeOccurrences.confirmedAt })
      .from(schema.wakeOccurrences)
      .where(eq(schema.wakeOccurrences.id, id))
      .limit(1);
    return found;
  });

  if (existing.status === 'cancelled') {
    throw conflict('This alarm was cancelled.');
  }

  const [updated] = await database
    .update(schema.wakeOccurrences)
    .set({
      status: 'confirmed',
      confirmedAt: existing.confirmedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.wakeOccurrences.id, id), eq(schema.wakeOccurrences.userId, current.userId)))
    .returning(OCCURRENCE_COLUMNS);

  return c.json({ occurrence: updated });
});

wakeOccurrenceRoutes.post('/:id/snooze', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();

  const existing = await requireOwned(current, async () => {
    const [found] = await database
      .select({ userId: schema.wakeOccurrences.userId, status: schema.wakeOccurrences.status, snoozeCount: schema.wakeOccurrences.snoozeCount })
      .from(schema.wakeOccurrences)
      .where(eq(schema.wakeOccurrences.id, id))
      .limit(1);
    return found;
  });

  // Snoozing something already settled would restart an alarm the user finished with.
  if (existing.status === 'confirmed' || existing.status === 'cancelled') {
    throw conflict(`This alarm is already ${existing.status}.`);
  }

  const [updated] = await database
    .update(schema.wakeOccurrences)
    .set({
      snoozeCount: existing.snoozeCount + 1,
      status: 'ringing',
      triggeredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.wakeOccurrences.id, id), eq(schema.wakeOccurrences.userId, current.userId)))
    .returning(OCCURRENCE_COLUMNS);

  return c.json({ occurrence: updated });
});
