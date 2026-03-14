import { createServiceLogger } from "@/lib/logger";
import { getNomendexPath, getNotesPath, hasActiveWorkspace } from "@/storage/root-path";
import { getTodos, updateTodo, deleteTodo } from "@/features/todos/fx";
import { getNotes, updateNoteProject, deleteNote } from "@/features/notes/fx";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "path";
import yaml from "js-yaml";
import {
    BoardConfig,
    ProjectConfig,
    ProjectConfigSchema,
    ProjectsFile,
    ProjectsFileSchema,
} from "./project-types";

const projectsLogger = createServiceLogger("PROJECTS");

const PROJECT_NOTES_DIR = "Projects";
const ARCHIVED_PROJECT_NOTES_DIR = "Archives/Projects";
const LEGACY_PROJECT_ARCHIVE_DIR = "Archives/Projects-legacy";

let projectsFilePath: string | null = null;

type FrontMatter = Record<string, unknown>;

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

/**
 * Get the path to the projects.json file
 */
function getProjectsFilePath(): string {
    if (!projectsFilePath) {
        throw new Error("Projects service not initialized. Call initializeProjectsService() first.");
    }
    return projectsFilePath;
}

function getProjectNoteAbsolutePath(projectNoteFile: string): string {
    return path.join(getNotesPath(), projectNoteFile);
}

async function pathExists(absolutePath: string): Promise<boolean> {
    try {
        await stat(absolutePath);
        return true;
    } catch {
        return false;
    }
}

async function moveFileSafe(sourceAbsolutePath: string, targetAbsolutePath: string): Promise<void> {
    await mkdir(path.dirname(targetAbsolutePath), { recursive: true });
    try {
        await rename(sourceAbsolutePath, targetAbsolutePath);
        return;
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "EXDEV") {
            throw error;
        }
    }

    const buffer = await Bun.file(sourceAbsolutePath).arrayBuffer();
    await Bun.write(targetAbsolutePath, buffer);
    await rm(sourceAbsolutePath, { force: true });
}

function normalizeProjectFileBase(projectName: string): string {
    const sanitized = projectName
        .normalize("NFKC")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "")
        .replace(/\.+$/, "");

    return sanitized || "Untitled Project";
}

function withSuffix(relativePath: string, suffix: number): string {
    const directory = path.posix.dirname(relativePath);
    const extension = path.posix.extname(relativePath);
    const baseName = path.posix.basename(relativePath, extension);
    return path.posix.join(directory, `${baseName} (${suffix})${extension}`);
}

