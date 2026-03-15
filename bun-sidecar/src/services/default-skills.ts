import { createServiceLogger } from "@/lib/logger";
import { getSkillsPath, hasActiveWorkspace } from "@/storage/root-path";
import { SkillMetadata, SkillMetadataSchema, SkillUpdateCheckResult, SkillUpdateInfo } from "./skills-types";
import { mkdir, chmod, readdir, stat } from "node:fs/promises";
import path from "path";
import yaml from "js-yaml";

const logger = createServiceLogger("DEFAULT-SKILLS");

/**
 * Embedded default skills - these are written to workspace on first init
 */
interface DefaultSkill {
  name: string;
  files: Record<string, string>; // filename -> content
}

const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    name: "todos",
    files: {
      "SKILL.md": `---
name: todos
description: "Manages project todos via REST API. BEFORE using this skill, you must THINK: 'Does the user mention a project? Does the user imply a specific column like Today?'. Use when the user asks to create, view, update, or delete todos."
version: 6
source: nomendex
---

# Todos Management

## ⚠️ REQUIRED WORKFLOW (Always Do This)

> **NEVER skip Step 1!** You MUST load project context before creating/updating todos.

| Step | Action | Why |
|------|--------|-----|
| **1. LOAD PROJECT** | \`/api/projects/get-by-name\` | Get columns, verify project name |
| **2. THEN ACT** | \`/api/todos/create\` or \`update\` | Now you know the structure |

## 🎯 Core Concept: Custom Columns

Every project can have **custom Kanban columns** with user-defined names. You CANNOT assume column names!

**Examples of column names users might create:**
- Time-based: "Today", "This Week", "Next Sprint", "Someday"
- Workflow: "Backlog", "In Review", "Testing", "Deployed"  
- Priority: "Urgent", "High", "Low"

**Key rules:**
1. Column names are freeform text, NOT predefined
2. Always map user's words to actual column IDs from board config
3. Match project names **case-insensitively** (if user says "my project" but "My Project" exists, use the existing one)

### Status vs Custom Column

| Concept | Purpose | Values |
|---------|---------|--------|
| **status** | Lifecycle state (for filtering) | \`todo\`, \`in_progress\`, \`done\`, \`later\` |
| **customColumnId** | Visual position on board | UUID like \`col-a1b2c3d4\` |

## Overview

Manages todos via the Nomendex REST API. The API handles all validation, ID generation, timestamps, and ordering automatically.

Todos are displayed in a kanban board UI with columns for each status. Users can drag and drop todos between columns to change their status, or use the API to update status programmatically.

## Todo Status

Each todo has a status field that controls which kanban column it appears in. The available statuses are:

| Status | Description |
|--------|-------------|
| \`todo\` | Not started - the default status for new todos |
| \`in_progress\` | Currently being worked on |
| \`done\` | Completed |
| \`later\` | Deferred or backlogged for future consideration |

When creating a todo, status defaults to \`todo\` if not specified. When updating a todo's status, the system automatically assigns a new order position at the end of the target column.

## Port Discovery

The server writes its port to a discoverable location. Extract it with:

\`\`\`bash
PORT=$(cat ~/Library/Application\\ Support/com.firstloop.nomendex/serverport.json | grep -o '"port":[0-9]*' | cut -d: -f2)
\`\`\`

## API Endpoints

All endpoints use POST with JSON body at \`http://localhost:$PORT\`:

| Endpoint | Description |
|----------|-------------|
| \`/api/todos/create\` | Create a new todo |
| \`/api/todos/list\` | List todos (with optional project filter) |
| \`/api/todos/get\` | Get a single todo by ID |
| \`/api/todos/update\` | Update a todo |
| \`/api/todos/delete\` | Delete a todo |
| \`/api/todos/projects\` | List all projects |
| \`/api/todos/tags\` | List all tags |
| \`/api/todos/archive\` | Archive a todo |
| \`/api/todos/unarchive\` | Unarchive a todo |
| \`/api/todos/archived\` | List archived todos |

## Create Todo

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "project": "work"}'

# With status
curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "My todo", "status": "in_progress", "project": "work"}'
\`\`\`

## Creating in Custom Columns

**IMPORTANT**: \`customColumnId\` is NOT supported in the \`create\` endpoint. You MUST follow this workflow:

1. **Get Project**: Load project to check case-sensitive name and get board config.
2. **Create Todo**: Create the task in the project (it will start in default column).
3. **Update Todo**: Immediately move it to the target custom column.

\`\`\`bash
# 1. Check project name (CASE SENSITIVE!) and get column ID
# If project is "Demodata", then "demodata" will fail.
PROJECT=$(curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\
  -d '{"name": "Demodata"}')

# 2. Create todo
TODO=$(curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -d '{"title": "My Task", "project": "Demodata"}')
TODO_ID=$(echo $TODO | jq -r '.id')

# 3. Move to custom column (e.g. from step 1 found "col-8f9a" for "Today")
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -d '{"todoId": "$TODO_ID", "updates": {"customColumnId": "col-8f9a"}}'
\`\`\`

## List Todos

\`\`\`bash
# All active todos
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{}'

# Todos for a specific project
curl -s -X POST "http://localhost:$PORT/api/todos/list" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "work"}'
\`\`\`

## Mandatory Execution Protocol

Follow this checklist exactly for every request:

1.  **Context Analysis**:
    *   **Project Extraction**: Identify project name (e.g. "Nomendex dev").
    *   **Column Extraction**: Identify urgency/column (e.g. "today").
    *   **Title Cleaning**: Remove project and column words from the user's sentence to get the core task title.
        *   *Bad*: "Today I need to fix a UI bug in Nomedex dev"
        *   *Good*: "Fix a UI bug"

2.  **Verification (BLOCKING STEP)**:
    *   **STOP!** You cannot create the task yet.
    *   \`POST /api/todos/projects\` -> Check exact case-sensitive project name.
    *   \`POST /api/projects/get-by-name\` -> Load board config to find column IDs.

3.  **Execution**:
    *   Create using the **Cleaned Title**.
    *   Updates MUST happen immediately after to move to custom columns.

## Anti-Patterns (DO NOT DO)

*   ❌ **DO NOT use raw input as title**: Clean it first! "Add task X to project Y" -> Title: "X".
*   ❌ **DO NOT guess IDs**: Never use \`col-today\`. Look it up!
*   ❌ **DO NOT create with customColumnId**: API ignores it. Create then Update.

## Golden Example (Few-Shot)

**User**: "Today I need to fix a UI bug in Nomedex dev: tag deletion icon UI"

**Agent Thought Process**:
1.  *Analyze*:
    *   Project: "Nomedex dev" (needs verification)
    *   Column: "Dneska" -> Today
    *   **Clean Title**: "Fix a UI bug: tag deletion icon UI" (Removed project/time context)
2.  *Verify*: Must check project list for "Nomedex dev".

**Agent Actions**:
\`\`\`bash
# 1. List projects to find REAL name
curl -s -X POST "http://localhost:$PORT/api/todos/projects" -d '{}'
# Result: ["Nomendex dev"] (Note capital N!)

# 2. Get board for "Nomendex dev" to find "Today" column
curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" -d '{"name": "Nomendex dev"}'
# Result: columns: [{ "title": "Today", "id": "col-8f9a..." }]

# 3. Create Task with CLEAN TITLE and CORRECT PROJECT
# Title is NOT "Today I need...", it is just the task itself.
TODO=$(curl -s -X POST "http://localhost:$PORT/api/todos/create" \\
  -d '{"title": "Fix a UI bug: tag deletion icon UI", "project": "Nomendex dev"}')
ID=$(echo $TODO | jq -r '.id')

# 4. Move to Target Column
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -d '{"todoId": "$ID", "updates": {"customColumnId": "col-8f9a..."}}'
\`\`\`

## Important Constraints

**Project Creation is Disabled**: You cannot create new projects programmatically. 
Before assigning a todo to a project, verify the project exists using /api/todos/projects or /api/projects/list.
If the project doesn't exist, tell the user: "Please open the 'Projects' view from the sidebar and click 'New Project' to create it."

## How Claude Should Use This Skill

Always start by getting the server port, then use the appropriate endpoint.

## Custom Kanban Columns

Projects can have custom Kanban columns beyond the default statuses. To work with custom columns:

1. Use the **projects** skill to load the project and its board configuration
2. Get the column ID from the board config (e.g. map "Someday" -> "col-8f9a")
3. Update the todo with \`customColumnId\`

> **IMPORTANT**: Column IDs are dynamic generated UUIDs. NEVER guess an ID like "col-today". ALWAYS map the user's requested column name to the actual ID found in the project configuration.

Example: Moving a todo to a "Code Review" column:
\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\
  -H "Content-Type: application/json" \\
  -d '{"todoId": "todo-123", "updates": {"customColumnId": "col-review"}}'
\`\`\`

See the **projects** skill for full documentation on loading board configurations and working with custom columns.
`,
    },
  },
  {
    name: "manage-skills",
    files: {
      "SKILL.md": `---
name: manage-skills
description: Manages Claude Code skills - creates, updates, and maintains skills following established design principles. Use when the user asks to create a skill, update a skill, refactor a skill, or wants to teach Claude a new capability.
version: 4
source: nomendex
---

# Skill Management

## Skill Design Principles

### 1. SKILL.md is Self-Contained
- Contains ALL information needed to use the skill
- Should be as minimal as possible while conveying complete information
- No need for separate README, USAGE, INSTALL, or CHANGELOG files

### 2. Single Script Design
- Optimize for ONE script per skill (not multiple scripts)
- Use command-line parameters for different operations
- Pattern: \`./script.sh <command> [arguments]\`

### 3. Minimal File Structure
\`\`\`
skill-name/
├── SKILL.md          # Required - complete documentation
└── script.sh         # Optional - single CLI if needed
\`\`\`

## SKILL.md Structure

Required frontmatter:
\`\`\`yaml
---
name: skill-name
description: What it does and when to use it. Use when [triggers].
version: 1
---
\`\`\`

## Creating a New Skill

1. Create directory in \`.claude/skills/skill-name/\`
2. Create SKILL.md with frontmatter and documentation
3. Optionally add a shell script for automation
4. Make scripts executable with \`chmod +x\`

## Rendering Custom UI

For rendering interactive HTML interfaces in chat, use the **create-interface** skill which provides comprehensive documentation on the \`mcp__noetect-ui__render_ui\` tool.
`,
    },
  },
  {
    name: "projects",
    files: {
      "SKILL.md": `---
name: projects
description: "Working with projects and custom Kanban boards. BEFORE using this skill, you must THINK: 'Does the user assume the project already exists? Am I creating a duplicate because of case sensitivity?'. Use when the user mentions a project name."
version: 4
source: nomendex
---

# Projects Skill

## Overview

Projects are stored in \`.nomendex/projects.json\` - the source of truth for all project data including custom Kanban board configurations. Each project can have custom columns with optional status mapping.

## Mandatory Verification Protocol

1.  **List First**: Always call \`/api/projects/list\` before creating a new project.
2.  **Case Check**: Compare user input ("nomendex") with existing list ("Nomendex").
3.  **Reuse**: If a match (even case-insensitive) exists, USE IT. Do not create a duplicate.

## Anti-Patterns (DO NOT DO)

*   ❌ **DO NOT create blindly**: "Create project X" -> List first!
*   ❌ **DO NOT duplicate**: "nomendex" and "Nomendex" should not coexist.


## Port Discovery

\`\`\`bash
PORT=$(cat ~/Library/Application\\\\ Support/com.firstloop.nomendex/serverport.json | grep -o '"port":[0-9]*' | cut -d: -f2)
\`\`\`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| \`/api/projects/list\` | List all projects |
| \`/api/projects/get\` | Get project by ID |
| \`/api/projects/get-by-name\` | Get project by name |
| \`/api/projects/create\` | Create new project |
| \`/api/projects/update\` | Update project (name, color, board) |
| \`/api/projects/board/get\` | Get board config for project |
| \`/api/projects/board/save\` | Save board config for project |

## Loading a Project

\`\`\`bash
# By name (recommended)
curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"name": "PROJECT_NAME"}'

# By ID
curl -s -X POST "http://localhost:$PORT/api/projects/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "project-id"}'
\`\`\`

## Getting Board Configuration

The board config contains custom columns with their IDs and status mappings:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/projects/board/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "PROJECT_ID"}'
\`\`\`

Response example:
\`\`\`json
{
  "columns": [
    {"id": "col-today", "title": "Today", "order": 1, "status": "todo"},
    {"id": "col-review", "title": "Code Review", "order": 2},
    {"id": "col-done", "title": "Done", "order": 3, "status": "done"}
  ],
  "showDone": true
}
\`\`\`

## Moving a Task to a Column

After loading the project, find the correct column by name and use its ID:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"todoId": "TODO_ID", "updates": {"customColumnId": "COLUMN_ID"}}'
\`\`\`

## Saving Board Configuration

Create or update custom columns:

\`\`\`bash
curl -s -X POST "http://localhost:$PORT/api/projects/board/save" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "projectId": "PROJECT_ID",
    "board": {
      "columns": [
        {"id": "col-1", "title": "Today", "order": 1, "status": "todo"},
        {"id": "col-2", "title": "In Progress", "order": 2, "status": "in_progress"},
        {"id": "col-3", "title": "Review", "order": 3},
        {"id": "col-4", "title": "Done", "order": 4, "status": "done"}
      ],
      "showDone": true
    }
  }'
\`\`\`

## Workflow Example

User: "Move the Fix bug task to Code Review in the Nomendex project"

1. Get project by name → extract projectId
2. Get board config → find "Code Review" column → get its ID
3. Update todo with customColumnId

\`\`\`bash
# Step 1: Get project
PROJECT=$(curl -s -X POST "http://localhost:$PORT/api/projects/get-by-name" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"name": "Nomendex"}')

# Step 2: Get board config (extract projectId from response)
BOARD=$(curl -s -X POST "http://localhost:$PORT/api/projects/board/get" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"projectId": "nomendex"}')

# Step 3: Update todo (find column ID from board response)
curl -s -X POST "http://localhost:$PORT/api/todos/update" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"todoId": "fix-bug-123", "updates": {"customColumnId": "col-review"}}'
\`\`\`

## Column Status Mapping

Columns can have an optional \`status\` field. When a todo is moved to a column with a status, the todo's status is automatically updated:

| Status | Description |
|--------|-------------|
| \`todo\` | Not started |
| \`in_progress\` | Currently working on |
| \`done\` | Completed |
| \`later\` | Deferred |

Columns without a status field don't affect the todo's status when items are moved there.
`,
    },
  },
  {
    name: "create-interface",
    files: {
      "SKILL.md": `---
name: create-interface
description: Renders interactive HTML interfaces in chat using the render_ui tool. Use when the user asks to display UI, create a widget, show a form, render a chart, build an interface, or display interactive content.
version: 2
source: nomendex
---

# Create Interface

Render custom HTML interfaces directly in chat using the \`mcp__noetect-ui__render_ui\` tool. Perfect for forms, charts, tables, dashboards, and interactive widgets.

## Tool Usage

\`\`\`
Tool: mcp__noetect-ui__render_ui
Input:
  html: "<div class='card'><h2>Hello</h2></div>"   # Required - HTML content (body only, no <html> wrapper)
  title: "My Widget"                                # Optional - header above the UI
  height: 300                                       # Optional - fixed height in pixels (default: auto-resize)
\`\`\`

## Theme Integration

The UI automatically inherits the app's current theme. Use CSS variables for consistent styling across light/dark modes.

### Surface Colors (backgrounds)
| Variable | Usage |
|----------|-------|
| \`var(--surface-primary)\` | Main background |
| \`var(--surface-secondary)\` | Cards, elevated surfaces |
| \`var(--surface-tertiary)\` | Nested containers |
| \`var(--surface-accent)\` | Highlighted areas |
| \`var(--surface-muted)\` | Subtle backgrounds, code blocks |

### Content Colors (text)
| Variable | Usage |
|----------|-------|
| \`var(--content-primary)\` | Main text |
| \`var(--content-secondary)\` | Secondary text, labels |
| \`var(--content-tertiary)\` | Muted text, placeholders |
| \`var(--content-accent)\` | Highlighted text |

### Border Colors
| Variable | Usage |
|----------|-------|
| \`var(--border-default)\` | Standard borders |
| \`var(--border-accent)\` | Emphasized borders |

### Semantic Colors
| Variable | Usage |
|----------|-------|
| \`var(--semantic-primary)\` | Primary actions, links |
| \`var(--semantic-primary-foreground)\` | Text on primary background |
| \`var(--semantic-destructive)\` | Destructive actions, errors |
| \`var(--semantic-destructive-foreground)\` | Text on destructive background |
| \`var(--semantic-success)\` | Success states |
| \`var(--semantic-success-foreground)\` | Text on success background |

### Design Tokens
| Variable | Usage |
|----------|-------|
| \`var(--border-radius)\` | Standard corner radius |
| \`var(--shadow-sm)\` | Subtle shadow |
| \`var(--shadow-md)\` | Medium shadow |
| \`var(--shadow-lg)\` | Large shadow |

## Built-in Utility Classes

### Text Classes
- \`.text-primary\` - Main text color
- \`.text-secondary\` - Secondary text color
- \`.text-muted\` - Muted/tertiary text color
- \`.text-accent\` - Accent text color
- \`.text-success\` - Success color
- \`.text-destructive\` - Error/destructive color

### Background Classes
- \`.bg-primary\` - Primary surface background
- \`.bg-secondary\` - Secondary surface background
- \`.bg-muted\` - Muted surface background

### Container Classes
- \`.card\` - Styled container with secondary background, border, border-radius, and 16px padding

## Pre-styled Elements

These elements have default theme-aware styles applied automatically:

- **body** - System font, 14px, primary text color, 12px padding
- **a** - Primary semantic color
- **button** - Secondary background, border, border-radius, hover state
- **button.primary** - Primary semantic background with foreground text
- **button.destructive** - Destructive semantic background with foreground text
- **input, select, textarea** - Primary background, border, focus ring
- **table, th, td** - Full width, border-bottom on rows
- **code** - Monospace font, muted background, 2px/4px padding
- **pre** - Monospace font, muted background, 12px padding, overflow scroll

## Auto-Resize Behavior

By default, the UI auto-resizes to fit its content. The iframe:
1. Measures content height on load
2. Observes DOM mutations and resizes dynamically
3. Responds to window resize events

Set a fixed \`height\` parameter to disable auto-resize.

## Examples

### Simple Card
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 8px 0;">Status</h3>
  <p class="text-secondary" style="margin: 0;">All systems operational</p>
</div>
\`\`\`

### Form with Inputs
\`\`\`html
<div class="card">
  <h3 style="margin: 0 0 12px 0;">Contact</h3>
  <input type="text" placeholder="Name" style="width: 100%; margin-bottom: 8px;">
  <input type="email" placeholder="Email" style="width: 100%; margin-bottom: 8px;">
  <textarea placeholder="Message" style="width: 100%; height: 80px; margin-bottom: 12px;"></textarea>
  <button class="primary">Send</button>
</div>
\`\`\`

### Data Table
\`\`\`html
<table>
  <thead>
    <tr><th>Name</th><th>Status</th><th>Actions</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Item 1</td>
      <td class="text-success">Active</td>
      <td><button>Edit</button></td>
    </tr>
    <tr>
      <td>Item 2</td>
      <td class="text-muted">Inactive</td>
      <td><button>Edit</button></td>
    </tr>
  </tbody>
</table>
\`\`\`

### Stats Dashboard
\`\`\`html
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">128</div>
    <div class="text-secondary">Users</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">1.2k</div>
    <div class="text-secondary">Events</div>
  </div>
  <div class="card" style="text-align: center;">
    <div style="font-size: 24px; font-weight: 600;">99.9%</div>
    <div class="text-secondary">Uptime</div>
  </div>
</div>
\`\`\`

### Interactive with JavaScript
\`\`\`html
<div class="card">
  <div id="count" style="font-size: 32px; text-align: center; margin-bottom: 12px;">0</div>
  <div style="display: flex; gap: 8px; justify-content: center;">
    <button onclick="update(-1)">−</button>
    <button class="primary" onclick="update(1)">+</button>
  </div>
</div>
<script>
  let count = 0;
  function update(delta) {
    count += delta;
    document.getElementById('count').textContent = count;
  }
</script>
\`\`\`

## Security Notes

- UI renders in a **sandboxed iframe** with \`allow-scripts allow-forms\`
- **No access** to parent window, localStorage, cookies, or parent DOM
- Scripts execute within the iframe only
- Forms work but submissions stay within the iframe
- Safe for displaying user-generated or dynamic content
`,
    },
  },
  {
    name: "daily-notes",
    files: {
      "SKILL.md": `---
name: daily-notes
description: Manages daily notes stored in the daily-notes/ subfolder with M-D-YYYY format (e.g., 1-1-2026.md). Use when the user asks to view recent notes, create daily notes, read today's notes, summarize the week, or references dates.
version: 3
source: nomendex
---

# Daily Notes Management

## Overview

This skill manages daily notes stored in the \`daily-notes/\` subfolder within the workspace's notes directory using the \`M-D-YYYY.md\` format (e.g., \`1-1-2026.md\`, \`12-31-2025.md\`).

## Date Format

- **Format**: \`M-D-YYYY.md\` (no leading zeros)
- **Examples**: \`1-1-2026.md\`, \`12-31-2025.md\`, \`3-5-2026.md\`

## Getting the Notes Directory

\`\`\`bash
NOTES_DIR=$(curl -s http://localhost:1234/api/workspace/paths | jq -r '.data.notes')
\`\`\`

Daily notes are stored at \`$NOTES_DIR/daily-notes/\`.

## CLI Usage

\`\`\`bash
NOTES_DIR=/path/to/workspace/notes .claude/skills/daily-notes/daily-note.sh <command> [arguments]
\`\`\`

### Commands

| Command | Description |
|---------|-------------|
| \`get-today\` | Get or create today's daily note |
| \`get-note [M-D-YYYY]\` | Get a specific date's note |
| \`get-last-x [Ndays]\` | Get notes from the last N days |

## How Claude Should Use This Skill

**Important**: Always set \`NOTES_DIR\` to the workspace's notes path before running the script. The script automatically handles the \`daily-notes/\` subfolder.

### When User Asks About Recent Work
\`\`\`
User: "What have I been working on this week?"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-last-x 7days
-> Parse content and provide summary
\`\`\`

### When User Wants to Add to Today's Note
\`\`\`
User: "Add this to my daily note: Completed feature X"
-> Run: NOTES_DIR=/path/to/notes ./daily-note.sh get-today
-> Use Edit tool to append content to the returned file path
\`\`\`

## Best Practices

1. **Always set NOTES_DIR** - Don't rely on the default path
2. **Handle missing notes gracefully** - Not every day has a note
3. **Preserve existing content** - Use Edit tool, not Write when modifying
`,
      "daily-note.sh": `#!/bin/bash

# Daily Notes CLI
# Manages daily notes in daily-notes/ subfolder with M-D-YYYY format (e.g., daily-notes/1-1-2026.md)

NOTES_DIR="\${NOTES_DIR:-$HOME/.mcpclient/notes}"
DAILY_DIR="$NOTES_DIR/daily-notes"
mkdir -p "$DAILY_DIR"

format_date() {
    local date_str="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -j -f "%Y-%m-%d" "$date_str" "+%-m-%-d-%Y" 2>/dev/null
    else
        date -d "$date_str" "+%-m-%-d-%Y" 2>/dev/null
    fi
}

get_date_n_days_ago() {
    local days_ago="$1"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        date -v-"\${days_ago}"d "+%Y-%m-%d"
    else
        date -d "\${days_ago} days ago" "+%Y-%m-%d"
    fi
}

get_today() {
    date "+%-m-%-d-%Y"
}

display_note() {
    local note_file="$1"
    local note_date="$2"
    local show_header="\${3:-true}"

    if [[ -f "$note_file" && -s "$note_file" ]]; then
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "=== Notes from $note_date ==="
            echo ""
        fi
        cat "$note_file"
        if [[ "$show_header" == "true" ]]; then
            echo ""
            echo "---"
        fi
        return 0
    else
        return 1
    fi
}

cmd_get_today() {
    local TODAY=$(get_today)
    local NOTE_PATH="$DAILY_DIR/\${TODAY}.md"

    if [[ ! -f "$NOTE_PATH" ]]; then
        touch "$NOTE_PATH"
        echo "Created: $NOTE_PATH" >&2
    fi

    if [[ -s "$NOTE_PATH" ]]; then
        cat "$NOTE_PATH"
    fi
}

cmd_get_note() {
    local date_input="$1"
    if [[ -z "$date_input" ]]; then
        echo "Error: Date required" >&2
        exit 1
    fi
    local NOTE_FILE="$DAILY_DIR/\${date_input}.md"
    if display_note "$NOTE_FILE" "$date_input" "false"; then
        exit 0
    else
        echo "Error: No note found for date: $date_input" >&2
        exit 1
    fi
}

cmd_get_last_x() {
    local days_input="$1"
    if [[ -z "$days_input" ]]; then
        echo "Error: Duration required (e.g., 7days)" >&2
        exit 1
    fi
    local days="\${days_input//[^0-9]/}"
    echo "Fetching daily notes from the last $days days..."
    echo "==========================================="
    local FOUND_NOTES=0
    for ((i=0; i<days; i++)); do
        local DATE_ISO=$(get_date_n_days_ago "$i")
        local DATE_FORMATTED=$(format_date "$DATE_ISO")
        if [[ -n "$DATE_FORMATTED" ]]; then
            local NOTE_FILE="$DAILY_DIR/\${DATE_FORMATTED}.md"
            if display_note "$NOTE_FILE" "$DATE_FORMATTED"; then
                FOUND_NOTES=$((FOUND_NOTES + 1))
            fi
        fi
    done
    echo ""
    echo "Found $FOUND_NOTES note(s) from the last $days days."
}

COMMAND="\${1:-}"
case "$COMMAND" in
    get-today) cmd_get_today ;;
    get-note) cmd_get_note "$2" ;;
    get-last-x) cmd_get_last_x "$2" ;;
    *)
        echo "Daily Notes CLI"
        echo "Usage: $0 <command> [arguments]"
        echo "Commands: get-today, get-note [M-D-YYYY], get-last-x [Ndays]"
        exit 1
        ;;
esac
`,
    },
  },
  {
    name: "adopt",
    files: {
      "SKILL.md": `---
name: adopt
description: Scaffold the BPagent system onto an existing Obsidian vault. Scans your vault structure, maps folders interactively, and generates configuration.
version: 2
source: nomendex
---

# Adopt Skill

Bring Your Own Vault (BYOV) — set up the BPagent system on an existing Obsidian vault.

## Usage

\`\`\`
/adopt    # Run from the root of your existing Obsidian vault
\`\`\`

## When to Use

- You have an existing Obsidian vault and want to add the BPagent system
- You want to keep your current folder structure

## Phase 1: Scan Vault Structure

Analyze the existing vault to understand its organization.

### Steps

1. **List top-level directories** using \`ls\`, excluding system dirs (\`.obsidian\`, \`.git\`, \`.trash\`, \`.nomendex\`)

2. **For each directory**, gather signals:
   - Count \`.md\` files (using Glob)
   - Check for date-named files (\`M-D-YYYY*.md\` or \`YYYY-MM-DD*.md\`) — indicates daily notes
   - Grep for goal/review/template keywords in filenames and content

3. **Detect organization method** based on signals:
   - **PARA**: Folders named Projects, Areas, Resources, Archives
   - **Zettelkasten**: Numeric-prefixed notes, heavy wiki-linking, flat structure
   - **LYT (Linking Your Thinking)**: Folders named Atlas, Calendar, Cards, Extras, Sources
   - **Flat**: Few folders, most files at root
   - **Custom**: None of the above patterns match

4. **Present findings** to the user:
   \`\`\`
   Vault scan complete!

   Found 342 notes across 8 folders:
     daily-notes/     → 180 notes (date-named — likely daily notes)
     Projects/        → 45 notes (likely projects)
     Goals/           → 12 notes (contains goal keywords)
     Templates/       → 8 notes (contains template keywords)
     Archives/        → 67 notes
     inbox/           → 15 notes

   Detected method: PARA-like structure
   \`\`\`

## Phase 2: Map Folders to Roles

Use AskUserQuestion to confirm or correct the detected mappings.

### Roles to Map

| Role | Purpose | Detection Signal |
|------|---------|-----------------|
| Daily Notes | Daily journal entries | Date-named files (\`M-D-YYYY\`) |
| Goals | Goal cascade (3-year → weekly) | Files with goal/review keywords |
| Projects | Active projects | Subdirs with project keywords |
| Templates | Reusable note structures | Files with template keywords or in Templates/ |
| Archives | Completed/inactive content | Folder named Archive(s) |
| Inbox | Uncategorized captures | Folder named Inbox, or files tagged #inbox |

### Interactive Mapping

For each role, ask the user to confirm or correct:

**Question format (use AskUserQuestion):**
- "Which folder holds your **daily notes**?"
- Options: detected candidate(s), "I don't have one (create it)", "Skip — I don't use this"
- For optional roles (Inbox), include "Skip" as a default

**Edge cases:**
- **No candidate for a role**: Offer to create the folder
- **Multiple candidates**: Present all and let the user choose

## Phase 3: Personalize Preferences

Ask 4 questions:

**Question 1: Your name**
- "What should I call you?"
- Used for personalized prompts and greetings

**Question 2: Preferred review day**
- "What day do you prefer for your weekly review?"
- Options: Sunday (Recommended), Saturday, Monday, Friday

**Question 3: Primary goal areas**
- "Which areas are most important to you right now? (Pick 2-4)"
- Options: Career & Professional, Health & Wellness, Relationships, Personal Growth
- Also offer: Financial, Creativity & Fun, Learning, Other
- multiSelect: true

**Question 4: Work style**
- "How do you prefer BPagent to interact?"
- Options: Direct and concise (Recommended), Coaching and challenging, Detailed and thorough, Minimal — just do the task

## Phase 4: Write \`vault-config.json\`

Write \`vault-config.json\` in the vault root. This is the **only configuration file** BPagent reads.
It contains all personalization and folder mappings:

\`\`\`json
{
  "name": "User's name",
  "reviewDay": "Sunday",
  "goalAreas": ["Career & Professional", "Health & Wellness"],
  "workStyle": "Direct and concise",
  "setupDate": "2026-03-14",
  "version": "3.2",
  "adoptedVault": true,
  "folderMapping": {
    "dailyNotes": "daily-notes",
    "goals": "Goals",
    "projects": "Projects",
    "templates": "Templates",
    "archives": "Archives",
    "inbox": "inbox"
  }
}
\`\`\`

Replace values with the user's actual answers from Phase 2 and 3.

**IMPORTANT:** Do NOT create \`AGENTS.md\`, \`.claude/settings.json\`, \`.claude/rules/\`, or \`.claude/hooks/\`. BPagent does not use these files — it reads only \`vault-config.json\`.

## Phase 5: Scaffold Missing Pieces

Check what's missing and offer to create it. **Always ask before creating.**

### 5a. Goal Cascade Files

If the goals folder is empty or newly created:
- "Your goals folder is empty. Want me to create the goal cascade? (3-year vision, yearly goals, monthly goals, weekly review)"
- If yes: create the 4 goal files, adapting paths to the user's folder names
- If no: skip

### 5b. Templates

If the templates folder is empty or newly created:
- "Want me to add standard templates? (Daily, Weekly Review, Project)"
- If yes: create templates, adapting internal links to the user's folder names
- If no: skip

## Phase 6: Verify & Next Steps

### 6a. Validation

Run quick checks:
- \`vault-config.json\` is valid JSON (read it back)
- All mapped folders exist

### 6b. Summary

Present a summary:
\`\`\`
Adoption complete!

Vault: /path/to/vault
Method: Custom (preserved your existing structure)
Mapped folders:
  Daily Notes → daily-notes/
  Goals       → Goals/
  Projects    → Projects/
  Templates   → Templates/
  Archives    → Archives/
  Inbox       → inbox/

Created:
  ✓ vault-config.json (preferences & folder mapping)
  ✓ Goal cascade files (4 files)
  ✓ Standard templates (3 files)

Your vault structure is unchanged — only vault-config.json and templates were added.
\`\`\`

### 6c. Next Steps

Suggest what to do next:
- "Try \`/daily\` to create today's note"
- "Try \`/review\` for a guided weekly review"
- "Fill in your goals in \`Goals/0. 3-Year Vision.md\`"

## Error Handling

- **Already adopted**: If \`vault-config.json\` exists with \`adoptedVault: true\`, ask: "This vault was already adopted. Re-run adoption? (This will regenerate vault-config.json.)"
- **Empty vault**: If no \`.md\` files found, that's fine — the skill will create the folder structure from scratch

## Integration

Works with:
- \`/daily\` — uses mapped daily notes folder from vault-config.json
- \`/weekly\` — uses mapped goals folder from vault-config.json
- \`/review\` — respects adopted vault structure
- \`/monthly\` — uses mapped goals folder from vault-config.json
`,
    },
  },
  {
    name: "check-links",
    files: {
      "SKILL.md": `---
name: check-links
description: Find broken wiki-links in the vault. Read-only analysis — scans for [[links]] and verifies target files exist. No writes, no dependencies.
version: 2
source: nomendex
---

# Check Links Skill

Finds broken \`[[wiki-links]]\` across your vault by extracting link targets and verifying that each target file exists. Read-only — never modifies files.

## Usage

\`\`\`
/check-links
\`\`\`

Or ask:
- "Check for broken links in my vault"
- "Find dead wiki-links"
- "Are there any broken links?"

## How to Execute

### Step 1: Extract all wiki-links

Use **Grep** to find all \`[[...]]\` patterns in markdown files:

\`\`\`
Grep:
  pattern: "\\\\[\\\\[([^\\\\]|]+)"
  glob: "*.md"
  output_mode: content
  -n: true
\`\`\`

This captures the link target (before any \`|\` alias). Exclude \`.claude/\` and \`.obsidian/\` directories from results.

### Step 2: Build unique target list

From the grep results, extract the unique link targets. For each match like \`[[My Note]]\` or \`[[My Note|display text]]\`, the target is \`My Note\`.

Strip:
- Heading anchors: \`[[Note#heading]]\` → target is \`Note\`
- Block references: \`[[Note^block-id]]\` → target is \`Note\`
- Aliases: \`[[Note|alias]]\` → target is \`Note\`

### Step 3: Verify each target exists

For each unique target, use **Glob** to check if a matching file exists:

\`\`\`
Glob:
  pattern: "**/<target>.md"
\`\`\`

A link is **broken** if no file matches. A link is **valid** if at least one file matches.

### Step 4: Report results

Group broken links by source file:

\`\`\`markdown
## Broken Links Report

### daily-notes/3-14-2026.md
- [[Projet Alpha]] — no matching file found
- [[Old Goal]] — no matching file found

### Projects/Project Beta.md
- [[Meeting Notes Jan]] — no matching file found

---

**Summary:** 3 broken links across 2 files (out of 45 total links checked)
\`\`\`

### Step 5: Suggest fixes

For each broken link, try to find a close match:

1. Use **Glob** with a partial pattern: \`**/*<partial-target>*.md\`
2. If a similar filename exists, suggest it:
   \`\`\`
   - [[Projet Alpha]] — Did you mean [[Project Alpha]]?
   \`\`\`
3. If no close match, just report "no matching file found"

## Edge Cases

- **Embedded images** (\`![[image.png]]\`) — skip these, they reference attachments
- **External links** (\`[text](https://...)\`) — skip these, they are not wiki-links
- **Template placeholders** (\`[[{{date}}]]\`) — skip anything with \`{{\` in the target
- **Empty links** (\`[[]]\`) — report as malformed, not broken

## No Broken Links

If all links are valid:

\`\`\`
✅ All wiki-links verified — no broken links found across X files (Y links checked)
\`\`\`

## Tips

- Run \`/check-links\` periodically to catch link rot
- After renaming files, run this to find links that need updating
- Combine with \`/search\` to find notes that reference deleted content
`,
    },
  },
  {
    name: "daily",
    files: {
      "SKILL.md": `---
name: daily
description: Create daily notes and manage morning, midday, and evening routines. Structure daily planning, task review, and end-of-day reflection. Use for daily productivity routines or when asked to create today's note.
version: 2
source: nomendex
---

# Daily Workflow Skill

Creates daily notes and provides structured workflows for morning planning, midday check-ins, and evening shutdowns.

## Usage

Invoke with \`/daily\` or ask Codex to create today's note or help with daily routines.

### Create Today's Note
\`\`\`
/daily
\`\`\`

Or simply ask:
- "Create today's daily note"
- "Start my morning routine"
- "Help me with evening shutdown"

## Daily Note Creation

### What Happens
1. **Checks if today's note exists**
   - If yes: Opens the existing note
   - If no: Creates new note from template

2. **Template Processing**
   - Replaces \`{{date}}\` with today's date
   - Replaces \`{{date:format}}\` with formatted dates
   - Handles date arithmetic (e.g., \`{{date-1}}\` for yesterday)

3. **Automatic Organization**
   - Places note in \`Daily Notes/\` folder
   - Names file with today's date (YYYY-MM-DD.md)
   - Preserves template structure

### Template Variables
Your daily template can use:
- \`{{date}}\` - Today's date in default format
- \`{{date:dddd}}\` - Day name (e.g., Monday)
- \`{{date:MMMM DD, YYYY}}\` - Formatted date
- \`{{date-1:YYYY-MM-DD}}\` - Yesterday's date
- \`{{date+1:YYYY-MM-DD}}\` - Tomorrow's date
- \`{{time}}\` - Current time

## Morning Routine (5-10 minutes)

### Automated Steps
1. Create today's daily note (if not exists)
2. Pull incomplete tasks from yesterday
3. Fetch today's todos from "Today" column via \`/todos\` skill
4. Read this week's ONE Big Thing from \`Goals/3. Weekly Review.md\`
5. Surface active project next-actions from \`Projects/*.md\`
6. Review weekly goals for today's priority

### Cascade Context Surfacing
Before interactive prompts, automatically surface:
- **Today's todos** from "Today" column via \`/todos\` skill
- **ONE Big Thing** from most recent weekly review
- **Active project next-actions** from \`Projects/*.md\` (read "Next Actions" section)
- **Monthly priority** from \`Goals/2. Monthly Goals.md\`

Display as a brief context block at the top of the morning routine:
\`\`\`markdown
### Today's Context
- **Today's Todos (from Nomendex):**
  - [ ] [ProjectA] Start audit (est: 2h)
  - [ ] [Health] 30min run (est: 30min)
  - [ ] [Work] Fix bug (est: 1h)
  - **Total estimated:** 3.5h
- **Week's ONE Big Thing:** [from weekly review]
- **Active Projects:** [project names with first next-action each]
- **Monthly Focus:** [from monthly goals]
\`\`\`

### Interactive Prompts
- "What's your ONE thing for today?"
- "What might get in the way?"
- "How do you want to feel at end of day?"

### Task Creation Guidance
When adding tasks to the daily note, recommend linking to goals/projects:
\`\`\`markdown
- [ ] Draft API spec — Supports: [[Projects/MyApp]]
- [ ] Review chapter 3 — Supports: [[1. Yearly Goals#Read 12 books]]
\`\`\`

### Morning Checklist
- [ ] Daily note created
- [ ] Cascade context reviewed (ONE Big Thing, projects, monthly focus)
- [ ] Yesterday's incomplete tasks reviewed
- [ ] ONE priority identified
- [ ] Time blocks set
- [ ] Potential obstacles identified

## Midday Check-in (2-3 minutes)

### Quick Review
1. Check morning task completion
2. Compare actual vs planned time use
3. Assess energy level
4. Identify afternoon priorities

### Adjustments
- Reschedule incomplete morning tasks
- Add urgent items that emerged
- Reorder by current energy level
- Note any blockers

### Midday Questions
- "How's your energy right now?"
- "What's the most important thing for this afternoon?"
- "What can you let go of today?"

## Evening Shutdown (5 minutes)

### Capture
1. Mark completed tasks with [x]
2. Review and update todos via \`/todos\` skill:
   - Mark completed todos as done
   - Move uncompleted "Today" todos (carry over to tomorrow or reschedule)
   - Calculate today's completion rate
3. Add notes and learnings
4. Log energy levels (1-10)
5. Record gratitude items

### Goal & Project Attention Summary
Automatically generate an end-of-day summary showing which goals and projects received attention:
\`\`\`markdown
### Today's Cascade Impact
- **Todos completed:** 5/8 (62.5%)
  - [Nomendex] 2/3 todos
  - [Health] 1/1 todo
  - [Work] 2/4 todos
- **Goals touched:** [[Goal 1]] (2 tasks), [[Goal 3]] (1 task)
- **Projects advanced:** [[ProjectA]] (3 tasks), [[ProjectB]] (1 task)
- **Unlinked tasks:** 2 (consider linking to a goal or project)
- **Insight:** Overcommitted on Work todos — reduce tomorrow
\`\`\`

### Reflect
- What went well today?
- What could be better?
- What did I learn?
- What am I grateful for?

### Prepare
1. Identify tomorrow's priority (preview)
2. Move incomplete tasks to tomorrow or delete
3. Commit changes to git (\`/push\`)

### Shutdown Checklist
- [ ] All tasks updated (done/moved/deleted)
- [ ] Reflection completed
- [ ] Tomorrow's priority identified
- [ ] Changes committed

## Daily Note Structure

Standard daily note template:

\`\`\`markdown
# {{date}}

## Focus
> What's the ONE thing that would make today successful?

## Time Blocks
- Morning (9-12):
- Afternoon (12-5):
- Evening (5+):

## Tasks
### Must Do Today
- [ ]

### Work
- [ ]

### Personal
- [ ]

## Notes
[Capture thoughts, meeting notes, ideas]

## Reflection
- **Wins:**
- **Challenges:**
- **Learned:**
- **Grateful for:**
- **Energy:** /10
- **Tomorrow's priority:**
\`\`\`

## Time Block Strategies

### Energy-Based
- High energy tasks in morning
- Administrative work after lunch
- Creative work when naturally alert

### Context-Based
- Batch similar tasks together
- Minimize context switching
- Protect deep work blocks

## Configuration

Customize paths to match your vault:
- Daily notes folder: \`Daily Notes/\`
- Template location: \`Templates/Daily Template.md\`
- Date format: \`YYYY-MM-DD\`

### Different Date Formats
- \`YYYY-MM-DD\` - Standard ISO format (recommended)
- \`MM-DD-YYYY\` - US format
- \`DD-MM-YYYY\` - European format
- \`YYYY-MM-DD-ddd\` - Include day abbreviation

### Folder Organization by Month
Organize daily notes by month/year:
\`\`\`
Daily Notes/2024/01/2024-01-15.md
\`\`\`

## Task-Based Progress Tracking

The daily skill uses session tasks to show progress during multi-step routines.

### Morning Routine Tasks

Create tasks at skill start:

\`\`\`
TaskCreate:
  subject: "Create daily note"
  description: "Create or open today's daily note from template"
  activeForm: "Creating daily note..."

TaskCreate:
  subject: "Fetch today's todos"
  description: "Load todos from 'Today' column via /todos skill"
  activeForm: "Fetching today's todos from Nomendex..."

TaskCreate:
  subject: "Pull incomplete tasks"
  description: "Carry forward uncompleted tasks from yesterday"
  activeForm: "Pulling incomplete tasks from yesterday..."

TaskCreate:
  subject: "Surface relevant goals"
  description: "Review weekly/monthly goals for today's priority"
  activeForm: "Surfacing relevant goals..."

TaskCreate:
  subject: "Set time blocks"
  description: "Establish time blocks based on energy and priorities"
  activeForm: "Setting time blocks..."
\`\`\`

### Dependencies

Morning routine tasks run sequentially:
\`\`\`
TaskUpdate: "Pull incomplete tasks", addBlockedBy: [create-daily-note-id]
TaskUpdate: "Surface relevant goals", addBlockedBy: [pull-incomplete-tasks-id]
TaskUpdate: "Set time blocks", addBlockedBy: [surface-relevant-goals-id]
\`\`\`

### Evening Shutdown Tasks

\`\`\`
TaskCreate:
  subject: "Update task statuses"
  description: "Mark completed tasks, note blockers"
  activeForm: "Updating task statuses..."

TaskCreate:
  subject: "Update todos"
  description: "Mark completed todos, move uncompleted from Today column"
  activeForm: "Updating todos via /todos skill..."

TaskCreate:
  subject: "Calculate completion rate"
  description: "Calculate todo and task completion for the day"
  activeForm: "Calculating completion rate..."

TaskCreate:
  subject: "Generate reflection prompts"
  description: "Prompt for wins, challenges, learnings, gratitude"
  activeForm: "Generating reflection prompts..."

TaskCreate:
  subject: "Prepare tomorrow's preview"
  description: "Identify tomorrow's priority and move incomplete tasks"
  activeForm: "Preparing tomorrow's preview..."
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done using TaskUpdate.

Task tools provide visibility into what's happening during longer operations. Tasks are session-scoped and don't persist between Codex sessions—your actual work items remain in your daily note markdown checkboxes.

## Integration

Works with:
- \`/todos\` - Fetch today's todos, update completion status
- \`/push\` - Commit end-of-day changes
- \`/weekly\` - Weekly planning uses daily notes
- \`/monthly\` - Monthly goals inform daily focus
- \`/project\` - Surface project next-actions in morning
- \`/onboard\` - Load context before planning
- Goal tracking skill - Align daily tasks to goals
- Productivity Coach - Accountability for daily routines
`,
    },
  },
  {
    name: "goal-tracking",
    files: {
      "SKILL.md": `---
name: goal-tracking
description: Track progress toward 3-year, yearly, monthly, and weekly goals. Calculate completion percentages, surface stalled goals, connect daily tasks to objectives. Use for goal reviews and progress tracking.
version: 3
source: nomendex
---

# Goal Tracking Skill

Track and manage the cascading goal system from long-term vision to daily tasks.

## Goal Hierarchy

\`\`\`
Goals/0. Three Year Goals.md   <- Vision (Life areas)
    ↓
Goals/1. Yearly Goals.md       <- Annual objectives
    ↓
Projects/*/AGENTS.md           <- Active projects (bridge layer)
    ↓
Goals/2. Monthly Goals.md      <- Current month focus
    ↓
Goals/3. Weekly Review.md      <- Weekly planning
    ↓
Daily Notes/*.md               <- Daily tasks and actions
\`\`\`

## Goal File Formats

### Three Year Goals
\`\`\`markdown
## Life Areas
- Career: [Vision statement]
- Health: [Vision statement]
- Relationships: [Vision statement]
- Financial: [Vision statement]
- Learning: [Vision statement]
- Personal: [Vision statement]
\`\`\`

### Yearly Goals
\`\`\`markdown
## 2024 Goals
- [ ] Goal 1 (XX% complete)
- [ ] Goal 2 (XX% complete)
- [x] Goal 3 (100% complete)
\`\`\`

### Monthly Goals
\`\`\`markdown
## This Month's Focus
1. **Primary:** [Main focus]
2. **Secondary:** [Supporting goal]
3. **Stretch:** [If time permits]

### Key Results
- [ ] Measurable outcome 1
- [ ] Measurable outcome 2
\`\`\`

## Progress Calculation

### Checklist-Based Goals
\`\`\`
Progress = (Completed checkboxes / Total checkboxes) * 100
\`\`\`

### Metric-Based Goals
\`\`\`
Progress = (Current value / Target value) * 100
\`\`\`

### Time-Based Goals
\`\`\`
Progress = (Days elapsed / Total days) * 100
\`\`\`

## Common Operations

### View Goal Progress
1. Read all goal files
2. Parse checkbox completion rates
3. Calculate overall and per-goal progress
4. Identify stalled or at-risk goals

### Update Goal Status
1. Find goal in appropriate file
2. Update checkbox or percentage
3. Add date stamp for significant milestones
4. Update related weekly review

### Connect Task to Goal
When adding tasks to daily notes:
1. Identify which goal the task supports
2. Add goal reference: \`Supports: [[1. Yearly Goals#Goal Name]]\`
3. Use appropriate priority tag

### Surface Stalled Goals
1. Check last activity date for each goal
2. Flag goals with no progress in 14+ days
3. Suggest actions to restart momentum

## Project-Aware Progress

### Project Integration
When calculating goal progress, include project data:
1. Read all project files \`Projects/*.md\` for active projects
2. Match projects to goals via their "Goal Link" / "Supports" field
3. Fetch todos for each project via \`/todos\` skill
4. Include project completion % and todo completion rate in goal progress calculations
5. Surface which projects support each goal

### Orphan Goal Detection
Flag goals that have no active project supporting them:
- A goal with 0 linked projects may need a project created (\`/project new\`)
- A goal with only completed/archived projects may need a new initiative

### Todo-Based Progress Signals
Use todos to detect goal momentum:
1. Goals with high todo completion (60%+) = strong momentum
2. Goals with many blocked todos = need attention
3. Goals with no todos at all = missing concrete actions
4. Goals with overdue todos = falling behind

## Progress Report Format

\`\`\`markdown
## Goal Progress Report

### Overall: XX%

### By Goal
| Goal | Progress | Projects | Todos | Last Activity | Status |
|------|----------|----------|-------|---------------|--------|
| Goal 1 | 75% | [[ProjectA]] (80%), [[ProjectB]] (60%) | 25/40 (62%) | 2 days ago | On Track |
| Goal 2 | 30% | (none) | 0/0 (0%) | 14 days ago | Stalled |

### Project Status
| Project | Goal | Progress | Todos | Phase |
|---------|------|----------|-------|-------|
| [[ProjectA]] | Goal 1 | 80% | 15/20 (75%) | Active |
| [[ProjectB]] | Goal 1 | 60% | 10/20 (50%) | Active |

### Orphan Goals (no active project)
- Goal 2 — Consider \`/project new\` to create a supporting project

### Goals Needing Attention
- **Goal 2:** No todos = missing concrete actions
- **ProjectB:** 5 blocked todos = blockers need resolution

### This Week's Contributions
- [Task] -> [[Goal 1]] via [[ProjectA]]
- [Completed todo] -> [[Goal 1]] via [[ProjectA]]
- [Task] -> [[Goal 2]]

### Recommended Focus
1. [Stalled goal needs attention]
2. [Nearly complete goal - finish it]
3. [Orphan goal needs a project]
4. [Goals with blocked todos need unblocking]
\`\`\`

## Task-Based Progress Tracking

The goal tracking skill uses session tasks when generating comprehensive progress reports.

### Progress Report Tasks

Create tasks at skill start:

\`\`\`
TaskCreate:
  subject: "Read three-year goals"
  description: "Load vision statements from Goals/0. Three Year Goals.md"
  activeForm: "Reading three-year goals..."

TaskCreate:
  subject: "Read yearly goals"
  description: "Load annual objectives from Goals/1. Yearly Goals.md"
  activeForm: "Reading yearly goals..."

TaskCreate:
  subject: "Read monthly goals"
  description: "Load current month focus from Goals/2. Monthly Goals.md"
  activeForm: "Reading monthly goals..."

TaskCreate:
  subject: "Scan recent daily notes"
  description: "Find task completions and goal contributions from past week"
  activeForm: "Scanning recent daily notes..."

TaskCreate:
  subject: "Fetch todos by project"
  description: "Load todos for all projects via /todos skill"
  activeForm: "Fetching todos for goal-project mapping..."

TaskCreate:
  subject: "Calculate completion percentages"
  description: "Compute progress for each goal based on checkboxes, metrics, and todos"
  activeForm: "Calculating completion percentages..."

TaskCreate:
  subject: "Identify stalled goals"
  description: "Flag goals with no progress in 14+ days or missing todos"
  activeForm: "Identifying stalled goals..."
\`\`\`

### Dependencies

Goal file reads can run in parallel, but analysis depends on having all data:
\`\`\`
TaskUpdate: "Scan recent daily notes", addBlockedBy: [read-monthly-goals-id]
TaskUpdate: "Calculate completion percentages", addBlockedBy: [scan-recent-daily-notes-id]
TaskUpdate: "Identify stalled goals", addBlockedBy: [calculate-completion-percentages-id]
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done using TaskUpdate.

Task tools are session-scoped and don't persist—your actual goal progress is tracked through markdown checkboxes and percentages in your goal files.

## Integration Points

- \`/todos\`: Fetch todos by project for goal progress calculation
- \`/weekly\` review: Full progress assessment with project and todo rollup
- \`/daily\` planning: Surface relevant goals and project next-actions
- \`/monthly\` review: Adjust goals as needed, check quarterly milestones
- \`/project status\`: Project completion and todo rates feed goal calculations
- Quarterly review: Cascade from 3-year vision
`,
    },
  },
  {
    name: "monthly",
    files: {
      "SKILL.md": `---
name: monthly
description: Monthly review and planning. Roll up weekly reviews, check quarterly milestones, set next month's focus. Use at end of month or start of new month.
version: 2
source: nomendex
---

# Monthly Review Skill

Facilitates monthly review and planning by rolling up weekly reviews, checking quarterly milestones, and setting next month's focus.

## Usage

\`\`\`
/monthly              # Run monthly review for current month
\`\`\`

Or ask:
- "Help me with my monthly review"
- "Plan next month"
- "How did this month go?"

## What This Skill Does

1. **Creates or opens monthly goals file** (\`Goals/2. Monthly Goals.md\`)
2. **Rolls up weekly reviews** from the past month
3. **Checks quarterly milestones** against yearly goals
4. **Plans next month's** focus areas and priorities

## Review Process

### Phase 1: Collect Monthly Data (10 minutes)

1. Read all weekly reviews from the past month (\`Goals/3. Weekly Review.md\` or weekly review notes)
2. Read daily notes from past 30 days (scan for patterns)
3. Fetch todos data for past month via \`/todos\` skill
4. Read current \`Goals/2. Monthly Goals.md\` for this month's targets
5. Read project files \`Projects/*.md\` for project status updates

**Extract:**
- Wins from each week
- Challenges and recurring blockers
- Todo completion rates by project
- Monthly todo patterns (total completed, overdue, blocked)
- Goal progress percentages
- Project milestones completed
- Habits tracked (completion rates)

### Phase 2: Reflect on Month (10 minutes)

1. Read \`Goals/1. Yearly Goals.md\` for quarterly milestones
2. Calculate which quarter we're in and check milestone progress
3. Identify patterns across weeks (energy, productivity, focus areas)
4. Compare planned vs actual outcomes

**Generate:**
- Monthly accomplishment summary
- Quarterly milestone progress check
- Pattern analysis (what worked, what didn't)
- Goal alignment assessment

### Phase 3: Plan Next Month (10 minutes)

1. Identify next month's quarterly milestones
2. Surface projects that need attention
3. Set next month's primary focus (ONE thing)
4. Define 3-tier priorities (must/should/nice-to-have)
5. Plan habits to build or maintain

**Write:**
- Update \`Goals/2. Monthly Goals.md\` with next month's plan
- Set specific weekly milestones for the month ahead

## Output Format

\`\`\`markdown
## Monthly Review: [Month Year]

### Month Summary
- Weeks reviewed: 4
- Daily notes analyzed: [N]
- Projects active: [N]

### Wins
1. [Major accomplishment]
2. [Progress milestone]
3. [Habit success]

### Challenges
1. [Recurring blocker]
2. [Missed target]

### Patterns
- **Energy:** [When were you most productive?]
- **Focus:** [What got the most attention?]
- **Gaps:** [What was consistently avoided?]

### Todo Metrics
| Project | Completed | Total | Rate | Trend |
|---------|-----------|-------|------|-------|
| Nomendex | 45 | 60 | 75% | ↗️ +10% |
| Health | 8 | 24 | 33% | ↘️ -5% |
| Work | 30 | 40 | 75% | → stable |

**Insights:**
- Total todos completed: 83
- Average completion rate: 61%
- Best performing: Nomendex (improving scoping)
- Needs attention: Health (overcommitting, break into smaller todos)

### Goal Progress
| Goal | Start of Month | End of Month | Delta |
|------|---------------|-------------|-------|
| [Goal 1] | 30% | 45% | +15% |
| [Goal 2] | 50% | 55% | +5% |

### Quarterly Milestone Check
**Quarter: Q[N] ([Month Range])**
| Milestone | Status | Notes |
|-----------|--------|-------|
| [Milestone 1] | On Track | [Detail] |
| [Milestone 2] | At Risk | [What's needed] |

### Project Status
| Project | Progress | Status | Next Month Focus |
|---------|----------|--------|-----------------|
| [Project 1] | 60% | Active | [Key deliverable] |

### Next Month Plan

**ONE Focus:** [Primary objective]

**Must Complete:**
1. [Non-negotiable deliverable]
2. [Critical milestone]
3. [Key commitment]

**Should Complete:**
1. [Important but flexible]
2. [Supporting goal]

**Nice to Have:**
1. [Stretch goal]

**Weekly Milestones:**
- Week 1: [Focus]
- Week 2: [Focus]
- Week 3: [Focus]
- Week 4: [Focus + monthly review]

### Wellbeing Check
- Physical Health: /10
- Mental Health: /10
- Relationships: /10
- Work Satisfaction: /10
- Overall: /10

### Questions to Consider
- "What would make next month feel truly successful?"
- "What commitment should you drop or delegate?"
- "Which goal needs a different approach?"
\`\`\`

## Data Sources

Always read these files:
- \`Goals/0. Three Year Goals.md\` - Long-term vision context
- \`Goals/1. Yearly Goals.md\` - Quarterly milestones and annual objectives
- \`Goals/2. Monthly Goals.md\` - Current month's plan (to review) and next month's (to write)
- \`Goals/3. Weekly Review.md\` - Weekly reviews from past month
- \`Daily Notes/*.md\` - Past 30 days of notes
- \`Projects/*.md\` - All active project files with statuses

## Task-Based Progress Tracking

### Monthly Review Tasks
\`\`\`
TaskCreate:
  subject: "Phase 1: Collect monthly data"
  description: "Read weekly reviews, daily notes, todos data, and project files from past month"
  activeForm: "Collecting monthly data..."

TaskCreate:
  subject: "Fetch monthly todos"
  description: "Load all todos from past month via /todos skill for completion analysis"
  activeForm: "Fetching monthly todo metrics..."

TaskCreate:
  subject: "Phase 2: Reflect on month"
  description: "Analyze patterns, check quarterly milestones, assess goal alignment, review todo trends"
  activeForm: "Reflecting on monthly patterns..."

TaskCreate:
  subject: "Phase 3: Plan next month"
  description: "Set focus, define priorities, establish weekly milestones, plan todo capacity"
  activeForm: "Planning next month..."

TaskCreate:
  subject: "Write monthly review note"
  description: "Generate and save the monthly review document"
  activeForm: "Writing monthly review..."
\`\`\`

### Dependencies
\`\`\`
TaskUpdate: "Phase 2: Reflect", addBlockedBy: [phase-1-id]
TaskUpdate: "Phase 3: Plan", addBlockedBy: [phase-2-id]
TaskUpdate: "Write monthly review", addBlockedBy: [phase-3-id]
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done.

## Integration

Works with:
- \`/todos\` - Fetch monthly todo metrics for trend analysis
- \`/weekly\` - Monthly review rolls up weekly reviews
- \`/goal-tracking\` - Quarterly milestone progress
- \`/project status\` - Project progress feeds monthly assessment
- \`/daily\` - Next month's plan informs daily priorities
- \`/push\` - Commit after completing review
`,
    },
  },
  {
    name: "obsidian-vault-ops",
    files: {
      "SKILL.md": `---
name: obsidian-vault-ops
description: Read and write Obsidian vault files, manage wiki-links, process markdown with YAML frontmatter. Use when working with vault file operations, creating notes, or managing links.
version: 2
source: nomendex
---

# Obsidian Vault Operations Skill

Core operations for reading, writing, and managing files in an Obsidian vault.

## Vault Structure

\`\`\`
vault-root/
├── vault-config.json   # Optional folder mapping + personalization
├── daily-notes/        # M-D-YYYY.md format
├── Goals/              # Goal cascade files
├── Projects/           # Canonical project notes (*.md)
├── Templates/          # Reusable note structures
└── Archives/           # Completed/inactive content
\`\`\`

## File Operations

### Reading Notes
- Use Glob to find files: \`*.md\`, \`daily-notes/*.md\`
- Read \`vault-config.json\` first if present (folder mapping + preferences)
- Read project context from \`Projects/*.md\`
- Check for wiki-links to related notes

### Creating Notes
1. Check if note already exists
2. Use appropriate template if available
3. Add YAML frontmatter with date and tags
4. Insert wiki-links to related notes

### Editing Notes
- Preserve YAML frontmatter structure
- Maintain existing wiki-links
- Use consistent heading hierarchy
- Apply standard tag format

## Wiki-Link Format

\`\`\`markdown
[[Note Name]]                    # Simple link
[[Note Name|Display Text]]       # Link with alias
[[Note Name#Section]]            # Link to section
\`\`\`

## YAML Frontmatter

Standard frontmatter structure:
\`\`\`yaml
---
date: 2024-01-15
tags: [tag1, tag2]
status: active
---
\`\`\`

## Template Variables

When processing templates, replace:
- \`{{date}}\` - Today's date (M-D-YYYY)
- \`{{date:format}}\` - Formatted date
- \`{{date-1}}\` - Yesterday
- \`{{date+1}}\` - Tomorrow
- \`{{time}}\` - Current time

## Common Patterns

### Daily Note Creation
1. Calculate today's date in M-D-YYYY format
2. Check if \`daily-notes/{date}.md\` exists
3. If not, read \`Templates/Daily Template.md\`
4. Replace template variables
5. Write to \`daily-notes/{date}.md\`

### Finding Related Notes
1. Extract key terms from current note
2. Search vault for matching content
3. Suggest wiki-links to related notes

### Tag Operations
- Priority: \`#priority/high\`, \`#priority/medium\`, \`#priority/low\`
- Status: \`#active\`, \`#waiting\`, \`#completed\`, \`#archived\`
- Context: \`#work\`, \`#personal\`, \`#health\`, \`#learning\`

## Best Practices

1. Always check \`vault-config.json\` first for vault-specific conventions and folder mapping
2. Preserve existing structure when editing
3. Use relative paths for internal links
4. Add frontmatter to new notes
5. Link to relevant goals when creating tasks
`,
    },
  },
  {
    name: "project",
    files: {
      "SKILL.md": `---
name: project
description: Create, track, and archive projects linked to goals using Nomendex Projects API and canonical project markdown notes. Use for project lifecycle management, status dashboards, and project note synchronization.
version: 3
source: nomendex
---

# Project Skill

Manage projects using a single source of truth:
- Project entity and board config in \`.nomendex/projects.json\` via \`/api/projects/*\`
- Canonical project note in \`Projects/<ProjectName>.md\` (auto-managed by backend)

## Usage

\`\`\`
/project              # Interactive: create new project or view status
/project new          # Create a new project
/project status       # Dashboard of all active projects
/project archive <name>  # Archive a completed project
\`\`\`

## Commands

### \`/project\` or \`/project new\`

Creates a project entity and canonical project note.

**Steps:**
1. Read \`Goals/1. Yearly Goals.md\` to list available goals
2. Ask user which goal this project supports (or "none" for standalone)
3. Ask for project name
4. Call \`/api/projects/list\` and reuse existing project if name matches (case-insensitive)
5. If not found, call \`/api/projects/create\` (send \`X-Nomendex-UI: true\`)
6. Read created project via \`/api/projects/get-by-name\` and confirm \`projectNoteFile\`
7. If linked to a goal, add \`[[Projects/<ProjectName>.md|<ProjectName>]]\` reference in yearly goals

**Canonical Project Note Template (\`Projects/<ProjectName>.md\`):**
\`\`\`markdown
# Project: <Name>

## Overview
[Brief description of what this project achieves]

## Goal Link
Supports: [[1. Yearly Goals#<Goal Name>]]

## Status
- **Phase:** Planning | Active | Review | Complete
- **Progress:** 0%
- **Todo Completion:** 0/0 (0%)

## Milestones
- [ ] <Milestone 1>

## Active Todos
(Fetched from Nomendex via /todos skill)
- [ ] <Todo from Today column>
- [ ] <Todo from This Week>

## Blocked Todos
- [ ] <Blocked todo> (blocked by: <reason>)

## Next Actions
- [ ] <First concrete step>
- [ ] <Second step>

## Decisions
- [Decision 1] - [Date] - [Rationale]

## Log
[Running log of updates, blockers, learnings]
\`\`\`

### \`/project status\`

Builds a dashboard from Projects API plus canonical project notes plus todos.

**Steps:**
1. Call \`/api/projects/list\` (include archived if user asks)
2. For each project, read \`projectNoteFile\` from project config
3. Load note content via \`/api/notes/get\`
4. Extract phase/progress/goal/next-action from note sections
5. Fetch todos for each project via \`/todos\` skill
6. Calculate todo completion rate per project
7. Display dashboard table

**Output Format:**
\`\`\`markdown
## Project Dashboard

| Project | Phase | Progress | Todos | Goal | Next Action |
|---------|-------|----------|-------|------|-------------|
| ProjectA | Active | 60% | 12/20 (60%) | [[Goal 1]] | Review PR |
| ProjectB | Planning | 10% | 0/5 (0%) | [[Goal 3]] | Draft spec |

### Summary
- Active projects: N
- Total progress (weighted): X%
- Projects without goal link: [list]
- Stalled projects (no update in 14+ days): [list]
- Projects with blocked todos: [list]
\`\`\`

### \`/project archive <name>\`

Archives project via project API lifecycle.

**Steps:**
1. Load project via \`/api/projects/get-by-name\`
2. Confirm with user before archiving
3. Call \`/api/projects/update\` with \`updates: { archived: true }\`
4. Backend auto-moves canonical note from \`Projects/\` to \`Archives/Projects/\`
5. Update goal references to mark completion if needed
6. Report archived location and summary

## Project Naming Conventions

- Use clear human-readable project names (canonical note path is normalized automatically)
- Keep names concise but descriptive
- Avoid special characters

## Cascade Integration

Projects are the critical middle layer:

\`\`\`
Goals/1. Yearly Goals.md     <- "What I want to achieve"
    |
    v
Projects/<ProjectName>.md    <- "How I'll achieve it"
    |
    v
daily-notes/*.md             <- "What I'm doing today"
\`\`\`

When creating tasks in daily notes, reference the project:
\`\`\`markdown
- [ ] Draft API spec — [[Projects/MyApp.md|MyApp]]
\`\`\`

## Task-Based Progress Tracking

### New Project Tasks
\`\`\`
TaskCreate:
  subject: "Read yearly goals"
  description: "Load goals for project linking"
  activeForm: "Reading yearly goals..."

TaskCreate:
  subject: "Create project entity"
  description: "Create project in projects.json via /api/projects/create"
  activeForm: "Creating project..."

TaskCreate:
  subject: "Sync canonical note"
  description: "Confirm projectNoteFile exists and contains lifecycle sections"
  activeForm: "Syncing project note..."
\`\`\`

### Status Dashboard Tasks
\`\`\`
TaskCreate:
  subject: "Load projects"
  description: "Fetch project entities and note paths from /api/projects/list"
  activeForm: "Loading projects..."

TaskCreate:
  subject: "Read canonical notes"
  description: "Load project note sections from Projects/*.md"
  activeForm: "Reading project notes..."

TaskCreate:
  subject: "Fetch project todos"
  description: "Load todos for each project via /todos skill"
  activeForm: "Fetching project todos..."

TaskCreate:
  subject: "Generate dashboard"
  description: "Compile status dashboard from API + project notes + todos"
  activeForm: "Generating project dashboard..."
\`\`\`

Mark each task \`in_progress\` when starting, \`completed\` when done.

## Integration

Works with:
- \`/todos\` - Fetch and display project todos, calculate completion rates
- \`/daily\` - Surface project next-actions in morning routine
- \`/weekly\` - Project status in weekly review
- \`/goal-tracking\` - Project progress feeds goal calculations
- \`/onboard\` - Discover and load project context
- \`/push\` - Commit project changes
`,
    },
  },
  {
    name: "review",
    files: {
      "SKILL.md": `---
name: review
description: Smart review router. Detects context (morning, Sunday, end of month) and launches the appropriate review workflow. Use anytime for the right review at the right time.
version: 1
source: nomendex
---

# Review Skill

Smart router that detects context and launches the appropriate review workflow.

## Usage

\`\`\`
/review           # Auto-detect the right review based on time/context
/review daily     # Force daily review
/review weekly    # Force weekly review
/review monthly   # Force monthly review
\`\`\`

Or simply: "Help me review" — and the right workflow starts.

## Auto-Detection Logic

When invoked without arguments, detect context using these rules:

### 1. Check the Time of Day

\`\`\`bash
HOUR=$(date +%H)
\`\`\`

- **Before noon (< 12):** Morning routine — delegate to \`/daily\` morning workflow
- **After 5 PM (>= 17):** Evening shutdown — delegate to \`/daily\` evening workflow
- **Midday (12-17):** Midday check-in — delegate to \`/daily\` midday workflow

### 2. Check the Day of Week

\`\`\`bash
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
\`\`\`

- **Sunday (7) or Monday (1):** Weekly review — delegate to \`/weekly\`
  - Override time-of-day detection
  - Ask: "Ready for your weekly review?" before proceeding

### 3. Check the Day of Month

\`\`\`bash
DAY_OF_MONTH=$(date +%d)
DAYS_IN_MONTH=$(date -v+1m -v1d -v-1d +%d 2>/dev/null || date -d "$(date +%Y-%m-01) +1 month -1 day" +%d)
\`\`\`

- **Last 3 days of month (DAY_OF_MONTH >= DAYS_IN_MONTH - 2):** Monthly review — delegate to \`/monthly\`
  - Override both time-of-day and day-of-week detection
  - Ask: "End of month — ready for your monthly review?" before proceeding

- **First day of month (DAY_OF_MONTH == 1):** Also suggest monthly review
  - "It's the first of the month. Want to do your monthly review for last month?"

### 4. Check Staleness

Before routing, check for overdue reviews:

\`\`\`bash
# Read weekly review file for last date
WEEKLY_REVIEW="Goals/3. Weekly Review.md"
# If last weekly review > 7 days ago, suggest weekly regardless of day
\`\`\`

- **Weekly review overdue (>7 days):** Suggest weekly review
  - "Your last weekly review was N days ago. Want to catch up?"
  - If user says no, fall through to time-of-day detection

## Routing Behavior

After detecting context:

1. Tell the user what was detected: "It's Sunday evening — launching your weekly review."
2. Delegate to the appropriate skill's workflow
3. The delegated skill handles everything from there

### Delegation

This skill does NOT duplicate the logic of \`/daily\`, \`/weekly\`, or \`/monthly\`. It:
1. Detects context
2. Informs the user
3. Follows the instructions from the target skill's SKILL.md

### Explicit Override

If the user specifies a type (\`/review weekly\`), skip auto-detection entirely and go directly to that review type.

## Output on Detection

\`\`\`markdown
### Review Router

**Time:** 7:15 AM (Morning)
**Day:** Sunday
**Month day:** 15th

**Detected:** Weekly review (Sunday override)
**Last weekly review:** 3 days ago (not overdue)

Launching weekly review...
\`\`\`

## Edge Cases

- **Multiple triggers** (e.g., last Sunday of month): Monthly takes priority over weekly
- **No daily note exists**: Create one first, then continue with review
- **User says "no" to suggestion**: Fall through to next detection level
- **Explicit argument overrides everything**: \`/review monthly\` runs monthly review even on a Tuesday morning

## Integration

Works with:
- \`/daily\` — Morning, midday, and evening routines
- \`/weekly\` — Full weekly review process
- \`/monthly\` — Monthly review and planning
- Session init hook — Staleness data already calculated
`,
    },
  },
  {
    name: "search",
    files: {
      "SKILL.md": `---
name: search
description: Search vault content by keyword using Grep. Zero dependencies — works in any vault without indexes or plugins. Groups results by directory for easy scanning.
version: 2
source: nomendex
---

# Search Skill

Fast keyword search across all vault markdown files using the Grep tool. No indexes, no plugins, no setup — just structured search with directory grouping.

## Usage

\`\`\`
/search <term>
\`\`\`

Examples:
- \`/search project planning\`
- \`/search weekly review\`
- \`/search TODO\`

## How to Execute

When the user invokes \`/search <term>\`:

### Step 1: Search for the term

Use the **Grep** tool to search all \`.md\` files for the term:

\`\`\`
Grep:
  pattern: <search term>
  glob: "*.md"
  output_mode: content
  -n: true
  -C: 1
\`\`\`

Exclude hidden directories (\`.claude/\`, \`.obsidian/\`) and templates:

\`\`\`
Grep:
  pattern: <search term>
  glob: "*.md"
  path: .
  output_mode: content
  -n: true
  -C: 1
\`\`\`

Filter out results from \`.claude/\`, \`.obsidian/\`, and \`Templates/\` directories.

### Step 2: Group results by directory

Organise matches into sections by their parent directory:

- **daily-notes/** — journal entries
- **Goals/** — goal and vision documents
- **Projects/** — project notes
- **Archives/** — archived content
- **Inbox/** — unprocessed items
- **(root)** — top-level notes

### Step 3: Present results

Format output as:

\`\`\`markdown
## Search: "<term>"

### daily-notes/
- **2024-01-15.md** (line 23): ...matching context...
- **2024-01-14.md** (line 8): ...matching context...

### Projects/
- **Project Alpha.md** (line 45): ...matching context...

### Goals/
- **2024 Goals.md** (line 12): ...matching context...

**Found X matches across Y files**
\`\`\`

### Step 4: Suggest related content

After showing results, check if any matched files contain \`[[wiki-links]]\` to other notes. If so, briefly mention:

\`\`\`
💡 Related notes mentioned in results: [[Note A]], [[Note B]]
\`\`\`

## No Results

If no matches are found:
1. Suggest alternative search terms (synonyms, related words)
2. Offer to search with case-insensitive matching if the original search was case-sensitive
3. Suggest checking \`Archives/\` if not already included

## Tips

- Search is case-sensitive by default. Add \`-i: true\` to the Grep call for case-insensitive search
- Use regex patterns for advanced searches: \`task.*complete\`, \`#tag-name\`
- Combine with \`/daily\` to quickly find when something was mentioned
`,
    },
  },
  {
    name: "weekly",
    files: {
      "SKILL.md": `---
name: weekly
description: Facilitate weekly review process with reflection, goal alignment, and planning. Create review notes, analyze past week, plan next week. Use on Sundays or whenever doing weekly planning.
version: 2
source: nomendex
---

# Weekly Review Skill

Facilitates your weekly review process by creating a review note and guiding reflection on the past week while planning the next.

## Usage

Invoke with \`/weekly\` or ask Codex to help with your weekly review.

\`\`\`
/weekly
\`\`\`

## What This Skill Does

1. **Creates Weekly Review Note**
   - Uses weekly review template
   - Names it with current week's date
   - Places in Goals folder

2. **Guides Review Process**
   - Reviews last week's accomplishments
   - Analyzes todos completion and patterns via \`/todos\` skill
   - Identifies incomplete tasks
   - Plans upcoming week
   - Aligns with monthly goals

3. **Automates Housekeeping**
   - Archives old daily notes
   - Updates project statuses
   - Cleans up completed and stale todos

## Review Process Steps

### Step 1: Reflection (10 minutes)
- Review daily notes from past week
- Fetch all todos via \`/todos\` skill (project, status, dueDate, priority)
- Calculate todo completion rate by project
- Identify wins and challenges
- Capture lessons learned

### Step 2: Goal Alignment + Project Rollup (10 minutes)
- Check monthly goal progress
- Map completed todos to monthly goals
- Identify overdue and blocked todos
- Adjust weekly priorities
- Ensure alignment with yearly goals
- Read project files \`Projects/*.md\` for current status
- Compile project progress table for the review note

### Step 3: Planning (10 minutes)
- Set ONE big thing for the week
- Review and triage uncompleted todos (archive/delete/carry over)
- Plan todo distribution for next week by day
- Include project next-actions when planning week
- Schedule important tasks
- Block time for deep work

## Interactive Prompts

The skill guides you through:

1. **"What were your top 3 wins this week?"**
   - Celebrates progress
   - Builds momentum
   - Documents achievements

2. **"What were your main challenges?"**
   - Identifies obstacles
   - Plans solutions
   - Learns from difficulties

3. **"What's your ONE big thing next week?"**
   - Forces prioritization
   - Creates focus
   - Drives meaningful progress

## Weekly Review Checklist

- [ ] Review all daily notes
- [ ] Fetch and analyze todos via \`/todos\` skill
- [ ] Calculate todo completion rates by project
- [ ] Identify overdue and blocked todos
- [ ] Process inbox items
- [ ] Update project statuses
- [ ] Check upcoming calendar
- [ ] Review monthly goals
- [ ] Plan next week's priorities
- [ ] Plan todo distribution for next week
- [ ] Block time for important work
- [ ] Clean digital workspace
- [ ] Archive completed todos and items
- [ ] Commit changes to Git

## Weekly Review Note Format

\`\`\`markdown
# Weekly Review: YYYY-MM-DD

## Last Week's Wins
1.
2.
3.

## Challenges & Lessons
- Challenge:
- Lesson:

## Todo Analysis
### Completion by Project
| Project | Completed | Total | Rate |
|---------|-----------|-------|------|
| [[ProjectA]] | 12 | 20 | 60% |
| [[ProjectB]] | 0 | 5 | 0% |

### Overdue Todos
- [ ] [ProjectA] Fix critical bug (due: 3/10)
- [ ] [ProjectB] Book appointment (due: 3/12)

### Blocked Todos
- [ ] [ProjectA] Deploy to prod (blocked by: payment gateway)

### Today Column Patterns
- Average "Today" todos: 8/day
- Completion rate: 5/8 (62.5%)
- **Insight:** Overcommitting by ~3 todos/day

## Goal Progress
### Monthly Goals
- [ ] Goal 1 (XX%)
- [ ] Goal 2 (XX%)

### This Week's Contribution
- [Task] -> [[Goal]]
- [Completed todos mapped to goals]

## Project Progress
| Project | Phase | Progress | Next Action |
|---------|-------|----------|-------------|
| [[ProjectA]] | Active | 60% | [Next step] |
| [[ProjectB]] | Planning | 10% | [Next step] |

## Next Week Planning

### ONE Big Thing
>

### Key Tasks
- [ ]
- [ ]
- [ ]

### Todo Plan
**Monday:**
- [ ] [ProjectA] Start audit
- [ ] [ProjectB] Morning routine

**Tuesday:**
- [ ] [ProjectA] Review UI bugs
- [ ] [ProjectB] 30min run

**Wednesday:**
- [ ] [ProjectA] Deploy feature
- [ ] [ProjectB] Meal prep

(Continue for rest of week...)

### Project Next-Actions
- [ ] [ProjectA] - [specific next step]
- [ ] [ProjectB] - [specific next step]

### Time Blocks
- Monday:
- Tuesday:
- Wednesday:
- Thursday:
- Friday:

### Todo Housekeeping
**Archive:**
- [x] Old completed todos from 2+ weeks ago

**Delete:**
- [ ] Stale todos no longer relevant

**Re-prioritize:**
- [ ] Move X to high priority

## Notes
\`\`\`

## Automation Features

### Todo Analysis via \`/todos\` Skill
Fetch and analyze todos from Nomendex API:
- **Completion metrics**: Calculate completion rate by project
- **Overdue detection**: Identify todos past their due date
- **Blocker identification**: Surface todos marked as blocked
- **Pattern analysis**: Track "Today" column usage and completion
- **Goal mapping**: Connect completed todos to monthly goals

Example usage in weekly review:
\`\`\`
Use /todos skill to:
1. Fetch all todos from past week
2. Group by project and status
3. Calculate completion rates
4. Identify overdue items
5. Analyze daily "Today" column patterns
\`\`\`

### Auto-Archive
Suggest moving daily notes older than 30 days to Archives.

### Project Status Update
For each active project:
- Update completion percentage
- Note blockers
- Set next actions

### Habit Tracking
Calculate habit success rates from daily notes:
- Count habit checkboxes
- Show completion percentage
- Identify patterns

## Best Practices

### Consistent Timing
- Same day each week (Sunday recommended)
- Same time if possible
- Block calendar time
- Treat as non-negotiable

### Preparation
- Clean inbox before review
- Have calendar ready
- Gather project updates
- Review any feedback

### Follow-through
- Share highlights with team/family
- Update external systems
- Communicate changes
- Celebrate wins

## Task-Based Progress Tracking

The weekly skill uses session tasks to show progress through the 3-phase review.

### Phase Tasks

Create tasks at skill start:

\`\`\`
TaskCreate:
  subject: "Phase 1: Collect"
  description: "Gather daily notes from past week, fetch todos data, extract wins and challenges"
  activeForm: "Collecting daily notes, todos, and extracting highlights..."

TaskCreate:
  subject: "Phase 2: Reflect"
  description: "Calculate goal progress, analyze todo completion patterns, identify alignment gaps"
  activeForm: "Calculating goal progress and analyzing todo patterns..."

TaskCreate:
  subject: "Phase 3: Plan"
  description: "Identify ONE Big Thing, triage todos, plan daily focus areas for next week"
  activeForm: "Planning next week's focus and todo distribution..."
\`\`\`

### Dependencies

Phases must run in order:
\`\`\`
TaskUpdate: "Phase 2: Reflect", addBlockedBy: [phase-1-collect-id]
TaskUpdate: "Phase 3: Plan", addBlockedBy: [phase-2-reflect-id]
\`\`\`

Reflect is blocked until Collect completes. Plan is blocked until Reflect completes. This provides visibility into the 30-minute review process.

Mark each task \`in_progress\` when starting, \`completed\` when done using TaskUpdate.

Task tools are session-scoped and don't persist between Codex sessions—your actual weekly review content is saved in the review note.

## Agent Team Workflow (Optional)

For a faster, more thorough weekly review, use agent teams to parallelize the collection phase:

\`\`\`
Team Lead (coordinator)
├── collector agent — Read all daily notes, extract wins/challenges/tasks
├── goal-analyzer agent — Read goal files, calculate progress, find gaps
├── project-scanner agent — Read Projects/*.md files, get status updates
└── todo-collector agent — Fetch todos via API, analyze completion, identify patterns
\`\`\`

### How to Use
When invoking \`/weekly\`, you can request the team-based approach:
\`\`\`
/weekly
"Use the team approach for a thorough review"
\`\`\`

The team lead:
1. Spawns four agents to work in parallel
2. Collector reads daily notes and extracts highlights
3. Goal-analyzer reads all goal files and calculates progress
4. Project-scanner reads all project files (Projects/*.md) for status
5. Todo-collector fetches todos via \`/todos\` skill and analyzes:
   - Completion rates by project
   - Overdue and blocked todos
   - "Today" column patterns
   - Mapping of completed todos to monthly goals
6. Team lead synthesizes findings into the weekly review note

This makes the review faster (parallel collection) and more thorough (dedicated analysis per area).

### Vault Health Check (Ad-hoc)

The weekly review can optionally include a vault health check using multiple agents:
- **note-organizer**: Scan for broken links, orphan notes
- **goal-aligner**: Check daily-to-goal alignment
- **inbox-processor**: Check for unprocessed items

Request with: "Include a vault health check in my weekly review"

## Integration

Works with:
- \`/daily\` - Reviews daily notes from the week
- \`/todos\` - Fetches todos data for completion analysis and planning
- \`/monthly\` - Weekly reviews feed monthly rollup
- \`/project\` - Project status in review
- \`/push\` - Commit after completing review
- \`/onboard\` - Load context for informed review
- Goal tracking skill - Progress calculations
`,
    },
  }
];

