import type { FileChange } from "@/lib/git";

export interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    date: string;
}

export interface GitStatus {
    success: boolean;
    initialized: boolean;
    hasRemote: boolean;
    remoteUrl?: string;
    currentBranch?: string;
    remoteBranch?: string;
    status?: string;
    changedFileEntries?: FileChange[];
    changedFiles?: number;
    hasUncommittedChanges?: boolean;
    hasMergeConflict?: boolean;
    conflictCount?: number;
    recentCommits?: CommitInfo[];
    error?: string;
}

export interface DetailedGitStatus {
    success: boolean;
    stagedFiles: FileChange[];
    unstagedFiles: FileChange[];
    hasUncommittedChanges: boolean;
    currentBranch?: string;
    remoteBranch?: string;
    remoteUrl?: string;
    hasMergeConflict?: boolean;
    recentCommits?: CommitInfo[];
    error?: string;
}

export interface ConflictFile {
    path: string;
    status: "both_modified" | "deleted_by_us" | "deleted_by_them" | "both_added";
    resolved: boolean;
}

export interface ConflictsResponse {
    success: boolean;
    hasMergeConflict: boolean;
    conflictFiles: ConflictFile[];
    error?: string;
}

export interface GitFileDiffResponse {
    success: boolean;
    filePath: string;
    status: FileChange["status"] | "unchanged";
    baseContent: string;
    currentContent: string;
    baseExists: boolean;
    currentExists: boolean;
    isBinary: boolean;
    truncated: boolean;
    error?: string;
}

export interface DiffPreviewLine {
    kind: "context" | "added" | "removed" | "separator";
    oldLine: number | null;
    newLine: number | null;
    text: string;
}