function buildProjectNotePath(projectName: string, archived: boolean): string {
    const directory = archived ? ARCHIVED_PROJECT_NOTES_DIR : PROJECT_NOTES_DIR;
    return toPosixPath(path.posix.join(directory, `${normalizeProjectFileBase(projectName)}.md`));
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
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

function buildProjectFrontMatter(project: ProjectConfig): FrontMatter {
    return {
        project: project.name,
        projectId: project.id,
        status: project.archived ? "archived" : "active",
        managedBy: "nomendex-project-sync",
    };
}

function extractSection(content: string, headings: string[]): string | null {
    const normalizedHeadings = new Set(headings.map((heading) => heading.trim().toLowerCase()));
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] || "";
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (!headingMatch) continue;

        const currentHeading = (headingMatch[2] || "").trim().toLowerCase();
        if (!normalizedHeadings.has(currentHeading)) continue;

        const headingLevel = (headingMatch[1] || "").length;
        let endIndex = lines.length;

        for (let j = i + 1; j < lines.length; j++) {
            const nextHeadingMatch = (lines[j] || "").match(/^(#{1,6})\s+(.+)$/);
            if (!nextHeadingMatch) continue;

            const nextHeadingLevel = (nextHeadingMatch[1] || "").length;
            if (nextHeadingLevel <= headingLevel) {
                endIndex = j;
                break;
            }
        }

        const sectionContent = lines.slice(i + 1, endIndex).join("\n").trim();
        if (sectionContent) {
            return sectionContent;
        }
    }

    return null;
}

function buildDefaultProjectNoteBody(projectName: string): string {
    const today = new Date().toISOString().split("T")[0] || "";
    return `# Project: ${projectName}

## Overview
Describe what this project should achieve.

## Status
- Phase: Planning
- Progress: 0%

## Milestones
- [ ] Define milestone 1

## Next Actions
- [ ] Define the first actionable step

## Decisions
- ${today}: Project note initialized

## Log
- ${today}: Project created`;
}

function buildMigratedProjectNoteBody(projectName: string, sourceRelativePath: string, legacyContent: string): string {
    const today = new Date().toISOString().split("T")[0] || "";
    const overview = extractSection(legacyContent, ["Overview", "Summary", "Context"]) || "Migrated from legacy project context.";
    const status = extractSection(legacyContent, ["Status", "Progress", "Phase"]) || "- Phase: Active\n- Progress: (set value)";
    const milestones = extractSection(legacyContent, ["Milestones", "Targets", "Roadmap"]) || "- [ ] Review migrated milestones";
    const nextActions = extractSection(legacyContent, ["Next Actions", "Action Items", "Tasks"]) || "- [ ] Review and refine next actions";
    const decisions = extractSection(legacyContent, ["Decisions", "Key Decisions"]) || "- Capture key decisions here";
    const log = extractSection(legacyContent, ["Log", "Notes", "Updates"])
        || `- ${today}: Migrated from \`${sourceRelativePath}\``;

    const snapshotLines = legacyContent.trim().split("\n");
    const truncated = snapshotLines.length > 200;
    const snapshot = snapshotLines.slice(0, 200).map((line) => `> ${line}`).join("\n");
    const truncationLine = truncated ? "\n> ... [truncated after 200 lines]" : "";

    return `# Project: ${projectName}

## Overview
${overview}

## Status
${status}

## Milestones
${milestones}

## Next Actions
${nextActions}

## Decisions
${decisions}

## Log
${log}

## Legacy Snapshot
Migrated from \`${sourceRelativePath}\` on ${today}.

${snapshot}${truncationLine}`;
}

function collectUsedProjectNotePaths(projects: ProjectConfig[], excludeProjectId?: string): Set<string> {
    const used = new Set<string>();
    for (const project of projects) {
        if (excludeProjectId && project.id === excludeProjectId) continue;
        if (project.projectNoteFile) {
            used.add(project.projectNoteFile.toLowerCase());
        }
    }
    return used;
}

async function allocateProjectNotePath(params: {
    projectName: string;
    archived: boolean;
    projects: ProjectConfig[];
    excludeProjectId?: string;
    allowExistingPath?: string;
}): Promise<string> {
    const used = collectUsedProjectNotePaths(params.projects, params.excludeProjectId);
    const allowExisting = params.allowExistingPath?.toLowerCase();
    const basePath = buildProjectNotePath(params.projectName, params.archived);

    let candidate = basePath;
    let suffix = 2;

    while (true) {
        const candidateLower = candidate.toLowerCase();
        const inUseByProject = used.has(candidateLower) && candidateLower !== allowExisting;
        const existsOnDisk = await pathExists(getProjectNoteAbsolutePath(candidate));
        const collidesOnDisk = existsOnDisk && candidateLower !== allowExisting;

        if (!inUseByProject && !collidesOnDisk) {
            return candidate;
        }

        candidate = withSuffix(basePath, suffix++);
    }
}

async function syncProjectNoteFrontMatter(project: ProjectConfig): Promise<void> {
    if (!project.projectNoteFile) return;

    const absolutePath = getProjectNoteAbsolutePath(project.projectNoteFile);
    if (!(await pathExists(absolutePath))) return;

    const raw = await Bun.file(absolutePath).text();
    const { frontMatter, body } = parseFrontMatter(raw);
    const mergedFrontMatter: FrontMatter = {
        ...frontMatter,
        ...buildProjectFrontMatter(project),
    };

    const serialized = serializeFrontMatter(mergedFrontMatter, body);
    if (serialized !== raw) {
        await Bun.write(absolutePath, serialized);
    }
}

async function writeProjectNote(project: ProjectConfig, body: string): Promise<void> {
    if (!project.projectNoteFile) return;

    const absolutePath = getProjectNoteAbsolutePath(project.projectNoteFile);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const content = serializeFrontMatter(buildProjectFrontMatter(project), body);
    await Bun.write(absolutePath, content);
}

async function ensureProjectNote(project: ProjectConfig, noteBodyOverride?: string): Promise<void> {
    if (!project.projectNoteFile) return;

    const absolutePath = getProjectNoteAbsolutePath(project.projectNoteFile);
    if (await pathExists(absolutePath)) {
        await syncProjectNoteFrontMatter(project);
        return;
    }

    const body = noteBodyOverride || buildDefaultProjectNoteBody(project.name);
    await writeProjectNote(project, body);
}

function generateUniqueProjectId(projectName: string, projects: ProjectConfig[]): string {
    const baseId = slugify(projectName) || "project";
    const usedIds = new Set(projects.map((project) => project.id));
    let candidate = baseId;
    let counter = 1;

    while (usedIds.has(candidate)) {
        candidate = `${baseId}-${counter++}`;
    }

    return candidate;
}

async function buildProjectRecord(params: {
    name: string;
    description?: string;
    color?: string;
    archived?: boolean;
    projects: ProjectConfig[];
}): Promise<ProjectConfig> {
    const now = new Date().toISOString();
    const id = generateUniqueProjectId(params.name, params.projects);
    const projectNoteFile = await allocateProjectNotePath({
        projectName: params.name,
        archived: Boolean(params.archived),
        projects: params.projects,
    });

    return ProjectConfigSchema.parse({
        id,
        name: params.name,
        description: params.description,
        color: params.color,
        archived: params.archived,
        projectNoteFile,
        createdAt: now,
        updatedAt: now,
    });
}

async function archiveLegacyProjectFile(sourceRelativePath: string, projectFolderName: string): Promise<void> {
    const sourceAbsolutePath = getProjectNoteAbsolutePath(sourceRelativePath);
    if (!(await pathExists(sourceAbsolutePath))) return;

    const archiveDirectory = toPosixPath(path.posix.join(LEGACY_PROJECT_ARCHIVE_DIR, normalizeProjectFileBase(projectFolderName)));
    const sourceName = path.posix.basename(sourceRelativePath);
    const sourceExt = path.posix.extname(sourceName);
    const sourceBase = path.posix.basename(sourceName, sourceExt);

    let targetRelativePath = toPosixPath(path.posix.join(archiveDirectory, sourceName));
    let suffix = 2;
    while (await pathExists(getProjectNoteAbsolutePath(targetRelativePath))) {
        targetRelativePath = toPosixPath(path.posix.join(archiveDirectory, `${sourceBase} (${suffix++})${sourceExt}`));
    }

    const targetAbsolutePath = getProjectNoteAbsolutePath(targetRelativePath);
    await moveFileSafe(sourceAbsolutePath, targetAbsolutePath);
}

async function removeDirectoryIfEmpty(absolutePath: string): Promise<void> {
    try {
        const entries = await readdir(absolutePath);
        if (entries.length === 0) {
            await rm(absolutePath, { recursive: true, force: true });
        }
    } catch {
        // no-op
    }
}

/**
 * Read the projects file from disk
 */
async function readProjectsFile(): Promise<ProjectsFile> {
    const filePath = getProjectsFilePath();
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
        return { version: 1, projects: [] };
    }

    const raw = await file.json();
    return ProjectsFileSchema.parse(raw);
}

