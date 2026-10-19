import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getStatus as getExactAlarmNativeStatus } from '../../modules/zo-zar-exact-alarm';
import { WAKE_CHANNEL_ID } from './notification-service';

export type SpecialAccessStatus = 'granted' | 'not-granted' | 'not-applicable' | 'unknown';

const ANDROID_PACKAGE = Constants.expoConfig?.android?.package ?? 'com.zozar.app';

function androidAtLeast(apiLevel: number): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= apiLevel;
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!androidAtLeast(31)) return;
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM,
    { data: `package:${ANDROID_PACKAGE}` }
  );
}

export async function openDoNotDisturbAccessSettings(): Promise<void> {
  if (!androidAtLeast(23)) return;
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.NOTIFICATION_POLICY_ACCESS_SETTINGS
  );
}

export async function openAppNotificationSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
    { data: `package:${ANDROID_PACKAGE}` }
  );
}

export async function openWakeChannelSettings(): Promise<void> {
  if (!androidAtLeast(26)) {
    await openAppNotificationSettings();
    return;
  }

  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.CHANNEL_NOTIFICATION_SETTINGS,
    {
      extra: {
        'android.provider.extra.APP_PACKAGE': ANDROID_PACKAGE,
        'android.provider.extra.CHANNEL_ID': WAKE_CHANNEL_ID,
      },
    }
  );
}

/** Reads Android's exact-alarm access and fails closed when native status is unavailable. */
export async function getExactAlarmAccessStatus(): Promise<SpecialAccessStatus> {
  if (Platform.OS !== 'android') return 'not-applicable';
  try {
    return await getExactAlarmNativeStatus();
  } catch {
    return 'unknown';
  }
}

/** The configured wake channel is the only DND signal exposed by Expo JS. */
export async function getDoNotDisturbAccessStatus(): Promise<SpecialAccessStatus> {
  if (!androidAtLeast(23)) return 'not-applicable';
  try {
    const channel = await Notifications.getNotificationChannelAsync(WAKE_CHANNEL_ID);
    if (!channel) return 'unknown';
    return channel.bypassDnd ? 'granted' : 'not-granted';
  } catch {
    return 'unknown';
  }
}
