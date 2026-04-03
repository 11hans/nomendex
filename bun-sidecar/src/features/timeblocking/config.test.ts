import { describe, expect, test } from "bun:test";
import { buildDefaultTimeblockingConfig } from "./config";
import { TimeblockingConfigSchema } from "./types";

describe("buildDefaultTimeblockingConfig", () => {
    test("returns schema-valid config", () => {
        const config = buildDefaultTimeblockingConfig();
        expect(TimeblockingConfigSchema.parse(config)).toEqual(config);
    });

    test("uses Inbox as default project mapping", () => {
        const config = buildDefaultTimeblockingConfig();
        expect(Object.values(config.blockTypes).every((block) => block.project === "Inbox")).toBe(true);
    });
});
