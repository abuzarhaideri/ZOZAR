import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { Card, Icon, Icons, PrimaryButton, Screen, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { IconSize } from '@/constants/theme';
import { getWakePermissionStatus, requestWakePermissionStep, type WakePermissionStatus, type WakePermissionStep } from '@/services/permission-onboarding';

const permissionSteps: { id: Exclude<WakePermissionStep, null>; title: string; detail: string }[] = [
  { id: 'notifications', title: 'Notifications', detail: 'See wake reminders and trusted-person updates.' },
  { id: 'exact-alarm', title: 'Precise wake alarms', detail: 'Schedule your alarm at the exact minute you choose.' },
  { id: 'do-not-disturb', title: 'Ring through Do Not Disturb', detail: 'Let only the dedicated wake alarm ring when your phone is quiet.' },
];

export default function PermissionsScreen() {
  const { styles, theme } = useZOZARTheme();
  const { completePermissionSetup } = useZOZARStore();
  const [status, setStatus] = useState<WakePermissionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setChecking(true); setError(null);
      setStatus(await getWakePermissionStatus());
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : 'ZO-ZAR could not check Android permissions.');
    } finally { setChecking(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); return undefined; }, [refresh]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => subscription.remove();
  }, [refresh]);

  const isComplete = (id: Exclude<WakePermissionStep, null>) => {
    if (!status) return false;
    if (id === 'notifications') return status.notifications === 'granted' || status.notifications === 'not-applicable';
    if (id === 'exact-alarm') return status.exactAlarm === 'granted' || status.exactAlarm === 'not-applicable';
    return status.doNotDisturb === 'granted' || status.doNotDisturb === 'not-applicable';
  };
  const ready = Boolean(
    status?.readyForWake &&
      (status.exactAlarm === 'granted' || status.exactAlarm === 'not-applicable') &&
      (status.doNotDisturb === 'granted' || status.doNotDisturb === 'not-applicable')
  );

  function exactAlarmDetail() {
    if (!status) return 'Checking Android exact-alarm access. Continue stays disabled until it is confirmed.';
    if (status.exactAlarm === 'granted') return 'Android confirmed exact-alarm access. Your wake can fire at the exact minute you choose.';
    if (status.exactAlarm === 'not-granted') return 'Android has not granted exact-alarm access yet. Allow ZO-ZAR in Settings so your wake can fire at the exact minute you choose.';
    if (status.exactAlarm === 'unknown') return 'ZO-ZAR could not verify exact-alarm access because the native check is unavailable or failed. Continue stays disabled until Android reports access.';
    return 'Schedule your alarm at the exact minute you choose.';
  }

  async function grant(id: Exclude<WakePermissionStep, null>) {
    await requestWakePermissionStep(id).catch(() => undefined);
    await refresh();
  }

  function continueToApp() {
    if (!ready) return;
    void completePermissionSetup().then(() => router.replace('/welcome' as never));
  }

  return <Screen>
    <View style={styles.onboardingHeader}><Text style={styles.sectionKicker}>Wake setup</Text><Text style={styles.authTitle}>Let alarms keep their promise.</Text><Text style={styles.authDetail}>Android asks you to approve each setting. ZO-ZAR checks the real device status every time you return.</Text></View>
    <Card style={styles.permissionNotice}><Icon as={Icons.shield} size={20} color={theme.success} /><View style={styles.permissionNoticeCopy}><Text style={styles.cardTitle}>Only the wake alarm is urgent</Text><Text style={styles.cardDetail}>Chat, voice notes, and normal reminders stay quiet and never bypass Do Not Disturb.</Text></View></Card>
    <View style={styles.permissionList}>{permissionSteps.map((step, index) => { const complete = isComplete(step.id); const unknown = step.id === 'exact-alarm' && status?.exactAlarm === 'unknown'; const detail = step.id === 'exact-alarm' ? exactAlarmDetail() : step.detail; return <Card key={step.id} style={styles.permissionCard}><View style={styles.permissionNumber}>{complete ? <Icon as={Icons.check} size={IconSize.sm} color={theme.accentContrast} /> : <Text style={styles.permissionNumberText}>{index + 1}</Text>}</View><View style={styles.permissionCopy}><Text style={styles.cardTitle}>{step.title}</Text><Text style={styles.cardDetail}>{detail}</Text><Pressable accessibilityRole="button" onPress={() => grant(step.id)} style={styles.permissionAction}><Text style={styles.permissionActionText}>{complete ? 'Allowed' : 'Open Android settings'}</Text><Icon as={Icons.chevronRight} size={IconSize.md} color={theme.accent} /></Pressable>{unknown && <Pressable accessibilityRole="button" onPress={refresh} style={styles.permissionAction}><Text style={styles.permissionActionText}>Re-check exact-alarm status</Text><Icon as={Icons.refresh} size={IconSize.md} color={theme.accent} /></Pressable>}</View></Card>; })}</View>
    {error && <Text accessibilityRole="alert" style={[styles.authNoteText, { color: theme.error, marginBottom: 12 }]}>{error}</Text>}
    <PrimaryButton label={checking ? 'Checking permissions…' : 'Continue to ZO-ZAR'} onPress={continueToApp} disabled={!ready} busy={checking} />
    {!ready && <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.skipButton}><Text style={styles.skipText}>Check permissions again</Text></Pressable>}
  </Screen>;
}
