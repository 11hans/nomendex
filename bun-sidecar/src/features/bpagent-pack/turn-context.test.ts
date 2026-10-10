import { describe, expect, test } from "bun:test";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { buildTurnContextHook, getDeliveredTurnContext } from "./turn-context";

function promptSubmit(sessionId: string): HookInput {
    return {
        hook_event_name: "UserPromptSubmit",
        prompt: "hi",
        session_id: sessionId,
        transcript_path: "/dev/null",
        cwd: "/",
    };
}

async function contextFor(hook: ReturnType<typeof buildTurnContextHook>, sessionId: string): Promise<string | undefined> {
    const out = await hook(promptSubmit(sessionId), undefined, { signal: new AbortController().signal });
    if (!("hookSpecificOutput" in out) || out.hookSpecificOutput?.hookEventName !== "UserPromptSubmit") return undefined;
    return out.hookSpecificOutput.additionalContext;
}

describe("buildTurnContextHook", () => {
    test("first message gets the daily block and recall; the session remembers both", async () => {
        const hook = buildTurnContextHook({ daily: "<daily>a</daily>", memoryBlock: "<m>1</m>", memoryIds: ["m1"], previous: undefined });
        expect(await contextFor(hook, "s1")).toBe("<daily>a</daily>\n\n<m>1</m>");
        const delivered = getDeliveredTurnContext("s1");
        expect(delivered?.daily).toBe("<daily>a</daily>");
        expect([...(delivered?.memoryIds ?? [])]).toEqual(["m1"]);
    });

    test("a resumed message skips an unchanged daily block and accumulates memory ids", async () => {
        const first = buildTurnContextHook({ daily: "<daily>a</daily>", memoryBlock: "", memoryIds: ["m1"], previous: undefined });
        await contextFor(first, "s2");
        const second = buildTurnContextHook({ daily: "<daily>a</daily>", memoryBlock: "<m>2</m>", memoryIds: ["m2"], previous: getDeliveredTurnContext("s2") });
        expect(await contextFor(second, "s2")).toBe("<m>2</m>");
        expect([...(getDeliveredTurnContext("s2")?.memoryIds ?? [])].sort()).toEqual(["m1", "m2"]);

        const third = buildTurnContextHook({ daily: "<daily>b</daily>", memoryBlock: "", memoryIds: [], previous: getDeliveredTurnContext("s2") });
        expect(await contextFor(third, "s2")).toBe("<daily>b</daily>");
    });

    test("nothing new means no additional context", async () => {
        const first = buildTurnContextHook({ daily: "<daily>a</daily>", memoryBlock: "", memoryIds: [], previous: undefined });
        await contextFor(first, "s3");
        const again = buildTurnContextHook({ daily: null, memoryBlock: "", memoryIds: [], previous: getDeliveredTurnContext("s3") });
        expect(await contextFor(again, "s3")).toBeUndefined();
        expect(getDeliveredTurnContext("s3")?.daily).toBe("<daily>a</daily>");
    });
});
