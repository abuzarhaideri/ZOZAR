// Channel colours below use the palette's amber accent (Colors.dark.accent). Android
// notification channels are immutable once created, so changing a colour only reaches
// devices that have not yet created the channel; bump the channel id to force it.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { WakeSoundKey } from '@/types/domain';
import { cancelAlarm, completeAlarm, getScheduledAlarms, scheduleAlarm } from '../../modules/zo-zar-exact-alarm';

// Channel settings are immutable once created by Android. Bump this when the
// alarm behavior changes so an older user-controlled channel cannot win.
export const WAKE_CHANNEL_ID = 'zo-zar-wake-alarms-v3-zozar';
export const WAKE_DEFAULT_CHANNEL_ID = 'zo-zar-wake-alarms-v3-default';
export const GENERAL_CHANNEL_ID = 'zo-zar-general';
export const TRUSTED_ALERT_CHANNEL_ID = 'zo-zar-trusted-alerts';
export const COMMITMENT_CHANNEL_ID = 'zo-zar-commitments-v1';
export const WAKE_SOUND_FILE = 'zo_zar_alarm.wav';
export const WAKE_DEFAULT_SOUND = 'default';

export function wakeSoundLabel(soundKey: WakeSoundKey): string {
  if (soundKey === 'default') return 'Android default';
  if (soundKey === 'steady-pulse') return 'Steady Pulse';
  if (soundKey === 'summit-siren') return 'Summit Siren';
  return 'Bright Rise';
}

export function wakeChannelId(soundKey: WakeSoundKey = 'zo-zar'): string {
  return soundKey === 'default' ? WAKE_DEFAULT_CHANNEL_ID : WAKE_CHANNEL_ID;
}

function wakeSoundFile(soundKey: WakeSoundKey = 'zo-zar'): string {
  return soundKey === 'default' ? WAKE_DEFAULT_SOUND : WAKE_SOUND_FILE;
}

export type WakeNotificationInput = {
  id: string;
  fireAt?: Date;
  recurrence?:
    | { type: 'once' }
    | { type: 'daily'; hour: number; minute: number }
    | { type: 'weekly'; weekdays: number[]; hour: number; minute: number };
  title?: string;
  body?: string;
  wakeId?: string;
  occurrenceId?: string | null;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  soundKey?: WakeSoundKey;
};

let handlerConfigured = false;

function configureHandler() {
  if (handlerConfigured || Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });
  handlerConfigured = true;
}

