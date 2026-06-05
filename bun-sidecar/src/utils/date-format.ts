import type { DateFormat } from "@/types/Workspace";

export function getDateLocale(fmt: DateFormat): string {
    return fmt === "eu" ? "cs-CZ" : "en-US";
}

// "Jun 5" (US) or "5. 6." (EU)
export function formatShortDate(date: Date, fmt: DateFormat): string {
    return date.toLocaleDateString(getDateLocale(fmt), { month: "short", day: "numeric" });
}

// "Jun 5, 2026" (US) or "5. 6. 2026" (EU)
export function formatMediumDate(date: Date, fmt: DateFormat): string {
    return date.toLocaleDateString(getDateLocale(fmt), { month: "short", day: "numeric", year: "numeric" });
}

// "Wednesday, June 5, 2026" (US) or locale equivalent
export function formatFullDate(date: Date, fmt: DateFormat): string {
    return date.toLocaleDateString(getDateLocale(fmt), { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// "Mon, Jun 5" (US) or locale equivalent
export function formatDateWithWeekday(date: Date, fmt: DateFormat): string {
    return date.toLocaleDateString(getDateLocale(fmt), { weekday: "short", month: "short", day: "numeric" });
}
