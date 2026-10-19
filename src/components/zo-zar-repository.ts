import { File } from 'expo-file-system';
import { Channel, ID, Permission, Query, Role, type Models } from 'react-native-appwrite';

import {
  appwrite,
  appwriteConfig,
  appwriteTableIds,
  cacheAppwriteIdentity,
  isAppwriteConfigured,
  isDefinitiveAppwriteAuthFailure,
  readCachedAppwriteIdentity,
} from '@/lib/appwrite-client';
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

export type RepositoryMode = 'REST' | 'APPWRITE' | 'LOCAL_FALLBACK';
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

class AppwriteRepository implements ZOZARRepository {
  readonly mode = 'APPWRITE' as const;
  private session: RepositorySession | null = null;

  async signUp(name: string, email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error('Enter your email address.');
    if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
    const displayName = titleCase(name.trim() || normalized.split('@')[0]);
    const user = await appwrite.account.create({ userId: ID.unique(), email: normalized, password, name: displayName });
    await appwrite.account.createEmailPasswordSession({ email: normalized, password });
    await appwrite.tables.createRow({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteTableIds.profiles,
      rowId: user.$id,
      data: { email: normalized, displayName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, photoFileId: null },
      permissions: ownerPermissions(user.$id),
    });
    const next = { userId: user.$id, email: normalized, displayName };
    this.session = next;
    await cacheAppwriteIdentity(next);
    await this.invokeAction('claim-invitations', {}, `claim:${user.$id}`).catch(() => undefined);
    return { session: next, requiresEmailConfirmation: false };
  }

  async signIn(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error('Enter your email address.');
    if (!password) throw new Error('Enter your password.');
    await appwrite.account.createEmailPasswordSession({ email: normalized, password });
    const user = await appwrite.account.get();
    const profile = await this.getProfile(user.$id).catch(() => null);
    const next = { userId: user.$id, email: user.email, displayName: titleCase(profile?.displayName ?? user.name ?? normalized.split('@')[0]), profilePhotoUri: profile?.photoFileId ? this.fileUrl(profile.photoFileId) : undefined };
    this.session = next;
    await cacheAppwriteIdentity(next);
    await this.invokeAction('claim-invitations', {}, `claim:${user.$id}`).catch(() => undefined);
    return next;
  }

  async restoreSession() {
    const cached = await readCachedAppwriteIdentity();
    try {
      const user = await appwrite.account.get();
      const profile = await this.getProfile(user.$id).catch(() => null);
      const next = { userId: user.$id, email: user.email, displayName: titleCase(profile?.displayName ?? user.name ?? user.email.split('@')[0]), profilePhotoUri: profile?.photoFileId ? this.fileUrl(profile.photoFileId) : undefined };
      this.session = next;
      await cacheAppwriteIdentity(next);
      return next;
    } catch (caught) {
      if (!isDefinitiveAppwriteAuthFailure(caught) && cached) {
        this.session = cached;
        return cached;
      }
      if (isDefinitiveAppwriteAuthFailure(caught)) await cacheAppwriteIdentity(null);
      return null;
    }
  }

  async signOut() {
    try { await appwrite.account.deleteSession({ sessionId: 'current' }); } finally { this.session = null; await cacheAppwriteIdentity(null); }
  }

  async updateProfilePhoto(uri: string) {
    const source = new File(uri);
    const extension = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
    const file = await appwrite.storage.createFile({ bucketId: appwriteConfig.storageBucketId, fileId: ID.unique(), file: { name: `profile-${Date.now()}.${extension}`, type: mimeType, size: source.size ?? 0, uri }, permissions: ownerPermissions(this.requireUser()), folder: 'profiles' });
    try {
      await this.invokeAction('set-profile-photo', { fileId: file.$id }, `profile-photo:${file.$id}`);
      const next = this.fileUrl(file.$id);
      if (this.session) { this.session = { ...this.session, profilePhotoUri: next }; await cacheAppwriteIdentity(this.session); }
      return next;
    } catch (caught) {
      await appwrite.storage.deleteFile({ bucketId: appwriteConfig.storageBucketId, fileId: file.$id }).catch(() => undefined);
      throw caught;
    }
  }

