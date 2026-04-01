import { z } from "zod";
import { createServiceLogger } from "@/lib/logger";
import { createGoal } from "./fx";
import { updateProject } from "@/features/projects/fx";
import path from "path";
import { readdir, stat } from "node:fs/promises";
import yaml from "js-yaml";

const migrationLogger = createServiceLogger("GOALS_MIGRATION");

// ---------------------------------------------------------------------------
// Zod schemas & types
// ---------------------------------------------------------------------------

export const GoalCandidateSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    area: z.string(),
    horizon: z.enum(["vision", "yearly", "quarterly", "monthly"]),
    status: z.enum(["active", "completed", "paused", "dropped"]),
    parentArea: z.string().optional(),
    parentHorizon: z.string().optional(),
    targetDate: z.string().optional(),
    progressMode: z.enum(["rollup", "metric", "manual", "milestone"]),
    progressTarget: z.number().optional(),
    sourceFile: z.string(),
    sourceLine: z.number().optional(),
});
export type GoalCandidate = z.infer<typeof GoalCandidateSchema>;

export const ProjectGoalLinkSchema = z.object({
    projectName: z.string(),
    projectId: z.string().optional(),
    supportsLink: z.string(),
    goalArea: z.string(),
    goalHorizon: z.string(),
});
export type ProjectGoalLink = z.infer<typeof ProjectGoalLinkSchema>;

const MigrationGoalSchema = GoalCandidateSchema.extend({
    suggestedId: z.string(),
    suggestedParentId: z.string().optional(),
});
export type MigrationGoal = z.infer<typeof MigrationGoalSchema>;

const ProjectUpdateSchema = z.object({
    projectId: z.string(),
    projectName: z.string(),
    suggestedGoalRef: z.string(),
    currentSupportsLink: z.string(),
});
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export const MigrationPlanSchema = z.object({
    goals: z.array(MigrationGoalSchema),
    projectUpdates: z.array(ProjectUpdateSchema),
});
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

export const MigrationResultSchema = z.object({
    createdGoals: z.array(z.object({ suggestedId: z.string(), actualId: z.string(), title: z.string() })),
    updatedProjects: z.array(z.object({ projectId: z.string(), projectName: z.string(), goalRef: z.string() })),
    errors: z.array(z.object({ item: z.string(), error: z.string() })),
});
export type MigrationResult = z.infer<typeof MigrationResultSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 50)
        .replace(/-$/, "");
}

function makeId(horizon: string, area: string, extra?: string): string {
    const parts = ["goal", horizon, slugify(area)];
    if (extra) parts.push(slugify(extra));
    return parts.filter(Boolean).join("-");
}

/**
 * Try to read a file, returning null if it doesn't exist.
 */
async function readFileSafe(filePath: string): Promise<string | null> {
    try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) return null;
        return await file.text();
    } catch {
        return null;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect if a checkbox title looks like it has a numeric target (metric mode).
 * Returns the target number or null.
 */
function extractMetricTarget(title: string): number | null {
    // Match patterns like "10 platících", "2 AI projekty", "3x týdně", "6 tech", "12 postů", etc.
    const patterns = [
        /\b(\d+)\s*(platících|uživatel|users|paying)/i,
        /\b(\d+)\s*(AI|automatizačn|projekt|zakázk)/i,
        /\b(\d+)\s*(case\s+stud|meetup|first\s+dat|kontakt|kurz|post)/i,
        /\b(\d+)\s*(trénink|měsíc)/i,
    ];
    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match?.[1]) {
            return parseInt(match[1], 10);
        }
    }
    return null;
}

/**
 * Determine which horizon a goal file reference maps to.
 */
function horizonFromFileName(fileName: string): string {
    if (fileName.includes("0.") || fileName.toLowerCase().includes("vision")) return "vision";
    if (fileName.includes("1.") || fileName.toLowerCase().includes("yearly")) return "yearly";
    if (fileName.includes("2.") || fileName.toLowerCase().includes("monthly")) return "monthly";
    return "yearly"; // default
}

/**
 * Map quarter string (like "Q2", "Q3", "Q4", or "Zbytek března") to an end-of-quarter date.
 */
