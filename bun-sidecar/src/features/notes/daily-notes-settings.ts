import path from "path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { getDailyNotesPath, getNotesPath } from "@/storage/root-path";
import { readVaultConfig } from "@/features/bpagent-pack/built-in-bpagent";
import { createServiceLogger } from "@/lib/logger";
import { DEFAULT_DAILY_NOTE_FORMAT, isSupportedDailyFormat, parseDailyNoteDate } from "./date-utils";

const logger = createServiceLogger("DAILY-NOTES");

// Obsidian's core Daily notes plugin settings (.obsidian/daily-notes.json).
const ObsidianDailyNotesSchema = z
    .object({
        folder: z.string().optional(),
        format: z.string().optional(),
        template: z.string().optional(),
    })
    .passthrough();

// Obsidian's own defaults for fields it leaves empty.
const OBSIDIAN_DEFAULT_FORMAT = "YYYY-MM-DD";

export type DailyNotesSettings = {
    /** Folder relative to the notes root, "" for the root itself. */
    folder: string;
    /** Moment-style file name format, always one isSupportedDailyFormat accepts. */
    format: string;
    /** Template file relative to the notes root, null for none. */
    template: string | null;
};

let warnedFormat: string | null = null;

/**
 * Where daily notes live and how they're named. Obsidian's daily-notes settings are
 * the source of truth when the vault has them; they're read on every call so a change
 * made in Obsidian applies without a restart. Without them: daily-notes/ and M-D-YYYY.
 */
export async function getDailyNotesSettings(): Promise<DailyNotesSettings> {
    const notesPath = getNotesPath();
    const obsidian = await readObsidianDailyNotes(notesPath);

    const folder = obsidian ? normalizeFolder(obsidian.folder ?? "") : path.relative(notesPath, getDailyNotesPath());

    let format = obsidian ? obsidian.format?.trim() || OBSIDIAN_DEFAULT_FORMAT : DEFAULT_DAILY_NOTE_FORMAT;
    if (!isSupportedDailyFormat(format)) {
        if (warnedFormat !== format) {
            warnedFormat = format;
            logger.warn(`Unsupported Obsidian daily note format "${format}", using ${DEFAULT_DAILY_NOTE_FORMAT}`);
        }
        format = DEFAULT_DAILY_NOTE_FORMAT;
    }

    const template = (await configuredTemplate(notesPath, obsidian?.template)) ?? (await fallbackTemplate(notesPath));
    return { folder, format, template };
}

/** The date of a daily note file, or null when the file isn't one (wrong folder or name). */
export function getDailyNoteDate(fileName: string, settings: DailyNotesSettings): Date | null {
    if (path.dirname(path.normalize(fileName)) !== (settings.folder || ".")) return null;
    return parseDailyNoteDate(path.basename(fileName), settings.format);
}

async function readObsidianDailyNotes(notesPath: string): Promise<z.infer<typeof ObsidianDailyNotesSchema> | null> {
    try {
        const file = Bun.file(path.join(notesPath, ".obsidian", "daily-notes.json"));
        if (!(await file.exists())) return null;
        return ObsidianDailyNotesSchema.parse(await file.json());
    } catch (error) {
        logger.warn("Failed to read .obsidian/daily-notes.json", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function normalizeFolder(folder: string): string {
    const trimmed = folder.trim().replace(/^\/+|\/+$/g, "");
    return trimmed ? path.normalize(trimmed) : "";
}

async function configuredTemplate(notesPath: string, template: string | undefined): Promise<string | null> {
    const trimmed = template?.trim().replace(/^\/+/, "");
    if (!trimmed) return null;
    const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    return (await Bun.file(path.join(notesPath, fileName)).exists()) ? fileName : null;
}

// Without an Obsidian template: the first file with "daily" in its name inside
// vault-config.json's folderMapping.templates (what the daily-notes skill script uses).
async function fallbackTemplate(notesPath: string): Promise<string | null> {
    const templatesDir = (await readVaultConfig(notesPath))?.folderMapping?.templates;
    if (!templatesDir) return null;
    try {
        const files = await readdir(path.join(notesPath, templatesDir));
        const templateFile = files.sort().find((name) => name.toLowerCase().includes("daily") && name.endsWith(".md"));
        return templateFile ? path.join(templatesDir, templateFile) : null;
    } catch {
        return null;
    }
}
