import { useEffect } from "react";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Trigger the native Sparkle update dialog.
 * This always shows the UI and checks for updates.
 */
export function triggerNativeUpdate() {
    if (window.webkit?.messageHandlers?.triggerAppUpdate) {
        console.log("[UpdateNotification] Triggering update check...");
        window.webkit.messageHandlers.triggerAppUpdate.postMessage({});
    }
}

/**
 * Hook that manages automatic update checking.
 *
 * - Checks for updates on mount
 * - Polls every minute and shows Sparkle UI if update available
 *
 * Should be called once at the app root level.
 */
export function useUpdateNotification() {
    useEffect(() => {
        // Check for updates immediately on mount
        triggerNativeUpdate();

        // Poll for updates every minute
        const intervalId = setInterval(() => {
            triggerNativeUpdate();
        }, UPDATE_CHECK_INTERVAL_MS);

        return () => {
            clearInterval(intervalId);
        };
    }, []);
}
