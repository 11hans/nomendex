import { describe, expect, it } from "bun:test";
import { isProtectedFromStaging } from "./git";

describe("git staging guard", () => {
    it("protects workspace secrets from staging", () => {
        expect(isProtectedFromStaging(".nomendex/secrets.json")).toBe(true);
    });

    it("protects normalized path variants", () => {
        expect(isProtectedFromStaging("./.nomendex/secrets.json")).toBe(true);
        expect(isProtectedFromStaging(".nomendex\\secrets.json")).toBe(true);
    });

    it("does not protect other workspace files", () => {
        expect(isProtectedFromStaging(".nomendex/workspace.json")).toBe(false);
        expect(isProtectedFromStaging(".nomendex/projects.json")).toBe(false);
        expect(isProtectedFromStaging("notes/secrets.json")).toBe(false);
        expect(isProtectedFromStaging("secrets.json")).toBe(false);
        expect(isProtectedFromStaging("todos/task.md")).toBe(false);
    });
});
