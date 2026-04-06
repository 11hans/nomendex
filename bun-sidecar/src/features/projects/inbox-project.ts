export const INBOX_PROJECT_NAME = "Inbox";
const INBOX_PROJECT_ALIAS = "inbox";

export function isInboxProjectName(projectName?: string | null): boolean {
    const normalized = projectName?.trim().toLowerCase();
    if (!normalized) return false;
    return normalized === INBOX_PROJECT_ALIAS;
}

export function canonicalizeTodoProject(projectName?: string | null): string {
    const normalized = projectName?.trim() ?? "";
    if (!normalized) return INBOX_PROJECT_NAME;
    if (normalized.toLowerCase() === INBOX_PROJECT_ALIAS) return INBOX_PROJECT_NAME;
    return normalized;
}

export function canonicalizeProjectFilter(projectName?: string | null): string | undefined {
    if (projectName == null) return undefined;
    return canonicalizeTodoProject(projectName);
}
