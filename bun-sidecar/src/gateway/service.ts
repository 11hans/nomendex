import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { SessionRegistry } from "./session-registry";
import {
  appendTelegramMessage,
  compactTelegramMessagesFile,
  findTelegramThread,
  listTelegramMessages,
  loadChannelsSettings,
  loadTelegramState,
  loadTelegramThreads,
  saveChannelsSettings,
  saveTelegramState,
  upsertTelegramThread,
} from "./storage";
import { ChannelManager } from "./channel-manager";
import { GatewayHttpError } from "./errors";
import { allowlistMatchType, evaluateTelegramSendPolicy, redactGatewayEvent } from "./security";
import { CAPTURE_REPLY_FAILED, CAPTURE_REPLY_SAVED, CAPTURE_REPLY_UNSUPPORTED, PHOTO_MAX_BYTES, captureToInbox } from "./inbox-capture";
import { listAppThreadMessages, listAppThreads } from "./app-sessions";
import type {
  ChannelStatus,
  ChannelsDebugStatus,
  ChannelsSettings,
  ChannelsSettingsPatch,
  GatewayEvent,
  PublicChannelsSettings,
  TelegramInboundMessage,
  UnifiedMessage,
  UnifiedThread,
} from "./types";

const gatewayLogger = createServiceLogger("GATEWAY");

type ThreadFilter = {
  channel?: "all" | "app" | "telegram";
  query?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function threadMatchesQuery(thread: UnifiedThread, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    thread.title.toLowerCase().includes(needle)
    || (thread.preview || "").toLowerCase().includes(needle)
    || (thread.externalChatId || "").toLowerCase().includes(needle)
    || (thread.externalUsername || "").toLowerCase().includes(needle)
  );
}

class GatewayService {
  private initialized = false;
  private readonly subscribers = new Set<(event: GatewayEvent) => void>();
  private pendingBacklogCount = 0;

