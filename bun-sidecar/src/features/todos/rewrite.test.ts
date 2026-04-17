import { describe, expect, mock, test, beforeEach, spyOn } from "bun:test";
import { NoClaudeCliError, rewriteTodoDraft } from "./rewrite";
import * as fs from "node:fs";

// Mock fs.existsSync
const existsSyncSpy = spyOn(fs, "existsSync");

function makeProc(stdout: string, exitCode: number = 0) {
    const enc = new TextEncoder();
    return {
        stdout: new ReadableStream({ start(c) { c.enqueue(enc.encode(stdout)); c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        exited: Promise.resolve(exitCode),
        kill: mock(() => {}),
    };
}

function makeSuccessOutput(title: string, description: string): string {
    return JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: { title, description },
        usage: {},
    });
}

let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
    existsSyncSpy.mockReturnValue(true);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(makeProc(
        makeSuccessOutput("Rewritten Title", "Rewritten description."),
    ) as unknown as ReturnType<typeof Bun.spawn>);
    spawnSpy.mockClear();
});

describe("rewriteTodoDraft", () => {
    test("throws 400 when both title and description are empty", async () => {
        await expect(rewriteTodoDraft({ title: "  ", description: "  ", kind: "task" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    test("throws 400 when title is empty string and no description", async () => {
        await expect(rewriteTodoDraft({ title: "", kind: "task" }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    test("throws NoClaudeCliError (503) when CLI not found", async () => {
        existsSyncSpy.mockReturnValue(false);
        await expect(rewriteTodoDraft({ title: "Fix bug", kind: "task" }))
            .rejects.toBeInstanceOf(NoClaudeCliError);
    });

    test("NoClaudeCliError has statusCode 503", () => {
        expect(new NoClaudeCliError().statusCode).toBe(503);
    });

    test("passes task system prompt containing actionable language", async () => {
        await rewriteTodoDraft({ title: "Fix the login bug", kind: "task" });
        const args = spawnSpy.mock.calls[0][0] as string[];
        const systemIdx = args.indexOf("--append-system-prompt");
        expect(systemIdx).toBeGreaterThan(-1);
        expect(args[systemIdx + 1]).toContain("actionable");
    });

    test("passes event system prompt with factual tone", async () => {
        await rewriteTodoDraft({ title: "Team meeting", kind: "event" });
        const args = spawnSpy.mock.calls[0][0] as string[];
        const systemIdx = args.indexOf("--append-system-prompt");
        expect(args[systemIdx + 1]).toContain("factual");
        expect(args[systemIdx + 1]).not.toContain("actionable");
    });

    test("returns rewritten title and description on success", async () => {
        const result = await rewriteTodoDraft({ title: "Fix bug", kind: "task" });
        expect(result).toEqual({ title: "Rewritten Title", description: "Rewritten description." });
    });

    test("falls back to original title when model returns empty title", async () => {
        spawnSpy.mockReturnValue(makeProc(
            makeSuccessOutput("   ", "Some desc."),
        ) as unknown as ReturnType<typeof Bun.spawn>);
        const result = await rewriteTodoDraft({ title: "Original title", kind: "task" });
        expect(result.title).toBe("Original title");
        expect(result.description).toBe("Some desc.");
    });

    test("throws 500 on non-zero exit code", async () => {
        spawnSpy.mockReturnValue(makeProc("", 1) as unknown as ReturnType<typeof Bun.spawn>);
        await expect(rewriteTodoDraft({ title: "Fix bug", kind: "task" }))
            .rejects.toMatchObject({ statusCode: 500 });
    });

    test("throws 500 on unparseable output", async () => {
        spawnSpy.mockReturnValue(makeProc("not json", 0) as unknown as ReturnType<typeof Bun.spawn>);
        await expect(rewriteTodoDraft({ title: "Fix bug", kind: "task" }))
            .rejects.toMatchObject({ statusCode: 500 });
    });

    test("trims whitespace from title and description before sending", async () => {
        await rewriteTodoDraft({ title: "  Fix bug  ", description: "  some detail  ", kind: "task" });
        const args = spawnSpy.mock.calls[0][0] as string[];
        const prompt = args[args.length - 1];
        expect(prompt).toContain("<title>Fix bug</title>");
        expect(prompt).toContain("<description>some detail</description>");
    });

    test("registers abort listener on the signal", async () => {
        const ac = new AbortController();
        const addEventListenerSpy = spyOn(ac.signal, "addEventListener");
        await rewriteTodoDraft({ title: "Do something", kind: "task", signal: ac.signal });
        expect(addEventListenerSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    });
});
