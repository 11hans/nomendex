#!/usr/bin/env bun

import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { FileDatabase } from "@/storage/FileDatabase";
import { Todo, getEffectiveGoalRefs } from "./todo-types";
import { createTodo, updateTodo, skipRecurrenceOccurrence } from "./fx";
import { RecurrenceSchema, formatRecurrence } from "./todo-types";
import { getNomendexPath, getTodosPath } from "@/storage/root-path";
import path from "path";
import { z } from "zod";
import { canonicalizeProjectFilter, canonicalizeTodoProject, isInboxProjectName } from "@/features/projects/inbox-project";

// Lightweight project→goalRef lookup. The MCP server runs as a child process
// without the projects service, so we read projects.json directly when an agent
// asks for a todo's effective goalRefs (which inherit from project.goalRef).
async function loadProjectGoalRefMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const file = Bun.file(path.join(getNomendexPath(), "projects.json"));
        if (!(await file.exists())) return map;
        const raw = await file.json() as { projects?: Array<{ name?: string; goalRef?: string }> };
        for (const project of raw.projects ?? []) {
            if (project.name && project.goalRef) {
                map.set(project.name.toLowerCase(), project.goalRef);
            }
        }
    } catch {
        // Best-effort: agents fall back to explicit goalRefs only.
    }
    return map;
}

// Initialize database
const todosDb = new FileDatabase<Todo>(getTodosPath());
await todosDb.initialize();

// Create MCP server with higher-level API
const server = new McpServer({
    name: "todos-mcp-server",
    version: "1.0.0",
});

const STATUS_LABEL: Record<Todo["status"], string> = {
    todo: "To do",
    planned: "Planned",
    in_progress: "In progress",
    done: "Done",
    later: "Later",
};

const STATUS_ACCENT: Record<Todo["status"], string> = {
    todo: "var(--content-secondary)",
    planned: "var(--semantic-warning)",
    in_progress: "var(--semantic-primary)",
    done: "var(--semantic-success)",
    later: "var(--content-tertiary)",
};