/**
 * Write the projects file to disk
 */
async function writeProjectsFile(data: ProjectsFile): Promise<void> {
    const filePath = getProjectsFilePath();
    await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Migrate existing projects from todos to the projects file
 */
async function migrateProjectsFromTodos(): Promise<void> {
    projectsLogger.info("Checking for project migration...");

    const filePath = getProjectsFilePath();
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (exists) {
        projectsLogger.info("Projects file exists, skipping migration");
        return;
    }

    projectsLogger.info("Running project migration from todos...");

    const todos = await getTodos({});
    const projectNames = Array.from(new Set(
        todos
            .map((todo) => todo.project?.trim())
            .filter((projectName): projectName is string => Boolean(projectName))
    )).sort((a, b) => a.localeCompare(b));

    const now = new Date().toISOString();
    await writeProjectsFile({
        version: 1,
        projects: [],
        migratedAt: now,
    });

    for (const projectName of projectNames) {
        await createProject({ name: projectName });
    }

    projectsLogger.info(`Migrated ${projectNames.length} projects from todos`);
}

async function ensureCanonicalProjectNotes(): Promise<void> {
    const data = await readProjectsFile();
    let changed = false;

    for (let index = 0; index < data.projects.length; index++) {
        const project = data.projects[index];
        if (!project) continue;

        let updatedProject = project;
        if (!updatedProject.projectNoteFile) {
            const projectNoteFile = await allocateProjectNotePath({
                projectName: updatedProject.name,
                archived: Boolean(updatedProject.archived),
                projects: data.projects,
                excludeProjectId: updatedProject.id,
            });
            updatedProject = { ...updatedProject, projectNoteFile };
            data.projects[index] = updatedProject;
            changed = true;
        }

        await ensureProjectNote(updatedProject);
    }

    if (changed) {
        await writeProjectsFile(data);
    }
}

async function migrateLegacyProjectNotes(): Promise<void> {
    const projectsDirectory = getProjectNoteAbsolutePath(PROJECT_NOTES_DIR);
    if (!(await pathExists(projectsDirectory))) {
        return;
    }

    const entries = await readdir(projectsDirectory, { withFileTypes: true });
    const legacyDirectories = entries.filter((entry) => entry.isDirectory());
    if (legacyDirectories.length === 0) {
        return;
    }

    const data = await readProjectsFile();
    let changed = false;

    for (const entry of legacyDirectories) {
        const folderName = entry.name.trim();
        if (!folderName) continue;

        const claudeRelativePath = toPosixPath(path.posix.join(PROJECT_NOTES_DIR, folderName, "CLAUDE.md"));
        const agentsRelativePath = toPosixPath(path.posix.join(PROJECT_NOTES_DIR, folderName, "AGENTS.md"));

        const hasClaude = await pathExists(getProjectNoteAbsolutePath(claudeRelativePath));
        const hasAgents = await pathExists(getProjectNoteAbsolutePath(agentsRelativePath));
        if (!hasClaude && !hasAgents) continue;

        const primaryLegacyRelativePath = hasClaude ? claudeRelativePath : agentsRelativePath;
        const primaryLegacyAbsolutePath = getProjectNoteAbsolutePath(primaryLegacyRelativePath);
        const legacyContent = await Bun.file(primaryLegacyAbsolutePath).text().catch(() => "");

        let project = data.projects.find((candidate) => candidate.name.toLowerCase() === folderName.toLowerCase());

        if (!project) {
            project = await buildProjectRecord({
                name: folderName,
                projects: data.projects,
            });
            data.projects.push(project);
            changed = true;
            projectsLogger.info("Legacy project note: created missing project entity", { projectName: folderName });
        } else if (!project.projectNoteFile) {
            const projectNoteFile = await allocateProjectNotePath({
                projectName: project.name,
                archived: Boolean(project.archived),
                projects: data.projects,
                excludeProjectId: project.id,
            });
            project = { ...project, projectNoteFile };
            const index = data.projects.findIndex((candidate) => candidate.id === project?.id);
            if (index >= 0) {
                data.projects[index] = project;
                changed = true;
            }
        }

        if (project?.projectNoteFile) {
            const canonicalAbsolutePath = getProjectNoteAbsolutePath(project.projectNoteFile);
            if (!(await pathExists(canonicalAbsolutePath))) {
                const migratedBody = buildMigratedProjectNoteBody(project.name, primaryLegacyRelativePath, legacyContent);
                await writeProjectNote(project, migratedBody);
                projectsLogger.info("Legacy project note migrated", {
                    projectName: project.name,
                    source: primaryLegacyRelativePath,
                    target: project.projectNoteFile,
                });
            } else {
                await syncProjectNoteFrontMatter(project);
            }
        }

        if (hasClaude) {
            await archiveLegacyProjectFile(claudeRelativePath, folderName);
        }
        if (hasAgents) {
            await archiveLegacyProjectFile(agentsRelativePath, folderName);
        }

        await removeDirectoryIfEmpty(getProjectNoteAbsolutePath(toPosixPath(path.posix.join(PROJECT_NOTES_DIR, folderName))));
    }

    if (changed) {
        await writeProjectsFile(data);
    }
}

/**
 * Initialize the projects service. Must be called after initializePaths().
 */
export async function initializeProjectsService(): Promise<void> {
    if (!hasActiveWorkspace()) {
        projectsLogger.warn("No active workspace, skipping projects initialization");
        return;
    }

    projectsFilePath = path.join(getNomendexPath(), "projects.json");
    await migrateProjectsFromTodos();
    await ensureCanonicalProjectNotes();
    await migrateLegacyProjectNotes();
    await ensureCanonicalProjectNotes();

    // Ensure Inbox project exists
    try {
        await ensureProject({ name: "Inbox" });
    } catch (e) {
        projectsLogger.error("Failed to default Inbox project", { error: e });
    }

    projectsLogger.info("Projects service initialized");
}

/**
 * List all projects, optionally including archived ones
 */
export async function listProjects(input: {
    includeArchived?: boolean;
}): Promise<ProjectConfig[]> {
    projectsLogger.info(`Listing projects (includeArchived: ${input.includeArchived})`);

    const data = await readProjectsFile();
    let projects = data.projects;

    if (!input.includeArchived) {
        projects = projects.filter((project) => !project.archived);
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));

    projectsLogger.info(`Found ${projects.length} projects`);
    return projects;
}

