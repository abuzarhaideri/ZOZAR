import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { configureNotificationChannels } from './notification-service';

export type PushTokenRegistration = {
  nativeDeviceToken: string;
  platform: 'android' | 'ios';
};

export type PushTokenRegistrationOptions = {
  persist?: (registration: PushTokenRegistration) => Promise<void>;
};

/** Fetches tokens and delegates persistence to the app/backend integration. */
export async function registerForPushNotifications(
  options: PushTokenRegistrationOptions = {}
): Promise<PushTokenRegistration | null> {
  if (!Device.isDevice || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return null;

  await configureNotificationChannels();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  const nativeToken = await Notifications.getDevicePushTokenAsync();
  if (typeof nativeToken.data !== 'string' || !nativeToken.data) {
    throw new Error('Firebase did not return a native device token.');
  }
  const registration: PushTokenRegistration = {
    nativeDeviceToken: nativeToken.data,
    platform: Platform.OS,
  };

  await options.persist?.(registration);
  return registration;
}
