import * as React from "react";
import {
    FileText,
    Settings,
    Trash2,
    ListTodo,
    ListChecks,
    FolderOpen,
    Plus,
    Calendar,
    CalendarMinus,
    CalendarPlus,
    CalendarDays,
    Save,
    MessageCircle,
    AlertTriangle,
    Columns2,
    Command,
} from "lucide-react";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { useRouting } from "@/hooks/useRouting";
import { useCommandDialog } from "./CommandDialogProvider";
import { getNotesCommands } from "@/features/notes";
import { getTodosCommands } from "@/features/todos";
import { getChatCommands } from "@/features/chat/commands";
import { getCoreCommands } from "@/commands/core-commands";
import type { Command as AppCommand } from "@/types/Commands";
import { subscribe } from "@/lib/events";
import { SearchNotesDialog } from "@/features/notes/search-notes-dialog";

const iconMap = {
    Settings,
    Trash2,
    FileText,
    ListTodo,
    ListChecks,
    FolderOpen,
    Plus,
    Calendar,
    CalendarMinus,
    CalendarPlus,
    CalendarDays,
    Save,
    MessageCircle,
    AlertTriangle,
    Columns2,
} as const;

const groupTitles: Record<string, string> = {
    core: "General",
    todos: "Todos",
    notes: "Notes",
    chat: "Chat",
};

