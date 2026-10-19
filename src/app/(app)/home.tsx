import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { useZOZARStore } from '@/components/zo-zar-store';
import { Arrive, Touchable } from '@/components/motion';
import {
  BrandBar,
  Card,
  EmptyState,
  HeroTime,
  Icon,
  Icons,
  PrimaryButton,
  Row,
  Screen,
  SectionLabel,
  TextField,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { IconSize, Spacing, Type, type Theme } from '@/constants/theme';

function defaultCommitmentTime() {
  const value = new Date();
  value.setMinutes(value.getMinutes() + 30, 0, 0);
  return value;
}

/**
 * A greeting that supports the next action rather than performing a mood.
 *
 * The previous copy read "Set tomorrow down gently, then let the day go", which is
 * writing that draws attention to itself. AGENTS.md asks that greetings support the
 * user's next action without inventing product status, so each line now points at what
 * this screen is for at that hour.
 */
function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Still up';
}

/** "Tomorrow" reads faster than a date at 1am, which is when this screen is most used. */
function whenLabel(iso: string | null | undefined): string {
  if (!iso) return 'Next wake';
  const target = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return 'Later today';
  if (days === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(target);
}

export default function HomeRoute() {
  const { theme, styles } = useZOZARTheme();
  const local = useMemo(() => makeLocal(theme), [theme]);
  const {
    userName,
    commitments,
    wakePlans,
    deviceSchedule,
    members,
    hydrationError,
    toggleCommitment,
    addCommitment,
    retryHydration,
  } = useZOZARStore();

  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(defaultCommitmentTime);
  const [saving, setSaving] = useState(false);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);

  const firstName = (userName || 'there').split(/\s+/)[0];
  const openCount = commitments.filter((item) => !item.done).length;
  const acceptedMember = members.find((member) => member.status === 'Accepted');

  const featuredWake = useMemo(() => {
    const active = wakePlans.filter((plan) => plan.status === 'Active');
    return (
      active.sort((a, b) => {
        const aTime = a.occurrenceScheduledFor ? new Date(a.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.occurrenceScheduledFor ? new Date(b.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      })[0] ??
      wakePlans[0] ??
      null
    );
  }, [wakePlans]);

  const deviceState = featuredWake ? deviceSchedule[featuredWake.id] : undefined;
  const guardian = acceptedMember?.name.split(/\s+/)[0];

  /**
   * The line under the time, and the most important sentence on the screen.
   *
   * Every other alarm app can show a time. What this product does is put a person behind
   * it, so that is what the hero says — named, in plain words, and only when it is
   * actually true. AGENTS.md forbids implying protection that is not configured.
   */
  const contract = (() => {
    if (!featuredWake) return undefined;
    if (deviceState?.status === 'error') return 'This alarm needs permission to ring.';
    if (guardian) return `${guardian} hears about it if you sleep through.`;
    return 'No one is watching this one yet.';
  })();

  async function saveCommitment() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setCommitmentError(null);
    try {
      await addCommitment(title.trim(), formatAlarmTime(time));
      setTitle('');
      setTime(defaultCommitmentTime());
      setComposerOpen(false);
    } catch (caught) {
      setCommitmentError(caught instanceof Error ? caught.message : 'That commitment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <BrandBar />

      {hydrationError ? (
        <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}>
          <Text style={[styles.cardTitle, { color: theme.error }]}>Your data did not load</Text>
          <Text style={styles.cardDetail}>{hydrationError}</Text>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Try loading again"
            onPress={() => void retryHydration()}
            rippleColor={theme.error}
            style={local.inlineAction}
          >
            <Text style={[styles.actionText, { color: theme.error }]}>Try again</Text>
          </Touchable>
        </Card>
      ) : null}

      <Text style={local.greeting}>
        {greeting(new Date().getHours())}, {firstName}
      </Text>

      {/*
        The screen's single orchestrated moment. The time is what the eye should land on,
        so it is the only thing that animates in; nothing else on this screen moves unless
        it is answering a tap.
      */}
      <Arrive>
        {featuredWake ? (
          <>
            <HeroTime
              label={whenLabel(featuredWake.occurrenceScheduledFor)}
              time={featuredWake.time}
              detail={contract}
            />
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Manage your wake alarms"
              onPress={() => router.push('/wake' as never)}
              rippleColor={theme.surfaceStrong}
              style={local.heroAction}
            >
              <Text style={local.heroActionText}>Manage alarms</Text>
              <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.accent} />
            </Touchable>
          </>
        ) : (
          <View style={local.noWake}>
            <Text style={local.noWakeTitle}>No alarm set</Text>
            <Text style={local.noWakeDetail}>
              Pick a time you need to be up, and choose who should know if you sleep through it.
            </Text>
            <PrimaryButton
              label="Set a wake time"
              icon={Icons.alarm}
              onPress={() => router.push('/wake' as never)}
            />
          </View>
        )}
      </Arrive>

      <View style={local.section}>
        <SectionLabel>
          {commitments.length === 0
            ? 'Today'
            : openCount === 0
              ? 'Today, all done'
              : `Today, ${openCount} left`}
        </SectionLabel>

        {commitments.length === 0 ? (
          <EmptyState
            icon={Icons.sun}
            title="Nothing planned"
            detail="Add something you need to be up for, and it will show against your wake time."
            action={<PrimaryButton label="Add a commitment" icon={Icons.plus} onPress={() => setComposerOpen(true)} />}
          />
        ) : (
          <View style={styles.list}>
            {commitments.slice(0, 4).map((item) => (
              <Touchable
                key={item.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={`${item.title}, ${item.time}`}
                onPress={() => void toggleCommitment(item.id)}
                rippleColor={theme.surfaceStrong}
              >
                <View style={styles.listRow}>
                  <View style={[styles.check, item.done && styles.checkDone]}>
                    {item.done ? <Icon as={Icons.check} size={14} color={theme.accentContrast} /> : null}
                  </View>
                  <View style={styles.listCopy}>
                    <Text numberOfLines={1} style={[styles.listTitle, item.done && styles.listDone]}>
                      {item.title}
                    </Text>
                  </View>
                  <Text style={styles.listTime}>{item.time}</Text>
                </View>
              </Touchable>
            ))}
          </View>
        )}
      </View>

      {commitments.length > 0 ? (
        <View style={local.rowActions}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={composerOpen ? 'Close the commitment form' : 'Add a commitment'}
            onPress={() => setComposerOpen((open) => !open)}
            rippleColor={theme.surfaceStrong}
            style={local.textAction}
          >
            <Icon as={composerOpen ? Icons.close : Icons.plus} size={IconSize.md} color={theme.accent} />
            <Text style={local.textActionLabel}>{composerOpen ? 'Close' : 'Add a commitment'}</Text>
          </Touchable>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Open your full plan"
            onPress={() => router.push('/plan' as never)}
            rippleColor={theme.surfaceStrong}
            style={local.textAction}
          >
            <Text style={local.textActionLabel}>See all</Text>
          </Touchable>
        </View>
      ) : null}

      {composerOpen ? (
        <Card style={styles.composer}>
          <Text style={styles.cardTitle}>Add a commitment</Text>
          <View style={styles.composerFields}>
            <TextField
              label="What is it"
              value={title}
              onChangeText={setTitle}
              placeholder="Database Systems class"
              autoCapitalize="sentences"
              returnKeyType="done"
              error={commitmentError}
            />
            <Text style={styles.fieldLabel}>When</Text>
            <AlarmTimePicker value={time} onChange={setTime} />
          </View>
          <PrimaryButton label="Add it" onPress={() => void saveCommitment()} disabled={!title.trim()} busy={saving} />
        </Card>
      ) : null}

      <View style={local.section}>
        <SectionLabel>Who has your back</SectionLabel>
        {acceptedMember ? (
          <View style={styles.list}>
            <Row
              title={acceptedMember.name}
              detail={acceptedMember.detail}
              onPress={() => router.push(`/chat/${acceptedMember.id}` as never)}
              accessibilityLabel={`Open your conversation with ${acceptedMember.name}`}
            />
          </View>
        ) : (
          <EmptyState
            icon={Icons.users}
            title="No one yet"
            detail="Pick someone who would actually check on you. They only see the alarms you link them to."
            action={
              <PrimaryButton
                label="Invite someone"
                icon={Icons.userPlus}
                onPress={() => router.push('/people' as never)}
              />
            }
          />
        )}
      </View>
    </Screen>
  );
}

const makeLocal = (theme: Theme) =>
  StyleSheet.create({
    greeting: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xl },

    heroAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      minHeight: 48,
      alignSelf: 'flex-start',
      paddingRight: Spacing.sm,
    },
    heroActionText: { ...Type.action, color: theme.accent },

    noWake: { paddingTop: Spacing.xxl, paddingBottom: Spacing.lg, gap: Spacing.md },
    noWakeTitle: { ...Type.title, color: theme.text },
    noWakeDetail: { ...Type.body, color: theme.textSecondary, marginBottom: Spacing.sm },

    section: { marginTop: Spacing.xxl },

    rowActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.md },
    textAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48, paddingHorizontal: Spacing.xs },
    textActionLabel: { ...Type.action, color: theme.accent },

    inlineAction: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', marginTop: Spacing.sm },
  });
