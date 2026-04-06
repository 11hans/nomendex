import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { FolderKanban, Clock, CheckCircle2, FileText, Pencil, Trash2 } from "lucide-react";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useTheme } from "@/hooks/useTheme";
import { useIndexedListNavigation } from "@/hooks/useIndexedListNavigation";
import { BrowserListCard, BrowserViewShell } from "@/features/shared/browser-view-shell";
import { projectsPluginSerial } from "./index";
import type { ProjectInfo } from "./index";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { isTaskTodo } from "@/features/todos/todo-kind-utils";
import { isInboxProjectName } from "./inbox-project";

export function ProjectsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [projects, setProjects] = useState<(ProjectInfo & { id: string })[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);
    const { currentTheme } = useTheme();

    const searchInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);

    const todosAPI = useTodosAPI();
    const notesAPI = useNotesAPI();
    const projectsAPI = useProjectsAPI();

    const buildProjectInfos = useCallback(async () => {
        const [projectConfigs, allTodos, allNotes] = await Promise.all([
            projectsAPI.listProjects(),
            todosAPI.getTodos(),
            notesAPI.getNotes(),
        ]);

        const projectInfos = projectConfigs.map((config) => {
            const projectTodos = allTodos.filter((t) => t.project === config.name && isTaskTodo(t));
            const projectNotes = allNotes.filter((n) => n.frontMatter?.project === config.name);

            return {
                id: config.id,
                name: config.name,
                // Keep "later" together with todo for high-level project stats
                todoCount: projectTodos.filter((t) => t.status === "todo" || t.status === "later").length,
                inProgressCount: projectTodos.filter((t) => t.status === "in_progress").length,
                doneCount: projectTodos.filter((t) => t.status === "done").length,
                notesCount: projectNotes.length,
            };
        });

        projectInfos.sort((a, b) => {
            const inboxA = isInboxProjectName(a.name);
            const inboxB = isInboxProjectName(b.name);
            if (inboxA !== inboxB) return inboxA ? -1 : 1;

            const activeA = a.inProgressCount + a.todoCount;
            const activeB = b.inProgressCount + b.todoCount;
            if (activeB !== activeA) return activeB - activeA;
            return a.name.localeCompare(b.name);
        });

        return projectInfos;
    }, [projectsAPI, todosAPI, notesAPI]);

    // Set tab name
    useEffect(() => {
        if (activeTab?.id === tabId && !hasSetTabNameRef.current) {
            setTabName(tabId, "Projects");
            hasSetTabNameRef.current = true;
        }
    }, [activeTab?.id, tabId, setTabName]);

    // Auto-focus search input when tab becomes active
    useEffect(() => {
        if (activeTab?.id === tabId && !loading) {
            requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
    }, [activeTab?.id, tabId, loading]);

    // Load projects with todo and notes counts
    useEffect(() => {
        const fetchProjects = async () => {
            try {
                setLoading(true);
                setError(null);
                setProjects(await buildProjectInfos());
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "Failed to fetch projects";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };
        fetchProjects();
    }, [buildProjectInfos, setLoading, setError]);

    // Handle project creation
    const handleCreateProject = async (projectName: string) => {
        try {
            setLoading(true);
            await projectsAPI.createProject({ name: projectName });
            setProjects(await buildProjectInfos());
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to create project";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Refresh projects list (used after rename/delete)
    const refreshProjects = useCallback(async () => {
        try {
            setProjects(await buildProjectInfos());
        } catch (err) {
            console.error("Failed to refresh projects:", err);
        }
    }, [buildProjectInfos]);

    useEffect(() => {
        const handleCalendarSync = () => {
            void refreshProjects();
        };

        window.addEventListener("calendar-sync-update", handleCalendarSync);
        return () => {
            window.removeEventListener("calendar-sync-update", handleCalendarSync);
        };
    }, [refreshProjects]);

    // Handle opening rename dialog
    const handleOpenRename = useCallback((project: { id: string; name: string }, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedProject(project);
        setRenameDialogOpen(true);
    }, []);

    // Handle opening delete dialog
    const handleOpenDelete = useCallback((project: { id: string; name: string }, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    }, []);

    // Filter projects based on search
    const filteredProjects = searchQuery
        ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : projects;

    // Open project detail view
    const handleOpenProject = useCallback(
        (projectName: string) => {
            // openTab handles both single and split mode, and sets the tab as active
            openTab({
                pluginMeta: projectsPluginSerial,
                view: "detail",
                props: { projectName },
            });
        },
        [openTab]
    );

    const { selectedIndex, setSelectedIndex, listRef, handleKeyDown } = useIndexedListNavigation({
        itemCount: filteredProjects.length,
        resetKey: searchQuery,
        onEnter: (index) => {
            const selectedProject = filteredProjects[index];
            if (selectedProject) {
                handleOpenProject(selectedProject.name);
            }
        },
    });

    return (
        <>
            <BrowserViewShell
                styles={currentTheme.styles}
                loading={loading}
                loadingLabel="loading projects..."
                error={error}
                errorLabel="failed to load projects"
                title="Projects"
                itemCount={projects.length}
                headerIcon={(
                    <FolderKanban
                        className="size-3"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    />
                )}
                action={(
                    <CreateProjectDialog
                        open={createDialogOpen}
                        onOpenChange={setCreateDialogOpen}
                        onCreateProject={handleCreateProject}
                        loading={loading}
                        existingProjects={projects.map((project) => project.name)}
                    />
                )}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onSearchKeyDown={handleKeyDown}
                searchInputRef={searchInputRef}
                searchPlaceholder="search projects..."
                empty={filteredProjects.length === 0}
                emptyLabel={searchQuery ? "no projects match current filters" : "no projects yet"}
                listRef={listRef}
                rootClassName="projects-browser"
            >
                <BrowserListCard styles={currentTheme.styles}>
                    {filteredProjects.map((project, index) => {
                        const isSystemInbox = isInboxProjectName(project.name);
                        const totalCount = project.inProgressCount + project.todoCount + project.doneCount;
                        const isSelected = index === selectedIndex;

                        return (
                            <div
                                key={project.id}
                                data-index={index}
                                className="group relative"
                                onMouseEnter={() => setSelectedIndex(index)}
                            >
                                <button
                                    onClick={() => handleOpenProject(project.name)}
                                    className={`w-full border-t px-2.5 py-1.5 flex items-center gap-1.5 text-left transition-colors ${index === 0 ? "border-t-0" : ""}`}
                                    style={{
                                        borderColor: currentTheme.styles.borderDefault,
                                        backgroundColor: isSelected
                                            ? currentTheme.styles.surfaceAccent
                                            : undefined,
                                        color: currentTheme.styles.contentPrimary,
                                    }}
                                >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <FolderKanban
                                            className="size-3 shrink-0"
                                            style={{ color: currentTheme.styles.contentTertiary }}
                                        />
                                        <span className="text-xs truncate">
                                            {project.name}
                                        </span>
                                        {isSystemInbox && (
                                            <span
                                                className="rounded-full px-1.5 py-0.5 text-caption uppercase tracking-[0.08em]"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentTertiary,
                                                }}
                                                title="System project"
                                            >
                                                System
                                            </span>
                                        )}
                                    </div>

                                    <div className="ml-auto mr-12 flex items-center gap-1 shrink-0">
                                        <span
                                            className="rounded-full px-1.5 py-0.5 text-caption"
                                            style={{
                                                backgroundColor: currentTheme.styles.surfaceTertiary,
                                                color: currentTheme.styles.contentSecondary,
                                            }}
                                            title="Total tasks"
                                        >
                                            {totalCount}
                                        </span>
                                        {project.inProgressCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentAccent,
                                                }}
                                                title="In progress"
                                            >
                                                <Clock className="size-2.5" />
                                                {project.inProgressCount}
                                            </span>
                                        )}
                                        {project.todoCount > 0 && (
                                            <span
                                                className="rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentSecondary,
                                                }}
                                                title="Todo"
                                            >
                                                {project.todoCount}
                                            </span>
                                        )}
                                        {project.doneCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.semanticSuccess,
                                                }}
                                                title="Done"
                                            >
                                                <CheckCircle2 className="size-2.5" />
                                                {project.doneCount}
                                            </span>
                                        )}
                                        {project.notesCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption"
                                                style={{
                                                    backgroundColor: currentTheme.styles.surfaceTertiary,
                                                    color: currentTheme.styles.contentTertiary,
                                                }}
                                                title="Notes"
                                            >
                                                <FileText className="size-2.5" />
                                                {project.notesCount}
                                            </span>
                                        )}
                                    </div>
                                </button>
                                {!isSystemInbox && (
                                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(event) => handleOpenRename({ id: project.id, name: project.name }, event)}
                                            className="rounded p-1 transition-colors hover:bg-surface-elevated"
                                            title="Rename project"
                                        >
                                            <Pencil
                                                className="size-3"
                                                style={{ color: currentTheme.styles.contentSecondary }}
                                            />
                                        </button>
                                        <button
                                            onClick={(event) => handleOpenDelete({ id: project.id, name: project.name }, event)}
                                            className="rounded p-1 transition-colors hover:bg-surface-elevated"
                                            title="Delete project"
                                        >
                                            <Trash2
                                                className="size-3"
                                                style={{ color: currentTheme.styles.semanticDestructive }}
                                            />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </BrowserListCard>
            </BrowserViewShell>

            {selectedProject && (
                <>
                    <DeleteProjectDialog
                        open={deleteDialogOpen}
                        onOpenChange={setDeleteDialogOpen}
                        projectId={selectedProject.id}
                        projectName={selectedProject.name}
                        onDeleted={refreshProjects}
                    />
                    <RenameProjectDialog
                        open={renameDialogOpen}
                        onOpenChange={setRenameDialogOpen}
                        projectId={selectedProject.id}
                        projectName={selectedProject.name}
                        existingProjects={projects.map((project) => project.name)}
                        onRenamed={refreshProjects}
                    />
                </>
            )}
        </>
    );
}

export default ProjectsBrowserView;
