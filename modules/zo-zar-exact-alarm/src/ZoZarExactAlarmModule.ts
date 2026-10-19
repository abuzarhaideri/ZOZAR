import { requireOptionalNativeModule } from 'expo-modules-core';

export type ExactAlarmStatus = 'granted' | 'not-granted';
export type FullScreenAlarmStatus = 'granted' | 'not-granted' | 'unknown';

export type NativeAlarmPayload = {
  alarmId: string;
  occurrenceId?: string | null;
  triggerAtMillis: number;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  soundKey: 'bright-rise' | 'steady-pulse' | 'summit-siren' | 'default' | 'zo-zar';
  recurrence: 'once' | 'daily' | 'weekly';
  hour: number;
  minute: number;
  weekdays: number[];
  snoozeCount?: number;
};
export type NativeAlarmEvent = { eventId: string; type: 'snoozed' | 'completed'; alarmId: string; occurrenceId: string; createdAtMillis: number };

type ZoZarExactAlarmNativeModule = {
  getStatus: () => Promise<ExactAlarmStatus>;
  getFullScreenAlarmStatus: () => Promise<FullScreenAlarmStatus>;
  scheduleAlarm: (payload: NativeAlarmPayload) => Promise<void>;
  cancelAlarm: (alarmId: string) => Promise<void>;
  snoozeAlarm: (alarmId: string, minutes: number) => Promise<void>;
  completeAlarm: (alarmId: string) => Promise<void>;
  getScheduledAlarms: () => Promise<NativeAlarmPayload[]>;
  getLaunchAlarm: () => Promise<NativeAlarmPayload | null>;
  getPendingEvents: () => Promise<NativeAlarmEvent[]>;
  acknowledgePendingEvent: (eventId: string) => Promise<void>;
};

let nativeModule: ZoZarExactAlarmNativeModule | null = null;
try {
  nativeModule = requireOptionalNativeModule<ZoZarExactAlarmNativeModule>('ZoZarExactAlarm');
} catch {
  // The service maps an unavailable native module to the safe `unknown` status.
}

/**
 * Reads Android's exact-alarm special access status.
 *
 * The caller owns the unavailable/error fallback because this module's native
 * contract only exposes statuses returned by Android itself.
 */
export async function getStatus(): Promise<ExactAlarmStatus> {
  if (!nativeModule) {
    throw new Error('The ZoZarExactAlarm native module is unavailable.');
  }

  const status = await nativeModule.getStatus();
  if (status !== 'granted' && status !== 'not-granted') {
    throw new Error('The ZoZarExactAlarm native module returned an invalid status.');
  }
  return status;
}

function requireModule() {
  if (!nativeModule) throw new Error('The ZoZarExactAlarm native module is unavailable. Install a fresh custom Android build.');
  return nativeModule;
}

export const getFullScreenAlarmStatus = () => requireModule().getFullScreenAlarmStatus();
export const scheduleAlarm = (payload: NativeAlarmPayload) => requireModule().scheduleAlarm(payload);
export const cancelAlarm = (alarmId: string) => requireModule().cancelAlarm(alarmId);
export const snoozeAlarm = (alarmId: string, minutes = 5) => requireModule().snoozeAlarm(alarmId, minutes);
export const completeAlarm = (alarmId: string) => requireModule().completeAlarm(alarmId);
export const getScheduledAlarms = () => requireModule().getScheduledAlarms();
export const getLaunchAlarm = () => requireModule().getLaunchAlarm();
export const getPendingEvents = () => requireModule().getPendingEvents();
export const acknowledgePendingEvent = (eventId: string) => requireModule().acknowledgePendingEvent(eventId);

export default { getStatus, getFullScreenAlarmStatus, scheduleAlarm, cancelAlarm, snoozeAlarm, completeAlarm, getScheduledAlarms, getLaunchAlarm, getPendingEvents, acknowledgePendingEvent };
