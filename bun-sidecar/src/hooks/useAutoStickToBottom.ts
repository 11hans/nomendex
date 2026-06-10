import { useCallback, useEffect, useRef } from "react";

const DEFAULT_THRESHOLD_PX = 96;

/**
 * Keeps chat pinned to bottom while user is near bottom.
 * If user scrolls up, auto-stick is suspended until they scroll back down.
 */
export function useAutoStickToBottom(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  thresholdPx = DEFAULT_THRESHOLD_PX,
) {
  const shouldStickRef = useRef(true);

  const updateStickState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    shouldStickRef.current = distanceFromBottom <= thresholdPx;
  }, [scrollRef, thresholdPx]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    updateStickState();
    const handleScroll = () => updateStickState();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [scrollRef, updateStickState]);

  const scrollToBottomIfNeeded = useCallback((force = false) => {
    const container = scrollRef.current;
    if (!container) return;
    if (!force && !shouldStickRef.current) return;

    const scrollNow = () => {
      const nextTop = Math.max(container.scrollHeight - container.clientHeight, 0);
      container.scrollTop = nextTop;
    };

    // Run across layout phases to handle async content growth (markdown/images/tool output).
    requestAnimationFrame(scrollNow);
    setTimeout(scrollNow, 30);
    setTimeout(scrollNow, 120);
  }, [scrollRef]);

  return {
    scrollToBottomIfNeeded,
  };
}
