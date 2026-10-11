import { describe, expect, it } from "bun:test";
import { inboxTodoText, normalizeTelegramInboundText, normalizeTelegramUsername } from "./telegram-normalization";
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

  it("derives the Inbox todo title and description", () => {
    expect(inboxTodoText("koupit mléko")).toEqual({ title: "koupit mléko" });
    expect(inboxTodoText("zavolat servis\nkvůli kotli, nejlíp ráno")).toEqual({
      title: "zavolat servis",
      description: "zavolat servis\nkvůli kotli, nejlíp ráno",
    });
    expect(inboxTodoText("")).toEqual({ title: "Fotka z Telegramu" });

    const long = "x".repeat(200);
    const capped = inboxTodoText(long);
    expect(capped.title.length).toBe(120);
    expect(capped.title.endsWith("…")).toBe(true);
    expect(capped.description).toBe(long);
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
      kind: "text",
      text: "hello",
      messageId: "5",
      timestampMs: 1_750_000_000_000,
    });
  });

  it("maps a photo to its largest size and caption", () => {
    const mapped = toTelegramInboundMessage({
      ...validUpdate,
      message: {
        ...validUpdate.message!,
        text: undefined,
        caption: "  účtenka  ",
        photo: [{ file_id: "small" }, { file_id: "large" }],
      },
    });
    expect(mapped?.kind).toBe("photo");
    expect(mapped?.photoFileId).toBe("large");
    expect(mapped?.text).toBe("účtenka");
  });

  it("marks private messages without text or photo as unsupported", () => {
    const mapped = toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, text: undefined },
    });
    expect(mapped?.kind).toBe("unsupported");
    expect(mapped?.text).toBe("");
  });

  it("skips non-private chats and empty text", () => {
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, chat: { id: 123, type: "group" } },
    })).toBeNull();
    expect(toTelegramInboundMessage({
      ...validUpdate,
      message: { ...validUpdate.message!, text: "   " },
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
