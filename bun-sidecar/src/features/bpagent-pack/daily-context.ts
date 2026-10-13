import path from "node:path";
import { readdir } from "node:fs/promises";
import type { DailyNotesSettings } from "@/features/notes/daily-notes-settings";
import { formatDailyNoteDate, parseDailyNoteDate, toLocalDateString } from "@/features/notes/date-utils";

/**
 * Pre-computed daily-notes context added to BPagent's user turn (see turn-context.ts).
 * Saves the agent from probing the filesystem to figure out today's date,
 * folder, filename pattern, and streak on every /daily invocation.
 */
export async function buildDailyContextBlock(
    notesPath: string,
    settings: DailyNotesSettings,
): Promise<string | null> {
    const dailyDir = settings.folder || ".";
    const dir = path.join(notesPath, settings.folder);

    let notes: Array<{ f: string; d: Date }>;
    try {
        const entries = await readdir(dir);
        notes = entries
            .map((f) => ({ f, d: parseDailyNoteDate(f, settings.format) }))
            .filter((x): x is { f: string; d: Date } => x.d !== null)
            .sort((a, b) => a.d.getTime() - b.d.getTime());
    } catch {
        return null;
    }

    const now = new Date();
    const iso = toLocalDateString(now);
    const czDate = now.toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
    });
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 16 ? "midday" : "evening";

    const existingToday = notes.find((x) => toLocalDateString(x.d) === iso)?.f;
    const todayFile = existingToday ?? `${formatDailyNoteDate(now, settings.format)}.md`;
    const todayPath = path.join(dir, todayFile);

    if (notes.length === 0) {
        return `<daily-context>
today: ${iso} (${czDate})
time_of_day: ${timeOfDay}
daily_notes_dir: ${dailyDir}
filename_pattern: ${settings.format}
today_note: { filename: "${todayFile}", path: "${todayPath}", exists: false }
</daily-context>`;
    }

    const latest = notes[notes.length - 1].f;

    let streak: string | null = null;
    try {
        const text = await Bun.file(path.join(dir, latest)).text();
        const m = text.match(/DEN\s+\d+/i);
        if (m) streak = m[0];
    } catch {
        // ignore
    }

    return `<daily-context>
today: ${iso} (${czDate})
time_of_day: ${timeOfDay}
daily_notes_dir: ${dailyDir}
filename_pattern: ${settings.format}
today_note: { filename: "${todayFile}", path: "${todayPath}", exists: ${Boolean(existingToday)} }
latest_note: { filename: "${latest}"${streak ? `, streak: "${streak}"` : ""} }
</daily-context>`;
}
