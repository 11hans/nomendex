import { useState, useEffect } from "react";
import { Settings, GitBranch, Bot, HelpCircle, Inbox } from "lucide-react";
import { Separator } from "./ui/separator";
import { baseRegistry } from "@/registry/registry";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { PluginIcon } from "@/types/Plugin";
import { getIcon } from "./PluginViewIcons";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function NavItem({
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
            <span className="truncate">{label}</span>
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-3 pb-1">
            {children}
        </div>
    );
}

export function WorkspaceSidebar() {
    const plugins = Object.values(baseRegistry);
    const { openTab, activeTab } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
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

    const activePluginId = activeTab?.pluginInstance?.plugin?.id ?? null;
    const activeViewId = activeTab?.pluginInstance?.viewId ?? null;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Nav section */}
            <div className="shrink-0 p-2">
                <SectionLabel>Views</SectionLabel>
                <NavItem
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
                    const isPluginActive = plugin.id === "todos"
                        ? activePluginId === "todos" && activeViewId !== "inbox"
                        : activePluginId === plugin.id;

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
                            isActive={activePluginId === plugin.id}
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
                <NavItem
                    icon={GitBranch}
                    label="Sync"
                    isActive={currentPath === "/sync"}
                    onClick={() => handleNavigate("/sync")}
                />
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
                    <span className="text-[9px] text-muted-foreground">v{appVersion}</span>
                </div>
            </div>
        </div>
    );
}
