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

// Compact day + short-month label for tab titles, locale-aware.
// "2026-06-03" → "3. čvn" in cs-CZ, "Jun 3" in en-US.
// Short month avoids the ambiguous "3. 6." double-dot rendering of the
// fully numeric format; weekday is dropped because tabs are width-constrained
// and the day-of-week was getting truncated to "W…".
export function formatTabDateLabel(isoDate: string): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!y || !m || !d) return isoDate;
    return new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
    }).format(new Date(y, m - 1, d));
}
