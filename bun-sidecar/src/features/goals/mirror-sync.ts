import { createServiceLogger } from "@/lib/logger";
import { getNotesPath } from "@/storage/root-path";
import { getGoals, getGoalById, getGoalGraph } from "./fx";
import { listProjects, getProject } from "@/features/projects/fx";
import { getTodos } from "@/features/todos/fx";
import { mkdir, stat } from "node:fs/promises";
import path from "path";
import yaml from "js-yaml";
import type { GoalRecord } from "./goal-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import type { Todo } from "@/features/todos/todo-types";

const syncLogger = createServiceLogger("MIRROR-SYNC");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MirrorSyncResult {
    action: "created" | "updated" | "conflict" | "unchanged";
    filePath: string;
    conflicts?: string[];
}

type FrontMatter = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHash(content: string): string {
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(content);
    return hasher.digest("hex").substring(0, 8);
}

async function pathExists(absolutePath: string): Promise<boolean> {
    try {
        await stat(absolutePath);
        return true;
    } catch {
        return false;
    }
}

function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } {
    const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
    const match = content.match(frontMatterRegex);

    if (!match) {
        return { frontMatter: {}, body: content };
    }

    try {
        const parsed = yaml.load(match[1]);
        const frontMatter = parsed && typeof parsed === "object" ? (parsed as FrontMatter) : {};
        const body = content.slice(match[0].length);
        return { frontMatter, body };
    } catch {
        return { frontMatter: {}, body: content };
    }
}

function serializeFrontMatter(frontMatter: FrontMatter, body: string): string {
    const yamlString = yaml.dump(frontMatter, { lineWidth: -1 }).trimEnd();
    const normalizedBody = body.replace(/^\n+/, "");
    return `---\n${yamlString}\n---\n${normalizedBody}`;
}

/**
 * Extract the managed section content between markers.
 */
function extractManagedSection(body: string): { before: string; managed: string; after: string } | null {
    const startMarker = "<!-- managed:start -->";
    const endMarker = "<!-- managed:end -->";

    const startIndex = body.indexOf(startMarker);
    const endIndex = body.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
        return null;
    }

    const before = body.substring(0, startIndex);
    const managed = body.substring(startIndex + startMarker.length, endIndex).trim();
    const after = body.substring(endIndex + endMarker.length);

    return { before, managed, after };
}

/**
 * Build a slug from a goal title (matching the slug logic in fx.ts).
 */
function slugFromTitle(title: string): string {
    let slug = title
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

    if (slug.length > 50) {
        slug = slug.substring(0, 50).replace(/-$/, "");
    }
    if (!slug) {
        slug = "untitled";
    }
    return slug;
}

function formatProgressDisplay(goal: GoalRecord, computedProgress: number): string {
    const bar = renderProgressBar(computedProgress);

    switch (goal.progressMode) {
        case "metric": {
            return `**Mode**: Metric\n**Progress**: ${goal.progressCurrent} / ${goal.progressTarget} (${computedProgress}%)\n${bar}`;
        }
        case "manual": {
            return `**Mode**: Manual\n**Progress**: ${goal.progressValue}%\n${bar}`;
        }
        case "milestone": {
            return `**Mode**: Milestone\n**Progress**: ${computedProgress}%\n${bar}`;
        }
        case "rollup":
        default: {
            return `**Mode**: Rollup\n**Progress**: ${computedProgress}%\n${bar}`;
        }
    }
}

function renderProgressBar(percent: number): string {
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    return `\`[${"█".repeat(filled)}${"░".repeat(empty)}]\` ${percent}%`;
}

function formatTodoItem(todo: Todo): string {
    const check = todo.status === "done" ? "x" : " ";
    const priority = todo.priority && todo.priority !== "none" ? ` (${todo.priority})` : "";
    return `- [${check}] ${todo.title}${priority}`;
}

// ---------------------------------------------------------------------------
// Goal Mirror
// ---------------------------------------------------------------------------

