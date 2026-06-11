import { createServiceLogger } from "@/lib/logger";
import { normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";
import type { TelegramInboundMessage } from "./types";

const telegramLogger = createServiceLogger("TELEGRAM-MONITOR");

export type TelegramUpdate = {
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

export class TelegramHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TelegramHttpError";
  }
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

export function nextBackoffMs(currentMs: number): number {
  return Math.min(Math.max(currentMs, BACKOFF_BASE_MS) * 2, BACKOFF_MAX_MS);
}

// 4xx (except 429) means bad token/config or a competing getUpdates consumer —
// retrying cannot help, so the loop stops and surfaces the error instead.
export function isFatalTelegramPollingError(error: unknown): boolean {
  return error instanceof TelegramHttpError
    && error.status >= 400
    && error.status < 500
    && error.status !== 429;
}

// Map a raw getUpdates entry to an inbound message. Returns null for updates
// that should be skipped: non-private chats, missing text, or malformed
// payloads — the Telegram response is only type-asserted, so field types are
// verified here before anything downstream builds Dates from them.
export function toTelegramInboundMessage(update: TelegramUpdate): TelegramInboundMessage | null {
  if (typeof update.update_id !== "number") return null;
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.type !== "private") return null;
  if (typeof msg.chat.id !== "number" || typeof msg.message_id !== "number") return null;
  if (typeof msg.date !== "number" || !Number.isFinite(msg.date)) return null;
  if (typeof msg.text !== "string") return null;

  const text = normalizeTelegramInboundText(msg.text);
  if (!text) return null;

  return {
    updateId: update.update_id,
    chatId: String(msg.chat.id),
    username: normalizeTelegramUsername(msg.from?.username || msg.chat.username),
    text,
    messageId: String(msg.message_id),
    timestampMs: msg.date * 1000,
  };
}

type StartOptions = {
  token: string;
  pollingTimeoutSec: number;
  getLastUpdateId: () => Promise<number>;
  setLastUpdateId: (updateId: number) => Promise<void>;
  onMessage: (message: TelegramInboundMessage) => Promise<void>;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error) => void;
  /** Called when the loop stops on its own (fatal polling error), not via stop(). */
  onStop?: () => void;
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
    let backoffMs = BACKOFF_BASE_MS;
    let offset = await opts.getLastUpdateId();

    while (this.running && !signal.aborted) {
      try {
        const result = await fetchTelegramUpdates(opts.token, offset + 1, opts.pollingTimeoutSec, signal);
        backoffMs = BACKOFF_BASE_MS;
        if (!connected) {
          connected = true;
          opts.onConnectionChange?.(true);
        }

        for (const update of result) {
          if (typeof update.update_id !== "number" || update.update_id <= offset) continue;
          offset = update.update_id;

          const inbound = toTelegramInboundMessage(update);
          if (inbound) {
            // Handler failures are not connection failures: they must not
            // trigger backoff or a fatal stop, and must not block later
            // updates in the same batch.
            try {
              await opts.onMessage(inbound);
            } catch (error) {
              telegramLogger.error("Telegram inbound handler failed", {
                updateId: update.update_id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Persist the offset only after the handler ran, so a crash mid-
          // handling redelivers the update on restart instead of dropping it.
          await opts.setLastUpdateId(offset);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (connected) {
          connected = false;
          opts.onConnectionChange?.(false);
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        opts.onError?.(normalized);

        if (isFatalTelegramPollingError(error)) {
          telegramLogger.error("Telegram polling failed with non-retryable error, stopping monitor", {
            status: (error as TelegramHttpError).status,
            error: normalized.message,
          });
          this.running = false;
          break;
        }

        telegramLogger.warn("Telegram polling failed, retrying with backoff", {
          error: normalized.message,
          backoffMs,
        });
        await sleep(backoffMs);
        backoffMs = nextBackoffMs(backoffMs);
      }
    }

    opts.onConnectionChange?.(false);
    // An aborted signal means stop()/reload() initiated the shutdown and the
    // caller already knows; anything else is the loop dying on its own.
    if (!signal.aborted) {
      opts.onStop?.();
    }
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
    throw new TelegramHttpError(response.status, `Telegram polling HTTP ${response.status}: ${body}`);
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
