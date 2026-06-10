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
    autoReplyEnabled: boolean;
    telegramAgentId: string;
    fallbackText: string;
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
    autoReplyEnabled: boolean;
    allowlistSize: number;
    timeZone: string;
    pollingTimeoutSec: number;
    lastUpdateId: number;
    telegramThreadCount: number;
  };
  ai: {
    hasClaudeOauthToken: boolean;
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
  text: string;
  messageId: string;
  timestampMs: number;
};

// Zod schemas for API input validation

export const TelegramSendSchema = z.object({
  threadId: z.string().optional(),
  chatId: z.string().optional(),
  text: z.string().min(1),
});

export const TelegramAiReplySchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().optional(),
});

export const ChannelsSettingsPatchSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().optional(),
    autoReplyEnabled: z.boolean().optional(),
    allowlist: z.array(z.string()).optional(),
    telegramAgentId: z.string().optional(),
    timeZone: z.string().optional(),
    fallbackText: z.string().optional(),
  }).strict().optional(),
}).strict();

export type ChannelsSettingsPatch = z.infer<typeof ChannelsSettingsPatchSchema>;

export const DEFAULT_CHANNELS_SETTINGS: ChannelsSettings = {
  telegram: {
    enabled: false,
    tokenSecretKey: "TELEGRAM_BOT_TOKEN",
    allowlist: [],
    autoReplyEnabled: false,
    telegramAgentId: "default",
    fallbackText: "Omlouvam se, nastala chyba. Zkus to prosim znovu za chvili.",
    timeZone: "Europe/Prague",
    pollingTimeoutSec: 25,
  },
};
