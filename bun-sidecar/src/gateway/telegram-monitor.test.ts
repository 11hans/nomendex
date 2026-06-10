import { describe, expect, it } from "bun:test";
import { normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";
import { TelegramHttpError, isFatalTelegramPollingError, nextBackoffMs } from "./telegram-monitor";

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
