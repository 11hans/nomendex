import { useState, useEffect, useMemo } from "react";
import { Settings, GitBranch, Bot, HelpCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Separator } from "./ui/separator";
import { baseRegistry } from "@/registry/registry";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { PluginIcon } from "@/types/Plugin";
import { getIcon } from "./PluginViewIcons";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useGHSync } from "@/contexts/GHSyncContext";
import { useInboxCount } from "@/hooks/useInboxCount";

function NavItem({
    icon: Icon,
    label,
    onClick,
    isActive = false,
    badge,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    isActive?: boolean;
    badge?: number;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            }`}
        >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate flex-1 text-left">{label}</span>
            {badge !== undefined && badge > 0 && (
                <span
                    className="ml-auto px-1.5 py-0.5 rounded-full bg-secondary text-foreground text-[10px] font-medium leading-none min-w-[18px] text-center"
                >
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-caption uppercase tracking-wider text-muted-foreground px-2.5 pt-3 pb-1">
            {children}
        </div>
    );
}

export function WorkspaceSidebar() {
    const plugins = Object.values(baseRegistry);
    const orderedViewPlugins = useMemo(() => {
        const pluginsById = new Map(plugins.map((plugin) => [plugin.id, plugin] as const));
        const orderedIds = ["today", "goals", "projects", "todos", "notes", "uploads", "tags", "memory"];

        const ordered = orderedIds
            .map((pluginId) => pluginsById.get(pluginId))
            .filter((plugin): plugin is (typeof plugins)[number] => Boolean(plugin));

        const orderedSet = new Set(orderedIds);
        const remaining = plugins.filter((plugin) => !orderedSet.has(plugin.id) && plugin.id !== "chat");
        return [...ordered, ...remaining];
    }, [plugins]);

    const { openTab, activeTab } = useWorkspaceContext();
    const { sync, status: syncStatus, isReady } = useGHSync();
    const { navigate, currentPath } = useRouting();
    const [appVersion, setAppVersion] = useState("...");
    const inboxCount = useInboxCount();

    useEffect(() => {
        fetch("/api/version")
            .then(res => res.json())
            .then(data => setAppVersion(data.version))
            .catch(() => setAppVersion("dev"));
    }, []);

    const handleAddPlugin = (plugin: { id: string; name: string; icon: PluginIcon }) => {
        if (currentPath != "/") {
            navigate("/");
        }
        const view = plugin.id === "todos" || plugin.id === "projects" || plugin.id === "goals"
            ? "browser"
            : "default";
        const props: Record<string, unknown> = {};
        openTab({ pluginMeta: plugin, view, props, autoPin: plugin.id === "today" });
    };

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    const handleQuickSync = () => {
        void sync();
    };

    const handleOpenInbox = () => {
        if (currentPath !== "/") {
            navigate("/");
        }
        openTab({
            pluginMeta: plugins.find(p => p.id === "todos") || plugins[0],
            view: "inbox",
            props: {},
        });
    };

    const activePluginId = activeTab?.pluginInstance?.plugin?.id ?? null;
    const activeViewId = activeTab?.pluginInstance?.viewId ?? null;
    const isWorkspaceView = currentPath === "/";
    const quickSyncDisabled = syncStatus.syncing || syncStatus.hasMergeConflict;
    const quickSyncTitle = syncStatus.syncing
        ? "Syncing..."
        : syncStatus.hasMergeConflict
            ? "Resolve conflicts in Sync"
            : "Sync now";

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Nav section */}
            <div className="shrink-0 p-2">
                <SectionLabel>Views</SectionLabel>
                <NavItem
                    icon={Inbox}
                    label="Inbox"
                    badge={inboxCount}
                    isActive={isWorkspaceView && activePluginId === "todos" && activeViewId === "inbox"}
                    onClick={handleOpenInbox}
                />
                {orderedViewPlugins.map((plugin) => {
                    const IconComponent = getIcon(plugin.icon);
                    const isPluginActive = plugin.id === "todos"
                        ? isWorkspaceView && activePluginId === "todos" && activeViewId !== "inbox"
                        : isWorkspaceView && activePluginId === plugin.id;

                    return (
                        <NavItem
                            key={plugin.id}
                            icon={IconComponent}
                            label={plugin.name || plugin.id}
                            isActive={isPluginActive}
                            onClick={() => handleAddPlugin(plugin)}
                        />
                    );
                })}
                <NavItem
                    icon={Bot}
                    label="Agents"
                    isActive={currentPath === "/agents"}
                    onClick={() => handleNavigate("/agents")}
                />
                {plugins.filter(p => p.id === 'chat').map((plugin) => {
                    const IconComponent = getIcon(plugin.icon);
                    return (
                        <NavItem
                            key={plugin.id}
                            icon={IconComponent}
                            label={plugin.name || plugin.id}
                            isActive={isWorkspaceView && activePluginId === plugin.id}
                            onClick={() => handleAddPlugin(plugin)}
                        />
                    );
                })}
            </div>

            {/* Push footer to bottom */}
            <div className="flex-1" />

            {/* Footer */}
            <Separator className="shrink-0" />
            <div className="shrink-0 p-2">
                <div className="flex items-center gap-1">
                    <div className="flex-1 min-w-0">
                        <NavItem
                            icon={GitBranch}
                            label="Sync"
                            isActive={currentPath === "/sync"}
                            onClick={() => handleNavigate("/sync")}
                        />
                    </div>
                    {isReady && (
                        <button
                            type="button"
                            onClick={handleQuickSync}
                            disabled={quickSyncDisabled}
                            title={quickSyncTitle}
                            aria-label={quickSyncTitle}
                            className={`h-7 w-7 shrink-0 rounded-md border border-transparent transition-colors ${
                                quickSyncDisabled
                                    ? "cursor-not-allowed text-muted-foreground/60"
                                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                            }`}
                        >
                            {syncStatus.syncing ? (
                                <Loader2 className="mx-auto size-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="mx-auto size-3.5" />
                            )}
                        </button>
                    )}
                </div>
                <NavItem
                    icon={Settings}
                    label="Settings"
                    isActive={currentPath === "/settings"}
                    onClick={() => handleNavigate("/settings")}
                />
                <WorkspaceSwitcher />
                <NavItem
                    icon={HelpCircle}
                    label="Help"
                    isActive={currentPath === "/help"}
                    onClick={() => handleNavigate("/help")}
                />
                <div className="px-2.5 pt-2">
                    <span className="text-micro text-muted-foreground">v{appVersion}</span>
                </div>
            </div>
        </div>
    );
}
