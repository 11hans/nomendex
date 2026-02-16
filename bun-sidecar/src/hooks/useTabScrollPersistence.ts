import { useEffect, useRef } from "react";

// Module-level storage survives component unmounts
const scrollPositions = new Map<string, number>();

/**
 * Hook to persist scroll position for a tab's scrollable container.
 * Saves position on every scroll event, restores when content becomes scrollable
 * or when the tab becomes active again.
 *
 * @param tabId - The unique tab identifier
 * @param isActive - Whether this tab is currently active (triggers restoration when becoming active)
 * @returns A ref to attach to the scrollable container element
 */
export function useTabScrollPersistence(tabId: string, isActive: boolean = true) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const hasRestoredRef = useRef(false);
    const wasActiveRef = useRef(isActive);

    // Track scroll position continuously
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        const handleScroll = () => {
            const currentScroll = element.scrollTop;
            scrollPositions.set(tabId, currentScroll);
        };

        element.addEventListener("scroll", handleScroll);

        return () => {
            element.removeEventListener("scroll", handleScroll);
        };
    }, [tabId]);

    // Handle scroll restoration on mount and when tab becomes active
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        // Reset restoration flag when tabId changes (new tab)
        hasRestoredRef.current = false;

        const savedPosition = scrollPositions.get(tabId);

        // Function to attempt scroll restoration
        const tryRestore = () => {
            if (hasRestoredRef.current) return;
            if (savedPosition === undefined || savedPosition === 0) {
                hasRestoredRef.current = true;
                return;
            }

            // Only restore if the element is actually scrollable
            if (element.scrollHeight > element.clientHeight) {
                element.scrollTop = savedPosition;
                hasRestoredRef.current = true;
            }
        };

        // Try immediately
        tryRestore();

        // Watch for content changes that make the element scrollable
        const observer = new ResizeObserver(() => {
            tryRestore();
        });
        observer.observe(element);

        // Also observe children being added (for async content)
        const mutationObserver = new MutationObserver(() => {
            tryRestore();
        });
        mutationObserver.observe(element, { childList: true, subtree: true });

        // Cleanup
        return () => {
            observer.disconnect();
            mutationObserver.disconnect();
        };
    }, [tabId]);

    // Restore scroll position when tab becomes active again
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;

        // Check if tab is becoming active (was inactive, now active)
        const becomingActive = isActive && !wasActiveRef.current;
        wasActiveRef.current = isActive;

        if (becomingActive) {
            const savedPosition = scrollPositions.get(tabId);
            if (savedPosition !== undefined && savedPosition > 0) {
                // Use requestAnimationFrame to ensure DOM is ready
                requestAnimationFrame(() => {
                    if (element.scrollHeight > element.clientHeight) {
                        element.scrollTop = savedPosition;
                    }
                });
            }
        }
    }, [tabId, isActive]);

    return scrollRef;
}

/**
 * Clear saved scroll position for a tab (e.g., when tab is closed)
 */
export function clearTabScrollPosition(tabId: string) {
    scrollPositions.delete(tabId);
}
