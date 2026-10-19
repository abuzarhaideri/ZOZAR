import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('connection routes', () => {
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

  const ASHA = 'asha@example.com';
  const RAVI = 'ravi@example.com';
  const NOBODY = 'nobody@example.com';

  let asha = '';
  let ravi = '';
  let nosy = '';

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    asha = await signUp(ASHA);
    ravi = await signUp(RAVI);
    nosy = await signUp('nosy@example.com');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const invite = (token: string, email: string) =>
    request('/v1/connections', { method: 'POST', token, body: JSON.stringify({ email }) });

  describe('inviting', () => {
    it('creates a pending outgoing invitation', async () => {
      const response = await invite(asha, RAVI);
      expect(response.status).toBe(201);
      expect(response.body.connection).toMatchObject({
        status: 'pending',
        relationship: 'outgoing',
        recipientEmail: RAVI,
      });
      // Resolved immediately because Ravi already has an account.
      expect(response.body.connection.recipientId).toBeTruthy();
      expect(response.body.connection.recipientDisplayName).toBe('ravi');
    });

    it('accepts an invitation to someone with no account yet', async () => {
      const response = await invite(asha, NOBODY);
      expect(response.status).toBe(201);
      expect(response.body.connection.recipientId).toBeNull();
    });

    it('refuses self-invitation', async () => {
      expect((await invite(asha, ASHA)).status).toBe(400);
      // Casing must not be a way around it.
      expect((await invite(asha, 'ASHA@Example.com')).status).toBe(400);
    });

    it('refuses a duplicate invitation regardless of casing', async () => {
      expect((await invite(asha, RAVI)).status).toBe(201);
      const duplicate = await invite(asha, 'RAVI@Example.COM');
      expect(duplicate.status).toBe(409);
    });

    it('rejects a malformed email', async () => {
      expect((await invite(asha, 'not-an-email')).status).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await request('/v1/connections')).status).toBe(401);
    });
  });

  describe('visibility', () => {
    it('shows the invitation to both parties and to nobody else', async () => {
      await invite(asha, RAVI);

      const ashaSees = await request('/v1/connections', { token: asha });
      expect(ashaSees.body.connections).toHaveLength(1);
      expect(ashaSees.body.connections[0].relationship).toBe('outgoing');

      const raviSees = await request('/v1/connections', { token: ravi });
      expect(raviSees.body.connections).toHaveLength(1);
      expect(raviSees.body.connections[0].relationship).toBe('incoming');

      const nosySees = await request('/v1/connections', { token: nosy });
      expect(nosySees.body.connections).toHaveLength(0);
    });

    it('shows an email-addressed invitation to the person once they sign up', async () => {
      // This is what makes the People screen work for someone invited before registering.
      await invite(asha, NOBODY);
      const latecomer = await signUp(NOBODY);
      const theySee = await request('/v1/connections', { token: latecomer });
      expect(theySee.body.connections).toHaveLength(1);
      expect(theySee.body.connections[0].relationship).toBe('incoming');
    });

    it('hides a connection from an unrelated user as 404', async () => {
      const { body } = await invite(asha, RAVI);
      const response = await request(`/v1/connections/${body.connection.id}`, { token: nosy });
      expect(response.status).toBe(404);
    });
  });

  describe('responding', () => {
    const respond = (token: string, id: string, accept: boolean) =>
      request(`/v1/connections/${id}/respond`, { method: 'POST', token, body: JSON.stringify({ accept }) });

    it('lets the invitee accept, and opens the chat thread', async () => {
      const { body } = await invite(asha, RAVI);
      const accepted = await respond(ravi, body.connection.id, true);
      expect(accepted.status).toBe(200);
      expect(accepted.body.connection.status).toBe('accepted');

      // An accepted connection with no thread would offer a conversation that 404s.
      const threads = await getDatabase().select().from(schema.chatThreads);
      expect(threads).toHaveLength(1);
    });

    it('lets the invitee decline, and opens no thread', async () => {
      const { body } = await invite(asha, RAVI);
      const declined = await respond(ravi, body.connection.id, false);
      expect(declined.body.connection.status).toBe('declined');
      expect(await getDatabase().select().from(schema.chatThreads)).toHaveLength(0);
    });

    it('forbids the requester from accepting their own invitation', async () => {
      const { body } = await invite(asha, RAVI);
      const response = await respond(asha, body.connection.id, true);
      // Asha is a party, so the denial is forbidden rather than notFound.
      expect(response.status).toBe(403);
    });

    it('hides the invitation from a stranger trying to respond', async () => {
      const { body } = await invite(asha, RAVI);
      expect((await respond(nosy, body.connection.id, true)).status).toBe(404);
    });

    it('refuses to answer an invitation twice', async () => {
      const { body } = await invite(asha, RAVI);
      expect((await respond(ravi, body.connection.id, true)).status).toBe(200);
      expect((await respond(ravi, body.connection.id, true)).status).toBe(409);
      expect((await respond(ravi, body.connection.id, false)).status).toBe(409);
    });

    it('claims an email-addressed invitation for the account that answers it', async () => {
      const { body } = await invite(asha, NOBODY);
      expect(body.connection.recipientId).toBeNull();

      const latecomer = await signUp(NOBODY);
      const accepted = await respond(latecomer, body.connection.id, true);
      expect(accepted.status).toBe(200);
      expect(accepted.body.connection.recipientId).toBeTruthy();
      expect(accepted.body.connection.recipientDisplayName).toBe('nobody');
    });

    it('reuses one thread when both people invite each other and both accept', async () => {
      const first = await invite(asha, RAVI);
      await respond(ravi, first.body.connection.id, true);
      const second = await invite(ravi, ASHA);
      await respond(asha, second.body.connection.id, true);

      // Canonical ordering plus the unique index means one conversation, not two.
      expect(await getDatabase().select().from(schema.chatThreads)).toHaveLength(1);
    });
  });

  describe('revoking', () => {
    it('lets either party revoke', async () => {
      const first = await invite(asha, RAVI);
      expect((await request(`/v1/connections/${first.body.connection.id}`, { method: 'DELETE', token: ravi })).status).toBe(204);

      const second = await invite(ravi, ASHA);
      expect((await request(`/v1/connections/${second.body.connection.id}`, { method: 'DELETE', token: asha })).status).toBe(204);
    });

    it('reports an already-revoked connection as a conflict', async () => {
      const { body } = await invite(asha, RAVI);
      await request(`/v1/connections/${body.connection.id}`, { method: 'DELETE', token: asha });
      const again = await request(`/v1/connections/${body.connection.id}`, { method: 'DELETE', token: asha });
      expect(again.status).toBe(409);
    });

    it('detaches the connection from any wake plan that relied on it', async () => {
      // Otherwise the app keeps showing "protected by your trusted person" after that
      // person has gone.
      const { body } = await invite(asha, RAVI);
      const connectionId = body.connection.id;
      await request(`/v1/connections/${connectionId}/respond`, {
        method: 'POST',
        token: ravi,
        body: JSON.stringify({ accept: true }),
      });

      const plan = await request('/v1/wake-plans', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ scheduleType: 'daily', localTime: '06:30', timezone: 'Asia/Kolkata', connectionId }),
      });
      expect(plan.body.wakePlan.connectionId).toBe(connectionId);

      await request(`/v1/connections/${connectionId}`, { method: 'DELETE', token: asha });

      const [after] = await getDatabase()
        .select({ connectionId: schema.wakePlans.connectionId })
        .from(schema.wakePlans)
        .where(eq(schema.wakePlans.id, plan.body.wakePlan.id));
      expect(after?.connectionId).toBeNull();
    });

    it('hides a stranger’s revoke attempt as 404', async () => {
      const { body } = await invite(asha, RAVI);
      expect((await request(`/v1/connections/${body.connection.id}`, { method: 'DELETE', token: nosy })).status).toBe(404);
    });
  });

  it('treats a malformed id as 404', async () => {
    expect((await request('/v1/connections/not-a-uuid', { token: asha })).status).toBe(404);
  });
});