export async function configureNotificationChannels(): Promise<void> {
  configureHandler();
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(WAKE_CHANNEL_ID, {
    name: 'Wake alarms (ZO-ZAR sound)',
    description: 'Time-critical alarms created by the user.',
    importance: Notifications.AndroidImportance.MAX,
    sound: WAKE_SOUND_FILE,
    bypassDnd: true,
    enableVibrate: true,
    vibrationPattern: [0, 500, 250, 500, 250, 800],
    enableLights: true,
    lightColor: '#E7BB72',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: false,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      flags: {
        enforceAudibility: true,
        requestHardwareAudioVideoSynchronization: false,
      },
    },
  });

  await Notifications.setNotificationChannelAsync(WAKE_DEFAULT_CHANNEL_ID, {
    name: 'Wake alarms (device sound)',
    description: 'Time-critical alarms created by the user.',
    importance: Notifications.AndroidImportance.MAX,
    sound: WAKE_DEFAULT_SOUND,
    bypassDnd: true,
    enableVibrate: true,
    vibrationPattern: [0, 500, 250, 500, 250, 800],
    enableLights: true,
    lightColor: '#E7BB72',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: false,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      flags: {
        enforceAudibility: true,
        requestHardwareAudioVideoSynchronization: false,
      },
    },
  });

  await Notifications.setNotificationChannelAsync(GENERAL_CHANNEL_ID, {
    name: 'ZO-ZAR updates',
    description: 'Chat, voice messages, and non-critical updates.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    bypassDnd: false,
    enableVibrate: true,
    vibrationPattern: [0, 150],
    enableLights: false,
    lightColor: '#E7BB72',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync(TRUSTED_ALERT_CHANNEL_ID, {
    name: 'ZO-ZAR trusted-person alerts',
    description: 'Missed-wake alerts from a trusted person connection.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    bypassDnd: false,
    enableVibrate: true,
    vibrationPattern: [0, 150, 150, 150],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync(COMMITMENT_CHANNEL_ID, {
    name: 'ZO-ZAR commitments',
    description: 'Reminders for commitments you have planned.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    bypassDnd: false,
    enableVibrate: true,
    vibrationPattern: [0, 150],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });
}

export async function scheduleWakeNotification(input: WakeNotificationInput): Promise<string> {
  const identifiers = await scheduleWakeNotifications(input);
  const identifier = identifiers[0];
  if (!identifier) throw new Error('The wake alarm could not be scheduled.');
  return identifier;
}

/**
 * Schedule one native notification per selected weekday. The returned values
 * are the identifiers generated by Expo, never the wake-plan ID.
 */
export async function scheduleWakeNotifications(input: WakeNotificationInput): Promise<string[]> {
  const recurrence = input.recurrence ?? { type: 'once' as const };
  if (recurrence.type === 'once' && (!input.fireAt || input.fireAt.getTime() <= Date.now())) {
    throw new Error('A one-time wake alarm must be scheduled in the future.');
  }
  if (recurrence.type === 'weekly' && recurrence.weekdays.length === 0) {
    throw new Error('Choose at least one weekday for a recurring wake alarm.');
  }
  if (Platform.OS === 'web') {
    throw new Error('Precise wake alarms are available in the Android preview build.');
  }
  if (Platform.OS === 'android') {
    const wakeId = input.wakeId ?? input.id;
    const now = new Date();
    let fireAt = input.fireAt;
    let hour = fireAt?.getHours() ?? 7;
    let minute = fireAt?.getMinutes() ?? 0;
    if (recurrence.type !== 'once') {
      hour = recurrence.hour;
      minute = recurrence.minute;
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      if (recurrence.type === 'daily') {
        if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
      } else {
        const selected = new Set(recurrence.weekdays);
        let found: Date | null = null;
        for (let offset = 0; offset <= 7; offset += 1) {
          const next = new Date(candidate);
          next.setDate(candidate.getDate() + offset);
          if (selected.has(next.getDay()) && next.getTime() > now.getTime()) { found = next; break; }
        }
        if (!found) throw new Error('No future weekday could be scheduled.');
        fireAt = found;
      }
      if (recurrence.type === 'daily') fireAt = candidate;
    }
    if (!fireAt) throw new Error('The next alarm time could not be calculated.');
    await cancelAlarm(wakeId).catch(() => undefined);
    await scheduleAlarm({
      alarmId: wakeId,
      occurrenceId: input.occurrenceId,
      triggerAtMillis: fireAt.getTime(),
      title: input.title ?? 'ZO-ZAR wake alarm',
      difficulty: input.difficulty ?? 'Medium',
      soundKey: input.soundKey ?? 'bright-rise',
      recurrence: recurrence.type,
      hour,
      minute,
      weekdays: recurrence.type === 'weekly' ? recurrence.weekdays : [],
      snoozeCount: 0,
    });
    return [wakeId];
  }
  await configureNotificationChannels();

  const wakeId = input.wakeId ?? input.id;
  const soundKey = input.soundKey ?? 'zo-zar';
  const channelId = wakeChannelId(soundKey);
  const sound = wakeSoundFile(soundKey);
  await cancelWakeNotification(wakeId);
  const weekdays = recurrence.type === 'weekly' ? recurrence.weekdays : [undefined];

  const identifiers: string[] = [];
  try {
    for (const weekday of weekdays) {
      const trigger =
        recurrence.type === 'daily'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DAILY as const,
              hour: recurrence.hour,
              minute: recurrence.minute,
              channelId,
            }
            : recurrence.type === 'weekly'
            ? {
                type: Notifications.SchedulableTriggerInputTypes.WEEKLY as const,
                // The product/editor stores JavaScript Date weekday values
                // (0 = Sunday ... 6 = Saturday). Expo's native weekly
                // trigger uses Android/Expo values (1 = Sunday ... 7 = Saturday).
                weekday: ((weekday as number) + 1) as number,
                hour: recurrence.hour,
                minute: recurrence.minute,
                channelId,
              }
            : {
                type: Notifications.SchedulableTriggerInputTypes.DATE as const,
                date: input.fireAt as Date,
                channelId,
              };

      identifiers.push(await Notifications.scheduleNotificationAsync({
        content: {
          title: input.title ?? 'Wake up, ZO-ZAR',
          body: input.body ?? 'Complete your wake task to confirm you are awake.',
          sound,
          data: { type: 'wake-alarm', wakeId },
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger,
      }));
    }
    return identifiers;
  } catch (error) {
    await Promise.all(identifiers.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)));
    throw error;
  }
}

/** Cancel every native request belonging to one wake plan. */
export async function cancelWakeNotification(wakeId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') { await cancelAlarm(wakeId); return; }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matching = scheduled.filter((request) =>
    request.content.data?.type === 'wake-alarm' && request.content.data?.wakeId === wakeId
  );
  await Promise.all(matching.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}

export async function completeWakeAlarm(wakeId: string): Promise<void> {
  if (Platform.OS === 'android') { await completeAlarm(wakeId); return; }
  await cancelWakeNotification(wakeId);
}

export async function cancelAllWakeNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.type === 'wake-alarm')
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
  );
}

