import { useState, useEffect } from "react";
import { Settings, GitBranch, Bot, HelpCircle, Inbox } from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { baseRegistry } from "@/registry/registry";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { PluginIcon } from "@/types/Plugin";
import { getIcon } from "./PluginViewIcons";
import { useTheme } from "@/hooks/useTheme";
import { TITLE_BAR_HEIGHT } from "./Layout";

/**
 * VS Code-style Activity Bar icon button with tooltip and left accent border.
 */
function ActivityBarIcon({
    icon: Icon,
    label,
    onClick,
    isActive = false,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    isActive?: boolean;
}) {
    const { currentTheme } = useTheme();

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    onClick={onClick}
                    className="relative flex items-center justify-center w-full h-12 cursor-pointer transition-colors duration-150"
                    style={{
                        color: isActive
                            ? currentTheme.styles.contentPrimary
                            : currentTheme.styles.contentSecondary,
                        backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) => {
                        if (!isActive) {
                            e.currentTarget.style.color = currentTheme.styles.contentPrimary;
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isActive) {
                            e.currentTarget.style.color = currentTheme.styles.contentSecondary;
                        }
                    }}
                >
                    {/* VS Code-style left accent border for active item */}
                    {isActive && (
                        <div
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-sm"
                            style={{ backgroundColor: currentTheme.styles.borderAccent }}
                        />
                    )}
                    <Icon className="size-5" />
                </button>
            </TooltipTrigger>
            {/* 
            <TooltipContent side="right" align="center">
                {label}
            </TooltipContent>
            */}
        </Tooltip>
    );
}

export function WorkspaceSidebar() {
    const plugins = Object.values(baseRegistry);
    const { openTab, activeTab } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const { currentTheme } = useTheme();
    const [appVersion, setAppVersion] = useState("...");

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
        openTab({ pluginMeta: plugin, view: "default", props: {} });
    };

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    // Determine which plugin and view are currently active
    const activePluginId = activeTab?.pluginInstance?.plugin?.id ?? null;
    const activeViewId = activeTab?.pluginInstance?.viewId ?? null;

    return (
        <Sidebar
            className="border-r"
            style={{
                backgroundColor: currentTheme.styles.surfaceTertiary,
                borderColor: currentTheme.styles.borderDefault,
                top: `${TITLE_BAR_HEIGHT}px`,
                height: `calc(100svh - ${TITLE_BAR_HEIGHT}px)`,
            }}
        >
            <SidebarContent className="flex flex-col items-center gap-0 p-0 pt-2 overflow-hidden">
                {/* Main plugin icons */}
                <ActivityBarIcon
                    icon={Inbox}
                    label="Inbox"
                    isActive={activePluginId === "todos" && activeViewId === "inbox"}
                    onClick={() => openTab({
                        pluginMeta: plugins.find(p => p.id === 'todos') || plugins[0],
                        view: "inbox",
                        props: { project: "Inbox" }
                    })}
                />
                {plugins.filter(p => p.id !== 'chat').map((plugin) => {
                    const IconComponent = getIcon(plugin.icon);

                    // For the "todos" plugin icon, it should only be active if we're not in the "inbox" view
                    const isPluginActive = plugin.id === "todos"
                        ? activePluginId === "todos" && activeViewId !== "inbox"
                        : activePluginId === plugin.id;

                    return (
                        <ActivityBarIcon
                            key={plugin.id}
                            icon={IconComponent}
                            label={plugin.name || plugin.id}
                            isActive={isPluginActive}
                            onClick={() => handleAddPlugin(plugin)}
                        />
                    );
                })}
                <ActivityBarIcon
                    icon={Bot}
                    label="Agents"
                    isActive={currentPath === "/agents"}
                    onClick={() => handleNavigate("/agents")}
                />
                {plugins.filter(p => p.id === 'chat').map((plugin) => {
                    const IconComponent = getIcon(plugin.icon);
                    return (
                        <ActivityBarIcon
                            key={plugin.id}
                            icon={IconComponent}
                            label={plugin.name || plugin.id}
                            isActive={activePluginId === plugin.id}
                            onClick={() => handleAddPlugin(plugin)}
                        />
                    );
                })}
            </SidebarContent>

            <SidebarFooter className="flex flex-col items-center gap-0 p-0">
                <ActivityBarIcon
                    icon={GitBranch}
                    label="Sync"
                    isActive={currentPath === "/sync"}
                    onClick={() => handleNavigate("/sync")}
                />
                <ActivityBarIcon
                    icon={Settings}
                    label="Settings"
                    isActive={currentPath === "/settings"}
                    onClick={() => handleNavigate("/settings")}
                />
                <ActivityBarIcon
                    icon={HelpCircle}
                    label="Help"
                    isActive={currentPath === "/help"}
                    onClick={() => handleNavigate("/help")}
                />
                <div
                    className="w-full text-center py-1"
                    title={`Nomendex v${appVersion}`}
                >
                    <span className="text-[9px]" style={{ color: currentTheme.styles.contentTertiary }}>
                        v{appVersion}
                    </span>
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
