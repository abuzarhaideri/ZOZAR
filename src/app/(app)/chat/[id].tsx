import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Icon, Icons, RowMark, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { Touchable } from '@/components/motion';
import { IconSize, MaxContentWidth, MinTarget, Radius, Spacing, Type, type Theme } from '@/constants/theme';
import { createVoiceNotePlayer, VoiceNoteRecorder } from '@/services/voice-recorder-service';

export default function ChatRoute() {
  const { styles, theme } = useZOZARTheme();
  const chat = useMemo(() => makeChatStyles(theme), [theme]);
  const { messages, members, chatRetention, loadMessages, subscribeMessages, addMessage, addVoiceMessage, setChatRetention } = useZOZARStore();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const member = members.find((item) => item.id === id && item.status === 'Accepted');
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const recorder = useRef(new VoiceNoteRecorder()).current;
  const scroller = useRef<ScrollView>(null);
  const players = useRef(new Map<string, ReturnType<typeof createVoiceNotePlayer>>()).current;
  const send = async () => {
    if (!draft.trim() || !id || sending) return;
    const body = draft.trim();
    setSending(true); setError(null);
    try { await addMessage(id, body); setDraft(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The message could not be sent.'); }
    finally { setSending(false); }
  };
  const playVoice = (messageId: string, uri?: string) => {
    if (!uri) return;
    const player = players.get(messageId) ?? createVoiceNotePlayer(uri);
    players.set(messageId, player);
    player.seekTo(0);
    player.play();
  };
  const recordVoice = async () => { try { setError(null); if (!recording) { await recorder.start(); setRecordingSeconds(0); setRecording(true); } else if (id) { const artifact = await recorder.stop(); setRecording(false); await addVoiceMessage(id, artifact); } } catch (caught) { setRecording(false); setError(caught instanceof Error ? caught.message : 'The voice note could not be sent.'); } };
  const cancelVoice = async () => { await recorder.cancel(); setRecording(false); setRecordingSeconds(0); };
  useEffect(() => {
    if (id) void loadMessages(id).catch((caught) => setError(caught instanceof Error ? caught.message : 'Messages could not be loaded.'));
    // The store action is intentionally omitted: it is recreated when message state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!id) return undefined;
    let cleanup: (() => void) | undefined;
    let active = true;
    void subscribeMessages(id, () => { if (active) void loadMessages(id); }).then((next) => { if (active) cleanup = next; else next(); });
    return () => { active = false; cleanup?.(); };
    // These store actions are stable enough for one mounted chat and are intentionally keyed by chat id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => setRecordingSeconds((seconds) => {
      if (seconds >= 29) { void recordVoice(); return 30; }
      return seconds + 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => () => { void recorder.cancel(); players.forEach((player) => player.release()); players.clear(); }, [players, recorder]);
  const canSend = !!draft.trim() && !sending && !recording;
  const name = member?.name ?? 'Trusted person';
  return (
    <SafeAreaView style={[chat.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={chat.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={chat.column}>
          <View style={chat.topBar}>
            {/* Reached from both Tonight and People, so the label names no destination. */}
            <BackButton label="Back" />
            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Conversation settings"
              accessibilityHint="Choose how long messages last"
              onPress={() => setSettingsOpen(true)}
              rippleColor={theme.surfaceStrong}
              borderless
              style={chat.iconButton}
            >
              <Icon as={Icons.more} size={IconSize.lg} color={theme.textSecondary} />
            </Touchable>
          </View>

          <View style={chat.heading}>
            <Text accessibilityRole="header" style={chat.name} numberOfLines={2}>
              {name}
            </Text>
            <RowMark letter={member?.initials ?? '?'} />
          </View>
          {member?.detail ? <Text style={chat.detail}>{member.detail}</Text> : null}
          <View style={chat.privacy}>
            <Icon as={Icons.lock} size={IconSize.sm} color={theme.subtle} />
            <Text style={chat.privacyText}>
              Messages here disappear after {chatRetention === '7d' ? 'a week' : 'a month'}.
            </Text>
          </View>
        </View>

        <ScrollView
          ref={scroller}
          style={chat.flex}
          contentContainerStyle={chat.messages}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {messages.length === 0 ? (
            <View style={chat.empty}>
              <Text style={chat.emptyTitle}>No messages yet</Text>
              <Text style={chat.emptyDetail}>
                A short note now is easier than explaining yourself at 6am.
              </Text>
            </View>
          ) : null}

          {messages.map((message) => {
            if (message.kind === 'system') {
              return (
                <View key={message.id} style={chat.systemRow}>
                  <Text style={chat.systemText}>{message.body}</Text>
                </View>
              );
            }
            const mine = message.author === 'me';
            const who = mine ? 'You' : name;
            if (message.kind === 'voice') {
              return (
                <View key={message.id} style={[chat.voice, mine ? chat.voiceMine : chat.voiceTheirs]}>
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${message.body || 'voice note'} from ${who}, ${message.timestamp}`}
                    accessibilityState={{ disabled: !message.voiceUri }}
                    disabled={!message.voiceUri}
                    onPress={() => playVoice(message.id, message.voiceUri)}
                    rippleColor={theme.surfaceStrong}
                    borderless
                    style={chat.iconButton}
                  >
                    <Icon as={Icons.play} size={IconSize.md} color={theme.text} />
                  </Touchable>
                  <View style={chat.wave} accessible={false} importantForAccessibility="no-hide-descendants">
                    {WAVE.map((height, index) => (
                      <View key={index} style={[chat.waveBar, { height }]} />
                    ))}
                  </View>
                  <View style={chat.voiceMeta} accessible={false} importantForAccessibility="no-hide-descendants">
                    <Text style={chat.voiceText} numberOfLines={1}>
                      {message.body || 'Voice note'}
                    </Text>
                    <Text style={chat.time}>{message.timestamp}</Text>
                  </View>
                </View>
              );
            }
            return (
              <View
                key={message.id}
                accessible
                accessibilityLabel={`${who}: ${message.body}, ${message.timestamp}`}
                style={[chat.bubble, mine ? chat.bubbleMine : chat.bubbleTheirs]}
              >
                <Text style={chat.messageText}>{message.body}</Text>
                <Text style={chat.time}>{message.timestamp}</Text>
              </View>
            );
          })}
        </ScrollView>

        <View style={chat.column}>
          {error ? (
            <View style={chat.errorBox}>
              <Text accessibilityRole="alert" style={chat.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          {recording ? (
            <View style={chat.recordingRow}>
              {/* Not a live region: it changes every second and would talk over the Stop button. */}
              <Text style={chat.recordingText}>
                Recording, 0:{String(recordingSeconds).padStart(2, '0')} of 0:30
              </Text>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel="Discard this recording"
                onPress={() => void cancelVoice()}
                rippleColor={theme.surfaceStrong}
                style={chat.textAction}
              >
                <Text style={chat.textActionLabel}>Discard</Text>
              </Touchable>
            </View>
          ) : null}

          <View style={chat.composer}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Stop recording and send' : 'Record a voice note'}
              onPress={() => void recordVoice()}
              rippleColor={theme.surfaceStrong}
              style={[chat.recordButton, recording && chat.recordButtonActive]}
            >
              <Icon
                as={recording ? Icons.stop : Icons.mic}
                size={IconSize.md}
                color={recording ? theme.error : theme.text}
              />
            </Touchable>

            <TextInput
              accessibilityLabel="Message"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void send()}
              placeholder={recording ? 'Finish recording first' : 'A few kind words'}
              placeholderTextColor={theme.subtle}
              style={chat.input}
              multiline
              submitBehavior="submit"
              returnKeyType="send"
              editable={!recording && !sending}
            />

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend, busy: sending }}
              disabled={!canSend}
              onPress={() => void send()}
              rippleColor={theme.surfaceStrong}
              borderless
              style={chat.iconButton}
            >
              <Icon as={Icons.send} size={IconSize.lg} color={canSend ? theme.accent : theme.subtle} />
            </Touchable>
          </View>
        </View>

        <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close settings"
            style={[styles.accountOverlay, { backgroundColor: theme.scrim }]}
            onPress={() => setSettingsOpen(false)}
          >
            <Pressable style={styles.accountSheet} onPress={(event) => event.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <Text accessibilityRole="header" style={chat.sheetTitle}>
                How long messages last
              </Text>
              <Text style={styles.cardDetail}>
                This applies to both of you, and {name} is told when it changes. Messages already sent keep the
                expiry they were sent with.
              </Text>
              <View accessibilityRole="radiogroup" style={styles.appearanceGroup}>
                {(['7d', '30d'] as const).map((retention) => (
                  <Touchable
                    key={retention}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chatRetention === retention }}
                    accessibilityLabel={retention === '7d' ? 'A week' : 'A month'}
                    onPress={() => {
                      if (id)
                        void setChatRetention(id, retention)
                          .then(() => setSettingsOpen(false))
                          .catch((caught) =>
                            setError(caught instanceof Error ? caught.message : 'That could not be changed.'),
                          );
                    }}
                    rippleColor={theme.surfaceStrong}
                    style={[
                      styles.appearanceOption,
                      chatRetention === retention && { borderColor: theme.accent, backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <Text style={styles.optionLabel}>{retention === '7d' ? 'A week' : 'A month'}</Text>
                    {chatRetention === retention ? <Icon as={Icons.check} size={IconSize.md} color={theme.accent} /> : null}
                  </Touchable>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A static, decorative waveform. It is the same for every note: drawing real amplitude
 *  would need data the recorder does not keep, and a fake per-note shape would imply it. */
const WAVE = [7, 13, 22, 11, 27, 18, 8, 20, 26, 14, 8, 19, 25, 12, 7, 16, 22, 9];

const makeChatStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: { flex: 1 },
    flex: { flex: 1 },
    column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.xl },
    topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    iconButton: { minWidth: MinTarget, minHeight: MinTarget, alignItems: 'center', justifyContent: 'center' },
    heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
    name: { ...Type.title, color: theme.text, flexShrink: 1 },
    detail: { ...Type.body, color: theme.textSecondary, marginTop: Spacing.xs },
    privacy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, paddingBottom: Spacing.md },
    privacyText: { ...Type.caption, color: theme.subtle, flexShrink: 1 },

    messages: {
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.lg,
      gap: Spacing.md,
    },
    empty: { paddingVertical: Spacing.xxl, gap: Spacing.sm },
    emptyTitle: { ...Type.heading, color: theme.text },
    emptyDetail: { ...Type.body, color: theme.textSecondary, maxWidth: 320 },
    systemRow: { alignItems: 'center', marginVertical: Spacing.xs, paddingHorizontal: Spacing.xl },
    systemText: { ...Type.caption, color: theme.subtle, textAlign: 'center' },

    bubble: { maxWidth: '86%', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.xs },
    bubbleTheirs: {
      alignSelf: 'flex-start',
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 16,
      borderBottomLeftRadius: 3,
    },
    bubbleMine: {
      alignSelf: 'flex-end',
      borderWidth: 1,
      borderColor: theme.line,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 3,
      borderBottomLeftRadius: 16,
    },
    messageText: { ...Type.body, color: theme.text },
    time: { ...Type.caption, color: theme.subtle },

    voice: {
      maxWidth: '92%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: theme.surface,
      borderRadius: 16,
      paddingVertical: Spacing.xs,
      paddingLeft: Spacing.xs,
      paddingRight: Spacing.lg,
    },
    voiceTheirs: { alignSelf: 'flex-start' },
    voiceMine: { alignSelf: 'flex-end' },
    wave: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, overflow: 'hidden' },
    waveBar: { width: 3, borderRadius: 3, backgroundColor: theme.textSecondary },
    voiceMeta: { flexShrink: 0, maxWidth: 140 },
    voiceText: { ...Type.caption, color: theme.text },

    errorBox: { backgroundColor: theme.errorSurface, borderRadius: Radius.row, padding: Spacing.md, marginBottom: Spacing.sm },
    errorText: { ...Type.caption, color: theme.error },
    recordingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
    recordingText: { ...Type.callout, color: theme.error, flexShrink: 1 },
    textAction: { minHeight: MinTarget, justifyContent: 'center', paddingHorizontal: Spacing.sm },
    textActionLabel: { ...Type.action, color: theme.textSecondary },

    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingVertical: Spacing.md },
    recordButton: {
      width: MinTarget,
      height: MinTarget,
      borderRadius: Radius.row,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recordButtonActive: { backgroundColor: theme.errorSurface },
    input: {
      ...Type.body,
      flex: 1,
      minWidth: 0,
      minHeight: MinTarget,
      maxHeight: 140,
      color: theme.text,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.line,
      borderRadius: Radius.row,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      textAlignVertical: 'center',
    },
    sheetTitle: { ...Type.heading, color: theme.text },
  });
