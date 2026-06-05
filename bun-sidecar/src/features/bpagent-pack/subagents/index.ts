import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import type { VaultConfig } from "@/features/bpagent-pack/built-in-bpagent";
import { buildWeeklyReviewer } from "./weekly-reviewer";
import { buildMonthlyReviewer } from "./monthly-reviewer";
import { buildGoalAligner } from "./goal-aligner";
import { buildInboxProcessor } from "./inbox-processor";
import { buildNoteOrganizer } from "./note-organizer";

export function apiBaseUrlBlock(port: number): string {
    return `## API Base URL

All API endpoints are available at \`http://localhost:${port}\`. The port is already resolved — do **not** read \`serverport.json\`.`;
}

/**
 * Build programmatic subagents for BPagent.
 * These are passed to the SDK's `agents` option and invokable via the Task tool.
 *
 * Prompts sourced from BPagent-workspace/agents/*.md
 */
export function buildBpagentSubagents(input?: {
    notesPath: string;
    config: VaultConfig | null;
    port: number;
}): Record<string, AgentDefinition> {
    const notesPath = input?.notesPath ?? ".";
    const folderMapping = input?.config?.folderMapping;
    const port = input?.port ?? 1234;

    const dailyNotesDir = path.join(notesPath, folderMapping?.dailyNotes ?? "daily-notes");
    const goalsDir = path.join(notesPath, folderMapping?.goals ?? "Goals");
    const projectsDir = path.join(notesPath, folderMapping?.projects ?? "Projects");
    const inboxDir = path.join(notesPath, folderMapping?.inbox ?? "Inbox");

    return {
        "weekly-reviewer": buildWeeklyReviewer({ port, dailyNotesDir, goalsDir }),
        "monthly-reviewer": buildMonthlyReviewer({ port, dailyNotesDir, goalsDir, projectsDir }),
        "goal-aligner": buildGoalAligner({ port, dailyNotesDir, goalsDir, projectsDir }),
        "inbox-processor": buildInboxProcessor({ port, notesPath, inboxDir, projectsDir }),
        "note-organizer": buildNoteOrganizer({ projectsDir }),
    };
}
