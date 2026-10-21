import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { acknowledgePendingEvent, getPendingEvents } from '../../modules/zo-zar-exact-alarm';

import {
  cancelCommitmentReminder,
  cancelWakeNotification,
  completeWakeAlarm,
  getScheduledWakePlanIds,
  scheduleCommitmentReminder,
  scheduleWakeNotifications,
  scheduleWakeSoundTest,
} from '@/services/notification-service';
import { registerForPushNotifications } from '@/services/push-token-service';
import { hasCompletedPermissionSetup, markPermissionSetupComplete } from '@/services/setup-state';
import type { VoiceNoteArtifact } from '@/services/voice-recorder-service';

import {
  createZOZARRepository,
  type RepositoryAuthResult,
  type ChatRetention,
  type RepositoryChatMessage,
  type RepositoryCircleMember,
  type RepositoryCommitment,
  type RepositorySession,
  type RepositoryWakeOccurrence,
  type RepositoryWakePlan,
  type RepositoryWakePlanInput,
  type UiDifficulty,
  type ZOZARRepository,
  isServerBacked,
} from './zo-zar-repository';

export type Difficulty = UiDifficulty;
export type WakeStatus = RepositoryWakePlan['status'];
export type Commitment = RepositoryCommitment;
export type WakePlan = RepositoryWakePlan;
export type CircleMember = RepositoryCircleMember;
export type ChatMessage = RepositoryChatMessage;
export type DeviceScheduleStatus = 'scheduled' | 'not-scheduled' | 'error';
export type DeviceScheduleState = { status: DeviceScheduleStatus; error?: string };

type WakeChallenge = { plan: WakePlan; occurrence: RepositoryWakeOccurrence };

type AppStore = {
  repository: ZOZARRepository;
  integrationMode: ZOZARRepository['mode'];
  session: RepositorySession | null;
  sessionHydrated: boolean;
  setupHydrated: boolean;
  permissionsSetupComplete: boolean;
  userName: string;
  profilePhotoUri?: string;
  commitments: Commitment[];
  wakePlans: WakePlan[];
  wakeOccurrences: RepositoryWakeOccurrence[];
  deviceSchedule: Record<string, DeviceScheduleState>;
  members: CircleMember[];
  messages: ChatMessage[];
  chatRetention: ChatRetention;
  hydrationError: string | null;
  isHydrating: boolean;
  permissionsReady: boolean;
  setPermissionsReady: (ready: boolean) => void;
  completePermissionSetup: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<RepositoryAuthResult>;
  signOut: () => Promise<void>;
  updateProfilePhoto: (uri: string) => Promise<void>;
  toggleCommitment: (id: string) => Promise<void>;
  addCommitment: (title: string, time: string, startsAt?: Date) => Promise<void>;
  updateCommitment: (id: string, title: string, startsAt: Date) => Promise<void>;
  deleteCommitment: (id: string) => Promise<void>;
  addMember: (email: string) => Promise<void>;
  respondToInvitation: (id: string, accept: boolean) => Promise<void>;
  removeMember: (id: string) => Promise<void>;
  loadMessages: (threadOrMemberId: string) => Promise<void>;
  subscribeMessages: (threadOrMemberId: string, onChange: () => void) => Promise<() => void>;
  setChatRetention: (threadOrMemberId: string, retention: ChatRetention) => Promise<void>;
  addMessage: (threadOrMemberId: string, body: string) => Promise<void>;
  addVoiceMessage: (threadOrMemberId: string, artifact: VoiceNoteArtifact) => Promise<void>;
  confirmWake: (occurrenceId: string) => Promise<void>;
  getWakeChallenge: (occurrenceId: string) => Promise<WakeChallenge | null>;
  createWakePlan: (input: RepositoryWakePlanInput) => Promise<WakePlan>;
  updateWakePlan: (id: string, input: Partial<RepositoryWakePlanInput>) => Promise<WakePlan>;
  saveWakePlan: (input: RepositoryWakePlanInput) => Promise<WakePlan>;
  toggleWakePlan: (id: string) => Promise<void>;
  deleteWakePlan: (id: string) => Promise<void>;
  testWakeAlarm: (id: string) => Promise<void>;
  refreshDeviceSchedule: () => Promise<void>;
  setDifficulty: (id: string, difficulty: Difficulty) => Promise<void>;
  retryHydration: () => Promise<void>;
};

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : 'We could not load your ZO-ZAR data. Please try again.';
}

