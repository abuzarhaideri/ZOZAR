import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';

/**
 * HTTP client for the ZO-ZAR API.
 *
 * Replaces the Appwrite SDK. Appwrite managed sessions inside its own client; now the app
 * owns them, which means three things live here: the access token, the refresh token, and
 * the rules for renewing one with the other.
 *
 * The access token is kept in memory only. Writing it to storage would leave a bearer
 * credential on disk for no benefit, since it expires in fifteen minutes and can always be
 * re-minted from the refresh token.
 *
 * The refresh token goes to `expo-secure-store`, which is backed by the Android Keystore.
 * It is the only long-lived credential on the device.
 */

const REFRESH_TOKEN_KEY = 'zozar.refresh.v1';
/** Renew slightly early so a request does not fail on a token that expires mid-flight. */
const RENEW_SKEW_SECONDS = 60;

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_credentials'
  | 'password_reset_required'
  | 'email_taken'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'
  | 'network'
  | 'not_configured';

/** Carries the server's machine-readable code so callers branch on `code`, never on
 * message text, which is free to be reworded. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export type AuthSession = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; email: string; displayName: string; timezone: string };
};

const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') ?? '';

export function isApiConfigured(): boolean {
  return baseUrl.length > 0;
}

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;

/**
 * In-flight refresh, shared by every caller.
 *
 * This is not an optimisation, it is a correctness requirement. The server rotates refresh
 * tokens and treats a replayed one as theft, revoking the whole family. If two requests
 * both 401 and both refresh, the second presents a token the first already spent, and the
 * user is signed out of a working session. Funnelling every renewal through one promise is
 * what prevents that.
 */
let refreshInFlight: Promise<string> | null = null;

export async function readStoredRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // A corrupt or unreadable keystore entry should present as "not signed in" rather
    // than crashing the app on launch.
    return null;
  }
}

async function writeRefreshToken(token: string | null): Promise<void> {
  if (token === null) {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => undefined);
    return;
  }
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

/** Adopts a freshly issued session: tokens from sign-in, sign-up, or account claim. */
export async function adoptSession(session: AuthSession): Promise<void> {
  accessToken = session.accessToken;
  accessTokenExpiresAt = Date.now() + session.expiresIn * 1000;
  await writeRefreshToken(session.refreshToken);
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  accessTokenExpiresAt = 0;
  refreshInFlight = null;
  await writeRefreshToken(null);
}

/**
 * Reads the current access token.
 *
 * Exists solely for the WebSocket handshake, which cannot send an Authorization header and
 * must put the token in the query string. Nothing else should use this: HTTP callers go
 * through `apiRequest`, which handles renewal. Returns null when no live token is held, so
 * a caller cannot open a socket with a stale credential.
 */
export function peekAccessToken(): string | null {
  return hasLiveAccessToken() ? accessToken : null;
}

export function hasLiveAccessToken(): boolean {
  return accessToken !== null && Date.now() < accessTokenExpiresAt - RENEW_SKEW_SECONDS * 1000;
}

/** Exchanges the stored refresh token for a new pair, rotating what is on disk. */
async function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= (async () => {
    try {
      const stored = await readStoredRefreshToken();
      if (!stored) throw new ApiError('unauthorized', 'Sign in to continue.', 401);

      const response = await fetchJson<AuthSession>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: stored }),
      });

      accessToken = response.accessToken;
      accessTokenExpiresAt = Date.now() + response.expiresIn * 1000;
      // Persist the rotated token before returning: if the app is killed between the
      // server rotating and this write, the stored token is already spent and the session
      // is unrecoverable.
      await writeRefreshToken(response.refreshToken);
      return response.accessToken;
    } catch (error) {
      // A failed refresh means the session is gone. Clearing it here stops every
      // subsequent request from retrying a credential that will never work again.
      await clearSession();
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** One unauthenticated round trip, used by auth endpoints and by refresh itself. */
async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  if (!isApiConfigured()) {
    throw new ApiError('not_configured', 'EXPO_PUBLIC_API_URL is not set.', 0);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    });
  } catch {
    // Offline, DNS failure, TLS problem. Distinguished from an HTTP error so the UI can
    // say "you appear to be offline" rather than "something went wrong".
    throw new ApiError('network', 'Could not reach ZO-ZAR. Check your connection.', 0);
  }

  return parse<T>(response);
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      (error?.code as ApiErrorCode) ?? 'internal',
      error?.message ?? 'Something went wrong.',
      response.status,
    );
  }

  return body as T;
}

/**
 * An authenticated request.
 *
 * Renews the access token proactively when it is close to expiry, and reactively on a
 * 401 — the proactive path avoids a wasted round trip, while the reactive one covers a
 * token the server rejected for a reason the client could not predict, such as a restart
 * with a rotated signing key.
 *
 * Retried exactly once. A second 401 after a successful refresh means the credential is
 * not the problem, and retrying further would loop.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isApiConfigured()) {
    throw new ApiError('not_configured', 'EXPO_PUBLIC_API_URL is not set.', 0);
  }

  if (!hasLiveAccessToken()) {
    await refreshAccessToken();
  }

  const send = async (): Promise<Response> => {
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init.headers as Record<string, string>),
        },
      });
    } catch {
      throw new ApiError('network', 'Could not reach ZO-ZAR. Check your connection.', 0);
    }
  };

  let response = await send();

  if (response.status === 401) {
    await refreshAccessToken();
    response = await send();
  }

  return parse<T>(response);
}

/** Unauthenticated endpoints: sign-up, sign-in, refresh, claim, sign-out. */
export async function apiPublic<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Uploads a local file to a presigned S3 URL.
 *
 * The body goes straight to S3, not through the API, so the Lambda never buffers a
 * multi-megabyte recording — which both keeps it inside its memory budget and avoids
 * paying for the transfer twice. The Content-Type must match what was signed, or S3
 * rejects the signature.
 */
export async function uploadToPresignedUrl(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  const file = await fetch(fileUri);
  const blob = await file.blob();

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });

  if (!response.ok) {
    throw new ApiError('internal', `Upload failed with status ${response.status}.`, response.status);
  }
}
