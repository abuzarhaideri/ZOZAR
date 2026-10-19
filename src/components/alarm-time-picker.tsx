import * as React from 'react';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useZOZARTheme } from './zo-zar-ui';

function cloneDate(value: Date) {
  return new Date(value.getTime());
}

export function formatAlarmTime(value: Date) {
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function updateTime(value: Date, hour12: number, minute: number, period: 'AM' | 'PM') {
  const next = cloneDate(value);
  let hour = hour12 % 12;
  if (period === 'PM') hour += 12;
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function AlarmTimePicker({ value, onChange }: { value: Date; onChange: (value: Date) => void }) {
  const { theme } = useZOZARTheme();
  const [open, setOpen] = React.useState(false);
  const hour = value.getHours() % 12 || 12;
  const minute = value.getMinutes();
  const period = value.getHours() >= 12 ? 'PM' : 'AM';

  if (Platform.OS !== 'web') {
    return <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose wake time" onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 8, padding: 14, backgroundColor: theme.background }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>{formatAlarmTime(value)}</Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>Open the native Android time picker</Text>
      </Pressable>
      {open && <DateTimePicker
        value={value}
        mode="time"
        display="spinner"
        presentation="dialog"
        is24Hour={false}
        accentColor={theme.accent}
        positiveButton={{ label: 'Set time' }}
        negativeButton={{ label: 'Cancel' }}
        onValueChange={(_, next) => { onChange(next); setOpen(false); }}
        onDismiss={() => setOpen(false)}
      />}
    </View>;
  }

  return <View>
    <View accessible accessibilityLabel={`Selected time ${formatAlarmTime(value)}`} style={{ borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 8, padding: 14, backgroundColor: theme.background }}>
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>{formatAlarmTime(value)}</Text>
      <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>Choose a time below</Text>
    </View>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
      <ScrollView style={{ height: 148, flex: 1 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: item === hour }} accessibilityLabel={`Hour ${item}`} onPress={() => onChange(updateTime(value, item, minute, period))} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: item === hour ? theme.accent : theme.surfaceStrong }}><Text style={{ color: item === hour ? theme.accentContrast : theme.text, textAlign: 'center', fontWeight: '700' }}>{item}</Text></Pressable>)}
      </ScrollView>
      <ScrollView style={{ height: 148, flex: 1 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator>
        {Array.from({ length: 60 }, (_, item) => item).map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: item === minute }} accessibilityLabel={`Minute ${String(item).padStart(2, '0')}`} onPress={() => onChange(updateTime(value, hour, item, period))} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: item === minute ? theme.accent : theme.surfaceStrong }}><Text style={{ color: item === minute ? theme.accentContrast : theme.text, textAlign: 'center', fontWeight: '700' }}>{String(item).padStart(2, '0')}</Text></Pressable>)}
      </ScrollView>
      <View style={{ gap: 6, flex: 0.8 }}>
        {(['AM', 'PM'] as const).map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: item === period }} accessibilityLabel={item} onPress={() => onChange(updateTime(value, hour, minute, item))} style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: item === period ? theme.accent : theme.surfaceStrong }}><Text style={{ color: item === period ? theme.accentContrast : theme.text, textAlign: 'center', fontWeight: '700' }}>{item}</Text></Pressable>)}
      </View>
    </View>
  </View>;
}

export function AlarmDatePicker({ value, onChange }: { value: Date; onChange: (value: Date) => void }) {
  const { theme } = useZOZARTheme();
  const [open, setOpen] = React.useState(false);
  const minimumDate = new Date();
  minimumDate.setHours(0, 0, 0, 0);

  if (Platform.OS !== 'web') {
    return <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose wake date" onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 8, padding: 14, backgroundColor: theme.background }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{value.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>Open the native Android date picker</Text>
      </Pressable>
      {open && <DateTimePicker
        value={value}
        mode="date"
        display="default"
        presentation="dialog"
        minimumDate={minimumDate}
        accentColor={theme.accent}
        positiveButton={{ label: 'Set date' }}
        negativeButton={{ label: 'Cancel' }}
        onValueChange={(_, next) => { onChange(next); setOpen(false); }}
        onDismiss={() => setOpen(false)}
      />}
    </View>;
  }

  return <ScrollView style={{ maxHeight: 188 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator>
    {Array.from({ length: 45 }, (_, index) => {
      const next = cloneDate(minimumDate);
      next.setDate(minimumDate.getDate() + index);
      const selected = next.toDateString() === value.toDateString();
      const label = next.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      return <Pressable key={next.toISOString()} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={() => onChange(next)} style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center', backgroundColor: selected ? theme.accent : theme.surfaceStrong }}><Text style={{ color: selected ? theme.accentContrast : theme.text, fontWeight: '700' }}>{label}</Text></Pressable>;
    })}
  </ScrollView>;
}
