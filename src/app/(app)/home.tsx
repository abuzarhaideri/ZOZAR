import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { useZOZARStore } from '@/components/zo-zar-store';
import { BrandBar, Card, EmptyState, PrimaryButton, Screen, SectionHeader, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { Fonts } from '@/constants/theme';

function defaultCommitmentTime() {
  const value = new Date();
  value.setMinutes(value.getMinutes() + 30, 0, 0);
  return value;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { title: 'Good morning', detail: 'Begin with what matters most.' };
  if (hour < 17) return { title: 'Good afternoon', detail: 'Your next step is already in view.' };
  if (hour < 21) return { title: 'Good evening', detail: 'A calmer plan for tomorrow starts here.' };
  return { title: 'Good night', detail: 'Set tomorrow down gently, then let the day go.' };
}

export default function HomeRoute() {
  const { theme, styles } = useZOZARTheme();
  const { userName, commitments, wakePlans, deviceSchedule, members, hydrationError, toggleCommitment, addCommitment, retryHydration } = useZOZARStore();
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(defaultCommitmentTime);
  const [saving, setSaving] = useState(false);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);

  const words = greeting();
  const firstName = (userName || 'there').split(/\s+/)[0];
  const completedCount = commitments.filter((item) => item.done).length;
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const acceptedMember = members.find((member) => member.status === 'Accepted');
  const featuredWake = useMemo(() => {
    const active = wakePlans.filter((plan) => plan.status === 'Active');
    return active.sort((a, b) => {
      const aTime = a.occurrenceScheduledFor ? new Date(a.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.occurrenceScheduledFor ? new Date(b.occurrenceScheduledFor).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0] ?? wakePlans[0] ?? null;
  }, [wakePlans]);
  const deviceState = featuredWake ? deviceSchedule[featuredWake.id] : undefined;
  const protectedWake = Boolean(featuredWake && featuredWake.protectedBy !== 'No trusted person yet');

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
      setCommitmentError(caught instanceof Error ? caught.message : 'The commitment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <Screen>
    <BrandBar />
    <View style={local.intro}>
      <Text style={[local.date, { color: theme.warm }]}>{todayLabel}</Text>
      <Text accessibilityRole="header" style={[local.greeting, { color: theme.text }]}>{words.title},{`\n`}{firstName}.</Text>
      <Text style={[local.lede, { color: theme.muted }]}>{words.detail}</Text>
    </View>

    {hydrationError && <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}><Text style={[styles.cardTitle, { color: theme.error }]}>Your latest data did not load</Text><Text style={styles.cardDetail}>{hydrationError}</Text><Pressable accessibilityRole="button" onPress={() => void retryHydration()} style={local.inlineAction}><Text style={[styles.actionText, { color: theme.error }]}>Try again</Text></Pressable></Card>}

    <Card style={local.wakeCard}>
      <View style={local.heroTop}>
        <View style={[local.statusMark, { backgroundColor: featuredWake?.status === 'Active' ? theme.successSurface : theme.surfaceStrong }]}><Text style={{ color: featuredWake?.status === 'Active' ? theme.success : theme.muted }}>{featuredWake?.status === 'Active' ? '●' : '○'}</Text></View>
        <View style={local.flex}><Text style={[local.heroKicker, { color: theme.warm }]}>NEXT WAKE</Text><Text style={[local.heroStatus, { color: theme.muted }]}>{featuredWake ? (deviceState?.status === 'scheduled' ? 'Scheduled on this phone' : deviceState?.status === 'error' ? 'Needs attention' : featuredWake.status) : 'Not set'}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={featuredWake ? 'Manage wake alarms' : 'Create wake alarm'} onPress={() => router.push('/wake' as never)} style={local.manageButton}><Text style={{ color: theme.accent, fontFamily: Fonts.semibold, fontWeight: '700' }}>{featuredWake ? 'Manage' : 'Create'}</Text></Pressable>
      </View>
      {featuredWake ? <>
        <Text adjustsFontSizeToFit numberOfLines={1} style={[local.wakeTime, { color: theme.text }]}>{featuredWake.time}</Text>
        <Text style={[local.wakeTitle, { color: theme.text }]}>{featuredWake.title}</Text>
        <View style={[local.rule, { backgroundColor: theme.line }]} />
        <View style={local.detailGrid}>
          <View style={local.detailItem}><Text style={[local.detailLabel, { color: theme.subtle }]}>REPEAT</Text><Text style={[local.detailValue, { color: theme.text }]}>{featuredWake.repeatLabel}</Text></View>
          <View style={local.detailItem}><Text style={[local.detailLabel, { color: theme.subtle }]}>CHALLENGE</Text><Text style={[local.detailValue, { color: theme.text }]}>{featuredWake.difficulty}</Text></View>
          <View style={local.detailItem}><Text style={[local.detailLabel, { color: theme.subtle }]}>SUPPORT</Text><Text numberOfLines={1} style={[local.detailValue, { color: protectedWake ? theme.success : theme.muted }]}>{protectedWake ? featuredWake.protectedBy : 'Not linked'}</Text></View>
        </View>
      </> : <View style={local.emptyWake}><Text style={[styles.cardTitle, { fontSize: 22 }]}>Make tomorrow easier.</Text><Text style={styles.cardDetail}>Create a precise alarm, choose a challenge, and add trusted support when you want it.</Text><PrimaryButton label="Create my first alarm" onPress={() => router.push('/wake' as never)} /></View>}
    </Card>

    <View style={local.sectionTop}><SectionHeader kicker="Plan" title="Today" action={`${completedCount} of ${commitments.length} complete`} /></View>
    {commitments.length === 0 ? <EmptyState icon="◇" title="Your day is open" detail="Add one clear commitment and ZO-ZAR will remind you when it begins." action={<PrimaryButton label="Add commitment" onPress={() => setComposerOpen(true)} />} /> : <Card style={local.listCard}>{commitments.slice(0, 4).map((item, index) => <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: item.done }} onPress={() => void toggleCommitment(item.id)} style={({ pressed }) => [local.commitmentRow, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }, pressed && styles.pressed]}><View style={[local.check, { borderColor: item.done ? theme.success : theme.lineStrong, backgroundColor: item.done ? theme.success : 'transparent' }]}>{item.done && <Text style={local.checkText}>✓</Text>}</View><View style={local.flex}><Text numberOfLines={1} style={[local.rowTitle, { color: item.done ? theme.subtle : theme.text }, item.done && { textDecorationLine: 'line-through' }]}>{item.title}</Text><Text numberOfLines={1} style={[local.rowDetail, { color: theme.muted }]}>{item.detail || 'Today'}</Text></View><Text style={[local.rowTime, { color: theme.muted }]}>{item.time}</Text></Pressable>)}</Card>}
    <View style={local.actionPair}><Pressable accessibilityRole="button" onPress={() => setComposerOpen((open) => !open)} style={[local.quickAction, { borderColor: theme.line, backgroundColor: theme.surface }]}><Text style={[local.quickSymbol, { color: theme.accent }]}>{composerOpen ? '×' : '+'}</Text><Text style={[local.quickText, { color: theme.text }]}>{composerOpen ? 'Close' : 'Add commitment'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.push('/plan' as never)} style={[local.quickAction, { borderColor: theme.line, backgroundColor: theme.surface }]}><Text style={[local.quickSymbol, { color: theme.warm }]}>→</Text><Text style={[local.quickText, { color: theme.text }]}>Open plan</Text></Pressable></View>

    {composerOpen && <Card style={styles.composer}><Text style={styles.sectionKicker}>New commitment</Text><Text style={styles.cardTitle}>What deserves your attention?</Text><View style={styles.composerFields}><TextField label="Commitment" value={title} onChangeText={setTitle} placeholder="e.g. Database Systems class" autoCapitalize="sentences" returnKeyType="done" /><Text style={styles.fieldLabel}>Reminder time</Text><AlarmTimePicker value={time} onChange={setTime} /></View>{commitmentError && <Text style={[styles.authNoteText, { color: theme.error }]}>{commitmentError}</Text>}<PrimaryButton label="Add to today" onPress={() => void saveCommitment()} disabled={!title.trim()} busy={saving} /></Card>}

    <View style={local.sectionTop}><SectionHeader kicker="People" title="Your circle" action={`${members.filter((member) => member.status === 'Accepted').length} trusted`} /></View>
    <Card>{acceptedMember ? <Pressable accessibilityRole="button" accessibilityLabel={`Open chat with ${acceptedMember.name}`} onPress={() => router.push(`/chat/${acceptedMember.id}` as never)} style={local.personRow}><View style={[local.personAvatar, { backgroundColor: theme.warmSurface }]}><Text style={[local.personInitials, { color: theme.warm }]}>{acceptedMember.initials}</Text></View><View style={local.flex}><Text style={styles.cardTitle}>{acceptedMember.name}</Text><Text style={styles.cardDetail}>{acceptedMember.detail}</Text></View><Text style={[local.chevron, { color: theme.subtle }]}>›</Text></Pressable> : <><Text style={styles.cardTitle}>Support, when you choose it.</Text><Text style={styles.cardDetail}>Invite someone you trust. They only see the wake permissions you explicitly share.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/people' as never)} style={local.inlineAction}><Text style={[styles.actionText, { color: theme.accent }]}>Add a trusted person →</Text></Pressable></>}</Card>
  </Screen>;
}

