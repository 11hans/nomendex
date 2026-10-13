import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { onRefresh, subscribe } from "@/lib/events";
import { todayAPI } from "@/hooks/useTodayAPI";
import type { DailyPanel } from "./today-types";

const REFETCH_DEBOUNCE_MS = 300;

/**
 * Read-only context above a daily note: the plan (previous day's "zítra:", todos
 * scheduled that day, todos in progress) and the todos completed that day.
 * Renders nothing for other notes or when there is nothing to show.
 */
export function DailyNotePanel({ fileName, compact }: { fileName: string; compact?: boolean }) {
    const { currentTheme } = useTheme();
    const [panel, setPanel] = useState<DailyPanel | null>(null);
    // Daily note names are all digits and separators; the server decides the rest
    // (folder and format come from Obsidian's settings).
    const mayBeDailyNote = /\d/.test(fileName.split("/").pop() ?? "");

    useEffect(() => {
        setPanel(null);
        if (!mayBeDailyNote) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const refetch = async () => {
            try {
                const result = await todayAPI.getDailyPanel({ fileName });
                if (!cancelled) setPanel(result);
                return result;
            } catch {
                // Best-effort context; the note itself is what matters.
                return null;
            }
        };
        const scheduleRefetch = () => {
            clearTimeout(timer);
            timer = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
        };

        void refetch().then((result) => {
            if (cancelled || !result) return;
            const unsubTodos = onRefresh(scheduleRefetch, "todos-list");
            // The plan lives in the previous day's note, which may be edited elsewhere (e.g. Obsidian).
            const unsubNotes = subscribe("notes:fileChanged", (event) => {
                if (event.fileName !== fileName) scheduleRefetch();
            });
            unsubscribe = () => {
                unsubTodos();
                unsubNotes();
            };
        });

        return () => {
            cancelled = true;
            clearTimeout(timer);
            unsubscribe();
        };
    }, [fileName, mayBeDailyNote]);

    if (!panel) return null;
    const hasPlan = Boolean(panel.plan) || panel.scheduledTodos.length > 0 || panel.inProgressTodos.length > 0;
    if (!hasPlan && panel.completedTodos.length === 0) return null;

    const labelStyle = { color: currentTheme.styles.contentTertiary };

    return (
        <div className={cn("w-full mx-auto pt-3", compact ? "max-w-none px-4" : "max-w-[900px] px-5")}>
            <div
                className="mx-5 rounded-md border px-4 py-3 text-sm space-y-2"
                style={{
                    borderColor: currentTheme.styles.borderDefault,
                    backgroundColor: currentTheme.styles.surfaceSecondary,
                    color: currentTheme.styles.contentPrimary,
                }}
            >
                {hasPlan && (
                    <div className="flex gap-3">
                        <span className="w-14 shrink-0" style={labelStyle}>Plán</span>
                        <ul className="space-y-0.5 min-w-0">
                            {panel.plan && <li className="whitespace-pre-wrap">{panel.plan}</li>}
                            {panel.scheduledTodos.map((todo) => (
                                <PanelTodoLine key={todo.id} todo={todo} labelStyle={labelStyle}>
                                    {todo.time}
                                </PanelTodoLine>
                            ))}
                            {panel.inProgressTodos.map((todo) => (
                                <PanelTodoLine key={todo.id} todo={todo} labelStyle={labelStyle}>
                                    <Clock className="size-3" aria-label="Rozdělané" />
                                </PanelTodoLine>
                            ))}
                        </ul>
                    </div>
                )}
                {panel.completedTodos.length > 0 && (
                    <div className="flex gap-3">
                        <span className="w-14 shrink-0" style={labelStyle}>Hotovo</span>
                        <ul className="space-y-0.5 min-w-0">
                            {panel.completedTodos.map((todo) => (
                                <PanelTodoLine key={todo.id} todo={todo} labelStyle={labelStyle} />
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

/** One todo in the panel; `children` is an optional marker before the title (start time, in-progress icon). */
function PanelTodoLine({
    todo,
    labelStyle,
    children,
}: {
    todo: DailyPanel["completedTodos"][number];
    labelStyle: CSSProperties;
    children?: ReactNode;
}) {
    return (
        <li className="flex items-baseline gap-2">
            {children && (
                <span className="inline-flex items-center self-center text-xs tabular-nums shrink-0" style={labelStyle}>
                    {children}
                </span>
            )}
            <span>
                {todo.title}
                {todo.project && (
                    <span className="ml-2 text-xs" style={labelStyle}>{todo.project}</span>
                )}
            </span>
        </li>
    );
}
