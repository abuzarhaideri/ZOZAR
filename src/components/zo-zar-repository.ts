import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

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
/**
 * The label a plan carries when nobody will be told, and the only way to test for it.
 *
 * Screens used to compare `protectedBy` against this literal string. Rewording the
 * label would then have made the ringing screen claim someone would be told when nobody
 * would — a false protection claim on the one screen that must never make one.
 */
export const UNPROTECTED_LABEL = 'No trusted person yet';

export function isProtected(plan: { protectedBy: string }): boolean {
  return plan.protectedBy !== UNPROTECTED_LABEL;
}

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
  return { id: row.$id ?? row.id, title: row.title, detail: row.description ?? '', dateLabel: date.toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt), startsAt, done: row.status === 'completed' };
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
    protectedBy: (row.connectionId ?? row.circle_id) ? 'Your trusted person' : UNPROTECTED_LABEL,
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
    protectedBy: input.circleId ? 'Your trusted circle' : UNPROTECTED_LABEL,
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

/**
 * How long a local session survives without the app being used.
 *
 * Mirrors the server's REFRESH_TOKEN_TTL_DAYS (server/src/auth/tokens.ts): the window slides
 * forward every time the app is opened, brought to the foreground, or changes anything, so
 * a person who uses the app at least once every 60 days is never signed out.
 */
export const LOCAL_SESSION_INACTIVITY_DAYS = 60;
const LOCAL_SESSION_INACTIVITY_MS = LOCAL_SESSION_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

const LOCAL_STATE_VERSION = 1;
const LOCAL_STATE_FILE = 'zo-zar-local-state.json';
const LOCAL_STATE_TEMP_FILE = 'zo-zar-local-state.json.tmp';
const LOCAL_STATE_WEB_KEY = 'zo-zar.local-state';
const LOCAL_USER_ID = 'local-user';

type LocalAccountData = {
  displayName?: string;
  profilePhotoUri?: string;
  commitments: RepositoryCommitment[];
  wakePlans: RepositoryWakePlan[];
  wakeOccurrences: RepositoryWakeOccurrence[];
  members: RepositoryCircleMember[];
  messages: RepositoryChatMessage[];
  chatRetention: ChatRetention;
};

/**
 * The whole local fallback as one JSON document.
 *
 * Data is kept per local account (keyed by the normalised email) and survives both
 * sign-out and the 60-day inactivity expiry: only `session` is cleared, so signing back in
 * with the same email restores that person's alarms, commitments, people and messages, and
 * a different email on the same device starts with an empty account instead of seeing them.
 */
type LocalPersistedState = {
  version: typeof LOCAL_STATE_VERSION;
  session: { userId: string; email?: string } | null;
  accountKey: string | null;
  lastActiveAt: number | null;
  accounts: Record<string, LocalAccountData>;
};

type WebStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

function webStorage(): WebStorage | null {
  try {
    return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function emptyAccount(): LocalAccountData {
  return { commitments: [], wakePlans: [], wakeOccurrences: [], members: [], messages: [], chatRetention: '30d' };
}

function emptyState(): LocalPersistedState {
  return { version: LOCAL_STATE_VERSION, session: null, accountKey: null, lastActiveAt: null, accounts: {} };
}

function accountKeyFor(email: string | undefined) {
  return email?.trim().toLowerCase() || 'local';
}

function arrayOr<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function sanitizeAccount(value: unknown): LocalAccountData {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    profilePhotoUri: typeof raw.profilePhotoUri === 'string' ? raw.profilePhotoUri : undefined,
    commitments: arrayOr(raw.commitments),
    wakePlans: arrayOr(raw.wakePlans),
    wakeOccurrences: arrayOr(raw.wakeOccurrences),
    members: arrayOr(raw.members),
    messages: arrayOr(raw.messages),
    chatRetention: raw.chatRetention === '7d' ? '7d' : '30d',
  };
}

/** Parses a stored document, or returns null when it is missing, unreadable or from an unknown version. */
function parseState(text: string | null | undefined): LocalPersistedState | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || raw.version !== LOCAL_STATE_VERSION) return null;
    const accounts: Record<string, LocalAccountData> = {};
    if (raw.accounts && typeof raw.accounts === 'object') {
      for (const [key, value] of Object.entries(raw.accounts as Record<string, unknown>)) accounts[key] = sanitizeAccount(value);
    }
    const session = raw.session && typeof raw.session === 'object' ? raw.session as Record<string, unknown> : null;
    return {
      version: LOCAL_STATE_VERSION,
      session: session ? { userId: typeof session.userId === 'string' ? session.userId : LOCAL_USER_ID, email: typeof session.email === 'string' ? session.email : undefined } : null,
      accountKey: typeof raw.accountKey === 'string' ? raw.accountKey : null,
      lastActiveAt: typeof raw.lastActiveAt === 'number' && Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : null,
      accounts,
    };
  } catch {
    return null;
  }
}