function buildGoalManagedContent(
    graph: {
        goal: GoalRecord;
        childGoals: GoalRecord[];
        linkedProjects: ProjectConfig[];
        linkedTodos: Todo[];
        computedProgress: number;
    },
): string {
    const { goal, linkedProjects, linkedTodos, computedProgress } = graph;

    // Progress section
    const progressContent = formatProgressDisplay(goal, computedProgress);

    // Linked Projects section
    let projectsContent: string;
    if (linkedProjects.length === 0) {
        projectsContent = "_No projects linked to this goal._";
    } else {
        projectsContent = linkedProjects
            .map(p => `- [[Projects/${p.name}|${p.name}]]${p.archived ? " _(archived)_" : ""}`)
            .join("\n");
    }

    // Linked Todos section
    let todosContent: string;
    if (linkedTodos.length === 0) {
        todosContent = "_No todos linked to this goal._";
    } else {
        todosContent = linkedTodos.map(formatTodoItem).join("\n");
    }

    return `## Progress

${progressContent}

## Linked Projects

${projectsContent}

## Linked Todos

${todosContent}`;
}

function buildGoalFrontMatter(goal: GoalRecord, managedHash: string): FrontMatter {
    const fm: FrontMatter = {
        goalId: goal.id,
        title: goal.title,
        area: goal.area,
        horizon: goal.horizon,
        status: goal.status,
        progressMode: goal.progressMode,
        managedBy: "nomendex-goal-sync",
        syncVersion: 1,
        lastSyncedAt: new Date().toISOString(),
        managedHash,
    };

    if (goal.parentGoalId) {
        fm.parentGoalId = goal.parentGoalId;
    }
    if (goal.targetDate) {
        fm.targetDate = goal.targetDate;
    }
    if (goal.tags && goal.tags.length > 0) {
        fm.tags = goal.tags;
    }

    return fm;
}

function buildFullGoalBody(goal: GoalRecord, managedContent: string): string {
    const description = goal.description || "";
    const overviewContent = description || "_Describe this goal._";

    return `\n# ${goal.title}

## Overview
${overviewContent}

## Notes


## Decisions


<!-- managed:start -->
${managedContent}
<!-- managed:end -->
`;
}

export async function generateGoalMirrorNote(input: { goalId: string }): Promise<MirrorSyncResult> {
    syncLogger.info(`Syncing goal mirror note: ${input.goalId}`);

    const graph = await getGoalGraph({ goalId: input.goalId });
    const { goal } = graph;
    const slug = slugFromTitle(goal.title);

    const notesPath = getNotesPath();
    const goalsDir = path.join(notesPath, "Goals", "goals");
    await mkdir(goalsDir, { recursive: true });

    const filePath = path.join(goalsDir, `${slug}.md`);
    const managedContent = buildGoalManagedContent(graph);
    const managedHash = computeHash(managedContent);

    if (!(await pathExists(filePath))) {
        // Create new file
        const fm = buildGoalFrontMatter(goal, managedHash);
        const body = buildFullGoalBody(goal, managedContent);
        const content = serializeFrontMatter(fm, body);
        await Bun.write(filePath, content);

        syncLogger.info(`Created goal mirror note: ${filePath}`);
        return { action: "created", filePath };
    }

    // File exists — read and merge
    const raw = await Bun.file(filePath).text();
    const { frontMatter, body } = parseFrontMatter(raw);

    // Check for managed section conflicts
    const conflicts: string[] = [];
    const existingSections = extractManagedSection(body);
    if (existingSections) {
        const existingManagedHash = String(frontMatter.managedHash || "");
        if (existingManagedHash) {
            const currentHash = computeHash(existingSections.managed);
            if (currentHash !== existingManagedHash) {
                conflicts.push("User edited managed sections (between <!-- managed:start --> and <!-- managed:end -->). Changes will be overwritten.");
            }
        }
    }

    // Check for frontmatter field conflicts
    const syncableFields = ["title", "area", "horizon", "status", "progressMode"] as const;
    for (const field of syncableFields) {
        const fmValue = frontMatter[field];
        const goalValue = goal[field];
        if (fmValue !== undefined && fmValue !== goalValue) {
            conflicts.push(`Frontmatter field "${field}" differs: note="${String(fmValue)}" vs store="${String(goalValue)}"`);
        }
    }

    // Preserve user-editable sections, update managed sections
    const newFm = buildGoalFrontMatter(goal, managedHash);
    // Merge: keep any extra user-added frontmatter fields
    const mergedFm: FrontMatter = { ...frontMatter, ...newFm };

    let newBody: string;
    if (existingSections) {
        // Replace managed content, preserve user-editable sections
        newBody = `${existingSections.before}<!-- managed:start -->\n${managedContent}\n<!-- managed:end -->${existingSections.after}`;
    } else {
        // No managed markers found — append managed section
        const trimmedBody = body.trimEnd();
        newBody = `${trimmedBody}\n\n<!-- managed:start -->\n${managedContent}\n<!-- managed:end -->\n`;
    }

    const newContent = serializeFrontMatter(mergedFm, newBody);

    if (newContent === raw) {
        syncLogger.info(`Goal mirror note unchanged: ${filePath}`);
        return { action: "unchanged", filePath };
    }

    await Bun.write(filePath, newContent);

    if (conflicts.length > 0) {
        syncLogger.info(`Goal mirror note updated with conflicts: ${filePath}`, { conflicts });
        return { action: "conflict", filePath, conflicts };
    }

    syncLogger.info(`Updated goal mirror note: ${filePath}`);
    return { action: "updated", filePath };
}

