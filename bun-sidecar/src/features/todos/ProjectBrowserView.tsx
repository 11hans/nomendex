import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePlugin } from "@/hooks/usePlugin";
import { useTodosAPI } from "@/hooks/useTodosAPI";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { todosPluginSerial } from "./index";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useTheme } from "@/hooks/useTheme";
import { Todo } from "./todo-types";
import { ProjectList, type ProjectListItem } from "@/features/projects/ProjectList";

interface ProjectStats {
    id: string;
    name: string;
    projectKey: string;
    isNoProject?: boolean;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    totalCount: number;
}

export function ProjectBrowserView() {
    const { loading, setLoading } = usePlugin();
    const { replaceTabWithNewView, activeTabId } = useWorkspaceContext();
    const todosAPI = useTodosAPI();
    const projectsAPI = useProjectsAPI();
    const { currentTheme } = useTheme();

    const [projects, setProjects] = useState<string[]>([]);
    const [allTodos, setAllTodos] = useState<Todo[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listContainerRef = useRef<HTMLDivElement>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            // Get projects from the projects service (includes projects with no todos)
            const [projectConfigs, todos] = await Promise.all([
                projectsAPI.listProjects(),
                todosAPI.getTodos()
            ]);
            // Extract project names from configs
            setProjects(projectConfigs.map(p => p.name));
            setAllTodos(todos.filter(t => !t.archived));
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!loading && listContainerRef.current) {
            listContainerRef.current.focus();
        }
    }, [loading]);

    const projectStats: ProjectStats[] = useMemo(() => {
        const noProjectTodos = allTodos.filter(t => !t.project || t.project === "");
        const noProjectStats: ProjectStats = {
            id: "__no_project__",
            name: "No Project",
            projectKey: "",
            isNoProject: true,
            todoCount: noProjectTodos.filter(t => t.status === "todo" || t.status === "later").length,
            inProgressCount: noProjectTodos.filter(t => t.status === "in_progress").length,
            doneCount: noProjectTodos.filter(t => t.status === "done").length,
            totalCount: noProjectTodos.length,
        };

        const projectStatsList = projects.map(p => {
            const projectTodos = allTodos.filter(t => t.project === p);
            return {
                id: p,
                name: p,
                projectKey: p,
                todoCount: projectTodos.filter(t => t.status === "todo" || t.status === "later").length,
                inProgressCount: projectTodos.filter(t => t.status === "in_progress").length,
                doneCount: projectTodos.filter(t => t.status === "done").length,
                totalCount: projectTodos.length,
            };
        });

        return [noProjectStats, ...projectStatsList];
    }, [projects, allTodos]);

    const openProject = useCallback(
        (project: ProjectListItem) => {
            if (activeTabId) {
                replaceTabWithNewView(activeTabId, todosPluginSerial, {
                    view: "browser",
                    project: project.projectKey,
                });
            }
        },
        [activeTabId, replaceTabWithNewView]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Don't handle keyboard events if a dialog is open
            if (document.querySelector('[role="dialog"]')) {
                return;
            }

            switch (e.key) {
                case "ArrowDown":
                case "j":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, projectStats.length - 1));
                    break;
                case "ArrowUp":
                case "k":
                    e.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    e.preventDefault();
                    if (projectStats[selectedIndex]) {
                        openProject(projectStats[selectedIndex]);
                    }
                    break;
            }
        },
        [projectStats, selectedIndex, openProject]
    );

    const projectListItems: ProjectListItem[] = useMemo(
        () => projectStats.map((stats) => ({
            id: stats.id,
            name: stats.name,
            projectKey: stats.projectKey,
            isNoProject: stats.isNoProject,
            todoCount: stats.todoCount,
            inProgressCount: stats.inProgressCount,
            doneCount: stats.doneCount,
            totalCount: stats.totalCount,
        })),
        [projectStats]
    );

    return (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div
                className="shrink-0 px-4 py-2.5 border-b"
                style={{ borderColor: currentTheme.styles.borderDefault }}
            >
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium truncate" style={{ color: currentTheme.styles.contentPrimary }}>
                        Todos
                    </h2>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            if (activeTabId) {
                                replaceTabWithNewView(activeTabId, todosPluginSerial, {
                                    view: "browser",
                                });
                            }
                        }}
                    >
                        View All
                    </Button>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] font-normal" style={{ color: currentTheme.styles.contentTertiary }}>
                    <span>{allTodos.length} tasks</span>
                    <span>{allTodos.filter(t => t.status === "in_progress").length} in progress</span>
                </div>
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div ref={listContainerRef} tabIndex={0} onKeyDown={handleKeyDown} className="outline-none">
                    <div className="px-4 pt-3">
                        <h3 className="text-[11px] font-normal" style={{ color: currentTheme.styles.contentSecondary }}>
                            Projects
                        </h3>
                    </div>
                    <ProjectList
                        mode="compact"
                        items={projectListItems}
                        selectedIndex={selectedIndex}
                        onSelectedIndexChange={setSelectedIndex}
                        onOpenProject={openProject}
                        emptyMessage="No projects found. Create todos with project names to see them here."
                        showTotalCount
                    />
                </div>
            </ScrollArea>
        </div>
    );
}