  async listCommitments() {
    const result = await this.list(appwriteTableIds.commitments, [Query.equal('userId', [this.requireUser()]), Query.orderAsc('startsAt')]);
    return result.map(mapCommitment);
  }

  async createCommitment(title: string, time: string) {
    const startsAt = commitmentDate(time).toISOString();
    if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
    const row = await this.createOwnerRow(appwriteTableIds.commitments, { userId: this.requireUser(), title: title.trim(), description: 'Personal · Commitment', startsAt, status: 'planned', completedAt: null });
    return mapCommitment(row);
  }

  async updateCommitment(id: string, title: string, startsAt: string) {
    if (new Date(startsAt).getTime() <= Date.now()) throw new Error('Choose a future date and time for this commitment.');
    const row = await this.update(appwriteTableIds.commitments, id, { title: title.trim(), startsAt });
    return mapCommitment(row);
  }

  async deleteCommitment(id: string) { await this.remove(appwriteTableIds.commitments, id); }

  async setCommitmentComplete(id: string, complete: boolean) { await this.update(appwriteTableIds.commitments, id, { status: complete ? 'completed' : 'planned', completedAt: complete ? new Date().toISOString() : null }); }
  async getWakePlan() { return (await this.listWakePlans())[0] ?? null; }

  async listWakePlans() {
    const rows = await this.list(appwriteTableIds.wakePlans, [Query.equal('userId', [this.requireUser()]), Query.orderDesc('$createdAt')]);
    return rows.map((row) => mapWakePlan(row));
  }

  async createWakePlan(input: RepositoryWakePlanInput) {
    const existing = await this.list(appwriteTableIds.wakePlans, [Query.equal('userId', [this.requireUser()])]);
    if (existing.length >= MAX_WAKE_PLANS) throw new Error('You can save up to three wake plans.');
    const row = await this.createOwnerRow(appwriteTableIds.wakePlans, { userId: this.requireUser(), commitmentId: input.commitmentId ?? null, connectionId: input.circleId ?? null, scheduleType: input.scheduleType, scheduledDate: input.scheduledDate ?? null, localTime: to24HourTime(input.time), timezone: input.timezone, weekdays: input.weekdays ?? [], difficulty: toDomainDifficulty(input.difficulty), soundKey: input.soundKey ?? 'zo-zar', graceMinutes: input.graceMinutes ?? 10, isActive: false });
    const created = mapWakePlan(row);
    return input.active ? this.setWakePlanActive(created.id, true) : created;
  }

  async updateWakePlan(id: string, input: Partial<RepositoryWakePlanInput>) {
    const plan = await this.update(appwriteTableIds.wakePlans, id, {
      ...(input.commitmentId === undefined ? {} : { commitmentId: input.commitmentId }),
      ...(input.circleId === undefined ? {} : { connectionId: input.circleId }),
      ...(input.scheduleType === undefined ? {} : { scheduleType: input.scheduleType }),
      ...(input.scheduledDate === undefined ? {} : { scheduledDate: input.scheduledDate }),
      ...(input.time === undefined ? {} : { localTime: to24HourTime(input.time) }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.weekdays === undefined ? {} : { weekdays: input.weekdays }),
      ...(input.difficulty === undefined ? {} : { difficulty: toDomainDifficulty(input.difficulty) }),
      ...(input.soundKey === undefined ? {} : { soundKey: input.soundKey }),
      ...(input.graceMinutes === undefined ? {} : { graceMinutes: input.graceMinutes }),
      ...(input.active === undefined ? {} : { isActive: input.active }),
    });
    if (plan.isActive && input.active !== false) return this.upsertOccurrence(plan);
    if (!plan.isActive) await this.cancelPlanOccurrences(id);
    return mapWakePlan(plan);
  }

