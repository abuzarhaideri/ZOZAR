import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';
import { isWakeChallenge } from '@/domain/challenge';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('wake routes', () => {
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

  let token = '';
  let otherToken = '';

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    token = await signUp('sleeper@example.com');
    otherToken = await signUp('stranger@example.com');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const daily = { scheduleType: 'daily', localTime: '06:30', timezone: 'Asia/Kolkata' };

  function createPlan(body: Record<string, unknown> = {}, withToken = token) {
    return request('/v1/wake-plans', {
      method: 'POST',
      token: withToken,
      body: JSON.stringify({ ...daily, ...body }),
    });
  }

  describe('creating a plan', () => {
    it('creates a daily plan and queues its next ring', async () => {
      const created = await createPlan();
      expect(created.status).toBe(201);
      expect(created.body.wakePlan).toMatchObject({ scheduleType: 'daily', localTime: '06:30', isActive: true });

      const listed = await request('/v1/wake-plans', { token });
      expect(listed.body.wakePlans).toHaveLength(1);
      expect(listed.body.occurrences).toHaveLength(1);
      // The queued ring must be in the future, or the alarm has already missed.
      expect(new Date(listed.body.occurrences[0].scheduledFor).getTime()).toBeGreaterThan(Date.now());
    });

    it('stores a solvable challenge on the occurrence so the device can ring offline', async () => {
      await createPlan({ difficulty: 'hard' });
      const { body } = await request('/v1/wake-occurrences', { token });
      const payload = body.occurrences[0].challengePayload;
      expect(isWakeChallenge(payload)).toBe(true);
      expect(payload.difficulty).toBe('hard');
      expect(payload.choices).toHaveLength(4);
    });

    it('enforces the three-plan limit server-side', async () => {
      // Previously this was a client-side check only, so any session could write a fourth.
      for (let index = 0; index < 3; index += 1) {
        expect((await createPlan({ localTime: `0${index + 5}:00` })).status).toBe(201);
      }
      const fourth = await createPlan({ localTime: '09:00' });
      expect(fourth.status).toBe(409);
      expect(fourth.body.error.message).toMatch(/up to 3/);
    });

    it('rejects a weekly plan with no weekdays rather than storing one that never rings', async () => {
      const response = await createPlan({ scheduleType: 'weekly', weekdays: [] });
      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/weekday/);
    });

    it('rejects a one-time plan with no date', async () => {
      expect((await createPlan({ scheduleType: 'once' })).status).toBe(400);
    });

    it('rejects a malformed time, an unknown timezone, and an out-of-range weekday', async () => {
      expect((await createPlan({ localTime: '6:30 AM' })).status).toBe(400);
      expect((await createPlan({ localTime: '25:00' })).status).toBe(400);
      expect((await createPlan({ timezone: 'Mars/Olympus' })).status).toBe(400);
      expect((await createPlan({ scheduleType: 'weekly', weekdays: [7] })).status).toBe(400);
    });

    it('queues nothing for a one-time plan whose moment has passed', async () => {
      const created = await createPlan({ scheduleType: 'once', scheduledDate: '2020-01-01' });
      expect(created.status).toBe(201);
      const { body } = await request('/v1/wake-occurrences', { token });
      expect(body.occurrences).toHaveLength(0);
    });
  });

  describe('updating a plan', () => {
    it('re-queues the ring when the time changes', async () => {
      const { body } = await createPlan();
      const before = (await request('/v1/wake-plans', { token })).body.occurrences[0].scheduledFor;

      await request(`/v1/wake-plans/${body.wakePlan.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ localTime: '07:45' }),
      });

      const after = (await request('/v1/wake-plans', { token })).body.occurrences;
      expect(after).toHaveLength(1);
      expect(after[0].scheduledFor).not.toBe(before);
    });

    it('validates the merged schedule, not just the fields sent', async () => {
      // Switching a daily plan to weekly without supplying weekdays must fail, even
      // though the body on its own looks fine.
      const { body } = await createPlan();
      const response = await request(`/v1/wake-plans/${body.wakePlan.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ scheduleType: 'weekly' }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects an empty patch', async () => {
      const { body } = await createPlan();
      const response = await request(`/v1/wake-plans/${body.wakePlan.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('pausing', () => {
    it('cancels the queued ring when paused, and queues a new one when resumed', async () => {
      const { body } = await createPlan();
      const id = body.wakePlan.id;

      await request(`/v1/wake-plans/${id}/active`, {
        method: 'POST',
        token,
        body: JSON.stringify({ active: false }),
      });

      // A paused plan that still rings is the worst possible bug here.
      const paused = await request('/v1/wake-plans', { token });
      expect(paused.body.wakePlans[0].isActive).toBe(false);
      expect(paused.body.occurrences).toHaveLength(0);

      await request(`/v1/wake-plans/${id}/active`, {
        method: 'POST',
        token,
        body: JSON.stringify({ active: true }),
      });
      const resumed = await request('/v1/wake-plans', { token });
      expect(resumed.body.occurrences).toHaveLength(1);
    });

    it('never resurrects an occurrence the user already confirmed', async () => {
      // Re-materialising revives cancelled rows so pause/resume works. That revival must
      // not reach a completed wake, or confirming and then editing the plan would erase
      // the confirmation the escalation logic depends on.
      const { body } = await createPlan();
      const id = body.wakePlan.id;

      const occurrenceId = (await request('/v1/wake-occurrences', { token })).body.occurrences[0].id;
      await request(`/v1/wake-occurrences/${occurrenceId}/confirm`, { method: 'POST', token });

      // Touch the plan without changing the schedule, so the same instant is recomputed.
      await request(`/v1/wake-plans/${id}/active`, {
        method: 'POST',
        token,
        body: JSON.stringify({ active: true }),
      });

      const after = await request(`/v1/wake-occurrences/${occurrenceId}`, { token });
      expect(after.body.occurrence.status).toBe('confirmed');
      expect(after.body.occurrence.confirmedAt).toBeTruthy();
      expect(after.body.occurrence.snoozeCount).toBe(0);
    });
  });

  describe('confirming and snoozing', () => {
    async function anOccurrence() {
      await createPlan();
      const { body } = await request('/v1/wake-occurrences', { token });
      return body.occurrences[0].id as string;
    }

    it('confirms a wake', async () => {
      const id = await anOccurrence();
      const response = await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token });
      expect(response.status).toBe(200);
      expect(response.body.occurrence).toMatchObject({ status: 'confirmed' });
      expect(response.body.occurrence.confirmedAt).toBeTruthy();
    });

    it('is idempotent, so a retry after a dropped connection is not an error', async () => {
      const id = await anOccurrence();
      const first = await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token });
      const second = await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token });
      expect(second.status).toBe(200);
      // The original confirmation time is kept rather than moved forward.
      expect(second.body.occurrence.confirmedAt).toBe(first.body.occurrence.confirmedAt);
    });

    it('counts snoozes and marks the alarm ringing', async () => {
      const id = await anOccurrence();
      await request(`/v1/wake-occurrences/${id}/snooze`, { method: 'POST', token });
      const second = await request(`/v1/wake-occurrences/${id}/snooze`, { method: 'POST', token });
      expect(second.body.occurrence).toMatchObject({ snoozeCount: 2, status: 'ringing' });
    });

    it('refuses to snooze an alarm already confirmed', async () => {
      const id = await anOccurrence();
      await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token });
      const response = await request(`/v1/wake-occurrences/${id}/snooze`, { method: 'POST', token });
      expect(response.status).toBe(409);
    });

    it('still lets a late riser confirm after escalation, keeping the escalation record', async () => {
      const id = await anOccurrence();
      const escalatedAt = new Date('2026-01-01T00:00:00.000Z');
      await getDatabase()
        .update(schema.wakeOccurrences)
        .set({ status: 'escalated', escalatedAt })
        .where(sql`${schema.wakeOccurrences.id} = ${id}`);

      const response = await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token });
      expect(response.status).toBe(200);
      expect(response.body.occurrence.status).toBe('confirmed');
      // Waking late is better than not waking, but the history must stay honest.
      expect(response.body.occurrence.escalatedAt).toBe(escalatedAt.toISOString());
    });
  });

  describe('isolation between users', () => {
    it('hides another user’s plans and occurrences', async () => {
      await createPlan();
      const listed = await request('/v1/wake-plans', { token: otherToken });
      expect(listed.body.wakePlans).toHaveLength(0);
      expect(listed.body.occurrences).toHaveLength(0);
      expect((await request('/v1/wake-occurrences', { token: otherToken })).body.occurrences).toHaveLength(0);
    });

    it('refuses every write to another user’s plan with 404', async () => {
      const { body } = await createPlan();
      const id = body.wakePlan.id;

      for (const [path, method, payload] of [
        [`/v1/wake-plans/${id}`, 'PATCH', { localTime: '09:00' }],
        [`/v1/wake-plans/${id}/active`, 'POST', { active: false }],
        [`/v1/wake-plans/${id}`, 'DELETE', undefined],
      ] as const) {
        const response = await request(path, {
          method,
          token: otherToken,
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    });

    it('refuses to confirm another user’s alarm', async () => {
      await createPlan();
      const { body } = await request('/v1/wake-occurrences', { token });
      const id = body.occurrences[0].id;
      const response = await request(`/v1/wake-occurrences/${id}/confirm`, { method: 'POST', token: otherToken });
      expect(response.status).toBe(404);
    });

    it('requires authentication everywhere', async () => {
      expect((await request('/v1/wake-plans')).status).toBe(401);
      expect((await request('/v1/wake-occurrences')).status).toBe(401);
      expect((await request('/v1/wake-plans', { method: 'POST', body: JSON.stringify(daily) })).status).toBe(401);
    });
  });

  it('deletes a plan and its queued rings', async () => {
    const { body } = await createPlan();
    expect((await request(`/v1/wake-plans/${body.wakePlan.id}`, { method: 'DELETE', token })).status).toBe(204);
    const listed = await request('/v1/wake-plans', { token });
    expect(listed.body.wakePlans).toHaveLength(0);
    // Occurrences cascade, so no orphaned alarm survives the plan.
    expect((await request('/v1/wake-occurrences', { token })).body.occurrences).toHaveLength(0);
  });

  it('rejects a non-UUID wakePlanId filter', async () => {
    expect((await request('/v1/wake-occurrences?wakePlanId=nope', { token })).status).toBe(400);
  });
});
