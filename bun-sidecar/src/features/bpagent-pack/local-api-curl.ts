// BPagent's skills read and write todos, goals and projects with `curl` to the
// local Nomendex API, and a permission prompt for every call stalled /daily
// (5-8 prompts per run). This recognises those calls so chat can auto-allow them.
//
// Not a CLI permission rule on purpose: measured on CLI 2.1.296, the rule
// `Bash(curl *http://localhost:PORT/api/*)` also auto-allows a second, external
// URL (`curl https://x http://localhost:PORT/api/...`) and `-o <any file>`. Here
// every word must be a known flag, its value, or the one local URL; anything
// else (other flags, `;`, `&&`, `$(...)`, redirects, globs) falls back to a prompt.

// Endpoints the BPagent prompt and default skills call. Deletes and the
// settings/agents/chat/git/mcp/secrets routes are left out: those keep a prompt.
const AUTO_ALLOWED_ENDPOINTS = new Set([
    "goals/create",
    "goals/get",
    "goals/graph",
    "goals/graph/forest",
    "goals/list",
    "goals/sync/all",
    "goals/sync/dashboards",
    "goals/sync/goal",
    "goals/sync/import",
    "goals/sync/project",
    "goals/update",
    "insights/scan",
    "notes/get",
    "projects/board/get",
    "projects/board/save",
    "projects/create",
    "projects/get",
    "projects/get-by-name",
    "projects/list",
    "projects/update",
    "todos/archive",
    "todos/archived",
    "todos/create",
    "todos/get",
    "todos/list",
    "todos/projects",
    "todos/skip-recurrence",
    "todos/tags",
    "todos/task-planner/apply",
    "todos/task-planner/preview",
    "todos/timeblocking/apply",
    "todos/timeblocking/preview",
    "todos/unarchive",
    "todos/update",
    "workspace/paths",
]);

// Characters allowed in an unquoted word; anything else (`;&<>()$\`*?[]{}~#!`,
// newlines...) means the command is more than a plain curl call.
const PLAIN_CHAR = /[A-Za-z0-9_\-.,:/=+%@]/;

// Splits a command into pipeline stages of words, resolving quotes. Returns
// null when it uses anything but plain words, quotes and single `|` pipes.
function splitPipeline(command: string): string[][] | null {
    const stages: string[][] = [[]];
    let word = "";
    let inWord = false;
    const flush = () => {
        if (inWord) stages[stages.length - 1].push(word);
        word = "";
        inWord = false;
    };

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (ch === "'" || ch === '"') {
            const end = command.indexOf(ch, i + 1);
            if (end === -1) return null;
            const content = command.slice(i + 1, end);
            // Double quotes still expand `$`, backticks and escapes.
            if (ch === '"' && /[$`\\!]/.test(content)) return null;
            word += content;
            inWord = true;
            i = end;
        } else if (ch === "\\" && command[i + 1] === "\n") {
            i++; // line continuation
        } else if (ch === " " || ch === "\t") {
            flush();
        } else if (ch === "|") {
            flush();
            if (stages[stages.length - 1].length === 0) return null;
            stages.push([]);
        } else if (PLAIN_CHAR.test(ch)) {
            word += ch;
            inWord = true;
        } else {
            return null;
        }
    }
    flush();
    return stages.every((s) => s.length > 0) ? stages : null;
}

const SWITCHES = new Set(["--silent", "--show-error", "--fail", "--globoff", "--include"]);
const SHORT_SWITCHES = /^-[sSfgi]+$/;
const METHOD = /^(GET|POST)$/;
const NUMBER = /^\d+(\.\d+)?$/;
// `@file` makes curl read a file into the body or headers.
const notFileRef = (v: string) => !v.startsWith("@");

const VALUE_FLAGS: Record<string, (value: string) => boolean> = {
    "-X": (v) => METHOD.test(v),
    "--request": (v) => METHOD.test(v),
    "-H": notFileRef,
    "--header": notFileRef,
    "-d": notFileRef,
    "--data": notFileRef,
    "--data-raw": notFileRef,
    "--data-binary": notFileRef,
    "--json": notFileRef,
    "-m": (v) => NUMBER.test(v),
    "--max-time": (v) => NUMBER.test(v),
    "--connect-timeout": (v) => NUMBER.test(v),
};

function isLocalApiCurlStage(words: string[], port: number): boolean {
    if (words[0] !== "curl") return false;
    const urlPattern = new RegExp(`^http://(?:localhost|127\\.0\\.0\\.1):${port}/api/([a-z0-9/-]+)(?:\\?[A-Za-z0-9._~%&=+:,-]*)?$`);
    let endpoint: string | null = null;

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        if (SWITCHES.has(word) || SHORT_SWITCHES.test(word)) continue;
        if (/^-X(GET|POST)$/.test(word)) continue;
        const valueCheck = VALUE_FLAGS[word];
        if (valueCheck) {
            const value = words[++i];
            if (value === undefined || !valueCheck(value)) return false;
            continue;
        }
        const match = urlPattern.exec(word);
        if (!match || endpoint !== null) return false;
        endpoint = match[1];
    }
    return endpoint !== null && AUTO_ALLOWED_ENDPOINTS.has(endpoint);
}

// `head -c 5000`, `head -n 50`: the agent trims long responses this way.
function isHeadStage(words: string[]): boolean {
    if (words[0] !== "head") return false;
    if (words.length === 2) return /^-[cn]?\d+$/.test(words[1]);
    return words.length === 3 && /^-[cn]$/.test(words[1]) && /^\d+$/.test(words[2]);
}

/** True when `command` is a single curl call to an auto-allowed local API endpoint, optionally piped to `head`. */
export function isAutoAllowedLocalApiCurl(command: string, port: number): boolean {
    const stages = splitPipeline(command.trim());
    if (!stages || stages.length > 2) return false;
    if (!isLocalApiCurlStage(stages[0], port)) return false;
    return stages.length === 1 || isHeadStage(stages[1]);
}
