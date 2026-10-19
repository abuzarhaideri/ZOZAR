import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SETUP_STATE_KEY = 'zo-zar.setup-state.v1';

type SetupState = {
  permissionsSetupComplete: boolean;
};

async function readValue(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage.getItem(SETUP_STATE_KEY);
  }
  return SecureStore.getItemAsync(SETUP_STATE_KEY);
}

async function writeValue(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(SETUP_STATE_KEY, value);
    }
    return;
  }
  await SecureStore.setItemAsync(SETUP_STATE_KEY, value);
}

export async function hasCompletedPermissionSetup(): Promise<boolean> {
  const value = await readValue();
  if (!value) return false;
  try {
    return Boolean((JSON.parse(value) as Partial<SetupState>).permissionsSetupComplete);
  } catch {
    return false;
  }
}

export async function markPermissionSetupComplete(): Promise<void> {
  await writeValue(JSON.stringify({ permissionsSetupComplete: true } satisfies SetupState));
}
