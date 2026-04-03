import { mkdir } from "node:fs/promises";
import path from "path";
import { createServiceLogger } from "@/lib/logger";
import { getNomendexPath, hasActiveWorkspace } from "@/storage/root-path";
import { TimeblockingConfig, TimeblockingConfigSchema } from "./types";

const logger = createServiceLogger("TIMEBLOCKING");

function getTimeblockingConfigPath(): string {
    return path.join(getNomendexPath(), "timeblocking.json");
}

async function ensureNomendexDir(): Promise<void> {
    if (!hasActiveWorkspace()) {
        throw new Error("No active workspace");
    }
    await mkdir(getNomendexPath(), { recursive: true });
}

export function buildDefaultTimeblockingConfig(): TimeblockingConfig {
    return {
        version: 1,
        defaults: {
            defaultDayType: "work_full",
        },
        blockTypes: {
            "morning-review": {
                title: "📓 Morning Review",
                durationMin: 15,
                project: "Inbox",
                tags: [],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
            "deep-work": {
                title: "🔵 Deep Work",
                durationMin: 120,
                project: "Inbox",
                tags: ["deep-work"],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
            movement: {
                title: "🏃 Movement",
                durationMin: 60,
                project: "Inbox",
                tags: ["movement"],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
            renovation: {
                title: "🔨 Renovation",
                durationMin: 120,
                project: "Inbox",
                tags: ["renovation"],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
            admin: {
                title: "🟡 Admin / Ops",
                durationMin: 60,
                project: "Inbox",
                tags: ["admin"],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
            "evening-review": {
                title: "📓 Evening Review",
                durationMin: 15,
                project: "Inbox",
                tags: [],
                descriptionTemplate: "Timeblock — weekly planner {{weekStart}}",
            },
        },
        dayTemplates: {
            work_full: [
                { blockType: "morning-review", start: "07:00" },
                { blockType: "movement", start: "17:30" },
                { blockType: "deep-work", start: "19:30" },
                { blockType: "evening-review", start: "21:30" },
            ],
            work_early: [
                { blockType: "morning-review", start: "07:00" },
                { blockType: "renovation", start: "workEnd+30min" },
                { blockType: "movement", start: "18:00" },
                { blockType: "deep-work", start: "19:30" },
                { blockType: "evening-review", start: "21:30" },
            ],
            pohotovost: [
                { blockType: "morning-review", start: "07:00" },
                { blockType: "deep-work", start: "09:00" },
                { blockType: "renovation", start: "11:00" },
                { blockType: "admin", start: "13:00" },
                { blockType: "movement", start: "18:00" },
                { blockType: "deep-work", start: "19:30" },
                { blockType: "evening-review", start: "21:30" },
            ],
            free: [
                { blockType: "morning-review", start: "08:00" },
                { blockType: "renovation", start: "10:00" },
                { blockType: "movement", start: "14:00" },
                { blockType: "deep-work", start: "19:30" },
                { blockType: "evening-review", start: "21:30" },
            ],
        },
        coverageRules: [
            {
                id: "movement-3x",
                blockType: "movement",
                minPerWeek: 3,
                label: "🏃 Movement 3×/week",
            },
            {
                id: "renovation-1x",
                blockType: "renovation",
                minPerWeek: 1,
                label: "🔨 Renovation 1×/week",
            },
            {
                id: "review-5x",
                blockType: "morning-review",
                minPerWeek: 5,
                label: "📓 Morning review 5×/week",
            },
        ],
    };
}

export async function loadTimeblockingConfig(): Promise<TimeblockingConfig> {
    await ensureNomendexDir();
    const file = Bun.file(getTimeblockingConfigPath());
    if (!(await file.exists())) {
        return buildDefaultTimeblockingConfig();
    }

    const raw = await file.json();
    return TimeblockingConfigSchema.parse(raw);
}

export async function saveTimeblockingConfig(config: TimeblockingConfig): Promise<void> {
    await ensureNomendexDir();
    const parsed = TimeblockingConfigSchema.parse(config);
    await Bun.write(getTimeblockingConfigPath(), JSON.stringify(parsed, null, 2) + "\n");
}

export async function ensureTimeblockingConfig(): Promise<TimeblockingConfig> {
    await ensureNomendexDir();
    const file = Bun.file(getTimeblockingConfigPath());
    if (await file.exists()) {
        const config = await loadTimeblockingConfig();
        logger.info("Loaded existing timeblocking config");
        return config;
    }

    const config = buildDefaultTimeblockingConfig();
    await saveTimeblockingConfig(config);
    logger.info("Created default timeblocking config");
    return config;
}
