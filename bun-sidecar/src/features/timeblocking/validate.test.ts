import { describe, expect, test } from "bun:test";
import { buildDefaultTimeblockingConfig } from "./config";
import type { GeneratedTimeblock } from "./types";
import { checkCoverage, validateGeneratedTimeblocks } from "./validate";

function makeBlock(overrides: Partial<GeneratedTimeblock> = {}): GeneratedTimeblock {
    return {
        blockType: "movement",
        title: "🏃 Movement",
        project: "Inbox",
        tags: ["movement"],
        kind: "event",
        source: "timeblock-generator",
        scheduledStart: "2026-04-06T18:00",
        scheduledEnd: "2026-04-06T19:00",
        status: "todo",
        description: "Timeblock — weekly planner 2026-04-06",
        ...overrides,
    };
}

describe("checkCoverage", () => {
    test("returns warning for unmet rule", () => {
        const config = buildDefaultTimeblockingConfig();
        const coverage = checkCoverage([makeBlock()], config);
        const movement = coverage.find((item) => item.blockType === "movement");
        expect(movement?.actual).toBe(1);
        expect(movement?.status).toBe("warning");
    });
});

describe("validateGeneratedTimeblocks", () => {
    test("detects overlapping blocks", () => {
        const config = buildDefaultTimeblockingConfig();
        const conflicts = validateGeneratedTimeblocks(
            [
                makeBlock(),
                makeBlock({
                    blockType: "deep-work",
                    title: "🔵 Deep Work",
                    scheduledStart: "2026-04-06T18:30",
                    scheduledEnd: "2026-04-06T20:30",
                }),
            ],
            config,
            ["Inbox"],
        );
        expect(conflicts.some((conflict) => conflict.code === "overlap")).toBe(true);
    });

    test("detects missing project", () => {
        const config = buildDefaultTimeblockingConfig();
        const conflicts = validateGeneratedTimeblocks([makeBlock({ project: "Nomendex" })], config, ["Inbox"]);
        expect(conflicts.some((conflict) => conflict.code === "missing-project")).toBe(true);
    });
});