/**
 * Get a project by ID
 */
export async function getProject(input: { projectId: string }): Promise<ProjectConfig | null> {
    projectsLogger.info(`Getting project: ${input.projectId}`);

    const data = await readProjectsFile();
    const project = data.projects.find((candidate) => candidate.id === input.projectId);

    if (!project) {
        projectsLogger.warn(`Project not found: ${input.projectId}`);
        return null;
    }

    return project;
}

/**
 * Get a project by name
 */
export async function getProjectByName(input: { name: string }): Promise<ProjectConfig | null> {
    projectsLogger.info(`Getting project by name: ${input.name}`);

    const data = await readProjectsFile();
    const project = data.projects.find((candidate) => candidate.name === input.name);

    if (!project) {
        projectsLogger.warn(`Project not found by name: ${input.name}`);
        return null;
    }

    return project;
}

/**
 * Create a new project
 */
export async function createProject(input: {
    name: string;
    description?: string;
    color?: string;
}): Promise<ProjectConfig> {
    projectsLogger.info(`Creating project: ${input.name}`);

    const data = await readProjectsFile();

    const existing = data.projects.find((project) => project.name === input.name);
    if (existing) {
        throw new Error(`Project with name "${input.name}" already exists`);
    }

    const project = await buildProjectRecord({
        name: input.name,
        description: input.description,
        color: input.color,
        projects: data.projects,
    });

    await ensureProjectNote(project);
    data.projects.push(project);
    await writeProjectsFile(data);

    projectsLogger.info(`Created project: ${project.id}`);
    return project;
}

