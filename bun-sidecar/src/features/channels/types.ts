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

export type ChannelEvent = {
  type: "event";
  id:
    | "channel.message.received"
    | "channel.message.sent"
    | "channel.thread.updated"
    | "channel.status.changed"
    | "channel.backlog.drained";
  payload: Record<string, unknown>;
  timestamp: number;
};