function titleCase(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1).toLocaleLowerCase()).join(' ');
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

function nextLocalDate(plan: WakePlan) {
  const { hour, minute } = parseClock(plan.time);
  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  if (plan.scheduleType === 'once') {
    if (!plan.scheduledDate) throw new Error('Choose a date for this one-time alarm.');
    const [year, month, day] = plan.scheduledDate.split('-').map(Number);
    candidate.setFullYear(year, month - 1, day);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) throw new Error('Choose a future date and time for this one-time alarm.');
    return candidate;
  }
  candidate.setHours(hour, minute, 0, 0);
  if (plan.scheduleType === 'daily') {
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }
  const selected = new Set(plan.weekdays);
  for (let offset = 0; offset <= 7; offset += 1) {
    const next = new Date(candidate);
    next.setDate(candidate.getDate() + offset);
    if (selected.has(next.getDay()) && next.getTime() > now.getTime()) return next;
  }
  throw new Error('Choose at least one weekday for this alarm.');
}

function notificationInput(plan: WakePlan) {
  const { hour, minute } = parseClock(plan.time);
  if (plan.scheduleType === 'once') {
    return { id: plan.id, wakeId: plan.id, occurrenceId: plan.occurrenceId, difficulty: plan.difficulty, soundKey: plan.soundKey, fireAt: nextLocalDate(plan), recurrence: { type: 'once' as const }, title: 'Wake up, ZO-ZAR', body: 'Complete your wake task to confirm you are awake.' };
  }
  if (plan.scheduleType === 'daily') {
    return { id: plan.id, wakeId: plan.id, occurrenceId: plan.occurrenceId, difficulty: plan.difficulty, soundKey: plan.soundKey, recurrence: { type: 'daily' as const, hour, minute }, title: 'Wake up, ZO-ZAR', body: 'Complete your wake task to confirm you are awake.' };
  }
  return { id: plan.id, wakeId: plan.id, occurrenceId: plan.occurrenceId, difficulty: plan.difficulty, soundKey: plan.soundKey, recurrence: { type: 'weekly' as const, weekdays: plan.weekdays, hour, minute }, title: 'Wake up, ZO-ZAR', body: 'Complete your wake task to confirm you are awake.' };
}

function mergeWakeData(plans: WakePlan[], occurrences: RepositoryWakeOccurrence[]) {
  return plans.map((plan) => {
    const occurrence = occurrences.find((item) => item.wakePlanId === plan.id && ['scheduled', 'ringing'].includes(item.status));
    return { ...plan, occurrenceId: occurrence?.id ?? null, occurrenceScheduledFor: occurrence?.scheduledFor ?? null };
  });
}

