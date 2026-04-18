import path from "node:path";
import { readdir } from "node:fs/promises";
import type { VaultConfig } from "./built-in-bpagent";

type Pattern = "M-D-YYYY" | "YYYY-MM-DD" | "D-M-YYYY";

function formatToday(pattern: Pattern, now: Date): string {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    switch (pattern) {
        case "YYYY-MM-DD":
            return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        case "D-M-YYYY":
            return `${d}-${m}-${y}`;
        default:
            return `${m}-${d}-${y}`;
    }
}

function detectPattern(filename: string): Pattern | null {
    const base = filename.replace(/\.md$/, "");
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(base)) return "YYYY-MM-DD";
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(base)) return "M-D-YYYY";
    return null;
}

function parseFileDate(filename: string, pattern: Pattern): Date | null {
    const base = filename.replace(/\.md$/, "");
    const parts = base.split("-").map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    let y: number, m: number, d: number;
    if (pattern === "YYYY-MM-DD") [y, m, d] = parts as [number, number, number];
    else if (pattern === "D-M-YYYY") [d, m, y] = parts as [number, number, number];
    else [m, d, y] = parts as [number, number, number];
    return new Date(y, m - 1, d);
}

/**
 * Pre-computed daily-notes context injected into the BPagent system prompt.
 * Saves the agent from probing the filesystem to figure out today's date,
 * folder, filename pattern, and streak on every /daily invocation.
 */
export async function buildDailyContextBlock(
    notesPath: string,
    config: VaultConfig | null,
): Promise<string | null> {
    const dailyDir = config?.folderMapping?.dailyNotes ?? "daily-notes";
    const dir = path.join(notesPath, dailyDir);

    let files: string[] = [];
    try {
        const entries = await readdir(dir);
        files = entries.filter((f) => f.endsWith(".md") && detectPattern(f));
    } catch {
        return null;
    }

    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const czDate = now.toLocaleDateString("cs-CZ", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
    });

    if (files.length === 0) {
        return `<daily-context>
today: ${iso} (${czDate})
daily_notes_dir: ${dailyDir}
filename_pattern: unknown (no existing notes)
today_note: { exists: false }
</daily-context>`;
    }

    const pattern = detectPattern(files[0]) ?? "M-D-YYYY";
    const sorted = files
        .map((f) => ({ f, d: parseFileDate(f, pattern) }))
        .filter((x): x is { f: string; d: Date } => x.d !== null)
        .sort((a, b) => a.d.getTime() - b.d.getTime());

    const latest = sorted[sorted.length - 1]?.f ?? files[files.length - 1];
    const todayFile = `${formatToday(pattern, now)}.md`;
    const todayExists = files.includes(todayFile);
    const todayPath = path.join(dir, todayFile);

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
daily_notes_dir: ${dailyDir}
filename_pattern: ${pattern}
today_note: { filename: "${todayFile}", path: "${todayPath}", exists: ${todayExists} }
latest_note: { filename: "${latest}"${streak ? `, streak: "${streak}"` : ""} }
</daily-context>`;
}
