import { describe, expect, it } from "bun:test";
import { evaluateTelegramSendPolicy, isAllowlisted, redactGatewayEvent } from "./security";
import type { GatewayEvent } from "./types";

describe("gateway security", () => {
  it("matches allowlist by chatId or username", () => {
    expect(isAllowlisted("123", undefined, ["123"])).toBe(true);
    expect(isAllowlisted("123", "Alice", ["@alice"])).toBe(true);
    expect(isAllowlisted("123", "Bob", ["@alice", "456"])).toBe(false);
  });

  it("enforces telegram send policy", () => {
    const disabled = evaluateTelegramSendPolicy({
      enabled: false,
      autoReplyEnabled: false,
      allowlist: [],
      chatId: "123",
    });
    expect(disabled.allowed).toBe(false);
    if (!disabled.allowed) {
      expect(disabled.status).toBe(403);
      expect(disabled.code).toBe("TELEGRAM_DISABLED");
    }

    const blockedByAllowlist = evaluateTelegramSendPolicy({
      enabled: true,
      autoReplyEnabled: true,
      allowlist: ["@alice"],
      chatId: "123",
      username: "bob",
    });
    expect(blockedByAllowlist.allowed).toBe(false);

    const blockedManualSend = evaluateTelegramSendPolicy({
      enabled: true,
      autoReplyEnabled: false,
      allowlist: ["@alice"],
      chatId: "123",
      username: "bob",
    });
    expect(blockedManualSend.allowed).toBe(false);

    const allowed = evaluateTelegramSendPolicy({
      enabled: true,
      autoReplyEnabled: true,
      allowlist: ["123"],
      chatId: "123",
    });
    expect(allowed.allowed).toBe(true);
  });

  it("redacts sensitive channel message payloads", () => {
    const input: GatewayEvent = {
      id: "channel.message.received",
      payload: {
        threadId: "telegram:dm:1:2026-03-09",
        message: {
          id: "telegram-in-1",
          threadId: "telegram:dm:1:2026-03-09",
          channel: "telegram",
          role: "user",
          text: "secret text",
          externalChatId: "123456",
          createdAt: "2026-03-09T10:00:00.000Z",
        },
      },
    };

    const redacted = redactGatewayEvent(input);
    expect(redacted.payload.threadId).toBe("telegram:dm:1:2026-03-09");
    expect(redacted.payload.channel).toBe("telegram");
    expect(redacted.payload.role).toBe("user");
    expect("text" in redacted.payload).toBe(false);
    expect("message" in redacted.payload).toBe(false);
  });
});

