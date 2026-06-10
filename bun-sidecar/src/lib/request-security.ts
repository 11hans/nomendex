const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

export function resolveServerHostname(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.SERVER_HOST ?? env.HOST ?? "").trim();
  return configured || "127.0.0.1";
}

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

