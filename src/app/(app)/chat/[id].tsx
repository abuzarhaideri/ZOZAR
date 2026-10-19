import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Icons, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { Touchable } from '@/components/motion';
import { IconSize, Spacing, Type, type Theme } from '@/constants/theme';
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
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.chatHeader}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            rippleColor={theme.surfaceStrong}
            borderless
            expandHitSlop={8}
            style={chat.headerButton}
          >
            <Icon as={Icons.back} size={IconSize.lg} color={theme.text} />
          </Touchable>
          <View style={styles.personAvatar}>
            <Text style={styles.personAvatarText}>{member?.initials ?? '?'}</Text>
          </View>
          <View style={styles.listCopy}>
            <Text style={styles.chatName}>{member?.name ?? 'Trusted person'}</Text>
            <Text style={styles.chatStatus}>{member?.detail ?? 'Watches out for you'}</Text>
          </View>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Conversation settings"
            onPress={() => setSettingsOpen(true)}
            rippleColor={theme.surfaceStrong}
            borderless
            expandHitSlop={8}
            style={chat.headerButton}
          >
            <Icon as={Icons.more} size={IconSize.lg} color={theme.subtle} />
          </Touchable>
        </View>

        <View style={styles.chatPrivacy}>
          <Icon as={Icons.lock} size={IconSize.sm} color={theme.subtle} />
          <Text style={styles.chatPrivacyText}>
            Messages here disappear after {chatRetention === '7d' ? 'a week' : 'a month'}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.chatMessages} keyboardShouldPersistTaps="handled">
          {messages.length === 0 ? (
            <View style={chat.empty}>
              <Text style={styles.cardTitle}>No messages yet</Text>
              <Text style={chat.emptyDetail}>
                A short note now is easier than explaining yourself at 6am.
              </Text>
            </View>
          ) : null}

          {messages.map((message) =>
            message.kind === 'system' ? (
              <View key={message.id} style={chat.systemRow}>
                <Text style={chat.systemText}>{message.body}</Text>
              </View>
            ) : (
              <View key={message.id} style={[styles.messageRow, message.author === 'me' && styles.messageRowMe]}>
                <View
                  style={[
                    styles.messageBubble,
                    { backgroundColor: message.author === 'me' ? theme.accent : theme.surfaceStrong },
                  ]}
                >
                  {message.kind === 'voice' ? (
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel="Play this voice note"
                      onPress={() => playVoice(message.id, message.voiceUri)}
                      rippleColor={theme.background}
                      style={styles.voiceBubble}
                    >
                      <Icon
                        as={Icons.play}
                        size={IconSize.sm}
                        color={message.author === 'me' ? theme.accentContrast : theme.text}
                      />
                      <Text
                        style={[
                          styles.voiceText,
                          { color: message.author === 'me' ? theme.accentContrast : theme.text },
                        ]}
                      >
                        {message.body || 'Voice note'}
                      </Text>
                    </Touchable>
                  ) : (
                    <Text
                      style={[
                        styles.messageText,
                        { color: message.author === 'me' ? theme.accentContrast : theme.text },
                      ]}
                    >
                      {message.body}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.messageTime,
                      { color: message.author === 'me' ? theme.accentContrast : theme.subtle },
                    ]}
                  >
                    {message.timestamp}
                  </Text>
                </View>
              </View>
            ),
          )}
        </ScrollView>

        {error ? (
          <View style={[styles.voiceShell, { backgroundColor: theme.errorSurface }]}>
            <Text accessibilityRole="alert" style={[styles.voiceShellText, { color: theme.error }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {recording ? (
          <View style={styles.voiceShell}>
            <View style={chat.recordingRow}>
              <Text style={chat.recordingText}>
                Recording, 0:{String(recordingSeconds).padStart(2, '0')}
              </Text>
              <Touchable
                accessibilityRole="button"
                accessibilityLabel="Discard this recording"
                onPress={() => void cancelVoice()}
                rippleColor={theme.surfaceStrong}
                style={chat.cancelRecording}
              >
                <Text style={chat.cancelRecordingText}>Discard</Text>
              </Touchable>
            </View>
          </View>
        ) : null}

        <View style={styles.composerBar}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording and send' : 'Record a voice note'}
            onPress={() => void recordVoice()}
            rippleColor={theme.background}
            style={[styles.recordButton, recording && { backgroundColor: theme.error }]}
          >
            <Icon
              as={recording ? Icons.stop : Icons.mic}
              size={IconSize.md}
              color={recording ? theme.accentContrast : theme.text}
            />
          </Touchable>

          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            placeholder={recording ? 'Finish recording first' : 'Write a message'}
            placeholderTextColor={theme.subtle}
            style={styles.chatInput}
            returnKeyType="send"
            editable={!recording && !sending}
          />

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() || sending }}
            disabled={!draft.trim() || sending}
            onPress={() => void send()}
            rippleColor={theme.accentContrast}
            style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}
          >
            <Icon as={Icons.send} size={IconSize.md} color={theme.accentContrast} />
          </Touchable>
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
              <Text style={styles.accountTitle}>How long messages last</Text>
              <Text style={styles.cardDetail}>
                This applies to both of you, and your trusted person is told when it changes. Messages already sent
                keep the expiry they were sent with.
              </Text>
              <View style={styles.appearanceGroup}>
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

const makeChatStyles = (theme: Theme) =>
  StyleSheet.create({
    headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
    emptyDetail: { ...Type.body, color: theme.textSecondary, textAlign: 'center', maxWidth: 280 },
    systemRow: { alignItems: 'center', marginVertical: Spacing.sm, paddingHorizontal: Spacing.xxl },
    systemText: { ...Type.caption, color: theme.subtle, textAlign: 'center' },
    recordingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    recordingText: { ...Type.caption, color: theme.error },
    cancelRecording: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm },
    cancelRecordingText: { ...Type.action, color: theme.textSecondary },
  });
