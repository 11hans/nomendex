// Dev-only usage telemetry: logs LLM call cost/tokens to JSONL outside the workspace.
// Activated by NOMENDEX_DEV_COST_HUD=1. Zero overhead when disabled.
// Log path: ~/Library/Logs/com.firstloop.nomendex/usage.jsonl (macOS convention).

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { computeCostUsd, type TokenBreakdown } from "./pricing";

// Auto-on in dev builds; can be forced on/off explicitly.
// "1" / "true" force on, "0" / "false" force off, otherwise follow NODE_ENV.
const flag = (process.env.NOMENDEX_DEV_COST_HUD ?? "").toLowerCase();
export const DEV_COST_HUD_ENABLED =
    flag === "1" || flag === "true"
        ? true
        : flag === "0" || flag === "false"
            ? false
            : process.env.NODE_ENV !== "production";

const LOG_PATH = join(homedir(), "Library", "Logs", "com.firstloop.nomendex", "usage.jsonl");

let logPathEnsured = false;
async function ensureLogPath(): Promise<void> {
    if (logPathEnsured) return;
    try {
        await mkdir(dirname(LOG_PATH), { recursive: true });
        logPathEnsured = true;
    } catch {
        // silent — dev telemetry must never break the app
    }
}

export type UsageEventKind = "assistant_turn" | "result";

export type UsageEvent = {
    timestamp: string;
    sessionId: string;
    agentId: string;
    model: string;
    turnIndex: number;
    kind: UsageEventKind;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    thinkingTokens: number;
    costUsdListPrice: number;
    durationMs?: number;
    numTurns?: number;
    toolsUsed: string[];
    messagePreview?: string;
    gitBranch?: string;
    gitSha?: string;
};

// Extract a usable usage block from an arbitrary SDK "assistant" message.
// The SDK shape has `message.usage` in Anthropic API format.
export function extractAssistantUsage(msg: unknown): {
    usage: TokenBreakdown & { thinkingTokens: number };
    model: string;
    messageId?: string;
    toolsUsed: string[];
} | null {
    if (!msg || typeof msg !== "object") return null;
    const m = msg as {
        message?: {
            id?: string;
            model?: string;
            usage?: Record<string, unknown>;
            content?: Array<{ type?: string; name?: string; thinking?: string }>;
        };
    };
    const rawUsage = m.message?.usage;
    if (!rawUsage) return null;

    const inputTokens = Number(rawUsage["input_tokens"] ?? 0);
    const outputTokens = Number(rawUsage["output_tokens"] ?? 0);
    const cacheReadTokens = Number(rawUsage["cache_read_input_tokens"] ?? 0);
    const cacheCreationTokens = Number(rawUsage["cache_creation_input_tokens"] ?? 0);

    const thinkingTokens = (m.message?.content ?? [])
        .filter((b) => b.type === "thinking")
        .reduce((acc, b) => acc + Math.ceil((b.thinking ?? "").length / 4), 0);

    const toolsUsed = (m.message?.content ?? [])
        .filter((b) => b.type === "tool_use" && typeof b.name === "string")
        .map((b) => b.name as string);

    return {
        usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens },
        model: m.message?.model ?? "",
        messageId: m.message?.id,
        toolsUsed,
    };
}

// Extract usage from SDK "result" message. Format: { total_cost_usd, usage, duration_ms, num_turns }.
export function extractResultUsage(msg: unknown): {
    usage: TokenBreakdown;
    costUsd: number;
    durationMs?: number;
    numTurns?: number;
} | null {
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Record<string, unknown>;
    const rawUsage = (m["usage"] ?? {}) as Record<string, unknown>;
    return {
        usage: {
            inputTokens: Number(rawUsage["input_tokens"] ?? 0),
            outputTokens: Number(rawUsage["output_tokens"] ?? 0),
            cacheReadTokens: Number(rawUsage["cache_read_input_tokens"] ?? 0),
            cacheCreationTokens: Number(rawUsage["cache_creation_input_tokens"] ?? 0),
        },
        costUsd: Number(m["total_cost_usd"] ?? 0),
        durationMs: m["duration_ms"] != null ? Number(m["duration_ms"]) : undefined,
        numTurns: m["num_turns"] != null ? Number(m["num_turns"]) : undefined,
    };
}

let gitContextCache: { branch?: string; sha?: string } | null = null;
async function readGitContext(): Promise<{ branch?: string; sha?: string }> {
    if (gitContextCache) return gitContextCache;
    if (!DEV_COST_HUD_ENABLED) {
        gitContextCache = {};
        return gitContextCache;
    }
    try {
        const { $ } = await import("bun");
        const branch = (await $`git rev-parse --abbrev-ref HEAD`.quiet().text()).trim();
        const sha = (await $`git rev-parse --short HEAD`.quiet().text()).trim();
        gitContextCache = { branch, sha };
    } catch {
        gitContextCache = {};
    }
    return gitContextCache;
}

export async function logUsageEvent(ev: Omit<UsageEvent, "gitBranch" | "gitSha">): Promise<void> {
    if (!DEV_COST_HUD_ENABLED) return;
    try {
        await ensureLogPath();
        const git = await readGitContext();
        const full: UsageEvent = { ...ev, gitBranch: git.branch, gitSha: git.sha };
        await appendFile(LOG_PATH, JSON.stringify(full) + "\n");
    } catch {
        // silent
    }
}

// Convenience: compute cost + build event in one call.
export function buildAssistantTurnEvent(args: {
    sessionId: string;
    agentId: string;
    model: string;
    turnIndex: number;
    usage: TokenBreakdown & { thinkingTokens: number };
    toolsUsed: string[];
    messagePreview?: string;
}): Omit<UsageEvent, "gitBranch" | "gitSha"> {
    return {
        timestamp: new Date().toISOString(),
        sessionId: args.sessionId,
        agentId: args.agentId,
        model: args.model,
        turnIndex: args.turnIndex,
        kind: "assistant_turn",
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        cacheReadTokens: args.usage.cacheReadTokens,
        cacheCreationTokens: args.usage.cacheCreationTokens,
        thinkingTokens: args.usage.thinkingTokens,
        costUsdListPrice: computeCostUsd(args.model, args.usage),
        toolsUsed: args.toolsUsed,
        messagePreview: args.messagePreview,
    };
}

export function buildResultEvent(args: {
    sessionId: string;
    agentId: string;
    model: string;
    turnIndex: number;
    usage: TokenBreakdown;
    costUsd: number;
    durationMs?: number;
    numTurns?: number;
}): Omit<UsageEvent, "gitBranch" | "gitSha"> {
    return {
        timestamp: new Date().toISOString(),
        sessionId: args.sessionId,
        agentId: args.agentId,
        model: args.model,
        turnIndex: args.turnIndex,
        kind: "result",
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        cacheReadTokens: args.usage.cacheReadTokens,
        cacheCreationTokens: args.usage.cacheCreationTokens,
        thinkingTokens: 0,
        costUsdListPrice: args.costUsd,
        durationMs: args.durationMs,
        numTurns: args.numTurns,
        toolsUsed: [],
    };
}
