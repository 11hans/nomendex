import { describe, expect, test } from "bun:test";
import { buildDefaultTimeblockingConfig } from "./config";
import { generateTimeblocks } from "./generate";

describe("generateTimeblocks", () => {
    test("generates timed blocks in local YYYY-MM-DDTHH:mm format", () => {
        const config = buildDefaultTimeblockingConfig();
        const blocks = generateTimeblocks(
            new Date(2026, 3, 6, 0, 0, 0, 0),
            [
                { type: "work_full" },
                { type: "work_early", workEnd: "13:00" },
                { type: "pohotovost" },
                { type: "free" },
                { type: "work_full" },
                { type: "free" },
                { type: "work_full" },
            ],
            config,
        );

        expect(blocks.length).toBeGreaterThan(0);
        expect(blocks[0]?.scheduledStart).toBe("2026-04-06T07:00");
        expect(blocks[0]?.scheduledEnd).toBe("2026-04-06T07:15");
        expect(blocks.some((block) => block.scheduledStart === "2026-04-07T13:30")).toBe(true);
    });

    test("throws when workEnd-relative block has no workEnd", () => {
        const config = buildDefaultTimeblockingConfig();
        expect(() =>
            generateTimeblocks(
                new Date(2026, 3, 6, 0, 0, 0, 0),
                [{ type: "work_early" }, { type: "work_full" }, { type: "work_full" }, { type: "work_full" }, { type: "work_full" }, { type: "work_full" }, { type: "work_full" }],
                config,
            )
        ).toThrow("Missing workEnd");
    });
});
