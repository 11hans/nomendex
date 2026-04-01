import { startupLog } from "./lib/logger";
import { getRootPath, getNomendexPath, getTodosPath, getNotesPath, getUploadsPath, getSkillsPath, hasActiveWorkspace, getActiveWorkspacePath } from "./storage/root-path";
import { mkdir, stat } from "node:fs/promises";
import { initializeBacklinksWithData } from "./features/notes/backlinks-service";
import { initializeTagsWithData } from "./features/notes/tags-service";
import { scanAndExtractAll } from "./features/notes/notes-indexer";
import { initializeDefaultSkills } from "./services/default-skills";
import { clearFileLocks } from "./services/file-locks";
import type { SkillUpdateCheckResult } from "./services/skills-types";

/**
 * Safely create a directory with error logging.
 * Returns true if successful, false if failed.
 */
async function ensureDirectory(params: { path: string; label: string }): Promise<boolean> {
    const { path, label } = params;
    try {
        await mkdir(path, { recursive: true });
        startupLog.info(`${label} directory verified: ${path}`);
        return true;
    } catch (error) {
        startupLog.error(`Failed to create ${label} directory`, {
            path,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

export async function onStartup(): Promise<SkillUpdateCheckResult | null> {
    startupLog.info("=== Server Startup Sequence ===");
    startupLog.info("Starting initialization...");

    // Add startup tasks here
    startupLog.info("Checking environment...");
    startupLog.info(`Node environment: ${process.env.NODE_ENV || "development"}`);
    startupLog.info(`Bun version: ${Bun.version}`);
    startupLog.info(`Platform: ${process.platform}`);
    startupLog.info(`Working directory: ${process.cwd()}`);

    clearFileLocks();

    // Only create directories if we have an active workspace
    if (!hasActiveWorkspace()) {
        startupLog.info("No active workspace configured - skipping directory creation");
        startupLog.info("=== Startup Sequence Complete ===");
        return null;
    }

    const workspacePath = getActiveWorkspacePath();
    startupLog.info(`Active workspace path: ${workspacePath}`);

    // Validate workspace path exists and is a directory.
    // Uses stat() rather than access(R_OK|W_OK) because the write-permission check
    // triggers a stricter macOS TCC evaluation that can return EPERM on iCloud Drive
    // paths even when the folder is fully accessible via the Finder.
    // Actual write failures will surface naturally when we create subdirectories below.
    //
    // iCloud daemon may take several seconds to mount after login, so retry with backoff.
    startupLog.info("Validating workspace path...");
    {
        const RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 15000]; // total wait up to ~32 s
        let lastError: unknown;
        let accessible = false;

        for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
            const delay = RETRY_DELAYS_MS[attempt]!;
            if (delay > 0) {
                startupLog.info(`Workspace not yet accessible - retrying in ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`, { path: workspacePath });
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            try {
                const s = await stat(workspacePath!);
                if (!s.isDirectory()) {
                    throw new Error(`Workspace path is not a directory: ${workspacePath}`);
                }
                accessible = true;
                startupLog.info("Workspace path is accessible", { attempt: attempt + 1 });
                break;
            } catch (error) {
                lastError = error;
                const code = (error as NodeJS.ErrnoException).code;
                // Only retry on EPERM / EACCES - these are the transient iCloud timing errors.
                // For ENOENT (path truly missing) or wrong type, fail immediately.
                if (code !== "EPERM" && code !== "EACCES") {
                    break;
                }
            }
        }

        if (!accessible) {
            startupLog.error("Workspace path is not accessible after retries", {
                path: workspacePath,
                error: lastError instanceof Error ? lastError.message : String(lastError),
            });
            startupLog.error("Startup cannot continue - workspace path invalid or inaccessible");
            startupLog.info("=== Startup Sequence Failed ===");
            throw new Error(`Workspace path not accessible: ${workspacePath}`);
        }
    }

    // Ensure root directory and feature folders exist (with granular error handling)
    startupLog.info("Ensuring directories exist...");

    const rootPath = getRootPath();
    const rootOk = await ensureDirectory({ path: rootPath, label: "Root" });
    if (!rootOk) {
        startupLog.error("Cannot continue without root directory");
        throw new Error(`Failed to create root directory: ${rootPath}`);
    }

    const todosOk = await ensureDirectory({ path: getTodosPath(), label: "Todos" });
    const notesOk = await ensureDirectory({ path: getNotesPath(), label: "Notes" });
    const uploadsOk = await ensureDirectory({ path: getUploadsPath(), label: "Uploads" });
    const nomendexOk = await ensureDirectory({ path: getNomendexPath(), label: ".nomendex" });
    const skillsOk = await ensureDirectory({ path: getSkillsPath(), label: ".claude/skills" });

    // Log summary of directory creation
    const allDirsOk = todosOk && notesOk && uploadsOk && nomendexOk && skillsOk;
    if (!allDirsOk) {
        startupLog.warn("Some directories failed to create - app may have reduced functionality");
    }

    // Create .gitignore if it doesn't exist
    try {
        const gitignorePath = `${rootPath}/.gitignore`;
        const gitignoreFile = Bun.file(gitignorePath);
        if (!(await gitignoreFile.exists())) {
            await Bun.write(gitignorePath, ".nomendex/\n");
            startupLog.info(`.gitignore created at: ${gitignorePath}`);
        } else {
            // Check if specific files are in .gitignore
            let content = await gitignoreFile.text();

            const ignoreLines = [
                ".nomendex/secrets.json",
                ".nomendex/workspace.json",
                ".nomendex/backlinks.json",
                ".nomendex/tags.json",
                ".nomendex/agent-memory/",
            ];

            let changed = false;
            for (const line of ignoreLines) {
                if (!content.includes(line)) {
                    content = content.trimEnd() + "\n" + line;
                    changed = true;
                }
            }

            // Remove old .nomendex/ if it exists to allow projects.json to be committed
            if (content.includes(".nomendex/\n") || content.endsWith(".nomendex/")) {
                content = content.replace(/^\.nomendex\/\n?/m, "");
                changed = true;
            }

            if (changed) {
                await Bun.write(gitignorePath, content.trimEnd() + "\n");
                startupLog.info("Updated .gitignore to allow projects.json");
            }
        }
    } catch (error) {
        startupLog.warn("Failed to create/update .gitignore", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Unified file scanning and index initialization
    // Scans files once, filters online-only files, extracts wiki links and tags in one pass
    startupLog.info("Scanning and indexing files...");
    try {
        const scanResult = await scanAndExtractAll({ notesOnly: false });

        if (scanResult.skippedOnlineOnly > 0) {
            startupLog.info(`Skipped ${scanResult.skippedOnlineOnly} online-only cloud files`);
        }
        if (scanResult.skippedErrors > 0) {
            startupLog.warn(`Failed to access ${scanResult.skippedErrors} files`);
        }

        startupLog.info(`Scanned ${scanResult.files.length} files`);

        // Initialize backlinks from scanned data
        startupLog.info("Building backlinks index...");
        const backlinksResult = await initializeBacklinksWithData({ files: scanResult.files });
        startupLog.info(`Backlinks index: ${backlinksResult.updated} updated, ${backlinksResult.total} total files`);

        // Initialize tags from scanned data
        startupLog.info("Building tags index...");
        const tagsResult = await initializeTagsWithData({ files: scanResult.files });
        startupLog.info(`Tags index: ${tagsResult.updated} updated, ${tagsResult.tagCount} unique tags`);

    } catch (error) {
        startupLog.error("Failed to initialize file indexes", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize projects (migration)
    startupLog.info("Checking project migration status...");
    try {
        const { migrateProjects } = await import("./features/projects/projects-migration");
        await migrateProjects();
    } catch (error) {
        startupLog.error("Failed to run project migration", {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    // Initialize default skills
    startupLog.info("Initializing default skills...");
    let skillUpdateResult: SkillUpdateCheckResult | null = null;
    try {
        skillUpdateResult = await initializeDefaultSkills();
        startupLog.info("Default skills initialized");
    } catch (error) {
        startupLog.error("Failed to initialize default skills", {
            error: error instanceof Error ? error.message : String(error),
        });
        // Non-fatal - continue startup
    }

    // Initialize projects (migration) - already done above, skip duplicate
    // Note: This duplicate was removed as migration happens at line 167-176

    startupLog.info("Initialization complete");
    startupLog.info("=== Startup Sequence Complete ===");

    return skillUpdateResult;
}