  private readonly channelManager = new ChannelManager({
    getSettings: async () => loadChannelsSettings(),
    getLastUpdateId: async () => (await loadTelegramState()).lastUpdateId,
    setLastUpdateId: async (updateId) => saveTelegramState({ lastUpdateId: updateId }),
    onTelegramMessage: async (message) => this.handleTelegramInbound(message),
    onStatusChange: (status) => {
      this.emit({
        id: "channel.status.changed",
        payload: { status },
      });
    },
  });

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await compactTelegramMessagesFile();
    await this.channelManager.start();
    this.initialized = true;
  }

  async reinitialize(): Promise<void> {
    await compactTelegramMessagesFile();
    await this.channelManager.reload();
    this.initialized = true;
  }

  subscribe(handler: (event: GatewayEvent) => void): () => void {
    this.subscribers.add(handler);

    if (this.pendingBacklogCount > 0) {
      handler({
        id: "channel.backlog.drained",
        payload: { count: this.pendingBacklogCount },
      });
      this.pendingBacklogCount = 0;
    }

    return () => {
      this.subscribers.delete(handler);
    };
  }

  getStatus(): ChannelStatus {
    return this.channelManager.getStatus();
  }

  async getDebugStatus(): Promise<ChannelsDebugStatus> {
    const settings = await loadChannelsSettings();
    const telegramState = await loadTelegramState();
    const token = await secrets.get(settings.telegram.tokenSecretKey);
    const threads = await loadTelegramThreads();
    return {
      status: this.getStatus(),
      telegram: {
        enabled: settings.telegram.enabled,
        hasToken: !!token,
        allowlistSize: settings.telegram.allowlist.length,
        timeZone: settings.telegram.timeZone,
        pollingTimeoutSec: settings.telegram.pollingTimeoutSec,
        lastUpdateId: telegramState.lastUpdateId,
        telegramThreadCount: threads.length,
      },
    };
  }

  async getSettings(): Promise<PublicChannelsSettings> {
    const settings = await loadChannelsSettings();
    const token = await secrets.get(settings.telegram.tokenSecretKey);
    const { tokenSecretKey: _tokenKey, ...publicTelegram } = settings.telegram;
    return {
      telegram: {
        ...publicTelegram,
        hasToken: !!token,
      },
    };
  }

  async updateSettings(patch: ChannelsSettingsPatch): Promise<PublicChannelsSettings> {
    const current = await loadChannelsSettings();
    const next: ChannelsSettings = {
      telegram: {
        ...current.telegram,
        ...(patch.telegram || {}),
        allowlist: Array.isArray(patch.telegram?.allowlist)
          ? patch.telegram.allowlist
          : current.telegram.allowlist,
      },
    };

    await saveChannelsSettings(next);
    await this.channelManager.reload();
    return this.getSettings();
  }

  async listThreads(filter: ThreadFilter = {}): Promise<UnifiedThread[]> {
    const channel = filter.channel || "all";
    const query = filter.query?.trim();

    const threads: UnifiedThread[] = [];

    if (channel === "all" || channel === "app") {
      const appThreads = await listAppThreads(query);
      threads.push(...appThreads);
    }

    if (channel === "all" || channel === "telegram") {
      const telegramThreads = await loadTelegramThreads();
      if (!query) {
        threads.push(...telegramThreads);
      } else {
        const matched: UnifiedThread[] = [];
        for (const thread of telegramThreads) {
          if (threadMatchesQuery(thread, query)) {
            matched.push(thread);
            continue;
          }

          const messages = await listTelegramMessages(thread.id);
          const hasTextMatch = messages.some((message) => message.text.toLowerCase().includes(query.toLowerCase()));
          if (hasTextMatch) matched.push(thread);
        }
        threads.push(...matched);
      }
    }

    return threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getThreadMessages(threadId: string): Promise<UnifiedMessage[]> {
    if (threadId.startsWith("app:")) {
      return listAppThreadMessages(threadId);
    }

    return listTelegramMessages(threadId);
  }

  async sendTelegramMessage(input: {
    threadId?: string;
    chatId?: string;
    text: string;
  }): Promise<UnifiedMessage> {
    const text = input.text.trim();
    if (!text) {
      throw new GatewayHttpError(400, "TELEGRAM_TEXT_REQUIRED", "Message text is required");
    }

    let thread: UnifiedThread | null = null;
    if (input.threadId) {
      thread = await findTelegramThread(input.threadId);
      if (!thread) {
        throw new GatewayHttpError(404, "TELEGRAM_THREAD_NOT_FOUND", "Telegram thread not found");
      }
    }

    const inputChatId = input.chatId?.trim();
    if (thread?.externalChatId && inputChatId && thread.externalChatId !== inputChatId) {
      throw new GatewayHttpError(
        409,
        "TELEGRAM_THREAD_CHAT_MISMATCH",
        "Provided chatId does not match the selected Telegram thread",
      );
    }

    const chatId = inputChatId || thread?.externalChatId;

    if (!chatId) {
      throw new GatewayHttpError(400, "TELEGRAM_CHAT_REQUIRED", "chatId is required");
    }

    const settings = await loadChannelsSettings();
    const policy = evaluateTelegramSendPolicy({
      enabled: settings.telegram.enabled,
      allowlist: settings.telegram.allowlist,
      chatId,
      username: thread?.externalUsername,
    });
    if (!policy.allowed) {
      throw new GatewayHttpError(policy.status, policy.code, policy.message);
    }

    const sendResult = await this.channelManager.sendTelegram(chatId, text);

    if (!thread) {
      const registry = new SessionRegistry(settings.telegram.timeZone);
      const threadId = registry.telegramDmKey(chatId);
      thread = {
        id: threadId,
        channel: "telegram",
        title: `DM ${chatId}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messageCount: 0,
        externalChatId: chatId,
      };
    }

    const message: UnifiedMessage = {
      id: randomId("telegram-out"),
      threadId: thread.id,
      channel: "telegram",
      role: "assistant",
      text,
      createdAt: nowIso(),
      source: "telegram",
      direction: "outbound",
      externalMessageId: sendResult.messageId,
      externalChatId: chatId,
    };

    await appendTelegramMessage(message);

    const updatedThread: UnifiedThread = {
      ...thread,
      updatedAt: message.createdAt,
      messageCount: thread.messageCount + 1,
      preview: text.slice(0, 200),
      externalChatId: chatId,
    };

    await upsertTelegramThread(updatedThread);

    this.emit({
      id: "channel.message.sent",
      payload: { threadId: updatedThread.id, message },
    });
    this.emit({
      id: "channel.thread.updated",
      payload: { thread: updatedThread },
    });

    return message;
  }

  private async handleTelegramInbound(message: TelegramInboundMessage): Promise<void> {
    const settings = await loadChannelsSettings();

    // Drop non-allowlisted senders at ingestion: nothing is persisted or
    // emitted for them, so strangers cannot fill storage or surface in the UI.
    const allowlistMatch = allowlistMatchType(message.chatId, message.username, settings.telegram.allowlist);
    if (!allowlistMatch) {
      gatewayLogger.warn("Dropped Telegram message from non-allowlisted sender", {
        chatId: message.chatId,
        hasUsername: !!message.username,
      });
      return;
    }

    // Username-only matches are weaker: Telegram usernames can be released and
    // re-registered by someone else. If this username was previously seen with
    // a different chatId, treat the sender as an impostor and drop the message.
    if (allowlistMatch === "username" && message.username) {
      const knownThreads = await loadTelegramThreads();
      const needle = message.username.toLowerCase();
      const bound = knownThreads.find(
        (t) => t.externalChatId && t.externalUsername?.toLowerCase() === needle,
      );
      if (bound && bound.externalChatId !== message.chatId) {
        gatewayLogger.warn("Dropped Telegram message: allowlisted username arrived from a different chatId (possible username takeover)", {
          chatId: message.chatId,
        });
        return;
      }
    }

    const registry = new SessionRegistry(settings.telegram.timeZone);
    const threadId = registry.telegramDmKey(message.chatId, new Date(message.timestampMs));

    // Photos without caption and unsupported messages have no text; the
    // thread log still records that something arrived.
    const logText = message.text || (message.kind === "photo" ? "[fotka]" : "[nepodporovaná zpráva]");

    const existing = await findTelegramThread(threadId);
    const thread: UnifiedThread = {
      id: threadId,
      channel: "telegram",
      title: message.username ? `@${message.username}` : `DM ${message.chatId}`,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: new Date(message.timestampMs).toISOString(),
      messageCount: (existing?.messageCount || 0) + 1,
      preview: logText.slice(0, 200),
      externalChatId: message.chatId,
      externalUsername: message.username,
    };

    const unifiedMessage: UnifiedMessage = {
      id: randomId("telegram-in"),
      threadId,
      channel: "telegram",
      role: "user",
      text: logText,
      createdAt: new Date(message.timestampMs).toISOString(),
      source: "telegram",
      direction: "inbound",
      externalMessageId: message.messageId,
      externalChatId: message.chatId,
    };

    await appendTelegramMessage(unifiedMessage);
    await upsertTelegramThread(thread);

    this.emit({
      id: "channel.message.received",
      payload: {
        threadId,
        message: unifiedMessage,
      },
    });
    this.emit({
      id: "channel.thread.updated",
      payload: {
        thread,
      },
    });

    const reply = await this.captureInbound(message);
    try {
      await this.sendTelegramMessage({ threadId, text: reply });
    } catch (error) {
      gatewayLogger.error("Failed to send Telegram capture reply", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Writes the message to Inbox and returns the reply for the sender. No agent
  // and no tools run here: the bot is a capture channel, not a remote shell.
  private async captureInbound(message: TelegramInboundMessage): Promise<string> {
    if (message.kind === "unsupported") return CAPTURE_REPLY_UNSUPPORTED;

    try {
      const todo = await captureToInbox(
        message,
        (fileId) => this.channelManager.downloadTelegramFile(fileId, PHOTO_MAX_BYTES),
      );
      gatewayLogger.info("Captured Telegram message to Inbox", { todoId: todo.id, kind: message.kind });
      return CAPTURE_REPLY_SAVED;
    } catch (error) {
      gatewayLogger.error("Failed to capture Telegram message to Inbox", {
        kind: message.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      return CAPTURE_REPLY_FAILED;
    }
  }

  private emit(event: GatewayEvent): void {
    const redactedEvent = redactGatewayEvent(event);

    if (this.subscribers.size === 0 && redactedEvent.id === "channel.message.received") {
      this.pendingBacklogCount += 1;
      return;
    }

    for (const subscriber of this.subscribers) {
      subscriber(redactedEvent);
    }
  }
}

export const gatewayService = new GatewayService();