/**
 * In-memory storage for pending updates.
 * This is populated during initialization and consumed by the UI.
 */
let pendingUpdates: SkillUpdateInfo[] = [];

/**
 * Parse SKILL.md frontmatter to extract metadata including version
 */
function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const frontMatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return null;
  }

  try {
    const frontMatterYaml = match[1];
    const parsed = yaml.load(frontMatterYaml);
    const result = SkillMetadataSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    logger.warn("Invalid skill frontmatter schema", { parsed, error: result.error });
    return null;
  } catch (error) {
    logger.error("Failed to parse skill frontmatter", { error });
    return null;
  }
}

/**
 * Get the version of an installed skill, or null if not installed
 */
async function getInstalledSkillVersion(skillName: string): Promise<number | null> {
  if (!hasActiveWorkspace()) {
    return null;
  }

  const skillPath = path.join(getSkillsPath(), skillName, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const metadata = parseSkillFrontmatter(content);
    return metadata?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the source field of an installed skill, or null if not installed / no source
 */
async function getInstalledSkillSource(skillName: string): Promise<string | null> {
  if (!hasActiveWorkspace()) {
    return null;
  }

  const skillPath = path.join(getSkillsPath(), skillName, "SKILL.md");
  const file = Bun.file(skillPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const metadata = parseSkillFrontmatter(content);
    return metadata?.source ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide if an existing skill directory should be treated as recoverable Nomendex-owned state.
 * This prevents empty/broken directories from permanently blocking reinstallation, while still
 * protecting user-owned directories with colliding names.
 */
async function isRecoverableNomendexSkillDirectory(skillName: string, skillDirPath: string): Promise<boolean> {
  const skillMdPath = path.join(skillDirPath, "SKILL.md");
  const skillMdFile = Bun.file(skillMdPath);

  if (!(await skillMdFile.exists())) {
    let entries: string[] = [];
    try {
      entries = await readdir(skillDirPath);
    } catch {
      logger.info(`Skipping ${skillName}: could not inspect existing directory`);
      return false;
    }

    if (entries.length === 0) {
      logger.warn(`Recovering ${skillName}: found empty skill directory without SKILL.md`);
      return true;
    }

    logger.info(`Skipping ${skillName}: non-empty directory exists without SKILL.md`);
    return false;
  }

  try {
    const content = await skillMdFile.text();
    const metadata = parseSkillFrontmatter(content);

    if (metadata?.source === "nomendex") {
      return true;
    }

    if (!metadata && content.includes("source: nomendex")) {
      logger.warn(`Recovering ${skillName}: invalid frontmatter but source marker indicates Nomendex ownership`);
      return true;
    }
  } catch {
    logger.info(`Skipping ${skillName}: failed to read existing SKILL.md`);
    return false;
  }

  logger.info(`Skipping ${skillName}: existing SKILL.md is not Nomendex-owned`);
  return false;
}

/**
 * Get metadata for an embedded default skill
 */
function getDefaultSkillMetadata(skillName: string): SkillMetadata | null {
  const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
  if (!skill) return null;

  const skillMd = skill.files["SKILL.md"];
  if (!skillMd) return null;

  return parseSkillFrontmatter(skillMd);
}

/**
 * Write a default skill to the workspace
 */
async function writeDefaultSkill(skillName: string): Promise<boolean> {
  if (!hasActiveWorkspace()) {
    logger.warn("No active workspace, cannot write skill");
    return false;
  }

  const skill = DEFAULT_SKILLS.find((s) => s.name === skillName);
  if (!skill) {
    logger.error(`Default skill not found: ${skillName}`);
    return false;
  }

  const destPath = path.join(getSkillsPath(), skillName);

  try {
    // Create destination directory
    await mkdir(destPath, { recursive: true });

    // Write all files
    for (const [filename, content] of Object.entries(skill.files)) {
      const filePath = path.join(destPath, filename);
      await Bun.write(filePath, content);

      // Make shell scripts executable
      if (filename.endsWith(".sh")) {
        await chmod(filePath, 0o755);
      }

      logger.info(`Wrote ${filename} to ${destPath}`);
    }

    logger.info(`Successfully wrote skill: ${skillName}`);
    return true;
  } catch (error) {
    logger.error(`Failed to write skill: ${skillName}`, { error });
    return false;
  }
}

/**
 * Check for available skill updates.
 * Only considers skills where the installed copy has source: nomendex (or is missing).
 * User-created skills with colliding names are skipped entirely.
 */
async function checkForSkillUpdates(): Promise<SkillUpdateCheckResult> {
  const result: SkillUpdateCheckResult = {
    pendingUpdates: [],
    newSkills: [],
  };

  if (!hasActiveWorkspace()) {
    return result;
  }

  for (const skill of DEFAULT_SKILLS) {
    const defaultMetadata = getDefaultSkillMetadata(skill.name);
    if (!defaultMetadata) {
      logger.warn(`Could not read metadata for default skill: ${skill.name}`);
      continue;
    }

    const installedVersion = await getInstalledSkillVersion(skill.name);

    if (installedVersion === null) {
      // Skill directory might exist without a valid SKILL.md or version
      // If directory exists at all, check ownership before treating as "new"
      const skillDirPath = path.join(getSkillsPath(), skill.name);
      let dirExists = false;
      try {
        const s = await stat(skillDirPath);
        dirExists = s.isDirectory();
      } catch {
        // Directory doesn't exist — truly new
      }

      if (dirExists) {
        // Directory exists — only recover when clearly Nomendex-owned or empty/broken from partial install
        const isRecoverable = await isRecoverableNomendexSkillDirectory(skill.name, skillDirPath);
        if (!isRecoverable) {
          continue;
        }
      }
      result.newSkills.push(skill.name);
    } else {
      // Skill exists with a parseable version — check ownership before offering update
      const installedSource = await getInstalledSkillSource(skill.name);
      if (installedSource !== null && installedSource !== "nomendex") {
        // User-owned skill with colliding name — don't touch
        logger.info(`Skipping update for ${skill.name}: user-owned skill (source: ${installedSource})`);
        continue;
      }

      if (installedVersion < defaultMetadata.version) {
        result.pendingUpdates.push({
          skillName: skill.name,
          currentVersion: installedVersion,
          availableVersion: defaultMetadata.version,
        });
      }
    }
  }

  return result;
}

/**
 * Initialize default skills on workspace startup.
 * - Writes any missing default skills (if no user-owned collision exists)
 * - Auto-applies updates only for Nomendex-owned skills (source: nomendex)
 * - Surfaces updates for skills without source as pending (toast flow)
 */
export async function initializeDefaultSkills(): Promise<SkillUpdateCheckResult> {
  if (!hasActiveWorkspace()) {
    logger.info("No active workspace, skipping default skills initialization");
    return { pendingUpdates: [], newSkills: [] };
  }

  logger.info("Initializing default skills...");

  // Check for new skills and updates (already ownership-filtered)
  const updateCheck = await checkForSkillUpdates();

  // Write any new (missing) skills
  for (const skillName of updateCheck.newSkills) {
    logger.info(`Installing new default skill: ${skillName}`);
    await writeDefaultSkill(skillName);
  }

  // Process pending updates with ownership-aware logic
  const remainingPending: SkillUpdateInfo[] = [];
  for (const update of updateCheck.pendingUpdates) {
    const installedSource = await getInstalledSkillSource(update.skillName);
    if (installedSource === "nomendex") {
      // Already Nomendex-owned — safe to auto-update
      logger.info(`Auto-updating Nomendex skill: ${update.skillName} (v${update.currentVersion} → v${update.availableVersion})`);
      await writeDefaultSkill(update.skillName);
    } else {
      // No source yet (pre-ownership skill) or ambiguous — surface via toast
      logger.info(`Pending update for ${update.skillName} (v${update.currentVersion} → v${update.availableVersion})`);
      remainingPending.push(update);
    }
  }

  // Store remaining pending updates for UI notification
  pendingUpdates = remainingPending;

  const autoApplied = updateCheck.pendingUpdates.length - remainingPending.length;
  logger.info(`Default skills initialization complete. Installed ${updateCheck.newSkills.length} new, auto-updated ${autoApplied}, ${remainingPending.length} pending.`);

  return {
    pendingUpdates: remainingPending,
    newSkills: updateCheck.newSkills,
  };
}

/**
 * Get the list of pending skill updates
 */
export function getPendingSkillUpdates(): SkillUpdateInfo[] {
  return pendingUpdates;
}

/**
 * Apply a skill update (write new version to workspace).
 * Enforces the same ownership check as startup — only writes if the
 * installed skill has source: nomendex (or is missing entirely).
 */
export async function applySkillUpdate(skillName: string): Promise<boolean> {
  // Ownership gate: only allow updating Nomendex-owned skills
  const installedSource = await getInstalledSkillSource(skillName);
  if (installedSource !== null && installedSource !== "nomendex") {
    logger.warn(`Refusing to update ${skillName}: not Nomendex-owned (source: ${installedSource})`);
    // Remove from pending since it shouldn't be there
    pendingUpdates = pendingUpdates.filter((u) => u.skillName !== skillName);
    return false;
  }

  const success = await writeDefaultSkill(skillName);

  if (success) {
    // Remove from pending updates
    pendingUpdates = pendingUpdates.filter((u) => u.skillName !== skillName);
  }

  return success;
}

/**
 * Apply all pending skill updates
 */
export async function applyAllSkillUpdates(): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = [];
  const failed: string[] = [];

  for (const update of [...pendingUpdates]) {
    const result = await applySkillUpdate(update.skillName);
    if (result) {
      success.push(update.skillName);
    } else {
      failed.push(update.skillName);
    }
  }

  return { success, failed };
}
