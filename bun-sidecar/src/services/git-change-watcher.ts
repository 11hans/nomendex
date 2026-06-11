/**
 * Git Change Watcher Service
 *
 * Watches the workspace root for file changes and records a "last change"
 * timestamp. The frontend auto-sync (GHSyncContext) polls the cheap
 * /api/git/local-changes endpoint instead of running a full git status
 * (worktree statusMatrix walk) every 3 seconds.
 *
 * Events under .git/ are ignored so git's own bookkeeping doesn't count as
 * a workspace change. Working-tree files modified by pull/checkout DO fire
 * events — the frontend confirms with a single full status before syncing,
 * so those don't cause sync loops.
 */

import { watch, type FSWatcher } from "node:fs";
import path from "path";
import { getRootPath, hasActiveWorkspace } from "@/storage/root-path";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("GIT_CHANGE_WATCHER");

let watcher: FSWatcher | null = null;
let lastChangeAt: number | null = null;

function isGitInternalPath(filename: string): boolean {
    const normalized = filename.split(path.sep).join("/");
    return normalized === ".git" || normalized.startsWith(".git/") || normalized.includes("/.git/");
}

/**
 * Start watching the workspace root for changes.
 * Safe to call multiple times — stops any existing watcher first.
 */
export function startGitChangeWatcher(): void {
    stopGitChangeWatcher();

    if (!hasActiveWorkspace()) {
        logger.info("No active workspace, skipping git change watcher");
        return;
    }

    const rootPath = getRootPath();

    try {
        watcher = watch(rootPath, { recursive: true }, (_event, filename) => {
            // Unknown filename — be conservative and treat it as a change
            if (filename && isGitInternalPath(filename)) return;
            lastChangeAt = Date.now();
        });

        watcher.on("error", (error) => {
            logger.error("Git change watcher error", {
                error: error instanceof Error ? error.message : String(error),
            });
        });

        // Seed with the start time so a workspace that's already dirty at
        // startup still triggers one frontend confirmation pass.
        lastChangeAt = Date.now();
        logger.info("Git change watcher started", { path: rootPath });
    } catch (error) {
        watcher = null;
        logger.error("Failed to start git change watcher", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export function stopGitChangeWatcher(): void {
    if (watcher) {
        watcher.close();
        watcher = null;
    }
}

/**
 * Current change state for /api/git/local-changes. When watcherActive is
 * false the frontend falls back to polling the full git status.
 */
export function getGitChangeState(): { lastChangeAt: number | null; watcherActive: boolean } {
    return { lastChangeAt, watcherActive: watcher !== null };
}
