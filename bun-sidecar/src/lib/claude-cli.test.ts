import { describe, expect, test } from "bun:test";
import { buildClaudeCliEnv, isolatedTextTransformArgs, PINNED_CLAUDE_CLI_VERSION } from "./claude-cli";

describe("claude-cli", () => {
    test("pinned CLI version matches the installed Agent SDK", async () => {
        const sdkPackageJson = new URL(
            "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json",
            import.meta.url,
        );
        const { claudeCodeVersion } = await Bun.file(sdkPackageJson).json();
        expect(PINNED_CLAUDE_CLI_VERSION).toBe(claudeCodeVersion);
    });

    test("always disables background tasks, auto-memory and bundled skills, even over an explicit override", () => {
        const env = buildClaudeCliEnv({
            CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0",
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
            CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "0",
            FOO: "bar",
        });
        expect(env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
        expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
        expect(env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS).toBe("1");
        expect(env.FOO).toBe("bar");
    });

    test("isolated text transforms replace the system prompt and pass empty --tools / --setting-sources values", () => {
        const args = isolatedTextTransformArgs("Fix the grammar.");
        expect(args.slice(0, 2)).toEqual(["--system-prompt", "Fix the grammar."]);
        expect(args).not.toContain("--append-system-prompt");
        // A missing "" would make the CLI read the next argument as the tool list
        expect(args[args.indexOf("--tools") + 1]).toBe("");
        expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
        expect(args).toContain("--no-session-persistence");
    });
});
