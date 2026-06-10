const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

export function resolveServerHostname(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.SERVER_HOST ?? env.HOST ?? "").trim();
  return configured || "127.0.0.1";
}

// Origin policy for any browser-originated request: WebSocket upgrades and
// mutating HTTP routes. A missing Origin header means a non-browser client
// (curl, the native app) and is allowed.
export function isAllowedWebSocketOrigin(
  requestUrl: string,
  originHeader: string | null,
  serverHostname = resolveServerHostname(),
): boolean {
  if (!originHeader) {
    return true;
  }

  let request: URL;
  let origin: URL;
  try {
    request = new URL(requestUrl);
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  if (origin.origin === request.origin) {
    return true;
  }

  if (isLoopbackHost(serverHostname) && isLoopbackHost(origin.hostname)) {
    return true;
  }

  return false;
}

/**
 * Host-header check to defeat DNS rebinding: a page on attacker.com can point
 * its DNS at 127.0.0.1, and then both the request URL and the Origin header
 * carry the attacker's hostname — the same-origin check passes. When the
 * server is bound to loopback, the Host header must be a loopback name too.
 * Explicit non-loopback binds (SERVER_HOST) opt out of the check.
 */
export function isAllowedRequestHost(
  hostHeader: string | null,
  serverHostname = resolveServerHostname(),
): boolean {
  if (!isLoopbackHost(serverHostname)) {
    return true;
  }
  if (!hostHeader) {
    return false;
  }
  try {
    const url = new URL(`http://${hostHeader.trim()}`);
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export type MutationPolicyResult =
  | { allowed: true }
  | { allowed: false; reason: "host" | "origin" | "content-type" };

/**
 * CSRF guard for state-changing JSON routes. Cross-site pages can fire
 * "simple" POST requests (text/plain body) at http://127.0.0.1 without a
 * preflight, and req.json() would happily parse them. Rejecting foreign
 * origins and requiring application/json closes that off while keeping
 * non-browser clients (no Origin header) working.
 */
export function evaluateMutatingRequestPolicy(
  req: Request,
  serverHostname = resolveServerHostname(),
): MutationPolicyResult {
  if (!isAllowedRequestHost(req.headers.get("host"), serverHostname)) {
    return { allowed: false, reason: "host" };
  }

  if (!isAllowedWebSocketOrigin(req.url, req.headers.get("origin"), serverHostname)) {
    return { allowed: false, reason: "origin" };
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return { allowed: false, reason: "content-type" };
  }

  return { allowed: true };
}