/**
 * Update an existing project
 */
export async function updateProject(input: {
    projectId: string;
    updates: {
        name?: string;
        description?: string;
        color?: string;
        archived?: boolean;
        board?: BoardConfig;
    };
}): Promise<ProjectConfig> {
    projectsLogger.info(`Updating project: ${input.projectId}`);

    const data = await readProjectsFile();
    const index = data.projects.findIndex((project) => project.id === input.projectId);

    if (index === -1) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    if (input.updates.name) {
        const duplicate = data.projects.find(
            (project) => project.name === input.updates.name && project.id !== input.projectId
        );
        if (duplicate) {
            throw new Error(`Project with name "${input.updates.name}" already exists`);
        }
    }

    const existingProject = data.projects[index];
    if (!existingProject) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    let updatedProject: ProjectConfig = {
        ...existingProject,
        ...input.updates,
        updatedAt: new Date().toISOString(),
    };

    const requiresRelocation =
        !existingProject.projectNoteFile
        || input.updates.name !== undefined
        || input.updates.archived !== undefined;

    if (requiresRelocation) {
        updatedProject = {
            ...updatedProject,
            projectNoteFile: await allocateProjectNotePath({
                projectName: updatedProject.name,
                archived: Boolean(updatedProject.archived),
                projects: data.projects,
                excludeProjectId: updatedProject.id,
                allowExistingPath: existingProject.projectNoteFile,
            }),
        };
    } else if (!updatedProject.projectNoteFile) {
        updatedProject = {
            ...updatedProject,
            projectNoteFile: await allocateProjectNotePath({
                projectName: updatedProject.name,
                archived: Boolean(updatedProject.archived),
                projects: data.projects,
                excludeProjectId: updatedProject.id,
            }),
        };
    }

    if (existingProject.projectNoteFile && updatedProject.projectNoteFile
        && existingProject.projectNoteFile !== updatedProject.projectNoteFile) {
        const sourceAbsolutePath = getProjectNoteAbsolutePath(existingProject.projectNoteFile);
        const destinationAbsolutePath = getProjectNoteAbsolutePath(updatedProject.projectNoteFile);
        if (await pathExists(sourceAbsolutePath)) {
            await moveFileSafe(sourceAbsolutePath, destinationAbsolutePath);
        }
    }

    await ensureProjectNote(updatedProject);
    data.projects[index] = updatedProject;
    await writeProjectsFile(data);

    projectsLogger.info(`Updated project: ${input.projectId}`);
    return updatedProject;
}

