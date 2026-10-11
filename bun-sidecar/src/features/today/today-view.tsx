import { useEffect } from "react";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { openTodayNoteTab } from "./open-today-note";

/**
 * Today used to be a BPagent chat running /daily. The diary is now just today's
 * daily note, so a Today tab restored from an older workspace hands off to that
 * note and closes itself.
 */
export default function TodayView({ tabId }: { tabId: string }) {
    const { openTab, closeTab, closeTabInPane, workspace } = useWorkspaceContext();

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await openTodayNoteTab(openTab);
            } catch (err) {
                console.error("[Today] Opening today's note failed:", err);
                return;
            }
            if (cancelled) return;
            if (workspace.layoutMode === "split") {
                const pane = workspace.panes.find((p) => p.tabs.some((tab) => tab.id === tabId));
                if (pane) closeTabInPane(pane.id, tabId);
            } else {
                closeTab(tabId);
            }
        })();
        return () => {
            cancelled = true;
        };
        // Runs once per mount: the hand-off is a one-shot migration of this tab.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabId]);

    return null;
}
