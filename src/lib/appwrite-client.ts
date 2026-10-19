import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import {
  Account,
  AppwriteException,
  Client,
  Functions,
  Realtime,
  Storage,
  TablesDB,
} from 'react-native-appwrite';

export type AppwriteConfig = {
  endpoint: 'https://sgp.cloud.appwrite.io/v1';
  projectId: string;
  databaseId: string;
  storageBucketId: string;
  actionsFunctionId: string;
};

export type CachedAppwriteIdentity = {
  userId: string;
  email?: string;
  displayName?: string;
  profilePhotoUri?: string;
};

const IDENTITY_CACHE_KEY = 'zozar.appwrite.identity.v1';
const endpoint = 'https://sgp.cloud.appwrite.io/v1' as const;

export const appwriteConfig: AppwriteConfig = {
  endpoint,
  projectId: process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID?.trim() ?? '',
  databaseId: process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID?.trim() ?? '',
  storageBucketId: process.env.EXPO_PUBLIC_APPWRITE_STORAGE_BUCKET_ID?.trim() ?? '',
  actionsFunctionId: process.env.EXPO_PUBLIC_APPWRITE_ACTIONS_FUNCTION_ID?.trim() ?? 'zozar-actions',
};

export const appwriteTableIds = {
  profiles: process.env.EXPO_PUBLIC_APPWRITE_PROFILES_TABLE_ID?.trim() ?? 'profiles',
  commitments: process.env.EXPO_PUBLIC_APPWRITE_COMMITMENTS_TABLE_ID?.trim() ?? 'commitments',
  wakePlans: process.env.EXPO_PUBLIC_APPWRITE_WAKE_PLANS_TABLE_ID?.trim() ?? 'wake_plans',
  wakeOccurrences: process.env.EXPO_PUBLIC_APPWRITE_WAKE_OCCURRENCES_TABLE_ID?.trim() ?? 'wake_occurrences',
  connections: process.env.EXPO_PUBLIC_APPWRITE_CONNECTIONS_TABLE_ID?.trim() ?? 'connections',
  chatThreads: process.env.EXPO_PUBLIC_APPWRITE_CHAT_THREADS_TABLE_ID?.trim() ?? 'chat_threads',
  messages: process.env.EXPO_PUBLIC_APPWRITE_MESSAGES_TABLE_ID?.trim() ?? 'messages',
  deviceTokens: process.env.EXPO_PUBLIC_APPWRITE_DEVICE_TOKENS_TABLE_ID?.trim() ?? 'device_tokens',
  notificationJobs: process.env.EXPO_PUBLIC_APPWRITE_NOTIFICATION_JOBS_TABLE_ID?.trim() ?? 'notification_jobs',
} as const;

export function isAppwriteConfigured() {
  return Boolean(appwriteConfig.projectId && appwriteConfig.databaseId && appwriteConfig.storageBucketId);
}

const client = new Client()
  .setEndpoint(appwriteConfig.endpoint)
  .setProject(appwriteConfig.projectId)
  .setPlatform(process.env.EXPO_PUBLIC_ANDROID_PACKAGE ?? 'com.zozar.app');

export const appwrite = {
  client,
  account: new Account(client),
  tables: new TablesDB(client),
  storage: new Storage(client),
  functions: new Functions(client),
  realtime: new Realtime(client),
};

export function isDefinitiveAppwriteAuthFailure(caught: unknown) {
  return caught instanceof AppwriteException && (caught.code === 401 || caught.code === 403);
}

export async function cacheAppwriteIdentity(identity: CachedAppwriteIdentity | null) {
  if (!identity) {
    await SecureStore.deleteItemAsync(IDENTITY_CACHE_KEY);
    return;
  }
  await SecureStore.setItemAsync(IDENTITY_CACHE_KEY, JSON.stringify(identity));
}

export async function readCachedAppwriteIdentity(): Promise<CachedAppwriteIdentity | null> {
  const value = await SecureStore.getItemAsync(IDENTITY_CACHE_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as CachedAppwriteIdentity;
  } catch {
    await SecureStore.deleteItemAsync(IDENTITY_CACHE_KEY);
    return null;
  }
}