// ---------------------------------------------------------------------------
// Project Mirror
// ---------------------------------------------------------------------------

function buildProjectManagedContent(
    project: ProjectConfig,
    goalInfo: { title: string; progress: number } | null,
    activeTodos: Todo[],
): string {
    // Goal Link section
    let goalContent: string;
    if (!goalInfo) {
        goalContent = "_No goal linked to this project._";
    } else {
        const bar = renderProgressBar(goalInfo.progress);
        goalContent = `**Goal**: ${goalInfo.title}\n**Progress**: ${goalInfo.progress}%\n${bar}`;
    }

    // Active Todos section
    let todosContent: string;
    if (activeTodos.length === 0) {
        todosContent = "_No active todos in this project._";
    } else {
        todosContent = activeTodos.map(formatTodoItem).join("\n");
    }

    // Progress section (computed from todos)
    const allTodosCount = activeTodos.length;
    const doneTodos = activeTodos.filter(t => t.status === "done").length;
    const progressPercent = allTodosCount > 0 ? Math.round((doneTodos / allTodosCount) * 100) : 0;
    const bar = renderProgressBar(progressPercent);
    const progressContent = `**Todos**: ${doneTodos}/${allTodosCount} complete\n${bar}`;

    return `## Goal Link

${goalContent}

## Active Todos

${todosContent}

## Progress

${progressContent}`;
}

function buildProjectFrontMatter(project: ProjectConfig, managedHash: string): FrontMatter {
    const fm: FrontMatter = {
        project: project.name,
        projectId: project.id,
        status: project.archived ? "archived" : "active",
        managedBy: "nomendex-project-sync",
        syncVersion: 1,
        lastSyncedAt: new Date().toISOString(),
        managedHash,
    };

    if (project.goalRef) {
        fm.goalRef = project.goalRef;
    }

    return fm;
}

/**
 * Extract user-editable sections from existing project note body.
 * Returns the content for Overview, Notes, Decisions, and any Legacy Notes.
 */
function extractUserEditableSections(body: string): {
    overview: string;
    notes: string;
    decisions: string;
    legacyNotes: string;
} {
    const sections: Record<string, string> = {};
    const lines = body.split("\n");
    let currentSection: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
        // Stop at managed markers
        if (line.trim() === "<!-- managed:start -->") {
            if (currentSection) {
                sections[currentSection] = currentLines.join("\n").trim();
            }
            break;
        }

        const headingMatch = line.match(/^##\s+(.+)$/);
        if (headingMatch) {
            if (currentSection) {
                sections[currentSection] = currentLines.join("\n").trim();
            }
            currentSection = (headingMatch[1] || "").trim().toLowerCase();
            currentLines = [];
        } else if (currentSection) {
            currentLines.push(line);
        }
    }

    if (currentSection) {
        sections[currentSection] = currentLines.join("\n").trim();
    }

    return {
        overview: sections["overview"] || "",
        notes: sections["notes"] || "",
        decisions: sections["decisions"] || "",
        legacyNotes: sections["legacy notes"] || "",
    };
}

/**
 * Migrate old project note sections (Status, Milestones, Next Actions) into Legacy Notes.
 */
