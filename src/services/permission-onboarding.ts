import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  getDoNotDisturbAccessStatus,
  getExactAlarmAccessStatus,
  openDoNotDisturbAccessSettings,
  openExactAlarmSettings,
  type SpecialAccessStatus,
} from './android-dnd-service';
import { configureNotificationChannels } from './notification-service';

export type RuntimePermissionStatus = 'granted' | 'denied' | 'undetermined' | 'not-applicable';

export type WakePermissionStatus = {
  notifications: RuntimePermissionStatus;
  microphone: RuntimePermissionStatus;
  exactAlarm: SpecialAccessStatus;
  doNotDisturb: SpecialAccessStatus;
  readyForWake: boolean;
};

export type WakePermissionStep =
  | 'notifications'
  | 'microphone'
  | 'exact-alarm'
  | 'do-not-disturb'
  | null;

function runtimeStatus(granted: boolean, status: string): RuntimePermissionStatus {
  if (granted) return 'granted';
  return status === 'undetermined' ? 'undetermined' : 'denied';
}

export async function getWakePermissionStatus(): Promise<WakePermissionStatus> {
  await configureNotificationChannels();
  const notificationsResponse =
    Platform.OS === 'web' ? null : await Notifications.getPermissionsAsync();
  const microphoneResponse =
    Platform.OS === 'web' ? null : await getRecordingPermissionsAsync();
  const exactAlarm = await getExactAlarmAccessStatus();
  const doNotDisturb = await getDoNotDisturbAccessStatus();
  const specialAccessReady =
    (exactAlarm === 'granted' || exactAlarm === 'not-applicable') &&
    (doNotDisturb === 'granted' || doNotDisturb === 'not-applicable');

  const notifications = notificationsResponse
    ? runtimeStatus(notificationsResponse.granted, notificationsResponse.status)
    : 'not-applicable';
  const microphone = microphoneResponse
    ? runtimeStatus(microphoneResponse.granted, microphoneResponse.status)
    : 'not-applicable';

  return {
    notifications,
    microphone,
    exactAlarm,
    doNotDisturb,
    readyForWake:
      (notifications === 'granted' || notifications === 'not-applicable') &&
      specialAccessReady,
  };
}

/** Requests the runtime prompts Expo can request directly. */
export async function requestWakeRuntimePermissions(): Promise<WakePermissionStatus> {
  await configureNotificationChannels();
  if (Platform.OS !== 'web') {
    const notificationStatus = await Notifications.getPermissionsAsync();
    if (!notificationStatus.granted) await Notifications.requestPermissionsAsync();
  }
  await requestVoiceRuntimePermission();
  return getWakePermissionStatus();
}

export async function requestVoiceRuntimePermission(): Promise<RuntimePermissionStatus> {
  if (Platform.OS === 'web') return 'not-applicable';
  const current = await getRecordingPermissionsAsync();
  const response = current.granted ? current : await requestRecordingPermissionsAsync();
  return runtimeStatus(response.granted, response.status);
}

/** Request or open exactly one permission and let the caller re-check on focus. */
export async function requestWakePermissionStep(step: Exclude<WakePermissionStep, null>): Promise<void> {
  if (step === 'notifications') {
    if (Platform.OS !== 'web') await Notifications.requestPermissionsAsync();
    return;
  }
  if (step === 'microphone') {
    await requestVoiceRuntimePermission();
    return;
  }
  if (step === 'exact-alarm') {
    await openExactAlarmSettings();
    return;
  }
  await openDoNotDisturbAccessSettings();
}

/** Opens one required Android special-access screen; re-check after returning. */
export async function openNextWakePermissionStep(
  status: WakePermissionStatus
): Promise<WakePermissionStep> {
  if (status.notifications !== 'granted') {
    await requestWakePermissionStep('notifications');
    return 'notifications';
  }
  if (status.exactAlarm !== 'granted' && status.exactAlarm !== 'not-applicable') {
    await openExactAlarmSettings();
    return 'exact-alarm';
  }
  if (status.doNotDisturb !== 'granted' && status.doNotDisturb !== 'not-applicable') {
    await openDoNotDisturbAccessSettings();
    return 'do-not-disturb';
  }
  return null;
}