/**
 * Get statistics for a project (counts of todos and notes)
 */
export async function getProjectStats(input: { projectName: string }): Promise<{
    todoCount: number;
    noteCount: number;
}> {
    projectsLogger.info(`Getting stats for project: ${input.projectName}`);

    const [allTodos, allNotes] = await Promise.all([
        getTodos({}),
        getNotes({}),
    ]);

    const todoCount = allTodos.filter((todo) => todo.project === input.projectName).length;
    const noteCount = allNotes.filter((note) => note.frontMatter?.project === input.projectName).length;

    return { todoCount, noteCount };
}

async function archiveCanonicalProjectNoteForDeletion(project: ProjectConfig, otherProjects: ProjectConfig[]): Promise<string | null> {
    const archivedPath = await allocateProjectNotePath({
        projectName: project.name,
        archived: true,
        projects: otherProjects,
        allowExistingPath: project.projectNoteFile,
    });

    const sourcePath = project.projectNoteFile;
    if (sourcePath && sourcePath !== archivedPath) {
        const sourceAbsolutePath = getProjectNoteAbsolutePath(sourcePath);
        const targetAbsolutePath = getProjectNoteAbsolutePath(archivedPath);
        if (await pathExists(sourceAbsolutePath)) {
            await moveFileSafe(sourceAbsolutePath, targetAbsolutePath);
        }
    }

    const archivedProject: ProjectConfig = {
        ...project,
        archived: true,
        projectNoteFile: archivedPath,
        updatedAt: new Date().toISOString(),
    };

    await ensureProjectNote(archivedProject);
    return archivedPath;
}

/**
 * Delete a project with optional cascade to delete associated todos and notes
 */
export async function deleteProject(input: {
    projectId: string;
    cascade?: boolean;
}): Promise<{
    success: boolean;
    deletedTodos: number;
    deletedNotes: number;
}> {
    projectsLogger.info(`Deleting project: ${input.projectId} (cascade: ${input.cascade})`);

    const data = await readProjectsFile();
    const index = data.projects.findIndex((project) => project.id === input.projectId);

    if (index === -1) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    const project = data.projects[index];
    if (!project) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }

    const projectName = project.name;
    const otherProjects = data.projects.filter((candidate) => candidate.id !== project.id);
    const archivedProjectNotePath = await archiveCanonicalProjectNoteForDeletion(project, otherProjects);

    let deletedTodos = 0;
    let deletedNotes = 0;

    if (input.cascade) {
        const allTodos = await getTodos({});
        const projectTodos = allTodos.filter((todo) => todo.project === projectName);
        for (const todo of projectTodos) {
            await deleteTodo({ todoId: todo.id });
            deletedTodos++;
        }
        projectsLogger.info(`Deleted ${deletedTodos} todos for project: ${projectName}`);

        const excludedPaths = new Set<string>();
        if (project.projectNoteFile) excludedPaths.add(project.projectNoteFile.toLowerCase());
        if (archivedProjectNotePath) excludedPaths.add(archivedProjectNotePath.toLowerCase());

        const allNotes = await getNotes({});
        const projectNotes = allNotes.filter((note) => {
            const belongsToProject = note.frontMatter?.project === projectName;
            if (!belongsToProject) return false;
            return !excludedPaths.has(note.fileName.toLowerCase());
        });

        for (const note of projectNotes) {
            await deleteNote({ fileName: note.fileName });
            deletedNotes++;
        }
        projectsLogger.info(`Deleted ${deletedNotes} notes for project: ${projectName}`);
    }

    data.projects.splice(index, 1);
    await writeProjectsFile(data);

    projectsLogger.info(`Deleted project: ${input.projectId}`);
    return { success: true, deletedTodos, deletedNotes };
}

