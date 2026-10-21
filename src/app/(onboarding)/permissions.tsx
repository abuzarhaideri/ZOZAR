import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { Touchable } from '@/components/motion';
import { Icon, Icons, PrimaryButton, RowMark, Screen, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { getWakePermissionStatus, requestWakePermissionStep, type WakePermissionStatus, type WakePermissionStep } from '@/services/permission-onboarding';

type StepId = Exclude<WakePermissionStep, null>;

const permissionSteps: { id: StepId; title: string; detail: string }[] = [
  { id: 'notifications', title: 'Notifications', detail: 'See wake reminders and trusted-person updates.' },
  { id: 'exact-alarm', title: 'Precise wake alarms', detail: 'Schedule your alarm at the exact minute you choose.' },
  { id: 'do-not-disturb', title: 'Ring through Do Not Disturb', detail: 'Let only the dedicated wake alarm ring when your phone is quiet.' },
];

export default function PermissionsScreen() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const { completePermissionSetup } = useZOZARStore();
  const [status, setStatus] = useState<WakePermissionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setChecking(true);
      setError(null);
      setStatus(await getWakePermissionStatus());
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : 'ZO-ZAR could not check Android permissions.');
    } finally {
      setChecking(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const isComplete = (id: StepId) => {
    if (!status) return false;
    if (id === 'notifications') return status.notifications === 'granted' || status.notifications === 'not-applicable';
    if (id === 'exact-alarm') return status.exactAlarm === 'granted' || status.exactAlarm === 'not-applicable';
    return status.doNotDisturb === 'granted' || status.doNotDisturb === 'not-applicable';
  };
  const ready = Boolean(
    status?.readyForWake &&
      (status.exactAlarm === 'granted' || status.exactAlarm === 'not-applicable') &&
      (status.doNotDisturb === 'granted' || status.doNotDisturb === 'not-applicable'),
  );

  function exactAlarmDetail() {
    if (!status) return 'Checking Android exact-alarm access. Continue stays disabled until it is confirmed.';
    if (status.exactAlarm === 'granted') return 'Android confirmed exact-alarm access. Your wake can fire at the exact minute you choose.';
    if (status.exactAlarm === 'not-granted') return 'Android has not granted exact-alarm access yet. Allow ZO-ZAR in Settings so your wake can fire at the exact minute you choose.';
    if (status.exactAlarm === 'unknown') return 'ZO-ZAR could not verify exact-alarm access because the native check is unavailable or failed. Continue stays disabled until Android reports access.';
    return 'Schedule your alarm at the exact minute you choose.';
  }

  async function grant(id: StepId) {
    await requestWakePermissionStep(id).catch(() => undefined);
    await refresh();
  }

  function continueToApp() {
    if (!ready) return;
    completePermissionSetup()
      .then(() => router.replace('/welcome' as never))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'ZO-ZAR could not save your setup. Try again.');
      });
  }

  /** "not-applicable" means this Android version does not ask, which is not the same as
   * the person having allowed it. */
  const notNeeded = (id: StepId) => {
    if (!status) return false;
    if (id === 'notifications') return status.notifications === 'not-applicable';
    if (id === 'exact-alarm') return status.exactAlarm === 'not-applicable';
    return status.doNotDisturb === 'not-applicable';
  };

  const doneCount = permissionSteps.filter((step) => isComplete(step.id)).length;

  return (
    <Screen bottomInset>
      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          Let your alarm keep its promise.
        </Text>
        <Text style={local.lede}>
          Android asks you to approve each of these yourself. ZO-ZAR checks the real status on this phone every time you come back.
        </Text>
      </View>

      <View style={local.notice}>
        <Icon as={Icons.shield} size={IconSize.md} color={theme.textSecondary} />
        <View style={local.noticeCopy}>
          <Text style={local.noticeTitle}>Only the wake alarm is urgent</Text>
          <Text style={local.noticeText}>Chat, voice notes and ordinary reminders stay quiet and never ring through Do Not Disturb.</Text>
        </View>
      </View>

      <Text style={local.progress} accessibilityLiveRegion="polite">
        {status ? `${doneCount} of ${permissionSteps.length} ready` : 'Checking this phone'}
      </Text>

      <View style={local.list}>
        {permissionSteps.map((step, index) => {
          const complete = isComplete(step.id);
          const doneLabel = notNeeded(step.id) ? 'Not needed on this phone' : 'Allowed on this phone';
          const unknown = step.id === 'exact-alarm' && status?.exactAlarm === 'unknown';
          const detail = step.id === 'exact-alarm' ? exactAlarmDetail() : step.detail;
          return (
            <View key={step.id} style={local.block}>
              <View
                accessible
                accessibilityLabel={`${step.title}, ${complete ? doneLabel.toLowerCase() : 'not allowed yet'}. ${detail}`}
                style={local.blockHead}
              >
                {complete ? <RowMark icon={Icons.check} active /> : <RowMark letter={String(index + 1)} />}
                <View style={local.blockCopy}>
                  <Text style={local.blockTitle}>{step.title}</Text>
                  <Text style={local.blockDetail}>{detail}</Text>
                  {complete ? <Text style={local.allowed}>{doneLabel}</Text> : null}
                </View>
              </View>

              {!complete ? (
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={`Open Android settings for ${step.title.toLowerCase()}`}
                  onPress={() => void grant(step.id)}
                  rippleColor={theme.line}
                  style={local.blockAction}
                >
                  <Text style={local.blockActionText}>Open Android settings</Text>
                  <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.textSecondary} />
                </Touchable>
              ) : null}
              {unknown ? (
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Check exact-alarm access again"
                  onPress={() => void refresh()}
                  rippleColor={theme.line}
                  style={local.blockAction}
                >
                  <Text style={local.blockActionText}>Check exact-alarm access again</Text>
                  <Icon as={Icons.refresh} size={IconSize.md} color={theme.textSecondary} />
                </Touchable>
              ) : null}
            </View>
          );
        })}
      </View>

      {error ? (
        <View style={local.errorBox}>
          <Text accessibilityRole="alert" style={local.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <PrimaryButton label="Continue to ZO-ZAR" onPress={continueToApp} disabled={!ready} busy={checking} />
      {!ready ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Check permissions again"
          onPress={() => void refresh()}
          rippleColor={theme.surfaceStrong}
          style={local.recheck}
        >
          <Text style={local.recheckText}>Check permissions again</Text>
        </Touchable>
      ) : null}
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { paddingTop: Spacing.huge, paddingBottom: Spacing.xl },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.md },

    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
      paddingVertical: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    noticeCopy: { flex: 1 },
    noticeTitle: { ...Type.callout, fontSize: 16, color: theme.text },
    noticeText: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },

    progress: { ...Type.label, color: theme.textSecondary, marginTop: Spacing.xl, marginBottom: Spacing.md },

    list: { gap: Spacing.md, marginBottom: Spacing.xl },
    block: {
      backgroundColor: theme.surface,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    blockHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    blockCopy: { flex: 1, minWidth: 0 },
    blockTitle: { ...Type.callout, fontSize: 16, color: theme.text, marginTop: Spacing.sm },
    blockDetail: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },
    allowed: { ...Type.callout, color: theme.text, marginTop: Spacing.sm },
    blockAction: {
      minHeight: 48,
      borderRadius: Radius.button,
      backgroundColor: theme.surfaceStrong,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      overflow: 'hidden',
    },
    blockActionText: { ...Type.action, color: theme.text, flexShrink: 1 },

    errorBox: {
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.row,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      marginBottom: Spacing.lg,
    },
    errorText: { ...Type.body, color: theme.error },

    recheck: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.sm,
      borderRadius: Radius.row,
    },
    recheckText: { ...Type.action, color: theme.textSecondary },
  });
