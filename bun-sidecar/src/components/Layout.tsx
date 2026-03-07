import { Outlet } from "react-router-dom";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";

// Height of the draggable title bar row for macOS traffic lights
export const TITLE_BAR_HEIGHT = 30;

export function Layout() {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="flex flex-col h-screen w-full overflow-hidden">
                    {/* Title bar row – spans full width, contains macOS traffic lights */}
                    <div
                        className="w-full flex-shrink-0"
                        style={{ height: `${TITLE_BAR_HEIGHT}px`, WebkitAppRegion: "drag" } as React.CSSProperties}
                    />
                    {/* Sidebar + main content below the title bar */}
                    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
                        <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="bg-card glass overflow-hidden">
                            <WorkspaceSidebar />
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel className="flex flex-col min-w-0 min-h-0">
                            <Outlet />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem>Hello world</ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
