import { describe, expect, it } from "bun:test";
import {
  evaluateMutatingRequestPolicy,
  isAllowedWebSocketOrigin,
  isLoopbackHost,
  resolveServerHostname,
} from "./request-security";

describe("request security", () => {
  it("resolves loopback host by default", () => {
    expect(resolveServerHostname({})).toBe("127.0.0.1");
    expect(resolveServerHostname({ SERVER_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("detects loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("allows same-origin websocket and blocks unrelated origin", () => {
    expect(
      isAllowedWebSocketOrigin(
        "http://127.0.0.1:1234/ws",
        "http://127.0.0.1:1234",
        "127.0.0.1",
      ),
    ).toBe(true);

    expect(
      isAllowedWebSocketOrigin(
        "http://127.0.0.1:1234/ws",
        "http://evil.example.com",
        "127.0.0.1",
      ),
    ).toBe(false);
  });

  it("rejects cross-origin and non-JSON mutating requests", () => {
    const url = "http://127.0.0.1:1234/api/channels/telegram/send";

    const sameOriginJson = new Request(url, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:1234", "content-type": "application/json" },
      body: "{}",
    });
    expect(evaluateMutatingRequestPolicy(sameOriginJson, "127.0.0.1")).toEqual({ allowed: true });

    const noOriginJson = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(evaluateMutatingRequestPolicy(noOriginJson, "127.0.0.1")).toEqual({ allowed: true });

    const foreignOrigin = new Request(url, {
      method: "POST",
      headers: { origin: "http://evil.example.com", "content-type": "application/json" },
      body: "{}",
    });
    expect(evaluateMutatingRequestPolicy(foreignOrigin, "127.0.0.1")).toEqual({
      allowed: false,
      reason: "origin",
    });

    const simpleRequest = new Request(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(evaluateMutatingRequestPolicy(simpleRequest, "127.0.0.1")).toEqual({
      allowed: false,
      reason: "content-type",
    });
  });
});

