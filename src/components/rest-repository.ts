import {
  ApiError,
  adoptSession,
  apiPublic,
  apiRequest,
  clearSession,
  isApiConfigured,
  peekAccessToken,
  readStoredRefreshToken,
  uploadToPresignedUrl,
  type AuthSession,
} from '@/lib/api-client';
import type { PushTokenRegistration } from '@/services/push-token-service';
import type { VoiceNoteArtifact } from '@/services/voice-recorder-service';
import type { WakeSoundKey } from '@/types/domain';
import type {
  ChatRetention,
  RepositoryChatMessage,
  RepositoryCircleMember,
  RepositoryCommitment,
  RepositorySession,
  RepositoryWakeOccurrence,
  RepositoryWakePlan,
  RepositoryWakePlanInput,
  UiDifficulty,
  ZOZARRepository,
} from './zo-zar-repository';
import { UNPROTECTED_LABEL } from './zo-zar-repository';

/**
 * The ZO-ZAR API implementation of `ZOZARRepository`.
 *
 * This is the whole point of that interface existing: the backend moved from Appwrite to
 * a self-owned API without a single screen changing. Every shape the UI consumes is
 * produced here, so the server is free to speak its own vocabulary — snake_case tables,
 * ISO instants, 24-hour times — while the UI keeps the display-ready strings it was
 * written against.
 */

type ServerCommitment = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  status: 'planned' | 'completed' | 'archived';
};

type ServerWakePlan = {
  id: string;
  commitmentId: string | null;
  connectionId: string | null;
  scheduleType: 'once' | 'daily' | 'weekly';
  scheduledDate: string | null;
  localTime: string;
  timezone: string;
  weekdays: number[];
  difficulty: 'easy' | 'medium' | 'hard';
  soundKey: WakeSoundKey;
  graceMinutes: number;
  isActive: boolean;
};

type ServerOccurrence = {
  id: string;
  wakePlanId: string;
  commitmentId: string | null;
  scheduledFor: string;
  difficulty: 'easy' | 'medium' | 'hard';
  graceMinutes: number;
  status: RepositoryWakeOccurrence['status'];
};

type ServerConnection = {
  id: string;
  requesterId: string;
  recipientId: string | null;
  requesterEmail: string;
  recipientEmail: string;
  requesterDisplayName: string;
  recipientDisplayName: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  relationship: 'incoming' | 'outgoing';
  threadId: string | null;
};

type ServerMessage = {
  id: string;
  senderId: string;
  type: 'text' | 'voice' | 'system';
  body: string | null;
  voiceKey: string | null;
  voiceDurationSeconds: number | null;
  createdAt: string;
  expiresAt: string;
};

const MAX_WAKE_PLANS = 3;

function toUiDifficulty(value: 'easy' | 'medium' | 'hard'): UiDifficulty {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as UiDifficulty;
}

function toServerDifficulty(value: UiDifficulty): 'easy' | 'medium' | 'hard' {
  return value.toLowerCase() as 'easy' | 'medium' | 'hard';
}

