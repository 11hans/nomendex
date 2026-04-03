import type {
    CoverageResult,
    GeneratedTimeblock,
    TimeblockingConfig,
    TimeblockingConflict,
} from "./types";

function parseLocalDateTime(value: string): Date | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
    const parsed = new Date(
        Number(yearStr),
        Number(monthStr) - 1,
        Number(dayStr),
        Number(hourStr),
        Number(minuteStr),
        0,
        0,
    );
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function checkCoverage(
    blocks: GeneratedTimeblock[],
    config: TimeblockingConfig,
): CoverageResult[] {
    return config.coverageRules.map((rule) => {
        const actual = blocks.filter((block) => block.blockType === rule.blockType).length;
        return {
            id: rule.id,
            blockType: rule.blockType,
            label: rule.label,
            minPerWeek: rule.minPerWeek,
            actual,
            status: actual >= rule.minPerWeek ? "ok" : "warning",
        };
    });
}

export function validateGeneratedTimeblocks(
    blocks: GeneratedTimeblock[],
    config: TimeblockingConfig,
    availableProjects?: Iterable<string>,
): TimeblockingConflict[] {
    const conflicts: TimeblockingConflict[] = [];
    const availableProjectSet = availableProjects ? new Set(availableProjects) : null;

    for (const block of blocks) {
        if (!config.blockTypes[block.blockType]) {
            conflicts.push({
                code: "unknown-block-type",
                blockType: block.blockType,
                message: `Unknown block type '${block.blockType}'`,
                scheduledStart: block.scheduledStart,
            });
            continue;
        }

        const start = parseLocalDateTime(block.scheduledStart);
        const end = parseLocalDateTime(block.scheduledEnd);
        if (!start || !end) {
            conflicts.push({
                code: "invalid-time-expression",
                blockType: block.blockType,
                message: `Invalid scheduled time for '${block.blockType}'`,
                scheduledStart: block.scheduledStart,
                scheduledEnd: block.scheduledEnd,
            });
            continue;
        }

        if (start.getTime() >= end.getTime()) {
            conflicts.push({
                code: "invalid-range",
                blockType: block.blockType,
                message: `Invalid range for '${block.blockType}'`,
                scheduledStart: block.scheduledStart,
                scheduledEnd: block.scheduledEnd,
            });
        }

        if (start.toDateString() !== end.toDateString()) {
            conflicts.push({
                code: "crosses-midnight",
                blockType: block.blockType,
                message: `Block '${block.blockType}' crosses midnight`,
                scheduledStart: block.scheduledStart,
                scheduledEnd: block.scheduledEnd,
            });
        }

        if (availableProjectSet && !availableProjectSet.has(block.project)) {
            conflicts.push({
                code: "missing-project",
                blockType: block.blockType,
                message: `Project '${block.project}' does not exist`,
                scheduledStart: block.scheduledStart,
                scheduledEnd: block.scheduledEnd,
                details: block.project,
            });
        }
    }

    const byDay = new Map<string, GeneratedTimeblock[]>();
    for (const block of blocks) {
        const day = block.scheduledStart.slice(0, 10);
        const dayBlocks = byDay.get(day) ?? [];
        dayBlocks.push(block);
        byDay.set(day, dayBlocks);
    }

    for (const [day, dayBlocks] of byDay.entries()) {
        const sorted = [...dayBlocks].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1];
            const current = sorted[index];
            if (previous.scheduledEnd > current.scheduledStart) {
                conflicts.push({
                    code: "overlap",
                    blockType: current.blockType,
                    day,
                    message: `Blocks overlap on ${day}`,
                    scheduledStart: current.scheduledStart,
                    scheduledEnd: current.scheduledEnd,
                    details: `${previous.title} overlaps ${current.title}`,
                });
            }
        }
    }

    return conflicts;
}
