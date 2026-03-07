import { useEffect, useState, useRef, useCallback } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, FolderKanban } from "lucide-react";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useNotesAPI } from "@/hooks/useNotesAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { useTheme } from "@/hooks/useTheme";
import { projectsPluginSerial } from "./index";
import type { ProjectInfo } from "./index";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { ProjectList, type ProjectListItem } from "./ProjectList";

export function ProjectsBrowserView({ tabId }: { tabId: string }) {
    if (!tabId) {
        throw new Error("tabId is required");
    }
    const { activeTab, setTabName, openTab } = useWorkspaceContext();
    const { loading, error, setLoading, setError } = usePlugin();
    const [projects, setProjects] = useState<(ProjectInfo & { id: string })[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);
    const { currentTheme } = useTheme();

    const searchInputRef = useRef<HTMLInputElement>(null);
    const hasSetTabNameRef = useRef<boolean>(false);
    const listRef = useRef<HTMLDivElement>(null);

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
            const projectTodos = allTodos.filter((t) => t.project === config.name);
            const projectNotes = allNotes.filter((n) => n.frontMatter?.project === config.name);

            return {
                id: config.id,
                name: config.name,
                todoCount: projectTodos.filter((t) => t.status === "todo").length,
                inProgressCount: projectTodos.filter((t) => t.status === "in_progress").length,
                doneCount: projectTodos.filter((t) => t.status === "done").length,
                notesCount: projectNotes.length,
            };
        });

        projectInfos.sort((a, b) => {
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

    const projectListItems: ProjectListItem[] = filteredProjects.map((project) => ({
        id: project.id,
        name: project.name,
        projectKey: project.name,
        todoCount: project.todoCount,
        inProgressCount: project.inProgressCount,
        doneCount: project.doneCount,
        notesCount: project.notesCount,
    }));

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

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (filteredProjects.length === 0) return;

            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, filteredProjects.length - 1));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    {
                        const selectedProject = filteredProjects[selectedIndex];
                        if (selectedProject) {
                            handleOpenProject(selectedProject.name);
                        }
                    }
                    break;
            }
        },
        [filteredProjects, selectedIndex, handleOpenProject]
    );

    // Reset selection when search changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchQuery]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
            selectedItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [selectedIndex]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-muted-foreground">Loading projects...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <Alert variant="destructive">
                    <AlertDescription>Error: {error}</AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div
            className="flex-1 min-w-0 min-h-0 flex flex-col"
            style={{ backgroundColor: currentTheme.styles.surfacePrimary }}
        >
            {/* Header with search */}
            <div
                className="shrink-0 px-4 py-2.5 border-b"
                style={{
                    backgroundColor: currentTheme.styles.surfacePrimary,
                    borderColor: currentTheme.styles.borderDefault,
                }}
            >
                <div className="flex items-center gap-2 mb-2">
                    <FolderKanban
                        size={16}
                        style={{ color: currentTheme.styles.contentAccent }}
                    />
                    <h2
                        className="text-sm font-medium truncate"
                        style={{ color: currentTheme.styles.contentPrimary }}
                    >
                        Projects
                    </h2>
                    <span
                        className="text-[10px]"
                        style={{ color: currentTheme.styles.contentTertiary }}
                    >
                        ({projects.length})
                    </span>
                    <div className="ml-auto">
                        <CreateProjectDialog
                            open={createDialogOpen}
                            onOpenChange={setCreateDialogOpen}
                            onCreateProject={handleCreateProject}
                            loading={loading}
                            existingProjects={projects.map(p => p.name)}
                        />
                    </div>
                </div>

                <div className="relative">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2"
                        size={16}
                        style={{ color: currentTheme.styles.contentTertiary }}
                    />
                    <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="pl-9"
                        style={{
                            backgroundColor: currentTheme.styles.surfaceSecondary,
                            borderColor: currentTheme.styles.borderDefault,
                            color: currentTheme.styles.contentPrimary,
                        }}
                    />
                </div>
            </div>

            {/* Projects list */}
            <ScrollArea className="flex-1 min-h-0">
                <ProjectList
                    mode="full"
                    items={projectListItems}
                    selectedIndex={selectedIndex}
                    onSelectedIndexChange={setSelectedIndex}
                    onOpenProject={(project) => handleOpenProject(project.projectKey)}
                    emptyMessage={searchQuery ? "No projects found" : "No projects yet"}
                    showNotesCount
                    listRef={listRef}
                    onRenameProject={(project, e) => handleOpenRename({ id: project.id, name: project.name }, e)}
                    onDeleteProject={(project, e) => handleOpenDelete({ id: project.id, name: project.name }, e)}
                />
            </ScrollArea>

            {/* Dialogs */}
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
                        existingProjects={projects.map((p) => p.name)}
                        onRenamed={refreshProjects}
                    />
                </>
            )}
        </div>
    );
}

export default ProjectsBrowserView;
