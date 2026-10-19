import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cors } from 'hono/cors';

import { verifyAccessToken, bearerFromHeader } from '@/auth/tokens';
import { authRoutes } from '@/routes/auth';
import { unauthorized, type AppEnv } from '@/lib/http';

export function createApp() {
  const app = new Hono<AppEnv>();

  // The Android client is not a browser and sends no Origin, so CORS exists only so the
  // API can be exercised from a local tool during development.
  app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86_400 }));

  // Unauthenticated: a plain liveness probe that must not touch the database, so it stays
  // useful precisely when the connection budget is exhausted.
  app.get('/health', (c) => c.json({ ok: true }));

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

  app.notFound(() => Response.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }));

  /**
   * Nothing but the shaped errors reaches the client. An unexpected throw is logged in
   * full for CloudWatch and reported as a bare 500, so a database message or a stack
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
