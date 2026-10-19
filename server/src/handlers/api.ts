import { handle } from 'hono/aws-lambda';

import { createApp } from '@/app';

/**
 * API Lambda entrypoint, behind an API Gateway HTTP API.
 *
 * The app is built once at module scope so a warm container reuses it, along with the
 * database pool and the resolved JWT key. Building it per invocation would spend the
 * connection budget on handshakes.
 */
export const handler = handle(createApp());
