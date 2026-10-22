/**
 * Push delivery.
 *
 * There is no provider. Firebase was removed at the project owner's instruction, and
 * nothing replaced it, so this module defines the shape of a notifier and records what
 * would have been sent.
 *
 * The interface is kept rather than deleted along with the implementation, because the
 * logic that decides *whether* to notify someone — the escalation sweep in
 * `worker/tasks.ts`, the retry and dedupe rules on `notification_jobs` — is the valuable
 * part and is independent of who carries the message. Adding a provider later means
 * writing one `Notifier` and nothing else.
 *
 * What does not work without one: the trusted person is never told that a wake was
 * missed, and a new chat message never wakes the other device. Both now surface only when
 * the other person next opens the app. On Android there is no way around that — an app
 * cannot hold its own socket open through Doze, which is why a push provider existed.
 */

export type PushMessage = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Data-only, with no tray notification. Used by realtime to wake the app silently. */
  silent?: boolean;
};

/** Per-token outcome. `invalidToken` is distinguished from a transient failure because the
 * two demand opposite responses: deactivate the row versus retry it later. */
export type PushResult = { ok: true } | { ok: false; invalidToken: boolean; error: string };

export type Notifier = {
  send(message: PushMessage): Promise<PushResult>;
};

/**
 * Reports every send as a transient failure.
 *
 * Transient and not `invalidToken`, deliberately: a permanent verdict would deactivate the
 * device row, so every registered device would be marked dead within one worker sweep and
 * would stay dead after a provider is added. Treating it as transient leaves the registry
 * intact and lets the existing retry and backoff rules hold the jobs until delivery is
 * possible again.
 */
function unconfiguredNotifier(): Notifier {
  let warned = false;

  return {
    async send(message) {
      // Logged once per process, not per message: a worker sweep can attempt hundreds of
      // sends, and one line per attempt would bury everything else in the Catalyst logs.
      if (!warned) {
        warned = true;
        console.warn('[push] no provider configured; notifications are not being delivered');
      }
      return {
        ok: false,
        invalidToken: false,
        error: `no push provider configured (would have sent: ${message.silent ? 'silent' : message.title})`,
      };
    },
  };
}

let override: Notifier | undefined;
let resolved: Notifier | undefined;

export function getNotifier(): Notifier {
  if (override) return override;
  resolved ??= unconfiguredNotifier();
  return resolved;
}

/** Test seam. Production code never calls this. */
export function setNotifierForTests(implementation: Notifier | null): void {
  override = implementation ?? undefined;
}
