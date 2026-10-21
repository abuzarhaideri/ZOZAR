import * as React from 'react';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useZOZARTheme } from './zo-zar-ui';
import { Touchable } from './motion';
import { MinTarget, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { clockParts, nowMinutes, usesTwelveHourClock } from '@/lib/time';

function cloneDate(value: Date) {
  return new Date(value.getTime());
}

/** The time as this phone writes it: "7:00 AM" on a 12-hour device, "07:00" otherwise. */
export function formatAlarmTime(value: Date) {
  return clockParts(nowMinutes(value)).spoken;
}

function updateTime(value: Date, hour12: number, minute: number, period: 'AM' | 'PM') {
  const next = cloneDate(value);
  let hour = hour12 % 12;
  if (period === 'PM') hour += 12;
  next.setHours(hour, minute, 0, 0);
  return next;
}

function longDay(value: Date) {
  return value.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Hearth's time field: the wake time set large on a soft surface, the way a bedside clock
 * shows it. The whole surface is the target, and it opens Android's own time dialog, so the
 * spinner, keyboard entry and TalkBack behaviour are the platform's rather than ours.
 */
export function AlarmTimePicker({
  value,
  onChange,
  label = 'Wake-up time',
}: {
  value: Date;
  onChange: (value: Date) => void;
  label?: string;
}) {
  const { theme } = useZOZARTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = React.useState(false);
  const parts = clockParts(nowMinutes(value));
  const hour = value.getHours() % 12 || 12;
  const minute = value.getMinutes();
  const period = value.getHours() >= 12 ? 'PM' : 'AM';

  const face = (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.clockLine}>
        <Text style={styles.clock}>{parts.digits}</Text>
        {parts.period ? <Text style={styles.period}>{parts.period}</Text> : null}
      </View>
    </>
  );

  if (Platform.OS !== 'web') {
    return (
      <View>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${parts.spoken}`}
          accessibilityHint="Opens the time picker"
          onPress={() => setOpen(true)}
          rippleColor={theme.surfaceStrong}
          style={styles.field}
        >
          {face}
          <Text style={styles.hint}>Tap to change the time</Text>
        </Touchable>
        {open && (
          <DateTimePicker
            value={value}
            mode="time"
            display="spinner"
            presentation="dialog"
            is24Hour={!usesTwelveHourClock()}
            accentColor={theme.accent}
            positiveButton={{ label: 'Set time' }}
            negativeButton={{ label: 'Cancel' }}
            onValueChange={(_, next) => {
              onChange(next);
              setOpen(false);
            }}
            onDismiss={() => setOpen(false)}
          />
        )}
      </View>
    );
  }

  // Development fallback only: there is no web product, but the route still renders in a
  // browser during local work, and the native dialog does not exist there.
  return (
    <View>
      <View accessible accessibilityLabel={`${label}, ${parts.spoken}`} style={styles.field}>
        {face}
        <Text style={styles.hint}>Choose a time below</Text>
      </View>
      <View style={styles.columns}>
        <ScrollView style={styles.column} contentContainerStyle={styles.columnContent}>
          {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
            <Choice
              key={item}
              label={String(item)}
              spoken={`Hour ${item}`}
              selected={item === hour}
              onPress={() => onChange(updateTime(value, item, minute, period))}
              styles={styles}
              theme={theme}
            />
          ))}
        </ScrollView>
        <ScrollView style={styles.column} contentContainerStyle={styles.columnContent}>
          {Array.from({ length: 60 }, (_, item) => item).map((item) => (
            <Choice
              key={item}
              label={String(item).padStart(2, '0')}
              spoken={`Minute ${String(item).padStart(2, '0')}`}
              selected={item === minute}
              onPress={() => onChange(updateTime(value, hour, item, period))}
              styles={styles}
              theme={theme}
            />
          ))}
        </ScrollView>
        <View style={[styles.columnContent, styles.periodColumn]}>
          {(['AM', 'PM'] as const).map((item) => (
            <Choice
              key={item}
              label={item}
              spoken={item}
              selected={item === period}
              onPress={() => onChange(updateTime(value, hour, minute, item))}
              styles={styles}
              theme={theme}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export function AlarmDatePicker({ value, onChange }: { value: Date; onChange: (value: Date) => void }) {
  const { theme } = useZOZARTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = React.useState(false);
  const minimumDate = new Date();
  minimumDate.setHours(0, 0, 0, 0);

  if (Platform.OS !== 'web') {
    return (
      <View>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`Date, ${longDay(value)}`}
          accessibilityHint="Opens the date picker"
          onPress={() => setOpen(true)}
          rippleColor={theme.surfaceStrong}
          style={styles.dateField}
        >
          <Text style={styles.fieldLabel}>Date</Text>
          <Text style={styles.dateText}>{longDay(value)}</Text>
          <Text style={styles.hint}>Tap to change the date</Text>
        </Touchable>
        {open && (
          <DateTimePicker
            value={value}
            mode="date"
            display="default"
            presentation="dialog"
            minimumDate={minimumDate}
            accentColor={theme.accent}
            positiveButton={{ label: 'Set date' }}
            negativeButton={{ label: 'Cancel' }}
            onValueChange={(_, next) => {
              onChange(next);
              setOpen(false);
            }}
            onDismiss={() => setOpen(false)}
          />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.dateList} contentContainerStyle={styles.columnContent}>
      {Array.from({ length: 45 }, (_, index) => {
        const next = cloneDate(minimumDate);
        next.setDate(minimumDate.getDate() + index);
        const label = next.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        return (
          <Choice
            key={next.toISOString()}
            label={label}
            spoken={label}
            selected={next.toDateString() === value.toDateString()}
            onPress={() => onChange(next)}
            styles={styles}
            theme={theme}
            alignStart
          />
        );
      })}
    </ScrollView>
  );
}

function Choice({
  label,
  spoken,
  selected,
  onPress,
  styles,
  theme,
  alignStart = false,
}: {
  label: string;
  spoken: string;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  alignStart?: boolean;
}) {
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={spoken}
      onPress={onPress}
      rippleColor={theme.surfaceStrong}
      style={[styles.choice, alignStart && styles.choiceStart, selected && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Touchable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    field: {
      backgroundColor: theme.surface,
      borderRadius: Radius.card,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xl,
      overflow: 'hidden',
    },
    fieldLabel: { ...Type.label, color: theme.textSecondary },
    clockLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, marginTop: Spacing.sm },
    clock: { ...Type.clock, color: theme.text },
    period: { ...Type.heading, color: theme.textSecondary },
    hint: { ...Type.caption, color: theme.subtle, marginTop: Spacing.sm },

    dateField: {
      backgroundColor: theme.surface,
      borderRadius: Radius.card,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
      overflow: 'hidden',
    },
    dateText: { ...Type.body, fontSize: 18, lineHeight: 26, color: theme.text, marginTop: Spacing.xs },

    columns: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
    column: { height: 168, flex: 1 },
    columnContent: { gap: Spacing.xs },
    periodColumn: { flex: 0.8 },
    dateList: { maxHeight: 212 },

    choice: {
      minHeight: MinTarget,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.row,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      overflow: 'hidden',
    },
    choiceStart: { alignItems: 'flex-start' },
    choiceSelected: { backgroundColor: theme.fill },
    choiceText: { ...Type.action, color: theme.text, fontVariant: ['tabular-nums'] },
    choiceTextSelected: { color: theme.onFill },
  });
