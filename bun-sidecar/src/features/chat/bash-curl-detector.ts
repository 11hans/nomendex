// Detects API mutations done via `curl` inside a Bash tool call so the chat
// view can render a structured summary instead of a raw terminal block.
//
// Strategy: parse the curl command(s) (intent comes from URL + method + body);
// optionally parse the response JSON (for title/error confirmation). We
// deliberately whitelist endpoints — generic JSON-shape detection is brittle.

export type ApiEntity = "todo" | "goal" | "project" | "note";

export type ApiActionTone = "create" | "update" | "destructive" | "archive" | "complete";

export type DetectedApiCall = {
    entity: ApiEntity;
    action: string;          // "Created" | "Updated" | "Archived" | …
    tone: ApiActionTone;
    method: string;
    url: string;
    endpoint: string;        // last segment, e.g. "update"
    id?: string;
    title?: string;
    changedFields: { key: string; value: unknown }[];
    body?: unknown;
    response?: unknown;
    failed?: boolean;
    errorMessage?: string;
};

const ENTITY_PREFIXES: { prefix: string; entity: ApiEntity }[] = [
    { prefix: "/api/todos/", entity: "todo" },
    { prefix: "/api/goals/", entity: "goal" },
    { prefix: "/api/projects/", entity: "project" },
    { prefix: "/api/notes/", entity: "note" },
];

// Endpoints we know mutate state. GETs and reads return null (no summary).
const ENDPOINT_ACTIONS: Record<string, { action: string; tone: ApiActionTone }> = {
    create: { action: "Created", tone: "create" },
    update: { action: "Updated", tone: "update" },
    delete: { action: "Deleted", tone: "destructive" },
    archive: { action: "Archived", tone: "archive" },
    unarchive: { action: "Unarchived", tone: "update" },
    save: { action: "Saved", tone: "update" },
    rename: { action: "Renamed", tone: "update" },
    reorder: { action: "Reordered", tone: "update" },
    "skip-recurrence": { action: "Skipped recurrence", tone: "update" },
    "update-project": { action: "Moved", tone: "update" },
    "update-tags": { action: "Tags updated", tone: "update" },
    "move-to-folder": { action: "Moved", tone: "update" },
    ensure: { action: "Ensured", tone: "create" },
};

// Tokenize a shell-ish command string. Handles single/double quotes and
// backslash escapes; does not support $(...) or backticks (we don't need to
// execute, only spot the URL/body).
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let buf = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;
    let inToken = false;

    const flush = () => {
        if (inToken) {
            tokens.push(buf);
            buf = "";
            inToken = false;
        }
    };

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escaped) {
            buf += ch;
            inToken = true;
            escaped = false;
            continue;
        }
        if (ch === "\\" && quote !== "'") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (ch === quote) {
                quote = null;
                continue;
            }
            buf += ch;
            inToken = true;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            inToken = true;
            continue;
        }
        if (/\s/.test(ch)) {
            flush();
            continue;
        }
        buf += ch;
        inToken = true;
    }
    flush();
    return tokens;
}

