import type {
  ChatThread,
  Circle,
  CircleMember,
  Commitment,
  DeviceToken,
  Message,
  NotificationDelivery,
  Profile,
  VoiceNote,
  WakeOccurrence,
  WakePlan,
} from './domain';

type Table<T> = {
  Row: T;
  Insert: Partial<Omit<T, 'created_at' | 'updated_at'>>;
  Update: Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>;
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      commitments: Table<Commitment>;
      wake_plans: Table<WakePlan>;
      wake_occurrences: Table<WakeOccurrence>;
      circles: Table<Circle>;
      circle_members: Table<CircleMember>;
      device_tokens: Table<DeviceToken>;
      chat_threads: Table<ChatThread>;
      messages: Table<Message>;
      voice_notes: Table<VoiceNote>;
      notification_deliveries: Table<NotificationDelivery>;
    };
    Functions: {
      [functionName: string]: {
        Args: Record<string, unknown>;
        Returns: unknown;
      };
    };
  };
}