/**
 * Rename a project and cascade the change to all associated todos and notes
 */
export async function renameProject(input: {
    projectId: string;
    newName: string;
}): Promise<{
    project: ProjectConfig;
    updatedTodos: number;
    updatedNotes: number;
}> {
    projectsLogger.info(`Renaming project: ${input.projectId} to ${input.newName}`);

    const currentProject = await getProject({ projectId: input.projectId });
    if (!currentProject) {
        throw new Error(`Project with ID "${input.projectId}" not found`);
    }
    const oldName = currentProject.name;

    const updatedProject = await updateProject({
        projectId: input.projectId,
        updates: { name: input.newName },
    });

    const allTodos = await getTodos({});
    const projectTodos = allTodos.filter((todo) => todo.project === oldName);
    let updatedTodos = 0;
    for (const todo of projectTodos) {
        await updateTodo({
            todoId: todo.id,
            updates: { project: input.newName },
        });
        updatedTodos++;
    }
    projectsLogger.info(`Updated ${updatedTodos} todos to new project name: ${input.newName}`);

    const allNotes = await getNotes({});
    const projectNotes = allNotes.filter((note) => note.frontMatter?.project === oldName);
    let updatedNotes = 0;
    for (const note of projectNotes) {
        await updateNoteProject({
            fileName: note.fileName,
            project: input.newName,
        });
        updatedNotes++;
    }
    projectsLogger.info(`Updated ${updatedNotes} notes to new project name: ${input.newName}`);

    projectsLogger.info(`Renamed project: ${input.projectId} to ${input.newName}`);
    return { project: updatedProject, updatedTodos, updatedNotes };
}

/**
 * Ensure a project exists by name, creating it if necessary.
 */
export async function ensureProject(input: { name: string }): Promise<ProjectConfig> {
    projectsLogger.info(`Ensuring project exists: ${input.name}`);

    const existing = await getProjectByName({ name: input.name });
    if (existing) {
        return existing;
    }

    return createProject({ name: input.name });
}

/**
 * Get board configuration for a project.
 * Accepts either projectId (ID) or projectName (name).
 */
export async function getBoardConfig(input: { projectId?: string; projectName?: string }): Promise<BoardConfig | null> {
    const identifier = input.projectId || input.projectName;
    projectsLogger.info(`Getting board config for: ${identifier}`);

    let project: ProjectConfig | null = null;

    if (input.projectId) {
        project = await getProject({ projectId: input.projectId });
    }

    if (!project && input.projectName) {
        project = await getProjectByName({ name: input.projectName });
    }

    return project?.board || null;
}

/**
 * Save board configuration for a project.
 * Accepts either projectId (ID) or projectName (name).
 * If the project doesn't exist, it will be created.
 */
export async function saveBoardConfig(input: {
    projectId?: string;
    projectName?: string;
    board: BoardConfig;
}): Promise<ProjectConfig> {
    const identifier = input.projectId || input.projectName;
    projectsLogger.info(`Saving board config for: ${identifier}`);

    let project: ProjectConfig | null = null;

    if (input.projectId) {
        project = await getProject({ projectId: input.projectId });
    }

    if (!project && input.projectName) {
        project = await getProjectByName({ name: input.projectName });
    }

    if (!project) {
        const name = input.projectName || input.projectId || "Untitled";
        projectsLogger.info(`Project not found, creating: ${name}`);
        project = await ensureProject({ name });
    }

    return updateProject({
        projectId: project.id,
        updates: { board: input.board },
    });
}
