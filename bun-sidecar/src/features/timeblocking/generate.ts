import type { DayConfig, GeneratedTimeblock, TimeblockingConfig } from "./types";

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

export function formatLocalDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatLocalDateTime(date: Date): string {
    return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function addDays(date: Date, amount: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}

function parseClockExpression(date: Date, value: string): Date | null {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
        return null;
    }
    const resolved = new Date(date);
    resolved.setHours(hours, minutes, 0, 0);
    return resolved;
}

function parseRelativeWorkEndExpression(date: Date, workEnd: string, value: string): Date | null {
    const match = value.match(/^workEnd\+(\d+)min$/);
    if (!match) return null;
    const base = parseClockExpression(date, workEnd);
    if (!base) return null;
    const minutesToAdd = Number(match[1]);
    if (!Number.isInteger(minutesToAdd)) return null;
    const resolved = new Date(base);
    resolved.setMinutes(resolved.getMinutes() + minutesToAdd);
    return resolved;
}

export function resolveBlockStart(date: Date, expression: string, workEnd?: string): Date | null {
    if (/^\d{2}:\d{2}$/.test(expression)) {
        return parseClockExpression(date, expression);
    }

    if (expression.startsWith("workEnd+")) {
        if (!workEnd) return null;
        return parseRelativeWorkEndExpression(date, workEnd, expression);
    }

    return null;
}

function buildDescription(template: string | undefined, weekStart: Date, date: Date, blockType: string): string {
    const base = template ?? "Timeblock — weekly planner {{weekStart}}";
    return base
        .replaceAll("{{weekStart}}", formatLocalDate(weekStart))
        .replaceAll("{{date}}", formatLocalDate(date))
        .replaceAll("{{blockType}}", blockType);
}

export function generateTimeblocks(
    weekStart: Date,
    days: DayConfig[],
    config: TimeblockingConfig,
): GeneratedTimeblock[] {
    const blocks: GeneratedTimeblock[] = [];

    days.forEach((dayConfig, index) => {
        const date = addDays(weekStart, index);
        const template = config.dayTemplates[dayConfig.type];

        template.forEach((entry) => {
            const blockConfig = config.blockTypes[entry.blockType];
            if (!blockConfig) {
                throw new Error(`Unknown block type '${entry.blockType}' in template '${dayConfig.type}'`);
            }

            const start = resolveBlockStart(date, entry.start, dayConfig.workEnd);
            if (!start) {
                const reason = entry.start.startsWith("workEnd+") && !dayConfig.workEnd
                    ? `Missing workEnd for '${entry.blockType}'`
                    : `Invalid start expression '${entry.start}' for '${entry.blockType}'`;
                throw new Error(reason);
            }

            const end = new Date(start);
            end.setMinutes(end.getMinutes() + blockConfig.durationMin);

            blocks.push({
                blockType: entry.blockType,
                title: blockConfig.title,
                project: blockConfig.project,
                tags: ["timeblock", ...blockConfig.tags],
                scheduledStart: formatLocalDateTime(start),
                scheduledEnd: formatLocalDateTime(end),
                status: "todo",
                description: buildDescription(blockConfig.descriptionTemplate, weekStart, date, entry.blockType),
            });
        });
    });

    return blocks;
}