async function readNativeFile(name: string) {
  try {
    const file = new File(Paths.document, name);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

async function loadPersistedState(): Promise<LocalPersistedState> {
  if (Platform.OS === 'web') {
    try {
      return parseState(webStorage()?.getItem(LOCAL_STATE_WEB_KEY)) ?? emptyState();
    } catch {
      return emptyState();
    }
  }
  // The temp file only matters if a crash landed between writing it and moving it over
  // the real one; it is then the newest complete copy.
  return parseState(await readNativeFile(LOCAL_STATE_FILE))
    ?? parseState(await readNativeFile(LOCAL_STATE_TEMP_FILE))
    ?? emptyState();
}

/**
 * Writes the document synchronously, so two mutations can never interleave on the JS thread
 * and a method's promise only resolves once its change is on disk. On native the JSON goes
 * to a temp file first and is then moved over the real one, so a crash mid-write leaves the
 * previous complete document (or the complete temp file) rather than a truncated one.
 */
function savePersistedState(state: LocalPersistedState) {
  const json = JSON.stringify(state);
  try {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(LOCAL_STATE_WEB_KEY, json);
      return;
    }
    const temp = new File(Paths.document, LOCAL_STATE_TEMP_FILE);
    if (!temp.exists) temp.create();
    temp.write(json);
    temp.moveSync(new File(Paths.document, LOCAL_STATE_FILE), { overwrite: true });
  } catch (caught) {
    // The change is still applied in memory for this run; failing the user's action
    // because the disk refused would be worse than losing it on the next restart.
    console.warn('ZO-ZAR could not save local data.', caught);
  }
}

function localRepository(): ZOZARRepository {
  let commitments: RepositoryCommitment[] = [];
  let wakePlans: RepositoryWakePlan[] = [];
  let wakeOccurrences: RepositoryWakeOccurrence[] = [];
  let members: RepositoryCircleMember[] = [];
  let messages: RepositoryChatMessage[] = [];
  let chatRetention: ChatRetention = '30d';
  let displayName: string | undefined;
  let profilePhotoUri: string | undefined;

  let persisted: LocalPersistedState = emptyState();

  function loadAccount(data: LocalAccountData) {
    commitments = data.commitments;
    wakePlans = data.wakePlans;
    wakeOccurrences = data.wakeOccurrences;
    members = data.members;
    messages = data.messages;
    chatRetention = data.chatRetention;
    displayName = data.displayName;
    profilePhotoUri = data.profilePhotoUri;
  }

  function currentAccount(): LocalAccountData {
    return { displayName, profilePhotoUri, commitments, wakePlans, wakeOccurrences, members, messages, chatRetention };
  }

  /** Folds the in-memory account back into the document and writes it. */
  function persist() {
    if (persisted.accountKey) persisted = { ...persisted, accounts: { ...persisted.accounts, [persisted.accountKey]: currentAccount() } };
    savePersistedState(persisted);
  }

  /** Records activity and saves. Called after every successful write. */
  function commit() {
    if (!persisted.session) return;
    persisted = { ...persisted, lastActiveAt: Date.now() };
    persist();
  }

  function isExpired(lastActiveAt: number | null, now: number) {
    // A missing timestamp cannot prove recent use. A timestamp in the future means the
    // clock moved backwards; that is not inactivity, so it is treated as current.
    if (lastActiveAt === null) return true;
    return now - lastActiveAt >= LOCAL_SESSION_INACTIVITY_MS;
  }

  function startSession(email: string, name?: string) {
    if (persisted.accountKey) persist();
    const key = accountKeyFor(email);
    loadAccount(persisted.accounts[key] ?? emptyAccount());
    if (name?.trim()) displayName = name.trim();
    persisted = { ...persisted, session: { userId: LOCAL_USER_ID, email }, accountKey: key, lastActiveAt: Date.now() };
    persist();
    return sessionResult();
  }

  /** Ends the session but keeps the account's data in the document for the next sign-in. */
  function endSession() {
    if (persisted.accountKey) persist();
    loadAccount(emptyAccount());
    persisted = { ...persisted, session: null, accountKey: null };
    savePersistedState(persisted);
  }

  function sessionResult(): RepositorySession {
    const session = persisted.session ?? { userId: LOCAL_USER_ID };
    return { ...session, ...(displayName ? { displayName } : {}), ...(profilePhotoUri ? { profilePhotoUri } : {}) };
  }

  const ready: Promise<void> = loadPersistedState().then((state) => {
    persisted = state;
    if (state.session) {
      const key = state.accountKey ?? accountKeyFor(state.session.email);
      persisted = { ...persisted, accountKey: key };
      loadAccount(state.accounts[key] ?? emptyAccount());
    } else {
      persisted = { ...persisted, accountKey: null };
    }
  }).catch(() => {
    persisted = emptyState();
  });

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
      ...(input.circleId === undefined ? {} : { circleId: input.circleId, protectedBy: input.circleId ? 'Your trusted circle' : UNPROTECTED_LABEL }),
      ...(input.scheduleType === undefined ? {} : { scheduleType: input.scheduleType, repeatLabel: input.scheduleType === 'once' ? 'One time' : input.scheduleType === 'daily' ? 'Every day' : 'Selected weekdays' }),
      ...(input.scheduledDate === undefined ? {} : { scheduledDate: input.scheduledDate }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.weekdays === undefined ? {} : { weekdays: input.weekdays }),
      ...(input.graceMinutes === undefined ? {} : { graceMinutes: input.graceMinutes }),
    };
    // Compute the next occurrence before touching state, so an unschedulable plan (a
    // one-time alarm in the past) leaves both lists exactly as they were.
    if (next.status === 'Active') nextOccurrenceForValues(next.scheduleType, next.scheduledDate, next.time, next.weekdays);
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

  /** Waits for hydration before reading. */
  function read<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
    return async (...args) => { await ready; return fn(...args); };
  }

  /** Waits for hydration, applies the change, then records activity and saves it. */
  function write<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => Promise<R> {
    return async (...args) => {
      await ready;
      const result = fn(...args);
      commit();
      return result;
    };
  }

  return {
    mode: 'LOCAL_FALLBACK',
    signUp: read((name: string, email: string) => ({ session: startSession(email, name), requiresEmailConfirmation: false })),
    signIn: read((email: string) => startSession(email)),
    restoreSession: read(() => {
      if (!persisted.session) return null;
      const now = Date.now();
      if (isExpired(persisted.lastActiveAt, now)) {
        // Inactive for 60 days: the session ends, the account's data stays on the device.
        endSession();
        return null;
      }
      // Opening the app is activity, so restoring slides the window forward.
      persisted = { ...persisted, lastActiveAt: now };
      persist();
      return sessionResult();
    }),
    signOut: read(() => { endSession(); }),
    updateProfilePhoto: write((uri: string) => { profilePhotoUri = uri; return uri; }),
    listCommitments: read(() => commitments),
    createCommitment: write((title: string, time: string) => {
      const startsAt = commitmentDate(time).toISOString();
      if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
      const item = { id: `local-${Date.now()}`, title, detail: '', dateLabel: new Date(startsAt).toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt), startsAt, done: false };
      commitments = [...commitments, item];
      return item;
    }),
    updateCommitment: write((id: string, title: string, startsAt: string) => {
      const current = commitments.find((item) => item.id === id);
      if (!current) throw new Error('Commitment was not found.');
      if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
      const next = { ...current, title: title.trim(), startsAt, dateLabel: new Date(startsAt).toLocaleDateString([], { weekday: 'long' }), time: displayTime(startsAt) };
      commitments = commitments.map((item) => item.id === id ? next : item);
      return next;
    }),
    deleteCommitment: write((id: string) => { commitments = commitments.filter((item) => item.id !== id); }),
    setCommitmentComplete: write((id: string, complete: boolean) => { commitments = commitments.map((item) => item.id === id ? { ...item, done: complete } : item); }),
    getWakePlan: read(() => withOccurrence(wakePlans[0])),
    listWakePlans: read(() => wakePlans.map((plan) => withOccurrence(plan) as RepositoryWakePlan)),
    createWakePlan: write((input: RepositoryWakePlanInput) => createLocalPlan(input)),
    updateWakePlan: write((id: string, input: Partial<RepositoryWakePlanInput>) => updateLocalPlan(id, input)),
    deleteWakePlan: write((id: string) => {
      if (!wakePlans.some((item) => item.id === id)) throw new Error('Wake plan was not found.');
      wakePlans = wakePlans.filter((item) => item.id !== id);
      wakeOccurrences = wakeOccurrences.filter((item) => item.wakePlanId !== id);
    }),
    listWakeOccurrences: read((wakePlanId?: string) => wakeOccurrences.filter((item) => !wakePlanId || item.wakePlanId === wakePlanId)),
    getWakeOccurrence: read((occurrenceId: string) => wakeOccurrences.find((item) => item.id === occurrenceId) ?? null),
    setWakePlanActive: write((id: string, active: boolean) => updateLocalPlan(id, { active })),
    setWakeDifficulty: write((id: string, difficulty: UiDifficulty) => { updateLocalPlan(id, { difficulty }); }),
    saveWakePlan: write((input: RepositoryWakePlanInput) => input.id ? updateLocalPlan(input.id, input) : createLocalPlan(input)),
    confirmWake: write((occurrenceId: string) => { if (!wakeOccurrences.some((item) => item.id === occurrenceId)) throw new Error('No active wake occurrence is available to confirm.'); wakeOccurrences = wakeOccurrences.map((item) => item.id === occurrenceId ? { ...item, status: 'confirmed' } : item); }),
    recordWakeSnooze: async () => undefined,
    listCircleMembers: read(() => members),
    inviteCircleMember: write((email: string) => { const name = email.split('@')[0]; members = [...members, { id: `local-member-${Date.now()}`, name, initials: initials(name), detail: 'Invited, waiting for them', status: 'Pending', relationship: 'outgoing' }]; }),
    respondToCircleInvitation: write((id: string, accept: boolean) => {
      if (!members.some((member) => member.id === id)) throw new Error('Invitation was not found.');
      members = accept
        ? members.map((member) => member.id === id ? { ...member, status: 'Accepted', detail: 'Accepted' } : member)
        : members.filter((member) => member.id !== id);
    }),
    removeCircleMember: write((id: string) => { members = members.filter((member) => member.id !== id); }),
    listMessages: read(() => messages),
    getChatRetention: read(() => chatRetention),
    setChatRetention: write((_threadId: string, retention: ChatRetention) => {
      chatRetention = retention;
      messages = [...messages, { id: `local-system-${Date.now()}`, body: `Messages now disappear after ${retention === '7d' ? '1 week' : '1 month'}.`, timestamp: 'Now', author: 'me', kind: 'system' }];
    }),
    subscribeMessages: async () => () => undefined,
    sendMessage: write((_threadId: string, body: string) => { const message = { id: `local-message-${Date.now()}`, body, timestamp: 'Now', author: 'me' as const }; messages = [...messages, message]; return message; }),
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
 * not a second backend: it keeps everything on this device so the app works without a
 * server, and it is what runs when EXPO_PUBLIC_API_URL is unset. Its state is saved as one
 * JSON document (expo-file-system on Android, localStorage on web) and restored on launch;
 * the session ends only after LOCAL_SESSION_INACTIVITY_DAYS without use, or on sign-out.
 */
export function createZOZARRepository(): ZOZARRepository {
  return isApiConfigured() ? createRestRepository() : localRepository();
}
