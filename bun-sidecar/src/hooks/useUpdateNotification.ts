import { useEffect } from "react";
import { toast } from "sonner";

// Extend Window interface for update notification global function
declare global {
    interface Window {
        __notifyUpdateAvailable?: (info: { version: string }) => void;
    }
}

/**
 * Trigger the native Sparkle update flow.
 * This tells Swift to show the Sparkle update dialog.
 */
function triggerNativeUpdate() {
    if (window.webkit?.messageHandlers?.triggerAppUpdate) {
        window.webkit.messageHandlers.triggerAppUpdate.postMessage({});
    }
}

/**
 * Hook that listens for update availability notifications from the native Mac app.
 *
 * When Sparkle detects an update, Swift calls `window.__notifyUpdateAvailable({ version })`.
 * This hook shows a toast notification with an "Update" button that triggers
 * the native Sparkle update dialog.
 *
 * Should be called once at the app root level.
 */
export function useUpdateNotification() {
    useEffect(() => {
        // Handler called by Swift when an update is available
        const notifyUpdateAvailable = (info: { version: string }) => {
            toast.info(`Update available: v${info.version}`, {
                duration: Infinity, // Keep visible until dismissed
                action: {
                    label: "Update",
                    onClick: () => {
                        triggerNativeUpdate();
                    },
                },
                dismissible: true,
            });
        };

        // Register global function for Swift to call
        window.__notifyUpdateAvailable = notifyUpdateAvailable;

        return () => {
            delete window.__notifyUpdateAvailable;
        };
    }, []);
}
