import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * FCM delivery. Firebase is used for this and nothing else — no Auth, no Firestore, no
 * Storage, no Functions.
 */

export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /**
   * Deliver as data only, with no tray notification.
   *
   * This is how realtime reaches the app now that there is no WebSocket: a new chat
   * message wakes the client, which then fetches. The user must not see a second,
   * duplicate banner for something the open conversation is about to render itself, so
   * `notification` is omitted and `title`/`body` serve only as a fallback description
   * for logs.
   */
  silent?: boolean;
};

/** Per-token outcome. `invalidToken` is distinguished from a transient failure because the
 * two demand opposite responses: deactivate the row versus retry it later. */
export type PushResult = { ok: true } | { ok: false; invalidToken: boolean; error: string };

export type Notifier = {
  send(message: PushMessage): Promise<PushResult>;
};

let app: App | undefined;

function firebaseApp(): App {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) throw new Error('Missing required environment variable: FIREBASE_SERVICE_ACCOUNT');

  let credentials: { projectId: string; clientEmail: string; privateKey: string };
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    credentials = {
      projectId: parsed.project_id!,
      clientEmail: parsed.client_email!,
      // Service account JSON carries literal \n inside the PEM when stored as one line.
      privateKey: parsed.private_key!.replace(/\\n/g, '\n'),
    };
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid service account JSON: ${String(error)}`);
  }

  // Reuse an already-initialised app across warm invocations; initializeApp throws on a
  // duplicate name.
  app = getApps()[0] ?? initializeApp({ credential: cert(credentials) });
  return app;
}

/**
 * These FCM error codes mean the token will never work again, so the device row should be
 * deactivated rather than retried. Everything else is treated as transient.
 */
const PERMANENT_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

function fcmNotifier(): Notifier {
  return {
    async send(message) {
      try {
        await getMessaging(firebaseApp()).send({
          token: message.token,
          // A silent push carries no `notification` block at all. Including one with
          // empty strings would still post an empty banner on Android.
          ...(message.silent ? {} : { notification: { title: message.title, body: message.body } }),
          data: message.data ?? {},
          android: {
            // A missed-wake escalation is time-critical: it is useless if Doze defers it.
            // A silent realtime nudge is not, and high priority on every chat message
            // would spend the app's standby budget and get it throttled by Android, so
            // only the user-visible pushes ask for it.
            priority: message.silent ? 'normal' : 'high',
            ...(message.silent
              ? {}
              : { notification: { channelId: 'zo-zar-wake-alarms-v3-zozar', defaultSound: true } }),
          },
        });
        return { ok: true };
      } catch (error) {
        const code = (error as { code?: string })?.code ?? '';
        return {
          ok: false,
          invalidToken: PERMANENT_CODES.has(code),
          error: `${code || 'unknown'}: ${(error as Error)?.message ?? String(error)}`,
        };
      }
    },
  };
}

let override: Notifier | undefined;
let resolved: Notifier | undefined;

export function getNotifier(): Notifier {
  if (override) return override;
  resolved ??= fcmNotifier();
  return resolved;
}

/** Test seam. Production code never calls this. */
export function setNotifierForTests(implementation: Notifier | null): void {
  override = implementation ?? undefined;
}
