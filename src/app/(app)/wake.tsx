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
import { BackButton, Icon, Icons, Screen, useZOZARTheme } from '@/components/zo-zar-ui';
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

  const editingPlan = editingId ? wakePlans.find((plan) => plan.id === editingId) ?? null : null;

  return (
    <Screen>
      {/* Reached from the spine now, not a tab, so it carries its own way back. */}
      <BackButton label="Tonight" />

      <View style={wake.intro}>
        <Text accessibilityRole="header" style={wake.title}>
          Your alarms
        </Text>
        <Text style={wake.lede}>
          Up to three. Each has its own time, its own challenge, and its own person to tell.
        </Text>
      </View>

      {error ? (
        <View style={wake.notice}>
          <Text style={wake.noticeText}>{error}</Text>
          {/permission|exact-alarm|notification|do not disturb|device/i.test(error) ? (
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Review wake permissions"
              onPress={() => router.push('/permissions' as never)}
              rippleColor={theme.error}
              style={wake.noticeAction}
            >
              <Text style={wake.noticeActionText}>Review permissions</Text>
              <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.error} />
            </Touchable>
          ) : null}
        </View>
      ) : null}

      {wakePlans.length === 0 ? (
        <Text style={wake.empty}>
          No alarms yet. New ones start paused, so you can check the time and the challenge before
          one actually rings.
        </Text>
      ) : null}

      {/*
        Rows, not cards.
        
        Each alarm used to carry six controls: a switch, Edit, Hear it, Try the challenge,
        Delete, and a Delete confirmation — six targets for one object, four of them
        things you touch once a month. The row now has two. The switch stays, because
        turning an alarm off is the one thing you do often and a switch needs no label to
        explain itself. Everything else lives in the editor, which is where you already
        are when you care about it.

        The capsule on the left is the same shape as the wake block on the spine, scaled
        to the same grace window, so an alarm is recognisably the same object in both
        places.
      */}
      {wakePlans.map((plan) => {
        const scheduledState = deviceSchedule[plan.id];
        const isBusy = busyId === plan.id;
        const live = plan.status === 'Active';
        const unprotected = plan.protectedBy === 'No trusted person yet';
        const healthy = scheduledState?.status === 'scheduled';

        return (
          /*
            The switch is a sibling of the Touchable, not a child of it.
            
            Nested first, which meant toggling an alarm also fired the row and threw the
            editor open over the top — the control did its job and then something else
            happened as well. A touch target inside another touch target is always this
            bug waiting to happen, so the row's tappable region stops where the switch
            begins.
          */
          <View key={plan.id} style={wake.row}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={`${plan.time} alarm, ${plan.repeatLabel}, ${live ? 'on' : 'paused'}`}
              accessibilityHint="Opens this alarm to edit, test or delete it"
              onPress={() => openEditor(plan)}
              rippleColor={theme.surfaceStrong}
              style={wake.rowTap}
            >
              <View
                style={[
                  wake.capsule,
                  { height: Math.min(96, Math.max(48, plan.graceMinutes * 1.6)) },
                  !live && wake.capsulePaused,
                ]}
              >
                <View style={[wake.capsuleCap, !live && wake.capsuleCapPaused]} />
              </View>

              <View style={wake.rowBody}>
                <Text style={[wake.time, !live && wake.timePaused]}>{plan.time}</Text>
                <Text style={wake.repeat}>{plan.repeatLabel}</Text>
                <Text style={wake.fact}>
                  {unprotected ? 'Nobody is told if you miss it' : `${plan.protectedBy} is told if you miss it`}
                </Text>
                <Text style={[wake.fact, { color: live && !healthy ? theme.warning : theme.subtle }]}>
                  {deviceStatusLabel(plan, scheduledState)}
                </Text>
              </View>
            </Touchable>

            <Switch
              accessibilityLabel={`${live ? 'Pause' : 'Turn on'} the ${plan.time} alarm`}
              disabled={isBusy}
              value={live}
              onValueChange={() => void runForPlan(plan.id, () => toggleWakePlan(plan.id))}
              trackColor={{ false: theme.lineStrong, true: theme.accent }}
              thumbColor={theme.surface}
            />
          </View>
        );
      })}

      {wakePlans.length >= MAX_WAKE_PLANS ? (
        <Text style={wake.limit}>
          Three is the limit. More alarms than that and none of them mean anything.
        </Text>
      ) : (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Add an alarm"
          onPress={() => openEditor(null)}
          rippleColor={theme.surfaceStrong}
          style={wake.add}
        >
          <Icon as={Icons.plus} size={IconSize.md} color={theme.accent} />
          <Text style={wake.addLabel}>Add an alarm</Text>
        </Touchable>
      )}

      <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditor}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
          <View style={wake.sheetHeader}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={closeEditor}
              rippleColor={theme.surfaceStrong}
              style={wake.sheetCancel}
            >
              <Text style={wake.sheetCancelText}>Cancel</Text>
            </Touchable>
            <Text style={wake.sheetTitle}>{editingId ? 'Edit alarm' : 'New alarm'}</Text>
            <View style={{ width: 56 }} />
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

            {/*
              Test and delete belong to an alarm that already exists, so they only appear
              once there is one, and they appear here rather than on the list row — these
              are the things you do while looking at an alarm's settings, not while
              scanning three of them.
            */}
            {editingPlan ? (
              <View style={wake.sheetFooter}>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Hear this alarm sound"
                  disabled={busyId === editingPlan.id}
                  onPress={() => void runForPlan(editingPlan.id, () => testWakeAlarm(editingPlan.id))}
                  rippleColor={theme.surfaceStrong}
                  style={wake.footerAction}
                >
                  <Text style={wake.footerLabel}>Hear it</Text>
                </Touchable>

                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Try the wake challenge now"
                  disabled={!editingPlan.occurrenceId}
                  onPress={() => {
                    if (!editingPlan.occurrenceId) return;
                    closeEditor();
                    router.push(`/wake/${editingPlan.occurrenceId}?practice=1` as never);
                  }}
                  rippleColor={theme.surfaceStrong}
                  style={wake.footerAction}
                >
                  <Text style={[wake.footerLabel, !editingPlan.occurrenceId && wake.footerDisabled]}>
                    Try the challenge
                  </Text>
                </Touchable>

                {deleteId === editingPlan.id ? (
                  <View style={wake.deleteConfirm}>
                    <Text style={wake.deleteQuestion}>
                      Delete the {editingPlan.time} alarm? It stops ringing on this phone and this
                      cannot be undone.
                    </Text>
                    <View style={wake.deleteRow}>
                      <Touchable
                        accessibilityRole="button"
                        accessibilityLabel="Keep this alarm"
                        onPress={() => setDeleteId(null)}
                        rippleColor={theme.surfaceStrong}
                        style={wake.footerAction}
                      >
                        <Text style={wake.keepLabel}>Keep it</Text>
                      </Touchable>
                      <Touchable
                        accessibilityRole="button"
                        accessibilityLabel="Delete this alarm permanently"
                        accessibilityState={{ busy: busyId === editingPlan.id }}
                        disabled={busyId === editingPlan.id}
                        onPress={() =>
                          void runForPlan(editingPlan.id, async () => {
                            await deleteWakePlan(editingPlan.id);
                            setDeleteId(null);
                            closeEditor();
                          })
                        }
                        rippleColor={theme.errorSurface}
                        style={wake.footerAction}
                      >
                        <Text style={wake.deleteLabel}>
                          {busyId === editingPlan.id ? 'Deleting…' : 'Delete'}
                        </Text>
                      </Touchable>
                    </View>
                  </View>
                ) : (
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel="Delete this alarm"
                    onPress={() => setDeleteId(editingPlan.id)}
                    rippleColor={theme.errorSurface}
                    style={wake.footerAction}
                  >
                    <Text style={wake.deleteLabel}>Delete this alarm</Text>
                  </Touchable>
                )}
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const makeWakeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 440 },
    empty: { ...Type.body, color: theme.subtle, paddingTop: Spacing.xl, maxWidth: 440 },

    notice: {
      borderWidth: 1,
      borderColor: theme.error,
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      marginTop: Spacing.lg,
    },
    noticeText: { ...Type.callout, color: theme.error },
    noticeAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: 48 },
    noticeActionText: { ...Type.action, color: theme.error },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    /** The tappable region: everything up to, but not including, the switch. */
    rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.lg },
    /** The same capsule as the spine's wake block, so one alarm reads as one object. */
    capsule: {
      width: 20,
      borderRadius: Radius.card,
      borderWidth: 1.5,
      borderColor: theme.warm,
      backgroundColor: theme.warmSurface,
      overflow: 'hidden',
    },
    capsulePaused: { borderColor: theme.line, backgroundColor: 'transparent' },
    capsuleCap: { height: 6, backgroundColor: theme.accent, borderRadius: Radius.pill, margin: 2.5 },
    capsuleCapPaused: { backgroundColor: theme.lineStrong },

    rowBody: { flex: 1, gap: 1 },
    time: { ...Type.clockSmall, color: theme.text },
    timePaused: { color: theme.subtle },
    repeat: { ...Type.callout, color: theme.textSecondary },
    fact: { ...Type.caption, color: theme.subtle },

    add: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 56, marginTop: Spacing.sm },
    addLabel: { ...Type.action, color: theme.accent },
    limit: { ...Type.caption, color: theme.subtle, paddingTop: Spacing.lg, maxWidth: 440 },

    sheetHeader: {
      minHeight: 64,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      paddingHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetTitle: { ...Type.callout, color: theme.text },
    sheetCancel: { minWidth: 56, minHeight: 48, justifyContent: 'center' },
    sheetCancelText: { ...Type.action, color: theme.textSecondary },
    sheetBody: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.xxxl,
    },

    sheetFooter: {
      marginTop: Spacing.xl,
      paddingTop: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
    },
    footerAction: { minHeight: 48, justifyContent: 'center' },
    footerLabel: { ...Type.action, color: theme.text },
    footerDisabled: { color: theme.subtle },
    deleteConfirm: { gap: Spacing.sm, paddingTop: Spacing.sm },
    deleteQuestion: { ...Type.callout, color: theme.text },
    deleteRow: { flexDirection: 'row', gap: Spacing.xl },
    keepLabel: { ...Type.action, color: theme.textSecondary },
    deleteLabel: { ...Type.action, color: theme.error },
  });
