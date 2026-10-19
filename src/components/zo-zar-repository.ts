import { File } from 'expo-file-system';

import type { VoiceNoteArtifact } from '@/services/voice-recorder-service';
import type { PushTokenRegistration } from '@/services/push-token-service';
import { isApiConfigured } from '@/lib/api-client';
import { createRestRepository } from './rest-repository';
import type {
  Commitment as DomainCommitment,
  Difficulty as DomainDifficulty,
  Message as DomainMessage,
  WakeOccurrence as DomainWakeOccurrence,
  WakePlan as DomainWakePlan,
  WakeSoundKey,
} from '@/types/domain';

export type RepositoryMode = 'REST' | 'LOCAL_FALLBACK';
export type UiDifficulty = 'Easy' | 'Medium' | 'Hard';
export type RepositorySession = { userId: string; email?: string; displayName?: string; profilePhotoUri?: string };
export type RepositoryAuthResult = { session: RepositorySession | null; requiresEmailConfirmation: boolean };
export type RepositoryCommitment = { id: string; title: string; detail: string; dateLabel: string; time: string; startsAt: string; done: boolean };

export type RepositoryWakePlan = {
  id: string;
  title: string;
  time: string;
  repeatLabel: string;
  difficulty: UiDifficulty;
  soundKey: WakeSoundKey;
  status: 'Scheduled' | 'Active' | 'Paused' | 'Completed';
  graceMinutes: number;
  protectedBy: string;
  commitmentId: string | null;
  circleId: string | null;
  scheduleType: 'once' | 'daily' | 'weekly';
  scheduledDate: string | null;
  timezone: string;
  weekdays: number[];
  occurrenceId?: string | null;
  occurrenceScheduledFor?: string | null;
  isEmpty?: boolean;
};

export type RepositoryWakeOccurrence = {
  id: string;
  wakePlanId: string;
  commitmentId: string | null;
  scheduledFor: string;
  difficulty: UiDifficulty;
  graceMinutes: number;
  status: DomainWakeOccurrence['status'];
};

export type RepositoryWakePlanInput = {
  id?: string | null;
  commitmentId?: string | null;
  circleId?: string | null;
  scheduleType: RepositoryWakePlan['scheduleType'];
  scheduledDate?: string | null;
  time: string;
  timezone: string;
  weekdays?: number[];
  difficulty: UiDifficulty;
  soundKey?: WakeSoundKey;
  graceMinutes?: number;
  active?: boolean;
};

export type RepositoryCircleMember = {
  id: string;
  name: string;
  initials: string;
  detail: string;
  status: 'Accepted' | 'Pending';
  relationship: 'incoming' | 'outgoing';
  circleId?: string;
};
export type ChatRetention = '7d' | '30d';
export type RepositoryChatMessage = { id: string; body: string; timestamp: string; author: 'me' | 'them'; kind?: 'text' | 'voice' | 'system'; voiceUri?: string; expiresAt?: string };

