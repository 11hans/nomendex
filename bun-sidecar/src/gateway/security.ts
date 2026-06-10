import type { GatewayEvent } from "./types";

export type AllowlistMatch = "chatId" | "username" | null;

// chatId is the primary identity: Telegram usernames are mutable and can be
// re-registered by a different account, so a username-only match is weaker
// and callers should verify it against a previously seen chatId binding.
export function allowlistMatchType(chatId: string, username: string | undefined, allowlist: string[]): AllowlistMatch {
  if (allowlist.length === 0) return null;
  const normalized = new Set(
    allowlist
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => (item.startsWith("@") ? item.slice(1) : item)),
  );

  if (normalized.has(chatId.toLowerCase())) return "chatId";
  const user = username?.toLowerCase();
  if (user && normalized.has(user)) return "username";
  return null;
}

export function isAllowlisted(chatId: string, username: string | undefined, allowlist: string[]): boolean {
  return allowlistMatchType(chatId, username, allowlist) !== null;
}

export function evaluateTelegramSendPolicy(input: {
  enabled: boolean;
  autoReplyEnabled: boolean;
  allowlist: string[];
  chatId: string;
  username?: string;
}): { allowed: true } | { allowed: false; status: number; code: string; message: string } {
  if (!input.enabled) {
    return {
      allowed: false,
      status: 403,
      code: "TELEGRAM_DISABLED",
      message: "Telegram channel is disabled",
    };
  }

  if (!isAllowlisted(input.chatId, input.username, input.allowlist)) {
    return {
      allowed: false,
      status: 403,
      code: "TELEGRAM_NOT_ALLOWLISTED",
      message: "Telegram recipient is not allowlisted",
    };
  }

  return { allowed: true };
}

function safeChannelThreadPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const threadId = typeof payload.threadId === "string"
    ? payload.threadId
    : (
      payload.thread && typeof payload.thread === "object" && payload.thread
        && typeof (payload.thread as { id?: unknown }).id === "string"
        ? (payload.thread as { id: string }).id
        : undefined
    );
  const channel = typeof payload.channel === "string"
    ? payload.channel
    : (
      payload.thread && typeof payload.thread === "object" && payload.thread
        && typeof (payload.thread as { channel?: unknown }).channel === "string"
        ? (payload.thread as { channel: string }).channel
        : undefined
    );
  const updatedAt = payload.thread && typeof payload.thread === "object" && payload.thread
    && typeof (payload.thread as { updatedAt?: unknown }).updatedAt === "string"
    ? (payload.thread as { updatedAt: string }).updatedAt
    : undefined;

  const out: Record<string, unknown> = {};
  if (threadId) out.threadId = threadId;
  if (channel) out.channel = channel;
  if (updatedAt) out.updatedAt = updatedAt;
  return out;
}

export function redactGatewayEvent(event: GatewayEvent): GatewayEvent {
  if (event.id === "channel.message.received" || event.id === "channel.message.sent") {
    const threadId = typeof event.payload.threadId === "string"
      ? event.payload.threadId
      : (
        event.payload.message && typeof event.payload.message === "object" && event.payload.message
          && typeof (event.payload.message as { threadId?: unknown }).threadId === "string"
          ? (event.payload.message as { threadId: string }).threadId
          : undefined
      );
    const channel = event.payload.message && typeof event.payload.message === "object" && event.payload.message
      && typeof (event.payload.message as { channel?: unknown }).channel === "string"
      ? (event.payload.message as { channel: string }).channel
      : undefined;
    const role = event.payload.message && typeof event.payload.message === "object" && event.payload.message
      && typeof (event.payload.message as { role?: unknown }).role === "string"
      ? (event.payload.message as { role: string }).role
      : undefined;
    const direction = event.payload.message && typeof event.payload.message === "object" && event.payload.message
      && typeof (event.payload.message as { direction?: unknown }).direction === "string"
      ? (event.payload.message as { direction: string }).direction
      : undefined;
    const createdAt = event.payload.message && typeof event.payload.message === "object" && event.payload.message
      && typeof (event.payload.message as { createdAt?: unknown }).createdAt === "string"
      ? (event.payload.message as { createdAt: string }).createdAt
      : undefined;

    const payload: Record<string, unknown> = {};
    if (threadId) payload.threadId = threadId;
    if (channel) payload.channel = channel;
    if (role) payload.role = role;
    if (direction) payload.direction = direction;
    if (createdAt) payload.createdAt = createdAt;
    return { ...event, payload };
  }

  if (event.id === "channel.thread.updated") {
    return { ...event, payload: safeChannelThreadPayload(event.payload) };
  }

  return event;
}

