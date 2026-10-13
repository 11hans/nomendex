/** Daily note file name format when the vault has no Obsidian daily-notes settings. */
export const DEFAULT_DAILY_NOTE_FORMAT = "M-D-YYYY";

// The numeric subset of Moment.js format tokens (what Obsidian uses for daily notes).
const DATE_TOKENS = new Set(["YYYY", "YY", "MM", "M", "DD", "D", "HH", "mm"]);

type FormatPart = { token: string } | { literal: string };

/** Split a Moment-style format into tokens and literals; null if it uses an unsupported token. */
function tokenizeDateFormat(format: string): FormatPart[] | null {
    const parts: FormatPart[] = [];
    let i = 0;
    while (i < format.length) {
        const char = format[i];
        if (char === "[") {
            const end = format.indexOf("]", i);
            if (end === -1) return null;
            parts.push({ literal: format.slice(i + 1, end) });
            i = end + 1;
        } else if (/[A-Za-z]/.test(char)) {
            // A run of the same letter is one token, so "MMMM" or "DDDD" isn't read as two.
            let end = i;
            while (format[end] === char) end++;
            const token = format.slice(i, end);
            if (!DATE_TOKENS.has(token)) return null;
            parts.push({ token });
            i = end;
        } else {
            parts.push({ literal: char });
            i++;
        }
    }
    return parts;
}

function formatToken(date: Date, token: string): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    switch (token) {
        case "YYYY": return String(date.getFullYear());
        case "YY": return pad(date.getFullYear() % 100);
        case "MM": return pad(date.getMonth() + 1);
        case "M": return String(date.getMonth() + 1);
        case "DD": return pad(date.getDate());
        case "D": return String(date.getDate());
        case "HH": return pad(date.getHours());
        default: return pad(date.getMinutes());
    }
}

/** Format a date with the numeric subset of Moment.js tokens; null if the format uses anything else. */
export function formatMomentDate(date: Date, format: string): string | null {
    const parts = tokenizeDateFormat(format);
    if (!parts) return null;
    return parts.map((part) => ("token" in part ? formatToken(date, part.token) : part.literal)).join("");
}

/** Whether a daily note file name format can be formatted and parsed back: year, month and day, no folders. */
export function isSupportedDailyFormat(format: string): boolean {
    const parts = tokenizeDateFormat(format);
    if (!parts) return false;
    const tokens = parts.flatMap((part) => ("token" in part ? [part.token] : []));
    const literals = parts.flatMap((part) => ("literal" in part ? [part.literal] : []));
    return (
        literals.every((literal) => !/[/\\]/.test(literal)) &&
        tokens.some((token) => token.startsWith("Y")) &&
        tokens.some((token) => token.startsWith("M")) &&
        tokens.some((token) => token.startsWith("D"))
    );
}

/** Daily note date as used in file names and template placeholders. */
export function formatDailyNoteDate(date: Date, format: string = DEFAULT_DAILY_NOTE_FORMAT): string {
    return formatMomentDate(date, format) ?? formatMomentDate(date, DEFAULT_DAILY_NOTE_FORMAT) ?? "";
}

/**
 * Inverse of formatDailyNoteDate for a file base name ("13-10-2026.md"); null if it isn't one.
 * Only the given format counts: M-D and D-M names can't be told apart, so there is no fallback.
 * Numbers may drop or add a leading zero ("1-11" matches DD-MM).
 */
