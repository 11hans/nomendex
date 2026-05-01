import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { subscribe } from "@/lib/events";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";

export function InboxToastProvider() {
    const { activeTab } = useWorkspaceContext();
    const activeTabRef = useRef(activeTab);
    activeTabRef.current = activeTab;

    useEffect(() => {
        return subscribe("todos:inboxCreated", ({ title }) => {
            const inst = activeTabRef.current?.pluginInstance;
            const isInbox = inst?.plugin?.id === "todos" && inst?.viewId === "inbox";
            if (isInbox) return;
            toast(`New task in Inbox: ${title}`);
        });
    }, []);

    return null;
}
