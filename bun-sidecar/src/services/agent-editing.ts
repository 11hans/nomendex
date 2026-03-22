/**
 * Agent Editing Service
 *
 * Provisions Claude Code hooks into the active workspace so that
 * CLI agents (like Claude Code) automatically lock/unlock note files
 * when editing them. The Nomendex backend watches for .claude-lock
 * files and pushes real-time updates to the UI via SSE.
 */

import path from "path";
import { getRootPath } from "@/storage/root-path";
import { createServiceLogger } from "@/lib/logger";

const logger = createServiceLogger("AGENT_EDITING");

// ---------------------------------------------------------------------------
// Hook script templates
// ---------------------------------------------------------------------------

const LOCK_SCRIPT = `#!/bin/bash
# PreToolUse hook: Lock a note file before Claude edits it
# Creates a .claude-lock file that the Nomendex backend watches for

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only lock markdown files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

# Only lock files that exist (don't lock new file creation before it exists)
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

LOCK_FILE="\${FILE_PATH}.claude-lock"
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date +%s)000

# Don't re-lock if already locked by this session
if [ -f "$LOCK_FILE" ]; then
  EXISTING_SESSION=$(jq -r '.sessionId // empty' "$LOCK_FILE" 2>/dev/null)
  if [ "$EXISTING_SESSION" = "$SESSION_ID" ]; then
    exit 0
  fi
fi

jq -n \\
  --arg name "Claude" \\
  --arg session "$SESSION_ID" \\
  --arg time "$TIMESTAMP" \\
  '{agentName: $name, sessionId: $session, lockedAt: ($time | tonumber)}' > "$LOCK_FILE"

exit 0
`;

const UNLOCK_SCRIPT = `#!/bin/bash
# PostToolUse hook: Unlock a note file after Claude finishes editing it
# Removes the .claude-lock file so the Nomendex backend knows the edit is done

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only handle markdown files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

LOCK_FILE="\${FILE_PATH}.claude-lock"

# Only remove if the lock file exists
if [ -f "$LOCK_FILE" ]; then
  rm -f "$LOCK_FILE"
fi

exit 0
`;

const CLEANUP_SCRIPT = `#!/bin/bash
# SessionEnd hook: Clean up any stale .claude-lock files left behind
# Safety net in case PostToolUse hooks didn't fire (e.g., interrupted session)

if [ -n "$CLAUDE_PROJECT_DIR" ]; then
  find "$CLAUDE_PROJECT_DIR" -name "*.claude-lock" -type f -delete 2>/dev/null
fi

exit 0
`;

// ---------------------------------------------------------------------------
// Hook settings that get merged into .claude/settings.json
// ---------------------------------------------------------------------------

const HOOK_SETTINGS = {
    hooks: {
        PreToolUse: [
            {
                matcher: "Edit|Write",
                hooks: [
                    {
                        type: "command",
                        command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/nomendex-lock-note.sh",
                    },
                ],
            },
        ],
        PostToolUse: [
            {
                matcher: "Edit|Write",
                hooks: [
                    {
                        type: "command",
                        command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/nomendex-unlock-note.sh",
                    },
                ],
            },
        ],
        SessionEnd: [
            {
                hooks: [
                    {
                        type: "command",
                        command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/nomendex-cleanup-locks.sh",
                    },
                ],
            },
        ],
    },
};

// Marker to identify Nomendex-managed hooks in settings.json
const NOMENDEX_HOOK_MARKER = "nomendex-lock-note.sh";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if agent editing hooks are currently provisioned in the workspace.
 */
export async function isAgentEditingEnabled(): Promise<boolean> {
    try {
        const rootPath = getRootPath();
        const settingsPath = path.join(rootPath, ".claude", "settings.json");
        const file = Bun.file(settingsPath);
        if (!(await file.exists())) return false;

        const text = await file.text();
        return text.includes(NOMENDEX_HOOK_MARKER);
    } catch {
        return false;
    }
}

/**
 * Provision Claude Code hooks into the active workspace.
 * Writes hook scripts and merges hook config into .claude/settings.json.
 */
