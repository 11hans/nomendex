const MAX_INBOUND_TEXT_CHARS = 4000;
const INBOX_TITLE_MAX_CHARS = 120;
const PHOTO_TITLE = "Fotka z Telegramu";

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


// Inbox todo text for a captured message. Title = first non-empty line
// (capped); the full text goes to the description only when the title does not
// already carry all of it. A photo without caption gets a default title.
export function inboxTodoText(text: string): { title: string; description?: string } {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
  if (!firstLine) return { title: PHOTO_TITLE };

  const title = firstLine.length > INBOX_TITLE_MAX_CHARS
    ? `${firstLine.slice(0, INBOX_TITLE_MAX_CHARS - 1).trimEnd()}…`
    : firstLine;
  return title === text ? { title } : { title, description: text };
}
