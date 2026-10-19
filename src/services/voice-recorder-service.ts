import {
  AudioModule,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Platform } from 'react-native';

export const MAX_VOICE_NOTE_SECONDS = 30;

export type VoiceNoteArtifact = {
  uri: string;
  durationSeconds: number;
  mimeType: 'audio/mp4';
  fileName: string;
};

export type VoiceNoteUploadAdapter<TResult = unknown> = {
  upload: (artifact: VoiceNoteArtifact) => Promise<TResult>;
};

export type VoiceNotePlayer = ReturnType<typeof createAudioPlayer>;

/** Creates a player for a local recording or a backend-provided audio URL. */
export function createVoiceNotePlayer(uri: string): VoiceNotePlayer {
  return createAudioPlayer(uri, { downloadFirst: true });
}

export class VoiceNoteRecorder {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private startedAt = 0;

  async start(): Promise<void> {
    if (Platform.OS === 'web') {
      throw new Error('Voice notes require an Android or iOS development build.');
    }

    const current = await getRecordingPermissionsAsync();
    const permission = current.granted ? current : await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('Microphone permission is required.');

    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      interruptionMode: 'doNotMix',
    });

    const recorder = new AudioModule.AudioRecorder({
      ...RecordingPresets.HIGH_QUALITY,
      directory: 'document',
    });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: MAX_VOICE_NOTE_SECONDS });
    this.recorder = recorder;
    this.startedAt = Date.now();
  }

  async stop(): Promise<VoiceNoteArtifact> {
    if (!this.recorder) throw new Error('No voice note is currently recording.');
    const recorder = this.recorder;
    await recorder.stop();
    const uri = recorder.uri;
    const durationSeconds = Math.min(
      MAX_VOICE_NOTE_SECONDS,
      Math.max(0, Math.round((Date.now() - this.startedAt) / 1000))
    );
    this.recorder = null;
    this.startedAt = 0;
    if (!uri) throw new Error('The recorder stopped without producing an audio file.');

    return {
      uri,
      durationSeconds,
      mimeType: 'audio/mp4',
      fileName: `zo-zar-voice-${Date.now()}.m4a`,
    };
  }

  async cancel(): Promise<void> {
    if (!this.recorder) return;
    await this.recorder.stop();
    this.recorder = null;
    this.startedAt = 0;
  }

  get isRecording(): boolean {
    return this.recorder?.isRecording ?? false;
  }
}

export function uploadVoiceNote<TResult>(
  artifact: VoiceNoteArtifact,
  adapter: VoiceNoteUploadAdapter<TResult>
): Promise<TResult> {
  return adapter.upload(artifact);
}