  async deleteWakePlan(id: string) {
    await this.cancelPlanOccurrences(id);
    await this.remove(appwriteTableIds.wakePlans, id);
  }

  async listWakeOccurrences(wakePlanId?: string) {
    const queries = [Query.equal('userId', [this.requireUser()]), Query.orderAsc('scheduledFor')];
    if (wakePlanId) queries.push(Query.equal('wakePlanId', [wakePlanId]));
    const rows = await this.list(appwriteTableIds.wakeOccurrences, queries);
    return rows.map(mapOccurrence);
  }

  async getWakeOccurrence(occurrenceId: string) {
    if (!occurrenceId) return null;
    try { return mapOccurrence(await this.get(appwriteTableIds.wakeOccurrences, occurrenceId)); } catch { return null; }
  }

  async setWakePlanActive(id: string, active: boolean) {
    if (!id) throw new Error('Create a wake plan before activating wake protection.');
    const plan = await this.update(appwriteTableIds.wakePlans, id, { isActive: active });
    if (!active) { await this.cancelPlanOccurrences(id); return mapWakePlan(plan); }
    return this.upsertOccurrence(plan);
  }

  async setWakeDifficulty(id: string, difficulty: UiDifficulty) {
    if (!id) throw new Error('Create a wake plan before choosing a challenge.');
    await this.update(appwriteTableIds.wakePlans, id, { difficulty: toDomainDifficulty(difficulty) });
    const active = await this.list(appwriteTableIds.wakeOccurrences, [Query.equal('wakePlanId', [id]), Query.equal('status', ['scheduled', 'ringing'])]);
    await Promise.all(active.map((row) => this.update(appwriteTableIds.wakeOccurrences, row.$id, { difficulty: toDomainDifficulty(difficulty) })));
  }

  async saveWakePlan(input: RepositoryWakePlanInput) { return input.id ? this.updateWakePlan(input.id, input) : this.createWakePlan(input); }

  async confirmWake(occurrenceId: string) {
    if (!occurrenceId) throw new Error('No wake occurrence is available to confirm.');
    await this.invokeAction('complete-wake', { occurrenceId }, `wake-complete:${occurrenceId}`);
  }

  async recordWakeSnooze(occurrenceId: string) {
    if (!occurrenceId) throw new Error('No wake occurrence is available to snooze.');
    await this.invokeAction('snooze-wake', { occurrenceId }, `wake-snooze:${occurrenceId}`);
  }

  async listCircleMembers() {
    const rows = await this.list(appwriteTableIds.connections, [Query.orderDesc('$createdAt')]);
    const current = this.requireUser();
    return rows
      .filter((row) => row.status === 'accepted' || row.status === 'pending')
      .map((row) => {
        const relationship = row.recipientId === current ? 'incoming' : 'outgoing';
        const name = titleCase(relationship === 'incoming' ? row.requesterDisplayName ?? 'Trusted person' : row.recipientDisplayName ?? row.recipientEmail?.split('@')[0] ?? 'Trusted person');
        return {
          id: row.$id,
          name,
          initials: initials(name),
          detail: row.status === 'accepted'
            ? 'Wake support · Accepted'
            : relationship === 'incoming' ? 'Invitation received · Your choice' : 'Circle invite · Pending',
          status: row.status === 'accepted' ? 'Accepted' : 'Pending',
          relationship,
          circleId: row.$id,
        } as RepositoryCircleMember;
      });
  }

  async inviteCircleMember(email: string) { await this.invokeAction('invite', { email: email.trim().toLowerCase() }, `invite:${email.trim().toLowerCase()}`); }

  async respondToCircleInvitation(id: string, accept: boolean) { await this.invokeAction('respond-invitation', { connectionId: id, accept }, `respond:${id}:${accept}`); }

  async removeCircleMember(id: string) { await this.invokeAction('remove-connection', { connectionId: id }, `remove:${id}`); }

