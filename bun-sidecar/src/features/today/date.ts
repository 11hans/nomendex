export function getTodayLocalDateString(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function getMsUntilNextLocalMidnight(now: Date = new Date()): number {
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return Math.max(1000, next.getTime() - now.getTime());
}

// Compact day + short-month label for tab titles.
// "2026-06-03" → "Jun 3" (US) or "3. čvn" (EU/cs-CZ).
export function formatTabDateLabel(isoDate: string, dateFormat: "us" | "eu" = "us"): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!y || !m || !d) return isoDate;
    const locale = dateFormat === "eu" ? "cs-CZ" : "en-US";
    return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
    }).format(new Date(y, m - 1, d));
}