// Split a bash command into separate statements. We only need to distinguish
// curl calls from each other; `&&`, `||`, `;`, and newlines all separate them.
function splitStatements(command: string): string[] {
    const out: string[] = [];
    let buf = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (escaped) { buf += ch; escaped = false; continue; }
        if (ch === "\\" && quote !== "'") { escaped = true; buf += ch; continue; }
        if (quote) {
            if (ch === quote) quote = null;
            buf += ch;
            continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
        if (ch === "\n" || ch === ";") {
            if (buf.trim()) out.push(buf);
            buf = "";
            continue;
        }
        if ((ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) {
            if (buf.trim()) out.push(buf);
            buf = "";
            i++;
            continue;
        }
        if (ch === "|") {
            // Pipe — keep upstream curl, drop everything after the pipe for parsing
            if (buf.trim()) out.push(buf);
            buf = "";
            // Skip everything until end of statement
            while (i < command.length && command[i] !== "\n" && command[i] !== ";") {
                if ((command[i] === "&" && command[i + 1] === "&") || (command[i] === "|" && command[i + 1] === "|")) break;
                i++;
            }
            i--;
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) out.push(buf);
    return out;
}

type ParsedCurl = {
    method: string;
    url: string;
    body?: string;
};

function parseCurl(statement: string): ParsedCurl | null {
    const tokens = tokenize(statement);
    const curlIdx = tokens.indexOf("curl");
    if (curlIdx === -1) return null;

    let method: string | null = null;
    let body: string | undefined;
    let url: string | undefined;

    for (let i = curlIdx + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === "-X" || t === "--request") {
            method = (tokens[++i] || "").toUpperCase();
            continue;
        }
        if (t.startsWith("-X")) {
            method = t.slice(2).toUpperCase();
            continue;
        }
        if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
            body = tokens[++i];
            continue;
        }
        if (t.startsWith("--data=") || t.startsWith("--data-raw=") || t.startsWith("--data-binary=")) {
            body = t.slice(t.indexOf("=") + 1);
            continue;
        }
        if (t === "-H" || t === "--header") { i++; continue; }
        if (t.startsWith("-H") && t.length > 2) continue;
        // Flags we don't care about but consume their value
        if (t === "-A" || t === "--user-agent" || t === "-e" || t === "--referer"
            || t === "-o" || t === "--output" || t === "-u" || t === "--user"
            || t === "--max-time" || t === "--connect-timeout" || t === "--retry") {
            i++;
            continue;
        }
        if (t.startsWith("-")) continue; // unknown flag
        if (!url && /^https?:\/\//i.test(t)) url = t;
    }

    if (!url) return null;
    return { method: method ?? (body !== undefined ? "POST" : "GET"), url, body };
}

function classifyUrl(url: string): { entity: ApiEntity; endpoint: string; path: string } | null {
    let path: string;
    try {
        path = new URL(url).pathname;
    } catch {
        return null;
    }
    for (const { prefix, entity } of ENTITY_PREFIXES) {
        if (path.startsWith(prefix)) {
            const endpoint = path.slice(prefix.length).replace(/\/$/, "");
            return { entity, endpoint, path };
        }
    }
    return null;
}

function safeJsonParse(text: string | undefined): unknown {
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// The Bash tool result is delivered as { stdout, stderr, interrupted, … }.
// chat-view stringifies that wrapper for outputText, so before we slice
// JSON responses we need to peel off the wrapper to reach the actual stdout.
function unwrapBashToolResult(output: string): string {
    if (!output) return output;
    const parsed = safeJsonParse(output.trim());
    if (isPlainObject(parsed) && typeof parsed.stdout === "string") {
        return parsed.stdout as string;
    }
    return output;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Specialise the action when the body shows a sentinel field — turns a generic
// "Updated" into "Archived"/"Completed" so users can scan intent.
function specialiseUpdate(body: Record<string, unknown> | undefined): { action: string; tone: ApiActionTone } | null {
    if (!body) return null;
    const updates = isPlainObject(body.updates) ? (body.updates as Record<string, unknown>) : body;
    if (updates.archived === true) return { action: "Archived", tone: "archive" };
    if (updates.archived === false) return { action: "Unarchived", tone: "update" };
    if (updates.status === "done") return { action: "Completed", tone: "complete" };
    if (updates.status === "in_progress") return { action: "Started", tone: "update" };
    if (updates.completedAt && !("status" in updates)) return { action: "Completed", tone: "complete" };
    return null;
}

// Pull the entity title / id from the response (preferred) or body.
function extractTitleAndId(
    body: Record<string, unknown> | undefined,
    response: unknown,
): { id?: string; title?: string } {
    let id: string | undefined;
    let title: string | undefined;

    const sources: Record<string, unknown>[] = [];
    if (isPlainObject(response)) sources.push(response);
    if (isPlainObject(response) && isPlainObject(response.todo)) sources.push(response.todo as Record<string, unknown>);
    if (isPlainObject(response) && isPlainObject(response.goal)) sources.push(response.goal as Record<string, unknown>);
    if (isPlainObject(response) && isPlainObject(response.project)) sources.push(response.project as Record<string, unknown>);
    if (isPlainObject(response) && isPlainObject(response.note)) sources.push(response.note as Record<string, unknown>);
    if (body) sources.push(body);
    if (body && isPlainObject(body.updates)) sources.push(body.updates as Record<string, unknown>);

    for (const src of sources) {
        if (!id && typeof src.id === "string") id = src.id as string;
        if (!id && typeof src.todoId === "string") id = src.todoId as string;
        if (!id && typeof src.goalId === "string") id = src.goalId as string;
        if (!title && typeof src.title === "string") title = src.title as string;
        if (!title && typeof src.name === "string") title = src.name as string;
        if (!title && typeof src.fileName === "string") title = src.fileName as string;
        if (!title && typeof src.projectName === "string") title = src.projectName as string;
        if (!title && typeof src.noteFileName === "string") title = src.noteFileName as string;
    }

    return { id, title };
}

// Fields shown in the summary subline. We deliberately drop opaque/noisy keys.
const HIDDEN_FIELDS = new Set([
    "id", "todoId", "goalId", "noteFileName", "fileName", "projectName",
    "createdAt", "updatedAt", "mtime",
]);

function pickChangedFields(body: Record<string, unknown> | undefined): { key: string; value: unknown }[] {
    if (!body) return [];
    const updates = isPlainObject(body.updates) ? (body.updates as Record<string, unknown>) : body;
    return Object.entries(updates)
        .filter(([k]) => !HIDDEN_FIELDS.has(k))
        .map(([key, value]) => ({ key, value }));
}

// Slice the bash output into per-curl JSON responses. Each curl typically
// prints one JSON document; multiple curls produce a concatenated stream.
function sliceJsonResponses(output: string, expected: number): unknown[] {
    if (!output) return [];
    const trimmed = output.trim();
    if (!trimmed) return [];

    // Fast path: single response
    if (expected <= 1) {
        const parsed = safeJsonParse(trimmed);
        return parsed === undefined ? [] : [parsed];
    }

    // Walk the string and try to pull off balanced JSON objects/arrays.
    const responses: unknown[] = [];
    let i = 0;
    while (i < trimmed.length && responses.length < expected) {
        // Skip whitespace
        while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
        if (i >= trimmed.length) break;
        const start = trimmed[i];
        if (start !== "{" && start !== "[") {
            // Output isn't pure JSON — bail
            return [];
        }
        const open = start;
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;
        for (let j = i; j < trimmed.length; j++) {
            const ch = trimmed[j];
            if (escaped) { escaped = false; continue; }
            if (ch === "\\") { escaped = true; continue; }
            if (inString) {
                if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) { end = j; break; }
            }
        }
        if (end === -1) break;
        const slice = trimmed.slice(i, end + 1);
        const parsed = safeJsonParse(slice);
        responses.push(parsed);
        i = end + 1;
    }
    return responses;
}

function detectFailure(response: unknown, errorText: string | undefined): { failed: boolean; errorMessage?: string } {
    if (errorText && errorText.trim()) {
        return { failed: true, errorMessage: errorText.trim().split("\n")[0] };
    }
    if (isPlainObject(response)) {
        if (typeof response.error === "string") return { failed: true, errorMessage: response.error };
        if (typeof response.message === "string" && response.success === false) {
            return { failed: true, errorMessage: response.message };
        }
        if (response.ok === false) {
            const msg = typeof response.error === "string" ? response.error
                : typeof response.message === "string" ? response.message
                    : undefined;
            return { failed: true, errorMessage: msg };
        }
    }
    return { failed: false };
}

export type DetectionResult = {
    calls: DetectedApiCall[];
};

export function detectBashApiCalls(
    command: string | undefined,
    output: string | undefined,
    errorText: string | undefined,
): DetectionResult | null {
    if (!command) return null;

    const statements = splitStatements(command);
    const curls: ParsedCurl[] = [];
    for (const stmt of statements) {
        if (!/\bcurl\b/.test(stmt)) continue;
        const parsed = parseCurl(stmt);
        if (parsed) curls.push(parsed);
    }
    if (curls.length === 0) return null;

    const responses = sliceJsonResponses(unwrapBashToolResult(output ?? ""), curls.length);

    const calls: DetectedApiCall[] = [];
    for (let i = 0; i < curls.length; i++) {
        const curl = curls[i];
        const cls = classifyUrl(curl.url);
        if (!cls) continue;
        const meta = ENDPOINT_ACTIONS[cls.endpoint];
        if (!meta) continue; // unknown endpoint — ignore (likely a GET/read)

        const parsedBody = safeJsonParse(curl.body);
        const body = isPlainObject(parsedBody) ? parsedBody : undefined;
        const response = responses[i];

        let action = meta.action;
        let tone = meta.tone;
        if (cls.endpoint === "update") {
            const sp = specialiseUpdate(body);
            if (sp) { action = sp.action; tone = sp.tone; }
        }

        const { id, title } = extractTitleAndId(body, response);
        const changedFields = cls.endpoint === "update" ? pickChangedFields(body) : [];
        const fail = detectFailure(response, i === curls.length - 1 ? errorText : undefined);

        calls.push({
            entity: cls.entity,
            action,
            tone,
            method: curl.method,
            url: curl.url,
            endpoint: cls.endpoint,
            id,
            title,
            changedFields,
            body,
            response,
            failed: fail.failed,
            errorMessage: fail.errorMessage,
        });
    }

    if (calls.length === 0) return null;
    return { calls };
}
