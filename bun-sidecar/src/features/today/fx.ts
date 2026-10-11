import path from "path";
import { functions as notesFunctions, getDailyNoteName } from "@/features/notes/fx";
import { parseDailyNoteDate, toLocalDateString } from "@/features/notes/date-utils";
import { getArchivedTodos, getTodos } from "@/features/todos/fx";
import type { Todo } from "@/features/todos/todo-types";
import { completedOn, extractPlan, inProgress, scheduledOn, startTimeOn } from "./daily-panel";
import type { DailyPanel } from "./today-types";

/**
 * Panel data for a daily note: the previous day's "zítra:" plan, todos scheduled for
 * the note's day, todos in progress (today's note only) and the todos completed that day.
 * Null for anything that isn't a daily note.
 */
export async function getDailyPanel(args: { fileName: string }): Promise<DailyPanel | null> {
    const day = parseDailyNoteDate(path.basename(args.fileName));
    if (!day) return null;
    // Only the daily notes folder counts, not any note that happens to be named like a date.
    if ((await getDailyNoteName({ date: day.toISOString() })).fileName !== args.fileName) return null;

    const previousDay = new Date(day);
    previousDay.setDate(previousDay.getDate() - 1);
    const { fileName: previousFileName } = await getDailyNoteName({ date: previousDay.toISOString() });

    const [previousNote, activeTodos, archivedTodos] = await Promise.all([
        notesFunctions.getNoteByFileName.fx({ fileName: previousFileName }),
        getTodos({ includeSubtasks: true }),
        getArchivedTodos({}),
    ]);

    const scheduled = scheduledOn(activeTodos, day);
    // Status has no history, so "in progress" is only true for today's note.
    const isToday = toLocalDateString(day) === toLocalDateString(new Date());
    const toPanelTodo = ({ id, title, project }: Todo) => ({ id, title, project });

    return {
        plan: extractPlan(previousNote.content),
        scheduledTodos: scheduled.map((todo) => ({ ...toPanelTodo(todo), time: startTimeOn(todo, day) || undefined })),
        inProgressTodos: isToday ? inProgress(activeTodos, scheduled).map(toPanelTodo) : [],
        completedTodos: completedOn([...activeTodos, ...archivedTodos], day).map(toPanelTodo),
    };
}
