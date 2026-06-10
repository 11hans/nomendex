import { describe, expect, it } from "bun:test";
import { isAllowedWebSocketOrigin, isLoopbackHost, resolveServerHostname } from "./request-security";

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
});

