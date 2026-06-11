import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getRootPath } from "@/storage/root-path";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("CLAUDE-SESSIONS");

export function getClaudeProjectsRoot(): string {
    return `${process.env.HOME}/.claude/projects`;
}

/**
 * Claude Code derives the project directory name by replacing every
 * non-alphanumeric character of the workspace path with "-" — not just
 * slashes: spaces, dots, and "~" too, keeping the leading dash.
 * "/Users/foo/My Vault" -> "-Users-foo-My-Vault".
 */
export function claudeProjectDirName(workspacePath: string): string {
    return workspacePath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Session history directory for the active workspace. */
export function getClaudeSessionsDir(): string {
    return join(getClaudeProjectsRoot(), claudeProjectDirName(getRootPath()));
}

/**
 * Locate a session history file: the active workspace's project directory
 * first, then every other project directory under ~/.claude/projects (the
 * session may predate a workspace move or rename).
 */
export async function findSessionFilePath(sessionId: string): Promise<string | null> {
    const preferred = join(getClaudeSessionsDir(), `${sessionId}.jsonl`);
    if (existsSync(preferred)) return preferred;

    const projectsRoot = getClaudeProjectsRoot();
    if (!existsSync(projectsRoot)) return null;

    const direct = join(projectsRoot, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;

    try {
        const entries = await readdir(projectsRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`);
            if (existsSync(candidate)) return candidate;
        }
    } catch (error) {
        logger.warn("Failed while searching for session history file", {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    return null;
}
