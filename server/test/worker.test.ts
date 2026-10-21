import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';
import { setNotifierForTests, type Notifier, type PushResult } from '@/lib/push';
import { setStorageForTests, type MediaStorage } from '@/lib/storage';
import {
  deliverNotifications,
  escalateMissedWakes,
  materialiseOccurrences,
  sweepExpiredMessages,
  sweepStaleRows,
} from '@/worker/tasks';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('worker tasks', () => {
  const app = createApp();

  async function request(path: string, init: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = init;
    const response = await app.request(path, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function signUp(email: string) {
    const { body } = await request('/auth/sign-up', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'a-sufficiently-long-password',
        displayName: email.split('@')[0],
        timezone: 'Asia/Kolkata',
      }),
    });
    return body.accessToken as string;
  }

  let asha = '';
  let ravi = '';

  function recordingNotifier(result: PushResult = { ok: true }) {
    const sentTo: string[] = [];
    const notifier: Notifier = {
      async send(message) {
        sentTo.push(message.token);
        return result;
      },
    };
    return { notifier, sentTo };
  }

  const noopStorage: MediaStorage = {
    async presignUpload(key) {
      return `https://bucket.example/${key}`;
    },
    async presignDownload(key) {
      return `https://bucket.example/${key}`;
    },
    async head() {
      return { contentType: 'audio/mp4', contentLength: 1024 };
    },
    async remove() {},
  };

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    setStorageForTests(noopStorage);
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    asha = await signUp('asha@example.com');
    ravi = await signUp('ravi@example.com');
  });

  afterEach(() => {
    setStorageForTests(null);
    setNotifierForTests(null);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  /** Connects the two accounts and returns the connection id, so a plan can be protected. */
  async function connect() {
    const invited = await request('/v1/connections', {
      method: 'POST',
      token: asha,
      body: JSON.stringify({ email: 'ravi@example.com' }),
    });
    await request(`/v1/connections/${invited.body.connection.id}/respond`, {
      method: 'POST',
      token: ravi,
      body: JSON.stringify({ accept: true }),
    });
    return invited.body.connection.id as string;
  }

  async function createPlan(body: Record<string, unknown> = {}) {
    const response = await request('/v1/wake-plans', {
      method: 'POST',
      token: asha,
      body: JSON.stringify({ scheduleType: 'daily', localTime: '06:30', timezone: 'Asia/Kolkata', ...body }),
    });
    return response.body.wakePlan.id as string;
  }

  /** Drags the queued occurrence into the past so its grace period has lapsed. */
  async function makeOverdue(planId: string, graceMinutes = 10) {
    await getDatabase()
      .update(schema.wakeOccurrences)
      .set({ scheduledFor: new Date(Date.now() - (graceMinutes + 5) * 60_000), graceMinutes })
      .where(eq(schema.wakeOccurrences.wakePlanId, planId));
  }

  describe('materialising occurrences', () => {
    it('queues a ring for an active plan that has none', async () => {
      const planId = await createPlan();
      // Clear what the route queued, to simulate the state after an alarm fired.
      await getDatabase().delete(schema.wakeOccurrences).where(eq(schema.wakeOccurrences.wakePlanId, planId));

      const report = await materialiseOccurrences();
      expect(report.queued).toBe(1);

      const rows = await getDatabase().select().from(schema.wakeOccurrences);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    });

    it('does nothing for a plan that already has one queued', async () => {
      await createPlan();
      const report = await materialiseOccurrences();
      expect(report.queued).toBe(0);
    });

    it('ignores a paused plan', async () => {
      const planId = await createPlan();
      await request(`/v1/wake-plans/${planId}/active`, {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ active: false }),
      });
      const report = await materialiseOccurrences();
      expect(report.queued).toBe(0);
    });

    it('deactivates a one-time plan whose moment has passed', async () => {
      // Otherwise it would be reconsidered on every pass, forever.
      const planId = await createPlan({ scheduleType: 'once', scheduledDate: '2026-12-25' });
      await getDatabase()
        .update(schema.wakePlans)
        .set({ scheduledDate: '2020-01-01' })
        .where(eq(schema.wakePlans.id, planId));
      await getDatabase().delete(schema.wakeOccurrences).where(eq(schema.wakeOccurrences.wakePlanId, planId));

      await materialiseOccurrences();
      const [plan] = await getDatabase()
        .select({ isActive: schema.wakePlans.isActive })
        .from(schema.wakePlans)
        .where(eq(schema.wakePlans.id, planId));
      expect(plan?.isActive).toBe(false);
    });

    it('is idempotent across runs', async () => {
      const planId = await createPlan();
      await getDatabase().delete(schema.wakeOccurrences).where(eq(schema.wakeOccurrences.wakePlanId, planId));
      await materialiseOccurrences();
      await materialiseOccurrences();
      expect(await getDatabase().select().from(schema.wakeOccurrences)).toHaveLength(1);
    });

    it('skips an unschedulable plan without aborting the sweep', async () => {
      // A weekly plan with no weekdays cannot be scheduled. One bad row must not stop
      // everyone else's alarms from being queued.
      const broken = await createPlan();
      await getDatabase()
        .update(schema.wakePlans)
        .set({ scheduleType: 'weekly', weekdays: [] })
        .where(eq(schema.wakePlans.id, broken));
      await getDatabase().delete(schema.wakeOccurrences);

      const healthyOwner = await signUp('healthy@example.com');
      await request('/v1/wake-plans', {
        method: 'POST',
        token: healthyOwner,
        body: JSON.stringify({ scheduleType: 'daily', localTime: '07:00', timezone: 'UTC' }),
      });
      await getDatabase().delete(schema.wakeOccurrences);

      const report = await materialiseOccurrences();
      expect(report.unschedulable).toBe(1);
      expect(report.queued).toBe(1);
    });
  });

  describe('escalating missed wakes', () => {
    it('escalates and queues a notification for the trusted person', async () => {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      await makeOverdue(planId);

      const report = await escalateMissedWakes();
      expect(report.escalated).toBe(1);
      expect(report.notified).toBe(1);

      const [occurrence] = await getDatabase().select().from(schema.wakeOccurrences);
      expect(occurrence?.status).toBe('escalated');
      expect(occurrence?.escalatedAt).toBeTruthy();

      const [job] = await getDatabase().select().from(schema.notificationJobs);
      expect(job?.kind).toBe('missed_wake');
      // Addressed to Ravi, the protector, not to the person who overslept.
      const [raviRow] = await getDatabase()
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, 'ravi@example.com'));
      expect(job?.userId).toBe(raviRow?.id);
    });

    it('marks a wake missed, not escalated, when no trusted person is set', async () => {
      const planId = await createPlan();
      await makeOverdue(planId);

      const report = await escalateMissedWakes();
      expect(report.escalated).toBe(1);
      expect(report.notified).toBe(0);

      const [occurrence] = await getDatabase().select().from(schema.wakeOccurrences);
      expect(occurrence?.status).toBe('missed');
      expect(await getDatabase().select().from(schema.notificationJobs)).toHaveLength(0);
    });

    it('does not notify a revoked trusted person', async () => {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      await makeOverdue(planId);
      // Revoke directly, since the route also detaches the plan.
      await getDatabase()
        .update(schema.connections)
        .set({ status: 'revoked' })
        .where(eq(schema.connections.id, connectionId));

      const report = await escalateMissedWakes();
      expect(report.notified).toBe(0);
      expect(await getDatabase().select().from(schema.notificationJobs)).toHaveLength(0);
    });

    it('leaves a confirmed wake alone', async () => {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      await makeOverdue(planId);
      const [occurrence] = await getDatabase().select().from(schema.wakeOccurrences);
      await request(`/v1/wake-occurrences/${occurrence!.id}/confirm`, { method: 'POST', token: asha });

      const report = await escalateMissedWakes();
      expect(report.escalated).toBe(0);
    });

    it('does not escalate before the grace period lapses', async () => {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      // Rang two minutes ago with ten minutes of grace: still within it.
      await getDatabase()
        .update(schema.wakeOccurrences)
        .set({ scheduledFor: new Date(Date.now() - 2 * 60_000), graceMinutes: 10 })
        .where(eq(schema.wakeOccurrences.wakePlanId, planId));

      expect((await escalateMissedWakes()).escalated).toBe(0);
    });

    it('respects a per-occurrence grace period', async () => {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId, graceMinutes: 1 });
      await getDatabase()
        .update(schema.wakeOccurrences)
        .set({ scheduledFor: new Date(Date.now() - 3 * 60_000), graceMinutes: 1 })
        .where(eq(schema.wakeOccurrences.wakePlanId, planId));

      expect((await escalateMissedWakes()).escalated).toBe(1);
    });

    it('never notifies twice about the same morning, even across repeated runs', async () => {
      // At-least-once scheduling means this runs again on overlap; the trusted person
      // must not be messaged twice.
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      await makeOverdue(planId);

      await escalateMissedWakes();
      await escalateMissedWakes();
      await escalateMissedWakes();

      expect(await getDatabase().select().from(schema.notificationJobs)).toHaveLength(1);
    });
  });

  describe('delivering notifications', () => {
    async function queuedJob() {
      const connectionId = await connect();
      const planId = await createPlan({ connectionId });
      await makeOverdue(planId);
      await escalateMissedWakes();
    }

    const FCM = `fcm-${'t'.repeat(200)}`;

    async function registerRaviDevice() {
      await request('/v1/device-tokens', {
        method: 'POST',
        token: ravi,
        body: JSON.stringify({ token: FCM, platform: 'android' }),
      });
    }

    it('sends to the trusted person’s device and marks the job sent', async () => {
      await registerRaviDevice();
      await queuedJob();

      const { notifier, sentTo } = recordingNotifier();
      const report = await deliverNotifications(getDatabase(), notifier);

      expect(report.sent).toBe(1);
      expect(sentTo).toEqual([FCM]);
      const [job] = await getDatabase().select().from(schema.notificationJobs);
      expect(job?.status).toBe('sent');
    });

    it('does not resend an already-sent job', async () => {
      await registerRaviDevice();
      await queuedJob();
      await deliverNotifications(getDatabase(), recordingNotifier().notifier);

      const second = recordingNotifier();
      const report = await deliverNotifications(getDatabase(), second.notifier);
      expect(report.due).toBe(0);
      expect(second.sentTo).toEqual([]);
    });

    it('fails terminally when the recipient has no active device', async () => {
      await queuedJob();
      const report = await deliverNotifications(getDatabase(), recordingNotifier().notifier);
      expect(report.failed).toBe(1);
      const [job] = await getDatabase().select().from(schema.notificationJobs);
      expect(job?.status).toBe('failed');
      expect(job?.lastError).toMatch(/no active device/);
    });

    it('retries a transient failure with backoff rather than giving up', async () => {
      await registerRaviDevice();
      await queuedJob();

      const { notifier } = recordingNotifier({ ok: false, invalidToken: false, error: 'messaging/unavailable: try later' });
      const report = await deliverNotifications(getDatabase(), notifier);

      expect(report.retried).toBe(1);
      const [job] = await getDatabase().select().from(schema.notificationJobs);
      expect(job?.status).toBe('retry');
      expect(job?.attempts).toBe(1);
      // Scheduled into the future, so the next pass does not immediately hammer FCM.
      expect(job!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('deactivates a token FCM reports as permanently dead', async () => {
      await registerRaviDevice();
      await queuedJob();

      const { notifier } = recordingNotifier({
        ok: false,
        invalidToken: true,
        error: 'messaging/registration-token-not-registered: gone',
      });
      const report = await deliverNotifications(getDatabase(), notifier);

      expect(report.deactivated).toBe(1);
      const [device] = await getDatabase().select().from(schema.deviceTokens);
      expect(device?.isActive).toBe(false);
    });

    it('gives up after five attempts instead of retrying forever', async () => {
      await registerRaviDevice();
      await queuedJob();
      const { notifier } = recordingNotifier({ ok: false, invalidToken: false, error: 'transient' });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        // Make the job due again rather than waiting out the backoff.
        await getDatabase().update(schema.notificationJobs).set({ nextAttemptAt: new Date(Date.now() - 1000) });
        await deliverNotifications(getDatabase(), notifier);
      }

      const [job] = await getDatabase().select().from(schema.notificationJobs);
      expect(job?.status).toBe('failed');
      expect(job?.attempts).toBe(5);
    });
  });

  describe('sweeping expired messages', () => {
    it('deletes expired messages and leaves live ones', async () => {
      await connect();
      const threadId = (await request('/v1/chat/threads', { token: asha })).body.threads[0].id;

      const stale = await request(`/v1/chat/threads/${threadId}/messages`, {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ body: 'old' }),
      });
      await request(`/v1/chat/threads/${threadId}/messages`, {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ body: 'fresh' }),
      });
      await getDatabase()
        .update(schema.messages)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.messages.id, stale.body.message.id));

      const report = await sweepExpiredMessages();
      expect(report.messages).toBe(1);

      const remaining = await getDatabase().select({ body: schema.messages.body }).from(schema.messages);
      expect(remaining.map((row) => row.body)).toEqual(['fresh']);
    });

    it('removes the audio object alongside an expired voice note', async () => {
      await connect();
      const threadId = (await request('/v1/chat/threads', { token: asha })).body.threads[0].id;
      const presigned = await request('/v1/uploads', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ kind: 'voice-note', contentType: 'audio/mp4', threadId }),
      });
      await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key: presigned.body.key, durationSeconds: 5 }),
      });
      await getDatabase().update(schema.messages).set({ expiresAt: new Date(Date.now() - 1000) });

      const removed: string[] = [];
      setStorageForTests({ ...noopStorage, async remove(key) { removed.push(key); } });

      const report = await sweepExpiredMessages();
      expect(report.objects).toBe(1);
      expect(removed).toContain(presigned.body.key);
      expect(await getDatabase().select().from(schema.messages)).toHaveLength(0);
    });

    it('keeps the row when the object cannot be removed, so the next pass retries', async () => {
      await connect();
      const threadId = (await request('/v1/chat/threads', { token: asha })).body.threads[0].id;
      const presigned = await request('/v1/uploads', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ kind: 'voice-note', contentType: 'audio/mp4', threadId }),
      });
      await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key: presigned.body.key, durationSeconds: 5 }),
      });
      await getDatabase().update(schema.messages).set({ expiresAt: new Date(Date.now() - 1000) });

      setStorageForTests({
        ...noopStorage,
        async remove() {
          throw new Error('S3 unavailable');
        },
      });

      const report = await sweepExpiredMessages();
      expect(report.objects).toBe(0);
      // Deleting the row now would strand the file with nothing pointing at it.
      expect(await getDatabase().select().from(schema.messages)).toHaveLength(1);
    });
  });

  describe('sweeping stale rows', () => {
    it('deletes expired refresh tokens and keeps live ones', async () => {
      const [live] = await getDatabase().select().from(schema.refreshTokens).limit(1);
      expect(live).toBeTruthy();

      await getDatabase()
        .update(schema.refreshTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.refreshTokens.id, live!.id));

      const report = await sweepStaleRows();
      expect(report.refreshTokens).toBeGreaterThanOrEqual(1);
      const remaining = await getDatabase().select().from(schema.refreshTokens);
      expect(remaining.find((row) => row.id === live!.id)).toBeUndefined();
    });
  });
});
