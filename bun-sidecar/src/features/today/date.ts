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

// Compact day/month label for tab titles, locale-aware (browser default).
// "2026-05-07" → "7. 5." in cs-CZ, "5/7" in en-US.
export function formatTabDateLabel(isoDate: string): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    if (!y || !m || !d) return isoDate;
    return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(
        new Date(y, m - 1, d)
    );
}