  async listMessages(threadId: string) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) return [];
    const rows = await this.list(appwriteTableIds.messages, [Query.equal('threadId', [resolved]), Query.orderAsc('$createdAt')]);
    return rows.map((row) => this.mapMessage(row, row.voicePath ? appwrite.storage.getFileViewURL(appwriteConfig.storageBucketId, row.voicePath).toString() : undefined));
  }

  async getChatRetention(threadId: string) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) return '30d';
    const thread = await this.get(appwriteTableIds.chatThreads, resolved);
    return thread.retention === '7d' ? '7d' : '30d';
  }

  async setChatRetention(threadId: string, retention: ChatRetention) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) throw new Error('Accept a trusted-person invitation before changing chat settings.');
    await this.invokeAction('set-chat-retention', { threadId: resolved, retention }, `retention:${resolved}:${retention}:${Date.now()}`);
  }

  async subscribeMessages(threadId: string, onChange: () => void) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) return () => undefined;
    const channel = Channel.tablesdb(appwriteConfig.databaseId).table(appwriteTableIds.messages).row();
    const subscription = await appwrite.realtime.subscribe(channel, (event) => {
      const payload = event.payload as Record<string, any>;
      if (payload.threadId === resolved) onChange();
    });
    return () => { void subscription.unsubscribe(); };
  }

  async sendMessage(threadId: string, body: string) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) throw new Error('Accept a trusted-person invitation before starting a chat.');
    const result = await this.invokeAction('send-message', { threadId: resolved, body: body.trim() }, `message:${resolved}:${Date.now()}`);
    return result.message ? this.mapMessage(result.message) : null;
  }

  async sendVoiceNote(threadId: string, artifact: VoiceNoteArtifact) {
    const resolved = await this.resolveThreadId(threadId);
    if (!resolved) throw new Error('Accept a trusted-person invitation before sending a voice note.');
    const source = new File(artifact.uri);
    const file = await appwrite.storage.createFile({ bucketId: appwriteConfig.storageBucketId, fileId: ID.unique(), file: { name: artifact.fileName, type: artifact.mimeType, size: source.size ?? 0, uri: artifact.uri }, permissions: ownerPermissions(this.requireUser()), folder: `voice/${resolved}` });
    try {
      await this.invokeAction('finalize-voice-message', { threadId: resolved, fileId: file.$id, durationSeconds: Math.max(1, artifact.durationSeconds) }, `voice:${file.$id}`);
    } catch (caught) {
      await appwrite.storage.deleteFile({ bucketId: appwriteConfig.storageBucketId, fileId: file.$id }).catch(() => undefined);
      throw caught;
    }
  }

  async upsertDeviceToken(registration: PushTokenRegistration) { await this.invokeAction('upsert-device-token', { token: registration.nativeDeviceToken, platform: registration.platform }, `device:${registration.nativeDeviceToken}`); }
  private mapMessage(row: Record<string, any>, voiceUri?: string): RepositoryChatMessage { return { id: row.$id ?? row.id, body: row.body ?? '', timestamp: displayTime(row.$createdAt ?? row.createdAt ?? row.created_at), author: row.senderId === this.requireUser() || row.sender_id === this.requireUser() ? 'me' : 'them', kind: row.type ?? row.message_type, voiceUri, expiresAt: row.expiresAt }; }
  private async resolveThreadId(routeId: string) {
    try { const direct = await this.get(appwriteTableIds.chatThreads, routeId); if (direct) return direct.$id; } catch {}
    let connection: Record<string, any>;
    try { connection = await this.get(appwriteTableIds.connections, routeId); } catch { return null; }
    const currentUser = this.requireUser();
    const otherUser = connection.requesterId === currentUser ? connection.recipientId : connection.requesterId;
    if (!otherUser || otherUser === currentUser) return null;
    const threads = await this.list(appwriteTableIds.chatThreads, [Query.orderAsc('$createdAt')]);
    return threads.find((thread) =>
      (thread.participantA === currentUser && thread.participantB === otherUser) ||
      (thread.participantB === currentUser && thread.participantA === otherUser)
    )?.$id ?? null;
  }
  private requireUser() { if (!this.session) throw new Error('Sign in is required.'); return this.session.userId; }
  private async cancelPlanOccurrences(id: string) {
    const rows = await this.list(appwriteTableIds.wakeOccurrences, [Query.equal('wakePlanId', [id]), Query.equal('status', ['scheduled', 'ringing'])]);
    await Promise.all(rows.map((row) => this.update(appwriteTableIds.wakeOccurrences, row.$id, { status: 'cancelled' })));
  }
  private async upsertOccurrence(plan: Record<string, any>) {
    await this.cancelPlanOccurrences(plan.$id);
    const scheduledFor = nextOccurrenceForValues(plan.scheduleType, plan.scheduledDate, plan.localTime, plan.weekdays).toISOString();
    const occurrence = await this.createOwnerRow(appwriteTableIds.wakeOccurrences, { wakePlanId: plan.$id, userId: this.requireUser(), commitmentId: plan.commitmentId ?? null, scheduledFor, difficulty: plan.difficulty, graceMinutes: plan.graceMinutes, challengePayload: '{}', status: 'scheduled', triggeredAt: null, confirmedAt: null, escalatedAt: null });
    return mapWakePlan(plan, mapOccurrence(occurrence));
  }
  private async getProfile(userId: string) { return this.get(appwriteTableIds.profiles, userId); }
  private fileUrl(fileId: string) { return appwrite.storage.getFileViewURL(appwriteConfig.storageBucketId, fileId).toString(); }
  private async list(tableId: string, queries: string[] = []) {
    const result = await appwrite.tables.listRows({ databaseId: appwriteConfig.databaseId, tableId, queries, total: false });
    return result.rows as Array<Models.Row & Record<string, any>>;
  }
  private async get(tableId: string, rowId: string) { return appwrite.tables.getRow({ databaseId: appwriteConfig.databaseId, tableId, rowId }) as Promise<Models.Row & Record<string, any>>; }
  private async createOwnerRow(tableId: string, data: Record<string, unknown>) { return appwrite.tables.createRow({ databaseId: appwriteConfig.databaseId, tableId, rowId: ID.unique(), data, permissions: ownerPermissions(this.requireUser()) }) as Promise<Models.Row & Record<string, any>>; }
  private async update(tableId: string, rowId: string, data: Record<string, unknown>) { return appwrite.tables.updateRow({ databaseId: appwriteConfig.databaseId, tableId, rowId, data }) as Promise<Models.Row & Record<string, any>>; }
  private async remove(tableId: string, rowId: string) { await appwrite.tables.deleteRow({ databaseId: appwriteConfig.databaseId, tableId, rowId }); }
  private async invokeAction(action: string, payload: Record<string, unknown>, idempotencyKey: string) {
    const execution = await appwrite.functions.createExecution({ functionId: appwriteConfig.actionsFunctionId, body: JSON.stringify({ action, payload, idempotencyKey }), async: false });
    if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) throw new Error(execution.responseBody || `ZO-ZAR action failed (${execution.responseStatusCode}).`);
    return execution.responseBody ? JSON.parse(execution.responseBody) as Record<string, any> : {};
  }
}

function ownerPermissions(userId: string) {
  return [Permission.read(Role.user(userId)), Permission.update(Role.user(userId)), Permission.delete(Role.user(userId))];
}

function titleCase(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase()).join(' ');
}

export function createZOZARRepository(): ZOZARRepository {
  // The ZO-ZAR API takes precedence wherever it is configured. Appwrite remains only as a
  // fallback while the migration completes and will be removed with it.
  if (isApiConfigured()) return createRestRepository();
  if (isAppwriteConfigured()) return new AppwriteRepository();
  return localRepository();
}
