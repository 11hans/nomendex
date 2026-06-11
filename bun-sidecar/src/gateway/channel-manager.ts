import { createServiceLogger } from "@/lib/logger";
import { secrets } from "@/lib/secrets";
import { GatewayHttpError } from "./errors";
import { TelegramMonitor, sendTelegramText } from "./telegram-monitor";
import type { ChannelStatus, ChannelsSettings, TelegramInboundMessage } from "./types";

const gatewayLogger = createServiceLogger("CHANNEL-MANAGER");

// Insurance: error strings can embed the bot token (e.g. fetch errors that
// include the request URL). lastError flows into status responses and
// WebSocket events, so the token must never survive in it.
function scrubToken(message: string, token: string): string {
  return token ? message.split(token).join("[redacted]") : message;
}

type ChannelManagerOptions = {
  getSettings: () => Promise<ChannelsSettings>;
  getLastUpdateId: () => Promise<number>;
  setLastUpdateId: (updateId: number) => Promise<void>;
  onTelegramMessage: (message: TelegramInboundMessage) => Promise<void>;
  onStatusChange?: (status: ChannelStatus) => void;
};

export class ChannelManager {
  private readonly opts: ChannelManagerOptions;
  private readonly telegramMonitor = new TelegramMonitor();
  private telegramToken: string | null = null;
  private status: ChannelStatus = {
    channel: "telegram",
    running: false,
    connected: false,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };

  constructor(opts: ChannelManagerOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    await this.startTelegram();
  }

  async reload(): Promise<void> {
    this.telegramMonitor.stop();
    this.telegramToken = null;
    this.setStatus({ running: false, connected: false, lastError: null });
    await this.startTelegram();
  }

  stop(): void {
    this.telegramMonitor.stop();
    this.telegramToken = null;
    this.setStatus({ running: false, connected: false });
  }

  getStatus(): ChannelStatus {
    return this.status;
  }

  async sendTelegram(chatId: string, message: string): Promise<{ messageId: string }> {
    const settings = await this.opts.getSettings();
    if (!settings.telegram.enabled) {
      throw new GatewayHttpError(403, "TELEGRAM_DISABLED", "Telegram channel is disabled");
    }

    if (!this.telegramToken) {
      this.telegramToken = await this.resolveToken(settings.telegram.tokenSecretKey);
    }

    if (!this.telegramToken) {
      throw new GatewayHttpError(409, "TELEGRAM_TOKEN_MISSING", "Telegram token is not configured");
    }

    return sendTelegramText(this.telegramToken, chatId, message);
  }

  private async startTelegram(): Promise<void> {
    const settings = await this.opts.getSettings();
    const telegramSettings = settings.telegram;
    this.telegramToken = null;

    if (!telegramSettings.enabled) {
      this.setStatus({ running: false, connected: false, lastError: null });
      return;
    }

    const token = await this.resolveToken(telegramSettings.tokenSecretKey);
    if (!token) {
      this.setStatus({
        running: false,
        connected: false,
        lastError: `Missing Telegram token in secret ${telegramSettings.tokenSecretKey}`,
      });
      return;
    }

    this.telegramToken = token;
    this.setStatus({ running: true, connected: false, lastError: null });

    await this.telegramMonitor.start({
      token,
      pollingTimeoutSec: telegramSettings.pollingTimeoutSec,
      getLastUpdateId: this.opts.getLastUpdateId,
      setLastUpdateId: this.opts.setLastUpdateId,
      onMessage: this.opts.onTelegramMessage,
      onConnectionChange: (connected) => {
        this.setStatus({ connected, ...(connected ? { lastError: null } : {}) });
      },
      onError: (error) => {
        this.setStatus({ connected: false, lastError: scrubToken(error.message, token) });
      },
      onStop: () => {
        // The monitor stopped on its own (fatal polling error) — without
        // this, status.running would keep claiming the channel is alive.
        this.setStatus({ running: false, connected: false });
      },
    });

    gatewayLogger.info("Telegram monitor started", {
      allowlistSize: telegramSettings.allowlist.length,
      autoReplyEnabled: telegramSettings.autoReplyEnabled,
    });
  }

  private async resolveToken(tokenSecretKey: string): Promise<string | null> {
    try {
      const token = await secrets.get(tokenSecretKey);
      return token ? token.trim() : null;
    } catch {
      return null;
    }
  }

  private setStatus(patch: Partial<ChannelStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.opts.onStatusChange?.(this.status);
  }
}