export function CommandMenu() {
    const [open, setOpen] = React.useState(false);
    const {
        addNewTab,
        openTab,
        setActiveTabId,
        workspace,
        closeTab,
        closeAllTabs,
        setSidebarTabId,
        sidebarTabId,
        setSidebarOpen,
        sidebarOpen,
        activeTab,
        toggleLayoutMode,
        layoutMode,
    } = useWorkspaceContext();
    const { navigate, currentPath } = useRouting();
    const { openDialog, closeDialog } = useCommandDialog();
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [featureCommands, setFeatureCommands] = React.useState<Record<string, AppCommand[]>>({});

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
        };

        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    React.useEffect(() => {
        return subscribe("notes:openSearch", () => {
            openDialog({
                title: "Search Notes",
                description: "Search for text across all your notes",
                content: <SearchNotesDialog />,
                size: "jumbo",
            });
        });
    }, [openDialog]);

    React.useEffect(() => {
        if (open) {
            const t = setTimeout(() => inputRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [open]);

    React.useEffect(() => {
        async function loadCommands() {
            const commands: Record<string, AppCommand[]> = {};

            commands.core = getCoreCommands({
                openDialog,
                closeDialog,
                closeCommandMenu: () => setOpen(false),
                navigate,
                closeTab,
                closeAllTabs,
                getTabs: () => workspace.tabs,
                setSidebarTabId,
                getSidebarTabId: () => sidebarTabId,
                setSidebarOpen,
                isSidebarOpen: () => sidebarOpen,
                activeTab,
                toggleLayoutMode,
                getLayoutMode: () => layoutMode,
            });

            try {
                const todosCommands = await getTodosCommands({
                    openDialog,
                    closeDialog,
                    closeCommandMenu: () => setOpen(false),
                    addNewTab,
                    openTab,
                    setActiveTabId,
                    closeTab,
                    activeTab,
                    navigate,
                    currentPath,
                });
                if (todosCommands.length > 0) {
                    commands.todos = todosCommands;
                }
            } catch (error) {
                console.error("Failed to load todos commands:", error);
            }

            const notesCommands = getNotesCommands({
                openDialog,
                closeDialog,
                closeCommandMenu: () => setOpen(false),
                addNewTab,
                openTab,
                setActiveTabId,
                closeTab,
                activeTab,
                navigate,
                currentPath,
            });
            if (notesCommands.length > 0) {
                commands.notes = notesCommands;
            }

            const chatCommands = getChatCommands({
                closeCommandMenu: () => setOpen(false),
                addNewTab,
                openTab,
                setActiveTabId,
                navigate,
                currentPath,
            });
            if (chatCommands.length > 0) {
                commands.chat = chatCommands;
            }

            setFeatureCommands(commands);
        }

        loadCommands();
    }, [
        addNewTab,
        openTab,
        setActiveTabId,
        navigate,
        currentPath,
        openDialog,
        closeDialog,
        workspace.tabs,
        closeTab,
        closeAllTabs,
        setSidebarTabId,
        sidebarTabId,
        setSidebarOpen,
        sidebarOpen,
        activeTab,
        toggleLayoutMode,
        layoutMode,
    ]);

    const customFilter = React.useCallback((value: string, search: string) => {
        const valueLower = value.toLowerCase();
        const searchLower = search.toLowerCase();

        if (valueLower === searchLower) return 1;
        if (valueLower.startsWith(searchLower)) return 0.9;
        if (valueLower.includes(searchLower)) return 0.5;

        const words = valueLower.split(/\s+/);
        for (const word of words) {
            if (word.startsWith(searchLower)) return 0.8;
        }

        return 0;
    }, []);

    const commandGroups = React.useMemo(() => {
        return Object.entries(featureCommands)
            .map(([featureId, commands]) => {
                const visibleCommands = commands.filter((cmd) => {
                    if (!cmd.when) return true;

                    const currentViewId = activeTab?.pluginInstance?.viewId;
                    const currentPluginId = activeTab?.pluginInstance?.plugin?.id;

                    if (cmd.when.activeViewId && currentViewId !== cmd.when.activeViewId) {
                        return false;
                    }
                    if (cmd.when.activePluginId && currentPluginId !== cmd.when.activePluginId) {
                        return false;
                    }
                    return true;
                });

                return {
                    featureId,
                    title: groupTitles[featureId] || (featureId.charAt(0).toUpperCase() + featureId.slice(1)),
                    commands: visibleCommands,
                };
            })
            .filter((group) => group.commands.length > 0);
    }, [featureCommands, activeTab?.pluginInstance?.viewId, activeTab?.pluginInstance?.plugin?.id]);

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            showCloseButton={false}
            className="max-w-[620px]"
            commandClassName="bg-bg text-foreground"
            title="Command Palette"
            description="Search for a command to run"
        >
            <div className="border-b px-3 py-2" data-slot="command-toolbar">
                <div className="flex items-center gap-1.5">
                    <Command className="size-3 text-muted-foreground" />
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em]">Command Palette</span>
                    <span className="text-[10px] text-muted-foreground">{commandGroups.reduce((acc, g) => acc + g.commands.length, 0)} commands</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">Cmd/Ctrl + K</span>
                </div>
            </div>

            <CommandInput ref={inputRef} placeholder="Search commands..." className="h-8 text-xs" />
            <CommandList className="max-h-[420px]">
                <CommandEmpty>No results found.</CommandEmpty>

                {commandGroups.map((group, index) => (
                    <React.Fragment key={group.featureId}>
                        <CommandGroup heading={group.title}>
                            {group.commands.map((command) => {
                                const IconComponent = iconMap[command.icon as keyof typeof iconMap] || FileText;

                                let searchValue = command.name;
                                if (command.id === "notes.open") {
                                    searchValue = "notes";
                                } else if (command.id === "notes.openTomorrow") {
                                    searchValue = `${command.name} tom tomorrow`;
                                }

                                return (
                                    <CommandItem
                                        key={command.id}
                                        onSelect={() => {
                                            void command.callback();
                                        }}
                                        value={searchValue}
                                        className="items-start gap-2 py-2"
                                    >
                                        <IconComponent className="mt-0.5 h-3.5 w-3.5" />
                                        <div className="flex min-w-0 flex-col">
                                            <span className="truncate text-xs font-medium">{command.name}</span>
                                            <span className="truncate text-[10px] text-muted-foreground">{command.description}</span>
                                        </div>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {index < commandGroups.length - 1 && <CommandSeparator />}
                    </React.Fragment>
                ))}
            </CommandList>
        </CommandDialog>
    );
}
