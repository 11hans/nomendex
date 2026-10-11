import type { Todo } from "@/features/todos/todo-types";
import { toLocalDateString } from "@/features/notes/date-utils";

// "zítra: <plan>", also typed without diacritics, capitalised, as a list item or a bold label.
const PLAN_LINE = /^(?:[-*+]\s+)?(?:\*\*|__)?z[ií]tra(?:\*\*|__)?\s*:(?:\*\*|__)?\s*(.*)$/iu;

/** The plan from the last "zítra:" line that has one, or undefined. */
export function extractPlan(content: string): string | undefined {
    const lines = content.normalize("NFC").split(/\r?\n/).reverse();
    for (const line of lines) {
        const match = PLAN_LINE.exec(line.trim());
        const plan = match?.[1] ? unescapeMarkdown(match[1]).trim() : "";
        if (plan) return plan;
    }
    return undefined;
}

// The rich editor escapes markdown punctuation and ends hard-broken lines with "\".
function unescapeMarkdown(text: string): string {
    return text.replace(/\\$/, "").replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1");
}

/** Done todos whose completedAt falls on the given local day, oldest first. */
export function completedOn(todos: Todo[], day: Date): Todo[] {
    const dayKey = toLocalDateString(day);
    return todos
        .filter((todo) => todo.status === "done" && todo.completedAt && toLocalDateString(new Date(todo.completedAt)) === dayKey)
        .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""));
}

/**
 * Open todos whose scheduled range covers the given local day: all-day ones first,
 * then by start time. Done todos belong to completedOn instead.
 */
export function scheduledOn(todos: Todo[], day: Date): Todo[] {
    const dayKey = toLocalDateString(day);
    return todos
        .filter((todo) => {
            if (todo.status === "done" || !todo.scheduledStart) return false;
            const start = todo.scheduledStart.slice(0, 10);
            const end = (todo.scheduledEnd ?? todo.scheduledStart).slice(0, 10);
            return start <= dayKey && dayKey <= end;
        })
        .sort((a, b) => startTimeOn(a, day).localeCompare(startTimeOn(b, day)));
}

/** "hh:mm" when the todo starts at a set time on this day; "" for all-day or started on an earlier day. */
export function startTimeOn(todo: Todo, day: Date): string {
    const start = todo.scheduledStart ?? "";
    return start.slice(0, 10) === toLocalDateString(day) && start.includes("T") ? start.slice(11, 16) : "";
}

/** Todos in progress, minus those already listed as scheduled for the day. */
export function inProgress(todos: Todo[], scheduled: Todo[]): Todo[] {
    const listed = new Set(scheduled.map((todo) => todo.id));
    return todos.filter((todo) => todo.status === "in_progress" && !listed.has(todo.id));
}
