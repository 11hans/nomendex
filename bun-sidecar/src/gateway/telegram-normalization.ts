const MAX_INBOUND_TEXT_CHARS = 4000;

export function normalizeTelegramUsername(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/^@+/, "");
  return normalized || undefined;
}

export function normalizeTelegramInboundText(raw: string): string {
  const sanitized = raw
    .replaceAll("\u0000", "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (sanitized.length <= MAX_INBOUND_TEXT_CHARS) {
    return sanitized;
  }

  return sanitized.slice(0, MAX_INBOUND_TEXT_CHARS);
}