/** '14:30' to '2:30 PM'. The API speaks 24-hour time; the UI shows a 12-hour clock. */
function toUiTime(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** '2:30 PM' or '14:30' to '14:30', for sending to the API. */
function toServerTime(value: string): string {
  const twelveHour = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!twelveHour) return value.trim();
  let hour = Number(twelveHour[1]);
  const meridiem = twelveHour[3]!.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${twelveHour[2]}`;
}

function displayTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Interprets a commitment time that may be a full instant or just a clock reading. */
function commitmentInstant(value: string): Date {
  if (value.includes('T') && Number.isFinite(Date.parse(value))) return new Date(value);
  const [hours, minutes] = toServerTime(value).split(':').map(Number);
  const next = new Date();
  next.setHours(hours ?? 7, minutes ?? 0, 0, 0);
  return next;
}

function mapCommitment(row: ServerCommitment): RepositoryCommitment {
  return {
    id: row.id,
    title: row.title,
    detail: row.description ?? '',
    dateLabel: new Date(row.startsAt).toLocaleDateString([], { weekday: 'long' }),
    time: displayTime(row.startsAt),
    startsAt: row.startsAt,
    done: row.status === 'completed',
  };
}

function mapWakePlan(row: ServerWakePlan, occurrence?: ServerOccurrence): RepositoryWakePlan {
  return {
    id: row.id,
    title: 'Protected wake plan',
    time: toUiTime(row.localTime),
    repeatLabel:
      row.scheduleType === 'once' ? 'One time' : row.scheduleType === 'daily' ? 'Every day' : 'Selected weekdays',
    difficulty: toUiDifficulty(row.difficulty),
    soundKey: row.soundKey,
    status: row.isActive ? 'Active' : 'Paused',
    graceMinutes: row.graceMinutes,
    protectedBy: row.connectionId ? 'Your trusted person' : UNPROTECTED_LABEL,
    commitmentId: row.commitmentId,
    circleId: row.connectionId,
    scheduleType: row.scheduleType,
    scheduledDate: row.scheduledDate,
    timezone: row.timezone,
    weekdays: row.weekdays ?? [],
    occurrenceId: occurrence?.id ?? null,
    occurrenceScheduledFor: occurrence?.scheduledFor ?? null,
  };
}

function mapOccurrence(row: ServerOccurrence): RepositoryWakeOccurrence {
  return {
    id: row.id,
    wakePlanId: row.wakePlanId,
    commitmentId: row.commitmentId,
    scheduledFor: row.scheduledFor,
    difficulty: toUiDifficulty(row.difficulty),
    graceMinutes: row.graceMinutes,
    status: row.status,
  };
}

function planInputToBody(input: Partial<RepositoryWakePlanInput>): Record<string, unknown> {
  return {
    ...(input.commitmentId !== undefined && { commitmentId: input.commitmentId }),
    ...(input.circleId !== undefined && { connectionId: input.circleId }),
    ...(input.scheduleType !== undefined && { scheduleType: input.scheduleType }),
    ...(input.scheduledDate !== undefined && { scheduledDate: input.scheduledDate }),
    ...(input.time !== undefined && { localTime: toServerTime(input.time) }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.weekdays !== undefined && { weekdays: input.weekdays }),
    ...(input.difficulty !== undefined && { difficulty: toServerDifficulty(input.difficulty) }),
    ...(input.soundKey !== undefined && { soundKey: input.soundKey }),
    ...(input.graceMinutes !== undefined && { graceMinutes: input.graceMinutes }),
    ...(input.active !== undefined && { isActive: input.active }),
  };
}

export class RestRepository implements ZOZARRepository {
  readonly mode = 'REST' as const;

  /** Who we are, needed to label a message as mine or theirs. Set on sign-in and restore. */
  private userId: string | null = null;

  /**
   * Connection id to thread id.
   *
   * The app navigates to a chat by connection, because that is what the People list
   * shows, while the chat API is keyed on the thread. The server supplies the mapping on
   * every connection, and this caches it so the common path costs nothing. `resolveThread`
   * refetches when a deep link arrives before the list has loaded.
   */
  private threads = new Map<string, string>();

  private async adopt(session: AuthSession): Promise<RepositorySession> {
    await adoptSession(session);
    this.userId = session.user.id;
    return {
      userId: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
    };
  }

  async signUp(name: string, email: string, password: string) {
    const session = await apiPublic<AuthSession>('/auth/sign-up', {
      email,
      password,
      displayName: name,
      // The device's zone is the only sensible default, and alarms are scheduled in it.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return { session: await this.adopt(session), requiresEmailConfirmation: false };
  }

  async signIn(email: string, password: string) {
    const session = await apiPublic<AuthSession>('/auth/sign-in', { email, password });
    return this.adopt(session);
  }

  /**
   * Restores a session from the stored refresh token.
   *
   * Returns null rather than throwing when there is no usable token: "not signed in" is
   * the normal state on a fresh install, not an error to surface.
   */
  async restoreSession(): Promise<RepositorySession | null> {
    const stored = await readStoredRefreshToken();
    if (!stored) return null;

    try {
      const session = await apiPublic<AuthSession>('/auth/refresh', { refreshToken: stored });
      return this.adopt(session);
    } catch (error) {
      // A network failure must not look like a signed-out user, or a commuter in a tunnel
      // gets logged out. Only an actual rejection clears the stored credential.
      if (error instanceof ApiError && error.code === 'network') throw error;
      await clearSession();
      return null;
    }
  }

  async signOut(): Promise<void> {
    const stored = await readStoredRefreshToken();
    if (stored) {
      // Best effort: the local session is cleared regardless, since a user who taps sign
      // out must end up signed out even with no connectivity.
      await apiPublic('/auth/sign-out', { refreshToken: stored }).catch(() => undefined);
    }
    this.userId = null;
    this.threads.clear();
    await clearSession();
  }

  async updateProfilePhoto(uri: string): Promise<string> {
    const contentType = uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const presigned = await apiRequest<{ key: string; uploadUrl: string }>('/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({ kind: 'profile-photo', contentType }),
    });

    await uploadToPresignedUrl(presigned.uploadUrl, uri, contentType);
    await apiRequest('/v1/uploads/profile-photo', {
      method: 'POST',
      body: JSON.stringify({ key: presigned.key }),
    });

    const { downloadUrl } = await apiRequest<{ downloadUrl: string }>(
      `/v1/uploads/download?key=${encodeURIComponent(presigned.key)}`,
    );
    return downloadUrl;
  }

  async listCommitments(): Promise<RepositoryCommitment[]> {
    const { commitments } = await apiRequest<{ commitments: ServerCommitment[] }>('/v1/commitments');
    return commitments.map(mapCommitment);
  }

  async createCommitment(title: string, time: string): Promise<RepositoryCommitment> {
    const startsAt = commitmentInstant(time);
    if (startsAt.getTime() <= Date.now()) {
      throw new Error('Choose a future date and time for this commitment.');
    }
    const { commitment } = await apiRequest<{ commitment: ServerCommitment }>('/v1/commitments', {
      method: 'POST',
      body: JSON.stringify({ title, startsAt: startsAt.toISOString() }),
    });
    return mapCommitment(commitment);
  }

  async updateCommitment(id: string, title: string, startsAt: string): Promise<RepositoryCommitment> {
    const { commitment } = await apiRequest<{ commitment: ServerCommitment }>(`/v1/commitments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, startsAt: commitmentInstant(startsAt).toISOString() }),
    });
    return mapCommitment(commitment);
  }

  async deleteCommitment(id: string): Promise<void> {
    await apiRequest(`/v1/commitments/${id}`, { method: 'DELETE' });
  }

  async setCommitmentComplete(id: string, complete: boolean): Promise<void> {
    await apiRequest(`/v1/commitments/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ complete }),
    });
  }

  private async plansWithOccurrences(): Promise<RepositoryWakePlan[]> {
    const { wakePlans, occurrences } = await apiRequest<{
      wakePlans: ServerWakePlan[];
      occurrences: ServerOccurrence[];
    }>('/v1/wake-plans');

    // The server returns the soonest scheduled occurrence per plan in one response, so the
    // list renders without a request per row.
    const nextByPlan = new Map<string, ServerOccurrence>();
    for (const occurrence of occurrences) {
      if (!nextByPlan.has(occurrence.wakePlanId)) nextByPlan.set(occurrence.wakePlanId, occurrence);
    }

    return wakePlans.map((plan) => mapWakePlan(plan, nextByPlan.get(plan.id)));
  }

  async listWakePlans(): Promise<RepositoryWakePlan[]> {
    return this.plansWithOccurrences();
  }

  async getWakePlan(): Promise<RepositoryWakePlan | null> {
    const plans = await this.plansWithOccurrences();
    return plans[0] ?? null;
  }

  async createWakePlan(input: RepositoryWakePlanInput): Promise<RepositoryWakePlan> {
    const { wakePlan } = await apiRequest<{ wakePlan: ServerWakePlan }>('/v1/wake-plans', {
      method: 'POST',
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...planInputToBody(input),
      }),
    });
    return mapWakePlan(wakePlan);
  }

  async updateWakePlan(id: string, input: Partial<RepositoryWakePlanInput>): Promise<RepositoryWakePlan> {
    const { wakePlan } = await apiRequest<{ wakePlan: ServerWakePlan }>(`/v1/wake-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(planInputToBody(input)),
    });
    return mapWakePlan(wakePlan);
  }

  async deleteWakePlan(id: string): Promise<void> {
    await apiRequest(`/v1/wake-plans/${id}`, { method: 'DELETE' });
  }

  async listWakeOccurrences(wakePlanId?: string): Promise<RepositoryWakeOccurrence[]> {
    const query = wakePlanId ? `?wakePlanId=${encodeURIComponent(wakePlanId)}` : '';
    const { occurrences } = await apiRequest<{ occurrences: ServerOccurrence[] }>(
      `/v1/wake-occurrences${query}`,
    );
    return occurrences.map(mapOccurrence);
  }

  async getWakeOccurrence(occurrenceId: string): Promise<RepositoryWakeOccurrence | null> {
    try {
      const { occurrence } = await apiRequest<{ occurrence: ServerOccurrence }>(
        `/v1/wake-occurrences/${occurrenceId}`,
      );
      return mapOccurrence(occurrence);
    } catch (error) {
      // A missing occurrence is an expected outcome when a plan was edited since the
      // alarm was scheduled, so it reads as null rather than an error.
      if (error instanceof ApiError && error.code === 'not_found') return null;
      throw error;
    }
  }

  async setWakePlanActive(id: string, active: boolean): Promise<RepositoryWakePlan> {
    const { wakePlan } = await apiRequest<{ wakePlan: ServerWakePlan }>(`/v1/wake-plans/${id}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
    return mapWakePlan(wakePlan);
  }

  async setWakeDifficulty(id: string, difficulty: UiDifficulty): Promise<void> {
    await apiRequest(`/v1/wake-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ difficulty: toServerDifficulty(difficulty) }),
    });
  }

  /** Creates or updates, depending on whether the input carries an id. The three-plan
   * limit is enforced by the server; this check only avoids a round trip that would be
   * refused with a 409. */
  async saveWakePlan(input: RepositoryWakePlanInput): Promise<RepositoryWakePlan> {
    if (input.id) return this.updateWakePlan(input.id, input);

    const existing = await this.plansWithOccurrences();
    if (existing.length >= MAX_WAKE_PLANS) {
      throw new Error(`You can save up to ${MAX_WAKE_PLANS} wake plans.`);
    }
    return this.createWakePlan(input);
  }

  async confirmWake(occurrenceId: string): Promise<void> {
    await apiRequest(`/v1/wake-occurrences/${occurrenceId}/confirm`, { method: 'POST' });
  }

  async recordWakeSnooze(occurrenceId: string): Promise<void> {
    await apiRequest(`/v1/wake-occurrences/${occurrenceId}/snooze`, { method: 'POST' });
  }

  private async fetchConnections(): Promise<ServerConnection[]> {
    const { connections } = await apiRequest<{ connections: ServerConnection[] }>('/v1/connections');
    for (const connection of connections) {
      if (connection.threadId) this.threads.set(connection.id, connection.threadId);
    }
    return connections;
  }

  async listCircleMembers(): Promise<RepositoryCircleMember[]> {
    const connections = await this.fetchConnections();

    return connections
      // Declined and revoked connections are history, not people to show.
      .filter((connection) => connection.status === 'pending' || connection.status === 'accepted')
      .map((connection) => {
        const outgoing = connection.relationship === 'outgoing';
        const name = outgoing
          ? connection.recipientDisplayName ?? connection.recipientEmail
          : connection.requesterDisplayName;
        const email = outgoing ? connection.recipientEmail : connection.requesterEmail;

        return {
          id: connection.id,
          name,
          initials: initialsOf(name),
          detail: connection.status === 'accepted' ? email : outgoing ? 'Invitation sent' : 'Wants to protect your wake',
          status: connection.status === 'accepted' ? ('Accepted' as const) : ('Pending' as const),
          relationship: connection.relationship,
          circleId: connection.id,
        };
      });
  }

  async inviteCircleMember(email: string): Promise<void> {
    await apiRequest('/v1/connections', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async respondToCircleInvitation(id: string, accept: boolean): Promise<void> {
    await apiRequest(`/v1/connections/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    });
  }

  async removeCircleMember(id: string): Promise<void> {
    await apiRequest(`/v1/connections/${id}`, { method: 'DELETE' });
    this.threads.delete(id);
  }

  /** Accepts either a connection id, which is what the UI navigates with, or a thread id. */
  private async resolveThread(id: string): Promise<string> {
    const cached = this.threads.get(id);
    if (cached) return cached;

    await this.fetchConnections();
    const resolved = this.threads.get(id);
    if (resolved) return resolved;

    // Not a known connection. Treat it as a thread id already: the chat screen can be
    // reached by deep link, and the server will refuse an id the caller is not party to.
    return id;
  }

  async listMessages(threadId: string): Promise<RepositoryChatMessage[]> {
    const resolved = await this.resolveThread(threadId);
    const { messages } = await apiRequest<{ messages: ServerMessage[] }>(
      `/v1/chat/threads/${resolved}/messages`,
    );

    return Promise.all(messages.map((message) => this.mapMessage(message)));
  }

  private async mapMessage(message: ServerMessage): Promise<RepositoryChatMessage> {
    let voiceUri: string | undefined;
    if (message.type === 'voice' && message.voiceKey) {
      try {
        const { downloadUrl } = await apiRequest<{ downloadUrl: string }>(
          `/v1/uploads/download?key=${encodeURIComponent(message.voiceKey)}`,
        );
        voiceUri = downloadUrl;
      } catch {
        // An expired or swept recording leaves the bubble in place without audio, rather
        // than failing the whole conversation load.
        voiceUri = undefined;
      }
    }

    return {
      id: message.id,
      body: message.body ?? (message.type === 'voice' ? 'Voice note' : ''),
      timestamp: displayTime(message.createdAt),
      author: message.senderId === this.userId ? 'me' : 'them',
      kind: message.type,
      voiceUri,
      expiresAt: message.expiresAt,
    };
  }

  async getChatRetention(threadId: string): Promise<ChatRetention> {
    const resolved = await this.resolveThread(threadId);
    const { thread } = await apiRequest<{ thread: { retention: ChatRetention } }>(
      `/v1/chat/threads/${resolved}`,
    );
    return thread.retention;
  }

  async setChatRetention(threadId: string, retention: ChatRetention): Promise<void> {
    const resolved = await this.resolveThread(threadId);
    await apiRequest(`/v1/chat/threads/${resolved}`, {
      method: 'PATCH',
      body: JSON.stringify({ retention }),
    });
  }

  /**
   * Watches a conversation over the WebSocket API.
   *
   * The callback is a change signal, not a payload: it tells the store to refetch rather
   * than handing it a message to splice in. That keeps one code path building the message
   * list, so a realtime event and a cold load cannot disagree about what the conversation
   * contains.
   *
   * Falls back to doing nothing when no WebSocket URL is configured. Realtime is an
   * enhancement here; the chat still works by fetching.
   */
  async subscribeMessages(threadId: string, onChange: () => void): Promise<() => void> {
    const wsBase = process.env.EXPO_PUBLIC_WS_URL?.trim();
    if (!wsBase) return () => undefined;

    const resolved = await this.resolveThread(threadId);
    // The socket authenticates with an access token in the query string, since a
    // WebSocket handshake cannot carry an Authorization header. A request is made first so
    // the token in hand is fresh rather than one about to expire mid-connection.
    await apiRequest(`/v1/chat/threads/${resolved}`);
    const token = peekAccessToken();
    if (!token) return () => undefined;

    let socket: WebSocket | null = new WebSocket(`${wsBase}?token=${encodeURIComponent(token)}`);
    let closed = false;

    socket.onopen = () => {
      socket?.send(JSON.stringify({ action: 'subscribe', threadId: resolved }));
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { type?: string; threadId?: string };
        if (parsed.type === 'message.created' && parsed.threadId === resolved) onChange();
      } catch {
        // A frame we cannot parse is not worth failing the subscription over.
      }
    };

    socket.onerror = () => {
      // Swallowed deliberately: a dropped socket must not surface as a chat error, and
      // the next fetch will catch the client up.
    };

    return () => {
      if (closed) return;
      closed = true;
      socket?.close();
      socket = null;
    };
  }

  async sendMessage(threadId: string, body: string): Promise<RepositoryChatMessage | null> {
    const resolved = await this.resolveThread(threadId);
    const { message } = await apiRequest<{ message: ServerMessage }>(
      `/v1/chat/threads/${resolved}/messages`,
      { method: 'POST', body: JSON.stringify({ body }) },
    );
    return this.mapMessage(message);
  }

  async sendVoiceNote(threadId: string, artifact: VoiceNoteArtifact): Promise<void> {
    const resolved = await this.resolveThread(threadId);

    const presigned = await apiRequest<{ key: string; uploadUrl: string }>('/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'voice-note',
        contentType: artifact.mimeType,
        threadId: resolved,
      }),
    });

    // Straight to S3, so the Lambda never buffers the recording.
    await uploadToPresignedUrl(presigned.uploadUrl, artifact.uri, artifact.mimeType);

    await apiRequest('/v1/uploads/voice-note', {
      method: 'POST',
      body: JSON.stringify({
        key: presigned.key,
        durationSeconds: Math.max(1, Math.round(artifact.durationSeconds)),
      }),
    });
  }

  async upsertDeviceToken(registration: PushTokenRegistration): Promise<void> {
    await apiRequest('/v1/device-tokens', {
      method: 'POST',
      body: JSON.stringify({
        token: registration.nativeDeviceToken,
        platform: registration.platform,
      }),
    });
  }
}

export function createRestRepository(): RestRepository {
  return new RestRepository();
}

export { isApiConfigured };
