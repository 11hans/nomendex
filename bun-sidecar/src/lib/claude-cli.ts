import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("CLAUDE-CLI");
const require = createRequire(import.meta.url);

/**
 * Claude Code version that ships with the pinned `@anthropic-ai/claude-agent-sdk`
 * (its package.json `claudeCodeVersion`). Bump together with the SDK pin —
 * claude-cli.test.ts fails when the two drift apart.
 */
export const PINNED_CLAUDE_CLI_VERSION = "2.1.296";

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
 *   2. The native CLI binary shipped with `@anthropic-ai/claude-agent-sdk`
 *      (platform package `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) —
 *      the version this app is built and tested against. Works in dev
 *      (node_modules on disk).
 *   3. `~/.local/bin/claude` — last-resort fallback.
 *
 * Why prefer the bundled CLI over the user's global `claude`: the globally
 * installed CLI auto-updates independently of this app and can silently change
 * behavior the app depends on (e.g. background subagents — see
 * buildClaudeCliEnv).
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
        const bundled = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
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

/**
 * Environment for every Claude CLI process this app starts — Agent SDK
 * `options.env` as well as direct spawns.
 *
 * Each chat message is served by one bounded `query()`. Since CLI 2.1,
 * Task/Agent subagents can launch as async *background* tasks; such a task is
 * orphaned and killed the moment the assistant's turn ends, so delegated
 * reviews (`/monthly`, `/weekly`, …) never complete.
 * `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` keeps them synchronous.
 *
 * CLI 2.1 also added Claude Code's own auto-memory (would compete with the
 * app's agent-memory) and bundled developer skills (/debug, /simplify,
 * /update-config, …) that have no place in the app's agents — both off.
 */
export function buildClaudeCliEnv(
    overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
    return {
        ...process.env,
        ...overrides,
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    };
}

export type ClaudeCliSpawn = {
    cmd: string[];
    env: Record<string, string | undefined>;
};

/**
 * Build argv + env for spawning the Claude CLI directly (callers outside the
 * Agent SDK — the SDK builds its own spawn). The CLI is a native binary, so it
 * is executed as-is.
 */
export function buildClaudeCliSpawn(args: string[]): ClaudeCliSpawn {
    return { cmd: [getClaudeCliPath(), ...args], env: buildClaudeCliEnv() };
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
 * Warns loudly when the resolved CLI is not the pinned version (see
 * PINNED_CLAUDE_CLI_VERSION) or when resolution fell back to the auto-updating
 * global CLI. Never rejects; the result is cached for /health.
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
        } else if (version !== PINNED_CLAUDE_CLI_VERSION) {
            warnings.push(
                `Claude CLI ${version} is not the version this app is built against `
                + `(${PINNED_CLAUDE_CLI_VERSION}) — check CLAUDE_CLI_PATH and the bundled-CLI resolution`,
            );
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