function extractLegacySections(body: string): string {
    const legacySectionNames = ["status", "milestones", "next actions"];
    const lines = body.split("\n");
    const legacyParts: string[] = [];
    let currentSection: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
        const headingMatch = line.match(/^##\s+(.+)$/);
        if (headingMatch) {
            if (currentSection && legacySectionNames.includes(currentSection)) {
                const content = currentLines.join("\n").trim();
                if (content) {
                    legacyParts.push(`### ${currentSection.charAt(0).toUpperCase() + currentSection.slice(1)}\n${content}`);
                }
            }
            currentSection = (headingMatch[1] || "").trim().toLowerCase();
            currentLines = [];
        } else if (currentSection) {
            currentLines.push(line);
        }
    }

    if (currentSection && legacySectionNames.includes(currentSection)) {
        const content = currentLines.join("\n").trim();
        if (content) {
            legacyParts.push(`### ${currentSection.charAt(0).toUpperCase() + currentSection.slice(1)}\n${content}`);
        }
    }

    return legacyParts.join("\n\n");
}

function buildFullProjectBody(
    projectName: string,
    overview: string,
    notes: string,
    decisions: string,
    legacyNotes: string,
    managedContent: string,
): string {
    const overviewContent = overview || "Describe what this project should achieve.";

    let body = `\n# Project: ${projectName}

## Overview
${overviewContent}

## Notes
${notes}

## Decisions
${decisions}
`;

    if (legacyNotes) {
        body += `\n## Legacy Notes
${legacyNotes}
`;
    }

    body += `
<!-- managed:start -->
${managedContent}
<!-- managed:end -->
`;

    return body;
}

export async function generateProjectMirrorNote(input: { projectId: string }): Promise<MirrorSyncResult> {
    syncLogger.info(`Syncing project mirror note: ${input.projectId}`);

    const project = await getProject({ projectId: input.projectId });
    if (!project) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    if (!project.projectNoteFile) {
        throw new Error(`Project "${project.name}" has no projectNoteFile assigned`);
    }

    const notesPath = getNotesPath();
    const filePath = path.join(notesPath, project.projectNoteFile);
    await mkdir(path.dirname(filePath), { recursive: true });

    // Gather data for managed sections
    let goalInfo: { title: string; progress: number } | null = null;
    if (project.goalRef) {
        try {
            const goalGraph = await getGoalGraph({ goalId: project.goalRef });
            goalInfo = {
                title: goalGraph.goal.title,
                progress: goalGraph.computedProgress,
            };
        } catch (error) {
            syncLogger.warn(`Failed to load goal ${project.goalRef} for project ${project.id}`, { error });
        }
    }

    const allTodos = await getTodos({});
    const projectTodos = allTodos.filter(
        t => t.project === project.name && (t.status === "todo" || t.status === "in_progress" || t.status === "done"),
    );

    const managedContent = buildProjectManagedContent(project, goalInfo, projectTodos);
    const managedHash = computeHash(managedContent);

    if (!(await pathExists(filePath))) {
        // Create new file
        const fm = buildProjectFrontMatter(project, managedHash);
        const body = buildFullProjectBody(project.name, "", "", "", "", managedContent);
        const content = serializeFrontMatter(fm, body);
        await Bun.write(filePath, content);

        syncLogger.info(`Created project mirror note: ${filePath}`);
        return { action: "created", filePath };
    }

    // File exists — read and merge
    const raw = await Bun.file(filePath).text();
    const { frontMatter, body } = parseFrontMatter(raw);

    // Check for managed section conflicts
    const conflicts: string[] = [];
    const existingSections = extractManagedSection(body);
    if (existingSections) {
        const existingManagedHash = String(frontMatter.managedHash || "");
        if (existingManagedHash) {
            const currentHash = computeHash(existingSections.managed);
            if (currentHash !== existingManagedHash) {
                conflicts.push("User edited managed sections (between <!-- managed:start --> and <!-- managed:end -->). Changes will be overwritten.");
            }
        }
    }

    // Check if this is an old-format project note (has Status/Milestones/Next Actions but no managed markers)
    const isLegacyFormat = !existingSections && (
        body.includes("## Status") || body.includes("## Milestones") || body.includes("## Next Actions")
    );

    // Extract user-editable content
    const userSections = extractUserEditableSections(body);

    // If migrating from legacy, extract legacy sections
    let legacyNotes = userSections.legacyNotes;
    if (isLegacyFormat) {
        const legacyContent = extractLegacySections(body);
        if (legacyContent) {
            legacyNotes = legacyNotes ? `${legacyNotes}\n\n${legacyContent}` : legacyContent;
        }

        // Also migrate Log section content into Notes if it exists
        const logSection = extractSectionContent(body, "log");
        if (logSection && !userSections.notes.includes(logSection)) {
            userSections.notes = userSections.notes
                ? `${userSections.notes}\n\n### Log\n${logSection}`
                : `### Log\n${logSection}`;
        }
    }

    const newFm = buildProjectFrontMatter(project, managedHash);
    const mergedFm: FrontMatter = { ...frontMatter, ...newFm };

    let newBody: string;
    if (existingSections) {
        // Replace managed content, preserve user-editable sections
        newBody = `${existingSections.before}<!-- managed:start -->\n${managedContent}\n<!-- managed:end -->${existingSections.after}`;
    } else {
        // No managed markers — rebuild body preserving user content
        newBody = buildFullProjectBody(
            project.name,
            userSections.overview,
            userSections.notes,
            userSections.decisions,
            legacyNotes,
            managedContent,
        );
    }

    const newContent = serializeFrontMatter(mergedFm, newBody);

    if (newContent === raw) {
        syncLogger.info(`Project mirror note unchanged: ${filePath}`);
        return { action: "unchanged", filePath };
    }

    await Bun.write(filePath, newContent);

    if (conflicts.length > 0) {
        syncLogger.info(`Project mirror note updated with conflicts: ${filePath}`, { conflicts });
        return { action: "conflict", filePath, conflicts };
    }

    const action = isLegacyFormat ? "updated" : "updated";
    syncLogger.info(`${isLegacyFormat ? "Migrated" : "Updated"} project mirror note: ${filePath}`);
    return { action, filePath };
}

