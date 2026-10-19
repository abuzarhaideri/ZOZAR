import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import {
  AlarmEditor,
  alarmScheduleDate,
  createAlarmEditorValue,
  type AlarmEditorValue,
} from '@/components/alarm-editor';
import {
  BrandBar,
  Card,
  EmptyState,
  Glyph,
  Pill,
  PrimaryButton,
  Screen,
  SectionHeader,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { useZOZARStore, type WakePlan } from '@/components/zo-zar-store';
import { getWakePermissionStatus } from '@/services/permission-onboarding';
import { scheduleWakeSoundTest } from '@/services/notification-service';
import type { WakeSoundKey } from '@/types/domain';

const MAX_WAKE_PLANS = 3;

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function localTime(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function deviceStatusLabel(plan: WakePlan, status?: { status: 'scheduled' | 'not-scheduled' | 'error'; error?: string }) {
  if (plan.status !== 'Active') return 'Paused · not scheduled on this device';
  if (!status) return 'Active · checking device schedule';
  if (status.status === 'scheduled') return 'Scheduled on this device';
  if (status.status === 'error') return `Not scheduled · ${status.error ?? 'review permissions'}`;
  return 'Not scheduled · review permissions';
}

export default function WakeRoute() {
  const { styles, theme } = useZOZARTheme();
  const {
    wakePlans,
    commitments,
    members,
    deviceSchedule,
    saveWakePlan,
    toggleWakePlan,
    deleteWakePlan,
    testWakeAlarm,
    refreshDeviceSchedule,
    setPermissionsReady,
  } = useZOZARStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [alarmConfig, setAlarmConfig] = useState<AlarmEditorValue>(() => createAlarmEditorValue(null, commitments, members));
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    try {
      const next = await getWakePermissionStatus();
      setPermissionsReady(next.readyForWake);
    } catch {
      setPermissionsReady(false);
    }
  }, [setPermissionsReady]);

  useFocusEffect(useCallback(() => {
    void refreshPermissions();
    return undefined;
  }, [refreshPermissions]));

  const planSignature = wakePlans.map((plan) => `${plan.id}:${plan.status}:${plan.occurrenceId ?? ''}`).join('|');
  useEffect(() => {
    void refreshDeviceSchedule();
    // The signature changes only when the set/status of alarms changes. The store
    // method itself is intentionally omitted so a schedule refresh cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSignature]);

  function openEditor(plan: WakePlan | null) {
    setError(null);
    setDeleteId(null);
    setEditingId(plan?.id ?? null);
    setAlarmConfig(createAlarmEditorValue(plan, commitments, members));
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
  }

  async function saveAlarm(value: AlarmEditorValue) {
    setError(null);
    const current = editingId ? wakePlans.find((plan) => plan.id === editingId) : undefined;
    const trustedMember = members.find((item) => item.id === value.trustedMemberId);
    try {
      await saveWakePlan({
        id: editingId,
        commitmentId: value.commitmentId,
        circleId: trustedMember?.circleId ?? null,
        scheduleType: value.scheduleType,
        scheduledDate: value.scheduleType === 'once' ? dateKey(alarmScheduleDate(value)) : null,
        time: localTime(value.time),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekdays: value.scheduleType === 'weekly' ? value.weekdays : [],
        difficulty: value.difficulty,
        soundKey: value.soundKey,
        graceMinutes: value.graceMinutes,
        active: current?.status === 'Active',
      });
      setAlarmConfig(value);
      closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The wake alarm could not be saved.');
    }
  }

  async function previewAlarmSound(soundKey: WakeSoundKey) {
    await scheduleWakeSoundTest(editingId ?? 'new-alarm', soundKey);
  }

  async function runForPlan(id: string, action: () => Promise<void>) {
    setError(null);
    setBusyId(id);
    try {
      await action();
      await refreshDeviceSchedule();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The wake alarm action could not be completed.');
    } finally {
      setBusyId(null);
    }
  }

  return <Screen>
    <BrandBar />
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>Wake · Protection</Text>
      <Text style={styles.pageTitle}>Wake with intention.</Text>
      <Text style={styles.lede}>Create up to three independent alarms. Each one can have its own time, challenge, and trusted-person protection.</Text>
    </View>

    <SectionHeader
      kicker="Your alarms"
      title={`${wakePlans.length}/${MAX_WAKE_PLANS} saved`}
      action={wakePlans.length >= MAX_WAKE_PLANS ? 'Limit reached' : undefined}
    />
    <PrimaryButton
      label={wakePlans.length >= MAX_WAKE_PLANS ? 'Three alarms saved' : 'Create alarm'}
      icon="+"
      disabled={wakePlans.length >= MAX_WAKE_PLANS}
      onPress={() => openEditor(null)}
    />

    {wakePlans.length === 0 && <EmptyState
      icon="◷"
      title="No alarms yet"
      detail="Create a one-time, daily, or weekday alarm. New alarms start paused so you can review them before they ring."
    />}

    {wakePlans.map((plan) => {
      const scheduledState = deviceSchedule[plan.id];
      const isBusy = busyId === plan.id;
      return <Card key={plan.id} style={{ padding: 16 }}>
        <View style={styles.kickerRow}>
          <Text style={styles.sectionKicker}>Wake alarm</Text>
          <Pill label={plan.status} tone={plan.status === 'Active' ? 'success' : 'neutral'} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 5 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.wakeHeroTime, { color: theme.text }]}>{plan.time}</Text>
            <Text style={styles.cardDetail}>{plan.repeatLabel} · {plan.difficulty} challenge</Text>
          </View>
          <Glyph style={{ color: theme.text, fontSize: 26 }}>◷</Glyph>
        </View>
        <Text style={styles.cardDetail}>{plan.protectedBy === 'No trusted person yet' ? 'No trusted person linked' : `Protected by ${plan.protectedBy}`} · {plan.graceMinutes} minute grace period.</Text>
        <Text style={[styles.cardDetail, { color: scheduledState?.status === 'scheduled' ? theme.success : theme.muted }]}>{deviceStatusLabel(plan, scheduledState)}</Text>
        <View style={styles.divider} />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <View style={{ flex: 1, minHeight: 50, paddingHorizontal: 12, borderRadius: 14, backgroundColor: theme.surfaceStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{plan.status === 'Active' ? 'Alarm active' : 'Alarm paused'}</Text>
            <Switch accessibilityLabel={`${plan.status === 'Active' ? 'Pause' : 'Activate'} ${plan.time} alarm`} disabled={isBusy} value={plan.status === 'Active'} onValueChange={() => void runForPlan(plan.id, () => toggleWakePlan(plan.id))} trackColor={{ false: theme.lineStrong, true: theme.accent }} thumbColor="#FFFFFF" />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${plan.time} alarm`}
            onPress={() => openEditor(plan)}
            style={({ pressed }) => [{ minHeight: 50, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: theme.lineStrong, alignItems: 'center', justifyContent: 'center' }, pressed && styles.pressed]}
          >
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>Edit</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            disabled={isBusy}
            onPress={() => void runForPlan(plan.id, () => testWakeAlarm(plan.id))}
            style={({ pressed }) => [{ flex: 1, minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceStrong }, pressed && styles.pressed, isBusy && styles.disabled]}
          >
            <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>Test alarm sound</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!plan.occurrenceId}
            onPress={() => plan.occurrenceId && router.push(`/wake/${plan.occurrenceId}?practice=1` as never)}
            style={({ pressed }) => [{ flex: 1, minHeight: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceStrong, opacity: plan.occurrenceId ? 1 : 0.45 }, pressed && styles.pressed]}
          >
            <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>Practice challenge</Text>
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setDeleteId(deleteId === plan.id ? null : plan.id)} style={{ minHeight: 38, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>{deleteId === plan.id ? 'Cancel delete' : 'Delete alarm'}</Text>
        </Pressable>
        {deleteId === plan.id && <View style={{ borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 12 }}>
          <Text style={styles.cardDetail}>Delete this alarm and cancel its device notifications? This cannot be undone.</Text>
          <Pressable accessibilityRole="button" onPress={() => void runForPlan(plan.id, async () => { await deleteWakePlan(plan.id); setDeleteId(null); })} style={{ minHeight: 48, borderRadius: 14, marginTop: 10, backgroundColor: theme.error, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.inverseText, fontSize: 13, fontWeight: '700' }}>Delete permanently</Text>
          </Pressable>
        </View>}
      </Card>;
    })}

    <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
        <View style={{ minHeight: 64, borderBottomWidth: 1, borderBottomColor: theme.line, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" onPress={closeEditor} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={styles.actionText}>Cancel</Text></Pressable>
          <Text style={styles.cardTitle}>{editingId ? 'Edit alarm' : 'New alarm'}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <AlarmEditor key={editingId ?? 'new'} initialValue={alarmConfig} commitments={commitments} members={members} onSave={saveAlarm} onPreviewSound={previewAlarmSound} />
        </ScrollView>
      </SafeAreaView>
    </Modal>

    {error && <Card style={{ borderColor: theme.error, backgroundColor: theme.errorSurface, padding: 14 }}><Text style={{ color: theme.error, fontSize: 13, lineHeight: 19 }}>{error}</Text>{/permission|exact-alarm|notification|do not disturb|device/i.test(error) && <Pressable accessibilityRole="button" onPress={() => router.push('/permissions' as never)} style={{ minHeight: 44, justifyContent: 'center', marginTop: 4 }}><Text style={{ color: theme.error, fontSize: 13, fontWeight: '700' }}>Fix wake permissions →</Text></Pressable>}</Card>}
  </Screen>;
}
