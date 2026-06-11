import { describe, expect, it } from "bun:test";
import { normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";
import {
  TelegramHttpError,
  isFatalTelegramPollingError,
  nextBackoffMs,
  toTelegramInboundMessage,
  type TelegramUpdate,
} from "./telegram-monitor";

describe("telegram monitor normalization", () => {
  it("normalizes username", () => {
    expect(normalizeTelegramUsername("@alice")).toBe("alice");
    expect(normalizeTelegramUsername(" bob ")).toBe("bob");
    expect(normalizeTelegramUsername(undefined)).toBeUndefined();
  });

  it("sanitizes inbound text", () => {
    expect(normalizeTelegramInboundText("  hello\r\nworld  ")).toBe("hello\nworld");
    expect(normalizeTelegramInboundText("\u0000abc\u0000")).toBe("abc");
  });
});

describe("telegram polling retry policy", () => {
  it("doubles backoff up to the cap", () => {
    expect(nextBackoffMs(1000)).toBe(2000);
    expect(nextBackoffMs(2000)).toBe(4000);
    expect(nextBackoffMs(40_000)).toBe(60_000);
    expect(nextBackoffMs(60_000)).toBe(60_000);
  });

  it("treats sub-base values as base before doubling", () => {
    expect(nextBackoffMs(0)).toBe(2000);
  });

  it("flags 4xx as fatal except 429", () => {
    expect(isFatalTelegramPollingError(new TelegramHttpError(401, "unauthorized"))).toBe(true);
    expect(isFatalTelegramPollingError(new TelegramHttpError(404, "not found"))).toBe(true);
    expect(isFatalTelegramPollingError(new TelegramHttpError(409, "conflict"))).toBe(true);
    expect(isFatalTelegramPollingError(new TelegramHttpError(429, "rate limited"))).toBe(false);
  });

  it("treats 5xx and network errors as retryable", () => {
    expect(isFatalTelegramPollingError(new TelegramHttpError(500, "server error"))).toBe(false);
    expect(isFatalTelegramPollingError(new TelegramHttpError(502, "bad gateway"))).toBe(false);
    expect(isFatalTelegramPollingError(new Error("fetch failed"))).toBe(false);
  });
});

describe("telegram update mapping", () => {
  const validUpdate: TelegramUpdate = {
    update_id: 10,
    message: {
      message_id: 5,
      date: 1_750_000_000,
      text: "hello",
      chat: { id: 123, type: "private", username: "alice" },
      from: { username: "alice" },
    },
  };

  it("maps a valid private message", () => {
    expect(toTelegramInboundMessage(validUpdate)).toEqual({
      updateId: 10,
      chatId: "123",
      username: "alice",
      text: "hello",
      messageId: "5",
      timestampMs: 1_750_000_000_000,
    });
  });

  it("skips non-private chats and missing text", () => {
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, chat: { id: 123, type: "group" } },
    })).toBeNull();
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, text: undefined },
    })).toBeNull();
    expect(toTelegramInboundMessage({ update_id: 11 })).toBeNull();
  });

  it("skips malformed payloads instead of throwing downstream", () => {
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, date: Number.NaN },
    })).toBeNull();
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, date: "yesterday" as unknown as number },
    })).toBeNull();
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, chat: undefined },
    })).toBeNull();
  });
});
