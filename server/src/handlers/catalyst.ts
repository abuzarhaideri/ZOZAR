import { serve } from '@hono/node-server';

import { createApp } from '@/app';

/**
 * AppSail entrypoint, for Zoho Catalyst.
 *
 * Unlike the Lambda handlers this is a long-lived process: Catalyst starts it once and
 * routes many requests into it, rather than invoking a function per request. The app is
 * therefore built once at startup and the database pool lives for the life of the
 * instance.
 *
 * Configuration comes from the environment. On Lambda the secrets were pulled from SSM at
 * cold start; Catalyst injects its own environment variables into the process before it
 * begins, so there is nothing to fetch and no `loadSecrets()` call here. That also keeps
 * the AWS SDK out of this path entirely.
 *
 * Catalyst gives the instance ten seconds to be listening or it kills it, so nothing
 * slow — no migration, no database handshake — may happen before `serve()`. The first
 * connection to Aiven is made lazily by the first request that needs it.
 */

// Catalyst supplies the port; 9000 is its documented default and keeps `npm start`
// working on a developer machine.
const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT ?? 9000);

// Catalyst's health check reaches the instance on the container's own address, so binding
// to localhost would make the app look dead and get it recycled.
serve({ fetch: createApp().fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[appsail] listening on ${info.address}:${info.port}`);
});
