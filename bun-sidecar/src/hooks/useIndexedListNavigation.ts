import { useCallback, useEffect, useRef, useState } from "react";

interface UseIndexedListNavigationOptions {
    itemCount: number;
    onEnter: (index: number) => void;
    resetKey?: string;
}

export function useIndexedListNavigation({
    itemCount,
    onEnter,
    resetKey,
}: UseIndexedListNavigationOptions) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (itemCount === 0) return;

            switch (event.key) {
                case "ArrowDown":
                    event.preventDefault();
                    setSelectedIndex((prev) => Math.min(prev + 1, itemCount - 1));
                    break;
                case "ArrowUp":
                    event.preventDefault();
                    setSelectedIndex((prev) => Math.max(prev - 1, 0));
                    break;
                case "Enter":
                    event.preventDefault();
                    onEnter(selectedIndex);
                    break;
            }
        },
        [itemCount, onEnter, selectedIndex]
    );

    useEffect(() => {
        if (resetKey === undefined) return;
        setSelectedIndex(0);
    }, [resetKey]);

    useEffect(() => {
        if (selectedIndex < itemCount) return;
        setSelectedIndex(Math.max(itemCount - 1, 0));
    }, [itemCount, selectedIndex]);

    useEffect(() => {
        if (!listRef.current) return;
        const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
        selectedItem?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedIndex]);

    return {
        selectedIndex,
        setSelectedIndex,
        listRef,
        handleKeyDown,
    };
}
