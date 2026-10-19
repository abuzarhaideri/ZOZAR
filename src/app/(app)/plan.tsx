import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlarmDatePicker, AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { useZOZARStore, type Commitment } from '@/components/zo-zar-store';
import { BrandBar, Card, EmptyState, PrimaryButton, Screen, SectionHeader, TextField, useZOZARTheme } from '@/components/zo-zar-ui';
import { Fonts, type Theme } from '@/constants/theme';

function initialDate() {
  const value = new Date();
  value.setMinutes(value.getMinutes() + 30, 0, 0);
  return value;
}

function mergeDateTime(date: Date, time: Date) {
  const value = new Date(date);
  value.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return value;
}

function dateKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateHeading(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (dateKey(iso) === dateKey(today.toISOString())) return 'Today';
  if (dateKey(iso) === dateKey(tomorrow.toISOString())) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

export default function PlanRoute() {
  const { styles, theme } = useZOZARTheme();
  const local = useMemo(() => makeLocal(theme), [theme]);
  const { commitments, toggleCommitment, addCommitment, updateCommitment, deleteCommitment, hydrationError, retryHydration, isHydrating } = useZOZARStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const groups = useMemo(() => commitments.reduce<Record<string, Commitment[]>>((result, item) => {
    const key = dateKey(item.startsAt);
    (result[key] ??= []).push(item);
    return result;
  }, {}), [commitments]);

  function openEditor(item?: Commitment) {
    setError(null);
    setEditingId(item?.id ?? null);
    setTitle(item?.title ?? '');
    const start = item ? new Date(item.startsAt) : initialDate();
    setDate(start);
    setTime(start);
    setEditorOpen(true);
  }

  async function save() {
    const startsAt = mergeDateTime(date, time);
    if (!title.trim()) { setError('Name this commitment.'); return; }
    if (startsAt.getTime() <= Date.now()) { setError('Choose a future date and time.'); return; }
    setBusy(true); setError(null);
    try {
      if (editingId) await updateCommitment(editingId, title.trim(), startsAt);
      else await addCommitment(title.trim(), formatAlarmTime(time), startsAt);
      setEditorOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The commitment could not be saved.');
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    try { await deleteCommitment(id); setDeleteId(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The commitment could not be deleted.'); }
    finally { setBusy(false); }
  }

  return <Screen>
    <BrandBar />
    <View style={styles.intro}><Text style={styles.eyebrow}>Plan · Your time</Text><Text style={styles.pageTitle}>Give the day shape.</Text><Text style={styles.lede}>A clear commitment, at the right moment, is enough to begin.</Text></View>
    <View style={local.primaryAction}><PrimaryButton label="New commitment" icon="+" onPress={() => openEditor()} /></View>

    {hydrationError && <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}><Text style={[styles.cardTitle, { color: theme.error }]}>Your plan could not be refreshed</Text><Text style={styles.cardDetail}>{hydrationError}</Text><PrimaryButton label="Try again" onPress={() => void retryHydration()} busy={isHydrating} /></Card>}
    {error && !editorOpen && <Text accessibilityRole="alert" style={[local.error, { color: theme.error }]}>{error}</Text>}

    <SectionHeader kicker="Agenda" title={`${commitments.length} commitment${commitments.length === 1 ? '' : 's'}`} />
    {commitments.length === 0 ? <EmptyState icon="◇" title="Nothing planned yet" detail="Add a commitment and choose exactly when ZO-ZAR should remind you." action={<PrimaryButton label="Create a commitment" onPress={() => openEditor()} />} /> : Object.values(groups).map((items) => <View key={dateKey(items[0].startsAt)} style={local.group}>
      <Text style={[local.dayHeading, { color: theme.warm }]}>{dateHeading(items[0].startsAt)}</Text>
      <Card style={local.listCard}>{items.map((item, index) => <View key={item.id} style={[local.row, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: item.done }} accessibilityLabel={`${item.title}, ${item.done ? 'completed' : 'planned'}`} onPress={() => void toggleCommitment(item.id)} style={local.rowMain}>
          <View style={[local.check, { borderColor: item.done ? theme.success : theme.lineStrong, backgroundColor: item.done ? theme.success : 'transparent' }]}>{item.done && <Text style={local.checkText}>✓</Text>}</View>
          <View style={local.copy}><Text style={[local.title, { color: item.done ? theme.subtle : theme.text }, item.done && local.done]}>{item.title}</Text><Text style={[local.detail, { color: theme.muted }]}>{item.time} · {item.detail}</Text></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} onPress={() => openEditor(item)} style={local.editButton}><Text style={{ color: theme.accent, fontFamily: Fonts.semibold, fontWeight: '700' }}>Edit</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`} onPress={() => setDeleteId(deleteId === item.id ? null : item.id)} style={local.moreButton}><Text style={{ color: theme.subtle, fontSize: 20 }}>•••</Text></Pressable>
        {deleteId === item.id && <View style={[local.deletePanel, { borderTopColor: theme.line }]}><Text style={[local.detail, { color: theme.muted }]}>Delete this commitment and cancel its reminder?</Text><View style={local.deleteActions}><Pressable accessibilityRole="button" onPress={() => setDeleteId(null)} style={local.cancelDelete}><Text style={{ color: theme.text, fontWeight: '700' }}>Keep</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove(item.id)} style={[local.confirmDelete, { backgroundColor: theme.error }]}><Text style={local.confirmDeleteText}>Delete</Text></Pressable></View></View>}
      </View>)}</Card>
    </View>)}

    <Modal visible={editorOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !busy && setEditorOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
        <View style={[local.modalHeader, { borderBottomColor: theme.line }]}><Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditorOpen(false)} style={local.headerAction}><Text style={{ color: theme.muted, fontWeight: '700' }}>Cancel</Text></Pressable><Text style={styles.cardTitle}>{editingId ? 'Edit commitment' : 'New commitment'}</Text><View style={{ width: 58 }} /></View>
        <ScrollView contentContainerStyle={local.editor} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionKicker}>Make it clear</Text><Text style={[styles.pageTitle, { fontSize: 30, lineHeight: 36 }]}>{editingId ? 'Change the plan.' : 'What comes next?'}</Text>
          <View style={{ marginTop: 28 }}><TextField label="Commitment" value={title} onChangeText={setTitle} placeholder="e.g. Database Systems class" autoCapitalize="sentences" returnKeyType="done" /></View>
          <Card><Text style={styles.fieldLabel}>Date</Text><AlarmDatePicker value={date} onChange={setDate} /><View style={{ marginTop: 18 }}><Text style={styles.fieldLabel}>Time</Text><AlarmTimePicker value={time} onChange={setTime} /></View></Card>
          <Text style={[styles.cardDetail, { marginBottom: 16 }]}>A normal reminder will arrive at this time. It will respect Silent and Do Not Disturb.</Text>
          {error && <Text accessibilityRole="alert" style={[local.error, { color: theme.error }]}>{error}</Text>}
          <PrimaryButton label={editingId ? 'Save changes' : 'Create commitment'} onPress={() => void save()} disabled={!title.trim()} busy={busy} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </Screen>;
}

const makeLocal = (theme: Theme) =>
  StyleSheet.create({
  primaryAction: { alignSelf: 'flex-start', marginBottom: 28 }, error: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, marginBottom: 14 }, group: { marginBottom: 18 }, dayHeading: { fontFamily: Fonts.bold, fontSize: 13, fontWeight: '700', marginBottom: 9 }, listCard: { paddingVertical: 0 }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }, rowMain: { flex: 1, minWidth: 190, minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 12 }, check: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, checkText: { color: theme.accentContrast, fontWeight: '800' }, copy: { flex: 1 }, title: { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 20, fontWeight: '700' }, done: { textDecorationLine: 'line-through' }, detail: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 3 }, editButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, moreButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }, deletePanel: { width: '100%', borderTopWidth: 1, paddingVertical: 13 }, deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 }, cancelDelete: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' }, confirmDelete: { minHeight: 44, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' }, confirmDeleteText: { color: theme.accentContrast, fontWeight: '700' }, modalHeader: { minHeight: 64, borderBottomWidth: 1, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerAction: { width: 58, minHeight: 48, justifyContent: 'center' }, editor: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  });
