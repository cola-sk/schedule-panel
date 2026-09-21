export interface RotationMember {
  name: string;
  openId?: string;
}

export interface BotConfig {
  id: string;
  name: string;
  webhookUrl?: string;
  enabled: boolean;
}

export interface PublicBotConfig {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  webhookMasked: string;
}

export interface ReminderSchedule {
  id: string;
  name: string;
  botId: string;
  type?: "rotation_reminder" | "weekly_report" | string;
  documentId?: string;
  sourceDocumentId?: string;
  targetFolderId?: string;
  titleTemplate?: string;
  dayOfWeek: number; // 1 (Mon) to 7 (Sun)
  time: string; // HH:mm
  timezone: string;
  enabled: boolean;
  rotationStartAt?: string;
  currentIndex: number;
  rotation: RotationMember[];
  postponedDates?: string[];
  hostOverrides?: Record<string, RotationMember & { isSwapped?: boolean }>;
  lastSentAt?: string;
}

export interface ReminderTask {
  id: string;
  scheduleId: string;
  scheduleName: string;
  host: RotationMember;
  isOverridden?: boolean;
  isSwapped?: boolean;
  scheduledAt: string;
  status: "pending" | "sent" | "failed" | "postponed";
  triggerType?: "scheduled" | "manual";
  sentAt?: string;
  error?: string;
  botId?: string;
  botName?: string;
  content?: string;
}

export type FeishuMessagePayload = {
  msg_type: "post" | "interactive" | "text";
  content?: Record<string, unknown>;
  card?: Record<string, unknown>;
};
