import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useZOZARStore } from '@/components/zo-zar-store';
import { useZOZARTheme } from '@/components/zo-zar-ui';
import { getWakePermissionStatus } from '@/services/permission-onboarding';

export default function HomeScreen() {
  const { theme, styles } = useZOZARTheme();
  const { session, sessionHydrated, setupHydrated, permissionsSetupComplete } = useZOZARStore();
  const [permissionCheck, setPermissionCheck] = useState<'idle' | 'ready' | 'missing'>('idle');

  useEffect(() => {
    if (!session || !permissionsSetupComplete) {
      setPermissionCheck('idle');
      return;
    }
    let active = true;
    void getWakePermissionStatus()
      .then((status) => { if (active) setPermissionCheck(status.readyForWake ? 'ready' : 'missing'); })
      .catch(() => { if (active) setPermissionCheck('missing'); });
    return () => { active = false; };
  }, [permissionsSetupComplete, session]);

  const loading = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background, padding: 24 }}><ActivityIndicator color={theme.accent} /><Text style={[styles.cardDetail, { marginTop: 14 }]}>Preparing your day…</Text></View>;
  if (!sessionHydrated || !setupHydrated) return loading;
  if (!session) return <Redirect href={'/sign-in' as never} />;
  if (!permissionsSetupComplete || permissionCheck === 'missing') return <Redirect href={'/permissions' as never} />;
  if (permissionCheck !== 'ready') return loading;
  return <Redirect href={'/welcome' as never} />;
}
