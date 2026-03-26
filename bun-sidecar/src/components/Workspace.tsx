import { X, Plus, Lock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { View } from "./View";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { getIcon } from "./PluginViewIcons";
import { useState, useEffect } from "react";
import { WorkspaceTab } from "@/types/Workspace";
import { SplitLayout } from "./SplitLayout";
import { useFileLocks } from "@/hooks/useFileLocks";

export function Workspace() {
    const { workspace, loading, activeTab, closeTab, setActiveTabId, reorderTabs, layoutMode } =
        useWorkspaceContext();
    const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
    const [dropIndicator, setDropIndicator] = useState<{ index: number; side: 'left' | 'right' } | null>(null);
    const { getLock } = useFileLocks();

    const getNoteLock = (tab: WorkspaceTab) => {
        if (tab.pluginInstance.plugin.id !== "notes") return null;
        if (tab.pluginInstance.viewId !== "editor") return null;
        const noteFileName = tab.pluginInstance.instanceProps?.noteFileName;
        if (typeof noteFileName !== "string") return null;
        return getLock(noteFileName);
    };

    const shouldForceMount = (tab: WorkspaceTab) => {
        const pluginId = tab.pluginInstance.plugin.id;
        const viewId = tab.pluginInstance.viewId || "default";

        if (pluginId === "chat" && viewId === "chat") return true;
        if (pluginId === "todos" && (viewId === "default" || viewId === "projects" || viewId === "inbox")) return true;
        if (pluginId === "notes") return true;
        return false;
    };

    const handleTabDragStart = (e: React.DragEvent, _tab: WorkspaceTab, index: number) => {
        setDraggedTabIndex(index);
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleTabDragEnd = () => {
        setDraggedTabIndex(null);
        setDropIndicator(null);
    };

    const handleTabDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        // Determine if dropping on left or right side of the tab
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        const side = e.clientX < midpoint ? 'left' : 'right';

        if (dropIndicator?.index !== index || dropIndicator?.side !== side) {
            setDropIndicator({ index, side });
        }
    };

    const handleTabDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        const fromIndex = draggedTabIndex;
        if (fromIndex !== null && dropIndicator) {
            // Calculate the actual insertion index
            let toIndex = dropIndicator.side === 'right' ? index + 1 : index;
            // Adjust if dragging from before the drop position
            if (fromIndex < toIndex) {
                toIndex -= 1;
            }
            if (fromIndex !== toIndex) {
                reorderTabs(fromIndex, toIndex);
            }
        }
        setDraggedTabIndex(null);
        setDropIndicator(null);
    };

    // Keep CSS variable with tabs header height in sync for plugin sticky headers
    useEffect(() => {
        const header = document.getElementById("workspace-tabs-header");
        const scroll = document.getElementById("workspace-tabs-scroll");
        if (!header || !scroll) return;
        const setVar = () => {
            const h = header.getBoundingClientRect().height;
            scroll.style.setProperty("--tabs-height", `${h}px`);
        };
        setVar();
        const ro = new ResizeObserver(setVar);
        ro.observe(header);
        window.addEventListener("resize", setVar);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", setVar);
        };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6">
                        <div className="text-center">
                            <div className="animate-pulse text-muted-foreground">Loading workspace...</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // In split mode, render the SplitLayout component
    if (layoutMode === "split") {
        return <SplitLayout />;
    }

    // Single pane mode (default) - original behavior
    if (workspace.tabs.length === 0) {
        return (
            <div className="flex h-full">
                <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex flex-col items-center justify-center flex-1 text-center p-6">
                        <Card className="max-w-md w-full">
                            <CardHeader>
                                <CardTitle>Welcome to your Workspace</CardTitle>
                                <CardDescription>Get started by using the command menu (⌘K) to open notes or todos.</CardDescription>
                            </CardHeader>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    // Show more tabs - up to 20 visible
    const visibleTabs = workspace.tabs.slice(0, 20);
    const overflowTabs = workspace.tabs.slice(20);
    const hasOverflow = overflowTabs.length > 0;

    return (
        <div className="flex h-full w-full overflow-hidden">
            <div className="flex flex-col flex-1 min-w-0 h-full min-h-0" id="workspace-root">
                <Tabs
                    value={activeTab?.id || undefined}
                    onValueChange={setActiveTabId}
                    className="flex flex-col h-full min-h-0 overflow-hidden"
                >
                    <div
                        className="flex items-center w-full flex-shrink-0 sticky top-0 z-50 bg-bg-secondary"
                        id="workspace-tabs-header"
                    >
                        <TabsList
                            className="h-full bg-transparent p-0 gap-0 flex-1 min-w-0 flex items-end"
                        >
                            {visibleTabs.map((tab, index) => {
                                const noteLock = getNoteLock(tab);
                                return (
                                    <div
                                        key={tab.id}
                                        className="group flex items-center relative"
                                        onDragOver={(e) => handleTabDragOver(e, index)}
                                        onDrop={(e) => handleTabDrop(e, index)}
                                    >
                                        {/* Left drop indicator */}
                                        {dropIndicator?.index === index && dropIndicator?.side === 'left' && draggedTabIndex !== index && (
                                            <div className="absolute left-0 top-0 bottom-0 w-0.5 z-10 bg-accent" />
                                        )}
                                        <TabsTrigger
                                            value={tab.id}
                                            className={`rounded-none h-9 px-3 gap-1.5 flex items-center transition-colors duration-100 min-w-0 max-w-[160px] cursor-grab text-xs border-r border-r-border border-b-0 ${draggedTabIndex === index ? "opacity-50" : ""} ${activeTab?.id === tab.id ? "bg-bg text-text font-medium border-t-2 border-t-accent" : "bg-bg-secondary text-text-secondary font-normal border-t-2 border-t-transparent"}`}
                                            draggable
                                            onDragStart={(e) => handleTabDragStart(e, tab, index)}
                                            onDragEnd={handleTabDragEnd}
                                        >
                                            {/* Icon – always visible */}
                                            {(() => {
                                                const IconComponent = getIcon(tab.pluginInstance.plugin.icon);
                                                return <IconComponent className="size-3 flex-shrink-0" />;
                                            })()}
                                            <span className="truncate">{tab.title}</span>
                                            {noteLock && (
                                                <span
                                                    className="flex items-center flex-shrink-0"
                                                    title={`Locked by ${noteLock.agentName}`}
                                                >
                                                    <Lock className="h-3 w-3 text-text-secondary" />
                                                </span>
                                            )}
                                            {/* Close button – visible on hover or when active */}
                                            <span
                                                className={`h-4 w-4 flex items-center justify-center flex-shrink-0 cursor-pointer rounded-sm transition-colors duration-100 hover:bg-[rgba(128,128,128,0.2)] ${activeTab?.id === tab.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    closeTab(tab.id);
                                                }}
                                            >
                                                <X className="size-3 text-text-secondary" />
                                            </span>
                                        </TabsTrigger>
                                        {/* Right drop indicator */}
                                        {dropIndicator?.index === index && dropIndicator?.side === 'right' && draggedTabIndex !== index && (
                                            <div className="absolute right-0 top-0 bottom-0 w-0.5 z-10 bg-accent" />
                                        )}
                                    </div>
                                );
                            })}
                        </TabsList>
                        {hasOverflow && (
                            <div className="flex items-center pr-2 flex-shrink-0 bg-bg-secondary">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="group relative h-7 px-2 rounded-md transition-all duration-200 text-text-secondary bg-surface-elevated"
                                        >
                                            <Plus className="h-3 w-3 mr-0.5" />
                                            <span className="text-xs transition-opacity">{overflowTabs.length}</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-56">
                                        {overflowTabs.map((tab, overflowIndex) => {
                                            const realIndex = 20 + overflowIndex; // Overflow tabs start at index 20
                                            const noteLock = getNoteLock(tab);
                                            return (
                                                <DropdownMenuItem
                                                    key={tab.id}
                                                    onClick={() => setActiveTabId(tab.id)}
                                                    className="flex items-center justify-between group cursor-move"
                                                    draggable
                                                    onDragStart={(e) => handleTabDragStart(e, tab, realIndex)}
                                                    onDragEnd={handleTabDragEnd}
                                                >
                                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                                        {(() => {
                                                            const IconComponent = getIcon(tab.pluginInstance.plugin.icon);
                                                            return <IconComponent className="h-4 w-4 flex-shrink-0" />;
                                                        })()}
                                                        <span className="truncate">{tab.title}</span>
                                                        {noteLock && (
                                                            <span
                                                                className="flex items-center flex-shrink-0"
                                                                title={`Locked by ${noteLock.agentName}`}
                                                            >
                                                                <Lock className="h-3 w-3 text-text-secondary" />
                                                            </span>
                                                        )}
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            closeTab(tab.id);
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </DropdownMenuItem>
                                            );
                                        })}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto [--tabs-height:36px] " id="workspace-tabs-scroll">
                        {workspace.tabs.map((tab) => (
                            <TabsContent
                                key={tab.id}
                                value={tab.id}
                                forceMount={shouldForceMount(tab) ? true : undefined}
                                className="flex-1 min-h-0 h-full"
                            >
                                <View pluginInstance={tab.pluginInstance} viewPosition="main" tabId={tab.id} />
                            </TabsContent>
                        ))}
                    </div>
                </Tabs>
            </div>
        </div>
    );
}
