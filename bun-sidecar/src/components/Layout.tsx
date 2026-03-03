import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { Workspace } from "./Workspace";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";

// Height of the draggable title bar row for macOS traffic lights
export const TITLE_BAR_HEIGHT = 30;

export function Layout() {
    return (
        <SidebarProvider>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div className="flex flex-col h-screen w-full overflow-hidden">
                        {/* Title bar row – spans full width, contains macOS traffic lights */}
                        <div
                            className="w-full flex-shrink-0"
                            style={{ height: `${TITLE_BAR_HEIGHT}px`, WebkitAppRegion: "drag" } as React.CSSProperties}
                        />
                        {/* Sidebar + main content below the title bar */}
                        <div className="flex flex-1 min-h-0 overflow-hidden">
                            <WorkspaceSidebar />
                            <SidebarInset className="flex-1 min-w-0 min-h-0 overflow-hidden">
                                <Workspace />
                            </SidebarInset>
                        </div>
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem>Hello world</ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        </SidebarProvider>
    );
}
