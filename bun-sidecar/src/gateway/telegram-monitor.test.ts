import { describe, expect, it } from "bun:test";
import { normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";

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
