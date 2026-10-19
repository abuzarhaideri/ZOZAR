import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
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
  Icon,
  Pill,
  PrimaryButton,
  Screen,
  SectionLabel,
  useZOZARTheme,
  Icons,
} from '@/components/zo-zar-ui';
import { Touchable } from '@/components/motion';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';
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
  if (plan.status !== 'Active') return 'Paused, so it will not ring.';
  if (!status) return 'Checking this phone.';
  if (status.status === 'scheduled') return 'Set on this phone.';
  if (status.status === 'error') return status.error ?? 'This phone will not ring it. Check permissions.';
  return 'This phone will not ring it. Check permissions.';
}

export default function WakeRoute() {
  const { styles, theme } = useZOZARTheme();
  const wake = useMemo(() => makeWakeStyles(theme), [theme]);
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

  return (
    <Screen>
      <BrandBar />

      <View style={styles.intro}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          Your alarms
        </Text>
        <Text style={styles.lede}>
          Up to three. Each has its own time, its own challenge, and its own person to tell.
        </Text>
      </View>

      <PrimaryButton
        label={wakePlans.length >= MAX_WAKE_PLANS ? 'Three is the limit' : 'Add an alarm'}
        icon={Icons.plus}
        disabled={wakePlans.length >= MAX_WAKE_PLANS}
        onPress={() => openEditor(null)}
      />

      {wakePlans.length === 0 ? (
        <EmptyState
          icon={Icons.alarm}
          title="No alarms yet"
          detail="New alarms start paused, so you can check the time and the challenge before one actually rings."
        />
      ) : null}

      {wakePlans.map((plan) => {
        const scheduledState = deviceSchedule[plan.id];
        const isBusy = busyId === plan.id;
        const live = plan.status === 'Active';
        const unprotected = plan.protectedBy === 'No trusted person yet';

        return (
          <Card key={plan.id} style={wake.planCard}>
            {/* The time leads. Everything else on this card explains it. */}
            <View style={wake.planHead}>
              <Text style={wake.planTime}>{plan.time}</Text>
              <Pill label={live ? 'On' : 'Paused'} tone={live ? 'success' : 'neutral'} />
            </View>

            <Text style={wake.planRepeat}>{plan.repeatLabel}</Text>

            <View style={wake.facts}>
              <Text style={wake.fact}>
                {unprotected ? 'No one is told if you miss it' : `${plan.protectedBy} is told if you miss it`}
              </Text>
              <Text style={wake.fact}>
                {plan.difficulty} challenge, {plan.graceMinutes} minutes to confirm
              </Text>
              <Text style={[wake.fact, { color: scheduledState?.status === 'scheduled' ? theme.success : theme.warning }]}>
                {deviceStatusLabel(plan, scheduledState)}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={wake.controlRow}>
              <View style={wake.switchBox}>
                <Text style={wake.switchLabel}>{live ? 'Ringing as set' : 'Paused'}</Text>
                <Switch
                  accessibilityLabel={`${live ? 'Pause' : 'Turn on'} the ${plan.time} alarm`}
                  disabled={isBusy}
                  value={live}
                  onValueChange={() => void runForPlan(plan.id, () => toggleWakePlan(plan.id))}
                  trackColor={{ false: theme.lineStrong, true: theme.accent }}
                  thumbColor={theme.surface}
                />
              </View>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={`Edit the ${plan.time} alarm`}
                onPress={() => openEditor(plan)}
                rippleColor={theme.surfaceStrong}
                style={wake.editButton}
              >
                <Text style={wake.editLabel}>Edit</Text>
              </Touchable>
            </View>

            <View style={wake.secondaryRow}>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel="Hear this alarm sound"
                disabled={isBusy}
                onPress={() => void runForPlan(plan.id, () => testWakeAlarm(plan.id))}
                rippleColor={theme.surfaceStrong}
                style={[wake.quietButton, isBusy && styles.disabled]}
              >
                <Text style={wake.quietLabel}>Hear it</Text>
              </Touchable>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel="Try the wake challenge now"
                disabled={!plan.occurrenceId}
                onPress={() => plan.occurrenceId && router.push(`/wake/${plan.occurrenceId}?practice=1` as never)}
                rippleColor={theme.surfaceStrong}
                style={[wake.quietButton, !plan.occurrenceId && styles.disabled]}
              >
                <Text style={wake.quietLabel}>Try the challenge</Text>
              </Touchable>
            </View>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel={deleteId === plan.id ? 'Keep this alarm' : 'Delete this alarm'}
              onPress={() => setDeleteId(deleteId === plan.id ? null : plan.id)}
              rippleColor={theme.errorSurface}
              style={wake.deleteToggle}
            >
              <Text style={wake.deleteToggleLabel}>{deleteId === plan.id ? 'Keep it' : 'Delete'}</Text>
            </Touchable>

            {deleteId === plan.id ? (
              <View style={wake.confirmDelete}>
                <Text style={styles.cardDetail}>
                  This removes the alarm and stops it ringing on this phone. It cannot be undone.
                </Text>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Delete this alarm permanently"
                  onPress={() =>
                    void runForPlan(plan.id, async () => {
                      await deleteWakePlan(plan.id);
                      setDeleteId(null);
                    })
                  }
                  rippleColor={theme.background}
                  style={wake.deleteConfirmButton}
                >
                  <Text style={wake.deleteConfirmLabel}>Delete the alarm</Text>
                </Touchable>
              </View>
            ) : null}
          </Card>
        );
      })}

      <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
          <View style={wake.sheetHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={closeEditor} style={wake.sheetCancel}>
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
            <Text style={styles.cardTitle}>{editingId ? 'Edit alarm' : 'New alarm'}</Text>
            <View style={{ width: 48 }} />
          </View>
          <ScrollView
            contentContainerStyle={wake.sheetBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <AlarmEditor
              key={editingId ?? 'new'}
              initialValue={alarmConfig}
              commitments={commitments}
              members={members}
              onSave={saveAlarm}
              onPreviewSound={previewAlarmSound}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {error ? (
        <Card style={{ borderColor: theme.error, backgroundColor: theme.errorSurface }}>
          <Text style={{ ...Type.body, color: theme.error }}>{error}</Text>
          {/permission|exact-alarm|notification|do not disturb|device/i.test(error) ? (
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Review wake permissions"
              onPress={() => router.push('/permissions' as never)}
              rippleColor={theme.error}
              style={wake.errorAction}
            >
              <Text style={{ ...Type.action, color: theme.error }}>Review permissions</Text>
              <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.error} />
            </Touchable>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const makeWakeStyles = (theme: Theme) =>
  StyleSheet.create({
  planCard: { padding: Spacing.xl },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
    planTime: { ...Type.clockSmall, color: theme.text },
    planRepeat: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },
  facts: { gap: Spacing.xs, marginTop: Spacing.lg },
    fact: { ...Type.caption, color: theme.textSecondary },
  controlRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  switchBox: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.row,
    backgroundColor: theme.surfaceStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
    switchLabel: { ...Type.callout, color: theme.text },
  editButton: {
    minHeight: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.row,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
    editLabel: { ...Type.action, color: theme.text },
  secondaryRow: { flexDirection: 'row', gap: Spacing.sm },
  quietButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.tight,
    backgroundColor: theme.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
    quietLabel: { ...Type.caption, color: theme.text },
  deleteToggle: { minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.xs },
    deleteToggleLabel: { ...Type.caption, color: theme.textSecondary },
  confirmDelete: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, paddingTop: Spacing.md, gap: Spacing.md },
  deleteConfirmButton: { minHeight: 52, borderRadius: Radius.row, backgroundColor: theme.error, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    deleteConfirmLabel: { ...Type.action, color: theme.accentContrast },
  sheetHeader: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
    paddingHorizontal: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetCancel: { minHeight: 48, justifyContent: 'center' },
  sheetBody: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.xxxl },
  errorAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 48 },
  });