function escapeHtml(input: string): string {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderUI(args: { html: string; title: string; height?: number }) {
    return {
        content: [{
            type: "text" as const,
            text: JSON.stringify({
                __noetect_ui: true,
                html: args.html,
                title: args.title,
                height: args.height,
            })
        }]
    };
}

// Like renderUI, but also emits a second structured-JSON content item so the
// agent can read back the resulting fields programmatically (not just parse HTML).
function renderUIWithData(args: { html: string; title: string; height?: number }, data: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify({
                    __noetect_ui: true,
                    html: args.html,
                    title: args.title,
                    height: args.height,
                }),
            },
            {
                type: "text" as const,
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}

// Compact projection of a todo for MCP response bodies — only the fields an
// agent needs to confirm a mutation (not the full shape).
function projectTodoForAgent(t: Todo) {
    return {
        id: t.id,
        title: t.title,
        status: t.status,
        project: canonicalizeTodoProject(t.project),
        scheduledStart: t.scheduledStart ?? null,
        scheduledEnd: t.scheduledEnd ?? null,
        dueDate: t.dueDate ?? null,
        duration: t.duration ?? null,
        priority: t.priority ?? null,
        recurrence: t.recurrence ?? null,
        parentTodoId: t.parentTodoId ?? null,
    };
}

// Full projection for get_todo — includes fields an agent may want to read
// (description, tags, archived, completedAt, timestamps) but still trims
// internal bookkeeping (customColumnId, attachments blobs).
function projectTodoFull(t: Todo, projectGoalRefByName: Map<string, string>) {
    const projectGoalRef = t.project
        ? projectGoalRefByName.get(t.project.toLowerCase())
        : undefined;
    return {
        ...projectTodoForAgent(t),
        description: t.description ?? null,
        kind: t.kind,
        source: t.source,
        tags: t.tags ?? [],
        archived: t.archived ?? false,
        completedAt: t.completedAt ?? null,
        calendarReminderPreset: t.calendarReminderPreset ?? null,
        // Effective goal IDs: explicit todo.goalRefs win, otherwise inherited from
        // project.goalRef. Closed todos always carry a frozen explicit value.
        goalRefs: getEffectiveGoalRefs(t, projectGoalRef),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    };
}

function buildTodosHtml(todos: Todo[], project?: string): string {
    const counts = {
        todo: todos.filter((t) => t.status === "todo").length,
        inProgress: todos.filter((t) => t.status === "in_progress").length,
        done: todos.filter((t) => t.status === "done").length,
        later: todos.filter((t) => t.status === "later").length,
    };

    if (todos.length === 0) {
        return `
<div class="card" style="display:flex;flex-direction:column;gap:10px;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
    <strong style="font-size:15px;">No todos found</strong>
    <span class="text-secondary" style="font-size:12px;">${project ? `Project: ${escapeHtml(project)}` : "All projects"}</span>
  </div>
  <p class="text-secondary" style="margin:0;font-size:13px;">Create a todo first, or adjust your project filter.</p>
</div>`;
    }

    const rows = todos
        .map((todo) => {
            const projectLabel = escapeHtml(canonicalizeTodoProject(todo.project));
            const description = todo.description?.trim() ? escapeHtml(todo.description) : "";
            const scheduledStart = todo.scheduledStart?.trim() ? escapeHtml(todo.scheduledStart) : "";
            const scheduledEnd = todo.scheduledEnd?.trim() ? escapeHtml(todo.scheduledEnd) : "";
            const dueDate = todo.dueDate?.trim() ? escapeHtml(todo.dueDate) : "";
            const priority = todo.priority && todo.priority !== "none" ? escapeHtml(todo.priority) : "";
            const updatedAt = todo.updatedAt ? new Date(todo.updatedAt).toLocaleString() : "";

            return `
<tr>
  <td style="padding:10px 8px;vertical-align:top;">
    <div style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-weight:600;color:var(--content-primary);">${escapeHtml(todo.title)}</span>
      ${description ? `<span class="text-secondary" style="font-size:12px;line-height:1.4;">${description}</span>` : ""}
      <span class="text-muted" style="font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(todo.id)}</span>
    </div>
  </td>
  <td style="padding:10px 8px;vertical-align:top;">
    <span style="display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;background:var(--surface-secondary);color:${STATUS_ACCENT[todo.status]};font-size:11px;border:1px solid var(--border-default);">${STATUS_LABEL[todo.status]}</span>
  </td>
  <td style="padding:10px 8px;vertical-align:top;">
    <span class="text-secondary" style="font-size:12px;">${projectLabel}</span>
  </td>
  <td style="padding:10px 8px;vertical-align:top;">
    <div style="display:flex;flex-direction:column;gap:2px;">
      ${priority ? `<span class="text-secondary" style="font-size:12px;">Priority: ${priority}</span>` : ""}
      ${scheduledStart ? `<span class="text-secondary" style="font-size:12px;">Schedule: ${scheduledStart}${scheduledEnd ? ` → ${scheduledEnd}` : ""}</span>` : ""}
      ${dueDate ? `<span class="text-secondary" style="font-size:12px;">Deadline: ${dueDate}</span>` : ""}
      ${todo.recurrence ? `<span class="text-secondary" style="font-size:12px;">↻ ${formatRecurrence(todo.recurrence)}</span>` : ""}
      ${updatedAt ? `<span class="text-muted" style="font-size:11px;">Updated: ${escapeHtml(updatedAt)}</span>` : ""}
    </div>
  </td>
</tr>`;
        })
        .join("");

    return `
<div class="card" style="display:flex;flex-direction:column;gap:12px;">
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;">
    <div style="display:flex;flex-direction:column;gap:4px;">
      <strong style="font-size:15px;">Todo Overview</strong>
      <span class="text-secondary" style="font-size:12px;">${project ? `Project filter: ${escapeHtml(project)}` : "All active todos"}</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border-default);font-size:11px;">Total ${todos.length}</span>
      <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border-default);font-size:11px;">To do ${counts.todo}</span>
      <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border-default);font-size:11px;">In progress ${counts.inProgress}</span>
      <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border-default);font-size:11px;">Done ${counts.done}</span>
      <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border-default);font-size:11px;">Later ${counts.later}</span>
    </div>
  </div>

  <div style="overflow-x:auto;">
    <table>
      <thead>
        <tr>
          <th style="font-size:11px;">Task</th>
          <th style="font-size:11px;">Status</th>
          <th style="font-size:11px;">Project</th>
          <th style="font-size:11px;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</div>`;
}

function buildProjectsHtml(projects: string[]): string {
    if (projects.length === 0) {
        return `
<div class="card" style="display:flex;flex-direction:column;gap:10px;">
  <strong style="font-size:15px;">No projects found</strong>
  <p class="text-secondary" style="margin:0;font-size:13px;">Projects appear once todos are assigned to them.</p>
</div>`;
    }

    const projectChips = projects
        .map((project) => `<span style="padding:4px 10px;border:1px solid var(--border-default);border-radius:999px;font-size:12px;">${escapeHtml(project)}</span>`)
        .join("");

    return `
<div class="card" style="display:flex;flex-direction:column;gap:12px;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
    <strong style="font-size:15px;">Projects</strong>
    <span class="text-secondary" style="font-size:12px;">${projects.length} total</span>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;">
    ${projectChips}
  </div>
</div>`;
}

function buildMutationHtml(title: string, subtitle: string): string {
    return `
<div class="card" style="display:flex;flex-direction:column;gap:8px;">
  <strong style="font-size:14px;">${escapeHtml(title)}</strong>
  <span class="text-secondary" style="font-size:12px;">${escapeHtml(subtitle)}</span>
</div>`;
}

// Register list_todos tool
server.registerTool(
    "list_todos",
    {
        title: "List Todos",
        description: "List all todos, optionally filtered by project. Returns a UI card plus structured JSON data for machine reading.",
        inputSchema: {
            project: z.string().optional(),
        },
    },
    async (input) => {
        const todos = await todosDb.findAll();
        const activeTodos = todos.filter(t => !t.archived);
        const projectFilter = canonicalizeProjectFilter(input.project);
        const filteredTodos = input.project != null
            ? activeTodos.filter((todo) => canonicalizeTodoProject(todo.project) === projectFilter)
            : activeTodos;

        const structuredData = {
            total: filteredTodos.length,
            todos: filteredTodos.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                project: canonicalizeTodoProject(t.project),
                scheduledStart: t.scheduledStart ?? null,
                scheduledEnd: t.scheduledEnd ?? null,
                dueDate: t.dueDate ?? null,
                duration: t.duration ?? null,
                priority: t.priority ?? null,
                recurrence: t.recurrence ?? null,
            })),
        };

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify({
                        __noetect_ui: true,
                        html: buildTodosHtml(filteredTodos, projectFilter),
                        title: "Todos",
                        height: 420,
                    }),
                },
                {
                    type: "text" as const,
                    text: JSON.stringify(structuredData, null, 2),
                },
            ],
        };
    }
);