export type ZOZARRepository = {
  readonly mode: RepositoryMode;
  signUp: (name: string, email: string, password: string) => Promise<RepositoryAuthResult>;
  signIn: (email: string, password: string) => Promise<RepositorySession>;
  restoreSession: () => Promise<RepositorySession | null>;
  signOut: () => Promise<void>;
  updateProfilePhoto: (uri: string) => Promise<string>;
  listCommitments: () => Promise<RepositoryCommitment[]>;
  createCommitment: (title: string, time: string) => Promise<RepositoryCommitment>;
  updateCommitment: (id: string, title: string, startsAt: string) => Promise<RepositoryCommitment>;
  deleteCommitment: (id: string) => Promise<void>;
  setCommitmentComplete: (id: string, complete: boolean) => Promise<void>;
  getWakePlan: () => Promise<RepositoryWakePlan | null>;
  listWakePlans: () => Promise<RepositoryWakePlan[]>;
  createWakePlan: (input: RepositoryWakePlanInput) => Promise<RepositoryWakePlan>;
  updateWakePlan: (id: string, input: Partial<RepositoryWakePlanInput>) => Promise<RepositoryWakePlan>;
  deleteWakePlan: (id: string) => Promise<void>;
  listWakeOccurrences: (wakePlanId?: string) => Promise<RepositoryWakeOccurrence[]>;
  getWakeOccurrence: (occurrenceId: string) => Promise<RepositoryWakeOccurrence | null>;
  setWakePlanActive: (id: string, active: boolean) => Promise<RepositoryWakePlan>;
  setWakeDifficulty: (id: string, difficulty: UiDifficulty) => Promise<void>;
  saveWakePlan: (input: RepositoryWakePlanInput) => Promise<RepositoryWakePlan>;
  confirmWake: (occurrenceId: string) => Promise<void>;
  recordWakeSnooze: (occurrenceId: string) => Promise<void>;
  listCircleMembers: () => Promise<RepositoryCircleMember[]>;
  inviteCircleMember: (email: string) => Promise<void>;
  respondToCircleInvitation: (id: string, accept: boolean) => Promise<void>;
  removeCircleMember: (id: string) => Promise<void>;
  listMessages: (threadId: string) => Promise<RepositoryChatMessage[]>;
  getChatRetention: (threadId: string) => Promise<ChatRetention>;
  setChatRetention: (threadId: string, retention: ChatRetention) => Promise<void>;
  subscribeMessages: (threadId: string, onChange: () => void) => Promise<() => void>;
  sendMessage: (threadId: string, body: string) => Promise<RepositoryChatMessage | null>;
  sendVoiceNote: (threadId: string, artifact: VoiceNoteArtifact) => Promise<void>;
  upsertDeviceToken: (registration: PushTokenRegistration) => Promise<void>;
};

const MAX_WAKE_PLANS = 3;

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function toDomainDifficulty(value: UiDifficulty): DomainDifficulty {
  return value.toLowerCase() as DomainDifficulty;
}

function toUiDifficulty(value: DomainDifficulty): UiDifficulty {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as UiDifficulty;
}

