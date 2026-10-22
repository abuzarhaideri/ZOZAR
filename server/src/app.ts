import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cors } from 'hono/cors';

import { createHash, timingSafeEqual } from 'node:crypto';

import { verifyAccessToken, bearerFromHeader } from '@/auth/tokens';
import { runAllTasks } from '@/worker/tasks';
import { authRoutes } from '@/routes/auth';
import { commitmentRoutes } from '@/routes/commitments';
import { chatRoutes } from '@/routes/chat';
import { deviceRoutes } from '@/routes/devices';
import { profileRoutes } from '@/routes/profile';
import { uploadRoutes } from '@/routes/uploads';
import { connectionRoutes } from '@/routes/connections';
import { wakeOccurrenceRoutes, wakePlanRoutes } from '@/routes/wake';
import { unauthorized, type AppEnv } from '@/lib/http';

/** Constant-time secret comparison over SHA-256 digests, so operands are always the same
 * length and the comparison reveals nothing through timing. */
function secretMatches(supplied: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function createApp() {
  const app = new Hono<AppEnv>();

  // The Android client is not a browser and sends no Origin, so CORS exists only so the
  // API can be exercised from a local tool during development.
  app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86_400 }));

  // Unauthenticated: a plain liveness probe that must not touch the database, so it stays
  // useful precisely when the connection budget is exhausted.
  app.get('/health', (c) => c.json({ ok: true }));

  /**
   * Scheduled work, triggered over HTTP.
   *
   * On AWS this was a Lambda on an EventBridge rule, declared in CDK alongside everything
   * else. Catalyst cannot do that: its Job Scheduling service is created through the
   * console or a REST call and cannot be declared in `catalyst.json`, so the schedule
   * lives outside the repository no matter how this is arranged. Given that, the work
   * stays in this process — one deployment, one connection pool, one place to read logs —
   * and the scheduler's only job is to call this route.
   *
   * It is guarded by a shared secret rather than left open, and the route does not exist
   * at all unless that secret is configured, so an unconfigured deployment cannot have
   * its worker driven by a stranger.
   */
  app.post('/internal/run-worker', async (c) => {
    const expected = process.env.WORKER_TRIGGER_SECRET?.trim();
    if (!expected) return c.notFound();

    const supplied = c.req.header('X-Worker-Secret') ?? '';
    // Compared on fixed-length digests so the check cannot be timed, and so two secrets
    // of different lengths do not make timingSafeEqual throw.
    if (!secretMatches(supplied, expected)) return c.notFound();

    const started = Date.now();
    const report = await runAllTasks();
    console.log('[worker] run complete', { durationMs: Date.now() - started, ...report });
    return c.json({ ok: true, durationMs: Date.now() - started, ...report });
  });

  app.route('/auth', authRoutes);

  /**
   * Everything below this line requires a valid access token. Mounting the guard as
   * middleware on a path prefix, rather than calling it inside each handler, means a new
   * route cannot be added unprotected by forgetting a line.
   */
  app.use('/v1/*', async (c, next) => {
    const token = bearerFromHeader(c.req.header('Authorization'));
    if (!token) throw unauthorized();
    const session = await verifyAccessToken(token);
    if (!session) throw unauthorized('That session has expired.');
    c.set('session', session);
    await next();
  });

  app.get('/v1/me', (c) => c.json({ session: c.get('session') }));
  app.route('/v1/commitments', commitmentRoutes);
  app.route('/v1/wake-plans', wakePlanRoutes);
  app.route('/v1/wake-occurrences', wakeOccurrenceRoutes);
  app.route('/v1/connections', connectionRoutes);
  app.route('/v1/chat', chatRoutes);
  app.route('/v1/device-tokens', deviceRoutes);
  app.route('/v1/profile', profileRoutes);
  app.route('/v1/uploads', uploadRoutes);

  app.notFound(() => Response.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }));

  /**
   * Nothing but the shaped errors reaches the client. An unexpected throw is logged in
   * full for the Catalyst logs and reported as a bare 500, so a database message or a stack
   * trace is never part of a response body.
   */
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    console.error('[api] unhandled error', { path: c.req.path, method: c.req.method, error });
    return Response.json({ error: { code: 'internal', message: 'Something went wrong.' } }, { status: 500 });
  });

  return app;
}