function quarterEndDate(quarterLabel: string, year: number): string | undefined {
    const normalized = quarterLabel.toLowerCase().trim();
    if (normalized.includes("břez") || normalized.includes("q1") || normalized.includes("mar")) {
        return `${year}-03-31`;
    }
    if (normalized.includes("q2") || normalized.includes("apr") || normalized.includes("jun")) {
        return `${year}-06-30`;
    }
    if (normalized.includes("q3") || normalized.includes("jul") || normalized.includes("sep")) {
        return `${year}-09-30`;
    }
    if (normalized.includes("q4") || normalized.includes("oct") || normalized.includes("dec")) {
        return `${year}-12-31`;
    }
    return undefined;
}

/**
 * Map month name/section to an end-of-month date.
 */
function monthEndDate(monthLabel: string, year: number): string | undefined {
    const normalized = monthLabel.toLowerCase().trim();
    const months: Record<string, string> = {
        january: "01-31", january26: "01-31", leden: "01-31",
        february: "02-28", únor: "02-28",
        march: "03-31", březen: "03-31", března: "03-31",
        april: "04-30", duben: "04-30",
        may: "05-31", květen: "05-31",
        june: "06-30", červen: "06-30",
        july: "07-31", červenec: "07-31",
        august: "08-31", srpen: "08-31",
        september: "09-30", září: "09-30",
        october: "10-31", říjen: "10-31",
        november: "11-30", listopad: "11-30",
        december: "12-31", prosinec: "12-31",
    };
    for (const [key, value] of Object.entries(months)) {
        if (normalized.includes(key)) return `${year}-${value}`;
    }
    // Try matching month patterns like "March 2026", "April 2026"
    if (normalized.includes("march") || normalized.includes("břez")) return `${year}-03-31`;
    if (normalized.includes("april") || normalized.includes("dub")) return `${year}-04-30`;
    if (normalized.includes("may") || normalized.includes("květ")) return `${year}-05-31`;
    if (normalized.includes("june") || normalized.includes("červ") && !normalized.includes("červenec")) return `${year}-06-30`;
    return undefined;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse the 3-Year Vision file for vision-level goals.
 */
/** @internal Exported for testing */
export function parseVisionGoals(content: string, sourceFile: string): GoalCandidate[] {
    const candidates: GoalCandidate[] = [];
    const lines = content.split("\n");

    let inKeyAreas = false;
    let currentArea: string | null = null;
    let currentBullets: string[] = [];
    let currentStartLine = 0;

    function flushArea() {
        if (currentArea && currentBullets.length > 0) {
            candidates.push({
                title: currentArea,
                description: currentBullets.join("\n"),
                area: currentArea,
                horizon: "vision",
                status: "active",
                progressMode: "rollup",
                sourceFile,
                sourceLine: currentStartLine,
            });
        }
        currentArea = null;
        currentBullets = [];
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Detect ## Key Areas section
        if (/^##\s+Key\s+Areas/i.test(line)) {
            inKeyAreas = true;
            continue;
        }

        // If we hit another ## heading, stop Key Areas parsing
        if (inKeyAreas && /^##\s+/.test(line) && !/^###/.test(line)) {
            flushArea();
            inKeyAreas = false;
            continue;
        }

        if (!inKeyAreas) continue;

        // ### headings within Key Areas = area names
        const h3Match = line.match(/^###\s+(.+)$/);
        if (h3Match) {
            flushArea();
            currentArea = h3Match[1]?.trim() ?? "";
            currentStartLine = i + 1;
            continue;
        }

        // Bullet lines
        const bulletMatch = line.match(/^-\s+(.+)$/);
        if (bulletMatch && currentArea) {
            currentBullets.push(bulletMatch[1]?.trim() ?? "");
        }
    }

    // Flush last area
    flushArea();

    return candidates;
}

/**
 * Parse yearly goals and quarterly milestones from the Yearly Goals file.
 */
/** @internal Exported for testing */
export function parseYearlyGoals(content: string, sourceFile: string): GoalCandidate[] {
    const candidates: GoalCandidate[] = [];
    const lines = content.split("\n");

    // Extract year from title
    const yearMatch = content.match(/Yearly\s+Goals?\s+(\d{4})/i) ?? content.match(/(\d{4})/);
    const year = yearMatch?.[1] ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    type SectionType = "goals" | "quarterly";

    let sectionType: SectionType | null = null;
    let currentArea: string | null = null;
    let currentQuarterLabel: string | null = null;
    let currentQuarterDate: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Detect section boundaries
        if (/^##\s+Goals\s+by\s+Area/i.test(line)) {
            sectionType = "goals";
            currentArea = null;
            continue;
        }
        if (/^##\s+Quarterly\s+Milestones/i.test(line)) {
            sectionType = "quarterly";
            currentArea = null;
            currentQuarterLabel = null;
            continue;
        }
        // A new ## section ends the current section
        if (/^##\s+/.test(line) && !/^###/.test(line)) {
            if (sectionType === "goals" || sectionType === "quarterly") {
                sectionType = null;
                currentArea = null;
                currentQuarterLabel = null;
            }
            continue;
        }

        if (!sectionType) continue;

        // ### heading within goals section = area
        const h3Match = line.match(/^###\s+(.+)$/);
        if (h3Match) {
            const headingText = h3Match[1]?.trim() ?? "";

            if (sectionType === "goals") {
                currentArea = headingText;
            } else if (sectionType === "quarterly") {
                currentQuarterLabel = headingText;
                currentQuarterDate = quarterEndDate(headingText, year);
                // Try to infer area from quarter heading — for quarterly milestones,
                // area is not explicitly stated, so we'll try to match by content later
                currentArea = null;
            }
            continue;
        }

        // Checkbox items — handle both `\[ \]` (Obsidian escaped) and `[ ]` (standard)
        const checkboxMatch = line.match(/^-\s+\\?\[([x ])\\?\]\s+(.+)$/i)
            ?? line.match(/^-\s+\[([x ])\]\s+(.+)$/i);
        if (!checkboxMatch) continue;

        const isCompleted = checkboxMatch[1]?.toLowerCase() === "x";
        const title = (checkboxMatch[2] ?? "").replace(/\*\*/g, "").trim();

        if (sectionType === "goals" && currentArea) {
            const metricTarget = extractMetricTarget(title);
            candidates.push({
                title,
                area: currentArea,
                horizon: "yearly",
                status: isCompleted ? "completed" : "active",
                parentArea: currentArea,
                parentHorizon: "vision",
                progressMode: metricTarget !== null ? "metric" : "rollup",
                progressTarget: metricTarget ?? undefined,
                sourceFile,
                sourceLine: i + 1,
            });
        } else if (sectionType === "quarterly" && currentQuarterLabel) {
            // For quarterly milestones, try to infer area from content keywords
            const inferredArea = inferAreaFromContent(title);
            candidates.push({
                title,
                area: inferredArea,
                horizon: "quarterly",
                status: isCompleted ? "completed" : "active",
                parentArea: inferredArea,
                parentHorizon: "yearly",
                targetDate: currentQuarterDate,
                progressMode: "milestone",
                sourceFile,
                sourceLine: i + 1,
            });
        }
    }

    return candidates;
}

/**
 * Infer area from goal content text using keyword matching.
 */
function inferAreaFromContent(title: string): string {
    const lower = title.toLowerCase();

    // Career & Professional keywords
    if (/nomendex|kardex|freelance|portfolio|web|case\s*stud|ai\s+projekt|zakázk|prezent|build\s+in\s+public/i.test(lower)) {
        return "Career & Professional";
    }
    // Health & Wellness
    if (/pohyb|trénink|meal\s*prep|spánek|zdravotn|plavání|běh|fitness|strav/i.test(lower)) {
        return "Health & Wellness";
    }
    // Personal Growth
    if (/review|rutina|streak|disciplín|kurz|investic|invest|prezentovat|finanční/i.test(lower)) {
        return "Personal Growth";
    }
    // Relationships
    if (/meetup|komunita|first\s+date|partnerka|kontakt|sociáln|vídám|rodina/i.test(lower)) {
        return "Relationships";
    }
    // Home & Living
    if (/podlaha|ložnice|rekonstrukce|byt|nábytek|výmalba|místnost|domácí|vylít/i.test(lower)) {
        return "Home & Living";
    }

    return "Uncategorized";
}

/**
 * Parse monthly goals from the Monthly Goals file.
 */
/** @internal Exported for testing */
export function parseMonthlyGoals(content: string, sourceFile: string): GoalCandidate[] {
    const candidates: GoalCandidate[] = [];
    const lines = content.split("\n");

    // Extract year
    const yearMatch = content.match(/(\d{4})/);
    const year = yearMatch?.[1] ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

    let currentMonthLabel: string | null = null;
    let currentMonthDate: string | undefined;
    let inGoalsSection = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // ## heading = month section (e.g., "## March 2026 (Zbytek: 14.–31. 3.)")
        const h2Match = line.match(/^##\s+(.+)$/);
        if (h2Match && !/^###/.test(line)) {
            const heading = h2Match[1]?.trim() ?? "";
            // Skip review sections
            if (/Month\s+in\s+Review/i.test(heading)) {
                currentMonthLabel = null;
                inGoalsSection = false;
                continue;
            }
            currentMonthLabel = heading;
            currentMonthDate = monthEndDate(heading, year);
            inGoalsSection = false;
            continue;
        }

        // ### Goals subsection
        if (/^###\s+Goals/i.test(line)) {
            inGoalsSection = true;
            continue;
        }

        // Any other ### heading resets goals parsing within a month
        if (/^###\s+/.test(line) && !/^###\s+Goals/i.test(line)) {
            inGoalsSection = false;
            continue;
        }

        if (!currentMonthLabel || !inGoalsSection) continue;

        // Checkbox items — handle both `\[ \]` (Obsidian escaped) and `[ ]` (standard)
        const checkboxMatch = line.match(/^-\s+\\?\[([x ])\\?\]\s+(.+)$/i)
            ?? line.match(/^-\s+\[([x ])\]\s+(.+)$/i);
        if (!checkboxMatch) continue;

        const isCompleted = checkboxMatch[1]?.toLowerCase() === "x";
        const title = (checkboxMatch[2] ?? "").replace(/\*\*/g, "").trim();
        const inferredArea = inferAreaFromContent(title);

        candidates.push({
            title,
            area: inferredArea,
            horizon: "monthly",
            status: isCompleted ? "completed" : "active",
            parentArea: inferredArea,
            parentHorizon: "quarterly",
            targetDate: currentMonthDate,
            progressMode: "milestone",
            sourceFile,
            sourceLine: i + 1,
        });
    }

    return candidates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all goal markdown files and return structured candidates.
 */
export async function parseGoalsFromMarkdown(notesPath: string): Promise<GoalCandidate[]> {
    migrationLogger.info("Parsing goals from markdown", { notesPath });
    const candidates: GoalCandidate[] = [];

    const goalsDir = path.join(notesPath, "Goals");

    // 3-Year Vision
    const visionFile = "0. 3-Year Vision.md";
    const visionContent = await readFileSafe(path.join(goalsDir, visionFile));
    if (visionContent) {
        candidates.push(...parseVisionGoals(visionContent, `Goals/${visionFile}`));
        migrationLogger.info(`Parsed ${candidates.length} vision goals`);
    } else {
        migrationLogger.warn("Vision file not found, skipping");
    }

    // Yearly Goals
    const yearlyFile = "1. Yearly Goals.md";
    const yearlyContent = await readFileSafe(path.join(goalsDir, yearlyFile));
    if (yearlyContent) {
        const yearlyGoals = parseYearlyGoals(yearlyContent, `Goals/${yearlyFile}`);
        candidates.push(...yearlyGoals);
        migrationLogger.info(`Parsed ${yearlyGoals.length} yearly/quarterly goals`);
    } else {
        migrationLogger.warn("Yearly goals file not found, skipping");
    }

    // Monthly Goals
    const monthlyFile = "2. Monthly Goals.md";
    const monthlyContent = await readFileSafe(path.join(goalsDir, monthlyFile));
    if (monthlyContent) {
        const monthlyGoals = parseMonthlyGoals(monthlyContent, `Goals/${monthlyFile}`);
        candidates.push(...monthlyGoals);
        migrationLogger.info(`Parsed ${monthlyGoals.length} monthly goals`);
    } else {
        migrationLogger.warn("Monthly goals file not found, skipping");
    }

    migrationLogger.info(`Total candidates parsed: ${candidates.length}`);
    return candidates;
}

/**
 * Parse project files for Supports: [[Goals/...]] links.
 */
export async function parseProjectGoalLinks(notesPath: string): Promise<ProjectGoalLink[]> {
    migrationLogger.info("Parsing project goal links", { notesPath });
    const links: ProjectGoalLink[] = [];

    const projectsDir = path.join(notesPath, "Projects");
    if (!(await fileExists(projectsDir))) {
        migrationLogger.warn("Projects directory not found", { projectsDir });
        return links;
    }

    let entries: string[];
    try {
        entries = await readdir(projectsDir);
    } catch {
        migrationLogger.warn("Failed to read Projects directory");
        return links;
    }

    for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;

        const filePath = path.join(projectsDir, entry);
        const content = await readFileSafe(filePath);
        if (!content) continue;

        // Parse frontmatter for project/projectId
        let projectName = entry.replace(/\.md$/, "");
        let projectId: string | undefined;

        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch?.[1]) {
            try {
                const fm = yaml.load(fmMatch[1]);
                if (fm && typeof fm === "object") {
                    const fmObj = fm as Record<string, unknown>;
                    if (typeof fmObj.project === "string") projectName = fmObj.project;
                    if (typeof fmObj.projectId === "string") projectId = fmObj.projectId;
                }
            } catch {
                // ignore yaml parse errors
            }
        }

        // Find Supports: [[Goals/...]] patterns
        // Pattern: Supports: [[Goals/1. Yearly Goals#Career & Professional|Career & Professional Goals 2026]]
        const supportsRegex = /Supports:\s*\[\[([^\]]+)\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = supportsRegex.exec(content)) !== null) {
            const rawLink = match[1] ?? "";
            // Split off display text after |
            const linkTarget = rawLink.split("|")[0]?.trim() ?? rawLink;

            // Extract area from anchor (#Area Name)
            const anchorMatch = linkTarget.match(/#(.+)$/);
            const goalArea = anchorMatch?.[1]?.trim() ?? "";

            // Extract horizon from file reference
            const fileRef = linkTarget.split("#")[0] ?? "";
            const goalHorizon = horizonFromFileName(fileRef);

            links.push({
                projectName,
                projectId,
                supportsLink: linkTarget,
                goalArea,
                goalHorizon,
            });
        }
    }

    migrationLogger.info(`Parsed ${links.length} project goal links`);
    return links;
}

/**
 * Build a migration plan from parsed candidates and project links.
 */
export function buildMigrationPlan(
    candidates: GoalCandidate[],
    links: ProjectGoalLink[],
): MigrationPlan {
    migrationLogger.info("Building migration plan", {
        candidateCount: candidates.length,
        linkCount: links.length,
    });

    // Generate IDs and find parent relationships
    const goals: MigrationGoal[] = [];

    // Index by horizon + area for parent matching
    const idByHorizonArea = new Map<string, string>();

    // First pass: assign IDs
    for (const candidate of candidates) {
        const suggestedId = makeId(candidate.horizon, candidate.area, candidate.title);
        // Deduplicate IDs
        let finalId = suggestedId;
        let suffix = 2;
        while (goals.some(g => g.suggestedId === finalId)) {
            finalId = `${suggestedId}-${suffix++}`;
        }

        goals.push({
            ...candidate,
            suggestedId: finalId,
        });

        // Track first goal per horizon+area for parent linking
        const key = `${candidate.horizon}:${candidate.area}`;
        if (!idByHorizonArea.has(key)) {
            idByHorizonArea.set(key, finalId);
        }
    }

    // Second pass: resolve parent IDs
    for (const goal of goals) {
        if (!goal.parentArea || !goal.parentHorizon) continue;

        const parentKey = `${goal.parentHorizon}:${goal.parentArea}`;
        const parentId = idByHorizonArea.get(parentKey);

        if (parentId) {
            goal.suggestedParentId = parentId;
        } else {
            // Try to find a parent in a higher horizon with matching area
            const horizonOrder = ["vision", "yearly", "quarterly", "monthly"];
            const currentIdx = horizonOrder.indexOf(goal.horizon);
            for (let h = currentIdx - 1; h >= 0; h--) {
                const horizonName = horizonOrder[h];
                if (!horizonName) continue;
                const fallbackKey = `${horizonName}:${goal.parentArea}`;
                const fallbackId = idByHorizonArea.get(fallbackKey);
                if (fallbackId) {
                    goal.suggestedParentId = fallbackId;
                    break;
                }
            }
        }
    }

    // Build project updates
    const projectUpdates: ProjectUpdate[] = [];
    for (const link of links) {
        // Find the best matching yearly goal by area
        const matchKey = `yearly:${link.goalArea}`;
        const matchedGoalId = idByHorizonArea.get(matchKey);

        if (matchedGoalId && link.projectId) {
            projectUpdates.push({
                projectId: link.projectId,
                projectName: link.projectName,
                suggestedGoalRef: matchedGoalId,
                currentSupportsLink: link.supportsLink,
            });
        }
    }

    // Deduplicate project updates (one per projectId)
    const seenProjects = new Set<string>();
    const dedupedProjectUpdates = projectUpdates.filter(update => {
        if (seenProjects.has(update.projectId)) return false;
        seenProjects.add(update.projectId);
        return true;
    });

    migrationLogger.info("Migration plan built", {
        goalCount: goals.length,
        projectUpdateCount: dedupedProjectUpdates.length,
    });

    return {
        goals,
        projectUpdates: dedupedProjectUpdates,
    };
}

/**
 * Execute an approved migration plan: create goals and update projects.
 */
export async function executeMigration(plan: MigrationPlan): Promise<MigrationResult> {
    migrationLogger.info("Executing migration", {
        goalCount: plan.goals.length,
        projectUpdateCount: plan.projectUpdates.length,
    });

    const createdGoals: MigrationResult["createdGoals"] = [];
    const updatedProjects: MigrationResult["updatedProjects"] = [];
    const errors: MigrationResult["errors"] = [];

    // Map from suggestedId -> actual created goalId for parent linking
    const idMap = new Map<string, string>();

    // Sort goals so parents are created before children
    const horizonOrder: Record<string, number> = { vision: 0, yearly: 1, quarterly: 2, monthly: 3 };
    const sortedGoals = [...plan.goals].sort((a, b) => {
        return (horizonOrder[a.horizon] ?? 99) - (horizonOrder[b.horizon] ?? 99);
    });

    for (const goal of sortedGoals) {
        try {
            // Resolve actual parent ID from the map
            let parentGoalId: string | undefined;
            if (goal.suggestedParentId) {
                parentGoalId = idMap.get(goal.suggestedParentId) ?? undefined;
            }

            const created = await createGoal({
                title: goal.title,
                description: goal.description,
                area: goal.area,
                horizon: goal.horizon,
                status: goal.status,
                parentGoalId,
                targetDate: goal.targetDate,
                mirrorNoteFile: undefined, // Set by first mirror sync, not from legacy source file
                progressMode: goal.progressMode,
                progressTarget: goal.progressTarget,
            });

            idMap.set(goal.suggestedId, created.id);
            createdGoals.push({
                suggestedId: goal.suggestedId,
                actualId: created.id,
                title: goal.title,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ item: `goal:${goal.suggestedId}`, error: message });
            migrationLogger.error(`Failed to create goal: ${goal.suggestedId}`, { error: message });
        }
    }

    // Update projects with goal refs
    for (const update of plan.projectUpdates) {
        try {
            const actualGoalId = idMap.get(update.suggestedGoalRef);
            if (!actualGoalId) {
                errors.push({
                    item: `project:${update.projectId}`,
                    error: `Referenced goal ${update.suggestedGoalRef} was not created`,
                });
                continue;
            }

            await updateProject({
                projectId: update.projectId,
                updates: { goalRef: actualGoalId },
            });

            updatedProjects.push({
                projectId: update.projectId,
                projectName: update.projectName,
                goalRef: actualGoalId,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ item: `project:${update.projectId}`, error: message });
            migrationLogger.error(`Failed to update project: ${update.projectId}`, { error: message });
        }
    }

    migrationLogger.info("Migration complete", {
        created: createdGoals.length,
        updated: updatedProjects.length,
        errors: errors.length,
    });

    return { createdGoals, updatedProjects, errors };
}
