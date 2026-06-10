import { createServiceLogger } from "@/lib/logger";
import { normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";
import type { TelegramInboundMessage } from "./types";

const telegramLogger = createServiceLogger("TELEGRAM-MONITOR");

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat?: {
      id: number;
      type?: string;
      username?: string;
    };
    from?: {
      username?: string;
    };
  };
};

type StartOptions = {
  token: string;
  pollingTimeoutSec: number;
  getLastUpdateId: () => Promise<number>;
  setLastUpdateId: (updateId: number) => Promise<void>;
  onMessage: (message: TelegramInboundMessage) => Promise<void>;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error) => void;
};

export class TelegramMonitor {
  private abortController: AbortController | null = null;
  private running = false;

  async start(opts: StartOptions): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.abortController = new AbortController();
    this.runLoop(opts, this.abortController.signal).catch((error) => {
      telegramLogger.error("Telegram monitor loop crashed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async runLoop(opts: StartOptions, signal: AbortSignal): Promise<void> {
    let connected = false;
    let offset = await opts.getLastUpdateId();

    while (this.running && !signal.aborted) {
      try {
        const result = await fetchTelegramUpdates(opts.token, offset + 1, opts.pollingTimeoutSec, signal);
        if (!connected) {
          connected = true;
          opts.onConnectionChange?.(true);
        }

        for (const update of result) {
          if (update.update_id <= offset) continue;
          offset = update.update_id;
          await opts.setLastUpdateId(offset);

          const msg = update.message;
          if (!msg || !msg.chat || msg.chat.type !== "private") continue;
          if (!msg.text) continue;

          const normalizedText = normalizeTelegramInboundText(msg.text);
          if (!normalizedText) continue;

          const username = normalizeTelegramUsername(msg.from?.username || msg.chat.username);

          const inbound: TelegramInboundMessage = {
            updateId: update.update_id,
            chatId: String(msg.chat.id),
            username,
            text: normalizedText,
            messageId: String(msg.message_id),
            timestampMs: msg.date * 1000,
          };
          await opts.onMessage(inbound);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (connected) {
          connected = false;
          opts.onConnectionChange?.(false);
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        telegramLogger.warn("Telegram polling failed", {
          error: normalized.message,
        });
        opts.onError?.(normalized);
        await sleep(2000);
      }
    }

    opts.onConnectionChange?.(false);
  }
}

export async function sendTelegramText(token: string, chatId: string, text: string): Promise<{ messageId: string }> {
  const numericChatId = Number(chatId);
  if (!Number.isFinite(numericChatId)) {
    throw new Error("Invalid Telegram chat ID");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: numericChatId,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram send failed: HTTP ${response.status} ${body}`);
  }

  const data = await response.json() as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };

  if (!data.ok || !data.result) {
    throw new Error(`Telegram send failed: ${data.description || "unknown error"}`);
  }

  return { messageId: String(data.result.message_id) };
}

async function fetchTelegramUpdates(
  token: string,
  offset: number,
  timeoutSec: number,
  signal: AbortSignal,
): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message"],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram polling HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    ok: boolean;
    result?: TelegramUpdate[];
    description?: string;
  };

  if (!data.ok || !Array.isArray(data.result)) {
    throw new Error(`Telegram polling error: ${data.description || "invalid response"}`);
  }

  return data.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
