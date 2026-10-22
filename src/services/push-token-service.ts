import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { configureNotificationChannels } from './notification-service';

/**
 * Notification permission and channels.
 *
 * This used to also fetch a remote push token. It no longer does: there is no push
 * provider, so there is nothing to register a token with and nothing that could deliver
 * to it. Asking the device for one would fail at the native layer anyway, since on
 * Android that token comes from Google Play Services.
 *
 * What remains is still needed. The alarm itself posts *local* notifications — the
 * full-screen ringing activity, the wind-down reminder — and those need the permission
 * and the channels, which have nothing to do with remote push. That is why this file was
 * narrowed rather than deleted.
 */

/** Kept because the repositories still describe a device-token endpoint, which stays on
 * the server so a provider can be added later without a schema change. Nothing populates
 * it today. */
export type PushTokenRegistration = {
  nativeDeviceToken: string;
  platform: 'android' | 'ios';
};

/**
 * Requests notification permission and installs the alarm channels.
 *
 * Returns whether notifications may be posted at all. A refusal is not an error: alarms
 * still ring, because ringing is the native module's full-screen activity rather than a
 * notification, but the quieter reminders will not appear.
 */
export async function ensureNotificationsReady(): Promise<boolean> {
  if (!Device.isDevice || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return false;

  await configureNotificationChannels();
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  return permission.granted;
}
