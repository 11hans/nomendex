#!/usr/bin/env bun

import { McpServer } from "@socotra/modelcontextprotocol-sdk/server/mcp.js";
import { StdioServerTransport } from "@socotra/modelcontextprotocol-sdk/server/stdio.js";
import { FileDatabase } from "@/storage/FileDatabase";
import { Todo } from "./todo-types";
import { createTodo, updateTodo } from "./fx";
import { getTodosPath } from "@/storage/root-path";
import { z } from "zod";
import { canonicalizeProjectFilter, canonicalizeTodoProject, isInboxProjectName } from "@/features/projects/inbox-project";

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
    in_progress: "In progress",
    done: "Done",
    later: "Later",
};

const STATUS_ACCENT: Record<Todo["status"], string> = {
    todo: "var(--content-secondary)",
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

Format for all date fields: YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:mm (with time).`,
        inputSchema: {
            todoId: z.string(),
            updates: z.object({
                title: z.string().optional(),
                description: z.string().optional(),
                status: z.enum(["todo", "in_progress", "done", "later"]).optional(),
                project: z.string().optional(),
                scheduledStart: z.string().nullable().optional(),
                scheduledEnd: z.string().nullable().optional(),
                dueDate: z.string().nullable().optional(),
                duration: z.number().nullable().optional(),
            }),
        },
    },
    async (input) => {
        const updated = await updateTodo(input);
        return renderUI({
            html: buildMutationHtml("Todo Updated", `${updated.title} (${STATUS_LABEL[updated.status]})`),
            title: "Update Result",
            height: 150,
        });
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

Format for all date fields: YYYY-MM-DD (all-day) or YYYY-MM-DDTHH:mm (with time).`,
        inputSchema: {
            title: z.string(),
            description: z.string().optional(),
            project: z.string().optional(),
            scheduledStart: z.string().nullable().optional(),
            scheduledEnd: z.string().nullable().optional(),
            dueDate: z.string().nullable().optional(),
            duration: z.number().optional(),
        },
    },
    async (input) => {
        const created = await createTodo(input);
        return renderUI({
            html: buildMutationHtml("Todo Created", `${created.title} (ID: ${created.id})`),
            title: "Create Result",
            height: 150,
        });
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
