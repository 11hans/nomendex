import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { SessionRegistry } from "./session-registry";
import {
  appendTelegramMessage,
  findTelegramThread,
  getLatestTelegramInboundText,
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
import { generateTelegramReply } from "./ai";
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

// Auto-replies are rate limited per chat so a message flood cannot trigger an
// agent query (and an outbound Telegram send) for every inbound message.
// Manual sends and explicit AI replies from the UI are not limited.
const AUTO_REPLY_MIN_INTERVAL_MS = 30_000;

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
  private readonly lastAutoReplyAtByChat = new Map<string, number>();

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
    await this.channelManager.start();
    this.initialized = true;
  }

  async reinitialize(): Promise<void> {
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
    const claudeRaw = await secrets.get("CLAUDE_CODE_OAUTH_TOKEN");
    const claudeTrimmed = claudeRaw?.trim() || "";
    const threads = await loadTelegramThreads();
    return {
      status: this.getStatus(),
      telegram: {
        enabled: settings.telegram.enabled,
        hasToken: !!token,
        autoReplyEnabled: settings.telegram.autoReplyEnabled,
        allowlistSize: settings.telegram.allowlist.length,
        timeZone: settings.telegram.timeZone,
        pollingTimeoutSec: settings.telegram.pollingTimeoutSec,
        lastUpdateId: telegramState.lastUpdateId,
        telegramThreadCount: threads.length,
      },
      ai: {
        hasClaudeOauthToken: !!claudeTrimmed,
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
    source: "manual" | "ai";
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
      autoReplyEnabled: settings.telegram.autoReplyEnabled,
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

  async aiReplyTelegram(input: { threadId: string; prompt?: string }): Promise<{ text: string; fallbackUsed: boolean }> {
    const settings = await loadChannelsSettings();
    const thread = await findTelegramThread(input.threadId);
    if (!thread || !thread.externalChatId) {
      throw new GatewayHttpError(404, "TELEGRAM_THREAD_NOT_FOUND", "Telegram thread not found");
    }

    // The send policy must be evaluated before the agent runs, not only inside
    // sendTelegramMessage — a disabled channel or de-allowlisted sender must
    // not be able to trigger an agent query (tokens + tool execution).
    const policy = evaluateTelegramSendPolicy({
      enabled: settings.telegram.enabled,
      autoReplyEnabled: settings.telegram.autoReplyEnabled,
      allowlist: settings.telegram.allowlist,
      chatId: thread.externalChatId,
      username: thread.externalUsername,
    });
    if (!policy.allowed) {
      throw new GatewayHttpError(policy.status, policy.code, policy.message);
    }

    // input.prompt is operator input from the app UI and is trusted; without
    // it the prompt falls back to the latest inbound Telegram text, which is
    // untrusted and gets framed as data before reaching the agent.
    const operatorPrompt = input.prompt?.trim();
    const prompt = operatorPrompt || await getLatestTelegramInboundText(input.threadId);
    if (!prompt) {
      throw new GatewayHttpError(400, "TELEGRAM_PROMPT_REQUIRED", "No prompt available for AI reply");
    }

    let replyText = "";
    let fallbackUsed = false;

    try {
      replyText = await generateTelegramReply(prompt, settings.telegram.telegramAgentId, {
        untrusted: !operatorPrompt,
      });
      if (!replyText.trim()) {
        fallbackUsed = true;
        replyText = settings.telegram.fallbackText;
      }
    } catch (error) {
      gatewayLogger.error("Telegram AI reply failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      fallbackUsed = true;
      replyText = settings.telegram.fallbackText;
    }

    await this.sendTelegramMessage({
      threadId: input.threadId,
      text: replyText,
      source: "ai",
    });

    return {
      text: replyText,
      fallbackUsed,
    };
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

    const existing = await findTelegramThread(threadId);
    const thread: UnifiedThread = {
      id: threadId,
      channel: "telegram",
      title: message.username ? `@${message.username}` : `DM ${message.chatId}`,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: new Date(message.timestampMs).toISOString(),
      messageCount: (existing?.messageCount || 0) + 1,
      preview: message.text.slice(0, 200),
      externalChatId: message.chatId,
      externalUsername: message.username,
    };

    const unifiedMessage: UnifiedMessage = {
      id: randomId("telegram-in"),
      threadId,
      channel: "telegram",
      role: "user",
      text: message.text,
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

    const shouldAutoReply = settings.telegram.autoReplyEnabled
      && evaluateTelegramSendPolicy({
        enabled: settings.telegram.enabled,
        autoReplyEnabled: settings.telegram.autoReplyEnabled,
        allowlist: settings.telegram.allowlist,
        chatId: message.chatId,
        username: message.username,
      }).allowed;

    if (shouldAutoReply) {
      const lastReplyAt = this.lastAutoReplyAtByChat.get(message.chatId) || 0;
      const elapsedMs = Date.now() - lastReplyAt;
      if (elapsedMs < AUTO_REPLY_MIN_INTERVAL_MS) {
        gatewayLogger.warn("Skipping Telegram auto-reply (rate limited)", {
          chatId: message.chatId,
          elapsedMs,
          minIntervalMs: AUTO_REPLY_MIN_INTERVAL_MS,
        });
        return;
      }

      this.lastAutoReplyAtByChat.set(message.chatId, Date.now());
      // No prompt: aiReplyTelegram falls back to the just-persisted inbound
      // text and treats it as untrusted. Passing message.text here would make
      // it look like trusted operator input.
      await this.aiReplyTelegram({ threadId });
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
