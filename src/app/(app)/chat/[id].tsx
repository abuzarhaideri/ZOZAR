import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Glyph, useZOZARTheme } from '@/components/zo-zar-ui';
import { useZOZARStore } from '@/components/zo-zar-store';
import { createVoiceNotePlayer, VoiceNoteRecorder } from '@/services/voice-recorder-service';

export default function ChatRoute() {
  const { styles, theme } = useZOZARTheme();
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
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.chatHeader}><Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Glyph style={styles.backGlyph}>←</Glyph></Pressable><View style={styles.personAvatar}><Text style={styles.personAvatarText}>{member?.initials ?? '?'}</Text></View><View style={styles.listCopy}><Text style={styles.chatName}>{member?.name ?? 'Trusted person'}</Text><Text style={styles.chatStatus}>{member?.detail ?? 'Wake support'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Chat settings" onPress={() => setSettingsOpen(true)} style={styles.backButton}><Glyph style={styles.chatHeaderIcon}>⋯</Glyph></Pressable></View>
    <View style={styles.chatPrivacy}><Glyph style={styles.helperGlyph}>⌁</Glyph><Text style={styles.chatPrivacyText}>Private · messages disappear after {chatRetention === '7d' ? '1 week' : '1 month'}</Text></View>
    <ScrollView contentContainerStyle={styles.chatMessages} keyboardShouldPersistTaps="handled">{messages.length === 0 && <View style={{ alignItems: 'center', paddingVertical: 28 }}><Text style={styles.cardTitle}>Start with something simple.</Text><Text style={[styles.cardDetail, { textAlign: 'center' }]}>A message or short voice note keeps wake support human.</Text></View>}{messages.map((message) => message.kind === 'system' ? <View key={message.id} style={{ alignItems: 'center', marginVertical: 10, paddingHorizontal: 28 }}><Text style={{ color: theme.muted, fontSize: 11, textAlign: 'center' }}>{message.body}</Text></View> : <View key={message.id} style={[styles.messageRow, message.author === 'me' && styles.messageRowMe]}><View style={[styles.messageBubble, message.author === 'me' ? { backgroundColor: theme.accent } : { backgroundColor: theme.surfaceStrong }]}>{message.kind === 'voice' ? <Pressable accessibilityRole="button" accessibilityLabel="Play voice note" onPress={() => playVoice(message.id, message.voiceUri)} style={styles.voiceBubble}><Glyph style={[styles.voiceIcon, { color: message.author === 'me' ? theme.accentContrast : theme.text }]}>▶</Glyph><Text style={[styles.voiceText, { color: message.author === 'me' ? theme.accentContrast : theme.text }]}>{message.body || 'Voice note'}</Text></Pressable> : <Text style={[styles.messageText, { color: message.author === 'me' ? theme.accentContrast : theme.text }]}>{message.body}</Text>}<Text style={[styles.messageTime, { color: message.author === 'me' ? theme.accentContrast : theme.muted }]}>{message.timestamp}</Text></View></View>)}</ScrollView>
    {error && <View style={[styles.voiceShell, { backgroundColor: theme.errorSurface }]}><Text accessibilityRole="alert" style={[styles.voiceShellText, { color: theme.error }]}>{error}</Text></View>}
    {recording && <View style={styles.voiceShell}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={[styles.voiceShellText, { color: theme.error }]}>Recording · 0:{String(recordingSeconds).padStart(2, '0')}</Text><Pressable accessibilityRole="button" onPress={() => void cancelVoice()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.muted, fontWeight: '700' }}>Cancel</Text></Pressable></View></View>}
    <View style={styles.composerBar}><Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Stop and send voice note' : 'Record voice note'} onPress={() => void recordVoice()} style={[styles.recordButton, recording && { backgroundColor: theme.error }]}><Glyph style={[styles.recordIcon, recording && { color: theme.inverseText }]}>{recording ? '■' : '●'}</Glyph></Pressable><TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} onSubmitEditing={() => void send()} placeholder={recording ? 'Finish recording to send' : 'Write a message'} placeholderTextColor={theme.subtle} style={styles.chatInput} returnKeyType="send" editable={!recording && !sending} /><Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !draft.trim() || sending }} disabled={!draft.trim() || sending} onPress={() => void send()} style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}><Glyph style={styles.sendGlyph}>↑</Glyph></Pressable></View>
    <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}><Pressable style={[styles.accountOverlay, { backgroundColor: 'rgba(0,0,0,0.56)' }]} onPress={() => setSettingsOpen(false)}><Pressable style={styles.accountSheet} onPress={(event) => event.stopPropagation()}><View style={styles.sheetHandle} /><Text style={styles.accountTitle}>Chat privacy</Text><Text style={[styles.cardDetail, { marginTop: 6 }]}>Messages disappear after</Text><View style={styles.appearanceGroup}>{(['7d', '30d'] as const).map((retention) => <Pressable key={retention} accessibilityRole="radio" accessibilityState={{ checked: chatRetention === retention }} onPress={() => { if (id) void setChatRetention(id, retention).then(() => setSettingsOpen(false)).catch((caught) => setError(caught instanceof Error ? caught.message : 'Chat settings could not be changed.')); }} style={styles.appearanceOption}><Text style={{ color: theme.text, fontWeight: '700' }}>{retention === '7d' ? '1 week' : '1 month'}</Text><Text style={{ color: chatRetention === retention ? theme.accent : theme.muted, fontSize: 22 }}>{chatRetention === retention ? '●' : '○'}</Text></Pressable>)}</View><Text style={[styles.cardDetail, { fontSize: 12 }]}>This setting is shared. Your trusted person will see a system message when it changes. Existing messages keep their original expiry.</Text></Pressable></Pressable></Modal>
  </KeyboardAvoidingView></SafeAreaView>;
}
