import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlarmDatePicker, AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { useZOZARStore, type Commitment } from '@/components/zo-zar-store';
import {
  BrandBar,
  Card,
  EmptyState,
  Icon,
  Icons,
  PrimaryButton,
  Screen,
  SectionLabel,
  TextField,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { Touchable } from '@/components/motion';
import { IconSize, Radius, Spacing, Type, type Theme } from '@/constants/theme';

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

  return (
    <Screen>
      <BrandBar />

      <View style={styles.intro}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          Your plan
        </Text>
        <Text style={styles.lede}>Things you need to be up for. Each one can carry its own reminder.</Text>
      </View>

      <View style={local.primaryAction}>
        <PrimaryButton label="Add a commitment" icon={Icons.plus} onPress={() => openEditor()} />
      </View>

      {hydrationError ? (
        <Card style={{ backgroundColor: theme.errorSurface, borderColor: theme.error }}>
          <Text style={[styles.cardTitle, { color: theme.error }]}>Your plan could not be refreshed</Text>
          <Text style={styles.cardDetail}>{hydrationError}</Text>
          <PrimaryButton label="Try again" onPress={() => void retryHydration()} busy={isHydrating} />
        </Card>
      ) : null}

      {error && !editorOpen ? (
        <Text accessibilityRole="alert" style={local.error}>
          {error}
        </Text>
      ) : null}

      {commitments.length === 0 ? (
        <EmptyState
          icon={Icons.listChecks}
          title="Nothing planned"
          detail="Add something you need to be up for, and pick when you want reminding."
          action={<PrimaryButton label="Add your first one" onPress={() => openEditor()} />}
        />
      ) : (
        Object.values(groups).map((items) => (
          <View key={dateKey(items[0]!.startsAt)} style={local.group}>
            <SectionLabel>{dateHeading(items[0]!.startsAt)}</SectionLabel>

            {/* Rows under a day heading, not a card per day. The heading already groups
                them; boxing them again adds a border that means nothing. */}
            <View style={styles.list}>
              {items.map((item) => (
                <View key={item.id}>
                  <View style={styles.listRow}>
                    <Touchable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.done }}
                      accessibilityLabel={`${item.title} at ${item.time}`}
                      onPress={() => void toggleCommitment(item.id)}
                      rippleColor={theme.surfaceStrong}
                      style={local.rowMain}
                    >
                      <View style={[styles.check, item.done && styles.checkDone]}>
                        {item.done ? <Icon as={Icons.check} size={14} color={theme.accentContrast} /> : null}
                      </View>
                      <View style={styles.listCopy}>
                        <Text numberOfLines={2} style={[styles.listTitle, item.done && styles.listDone]}>
                          {item.title}
                        </Text>
                      </View>
                      <Text style={styles.listTime}>{item.time}</Text>
                    </Touchable>

                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.title}`}
                      onPress={() => openEditor(item)}
                      rippleColor={theme.surfaceStrong}
                      borderless
                      expandHitSlop={8}
                      style={local.iconButton}
                    >
                      <Icon as={Icons.edit} size={IconSize.md} color={theme.subtle} />
                    </Touchable>

                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${item.title}`}
                      onPress={() => setDeleteId(deleteId === item.id ? null : item.id)}
                      rippleColor={theme.errorSurface}
                      borderless
                      expandHitSlop={8}
                      style={local.iconButton}
                    >
                      <Icon as={Icons.trash} size={IconSize.md} color={theme.subtle} />
                    </Touchable>
                  </View>

                  {deleteId === item.id ? (
                    <View style={local.deletePanel}>
                      <Text style={styles.cardDetail}>Delete this and cancel its reminder?</Text>
                      <View style={local.deleteActions}>
                        <Touchable
                          accessibilityRole="button"
                          accessibilityLabel="Keep this commitment"
                          onPress={() => setDeleteId(null)}
                          rippleColor={theme.surfaceStrong}
                          style={local.cancelDelete}
                        >
                          <Text style={local.cancelDeleteText}>Keep it</Text>
                        </Touchable>
                        <Touchable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${item.title} permanently`}
                          disabled={busy}
                          onPress={() => void remove(item.id)}
                          rippleColor={theme.background}
                          style={local.confirmDelete}
                        >
                          <Text style={local.confirmDeleteText}>Delete</Text>
                        </Touchable>
                      </View>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ))
      )}

      <Modal
        visible={editorOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !busy && setEditorOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
          <View style={local.modalHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              disabled={busy}
              onPress={() => setEditorOpen(false)}
              style={local.headerAction}
            >
              <Text style={local.headerActionText}>Cancel</Text>
            </Pressable>
            <Text style={styles.cardTitle}>{editingId ? 'Edit commitment' : 'New commitment'}</Text>
            <View style={{ width: 58 }} />
          </View>

          <ScrollView contentContainerStyle={local.editor} keyboardShouldPersistTaps="handled">
            <TextField
              label="What is it"
              value={title}
              onChangeText={setTitle}
              placeholder="Database Systems class"
              autoCapitalize="sentences"
              returnKeyType="done"
            />
            <Card>
              <Text style={styles.fieldLabel}>Date</Text>
              <AlarmDatePicker value={date} onChange={setDate} />
              <View style={{ marginTop: Spacing.lg }}>
                <Text style={styles.fieldLabel}>Time</Text>
                <AlarmTimePicker value={time} onChange={setTime} />
              </View>
            </Card>
            <Text style={[styles.cardDetail, { marginBottom: Spacing.lg }]}>
              This sends an ordinary reminder, so Silent and Do Not Disturb still apply. Wake alarms are separate.
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={local.error}>
                {error}
              </Text>
            ) : null}
            <PrimaryButton
              label={editingId ? 'Save changes' : 'Add it'}
              onPress={() => void save()}
              disabled={!title.trim()}
              busy={busy}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const makeLocal = (theme: Theme) =>
  StyleSheet.create({
    primaryAction: { alignSelf: 'flex-start', marginBottom: Spacing.xl },
    error: { ...Type.caption, color: theme.error, marginBottom: Spacing.md },
    group: { marginBottom: Spacing.xl },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    deletePanel: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      paddingBottom: Spacing.md,
      gap: Spacing.sm,
    },
    deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
    cancelDelete: { minHeight: 48, paddingHorizontal: Spacing.lg, justifyContent: 'center', overflow: 'hidden', borderRadius: Radius.tight },
    cancelDeleteText: { ...Type.action, color: theme.text },
    confirmDelete: {
      minHeight: 48,
      borderRadius: Radius.tight,
      paddingHorizontal: Spacing.xl,
      justifyContent: 'center',
      backgroundColor: theme.error,
      overflow: 'hidden',
    },
    confirmDeleteText: { ...Type.action, color: theme.accentContrast },
    modalHeader: {
      minHeight: 64,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      paddingHorizontal: Spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerAction: { width: 58, minHeight: 48, justifyContent: 'center' },
    headerActionText: { ...Type.action, color: theme.textSecondary },
    editor: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.xxxl,
    },
  });
