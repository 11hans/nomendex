import { describe, expect, test } from "bun:test";
import { areViewsEquivalent } from "./useWorkspace";

describe("areViewsEquivalent", () => {
    test("treats goals browser/default as equivalent", () => {
        expect(areViewsEquivalent("goals", "default", "browser")).toBe(true);
        expect(areViewsEquivalent("goals", "browser", "default")).toBe(true);
    });

    test("does not treat detail as browser-equivalent", () => {
        expect(areViewsEquivalent("goals", "detail", "browser")).toBe(false);
    });

    test("keeps non-browser plugins strict", () => {
        expect(areViewsEquivalent("todos", "default", "browser")).toBe(false);
    });
});
