import { describe, expect, test } from "bun:test";
import { buildAssistantTurnEvent, extractAssistantUsage, usageCountedOnce } from "./usage-logger";

// One /daily API response: text + 4 Bash + 1 Read, which the SDK delivered as
// 6 assistant messages, each carrying the response's full usage.
const usage = { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 38275 };
const block = (id: string, content: Array<{ type: string; name?: string; thinking?: string }>) =>
    extractAssistantUsage({ message: { id, model: "claude-opus-4-7", usage, content } });

describe("usageCountedOnce", () => {
    test("counts a response split into content blocks once", () => {
        const blocks = [
            block("msg_1", [{ type: "text" }]),
            ...Array.from({ length: 4 }, () => block("msg_1", [{ type: "tool_use", name: "Bash" }])),
            block("msg_1", [{ type: "tool_use", name: "Read" }]),
        ];
        const seen = new Set<string>();
        const cost = blocks.reduce((sum, extracted) => {
            if (!extracted) throw new Error("no usage");
            const ev = buildAssistantTurnEvent({
                sessionId: "s",
                agentId: "bpagent",
                model: extracted.model,
                turnIndex: 0,
                usage: usageCountedOnce(seen, extracted),
                toolsUsed: extracted.toolsUsed,
            });
            return sum + ev.costUsdListPrice;
        }, 0);
        // Before: 6 × $0.2394 = $1.437 for a response that cost $0.2394.
        expect(cost).toBeCloseTo(0.23944375, 6);
    });

    test("counts each response and keeps per-block thinking", () => {
        const seen = new Set<string>();
        const first = block("msg_1", [{ type: "thinking", thinking: "abcdefgh" }]);
        const second = block("msg_2", [{ type: "text" }]);
        if (!first || !second) throw new Error("no usage");
        expect(usageCountedOnce(seen, first).cacheCreationTokens).toBe(38275);
        expect(usageCountedOnce(seen, second).cacheCreationTokens).toBe(38275);
        const repeat = usageCountedOnce(seen, first);
        expect(repeat.cacheCreationTokens).toBe(0);
        expect(repeat.thinkingTokens).toBe(2);
    });
});
