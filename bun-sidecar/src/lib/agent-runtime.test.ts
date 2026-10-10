import { describe, expect, test } from "bun:test";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { buildHeadlessToolGate } from "./agent-runtime";

function preToolUse(toolName: string): HookInput {
    return {
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: {},
        tool_use_id: "toolu_test",
        session_id: "s",
        transcript_path: "/dev/null",
        cwd: "/",
    };
}

async function decide(gate: ReturnType<typeof buildHeadlessToolGate>, toolName: string): Promise<string | undefined> {
    const out = await gate(preToolUse(toolName), "toolu_test", { signal: new AbortController().signal });
    if (!("hookSpecificOutput" in out) || out.hookSpecificOutput?.hookEventName !== "PreToolUse") return undefined;
    return out.hookSpecificOutput.permissionDecision;
}

describe("buildHeadlessToolGate", () => {
    const gate = buildHeadlessToolGate({
        allowedTools: new Set(["Bash", "mcp__linear__list_issues"]),
        toolPolicy: "deny-unapproved",
        deniedMessage: "nope",
    });

    test("denies ungranted tools the CLI would auto-approve", async () => {
        expect(await decide(gate, "Read")).toBe("deny");
        expect(await decide(gate, "Grep")).toBe("deny");
        expect(await decide(gate, "Write")).toBe("deny");
    });

    test("lets granted and session-internal tools through", async () => {
        expect(await decide(gate, "Bash")).toBeUndefined();
        expect(await decide(gate, "mcp__linear__list_issues")).toBeUndefined();
        expect(await decide(gate, "ToolSearch")).toBeUndefined();
        expect(await decide(gate, "Agent")).toBeUndefined();
    });

    test("always denies AskUserQuestion, even when granted or unrestricted", async () => {
        const open = buildHeadlessToolGate({
            allowedTools: new Set(["AskUserQuestion"]),
            toolPolicy: "allow-unapproved",
            deniedMessage: "nope",
        });
        expect(await decide(open, "AskUserQuestion")).toBe("deny");
        expect(await decide(open, "Read")).toBeUndefined();
    });
});