/**
 * Helper to extract a single section's content by heading name.
 */
function extractSectionContent(body: string, headingName: string): string | null {
    const lines = body.split("\n");
    const lowerName = headingName.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (!headingMatch) continue;

        if ((headingMatch[2] || "").trim().toLowerCase() !== lowerName) continue;

        const headingLevel = (headingMatch[1] || "").length;
        let endIndex = lines.length;

        for (let j = i + 1; j < lines.length; j++) {
            const nextMatch = (lines[j] || "").match(/^(#{1,6})\s+/);
            if (nextMatch && (nextMatch[1] || "").length <= headingLevel) {
                endIndex = j;
                break;
            }
            // Also stop at managed markers
            if ((lines[j] || "").trim() === "<!-- managed:start -->") {
                endIndex = j;
                break;
            }
        }

        return lines.slice(i + 1, endIndex).join("\n").trim();
    }

    return null;
}

// ---------------------------------------------------------------------------
// Batch sync
// ---------------------------------------------------------------------------

export async function syncAllGoalMirrors(): Promise<MirrorSyncResult[]> {
    syncLogger.info("Syncing all goal mirror notes");

    const goals = await getGoals({});
    const results: MirrorSyncResult[] = [];

    for (const goal of goals) {
        try {
            const result = await generateGoalMirrorNote({ goalId: goal.id });
            results.push(result);
        } catch (error) {
            syncLogger.error(`Failed to sync goal mirror: ${goal.id}`, { error });
            results.push({
                action: "conflict",
                filePath: `Goals/goals/${slugFromTitle(goal.title)}.md`,
                conflicts: [`Sync error: ${error instanceof Error ? error.message : String(error)}`],
            });
        }
    }

    syncLogger.info(`Synced ${results.length} goal mirror notes`);
    return results;
}

export async function syncAllProjectMirrors(): Promise<MirrorSyncResult[]> {
    syncLogger.info("Syncing all project mirror notes");

    const projects = await listProjects({ includeArchived: false });
    const results: MirrorSyncResult[] = [];

    for (const project of projects) {
        try {
            const result = await generateProjectMirrorNote({ projectId: project.id });
            results.push(result);
        } catch (error) {
            syncLogger.error(`Failed to sync project mirror: ${project.id}`, { error });
            results.push({
                action: "conflict",
                filePath: project.projectNoteFile || `Projects/${project.name}.md`,
                conflicts: [`Sync error: ${error instanceof Error ? error.message : String(error)}`],
            });
        }
    }

    syncLogger.info(`Synced ${results.length} project mirror notes`);
    return results;
}

// ---------------------------------------------------------------------------
// Import from mirror note
// ---------------------------------------------------------------------------

export async function importFromMirrorNote(input: { filePath: string }): Promise<{
    changes: Record<string, unknown>;
    entityType: "goal" | "project";
    entityId: string;
} | null> {
    syncLogger.info(`Importing from mirror note: ${input.filePath}`);

    if (!(await pathExists(input.filePath))) {
        syncLogger.warn(`Mirror note not found: ${input.filePath}`);
        return null;
    }

    const raw = await Bun.file(input.filePath).text();
    const { frontMatter } = parseFrontMatter(raw);

    if (!frontMatter.managedBy) {
        syncLogger.warn(`Not a managed mirror note: ${input.filePath}`);
        return null;
    }

    const changes: Record<string, unknown> = {};

    if (frontMatter.managedBy === "nomendex-goal-sync" && typeof frontMatter.goalId === "string") {
        const goalId = frontMatter.goalId;
        let goal: GoalRecord;
        try {
            goal = await getGoalById({ goalId });
        } catch {
            syncLogger.warn(`Goal not found for import: ${goalId}`);
            return null;
        }

        // Compare syncable fields
        if (typeof frontMatter.title === "string" && frontMatter.title !== goal.title) {
            changes.title = frontMatter.title;
        }
        if (typeof frontMatter.area === "string" && frontMatter.area !== goal.area) {
            changes.area = frontMatter.area;
        }
        if (typeof frontMatter.horizon === "string" && frontMatter.horizon !== goal.horizon) {
            changes.horizon = frontMatter.horizon;
        }
        if (typeof frontMatter.status === "string" && frontMatter.status !== goal.status) {
            changes.status = frontMatter.status;
        }

        if (Object.keys(changes).length === 0) {
            syncLogger.info(`No changes detected in goal mirror note: ${input.filePath}`);
            return null;
        }

        syncLogger.info(`Detected changes in goal mirror: ${goalId}`, { changes });
        return { changes, entityType: "goal", entityId: goalId };
    }

    if (frontMatter.managedBy === "nomendex-project-sync" && typeof frontMatter.projectId === "string") {
        const projectId = frontMatter.projectId;
        const project = await getProject({ projectId });
        if (!project) {
            syncLogger.warn(`Project not found for import: ${projectId}`);
            return null;
        }

        if (typeof frontMatter.project === "string" && frontMatter.project !== project.name) {
            changes.name = frontMatter.project;
        }
        const fmStatus = frontMatter.status;
        const projectStatus = project.archived ? "archived" : "active";
        if (typeof fmStatus === "string" && fmStatus !== projectStatus) {
            changes.archived = fmStatus === "archived";
        }
        if (typeof frontMatter.goalRef === "string" && frontMatter.goalRef !== (project.goalRef || "")) {
            changes.goalRef = frontMatter.goalRef;
        }

        if (Object.keys(changes).length === 0) {
            syncLogger.info(`No changes detected in project mirror note: ${input.filePath}`);
            return null;
        }

        syncLogger.info(`Detected changes in project mirror: ${projectId}`, { changes });
        return { changes, entityType: "project", entityId: projectId };
    }

    syncLogger.warn(`Unknown managedBy value: ${String(frontMatter.managedBy)}`);
    return null;
}

// ---------------------------------------------------------------------------
// Aggregated Dashboards
// ---------------------------------------------------------------------------

export async function generateAggregatedDashboards(notesPath: string): Promise<void> {
    syncLogger.info("Generating aggregated goal dashboards");

    const goalsDir = path.join(notesPath, "Goals");
    await mkdir(goalsDir, { recursive: true });

    const allGoals = await getGoals({});
    const activeGoals = allGoals.filter(g => g.status === "active" || g.status === "completed");

    // Pre-compute progress for all goals
    const progressMap = new Map<string, number>();
    for (const goal of activeGoals) {
        try {
            const graph = await getGoalGraph({ goalId: goal.id });
            progressMap.set(goal.id, graph.computedProgress);
        } catch {
            progressMap.set(goal.id, 0);
        }
    }

    // Group by area
    const byArea = new Map<string, GoalRecord[]>();
    for (const goal of activeGoals) {
        const existing = byArea.get(goal.area) || [];
        existing.push(goal);
        byArea.set(goal.area, existing);
    }

    const sortedAreas = Array.from(byArea.keys()).sort();

    // 1. Vision dashboard
    const visionGoals = activeGoals.filter(g => g.horizon === "vision");
    let visionContent = `---
managedBy: nomendex-dashboard
generatedAt: "${new Date().toISOString()}"
---

# 3-Year Vision

_Auto-generated dashboard. Do not edit — changes will be overwritten._

`;

    if (visionGoals.length === 0) {
        visionContent += "_No vision-horizon goals defined._\n";
    } else {
        for (const area of sortedAreas) {
            const areaGoals = visionGoals.filter(g => g.area === area);
            if (areaGoals.length === 0) continue;

            visionContent += `## ${area}\n\n`;
            for (const goal of areaGoals) {
                const progress = progressMap.get(goal.id) || 0;
                const slug = slugFromTitle(goal.title);
                visionContent += `### [[Goals/goals/${slug}|${goal.title}]]\n`;
                visionContent += `${renderProgressBar(progress)}\n`;
                if (goal.description) {
                    visionContent += `${goal.description}\n`;
                }
                visionContent += "\n";
            }
        }
    }

    await Bun.write(path.join(goalsDir, "0. 3-Year Vision.md"), visionContent);

    // 2. Yearly Goals dashboard
    const yearlyGoals = activeGoals.filter(g => g.horizon === "yearly");
    let yearlyContent = `---
managedBy: nomendex-dashboard
generatedAt: "${new Date().toISOString()}"
---

# Yearly Goals

_Auto-generated dashboard. Do not edit — changes will be overwritten._

`;

    if (yearlyGoals.length === 0) {
        yearlyContent += "_No yearly goals defined._\n";
    } else {
        for (const area of sortedAreas) {
            const areaGoals = yearlyGoals.filter(g => g.area === area);
            if (areaGoals.length === 0) continue;

            yearlyContent += `## ${area}\n\n`;
            for (const goal of areaGoals) {
                const progress = progressMap.get(goal.id) || 0;
                const slug = slugFromTitle(goal.title);
                yearlyContent += `- [[Goals/goals/${slug}|${goal.title}]] — ${renderProgressBar(progress)}`;
                if (goal.targetDate) {
                    yearlyContent += ` (target: ${goal.targetDate})`;
                }
                yearlyContent += "\n";
            }
            yearlyContent += "\n";
        }
    }

    await Bun.write(path.join(goalsDir, "1. Yearly Goals.md"), yearlyContent);

    // 3. Monthly Goals dashboard
    const monthlyGoals = activeGoals.filter(g => g.horizon === "monthly");
    const now = new Date();
    const currentMonth = now.toLocaleString("en-US", { month: "long", year: "numeric" });

    let monthlyContent = `---
managedBy: nomendex-dashboard
generatedAt: "${new Date().toISOString()}"
---

# Monthly Goals

_Auto-generated dashboard. Do not edit — changes will be overwritten._

**Current month**: ${currentMonth}

`;

    if (monthlyGoals.length === 0) {
        monthlyContent += "_No monthly goals defined._\n";
    } else {
        for (const area of sortedAreas) {
            const areaGoals = monthlyGoals.filter(g => g.area === area);
            if (areaGoals.length === 0) continue;

            monthlyContent += `## ${area}\n\n`;
            for (const goal of areaGoals) {
                const progress = progressMap.get(goal.id) || 0;
                const slug = slugFromTitle(goal.title);
                const statusEmoji = goal.status === "completed" ? "done" : `${progress}%`;
                monthlyContent += `- [[Goals/goals/${slug}|${goal.title}]] — ${statusEmoji}`;
                if (goal.targetDate) {
                    monthlyContent += ` (due: ${goal.targetDate})`;
                }
                monthlyContent += "\n";
            }
            monthlyContent += "\n";
        }
    }

    // Also include quarterly for context
    const quarterlyGoals = activeGoals.filter(g => g.horizon === "quarterly");
    if (quarterlyGoals.length > 0) {
        monthlyContent += "---\n\n## Quarterly Goals (context)\n\n";
        for (const area of sortedAreas) {
            const areaGoals = quarterlyGoals.filter(g => g.area === area);
            if (areaGoals.length === 0) continue;

            monthlyContent += `### ${area}\n\n`;
            for (const goal of areaGoals) {
                const progress = progressMap.get(goal.id) || 0;
                const slug = slugFromTitle(goal.title);
                monthlyContent += `- [[Goals/goals/${slug}|${goal.title}]] — ${renderProgressBar(progress)}\n`;
            }
            monthlyContent += "\n";
        }
    }

    await Bun.write(path.join(goalsDir, "2. Monthly Goals.md"), monthlyContent);

    syncLogger.info("Aggregated dashboards generated");
}
