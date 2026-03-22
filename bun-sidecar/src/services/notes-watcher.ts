/**
 * Notes Watcher Service
 *
 * Watches the notes directory for:
 * 1. .claude-lock file creation/deletion → updates FileLock state + broadcasts SSE
 * 2. .md file changes → broadcasts SSE so the UI can reload
 *
 * Uses fs.watch (recursive) for efficient file system monitoring.
 */

import { watch, type FSWatcher } from "node:fs";
import path from "path";
import { getNotesPath, hasActiveWorkspace, getRootPath } from "@/storage/root-path";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("NOTES_WATCHER");

// ---------------------------------------------------------------------------
// SSE Client Management
// ---------------------------------------------------------------------------

export type NoteEvent =
    | { type: "lock-acquired"; fileName: string; agentName: string; sessionId: string; lockedAt: number }
    | { type: "lock-released"; fileName: string }
    | { type: "file-changed"; fileName: string };

type SSEClient = (event: NoteEvent) => void;

const sseClients = new Set<SSEClient>();

export function addSSEClient(client: SSEClient): () => void {
    sseClients.add(client);
    return () => {
        sseClients.delete(client);
    };
}

function broadcast(event: NoteEvent): void {
    for (const client of sseClients) {
        try {
            client(event);
        } catch {
            // Client may have disconnected
            sseClients.delete(client);
        }
    }
}

// ---------------------------------------------------------------------------
// File Watcher
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;

// Debounce map to avoid duplicate events from fs.watch
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 100;

function debounced(key: string, fn: () => void): void {
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
        key,
        setTimeout(() => {
            debounceTimers.delete(key);
            fn();
        }, DEBOUNCE_MS)
    );
}

/**
 * Resolve a filename relative to the notes path.
 * The watcher may report paths relative to the watched dir or as absolute paths.
 */
function resolveRelativeName(filename: string, notesPath: string): string {
    if (path.isAbsolute(filename)) {
        return path.relative(notesPath, filename);
    }
    return filename;
}

async function handleFSEvent(_event: string, filename: string | null): Promise<void> {
    if (!filename) return;

    const notesPath = getNotesPath();
    const relativeName = resolveRelativeName(filename, notesPath);

    // Handle .claude-lock files
    if (relativeName.endsWith(".claude-lock")) {
        const noteFileName = relativeName.replace(/\.claude-lock$/, "");
        const lockFilePath = path.join(notesPath, relativeName);

        debounced(`lock:${noteFileName}`, async () => {
            try {
                const file = Bun.file(lockFilePath);
                if (await file.exists()) {
                    // Lock file created — read it and broadcast
                    const lockData = await file.json();
                    broadcast({
                        type: "lock-acquired",
                        fileName: noteFileName,
                        agentName: lockData.agentName ?? "Unknown Agent",
                        sessionId: lockData.sessionId ?? "unknown",
                        lockedAt: lockData.lockedAt ?? Date.now(),
                    });
                    logger.info("Lock acquired", { noteFileName, agent: lockData.agentName });
                } else {
                    // Lock file removed — broadcast release
                    broadcast({ type: "lock-released", fileName: noteFileName });
                    logger.info("Lock released", { noteFileName });
                }
            } catch (error) {
                logger.error("Error processing lock file event", {
                    filename: relativeName,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });
        return;
    }

    // Handle .md file changes (but not lock files)
    if (relativeName.endsWith(".md")) {
        debounced(`file:${relativeName}`, () => {
            broadcast({ type: "file-changed", fileName: relativeName });
            logger.debug("File changed", { fileName: relativeName });
        });
    }
}

/**
 * Start watching the notes directory for lock files and content changes.
 * Safe to call multiple times — stops any existing watcher first.
 */
export function startNotesWatcher(): void {
    stopNotesWatcher();

    if (!hasActiveWorkspace()) {
        logger.info("No active workspace, skipping notes watcher");
        return;
    }

    // Watch both the notes path and the root path to cover both notesLocation settings
    const notesPath = getNotesPath();
    const rootPath = getRootPath();

    // Also watch root if notes are at root (Obsidian-compatible mode)
    // to catch lock files that might be created outside the notes subdirectory
    const watchPath = notesPath === rootPath ? rootPath : notesPath;

    try {
        watcher = watch(watchPath, { recursive: true }, (event, filename) => {
            handleFSEvent(event, filename).catch((error) => {
                logger.error("Unhandled error in FS event handler", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        });

        watcher.on("error", (error) => {
            logger.error("File watcher error", {
                error: error instanceof Error ? error.message : String(error),
            });
        });

        logger.info("Notes watcher started", { path: watchPath });
    } catch (error) {
        logger.error("Failed to start notes watcher", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Stop the file watcher and clean up timers.
 */
export function stopNotesWatcher(): void {
    if (watcher) {
        watcher.close();
        watcher = null;
    }
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();
}

/**
 * Get the number of connected SSE clients (for diagnostics).
 */
export function getSSEClientCount(): number {
    return sseClients.size;
}
