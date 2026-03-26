import { diffLines } from "diff";
import { Badge } from "@/components/ui/badge";
import type { DiffPreviewLine, GitFileDiffResponse } from "./sync-types";
import { Loader2 } from "lucide-react";

const MAX_DIFF_PREVIEW_LINES = 140;
const CONTEXT_LINES = 3;

function splitDiffValue(value: string): string[] {
    if (!value) return [];
    const lines = value.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

function buildUnifiedDiffPreview(baseContent: string, currentContent: string): DiffPreviewLine[] {
    const diffParts = diffLines(baseContent, currentContent);
    const lines: DiffPreviewLine[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (const part of diffParts) {
        const partLines = splitDiffValue(part.value);
        for (const text of partLines) {
            if (part.added) {
                lines.push({ kind: "added", oldLine: null, newLine, text });
                newLine += 1;
                continue;
            }
            if (part.removed) {
                lines.push({ kind: "removed", oldLine, newLine: null, text });
                oldLine += 1;
                continue;
            }
            lines.push({ kind: "context", oldLine, newLine, text });
            oldLine += 1;
            newLine += 1;
        }
    }

    if (lines.length <= MAX_DIFF_PREVIEW_LINES) {
        return collapseContext(lines);
    }

    const headCount = Math.floor(MAX_DIFF_PREVIEW_LINES / 2);
    const tailCount = MAX_DIFF_PREVIEW_LINES - headCount - 1;
    const hiddenCount = lines.length - headCount - tailCount;

    const truncated = [
        ...lines.slice(0, headCount),
        {
            kind: "separator" as const,
            oldLine: null,
            newLine: null,
            text: `... ${hiddenCount} lines hidden ...`,
        },
        ...lines.slice(-tailCount),
    ];

    return collapseContext(truncated);
}

/** Collapse consecutive context lines, keeping only CONTEXT_LINES around changes/separators */
function collapseContext(lines: DiffPreviewLine[]): DiffPreviewLine[] {
    if (lines.length === 0) return lines;

    // Mark which lines are near a change
    const keep = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.kind !== "context") {
            // Keep surrounding context lines
            for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
                keep.add(j);
            }
        }
    }

    // If everything is context (no changes), show all
    if (keep.size === 0) return lines;

    const result: DiffPreviewLine[] = [];
    let lastIncluded = -1;

    for (let i = 0; i < lines.length; i++) {
        if (keep.has(i)) {
            if (lastIncluded >= 0 && i - lastIncluded > 1) {
                const hidden = i - lastIncluded - 1;
                result.push({
                    kind: "separator",
                    oldLine: null,
                    newLine: null,
                    text: `... ${hidden} unchanged lines ...`,
                });
            }
            result.push(lines[i]!);
            lastIncluded = i;
        }
    }

    // Trailing hidden lines
    if (lastIncluded < lines.length - 1) {
        const hidden = lines.length - 1 - lastIncluded;
        if (hidden > 0) {
            result.push({
                kind: "separator",
                oldLine: null,
                newLine: null,
                text: `... ${hidden} unchanged lines ...`,
            });
        }
    }

    return result;
}

interface InlineDiffProps {
    fileDiff: GitFileDiffResponse | undefined;
    loading: boolean;
    error: string | undefined;
    fileKey: string;
}

export function InlineDiff({ fileDiff, loading, error, fileKey }: InlineDiffProps) {
    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading diff...
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                {error}
            </div>
        );
    }

    if (!fileDiff) return null;

    if (fileDiff.isBinary) {
        return (
            <div className="rounded-md border border-warning/20 bg-warning/5 p-2 text-xs text-muted-foreground">
                Binary file — diff not available.
            </div>
        );
    }

    const diffLinesPreview = buildUnifiedDiffPreview(fileDiff.baseContent, fileDiff.currentContent);

    return (
        <div className="rounded-md border bg-background overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/40 text-xs text-muted-foreground">
                <span className="font-mono">HEAD</span>
                <span>→</span>
                <span className="font-mono">Working tree</span>
                {fileDiff.truncated && (
                    <Badge variant="outline" className="ml-auto text-[10px] h-5 px-1.5">
                        Truncated
                    </Badge>
                )}
            </div>
            <div className="max-h-96 overflow-auto">
                <table className="w-full border-collapse font-mono text-[11px]">
                    <tbody>
                        {diffLinesPreview.map((line, index) => {
                            if (line.kind === "separator") {
                                return (
                                    <tr key={`${fileKey}-sep-${index}`} className="bg-muted/20 text-muted-foreground">
                                        <td colSpan={3} className="px-2 py-1 text-center">
                                            {line.text}
                                        </td>
                                    </tr>
                                );
                            }

                            const isAdded = line.kind === "added";
                            const isRemoved = line.kind === "removed";
                            const marker = isAdded ? "+" : isRemoved ? "-" : " ";
                            const rowClass = isAdded
                                ? "bg-success/10"
                                : isRemoved
                                    ? "bg-destructive/10"
                                    : "";
                            const markerClass = isAdded
                                ? "text-success"
                                : isRemoved
                                    ? "text-destructive"
                                    : "text-muted-foreground";
                            const textClass = isAdded
                                ? "text-success"
                                : isRemoved
                                    ? "text-destructive"
                                    : "text-foreground";

                            return (
                                <tr key={`${fileKey}-${index}`} className={rowClass}>
                                    <td className="w-10 px-1.5 py-0.5 text-right text-muted-foreground border-r border-border/40">
                                        {line.oldLine ?? ""}
                                    </td>
                                    <td className="w-10 px-1.5 py-0.5 text-right text-muted-foreground border-r border-border/40">
                                        {line.newLine ?? ""}
                                    </td>
                                    <td className={`px-2 py-0.5 whitespace-pre ${textClass}`}>
                                        <span className={`mr-1 ${markerClass}`}>{marker}</span>
                                        {line.text || " "}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
