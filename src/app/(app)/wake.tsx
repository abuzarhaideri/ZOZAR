import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import {
  AlarmEditor,
  alarmScheduleDate,
  createAlarmEditorValue,
  planMinutes,
  type AlarmEditorValue,
} from '@/components/alarm-editor';
import { BackButton, Icon, Icons, PrimaryButton, Screen, SecondaryButton, useZOZARTheme } from '@/components/zo-zar-ui';
import { Touchable, announce } from '@/components/motion';
import { IconSize, MinTarget, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { isProtected } from '@/components/zo-zar-repository';
import { useZOZARStore, type WakePlan } from '@/components/zo-zar-store';
import { clockParts } from '@/lib/time';
import { getWakePermissionStatus } from '@/services/permission-onboarding';
import { scheduleWakeSoundTest } from '@/services/notification-service';
import type { WakeSoundKey } from '@/types/domain';

const MAX_WAKE_PLANS = 3;
const PERMISSION_ERROR = /permission|exact-alarm|notification|do not disturb|device/i;

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

/**
 * The alarm list and its editor.
 *
 * Optional route param `edit`: `/wake?edit=<planId>` opens that alarm's editor directly
 * (so the Wake dial can go straight to the alarm it shows), and `/wake?edit=new` opens a
 * new one when there is room. Without the param the screen behaves as a plain list.
 */
export default function WakeRoute() {
  const { theme } = useZOZARTheme();
  const wake = useMemo(() => makeWakeStyles(theme), [theme]);
  const {
    wakePlans,
    commitments,
    members,
    deviceSchedule,
    saveWakePlan,
    toggleWakePlan,
    deleteWakePlan,
    refreshDeviceSchedule,
    setPermissionsReady,
    isHydrating,
  } = useZOZARStore();
  const params = useLocalSearchParams<{ edit?: string }>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [alarmConfig, setAlarmConfig] = useState<AlarmEditorValue>(() => createAlarmEditorValue(null, commitments, members));
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const handledEdit = useRef<string | null>(null);

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
    setSheetError(null);
    setDeleteId(null);
    dirtyRef.current = false;
    setEditingId(plan?.id ?? null);
    setAlarmConfig(createAlarmEditorValue(plan, commitments, members));
    setEditorOpen(true);
  }

  function closeEditor() {
    dirtyRef.current = false;
    setEditorOpen(false);
    setEditingId(null);
    setSheetError(null);
  }

  /**
   * Leave the editor, asking first if there are unsaved changes. Android Back, Cancel and
   * the actions that navigate away all come through here, so an edit is never dropped
   * silently.
   */
  function leaveEditor(then?: () => void) {
    if (!dirtyRef.current) {
      closeEditor();
      then?.();
      return;
    }
    Alert.alert(
      'Discard your changes?',
      editingId ? 'The alarm keeps the settings it had before.' : 'This alarm has not been saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            closeEditor();
            then?.();
          },
        },
      ],
    );
  }

  // `/wake?edit=<id>` or `/wake?edit=new`: open the editor once, then clear the param so
  // returning to this screen later does not reopen it.
  useEffect(() => {
    const target = typeof params.edit === 'string' && params.edit ? params.edit : null;
    if (!target) {
      handledEdit.current = null;
      return;
    }
    if (handledEdit.current === target) return;
    // Until the plans have loaded, an empty list says nothing about the three-alarm limit
    // or whether the requested alarm exists, so wait.
    if (isHydrating) return;
    if (target === 'new') {
      handledEdit.current = target;
      if (wakePlans.length < MAX_WAKE_PLANS) openEditor(null);
      router.setParams({ edit: undefined } as never);
      return;
    }
    const plan = wakePlans.find((item) => item.id === target);
    handledEdit.current = target;
    // An alarm that no longer exists (deleted elsewhere) leaves the plain list showing.
    if (plan) openEditor(plan);
    router.setParams({ edit: undefined } as never);
    // openEditor reads the latest commitments and members each render; it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.edit, wakePlans, isHydrating]);

  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  async function saveAlarm(value: AlarmEditorValue) {
    const current = editingId ? wakePlans.find((plan) => plan.id === editingId) : undefined;
    const trustedMember = members.find((item) => item.id === value.trustedMemberId);
    // Errors are rethrown so the editor shows them beside the Save button, where the
    // person is looking, rather than on the list hidden behind the sheet.
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
    announce('Alarm saved');
  }

  async function previewAlarmSound(soundKey: WakeSoundKey) {
    await scheduleWakeSoundTest(editingId ?? 'new-alarm', soundKey);
  }

  async function runForPlan(id: string, action: () => Promise<void>, inSheet = false) {
    const report = inSheet ? setSheetError : setError;
    report(null);
    setBusyId(id);
    try {
      await action();
      await refreshDeviceSchedule();
    } catch (cause) {
      report(cause instanceof Error ? cause.message : 'The wake alarm action could not be completed.');
    } finally {
      setBusyId(null);
    }
  }

  const reviewPermissions = () => router.push('/permissions' as never);
  const editingPlan = editingId ? wakePlans.find((plan) => plan.id === editingId) ?? null : null;

  const notice = (message: string, onReview: () => void) => (
    <View style={wake.notice}>
      <Text accessibilityRole="alert" style={wake.noticeText}>
        {message}
      </Text>
      {PERMISSION_ERROR.test(message) ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Review wake permissions"
          onPress={onReview}
          rippleColor={theme.errorSurface}
          style={wake.noticeAction}
        >
          <Text style={wake.noticeActionText}>Review permissions</Text>
          <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.error} />
        </Touchable>
      ) : null}
    </View>
  );

  return (
    <Screen>
      {/* Reached from Wake, not a tab, so it carries its own way back. */}
      <BackButton label="Wake" />

      <View style={wake.intro}>
        <Text accessibilityRole="header" style={wake.title}>
          Your alarms
        </Text>
        <Text style={wake.lede}>
          Up to three. Each has its own time, its own challenge, and its own person to tell.
        </Text>
      </View>

      {error ? notice(error, reviewPermissions) : null}

      {wakePlans.length === 0 ? (
        <Text style={wake.empty}>
          No alarms yet. New ones start paused, so you can check the time and the challenge before
          one actually rings.
        </Text>
      ) : null}

      <View style={wake.list}>
        {wakePlans.map((plan, index) => {
          const scheduledState = deviceSchedule[plan.id];
          const isBusy = busyId === plan.id;
          const live = plan.status === 'Active';
          const unprotected = !isProtected(plan);
          const healthy = scheduledState?.status === 'scheduled';
          const parts = clockParts(planMinutes(plan.time));
          const told = unprotected ? 'Nobody is told if you miss it' : `${plan.protectedBy} is told if you miss it`;
          const status = deviceStatusLabel(plan, scheduledState);
          const last = index === wakePlans.length - 1;

          return (
            /*
              The switch is a sibling of the Touchable, not a child of it.

              Nested, toggling an alarm also fired the row and threw the editor open over
              the top. A touch target inside another touch target is always this bug
              waiting to happen, so the row's tappable region stops where the switch begins.
            */
            <View key={plan.id} style={[wake.row, last && wake.rowLast]}>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={`${parts.spoken} alarm, ${plan.repeatLabel}, ${live ? 'on' : 'paused'}. ${told}. ${status}`}
                accessibilityHint="Opens this alarm to edit, test or delete it"
                onPress={() => openEditor(plan)}
                rippleColor={theme.surfaceStrong}
                style={wake.rowTap}
              >
                <View style={wake.clockLine}>
                  <Text style={[wake.time, !live && wake.timePaused]}>{parts.digits}</Text>
                  {parts.period ? <Text style={[wake.period, !live && wake.timePaused]}>{parts.period}</Text> : null}
                </View>
                <Text style={wake.detail}>{plan.repeatLabel}</Text>
                <Text style={wake.detail}>{told}</Text>
                <Text style={[wake.status, live && !healthy && scheduledState ? wake.statusProblem : null]}>
                  {status}
                </Text>
              </Touchable>

              <Switch
                accessibilityLabel={`${live ? 'Pause' : 'Turn on'} the ${parts.spoken} alarm`}
                disabled={isBusy}
                value={live}
                onValueChange={() => void runForPlan(plan.id, () => toggleWakePlan(plan.id))}
                trackColor={{ false: theme.lineStrong, true: theme.fill }}
                thumbColor={live ? theme.onFill : theme.surfaceStrong}
              />
            </View>
          );
        })}
      </View>

      {wakePlans.length >= MAX_WAKE_PLANS ? (
        <Text style={wake.limit}>
          Three is the limit. More alarms than that and none of them mean anything.
        </Text>
      ) : (
        <View style={wake.add}>
          {wakePlans.length === 0 ? (
            <PrimaryButton icon={Icons.plus} label="Add an alarm" onPress={() => openEditor(null)} />
          ) : (
            <SecondaryButton icon={Icons.plus} label="Add an alarm" onPress={() => openEditor(null)} />
          )}
        </View>
      )}

      <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => leaveEditor()}>
        <SafeAreaView style={wake.sheet} edges={['top', 'bottom', 'left', 'right']}>
          <View style={wake.sheetHeader}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => leaveEditor()}
              rippleColor={theme.surfaceStrong}
              style={wake.sheetCancel}
            >
              <Text style={wake.sheetCancelText}>Cancel</Text>
            </Touchable>
            <Text accessibilityRole="header" style={wake.sheetTitle}>
              {editingId ? 'Edit alarm' : 'New alarm'}
            </Text>
            <View style={wake.sheetSpacer} />
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
              active={editingPlan?.status === 'Active'}
              isNew={!editingId}
              onDirtyChange={onDirtyChange}
              onReviewPermissions={() => leaveEditor(reviewPermissions)}
            />

            {/*
              Delete belongs to an alarm that already exists, so it appears only once there
              is one, below Save as a quiet text action. Practice is not here: it lives in
              the editor's Wake challenge section, beside each level, so it works for new
              and unsaved alarms too and never needs an upcoming occurrence.
            */}
            {editingPlan ? (
              <View style={wake.sheetFooter}>
                {sheetError ? notice(sheetError, () => leaveEditor(reviewPermissions)) : null}

                {deleteId === editingPlan.id ? (
                  <View style={wake.deleteConfirm}>
                    <Text style={wake.deleteQuestion}>
                      Delete the {clockParts(planMinutes(editingPlan.time)).spoken} alarm? It stops
                      ringing on this phone and this cannot be undone.
                    </Text>
                    <View style={wake.deleteRow}>
                      <Touchable
                        accessibilityRole="button"
                        accessibilityLabel="Keep this alarm"
                        onPress={() => setDeleteId(null)}
                        rippleColor={theme.surfaceStrong}
                        style={wake.textAction}
                      >
                        <Text style={wake.keepLabel}>Keep it</Text>
                      </Touchable>
                      <Touchable
                        accessibilityRole="button"
                        accessibilityLabel="Delete this alarm permanently"
                        accessibilityState={{ busy: busyId === editingPlan.id }}
                        disabled={busyId === editingPlan.id}
                        onPress={() =>
                          void runForPlan(
                            editingPlan.id,
                            async () => {
                              await deleteWakePlan(editingPlan.id);
                              setDeleteId(null);
                              closeEditor();
                              announce('Alarm deleted');
                            },
                            true,
                          )
                        }
                        rippleColor={theme.errorSurface}
                        style={wake.textAction}
                      >
                        <Text style={wake.deleteLabel}>
                          {busyId === editingPlan.id ? 'Deleting' : 'Delete'}
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
                    style={wake.textAction}
                  >
                    <Icon as={Icons.trash} size={IconSize.md} color={theme.error} />
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
    intro: { paddingTop: Spacing.lg, paddingBottom: Spacing.lg },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 440 },
    empty: { ...Type.body, color: theme.textSecondary, paddingTop: Spacing.lg, maxWidth: 440 },

    notice: {
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.row,
      padding: Spacing.lg,
      marginTop: Spacing.md,
      marginBottom: Spacing.md,
    },
    noticeText: { ...Type.callout, color: theme.error },
    noticeAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MinTarget, alignSelf: 'flex-start' },
    noticeActionText: { ...Type.action, color: theme.error },

    list: { marginTop: Spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    rowLast: { borderBottomWidth: 0 },
    /** The tappable region: everything up to, but not including, the switch. */
    rowTap: { flex: 1, paddingVertical: Spacing.lg, gap: 2 },
    clockLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs, marginBottom: Spacing.xs },
    time: { ...Type.clockSmall, fontSize: 36, lineHeight: 42, color: theme.text },
    period: { ...Type.callout, color: theme.textSecondary },
    timePaused: { color: theme.subtle },
    detail: { ...Type.callout, color: theme.textSecondary },
    status: { ...Type.caption, color: theme.subtle, marginTop: Spacing.xs },
    statusProblem: { color: theme.error },

    add: { marginTop: Spacing.xl },
    limit: { ...Type.caption, color: theme.subtle, paddingTop: Spacing.xl, maxWidth: 440 },

    sheet: { flex: 1, backgroundColor: theme.background },
    sheetHeader: {
      minHeight: 64,
      paddingHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetTitle: { ...Type.action, fontSize: 16, color: theme.text, flexShrink: 1, textAlign: 'center' },
    sheetCancel: { minWidth: 72, minHeight: MinTarget, justifyContent: 'center' },
    sheetCancelText: { ...Type.action, color: theme.textSecondary },
    sheetSpacer: { minWidth: 72 },
    sheetBody: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.xxxl,
    },

    sheetFooter: { marginTop: Spacing.xl, gap: Spacing.xs },
    textAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: MinTarget, alignSelf: 'flex-start' },
    textActionLabel: { ...Type.action, color: theme.text },
    deleteConfirm: { gap: Spacing.sm, paddingTop: Spacing.sm },
    deleteQuestion: { ...Type.callout, color: theme.text },
    deleteRow: { flexDirection: 'row', gap: Spacing.xl },
    keepLabel: { ...Type.action, color: theme.textSecondary },
    deleteLabel: { ...Type.action, color: theme.error },
  });
