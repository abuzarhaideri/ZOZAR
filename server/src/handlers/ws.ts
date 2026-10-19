import { eq } from 'drizzle-orm';
import type { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { verifyAccessToken } from '@/auth/tokens';
import { getDatabase, schema } from '@/db/client';
import { subscribeConnection } from '@/realtime/publish';

/**
 * WebSocket Lambda entrypoint, handling $connect, $disconnect and $default.
 *
 * Authentication happens at $connect, via an access token in the query string. A browser
 * WebSocket cannot set an Authorization header, and this client is a React Native app
 * using the same constraint, so the query string is the only channel available. The
 * trade-off is that the token appears in API Gateway access logs, which is why access
 * tokens are short-lived and the refresh token is never sent this way.
 *
 * Returning a non-2xx from $connect refuses the handshake outright, so an unauthenticated
 * socket is never established in the first place.
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { routeKey, connectionId } = event.requestContext;

  switch (routeKey) {
    case '$connect':
      return connect(event, connectionId);
    case '$disconnect':
      return disconnect(connectionId);
    default:
      return message(event, connectionId);
  }
};

async function connect(
  event: APIGatewayProxyWebsocketEventV2,
  connectionId: string,
): Promise<APIGatewayProxyResultV2> {
  const token = (event as { queryStringParameters?: Record<string, string> }).queryStringParameters?.token;
  const session = token ? await verifyAccessToken(token) : null;
  if (!session) return { statusCode: 401, body: 'Unauthorized' };

  await getDatabase()
    .insert(schema.wsConnections)
    .values({ connectionId, userId: session.userId })
    // API Gateway connection ids are unique, but a retried $connect must not fail.
    .onConflictDoUpdate({
      target: schema.wsConnections.connectionId,
      set: { userId: session.userId, lastSeenAt: new Date() },
    });

  return { statusCode: 200, body: 'Connected' };
}

async function disconnect(connectionId: string): Promise<APIGatewayProxyResultV2> {
  await getDatabase().delete(schema.wsConnections).where(eq(schema.wsConnections.connectionId, connectionId));
  return { statusCode: 200, body: 'Disconnected' };
}

/**
 * Client messages. Only two actions exist: subscribing to one conversation, and a ping to
 * keep the connection and its row fresh.
 *
 * Clients cannot publish over the socket. Sending a chat message goes through the HTTP
 * API, so there is exactly one path that writes a message and one place that authorizes
 * it; accepting writes here would duplicate that rule and invite the two to diverge.
 */
async function message(
  event: APIGatewayProxyWebsocketEventV2,
  connectionId: string,
): Promise<APIGatewayProxyResultV2> {
  const database = getDatabase();

  const [registered] = await database
    .select({ userId: schema.wsConnections.userId })
    .from(schema.wsConnections)
    .where(eq(schema.wsConnections.connectionId, connectionId))
    .limit(1);

  // The row is written at $connect, so its absence means this socket was never
  // authenticated or has been swept.
  if (!registered) return { statusCode: 401, body: 'Unauthorized' };

  let parsed: { action?: string; threadId?: string };
  try {
    parsed = JSON.parse(event.body ?? '{}') as typeof parsed;
  } catch {
    return { statusCode: 400, body: 'Expected JSON' };
  }

  if (parsed.action === 'ping') {
    await database
      .update(schema.wsConnections)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.wsConnections.connectionId, connectionId));
    return { statusCode: 200, body: JSON.stringify({ type: 'pong' }) };
  }

  if (parsed.action === 'subscribe') {
    if (!parsed.threadId) return { statusCode: 400, body: 'threadId is required' };
    const allowed = await subscribeConnection(database, connectionId, registered.userId, parsed.threadId);
    // 404, not 403: a caller must not learn that a thread id it guessed is real.
    if (!allowed) return { statusCode: 404, body: 'Conversation does not exist' };
    return { statusCode: 200, body: JSON.stringify({ type: 'subscribed', threadId: parsed.threadId }) };
  }

  return { statusCode: 400, body: 'Unknown action' };
}
