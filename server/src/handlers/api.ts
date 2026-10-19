import { handle, type LambdaContext, type LambdaEvent } from 'hono/aws-lambda';

import { createApp } from '@/app';
import { loadSecrets } from '@/lib/config';

/**
 * API Lambda entrypoint, behind an API Gateway HTTP API.
 *
 * The app is built once at module scope so a warm container reuses it, along with the
 * database pool and the resolved JWT key. Building it per invocation would spend the
 * connection budget on handshakes.
 *
 * Secrets are fetched before the first request is handled, not at import time: a failure
 * during module evaluation gives a bare Runtime.ImportModuleError with no detail, while
 * failing here surfaces the actual cause.
 *
 * The event and context types come from Hono's adapter rather than @types/aws-lambda,
 * because the adapter accepts a union of payload versions and its own types are what
 * `handle` is declared against.
 */
const app = handle(createApp());

export const handler = async (event: LambdaEvent, context: LambdaContext) => {
  await loadSecrets();
  return app(event, context);
};