// Register get_todo tool
server.registerTool(
    "get_todo",
    {
        title: "Get Todo",
        description: `Fetch a single todo by ID. Returns the full todo shape (title, status, project, dates, recurrence, tags, description, etc.) as structured JSON.

Use this instead of list_todos when you already know the ID and just need to check the current state before updating or skipping. Cheaper than listing + filtering.

Returns an error if the todo does not exist.`,
        inputSchema: {
            todoId: z.string().describe("ID of the todo to fetch"),
        },
    },
    async (input) => {
        const todo = await todosDb.findById(input.todoId);
        if (!todo) {
            return renderUIWithData(
                {
                    html: buildMutationHtml("Todo Not Found", `No todo with ID: ${input.todoId}`),
                    title: "Get Result",
                    height: 150,
                },
                { error: "not_found", todoId: input.todoId },
            );
        }
        const recurrenceNote = todo.recurrence ? ` — recurs: ${formatRecurrence(todo.recurrence)}` : "";
        const projectGoalRefByName = await loadProjectGoalRefMap();
        return renderUIWithData(
            {
                html: buildMutationHtml("Todo", `${todo.title} (${STATUS_LABEL[todo.status]})${recurrenceNote}`),
                title: "Get Result",
                height: 150,
            },
            { todo: projectTodoFull(todo, projectGoalRefByName) },
        );
    }
);

