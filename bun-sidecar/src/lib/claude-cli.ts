import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("CLAUDE-CLI");
const require = createRequire(import.meta.url);

export type ClaudeCliSource = "env-override" | "bundled" | "global-fallback";

let cachedPath: string | undefined;
let cachedSource: ClaudeCliSource = "global-fallback";

/**
 * Resolve the Claude Code CLI executable the Agent SDK should drive.
 *
 * Resolution order:
 *   1. `CLAUDE_CLI_PATH` env override — explicit escape hatch. The packaged
 *      mac app sets this to the CLI bundled in Resources/claude-cli
 *      (see SidecarLauncher.swift), because in the compiled sidecar binary
 *      `require.resolve` cannot see node_modules on disk.
 *   2. The CLI bundled with `@anthropic-ai/claude-agent-sdk` — the version this
 *      app is built and tested against. Works in dev (node_modules on disk).
 *   3. `~/.local/bin/claude` — last-resort fallback.
 *
 * Why prefer the bundled CLI over the user's global `claude`: the globally
 * installed CLI auto-updates independently of this app and can silently change
 * subagent semantics. Concretely, 2.1.x launches Task/Agent subagents as async
 * *background* tasks; because each chat message is served by one bounded
 * `query()`, the background subagent is orphaned and killed the moment the
 * assistant's turn ends — so delegated reviews (`/monthly`, `/weekly`, …) never
 * complete. Pinning to the bundled CLI keeps subagents synchronous and immune
 * to global-CLI drift.
 */
export function getClaudeCliPath(): string {
    if (cachedPath) return cachedPath;

    const override = process.env.CLAUDE_CLI_PATH;
    if (override) {
        cachedPath = override;
        cachedSource = "env-override";
        logger.info("Using Claude CLI from CLAUDE_CLI_PATH", { path: override });
        return cachedPath;
    }

    try {
        const bundled = require.resolve("@anthropic-ai/claude-agent-sdk/cli.js");
        if (existsSync(bundled)) {
            cachedPath = bundled;
            cachedSource = "bundled";
            logger.info("Using bundled Claude CLI", { path: bundled });
            return cachedPath;
        }
    } catch (err) {
        logger.warn("Failed to resolve bundled Claude CLI, falling back to ~/.local/bin/claude", {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    cachedPath = `${process.env.HOME}/.local/bin/claude`;
    cachedSource = "global-fallback";
    return cachedPath;
}

const JS_FILE_RE = /\.[cm]?js$/;

export type ClaudeCliSpawn = {
    cmd: string[];
    env: Record<string, string | undefined>;
};

/**
 * Build argv + env for spawning the Claude CLI directly (callers outside the
 * Agent SDK — the SDK builds its own spawn). A native CLI binary is executed
 * as-is. The SDK's cli.js is a JS file whose `#!/usr/bin/env node` shebang
 * cannot be relied on (GUI-launched apps have a minimal PATH; the user's node
 * lives in nvm), so it needs an explicit runtime:
 *   - `bun` from PATH (dev, or the packaged app's Resources/bin via
 *     SidecarLauncher PATH prepend), else
 *   - this very executable with BUN_BE_BUN=1 — a bun-compiled binary then
 *     behaves as plain `bun`, so the compiled sidecar can run cli.js itself.
 */
export function buildClaudeCliSpawn(args: string[]): ClaudeCliSpawn {
    const cliPath = getClaudeCliPath();
    if (!JS_FILE_RE.test(cliPath)) {
        return { cmd: [cliPath, ...args], env: process.env };
    }
    const bunFromPath = Bun.which("bun");
    if (bunFromPath) {
        return { cmd: [bunFromPath, cliPath, ...args], env: process.env };
    }
    return {
        cmd: [process.execPath, cliPath, ...args],
        env: { ...process.env, BUN_BE_BUN: "1" },
    };
}

export type ClaudeCliInfo = {
    path: string;
    source: ClaudeCliSource;
    version: string | null;
    warning: string | null;
};

let cliInfo: ClaudeCliInfo | null = null;
let cliInfoPromise: Promise<ClaudeCliInfo> | null = null;

/** Last verifyClaudeCli() result, or null while the check is still running. */
export function getCachedClaudeCliInfo(): ClaudeCliInfo | null {
    return cliInfo;
}

/**
 * Spawn `claude --version` once and log what this build is actually driving.
 * Warns loudly when the resolved CLI is >= 2.1 (backgrounds subagents — see
 * getClaudeCliPath) or when resolution fell back to the auto-updating global
 * CLI. Never rejects; the result is cached for /health.
 */
export function verifyClaudeCli(): Promise<ClaudeCliInfo> {
    if (cliInfoPromise) return cliInfoPromise;
    cliInfoPromise = (async () => {
        const path = getClaudeCliPath();
        const source = cachedSource;
        let version: string | null = null;
        const warnings: string[] = [];

        try {
            const { cmd, env } = buildClaudeCliSpawn(["--version"]);
            const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", env });
            const killTimer = setTimeout(() => proc.kill(), 15_000);
            const stdout = await new Response(proc.stdout).text();
            await proc.exited;
            clearTimeout(killTimer);
            version = stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
        } catch (err) {
            logger.warn("Claude CLI version check failed", {
                path,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        if (!version) {
            warnings.push("Claude CLI version check failed — the CLI may not be runnable from this app");
        } else {
            const [major, minor] = version.split(".").map(Number);
            if (major > 2 || (major === 2 && minor >= 1)) {
                warnings.push(
                    `Claude CLI ${version} launches subagents as background tasks; delegated reviews `
                    + "(/monthly, /weekly, …) will NOT complete. Expected a 2.0.x CLI — check "
                    + "CLAUDE_CLI_PATH and the bundled-CLI resolution",
                );
            }
        }
        if (source === "global-fallback") {
            warnings.push(
                "Resolved to the global ~/.local/bin/claude fallback, which auto-updates independently of this app",
            );
        }

        const info: ClaudeCliInfo = {
            path,
            source,
            version,
            warning: warnings.length > 0 ? warnings.join("; ") : null,
        };
        cliInfo = info;

        if (info.warning) {
            logger.error("Claude CLI verification found problems", { path, source, version, warning: info.warning });
        } else {
            logger.info("Claude CLI verified", { path, source, version });
        }
        return info;
    })().catch((err) => {
        const info: ClaudeCliInfo = {
            path: cachedPath ?? "unknown",
            source: cachedSource,
            version: null,
            warning: `Claude CLI verification crashed: ${err instanceof Error ? err.message : String(err)}`,
        };
        cliInfo = info;
        logger.error("Claude CLI verification crashed", { error: info.warning });
        return info;
    });
    return cliInfoPromise;
}