export async function enableAgentEditing(): Promise<{ success: boolean; error?: string }> {
    try {
        const rootPath = getRootPath();
        const claudeDir = path.join(rootPath, ".claude");
        const hooksDir = path.join(claudeDir, "hooks");

        // Ensure directories exist
        await Bun.$`mkdir -p ${hooksDir}`.quiet();

        // Write hook scripts
        await Bun.write(path.join(hooksDir, "nomendex-lock-note.sh"), LOCK_SCRIPT, );
        await Bun.write(path.join(hooksDir, "nomendex-unlock-note.sh"), UNLOCK_SCRIPT);
        await Bun.write(path.join(hooksDir, "nomendex-cleanup-locks.sh"), CLEANUP_SCRIPT);

        // Make scripts executable
        await Bun.$`chmod +x ${path.join(hooksDir, "nomendex-lock-note.sh")} ${path.join(hooksDir, "nomendex-unlock-note.sh")} ${path.join(hooksDir, "nomendex-cleanup-locks.sh")}`.quiet();

        // Merge hook config into .claude/settings.json
        const settingsPath = path.join(claudeDir, "settings.json");
        const settingsFile = Bun.file(settingsPath);
        let settings: Record<string, unknown> = {};

        if (await settingsFile.exists()) {
            try {
                settings = await settingsFile.json();
            } catch {
                // If settings file is corrupt, start fresh
                logger.warn("Could not parse existing .claude/settings.json, starting fresh");
            }
        }

        // Merge hooks — preserve existing hooks, add ours
        const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

        for (const [event, hookGroups] of Object.entries(HOOK_SETTINGS.hooks)) {
            const existing = existingHooks[event] ?? [];
            // Remove any previous Nomendex hooks
            const filtered = existing.filter(
                (group) => !JSON.stringify(group).includes(NOMENDEX_HOOK_MARKER)
            );
            existingHooks[event] = [...filtered, ...hookGroups];
        }

        settings.hooks = existingHooks;
        await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");

        logger.info("Agent editing enabled", { workspace: rootPath });
        return { success: true };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to enable agent editing", { error: msg });
        return { success: false, error: msg };
    }
}

/**
 * Remove Claude Code hooks from the active workspace.
 */
export async function disableAgentEditing(): Promise<{ success: boolean; error?: string }> {
    try {
        const rootPath = getRootPath();
        const claudeDir = path.join(rootPath, ".claude");
        const hooksDir = path.join(claudeDir, "hooks");

        // Remove hook scripts
        const scripts = [
            "nomendex-lock-note.sh",
            "nomendex-unlock-note.sh",
            "nomendex-cleanup-locks.sh",
        ];
        for (const script of scripts) {
            const scriptPath = path.join(hooksDir, script);
            const file = Bun.file(scriptPath);
            if (await file.exists()) {
                await Bun.$`rm ${scriptPath}`.quiet();
            }
        }

        // Remove Nomendex hooks from settings.json
        const settingsPath = path.join(claudeDir, "settings.json");
        const settingsFile = Bun.file(settingsPath);
        if (await settingsFile.exists()) {
            try {
                const settings = await settingsFile.json();
                const hooks = settings.hooks as Record<string, unknown[]> | undefined;
                if (hooks) {
                    for (const event of Object.keys(hooks)) {
                        hooks[event] = hooks[event].filter(
                            (group) => !JSON.stringify(group).includes(NOMENDEX_HOOK_MARKER)
                        );
                        // Clean up empty arrays
                        if (hooks[event].length === 0) {
                            delete hooks[event];
                        }
                    }
                    // Clean up empty hooks object
                    if (Object.keys(hooks).length === 0) {
                        delete settings.hooks;
                    }
                }
                await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
            } catch {
                logger.warn("Could not clean settings.json during disable");
            }
        }

        // Also clean up any leftover lock files
        await Bun.$`find ${rootPath} -name "*.claude-lock" -type f -delete`.quiet();

        logger.info("Agent editing disabled", { workspace: rootPath });
        return { success: true };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to disable agent editing", { error: msg });
        return { success: false, error: msg };
    }
}
