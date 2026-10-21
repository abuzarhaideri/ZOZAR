import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Platform, useColorScheme, View } from 'react-native';

import { Colors, type Theme } from '@/constants/theme';

export type AppearancePreference = 'system' | 'light' | 'dark';
type ResolvedAppearance = 'light' | 'dark';

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  theme: Theme;
  hydrated: boolean;
  setPreference: (next: AppearancePreference) => Promise<void>;
  /** Switch to the opposite of what is on screen now, saved as an explicit choice. */
  toggleAppearance: () => Promise<void>;
};

const STORAGE_KEY = 'zo-zar.appearance.v1';
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

async function readPreference(): Promise<AppearancePreference> {
  const value = Platform.OS === 'web'
    ? (typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage.getItem(STORAGE_KEY))
    : await SecureStore.getItemAsync(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

async function persistPreference(value: AppearancePreference) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export function AppearanceProvider({ children }: PropsWithChildren) {
  const systemAppearance = useColorScheme();
  const [preference, updatePreference] = useState<AppearancePreference>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    void readPreference().then((saved) => {
      if (mounted) updatePreference(saved);
    }).catch(() => {
      // Unreadable storage: keep following the device.
    }).finally(() => {
      if (mounted) setHydrated(true);
    });
    return () => { mounted = false; };
  }, []);

  const resolvedAppearance: ResolvedAppearance = preference === 'system'
    ? (systemAppearance === 'dark' ? 'dark' : 'light')
    : preference;
  const value = useMemo<AppearanceContextValue>(() => {
    const setPreference = async (next: AppearancePreference) => {
      updatePreference(next);
      try {
        await persistPreference(next);
      } catch {
        // The choice still applies for this session; failing to save it is not worth an error.
      }
    };
    return {
      preference,
      resolvedAppearance,
      theme: Colors[resolvedAppearance],
      hydrated,
      setPreference,
      toggleAppearance: () => setPreference(resolvedAppearance === 'dark' ? 'light' : 'dark'),
    };
  }, [hydrated, preference, resolvedAppearance]);

  if (!hydrated) {
    const initial = Colors[systemAppearance === 'dark' ? 'dark' : 'light'];
    return <View style={{ flex: 1, backgroundColor: initial.background }} />;
  }
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider.');
  return context;
}