// Register list_projects tool
server.registerTool(
    "list_projects",
    {
        title: "List Projects",
        description: "List all unique project names from todos",
        inputSchema: {},
    },
    async () => {
        const todos = await todosDb.findAll();
        const projects = [...new Set(
            todos
                .map((todo) => canonicalizeTodoProject(todo.project))
        )]
            .sort((left, right) => {
                if (isInboxProjectName(left) && !isInboxProjectName(right)) return -1;
                if (!isInboxProjectName(left) && isInboxProjectName(right)) return 1;
                return left.localeCompare(right);
            });
        return renderUI({
            html: buildProjectsHtml(projects),
            title: "Todo Projects",
            height: 220,
        });
    }
);

// Register update_todo tool
server.registerTool(
    "update_todo",
    {
        title: "Update Todo",
        description: `Update a todo item. IMPORTANT: If updating project, the project must already exist. Use list_projects first.

Date field semantics:
- scheduledStart / scheduledEnd — calendar plan (when the task is scheduled to happen). Pass null to clear.
- dueDate — deadline only (drives overdue logic). Pass null to clear.
- duration — minutes; auto-derived from scheduledStart+scheduledEnd when both have a time component.

Format for all date fields: YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:mm (with time).

Recurrence:
- Set recurrence to make a todo repeat automatically.
- When a recurring todo is marked status="done", a new instance is spawned AUTOMATICALLY for the next occurrence (same title/project/tags, date advanced by the interval). The completed todo stays as done.
- IMPORTANT: Do NOT manually create the next occurrence with create_todo after marking a recurring task done — the engine does it for you. Creating it manually will produce duplicates.
- To remove recurrence, pass recurrence: null.
- Use skip_recurrence_occurrence instead of marking done if the user wants to skip this occurrence without recording a completion.`,
        inputSchema: {
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "planned", "in_progress", "done", "later"]).optional(),
                project: z.string().optional(),
                scheduledStart: z.string().nullable().optional(),
                scheduledEnd: z.string().nullable().optional(),
                dueDate: z.string().nullable().optional(),
                duration: z.number().nullable().optional(),
                recurrence: z.union([
                    RecurrenceSchema.describe("Set recurrence rule. frequency: daily|weekly|monthly. interval: repeat every N units (default 1)."),
                    z.null().describe("Pass null to remove recurrence from this todo."),
                ]).optional(),
            }),
        },
    },
    async (input) => {
        const updated = await updateTodo(input);
        const recurrenceNote = updated.recurrence ? ` — recurs: ${formatRecurrence(updated.recurrence)}` : "";
        const spawnedRecurring =
            updated.status === "done" &&
            Boolean(updated.recurrence) &&
            !updated.parentTodoId;
        return renderUIWithData(
            {
                html: buildMutationHtml("Todo Updated", `${updated.title} (${STATUS_LABEL[updated.status]})${recurrenceNote}`),
                title: "Update Result",
                height: 150,
            },
            {
                todo: projectTodoForAgent(updated),
                // Hint for the agent: a recurring completion triggered an automatic spawn.
                // The new instance has the same title with an advanced date — do NOT create it manually.
                spawnedRecurring,
            },
        );
    }
);

