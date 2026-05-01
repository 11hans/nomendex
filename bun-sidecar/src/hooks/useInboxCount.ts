import { useEffect, useState } from "react";
import { todosAPI } from "./useTodosAPI";
import { onRefresh, subscribe } from "@/lib/events";

export function useInboxCount(): number {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let cancelled = false;

        const refetch = async () => {
            try {
                const result = await todosAPI.getInboxCount();
                if (!cancelled) setCount(result.count);
            } catch {
                // Ignore — sidebar badge is best-effort.
            }
        };

        void refetch();

        const unsubRefresh = onRefresh(refetch, ["todo", "todos-list"]);
        const unsubCreated = subscribe("todos:inboxCreated", refetch);

        return () => {
            cancelled = true;
            unsubRefresh();
            unsubCreated();
        };
    }, []);

    return count;
}
