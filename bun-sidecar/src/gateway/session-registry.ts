const DEFAULT_TIME_ZONE = "Europe/Prague";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function getDateBucket(date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  return `${year}-${month}-${day}`;
}

export function makeTelegramSessionKey(chatId: string, date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return `telegram:dm:${chatId}:${getDateBucket(date, timeZone)}`;
}

export class SessionRegistry {
  private readonly timeZone: string;

  constructor(timeZone = DEFAULT_TIME_ZONE) {
    this.timeZone = timeZone;
  }

  telegramDmKey(chatId: string, date = new Date()): string {
    return makeTelegramSessionKey(chatId, date, this.timeZone);
  }

  getTimeZone(): string {
    return this.timeZone;
  }
}
