import { useCallback, useEffect, useRef, useState } from "react";
import { todosAPI } from "@/hooks/useTodosAPI";
import type { TodoKind } from "@/features/todos/todo-types";

interface RewriteInput {
    title: string;
    description: string;
    kind: TodoKind;
}

interface Snapshot {
    title: string;
    description: string;
}

export function useRewriteDraft() {
    const [isRewriting, setIsRewriting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSnapshot, setLastSnapshot] = useState<Snapshot | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    const rewrite = useCallback(async (
        input: RewriteInput,
    ): Promise<{ title: string; description: string } | null> => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setError(null);
        setIsRewriting(true);
        try {
            const result = await todosAPI.rewriteDraft(
                { title: input.title, description: input.description, kind: input.kind },
                ac.signal,
            );
            setLastSnapshot({ title: input.title, description: input.description });
            return result;
        } catch (err) {
            if (ac.signal.aborted) return null;
            const message = err instanceof Error ? err.message : "Rewrite failed";
            const status = (err as { status?: number }).status;
            if (status === 503) {
                setError(message);
            } else if (message.startsWith("API error:")) {
                setError("Rewrite failed. Try again.");
            } else {
                setError(message);
            }
            return null;
        } finally {
            if (abortRef.current === ac) {
                setIsRewriting(false);
                abortRef.current = null;
            }
        }
    }, []);

    const clearSnapshot = useCallback(() => setLastSnapshot(null), []);
    const clearError = useCallback(() => setError(null), []);

    return { isRewriting, error, lastSnapshot, rewrite, clearSnapshot, clearError };
}