function to24HourTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return value;
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function toUiTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function commitmentDate(value: string) {
  if (value.includes('T') && Number.isFinite(Date.parse(value))) return new Date(value);
  const next = new Date();
  const { hour, minute } = parseClock(value);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseClock(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return { hour: 7, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3]?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function nextOccurrenceForValues(
  scheduleType: RepositoryWakePlan['scheduleType'],
  scheduledDate: string | null | undefined,
  localTime: string,
  weekdays: number[] = [],
) {
  const { hour, minute } = parseClock(localTime);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  if (scheduleType === 'once') {
    if (!scheduledDate) throw new Error('Choose a date for a one-time wake alarm.');
    const [year, month, day] = scheduledDate.split('-').map(Number);
    candidate.setFullYear(year, month - 1, day);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) throw new Error('Choose a future date and time for this one-time alarm.');
    return candidate;
  }

  candidate.setHours(hour, minute, 0, 0);
  if (scheduleType === 'daily') {
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  const selected = new Set(weekdays);
  if (selected.size === 0) throw new Error('Choose at least one weekday for this wake alarm.');
  for (let offset = 0; offset <= 7; offset += 1) {
    const next = new Date(candidate);
    next.setDate(candidate.getDate() + offset);
    if (selected.has(next.getDay()) && next.getTime() > now.getTime()) return next;
  }
  throw new Error('The selected weekday alarm could not be scheduled.');
}

function mapCommitment(row: Record<string, any>): RepositoryCommitment {
  const startsAt = row.startsAt ?? row.starts_at;
  const date = new Date(startsAt);
  return { id: row.$id ?? row.id, title: row.title, detail: row.description ?? 'Personal · Commitment', dateLabel: date.toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt), startsAt, done: row.status === 'completed' };
}

function mapWakePlan(row: Record<string, any>, occurrence?: RepositoryWakeOccurrence): RepositoryWakePlan {
  const scheduleType = row.scheduleType ?? row.schedule_type;
  return {
    id: row.$id ?? row.id,
    title: 'Protected wake plan',
    time: toUiTime(row.localTime ?? row.local_time),
    repeatLabel: scheduleType === 'once' ? 'One time' : scheduleType === 'daily' ? 'Every day' : 'Selected weekdays',
    difficulty: toUiDifficulty(row.difficulty),
    soundKey: row.soundKey ?? row.sound_key ?? 'zo-zar',
    status: (row.isActive ?? row.is_active) ? 'Active' : 'Paused',
    graceMinutes: row.graceMinutes ?? row.grace_period_minutes,
    protectedBy: (row.connectionId ?? row.circle_id) ? 'Your trusted person' : 'No trusted person yet',
    commitmentId: row.commitmentId ?? row.commitment_id ?? null,
    circleId: row.connectionId ?? row.circle_id ?? null,
    scheduleType,
    scheduledDate: row.scheduledDate ?? row.scheduled_date ?? null,
    timezone: row.timezone,
    weekdays: row.weekdays,
    occurrenceId: occurrence?.id ?? null,
    occurrenceScheduledFor: occurrence?.scheduledFor ?? null,
  };
}

function mapOccurrence(row: Record<string, any>): RepositoryWakeOccurrence {
  return { id: row.$id ?? row.id, wakePlanId: row.wakePlanId ?? row.wake_plan_id, commitmentId: row.commitmentId ?? row.commitment_id ?? null, scheduledFor: row.scheduledFor ?? row.scheduled_for, difficulty: toUiDifficulty(row.difficulty), graceMinutes: row.graceMinutes ?? row.grace_period_minutes, status: row.status };
}

function localPlanFromInput(input: RepositoryWakePlanInput, id: string): RepositoryWakePlan {
  return {
    id,
    title: 'Protected wake plan',
    time: input.time,
    repeatLabel: input.scheduleType === 'once' ? 'One time' : input.scheduleType === 'daily' ? 'Every day' : 'Selected weekdays',
    difficulty: input.difficulty,
    soundKey: input.soundKey ?? 'zo-zar',
    status: input.active ? 'Active' : 'Paused',
    graceMinutes: input.graceMinutes ?? 10,
    protectedBy: input.circleId ? 'Your trusted circle' : 'No trusted person yet',
    commitmentId: input.commitmentId ?? null,
    circleId: input.circleId ?? null,
    scheduleType: input.scheduleType,
    scheduledDate: input.scheduledDate ?? null,
    timezone: input.timezone,
    weekdays: input.weekdays ?? [],
    occurrenceId: null,
    occurrenceScheduledFor: null,
  };
}

function localRepository(): ZOZARRepository {
  let commitments: RepositoryCommitment[] = [];
  let wakePlans: RepositoryWakePlan[] = [];
  let wakeOccurrences: RepositoryWakeOccurrence[] = [];
  let members: RepositoryCircleMember[] = [];
  let messages: RepositoryChatMessage[] = [];
  let chatRetention: ChatRetention = '30d';

  function withOccurrence(plan?: RepositoryWakePlan | null) {
    if (!plan) return null;
    const occurrence = wakeOccurrences.find((item) => item.wakePlanId === plan.id && ['scheduled', 'ringing'].includes(item.status));
    return { ...plan, occurrenceId: occurrence?.id ?? null, occurrenceScheduledFor: occurrence?.scheduledFor ?? null };
  }

  function scheduleLocalOccurrence(plan: RepositoryWakePlan) {
    const scheduledFor = nextOccurrenceForValues(plan.scheduleType, plan.scheduledDate, plan.time, plan.weekdays).toISOString();
    const occurrence: RepositoryWakeOccurrence = {
      id: `local-occurrence-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      wakePlanId: plan.id,
      commitmentId: plan.commitmentId,
      scheduledFor,
      difficulty: plan.difficulty,
      graceMinutes: plan.graceMinutes,
      status: 'scheduled',
    };
    wakeOccurrences = [...wakeOccurrences.filter((item) => item.wakePlanId !== plan.id || !['scheduled', 'ringing'].includes(item.status)), occurrence];
    return withOccurrence(plan) as RepositoryWakePlan;
  }

  function updateLocalPlan(id: string, input: Partial<RepositoryWakePlanInput>) {
    const current = wakePlans.find((item) => item.id === id);
    if (!current) throw new Error('Wake plan was not found.');
    const next: RepositoryWakePlan = {
      ...current,
      ...(input.time === undefined ? {} : { time: input.time }),
      ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
      ...(input.soundKey === undefined ? {} : { soundKey: input.soundKey }),
      ...(input.active === undefined ? {} : { status: input.active ? 'Active' as const : 'Paused' as const }),
      ...(input.commitmentId === undefined ? {} : { commitmentId: input.commitmentId }),
      ...(input.circleId === undefined ? {} : { circleId: input.circleId, protectedBy: input.circleId ? 'Your trusted circle' : 'No trusted person yet' }),
      ...(input.scheduleType === undefined ? {} : { scheduleType: input.scheduleType, repeatLabel: input.scheduleType === 'once' ? 'One time' : input.scheduleType === 'daily' ? 'Every day' : 'Selected weekdays' }),
      ...(input.scheduledDate === undefined ? {} : { scheduledDate: input.scheduledDate }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.weekdays === undefined ? {} : { weekdays: input.weekdays }),
      ...(input.graceMinutes === undefined ? {} : { graceMinutes: input.graceMinutes }),
    };
    wakePlans = wakePlans.map((item) => item.id === id ? next : item);
    if (next.status === 'Active') return scheduleLocalOccurrence(next);
    wakeOccurrences = wakeOccurrences.map((item) => item.wakePlanId === id && ['scheduled', 'ringing'].includes(item.status) ? { ...item, status: 'cancelled' } : item);
    return withOccurrence(next) as RepositoryWakePlan;
  }

  function createLocalPlan(input: RepositoryWakePlanInput) {
    if (wakePlans.length >= MAX_WAKE_PLANS) throw new Error('You can save up to three wake plans.');
    const next = localPlanFromInput({ ...input, active: false }, `local-wake-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    wakePlans = [next, ...wakePlans];
    return withOccurrence(next) as RepositoryWakePlan;
  }

  return {
    mode: 'LOCAL_FALLBACK',
    signUp: async (_name, email) => ({ session: { userId: 'local-user', email }, requiresEmailConfirmation: false }),
    signIn: async (email) => ({ userId: 'local-user', email }),
    restoreSession: async () => null,
    signOut: async () => undefined,
    updateProfilePhoto: async (uri) => uri,
    listCommitments: async () => commitments,
    createCommitment: async (title, time) => {
      const startsAt = commitmentDate(time).toISOString();
      if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
      const item = { id: `local-${Date.now()}`, title, detail: 'Personal · Commitment', dateLabel: new Date(startsAt).toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt), startsAt, done: false };
      commitments = [...commitments, item];
      return item;
    },
    updateCommitment: async (id, title, startsAt) => {
      const current = commitments.find((item) => item.id === id);
      if (!current) throw new Error('Commitment was not found.');
      if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
      const next = { ...current, title: title.trim(), startsAt, dateLabel: new Date(startsAt).toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt) };
      commitments = commitments.map((item) => item.id === id ? next : item);
      return next;
    },
    deleteCommitment: async (id) => { commitments = commitments.filter((item) => item.id !== id); },
    setCommitmentComplete: async (id, complete) => { commitments = commitments.map((item) => item.id === id ? { ...item, done: complete } : item); },
    getWakePlan: async () => withOccurrence(wakePlans[0]),
    listWakePlans: async () => wakePlans.map((plan) => withOccurrence(plan) as RepositoryWakePlan),
    createWakePlan: async (input) => createLocalPlan(input),
    updateWakePlan: async (id, input) => updateLocalPlan(id, input),
    deleteWakePlan: async (id) => {
      if (!wakePlans.some((item) => item.id === id)) throw new Error('Wake plan was not found.');
      wakePlans = wakePlans.filter((item) => item.id !== id);
      wakeOccurrences = wakeOccurrences.filter((item) => item.wakePlanId !== id);
    },
    listWakeOccurrences: async (wakePlanId) => wakeOccurrences.filter((item) => !wakePlanId || item.wakePlanId === wakePlanId),
    getWakeOccurrence: async (occurrenceId) => wakeOccurrences.find((item) => item.id === occurrenceId) ?? null,
    setWakePlanActive: async (id, active) => updateLocalPlan(id, { active }),
    setWakeDifficulty: async (id, difficulty) => { updateLocalPlan(id, { difficulty }); },
    saveWakePlan: async (input) => input.id ? updateLocalPlan(input.id, input) : createLocalPlan(input),
    confirmWake: async (occurrenceId) => { if (!wakeOccurrences.some((item) => item.id === occurrenceId)) throw new Error('No active wake occurrence is available to confirm.'); wakeOccurrences = wakeOccurrences.map((item) => item.id === occurrenceId ? { ...item, status: 'confirmed' } : item); },
    recordWakeSnooze: async () => undefined,
    listCircleMembers: async () => members,
    inviteCircleMember: async (email) => { const name = email.split('@')[0]; members = [...members, { id: `local-member-${Date.now()}`, name, initials: initials(name), detail: 'Circle invite · Pending', status: 'Pending', relationship: 'outgoing' }]; },
    respondToCircleInvitation: async (id, accept) => {
      if (!members.some((member) => member.id === id)) throw new Error('Invitation was not found.');
      members = accept
        ? members.map((member) => member.id === id ? { ...member, status: 'Accepted', detail: 'Wake support · Accepted' } : member)
        : members.filter((member) => member.id !== id);
    },
    removeCircleMember: async (id) => { members = members.filter((member) => member.id !== id); },
    listMessages: async () => messages,
    getChatRetention: async () => chatRetention,
    setChatRetention: async (_threadId, retention) => {
      chatRetention = retention;
      messages = [...messages, { id: `local-system-${Date.now()}`, body: `Messages now disappear after ${retention === '7d' ? '1 week' : '1 month'}.`, timestamp: 'Now', author: 'me', kind: 'system' }];
    },
    subscribeMessages: async () => () => undefined,
    sendMessage: async (_threadId, body) => { const message = { id: `local-message-${Date.now()}`, body, timestamp: 'Now', author: 'me' as const }; messages = [...messages, message]; return message; },
    sendVoiceNote: async () => undefined,
    upsertDeviceToken: async () => undefined,
  };
}

/**
 * Whether the repository persists to a server.
 *
 * The local fallback does not, so anything that only makes sense against a backend —
 * registering a push token, refetching a list after a write — is gated on this rather
 * than on a mode name. These checks previously compared against 'APPWRITE' in two places
 * and both broke when the backend changed; naming the capability keeps the next change to
 * one line.
 */
export function isServerBacked(mode: RepositoryMode): boolean {
  return mode === 'REST';
}

/**
 * Builds the repository the app runs against.
 *
 * The REST implementation is used whenever the API is configured. The local fallback is
 * not a second backend: it holds everything in memory for one session so the UI can be
 * developed and demonstrated without a server, and it is what runs when
 * EXPO_PUBLIC_API_URL is unset. Nothing it stores survives a reload.
 */
export function createZOZARRepository(): ZOZARRepository {
  return isApiConfigured() ? createRestRepository() : localRepository();
}