export function parseDailyNoteDate(baseName: string, format: string = DEFAULT_DAILY_NOTE_FORMAT): Date | null {
    const parts = tokenizeDateFormat(format);
    if (!parts) return null;
    const tokens: string[] = [];
    const pattern = parts
        .map((part) => {
            if ("literal" in part) return part.literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            tokens.push(part.token);
            return part.token === "YYYY" ? "(\\d{4})" : "(\\d{1,2})";
        })
        .join("");
    const match = baseName.match(new RegExp(`^${pattern}(?:\\.md)?$`));
    if (!match) return null;

    let year = NaN;
    let month = NaN;
    let day = NaN;
    tokens.forEach((token, index) => {
        const value = Number(match[index + 1]);
        if (token === "YYYY") year = value;
        else if (token === "YY") year = value > 68 ? 1900 + value : 2000 + value;
        else if (token.startsWith("M")) month = value;
        else if (token.startsWith("D")) day = value;
    });
    if ([year, month, day].some(Number.isNaN)) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function fuzzyStartsWith(input: string, target: string): boolean {
    const inputLower = input.toLowerCase();
    const targetLower = target.toLowerCase();
    return targetLower.startsWith(inputLower) || inputLower.startsWith(targetLower);
}

function fuzzyMatch(input: string, ...targets: string[]): boolean {
    const inputLower = input.toLowerCase();
    return targets.some(target => fuzzyStartsWith(inputLower, target));
}

function findDayOfWeek(input: string): number | null {
    const inputLower = input.toLowerCase();
    for (let i = 0; i < DAY_NAMES.length; i++) {
        if (fuzzyStartsWith(inputLower, DAY_NAMES[i]) || fuzzyStartsWith(inputLower, DAY_ABBREVS[i])) {
            return i;
        }
    }
    return null;
}

function getNextDayOfWeek(dayIndex: number, fromDate: Date = new Date()): Date {
    const result = new Date(fromDate);
    const currentDay = result.getDay();
    let daysToAdd = dayIndex - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    return result;
}

function getLastDayOfWeek(dayIndex: number, fromDate: Date = new Date()): Date {
    const result = new Date(fromDate);
    const currentDay = result.getDay();
    let daysToSubtract = currentDay - dayIndex;
    if (daysToSubtract <= 0) daysToSubtract += 7;
    result.setDate(result.getDate() - daysToSubtract);
    return result;
}

/**
 * Converts a Date to a local date string (YYYY-MM-DD) without timezone conversion.
 * Use this for due dates to avoid UTC conversion issues.
 */
export function toLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD string as a local date (not UTC).
 * Use this instead of new Date("YYYY-MM-DD") which interprets the string as UTC.
 */
export function parseLocalDateString(dateString: string | Date): Date {
    // Handle when YAML parser returns a Date object directly
    if (dateString instanceof Date) {
        if (!isNaN(dateString.getTime())) {
            return dateString;
        }
        console.warn("[parseLocalDateString] Invalid Date object received, returning current date");
        return new Date();
    }

    if (!dateString) {
        console.warn("[parseLocalDateString] Empty date string, returning current date");
        return new Date();
    }

    // Handle ISO strings (e.g. 2023-01-01T10:00:00Z) by taking just the date part
    let normalizedString = dateString;
    if (dateString.includes("T")) {
        normalizedString = dateString.split("T")[0];
    }

    const parts = normalizedString.split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const [year, month, day] = parts;
        return new Date(year, month - 1, day);
    }

    // Fallback
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
        return date;
    }

    console.warn(`[parseLocalDateString] Invalid date string: "${dateString}", returning current date`);
    return new Date();
}

export function parseDateFromInput(input: string): Date | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    const today = new Date();
    const currentYear = today.getFullYear();

    // Simple keywords
    if (fuzzyMatch(lower, "today", "tod")) {
        return today;
    }
    if (fuzzyMatch(lower, "tomorrow", "tom")) {
        const result = new Date(today);
        result.setDate(result.getDate() + 1);
        return result;
    }
    if (fuzzyMatch(lower, "yesterday", "yest")) {
        const result = new Date(today);
        result.setDate(result.getDate() - 1);
        return result;
    }

    // "next <day>" or "ne <day>" patterns
    const nextMatch = lower.match(/^(ne(?:xt)?)\s+(.+)$/);
    if (nextMatch) {
        const dayPart = nextMatch[2];
        const dayIndex = findDayOfWeek(dayPart);
        if (dayIndex !== null) {
            return getNextDayOfWeek(dayIndex, today);
        }
        // "next week" - 7 days from now
        if (fuzzyMatch(dayPart, "week", "wee")) {
            const result = new Date(today);
            result.setDate(result.getDate() + 7);
            return result;
        }
    }

    // "last <day>" or "la <day>" patterns
    const lastMatch = lower.match(/^(la(?:st)?)\s+(.+)$/);
    if (lastMatch) {
        const dayPart = lastMatch[2];
        const dayIndex = findDayOfWeek(dayPart);
        if (dayIndex !== null) {
            return getLastDayOfWeek(dayIndex, today);
        }
        // "last week" - 7 days ago
        if (fuzzyMatch(dayPart, "week", "wee")) {
            const result = new Date(today);
            result.setDate(result.getDate() - 7);
            return result;
        }
    }

    // Just a day name - assume next occurrence
    const standaloneDayIndex = findDayOfWeek(lower);
    if (standaloneDayIndex !== null) {
        return getNextDayOfWeek(standaloneDayIndex, today);
    }

    // M-D-YYYY or M/D/YYYY (full year)
    const fullDateMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (fullDateMatch) {
        const [, month, day, year] = fullDateMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // M-D or M/D (default to current year)
    const shortDateMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})$/);
    if (shortDateMatch) {
        const [, month, day] = shortDateMatch;
        const date = new Date(currentYear, parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // YYYY-MM-DD (ISO format)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) return date;
    }

    // Try natural Date.parse as fallback (handles "Jan 15, 2026" etc)
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
        return new Date(parsed);
    }

    return null;
}
