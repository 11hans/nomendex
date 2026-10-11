import { z } from "zod";

export type ChannelId = "app" | "telegram";

export type UnifiedThread = {
  id: string;
  channel: ChannelId;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  preview?: string;
  sessionId?: string;
  externalChatId?: string;
  externalUsername?: string;
};

export type UnifiedMessage = {
  id: string;
  threadId: string;
  channel: ChannelId;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  source: "telegram" | "app";
  direction?: "inbound" | "outbound";
  externalMessageId?: string;
  externalChatId?: string;
};

export type ChannelsSettings = {
  telegram: {
    enabled: boolean;
    tokenSecretKey: string;
    allowlist: string[];
    timeZone: string;
    pollingTimeoutSec: number;
  };
};

export type PublicChannelsSettings = {
  telegram: Omit<ChannelsSettings["telegram"], "tokenSecretKey"> & {
    hasToken: boolean;
  };
};

export type ChannelStatus = {
  channel: ChannelId;
  running: boolean;
  connected: boolean;
  lastError: string | null;
  updatedAt: string;
};

export type ChannelsDebugStatus = {
  status: ChannelStatus;
  telegram: {
    enabled: boolean;
    hasToken: boolean;
    allowlistSize: number;
    timeZone: string;
    pollingTimeoutSec: number;
    lastUpdateId: number;
    telegramThreadCount: number;
  };
};

export type GatewayEvent = {
  id:
    | "channel.message.received"
    | "channel.message.sent"
    | "channel.thread.updated"
    | "channel.status.changed"
    | "channel.backlog.drained";
  payload: Record<string, unknown>;
};

export type TelegramInboundMessage = {
  updateId: number;
  chatId: string;
  username?: string;
  // Message text, or the caption of a photo (may be empty for a photo without
  // caption and for unsupported messages).
  text: string;
  messageId: string;
  timestampMs: number;
  // What the message carries: text and photos are captured to Inbox,
  // everything else (voice, stickers, files, ...) is rejected with a reply.
  kind: "text" | "photo" | "unsupported";
  photoFileId?: string;
};

// Zod schemas for API input validation

// Telegram rejects messages over 4096 characters, and unbounded input would
// flow into the append-only messages log.
export const TelegramSendSchema = z.object({
  threadId: z.string().max(256).optional(),
  chatId: z.string().max(64).optional(),
  text: z.string().min(1).max(4096),
});

export const ChannelsSettingsPatchSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().optional(),
    allowlist: z.array(z.string().min(1).max(64)).max(100).optional(),
    timeZone: z.string().max(64).optional(),
  }).strict().optional(),
}).strict();

export type ChannelsSettingsPatch = z.infer<typeof ChannelsSettingsPatchSchema>;

export const DEFAULT_CHANNELS_SETTINGS: ChannelsSettings = {
  telegram: {
    enabled: false,
    tokenSecretKey: "TELEGRAM_BOT_TOKEN",
    allowlist: [],
    timeZone: "Europe/Prague",
    pollingTimeoutSec: 25,
  },
};