const local = StyleSheet.create({
  flex: { flex: 1 }, intro: { paddingTop: 26, paddingBottom: 26 }, date: { fontFamily: Fonts.semibold, fontSize: 13, fontWeight: '700', marginBottom: 10 }, greeting: { fontFamily: Fonts.bold, fontSize: 38, lineHeight: 43, fontWeight: '700', letterSpacing: -1.4 }, lede: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24, marginTop: 10 },
  wakeCard: { padding: 20, marginBottom: 6 }, heroTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, statusMark: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, heroKicker: { fontFamily: Fonts.bold, fontSize: 11, fontWeight: '700', letterSpacing: 1.3 }, heroStatus: { fontFamily: Fonts.regular, fontSize: 12, marginTop: 2 }, manageButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }, wakeTime: { fontFamily: Fonts.bold, fontSize: 58, lineHeight: 66, fontWeight: '700', letterSpacing: -2.7, marginTop: 22 }, wakeTitle: { fontFamily: Fonts.semibold, fontSize: 19, lineHeight: 24, fontWeight: '700', marginTop: 2 }, rule: { height: 1, marginVertical: 20 }, detailGrid: { flexDirection: 'row', gap: 12 }, detailItem: { flex: 1, minWidth: 0 }, detailLabel: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 1 }, detailValue: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 6 }, emptyWake: { gap: 14, paddingTop: 22 },
  sectionTop: { marginTop: 30 }, listCard: { paddingVertical: 0 }, commitmentRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12 }, check: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, checkText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, rowTitle: { fontFamily: Fonts.semibold, fontSize: 15, fontWeight: '700' }, rowDetail: { fontFamily: Fonts.regular, fontSize: 12, marginTop: 3 }, rowTime: { fontFamily: Fonts.mono, fontSize: 12 }, actionPair: { flexDirection: 'row', gap: 10, marginTop: 2 }, quickAction: { flex: 1, minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }, quickSymbol: { fontFamily: Fonts.semibold, fontSize: 20 }, quickText: { flexShrink: 1, fontFamily: Fonts.semibold, fontSize: 13, fontWeight: '700' }, personRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12 }, personAvatar: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, personInitials: { fontFamily: Fonts.bold, fontSize: 13, fontWeight: '700' }, chevron: { fontSize: 26 }, inlineAction: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 10 },
});
