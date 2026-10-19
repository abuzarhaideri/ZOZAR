import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { Card, OptionRow, PrimaryButton, SectionHeader, useZOZARTheme } from './zo-zar-ui';
import { AlarmDatePicker, AlarmTimePicker, formatAlarmTime } from './alarm-time-picker';
import type { RepositoryCircleMember, RepositoryCommitment, RepositoryWakePlan, UiDifficulty } from './zo-zar-repository';
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
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
];

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

export function AlarmEditor({ initialValue, commitments, members, onSave, onPreviewSound }: { initialValue: AlarmEditorValue; commitments: RepositoryCommitment[]; members: RepositoryCircleMember[]; onSave: (value: AlarmEditorValue) => void | Promise<void>; onPreviewSound?: (soundKey: WakeSoundKey) => void | Promise<void> }) {
  const { theme, styles } = useZOZARTheme();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewUnavailable = Platform.OS === 'web';
  const trustedMembers = useMemo(() => members.filter((member) => member.status === 'Accepted'), [members]);
  const set = <K extends keyof AlarmEditorValue>(key: K, next: AlarmEditorValue[K]) => setValue((current) => ({ ...current, [key]: next }));
  const save = async () => {
    if (value.scheduleType === 'weekly' && value.weekdays.length === 0) { setError('Choose at least one weekday.'); return; }
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

  return <View>
    <SectionHeader kicker="Alarm editor" title="When should ZO-ZAR wake you?" />
    <Card>
      <Text style={styles.fieldLabel}>Time</Text>
      <AlarmTimePicker value={value.time} onChange={(next) => setValue((current) => ({ ...current, time: next, date: current.scheduleType === 'once' ? nextAvailableDateForTime(next) : current.date }))} />
      {value.scheduleType === 'once' && <View style={{ marginTop: 17 }}><Text style={styles.fieldLabel}>Date</Text><AlarmDatePicker value={value.date} onChange={(next) => set('date', next)} /></View>}
    </Card>

    <SectionHeader kicker="Sound" title="Choose what wakes you." />
    <View style={{ marginTop: 8 }}>
      <OptionRow label="Bright Rise" detail="A clear, loud melodic alarm." selected={value.soundKey === 'bright-rise'} onPress={() => set('soundKey', 'bright-rise')} />
      <OptionRow label="Steady Pulse" detail="A focused medium-high pulse." selected={value.soundKey === 'steady-pulse'} onPress={() => set('soundKey', 'steady-pulse')} />
      <OptionRow label="Summit Siren" detail="The strongest, very loud alarm." selected={value.soundKey === 'summit-siren'} onPress={() => set('soundKey', 'summit-siren')} />
      <OptionRow label="Android default" detail="Use the default alarm sound configured on this phone." selected={value.soundKey === 'default'} onPress={() => set('soundKey', 'default')} />
    </View>
    {onPreviewSound && <Pressable accessibilityRole="button" accessibilityLabel={previewUnavailable ? 'Alarm sound preview is available in the Android build' : `Test ${wakeSoundLabel(value.soundKey)} sound`} accessibilityState={{ disabled: previewing || previewUnavailable }} disabled={previewing || previewUnavailable} onPress={() => void preview()} style={({ pressed }) => [{ minHeight: 50, borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }, pressed && styles.pressed, (previewing || previewUnavailable) && styles.disabled]}><Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{previewUnavailable ? 'Sound preview needs the Android build' : previewing ? 'Scheduling sound test…' : `Hear ${wakeSoundLabel(value.soundKey)} in 10 seconds`}</Text></Pressable>}

    <Text style={styles.fieldLabel}>Repeat</Text>
    <View style={{ marginTop: 8 }}>
      <OptionRow label="One time" detail="A single wake on the date you choose." selected={value.scheduleType === 'once'} onPress={() => set('scheduleType', 'once')} />
      <OptionRow label="Daily" detail="Repeat every day at this time." selected={value.scheduleType === 'daily'} onPress={() => set('scheduleType', 'daily')} />
      <OptionRow label="Weekdays" detail="Choose the days that should ring." selected={value.scheduleType === 'weekly'} onPress={() => set('scheduleType', 'weekly')} />
    </View>
    {value.scheduleType === 'weekly' && <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
      {weekdayOptions.map((day) => { const selected = value.weekdays.includes(day.value); return <Pressable key={day.value} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${day.label}, ${selected ? 'selected' : 'not selected'}`} onPress={() => set('weekdays', selected ? value.weekdays.filter((item) => item !== day.value) : [...value.weekdays, day.value].sort((a, b) => a - b))} style={{ flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: selected ? theme.accent : theme.surfaceStrong, alignItems: 'center', justifyContent: 'center' }}><Text style={{ textAlign: 'center', color: selected ? theme.accentContrast : theme.text, fontSize: 12, fontWeight: '700' }}>{day.label}</Text></Pressable>; })}
    </View>}

    <SectionHeader kicker="Protection" title="Make the wake meaningful." />
    <Text style={styles.fieldLabel}>Link a commitment</Text>
    <View style={{ marginTop: 8 }}>
      <OptionRow label="No commitment" detail="Keep this wake independent." selected={value.commitmentId === null} onPress={() => set('commitmentId', null)} />
      {commitments.map((item) => <OptionRow key={item.id} label={item.title} detail={item.time} selected={value.commitmentId === item.id} onPress={() => set('commitmentId', item.id)} />)}
    </View>
    <Text style={styles.fieldLabel}>Trusted protection</Text>
    <View style={{ marginTop: 8 }}>
      <OptionRow label="No trusted person" detail="Only this phone will handle the wake." selected={value.trustedMemberId === null} onPress={() => set('trustedMemberId', null)} />
      {trustedMembers.map((member) => <OptionRow key={member.id} label={member.name} detail="Receive a missed-wake alert after the grace period." selected={value.trustedMemberId === member.id} onPress={() => set('trustedMemberId', member.id)} />)}
    </View>

    <Text style={styles.fieldLabel}>Challenge</Text>
    <View style={{ marginTop: 8 }}>
      {(['Easy', 'Medium', 'Hard'] as UiDifficulty[]).map((difficulty) => <OptionRow key={difficulty} label={difficulty} detail={difficulty === 'Easy' ? 'Solve two single-digit addition or subtraction problems.' : difficulty === 'Medium' ? 'Solve three two-digit addition or subtraction problems.' : 'Type a 30–40 word passage exactly.'} selected={value.difficulty === difficulty} onPress={() => set('difficulty', difficulty)} />)}
    </View>

    <Text style={styles.fieldLabel}>Grace period</Text>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 14 }}>
      {[5, 10, 15, 20].map((minutes) => <Pressable key={minutes} accessibilityRole="radio" accessibilityState={{ checked: value.graceMinutes === minutes }} onPress={() => set('graceMinutes', minutes)} style={{ flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: value.graceMinutes === minutes ? theme.accent : theme.surfaceStrong, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: value.graceMinutes === minutes ? theme.accentContrast : theme.text, textAlign: 'center', fontWeight: '700' }}>{minutes} min</Text></Pressable>)}
    </View>
    {error && <Text accessibilityRole="alert" style={{ color: theme.error, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>{error}</Text>}
    <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>This alarm uses the dedicated wake channel. Chat and trusted-person updates remain on non-bypassing channels.</Text>
    <PrimaryButton label={`Save for ${formatAlarmTime(value.time)}`} onPress={() => void save()} busy={saving} />
  </View>;
}
