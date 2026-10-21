import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlarmDatePicker, AlarmTimePicker, formatAlarmTime } from '@/components/alarm-time-picker';
import { Touchable } from '@/components/motion';
import { useZOZARStore, type Commitment } from '@/components/zo-zar-store';
import {
  BackButton,
  HearthRow,
  Icons,
  PrimaryButton,
  RowMark,
  Screen,
  SecondaryButton,
  TextField,
  useZOZARTheme,
} from '@/components/zo-zar-ui';
import { Radius, Spacing, Type, type Theme } from '@/constants/theme';

/**
 * The days after tonight, in the Hearth direction.
 *
 * Each day is a heading over a short run of quiet rows. A row is one target: tap marks it
 * done in place (it recedes but stays, so it can be undone), long press opens the editor.
 * Delete lives inside that editor next to the fields it destroys, behind a confirmation
 * that names what is lost. Nothing animates when a row changes; it simply updates.
 */

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

/** "Today" and "Tomorrow" beat a date whenever they apply; those are the two days people
 *  are actually planning, and a weekday name makes them do arithmetic. */
function dateHeading(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (dateKey(iso) === dateKey(today.toISOString())) return 'Today';
  if (dateKey(iso) === dateKey(tomorrow.toISOString())) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date);
}

export default function PlanRoute() {
  const { theme } = useZOZARTheme();
  const local = useMemo(() => makeStyles(theme), [theme]);
  const {
    commitments,
    toggleCommitment,
    addCommitment,
    updateCommitment,
    deleteCommitment,
    hydrationError,
    retryHydration,
    isHydrating,
  } = useZOZARStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const days = useMemo(() => {
    const groups = commitments.reduce<Record<string, Commitment[]>>((result, item) => {
      const key = dateKey(item.startsAt);
      (result[key] ??= []).push(item);
      return result;
    }, {});
    return Object.values(groups)
      // `time` is a display string; startsAt is the real instant, so order by that.
      .map((items) => items.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()))
      .sort((a, b) => new Date(a[0]!.startsAt).getTime() - new Date(b[0]!.startsAt).getTime());
  }, [commitments]);

  async function toggle(id: string) {
    setError(null);
    try {
      await toggleCommitment(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That commitment could not be updated.');
    }
  }

  function openEditor(item?: Commitment) {
    setError(null);
    setConfirmingDelete(false);
    setEditingId(item?.id ?? null);
    setTitle(item?.title ?? '');
    const start = item ? new Date(item.startsAt) : initialDate();
    setDate(start);
    setTime(start);
    setEditorOpen(true);
  }

  /** Cancelling drops any validation error, so it does not reappear on the list behind. */
  function closeEditor() {
    setError(null);
    setConfirmingDelete(false);
    setEditorOpen(false);
  }

  async function save() {
    const startsAt = mergeDateTime(date, time);
    if (!title.trim()) {
      setError('Name this commitment.');
      return;
    }
    if (startsAt.getTime() <= Date.now()) {
      setError('Choose a future date and time.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) await updateCommitment(editingId, title.trim(), startsAt);
      else await addCommitment(title.trim(), formatAlarmTime(time), startsAt);
      setEditorOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The commitment could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCommitment(editingId);
      setEditorOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The commitment could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {/* Reached from Tonight, not a tab, so it carries its own way back. */}
      <BackButton label="Tonight" />

      <View style={local.intro}>
        <Text accessibilityRole="header" style={local.title}>
          The days ahead.
        </Text>
        <Text style={local.lede}>
          Things you need to be up for. Tap one to mark it done, hold it to change it.
        </Text>
      </View>

      {hydrationError ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Your plan could not be refreshed. Try again."
          accessibilityState={{ busy: isHydrating }}
          onPress={() => void retryHydration()}
          rippleColor={theme.errorSurface}
          style={local.notice}
        >
          <Text style={local.noticeTitle}>Your plan could not be refreshed</Text>
          <Text style={local.noticeDetail}>
            {hydrationError} {isHydrating ? 'Retrying…' : 'Tap to try again.'}
          </Text>
        </Touchable>
      ) : null}

      {error && !editorOpen ? (
        <Text accessibilityRole="alert" style={local.error}>
          {error}
        </Text>
      ) : null}

      {days.length === 0 ? (
        <View style={local.emptyBlock}>
          <Text style={local.emptyTitle}>Nothing planned yet</Text>
          <Text style={local.empty}>
            Add something you need to be up for, like a class or an early shift, and it will sit
            here under its day.
          </Text>
        </View>
      ) : (
        days.map((items) => (
          <View key={dateKey(items[0]!.startsAt)} style={local.day}>
            <Text accessibilityRole="header" style={local.dayHeading}>
              {dateHeading(items[0]!.startsAt)}
            </Text>
            <View style={local.dayRows}>
              {items.map((item, index) => (
                <HearthRow
                  key={item.id}
                  title={item.title}
                  detail={item.done ? `${item.time}, done` : item.time}
                  leading={<RowMark icon={item.done ? Icons.check : Icons.clock} />}
                  navigates={false}
                  dimmed={item.done}
                  last={index === items.length - 1}
                  onPress={() => void toggle(item.id)}
                  onLongPress={() => openEditor(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.done }}
                  accessibilityLabel={`${item.title} at ${item.time}`}
                  accessibilityHint="Double tap to mark done or not done. Edit and delete are in the actions menu."
                  actions={[{ name: 'edit', label: `Edit ${item.title}`, run: () => openEditor(item) }]}
                />
              ))}
            </View>
          </View>
        ))
      )}

      <View style={local.add}>
        <SecondaryButton
          label="Add a commitment"
          icon={Icons.plus}
          onPress={() => openEditor()}
          accessibilityHint="Opens the commitment editor"
        />
      </View>

      <Modal
        visible={editorOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !busy && closeEditor()}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['top', 'bottom', 'left', 'right']}>
          <View style={local.modalHeader}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              disabled={busy}
              onPress={closeEditor}
              rippleColor={theme.surfaceStrong}
              style={local.headerAction}
            >
              <Text style={local.headerCancel}>Cancel</Text>
            </Touchable>
            <Text accessibilityRole="header" style={local.modalTitle}>
              {editingId ? 'Edit commitment' : 'New commitment'}
            </Text>
            {/* Balances Cancel so the title stays centred; the one save action is below. */}
            <View style={local.headerAction} />
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

            <View style={local.field}>
              <Text style={local.fieldLabel}>Date</Text>
              <AlarmDatePicker value={date} onChange={setDate} />
            </View>

            <View style={local.field}>
              <Text style={local.fieldLabel}>Time</Text>
              <AlarmTimePicker value={time} onChange={setTime} />
            </View>

            <Text style={local.caveat}>
              This sends an ordinary reminder, so Silent and Do Not Disturb still apply. Wake alarms
              are separate.
            </Text>

            {error ? (
              <Text accessibilityRole="alert" style={local.error}>
                {error}
              </Text>
            ) : null}

            {/* Disabled, not just quiet, while a delete is in flight so the two cannot race. */}
            <PrimaryButton
              label={editingId ? 'Save changes' : 'Save commitment'}
              disabled={!title.trim() || busy}
              busy={busy && !confirmingDelete}
              onPress={() => void save()}
            />

            {/*
              Delete lives here rather than on the row, beside the fields it destroys. It
              is also the only place the consequence can be stated accurately, because
              only here is it clear which commitment is meant.
            */}
            {editingId ? (
              confirmingDelete ? (
                <View style={local.deleteConfirm}>
                  <Text style={local.deleteQuestion}>
                    Delete “{title.trim() || 'this commitment'}” and cancel its reminder?
                  </Text>
                  <View style={local.deleteRow}>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel="Keep this commitment"
                      onPress={() => setConfirmingDelete(false)}
                      rippleColor={theme.surfaceStrong}
                      style={local.textAction}
                    >
                      <Text style={local.keepText}>Keep it</Text>
                    </Touchable>
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel="Delete this commitment permanently"
                      accessibilityState={{ busy }}
                      disabled={busy}
                      onPress={() => void remove()}
                      rippleColor={theme.errorSurface}
                      style={local.textAction}
                    >
                      <Text style={local.deleteText}>{busy ? 'Deleting…' : 'Delete'}</Text>
                    </Touchable>
                  </View>
                </View>
              ) : (
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Delete this commitment"
                  onPress={() => setConfirmingDelete(true)}
                  rippleColor={theme.errorSurface}
                  style={local.textAction}
                >
                  <Text style={local.deleteText}>Delete this commitment</Text>
                </Touchable>
              )
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
    title: { ...Type.title, color: theme.text },
    lede: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.sm, maxWidth: 440 },
    emptyBlock: { paddingTop: Spacing.xxl, gap: Spacing.sm },
    emptyTitle: { ...Type.heading, color: theme.text },
    empty: { ...Type.body, color: theme.textSecondary, maxWidth: 440 },
    error: { ...Type.caption, color: theme.error, marginTop: Spacing.md },

    notice: {
      borderWidth: 1,
      borderColor: theme.error,
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.row,
      padding: Spacing.lg,
      marginTop: Spacing.lg,
    },
    noticeTitle: { ...Type.callout, color: theme.error },
    noticeDetail: { ...Type.caption, color: theme.textSecondary, marginTop: Spacing.xs },

    day: { marginTop: Spacing.xxl },
    dayHeading: { ...Type.heading, color: theme.text },
    dayRows: { marginTop: Spacing.sm },
    add: { marginTop: Spacing.xxl },

    modalHeader: {
      minHeight: 64,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      paddingHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalTitle: { ...Type.callout, color: theme.text },
    headerAction: { minWidth: 64, minHeight: 48, justifyContent: 'center' },
    headerCancel: { ...Type.action, color: theme.textSecondary },

    editor: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.xxxl,
      gap: Spacing.xl,
    },
    field: { gap: Spacing.sm },
    fieldLabel: { ...Type.label, color: theme.textSecondary },
    caveat: { ...Type.caption, color: theme.subtle },

    deleteConfirm: { gap: Spacing.sm },
    deleteQuestion: { ...Type.callout, color: theme.text },
    deleteRow: { flexDirection: 'row', gap: Spacing.xl },
    textAction: { minHeight: 48, justifyContent: 'center' },
    keepText: { ...Type.action, color: theme.textSecondary },
    deleteText: { ...Type.action, color: theme.error },
  });