export async function getScheduledWakeNotifications(): Promise<Notifications.NotificationRequest[]> {
  if (Platform.OS === 'web') return [];
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter((request) => request.content.data?.type === 'wake-alarm');
}

export async function getScheduledWakePlanIds(): Promise<string[]> {
  if (Platform.OS === 'android') return (await getScheduledAlarms()).map((alarm) => alarm.alarmId);
  return (await getScheduledWakeNotifications()).map((request) => String(request.content.data?.wakeId ?? '')).filter(Boolean);
}

export async function scheduleCommitmentReminder(commitmentId: string, fireAt: Date, title: string): Promise<string> {
  if (fireAt.getTime() <= Date.now()) {
    throw new Error('Choose a future time for this commitment.');
  }

  // The web build is a visual/development surface. Keep commitment CRUD
  // testable without claiming that a browser notification was scheduled.
  if (Platform.OS === 'web') return `web-preview-${commitmentId}`;

  await configureNotificationChannels();
  await cancelCommitmentReminder(commitmentId);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Commitment reminder',
      body: title,
      sound: 'default',
      data: { type: 'commitment-reminder', commitmentId },
      priority: Notifications.AndroidNotificationPriority.DEFAULT,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: COMMITMENT_CHANNEL_ID,
    },
  });
}

export async function cancelCommitmentReminder(commitmentId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matching = scheduled.filter((request) =>
    request.content.data?.type === 'commitment-reminder' && request.content.data?.commitmentId === commitmentId,
  );
  await Promise.all(matching.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}

/**
 * Schedule a short, one-time sound check without touching a user's real alarm.
 * The unique test wake id keeps cancellation isolated from saved wake plans.
 */
export async function scheduleWakeSoundTest(planId: string, soundKey: WakeSoundKey = 'zo-zar'): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Alarm sound checks are available in the Android preview build.');
  }
  const testWakeId = `wake-sound-test-${planId}-${Date.now()}`;
  return scheduleWakeNotification({
    id: testWakeId,
    wakeId: testWakeId,
    fireAt: new Date(Date.now() + 10_000),
    recurrence: { type: 'once' },
    title: 'ZO-ZAR alarm test',
    body: 'This is a sound check for your wake alarm. Your saved alarm was not changed.',
    soundKey,
    difficulty: 'Easy',
  });
}