// Register create_todo tool
server.registerTool(
    "create_todo",
    {
        title: "Create Todo",
        description: `Create a new todo item. IMPORTANT: The project must already exist. Use list_projects first to see available projects.

Date field semantics:
- scheduledStart / scheduledEnd — calendar plan (when the task is scheduled to happen).
- dueDate — deadline only (drives overdue logic). Independent from schedule.
- duration — minutes; auto-derived from scheduledStart+scheduledEnd when both have a time component.

Format for all date fields: YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:mm (with time).

Recurrence:
- Pass recurrence to create a recurring todo. When marked done, the next occurrence is automatically spawned with the date advanced.
- Anchor date precedence: dueDate > scheduledStart > today.
- Example: { frequency: "weekly", interval: 1 } = every week. { frequency: "monthly", interval: 2 } = every 2 months.`,
        inputSchema: {
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
            scheduledStart: z.string().nullable().optional(),
            scheduledEnd: z.string().nullable().optional(),
            dueDate: z.string().nullable().optional(),
            duration: z.number().optional(),
            recurrence: RecurrenceSchema.optional().describe("Optional recurrence rule. frequency: daily|weekly|monthly. interval: repeat every N units (default 1)."),
        },
    },
    async (input) => {
        const created = await createTodo(input);
        const recurrenceNote = created.recurrence ? ` — recurs: ${formatRecurrence(created.recurrence)}` : "";
        return renderUIWithData(
            {
                html: buildMutationHtml("Todo Created", `${created.title} (ID: ${created.id})${recurrenceNote}`),
                title: "Create Result",
                height: 150,
            },
            { todo: projectTodoForAgent(created) },
        );
    }
);

// Register skip_recurrence_occurrence tool
server.registerTool(
    "skip_recurrence_occurrence",
    {
        title: "Skip Recurrence Occurrence",
        description: `Skip the current occurrence of a recurring todo, advancing its date to the next one without recording a completion.

Use this when the user says they want to skip/postpone this occurrence (e.g. "skip this week's review", "push to next week") rather than marking it done.

The todo's scheduledStart or dueDate is advanced by the recurrence interval. The todo stays with status "todo".

Note: The todo must have a recurrence set. Use update_todo with status="done" instead if you want to record a completion and spawn the next occurrence.`,
        inputSchema: {
            todoId: z.string().describe("ID of the recurring todo to skip"),
        },
    },
    async (input) => {
        const updated = await skipRecurrenceOccurrence(input);
        const nextDate = updated.dueDate ?? updated.scheduledStart ?? "next occurrence";
        return renderUIWithData(
            {
                html: buildMutationHtml("Occurrence Skipped", `${updated.title} — next: ${nextDate}`),
                title: "Skip Result",
                height: 150,
            },
            { todo: projectTodoForAgent(updated) },
        );
    }
);

// Register resources for all todos programmatically
const todos = await todosDb.findAll();
const activeTodos = todos.filter(t => !t.archived);

for (const todo of activeTodos) {
    server.registerResource(
        `todo-${todo.id}`,
        `todo://${todo.id}`,
        {
            name: todo.title || `Untitled (${todo.id})`,
            description: todo.description,
        },
        async () => {
            // Re-fetch to get latest data
            const latestTodo = await todosDb.findById(todo.id);
            if (!latestTodo) {
                throw new Error(`Todo not found: ${todo.id}`);
            }

            return {
                contents: [{
                    uri: `todo://${todo.id}`,
                    name: latestTodo.title || `Untitled (${todo.id})`,
                    text: JSON.stringify(latestTodo, null, 2),
                }],
            };
        }
    );
}

console.error(`Registered ${activeTodos.length} todo resources`);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Todo MCP server started");