export function ZOZARStoreProvider({ children }: PropsWithChildren) {
  const repository = useMemo(createZOZARRepository, []);
  const [session, setSession] = useState<RepositorySession | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [setupHydrated, setSetupHydrated] = useState(false);
  const [permissionsSetupComplete, setPermissionsSetupComplete] = useState(false);
  const [userName, setUserName] = useState('Abuzar');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | undefined>();
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [wakePlans, setWakePlans] = useState<WakePlan[]>([]);
  const [wakeOccurrences, setWakeOccurrences] = useState<RepositoryWakeOccurrence[]>([]);
  const [deviceSchedule, setDeviceSchedule] = useState<Record<string, DeviceScheduleState>>({});
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatRetention, setChatRetentionState] = useState<ChatRetention>('30d');
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);

  async function loadWakePlans() {
    const [plans, occurrences] = await Promise.all([repository.listWakePlans(), repository.listWakeOccurrences()]);
    setWakeOccurrences(occurrences);
    const merged = mergeWakeData(plans, occurrences);
    setWakePlans(merged);
    return merged;
  }

  async function hydrate() {
    setIsHydrating(true);
    setHydrationError(null);
    setCommitments([]);
    setWakePlans([]);
    setWakeOccurrences([]);
    setMembers([]);
    setMessages([]);
    try {
      const [nextCommitments, nextPlans, nextMembers, nextOccurrences] = await Promise.all([
        repository.listCommitments(),
        repository.listWakePlans(),
        repository.listCircleMembers(),
        repository.listWakeOccurrences(),
      ]);
      await Promise.all(nextCommitments
        .filter((item) => !item.done && new Date(item.startsAt).getTime() > Date.now())
        .map((item) => scheduleCommitmentReminder(item.id, new Date(item.startsAt), item.title).catch(() => undefined)));
      setCommitments(nextCommitments);
      setWakeOccurrences(nextOccurrences);
      setWakePlans(mergeWakeData(nextPlans, nextOccurrences));
      setMembers(nextMembers);
      setMessages([]);
    } catch (caught) {
      setHydrationError(errorMessage(caught));
      throw caught;
    } finally {
      setIsHydrating(false);
    }
  }

  function registerPushToken() {
    // Nothing to register against without a server.
    if (!isServerBacked(repository.mode)) return;
    void registerForPushNotifications({ persist: (registration) => repository.upsertDeviceToken(registration) }).catch(() => undefined);
  }

  async function schedulePlan(plan: WakePlan) {
    try {
      await scheduleWakeNotifications(notificationInput(plan));
      setDeviceSchedule((current) => ({ ...current, [plan.id]: { status: 'scheduled' } }));
    } catch (caught) {
      const message = errorMessage(caught);
      setDeviceSchedule((current) => ({ ...current, [plan.id]: { status: 'error', error: message } }));
      throw new Error(`The alarm was saved, but it is not scheduled on this device: ${message}`);
    }
  }

  useEffect(() => { if (session) void hydrate().catch(() => undefined); }, [session]);
  useEffect(() => {
    if (!session || Platform.OS !== 'android') return undefined;
    const synchronize = async () => {
      const events = await getPendingEvents().catch(() => []);
      for (const event of events) {
        try {
          if (event.type === 'snoozed') await repository.recordWakeSnooze(event.occurrenceId);
          else if (event.type === 'completed') await repository.confirmWake(event.occurrenceId);
          await acknowledgePendingEvent(event.eventId);
        } catch {
          // Keep the event queued. It will retry when connectivity returns.
        }
      }
    };
    void synchronize();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void synchronize(); });
    return () => subscription.remove();
  }, [repository, session]);
  useEffect(() => {
    void hasCompletedPermissionSetup()
      .then((complete) => setPermissionsSetupComplete(complete))
      .finally(() => setSetupHydrated(true));
  }, []);
  useEffect(() => {
    repository.restoreSession()
      .then((next) => {
        if (next) {
          setSession(next);
          setUserName(titleCase(next.displayName || next.email?.split('@')[0] || 'Abuzar'));
          setProfilePhotoUri(next.profilePhotoUri);
          registerPushToken();
        }
      })
      .catch((caught) => setHydrationError(errorMessage(caught)))
      .finally(() => setSessionHydrated(true));
  }, [repository]);

  const value = useMemo<AppStore>(() => ({
    repository,
    integrationMode: repository.mode,
    session,
    sessionHydrated,
    setupHydrated,
    permissionsSetupComplete,
    userName,
    profilePhotoUri,
    commitments,
    wakePlans,
    wakeOccurrences,
    deviceSchedule,
    members,
    messages,
    chatRetention,
    hydrationError,
    isHydrating,
    permissionsReady,
    setPermissionsReady,
    completePermissionSetup: async () => {
      await markPermissionSetupComplete();
      setPermissionsSetupComplete(true);
      setPermissionsReady(true);
    },
    signIn: async (email, password) => { const next = await repository.signIn(email, password); setHydrationError(null); setSession(next); setUserName(titleCase(next.displayName || email.trim().split('@')[0] || 'Abuzar')); setProfilePhotoUri(next.profilePhotoUri); registerPushToken(); },
    signUp: async (name, email, password) => { const result = await repository.signUp(name, email, password); if (result.session) { setHydrationError(null); setSession(result.session); setUserName(titleCase(result.session.displayName || name.trim() || email.trim().split('@')[0] || 'Abuzar')); setProfilePhotoUri(result.session.profilePhotoUri); registerPushToken(); } return result; },
    signOut: async () => { await repository.signOut(); setSession(null); setCommitments([]); setWakePlans([]); setWakeOccurrences([]); setDeviceSchedule({}); setMembers([]); setMessages([]); setHydrationError(null); },
    updateProfilePhoto: async (uri) => { setProfilePhotoUri(await repository.updateProfilePhoto(uri)); },
    toggleCommitment: async (id) => {
      const current = commitments.find((item) => item.id === id);
      if (!current) return;
      const next = !current.done;
      await repository.setCommitmentComplete(id, next);
      if (next) await cancelCommitmentReminder(id);
      else if (new Date(current.startsAt).getTime() > Date.now()) await scheduleCommitmentReminder(id, new Date(current.startsAt), current.title);
      setCommitments((items) => items.map((item) => item.id === id ? { ...item, done: next } : item));
    },
    addCommitment: async (title, time, startsAt) => {
      const item = await repository.createCommitment(title, startsAt?.toISOString() ?? time);
      setCommitments((items) => [...items, item]);
      try {
        await scheduleCommitmentReminder(item.id, new Date(item.startsAt), item.title);
      } catch (caught) {
        setHydrationError(caught instanceof Error ? caught.message : 'The commitment was saved, but its reminder could not be scheduled.');
      }
    },
    updateCommitment: async (id, title, startsAt) => {
      await cancelCommitmentReminder(id);
      const item = await repository.updateCommitment(id, title, startsAt.toISOString());
      setCommitments((items) => items.map((current) => current.id === id ? item : current).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
      if (!item.done) await scheduleCommitmentReminder(item.id, new Date(item.startsAt), item.title);
    },
    deleteCommitment: async (id) => {
      await cancelCommitmentReminder(id);
      await repository.deleteCommitment(id);
      setCommitments((items) => items.filter((item) => item.id !== id));
    },
    addMember: async (email) => { await repository.inviteCircleMember(email); setMembers(await repository.listCircleMembers()); },
    respondToInvitation: async (id, accept) => { await repository.respondToCircleInvitation(id, accept); setMembers(await repository.listCircleMembers()); },
    removeMember: async (id) => { await repository.removeCircleMember(id); setMembers(await repository.listCircleMembers()); },
    loadMessages: async (threadOrMemberId) => { const [nextMessages, retention] = await Promise.all([repository.listMessages(threadOrMemberId), repository.getChatRetention(threadOrMemberId)]); setMessages(nextMessages); setChatRetentionState(retention); },
    subscribeMessages: (threadOrMemberId, onChange) => repository.subscribeMessages(threadOrMemberId, onChange),
    setChatRetention: async (threadOrMemberId, retention) => { await repository.setChatRetention(threadOrMemberId, retention); setChatRetentionState(retention); setMessages(await repository.listMessages(threadOrMemberId)); },
    addMessage: async (threadOrMemberId, body) => { const message = await repository.sendMessage(threadOrMemberId, body); if (message) setMessages((items) => [...items, message]); },
    addVoiceMessage: async (threadOrMemberId, artifact) => { await repository.sendVoiceNote(threadOrMemberId, artifact); if (isServerBacked(repository.mode)) setMessages(await repository.listMessages(threadOrMemberId)); else setMessages((items) => [...items, { id: `local-voice-${Date.now()}`, body: `Voice note, 0:${String(artifact.durationSeconds).padStart(2, '0')}`, timestamp: 'Now', author: 'me', kind: 'voice' }]); },
    confirmWake: async (occurrenceId) => {
      const occurrence = wakeOccurrences.find((item) => item.id === occurrenceId) ?? await repository.getWakeOccurrence(occurrenceId);
      await repository.confirmWake(occurrenceId);
      if (occurrence) await completeWakeAlarm(occurrence.wakePlanId);
      setWakeOccurrences((items) => items.map((item) => item.id === occurrenceId ? { ...item, status: 'confirmed' } : item));
      setWakePlans((plans) => plans.map((plan) => plan.occurrenceId === occurrenceId ? { ...plan, occurrenceId: null, occurrenceScheduledFor: null } : plan));
    },
    getWakeChallenge: async (occurrenceId) => {
      const occurrence = wakeOccurrences.find((item) => item.id === occurrenceId) ?? await repository.getWakeOccurrence(occurrenceId);
      if (!occurrence) return null;
      let plan = wakePlans.find((item) => item.id === occurrence.wakePlanId);
      if (!plan) {
        const plans = await repository.listWakePlans();
        plan = plans.find((item) => item.id === occurrence.wakePlanId);
        if (plan) setWakePlans((current) => current.some((item) => item.id === plan?.id) ? current : [...current, plan as WakePlan]);
      }
      return plan ? { plan, occurrence } : null;
    },
    createWakePlan: async (input) => {
      const next = await repository.createWakePlan({ ...input, active: false });
      await loadWakePlans();
      setDeviceSchedule((current) => ({ ...current, [next.id]: { status: 'not-scheduled' } }));
      return next;
    },
    updateWakePlan: async (id, input) => {
      const current = wakePlans.find((plan) => plan.id === id);
      const active = Boolean(current?.status === 'Active' && input.active !== false);
      if (active) await cancelWakeNotification(id);
      const next = await repository.updateWakePlan(id, { ...input, active });
      const merged = await loadWakePlans();
      const updated = merged.find((plan) => plan.id === id) ?? next;
      if (active) await schedulePlan(updated); else setDeviceSchedule((state) => ({ ...state, [id]: { status: 'not-scheduled' } }));
      return updated;
    },
    saveWakePlan: async (input) => {
      const current = input.id ? wakePlans.find((plan) => plan.id === input.id) : undefined;
      const active = Boolean(current?.status === 'Active' && input.active !== false);
      if (active && current) await cancelWakeNotification(current.id);
      if (!input.id && input.active) throw new Error('New alarms start paused. Activate it after saving and reviewing permissions.');
      if (active && !permissionsReady) throw new Error('Review Android wake permissions before saving changes to an active alarm.');
      const next = await repository.saveWakePlan({ ...input, active: input.id ? active : false });
      const merged = await loadWakePlans();
      const updated = merged.find((plan) => plan.id === next.id) ?? next;
      if (active) await schedulePlan(updated); else setDeviceSchedule((state) => ({ ...state, [updated.id]: { status: 'not-scheduled' } }));
      return updated;
    },
    toggleWakePlan: async (id) => {
      const current = wakePlans.find((plan) => plan.id === id);
      if (!current) throw new Error('Wake plan was not found.');
      const active = current.status !== 'Active';
      if (active && !permissionsReady) throw new Error('Review Android wake permissions before activating this alarm.');
      if (!active) await cancelWakeNotification(id);
      const next = await repository.setWakePlanActive(id, active);
      const merged = await loadWakePlans();
      const updated = merged.find((plan) => plan.id === id) ?? next;
      if (active) await schedulePlan(updated); else setDeviceSchedule((state) => ({ ...state, [id]: { status: 'not-scheduled' } }));
    },
    deleteWakePlan: async (id) => {
      await cancelWakeNotification(id);
      await repository.deleteWakePlan(id);
      setWakePlans((plans) => plans.filter((plan) => plan.id !== id));
      setWakeOccurrences((items) => items.filter((item) => item.wakePlanId !== id));
      setDeviceSchedule((state) => { const next = { ...state }; delete next[id]; return next; });
    },
    testWakeAlarm: async (id) => {
      const plan = wakePlans.find((item) => item.id === id);
      if (!plan) throw new Error('Wake plan was not found.');
      await scheduleWakeSoundTest(id, plan.soundKey);
    },
    refreshDeviceSchedule: async () => {
      const scheduledPlanIds = new Set(await getScheduledWakePlanIds());
      setDeviceSchedule((current) => {
        const next = { ...current };
        wakePlans.forEach((plan) => {
          next[plan.id] = plan.status === 'Active' && scheduledPlanIds.has(plan.id)
            ? { status: 'scheduled' }
            : { status: 'not-scheduled' };
        });
        return next;
      });
    },
    setDifficulty: async (id, difficulty) => { await repository.setWakeDifficulty(id, difficulty); setWakePlans((plans) => plans.map((plan) => plan.id === id ? { ...plan, difficulty } : plan)); },
    retryHydration: hydrate,
  }), [chatRetention, commitments, deviceSchedule, hydrationError, isHydrating, members, messages, permissionsReady, permissionsSetupComplete, profilePhotoUri, repository, session, sessionHydrated, setupHydrated, userName, wakeOccurrences, wakePlans]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

const StoreContext = createContext<AppStore | null>(null);

export function useZOZARStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useZOZARStore must be used inside ZOZARStoreProvider');
  return store;
}
