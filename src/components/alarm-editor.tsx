import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { ChevronUp } from 'lucide-react-native';

import { HearthRow, Icon, Icons, PrimaryButton, RowMark, SecondaryButton, useZOZARTheme } from './zo-zar-ui';
import { Touchable } from './motion';
import { AlarmDatePicker, AlarmTimePicker, formatAlarmTime } from './alarm-time-picker';
import type { RepositoryCircleMember, RepositoryCommitment, RepositoryWakePlan, UiDifficulty } from './zo-zar-repository';
import { IconSize, MinTarget, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { wakeSoundLabel } from '@/services/notification-service';
import type { WakeSoundKey } from '@/types/domain';

export type AlarmScheduleType = 'once' | 'daily' | 'weekly';

export type AlarmEditorValue = {
  scheduleType: AlarmScheduleType;
  date: Date;
  time: Date;
  weekdays: number[];
  difficulty: UiDifficulty;
  soundKey: WakeSoundKey;
  graceMinutes: number;
  commitmentId: string | null;
  trustedMemberId: string | null;
};

const weekdayOptions = [
  { value: 0, label: 'Sun', spoken: 'Sunday' },
  { value: 1, label: 'Mon', spoken: 'Monday' },
  { value: 2, label: 'Tue', spoken: 'Tuesday' },
  { value: 3, label: 'Wed', spoken: 'Wednesday' },
  { value: 4, label: 'Thu', spoken: 'Thursday' },
  { value: 5, label: 'Fri', spoken: 'Friday' },
  { value: 6, label: 'Sat', spoken: 'Saturday' },
];

const scheduleOptions: { value: AlarmScheduleType; label: string }[] = [
  { value: 'once', label: 'One time' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Chosen days' },
];

const soundOptions: { value: WakeSoundKey; detail: string }[] = [
  { value: 'bright-rise', detail: 'A clear, loud melodic alarm.' },
  { value: 'steady-pulse', detail: 'A focused medium-high pulse.' },
  { value: 'summit-siren', detail: 'The strongest, very loud alarm.' },
  { value: 'default', detail: 'The alarm sound set on this phone.' },
];

const difficultyDetail: Record<UiDifficulty, string> = {
  Easy: 'Solve two single-digit addition or subtraction problems.',
  Medium: 'Solve three two-digit addition or subtraction problems.',
  Hard: 'Type a 30 to 40 word passage exactly.',
};

const graceOptions = [5, 10, 15, 20];

const PERMISSION_ERROR = /permission|exact-alarm|notification|do not disturb|device/i;

function parseTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  const date = new Date();
  if (!match) { date.setHours(7, 0, 0, 0); return date; }
  let hour = Number(match[1]);
  if (match[3]?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  date.setHours(hour, Number(match[2]), 0, 0);
  return date;
}

/** Minutes of the day for a plan's display time ("7:00 AM" or "07:00"). */
export function planMinutes(time: string) {
  const parsed = parseTime(time);
  return parsed.getHours() * 60 + parsed.getMinutes();
}

function defaultScheduleType(plan: RepositoryWakePlan | null): AlarmScheduleType {
  return plan?.scheduleType ?? 'weekly';
}

function nextAvailableDateForTime(time: Date) {
  const date = new Date();
  date.setHours(time.getHours(), time.getMinutes(), 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function createAlarmEditorValue(plan: RepositoryWakePlan | null, commitments: RepositoryCommitment[], members: RepositoryCircleMember[]): AlarmEditorValue {
  const time = parseTime(plan?.time ?? '7:00 AM');
  const date = new Date();
  if (plan?.scheduledDate) {
    const [year, month, day] = plan.scheduledDate.split('-').map(Number);
    date.setFullYear(year, month - 1, day);
  } else return {
    scheduleType: defaultScheduleType(plan), date: nextAvailableDateForTime(time), time,
    weekdays: plan?.weekdays?.length ? plan.weekdays : [1, 2, 3, 4, 5], difficulty: plan?.difficulty ?? 'Medium',
    soundKey: plan?.soundKey === 'zo-zar' ? 'bright-rise' : plan?.soundKey ?? 'bright-rise', graceMinutes: plan?.graceMinutes ?? 10,
    commitmentId: plan?.commitmentId ?? null, trustedMemberId: members.find((item) => item.circleId === plan?.circleId)?.id ?? null,
  };
  date.setHours(0, 0, 0, 0);
  const weekdays = plan?.weekdays?.length ? plan.weekdays : [1, 2, 3, 4, 5];
  return {
    scheduleType: defaultScheduleType(plan),
    date,
    time,
    weekdays,
    difficulty: plan?.difficulty ?? 'Medium',
    soundKey: plan?.soundKey === 'zo-zar' ? 'bright-rise' : plan?.soundKey ?? 'bright-rise',
    graceMinutes: plan?.graceMinutes ?? 10,
    commitmentId: plan?.commitmentId ?? null,
    trustedMemberId: members.find((item) => item.circleId === plan?.circleId)?.id ?? null,
  };
}

export function alarmRepeatLabel(value: AlarmEditorValue) {
  if (value.scheduleType === 'once') return 'One time';
  if (value.scheduleType === 'daily') return 'Every day';
  if (value.weekdays.length === 7) return 'Every day';
  if (value.weekdays.join(',') === '1,2,3,4,5') return 'Every weekday';
  return value.weekdays.map((day) => weekdayOptions.find((item) => item.value === day)?.label).filter(Boolean).join(', ') || 'Choose days';
}

export function alarmScheduleDate(value: AlarmEditorValue) {
  const next = new Date(value.date.getTime());
  next.setHours(value.time.getHours(), value.time.getMinutes(), 0, 0);
  return next;
}

/** The next moment this configuration would ring, or null if it never would. */
function nextOccurrence(value: AlarmEditorValue, now = new Date()): Date | null {
  if (value.scheduleType === 'once') {
    const at = alarmScheduleDate(value);
    return at.getTime() > now.getTime() ? at : null;
  }
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now.getTime());
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(value.time.getHours(), value.time.getMinutes(), 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (value.scheduleType === 'daily' || value.weekdays.includes(candidate.getDay())) return candidate;
  }
  return null;
}

function describeDay(at: Date, now = new Date()) {
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `on ${at.toLocaleDateString([], { weekday: 'long' })}`;
  return `on ${at.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`;
}

/** A stable key for "has anything changed", comparing only what is saved. */
function valueKey(value: AlarmEditorValue) {
  const day = value.scheduleType === 'once' ? value.date.toDateString() : '';
  return [
    value.scheduleType,
    day,
    value.time.getHours(),
    value.time.getMinutes(),
    value.scheduleType === 'weekly' ? value.weekdays.join(',') : '',
    value.difficulty,
    value.soundKey,
    value.graceMinutes,
    value.commitmentId ?? '',
    value.trustedMemberId ?? '',
  ].join('|');
}

type Section = 'sound' | 'person' | 'grace' | 'challenge' | 'commitment';

export function AlarmEditor({
  initialValue,
  commitments,
  members,
  onSave,
  onPreviewSound,
  active = false,
  isNew = false,
  onDirtyChange,
  onReviewPermissions,
}: {
  initialValue: AlarmEditorValue;
  commitments: RepositoryCommitment[];
  members: RepositoryCircleMember[];
  onSave: (value: AlarmEditorValue) => void | Promise<void>;
  onPreviewSound?: (soundKey: WakeSoundKey) => void | Promise<void>;
  /** Whether the saved alarm is currently on. Only used to word the next-occurrence line. */
  active?: boolean;
  isNew?: boolean;
  /** Reports unsaved changes, so the sheet can ask before discarding them. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Shown beside an error that names a permission, so the fix is one tap away. */
  onReviewPermissions?: () => void;
}) {
  const { theme } = useZOZARTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Section | null>(null);
  const previewUnavailable = Platform.OS === 'web';
  const trustedMembers = useMemo(() => members.filter((member) => member.status === 'Accepted'), [members]);
  const pendingMembers = useMemo(() => members.filter((member) => member.status === 'Pending'), [members]);
  const set = <K extends keyof AlarmEditorValue>(key: K, next: AlarmEditorValue[K]) => setValue((current) => ({ ...current, [key]: next }));

  const initialKey = useRef(valueKey(initialValue)).current;
  const dirty = valueKey(value) !== initialKey;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (value.scheduleType === 'weekly' && value.weekdays.length === 0) { setError('Choose at least one day.'); return; }
    if (value.scheduleType === 'once' && alarmScheduleDate(value).getTime() <= Date.now()) { setError('Choose a future date and time.'); return; }
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The alarm could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (!onPreviewSound) return;
    setPreviewing(true);
    setError(null);
    try {
      await onPreviewSound(value.soundKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The alarm sound preview could not be scheduled.');
    } finally {
      setPreviewing(false);
    }
  };

  const toggle = (section: Section) => setOpen((current) => (current === section ? null : section));

  const trustedMember = trustedMembers.find((member) => member.id === value.trustedMemberId) ?? null;
  const commitment = commitments.find((item) => item.id === value.commitmentId) ?? null;
  const next = nextOccurrence(value);
  const nextLine = !next
    ? value.scheduleType === 'weekly'
      ? 'Choose at least one day for this alarm to ring.'
      : 'Choose a future date and time for this alarm to ring.'
    : `${describeDay(next)} at ${formatAlarmTime(next)}`;
  const nextSentence = !next
    ? nextLine
    : active
      ? `Next wake-up is ${nextLine}.`
      : isNew
        ? `New alarms start paused. Once you turn it on, the next wake-up is ${nextLine}.`
        : `This alarm is paused. Once you turn it on, the next wake-up is ${nextLine}.`;

  const sectionRow = (section: Section, title: string, detail: string, leading: ReactNode, last = false) => {
    const expanded = open === section;
    return (
      <HearthRow
        title={title}
        detail={detail}
        leading={leading}
        navigates={false}
        last={last && !expanded}
        onPress={() => toggle(section)}
        accessibilityLabel={`${title}, ${detail}, ${expanded ? 'expanded' : 'collapsed'}`}
        accessibilityHint={expanded ? 'Hides the choices' : 'Shows the choices'}
        trailing={<Icon as={expanded ? ChevronUp : Icons.chevronDown} size={IconSize.md} color={theme.subtle} />}
      />
    );
  };

  return (
    <View>
      <Text accessibilityRole="header" style={styles.title}>
        A time that works for you.
      </Text>

      <View style={styles.block}>
        <AlarmTimePicker
          value={value.time}
          onChange={(time) =>
            setValue((current) => ({
              ...current,
              time,
              date: current.scheduleType === 'once' ? nextAvailableDateForTime(time) : current.date,
            }))
          }
        />
        {value.scheduleType === 'once' ? (
          <View style={styles.dateGap}>
            <AlarmDatePicker value={value.date} onChange={(date) => set('date', date)} />
          </View>
        ) : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.groupLabel}>Repeat</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {scheduleOptions.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              role="radio"
              selected={value.scheduleType === option.value}
              onPress={() => set('scheduleType', option.value)}
              styles={styles}
              theme={theme}
            />
          ))}
        </View>
        {value.scheduleType === 'weekly' ? (
          <View style={[styles.chips, styles.weekdays]}>
            {weekdayOptions.map((day) => {
              const selected = value.weekdays.includes(day.value);
              return (
                <Chip
                  key={day.value}
                  label={day.label}
                  spoken={day.spoken}
                  role="checkbox"
                  compact
                  selected={selected}
                  onPress={() =>
                    set(
                      'weekdays',
                      selected
                        ? value.weekdays.filter((item) => item !== day.value)
                        : [...value.weekdays, day.value].sort((a, b) => a - b),
                    )
                  }
                  styles={styles}
                  theme={theme}
                />
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.block}>
        {sectionRow('sound', 'Alarm sound', wakeSoundLabel(value.soundKey), <RowMark icon={Icons.alarm} />)}
        {open === 'sound' ? (
          <View style={styles.panel} accessibilityRole="radiogroup">
            {soundOptions.map((option) => (
              <ChoiceRow
                key={option.value}
                label={wakeSoundLabel(option.value)}
                detail={option.detail}
                selected={value.soundKey === option.value}
                onPress={() => set('soundKey', option.value)}
                styles={styles}
                theme={theme}
              />
            ))}
            {onPreviewSound ? (
              <View style={styles.panelAction}>
                <SecondaryButton
                  icon={Icons.play}
                  label={
                    previewUnavailable
                      ? 'Sound preview needs the Android build'
                      : previewing
                        ? 'Scheduling the sound check'
                        : `Hear ${wakeSoundLabel(value.soundKey)} in 10 seconds`
                  }
                  disabled={previewing || previewUnavailable}
                  accessibilityHint="Plays the chosen sound once. Your saved alarm is not changed."
                  onPress={() => void preview()}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {sectionRow(
          'person',
          'Trusted person',
          trustedMember ? `${trustedMember.name} is told if you miss it` : 'Nobody is told if you miss it',
          trustedMember ? <RowMark letter={trustedMember.initials || trustedMember.name.charAt(0).toUpperCase()} /> : <RowMark icon={Icons.users} />,
        )}
        {open === 'person' ? (
          <View style={styles.panel} accessibilityRole="radiogroup">
            <ChoiceRow
              label="Nobody"
              detail="Only this phone handles the wake-up."
              selected={value.trustedMemberId === null}
              onPress={() => set('trustedMemberId', null)}
              styles={styles}
              theme={theme}
            />
            {trustedMembers.map((member) => (
              <ChoiceRow
                key={member.id}
                label={member.name}
                detail={`Gets a missed-wake alert after ${value.graceMinutes} minutes.`}
                selected={value.trustedMemberId === member.id}
                onPress={() => set('trustedMemberId', member.id)}
                styles={styles}
                theme={theme}
              />
            ))}
            {pendingMembers.length > 0 ? (
              <Text style={styles.panelNote}>
                {pendingMembers.length === 1
                  ? `${pendingMembers[0].name} has not accepted yet, so they cannot be told about this alarm.`
                  : `${pendingMembers.length} invitations have not been accepted yet. People appear here once they accept.`}
              </Text>
            ) : null}
            {trustedMembers.length === 0 && pendingMembers.length === 0 ? (
              <Text style={styles.panelNote}>
                Nobody has joined your circle yet. You can invite someone from People.
              </Text>
            ) : null}
          </View>
        ) : null}

        {sectionRow(
          'grace',
          'Grace period',
          trustedMember
            ? `${value.graceMinutes} minutes before ${trustedMember.name} is told`
            : `${value.graceMinutes} minutes to confirm you are up`,
          <RowMark icon={Icons.clock} />,
        )}
        {open === 'grace' ? (
          <View style={styles.panel}>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {graceOptions.map((minutes) => (
                <Chip
                  key={minutes}
                  label={`${minutes} min`}
                  spoken={`${minutes} minutes`}
                  role="radio"
                  selected={value.graceMinutes === minutes}
                  onPress={() => set('graceMinutes', minutes)}
                  styles={styles}
                  theme={theme}
                />
              ))}
            </View>
          </View>
        ) : null}

        {sectionRow('challenge', 'Wake challenge', value.difficulty, <RowMark icon={Icons.listChecks} />)}
        {open === 'challenge' ? (
          <View style={styles.panel} accessibilityRole="radiogroup">
            {(['Easy', 'Medium', 'Hard'] as UiDifficulty[]).map((difficulty) => (
              <ChoiceRow
                key={difficulty}
                label={difficulty}
                detail={difficultyDetail[difficulty]}
                selected={value.difficulty === difficulty}
                onPress={() => set('difficulty', difficulty)}
                styles={styles}
                theme={theme}
              />
            ))}
          </View>
        ) : null}

        {sectionRow(
          'commitment',
          'Linked commitment',
          commitment ? `${commitment.title}, ${commitment.time}` : 'None',
          <RowMark icon={Icons.sun} />,
          true,
        )}
        {open === 'commitment' ? (
          <View style={styles.panel} accessibilityRole="radiogroup">
            <ChoiceRow
              label="No commitment"
              detail="Keep this wake-up on its own."
              selected={value.commitmentId === null}
              onPress={() => set('commitmentId', null)}
              styles={styles}
              theme={theme}
            />
            {commitments.map((item) => (
              <ChoiceRow
                key={item.id}
                label={item.title}
                detail={item.time}
                selected={value.commitmentId === item.id}
                onPress={() => set('commitmentId', item.id)}
                styles={styles}
                theme={theme}
              />
            ))}
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
          {onReviewPermissions && PERMISSION_ERROR.test(error) ? (
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Review wake permissions"
              onPress={onReviewPermissions}
              rippleColor={theme.errorSurface}
              style={styles.errorAction}
            >
              <Text style={styles.errorActionText}>Review permissions</Text>
              <Icon as={Icons.chevronRight} size={IconSize.md} color={theme.error} />
            </Touchable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.saveBlock}>
        <Text style={styles.next}>{nextSentence}</Text>
        <PrimaryButton label="Save alarm" onPress={() => void save()} busy={saving} />
        <Text style={styles.channel}>
          This alarm uses its own wake channel. Chat and trusted-person updates use quieter channels.
        </Text>
      </View>
    </View>
  );
}

function Chip({
  label,
  spoken,
  role,
  selected,
  onPress,
  compact = false,
  styles,
  theme,
}: {
  label: string;
  spoken?: string;
  role: 'radio' | 'checkbox';
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <Touchable
      accessibilityRole={role}
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      rippleColor={theme.surfaceStrong}
      style={[styles.chip, compact && styles.chipCompact, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Touchable>
  );
}

function ChoiceRow({
  label,
  detail,
  selected,
  onPress,
  styles,
  theme,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      rippleColor={theme.surfaceStrong}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
        {detail ? <Text style={styles.choiceDetail}>{detail}</Text> : null}
      </View>
      {selected ? <Icon as={Icons.check} size={IconSize.md} color={theme.accent} /> : null}
    </Touchable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    title: { ...Type.title, color: theme.text, marginBottom: Spacing.xl },
    block: { marginBottom: Spacing.xl },
    dateGap: { marginTop: Spacing.md },
    groupLabel: { ...Type.label, color: theme.textSecondary, marginBottom: Spacing.sm },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    weekdays: { marginTop: Spacing.md },
    chip: {
      minHeight: MinTarget,
      flexGrow: 1,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.button,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    chipCompact: { minWidth: MinTarget, paddingHorizontal: Spacing.sm },
    chipSelected: { backgroundColor: theme.backgroundSelected },
    chipText: { ...Type.action, color: theme.text, textAlign: 'center' },
    chipTextSelected: { color: theme.accent },

    panel: {
      paddingVertical: Spacing.md,
      gap: Spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    panelAction: { marginTop: Spacing.sm },
    panelNote: { ...Type.caption, color: theme.textSecondary, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },

    choice: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      borderRadius: Radius.row,
      overflow: 'hidden',
    },
    choiceSelected: { backgroundColor: theme.backgroundSelected },
    choiceCopy: { flex: 1, minWidth: 0 },
    choiceLabel: { ...Type.callout, fontSize: 16, color: theme.text },
    choiceLabelSelected: { color: theme.accent },
    choiceDetail: { ...Type.caption, color: theme.textSecondary, marginTop: 2 },

    error: {
      backgroundColor: theme.errorSurface,
      borderRadius: Radius.row,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    errorText: { ...Type.callout, color: theme.error },
    errorAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MinTarget, alignSelf: 'flex-start' },
    errorActionText: { ...Type.action, color: theme.error },

    saveBlock: { gap: Spacing.md },
    next: { ...Type.body, color: theme.textSecondary },
    channel: { ...Type.caption, color: theme.subtle },
  });
