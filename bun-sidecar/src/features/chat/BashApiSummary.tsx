import { useState, useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    XCircle,
    ListTodo,
    Star,
    Workflow,
    FileText,
    Loader2,
    type LucideIcon,
} from "lucide-react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { useWorkspaceContext } from "@/contexts/WorkspaceContext";
import { todosPluginSerial } from "@/features/todos";
import { goalsPluginSerial } from "@/features/goals/plugin";
import { projectsPluginSerial } from "@/features/projects";
import { notesPluginSerial } from "@/features/notes";
import type { DetectedApiCall, ApiActionTone, ApiEntity } from "./bash-curl-detector";

const ENTITY_ICON: Record<ApiEntity, LucideIcon> = {
    todo: ListTodo,
    goal: Star,
    project: Workflow,
    note: FileText,
};

const ENTITY_LABEL: Record<ApiEntity, string> = {
    todo: "todo",
    goal: "goal",
    project: "project",
    note: "note",
};

// Tailwind class fragments per tone. Kept inline (and complete) so Tailwind's
// JIT picks them up — do not template these.
const TONE_BADGE: Record<ApiActionTone, string> = {
    create: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    update: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    archive: "bg-muted text-muted-foreground border-border",
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

function formatFieldValue(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        if (value.every((v) => typeof v === "string" || typeof v === "number")) {
            return value.join(", ");
        }
        return `${value.length} items`;
    }
    if (typeof value === "object") return "{…}";
    return String(value);
}

type Props = {
    calls: DetectedApiCall[];
    pending: boolean;
    rawCommand: string;
    rawOutput: string;
    rawErrorText?: string;
};

export function BashApiSummary({ calls, pending, rawCommand, rawOutput, rawErrorText }: Props) {
    if (calls.length === 1) {
        return (
            <SingleCallCard
                call={calls[0]}
                pending={pending}
                rawCommand={rawCommand}
                rawOutput={rawOutput}
                rawErrorText={rawErrorText}
            />
        );
    }

    // Group identical (entity, action) so 5× archive shows as one card with a list.
    const groups = groupByEntityAction(calls);
    return (
        <div className="my-1.5 max-w-xl space-y-1.5">
            {groups.map((group, idx) => (
                <GroupedCallCard
                    key={idx}
                    group={group}
                    pending={pending && idx === groups.length - 1}
                    rawCommand={rawCommand}
                    rawOutput={rawOutput}
                    rawErrorText={rawErrorText}
                />
            ))}
        </div>
    );
}

function groupByEntityAction(calls: DetectedApiCall[]): DetectedApiCall[][] {
    const groups: DetectedApiCall[][] = [];
    for (const call of calls) {
        const last = groups[groups.length - 1];
        if (last && last[0].entity === call.entity && last[0].action === call.action && !call.failed && !last[0].failed) {
            last.push(call);
        } else {
            groups.push([call]);
        }
    }
    return groups;
}

function SingleCallCard({
    call,
    pending,
    rawCommand,
    rawOutput,
    rawErrorText,
}: {
    call: DetectedApiCall;
    pending: boolean;
    rawCommand: string;
    rawOutput: string;
    rawErrorText?: string;
}) {
    const [open, setOpen] = useState(false);
    const Icon = ENTITY_ICON[call.entity];
    const failed = call.failed;
    const onOpenEntity = useOpenEntity();

    return (
        <div className="my-1.5 max-w-xl">
            <div
                className={cn(
                    "overflow-hidden rounded-md border bg-card",
                    failed ? "border-destructive/40" : "border-border/60",
                )}
            >
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    {pending ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : failed ? (
                        <XCircle className="size-3.5 shrink-0 text-destructive" />
                    ) : (
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                    )}
                    <Badge
                        variant="outline"
                        className={cn("h-5 shrink-0 px-1.5 text-[10px] font-medium uppercase tracking-wide", TONE_BADGE[call.tone])}
                    >
                        {call.action}
                    </Badge>
                    <span className="text-muted-foreground">{ENTITY_LABEL[call.entity]}</span>
                    {call.title ? (
                        <button
                            type="button"
                            onClick={() => onOpenEntity(call)}
                            disabled={!canOpenEntity(call)}
                            className={cn(
                                "flex-1 truncate text-left font-medium",
                                canOpenEntity(call) ? "cursor-pointer text-foreground hover:underline" : "cursor-default text-foreground",
                            )}
                            title={canOpenEntity(call) ? "Open" : undefined}
                        >
                            <Icon className="mr-1 inline-block size-3 shrink-0 text-muted-foreground" />
                            {call.title}
                        </button>
                    ) : (
                        <span className="flex-1 text-muted-foreground/70">
                            <Icon className="mr-1 inline-block size-3 shrink-0" />
                            {call.id ?? call.endpoint}
                        </span>
                    )}
                </div>
                {failed && call.errorMessage && (
                    <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
                        {call.errorMessage}
                    </div>
                )}
                {!failed && call.changedFields.length > 0 && (
                    <div className="border-t border-border/40 px-3 py-1.5 text-xs">
                        <ChangedFieldsList fields={call.changedFields} />
                    </div>
                )}
                <Collapsible open={open} onOpenChange={setOpen}>
                    <CollapsibleTrigger className="flex w-full items-center gap-1 border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40">
                        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        {open ? "Hide raw" : "Show raw"}
                        <span className="flex-1" />
                        <span className="font-mono">{call.method} {endpointShort(call.url)}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <RawSection
                            command={rawCommand}
                            output={rawOutput}
                            errorText={rawErrorText}
                        />
                    </CollapsibleContent>
                </Collapsible>
            </div>
        </div>
    );
}

function GroupedCallCard({
    group,
    pending,
    rawCommand,
    rawOutput,
    rawErrorText,
}: {
    group: DetectedApiCall[];
    pending: boolean;
    rawCommand: string;
    rawOutput: string;
    rawErrorText?: string;
}) {
    const [open, setOpen] = useState(false);
    const first = group[0];
    const Icon = ENTITY_ICON[first.entity];
    const onOpenEntity = useOpenEntity();

    if (group.length === 1) {
        return (
            <SingleCallCard
                call={first}
                pending={pending}
                rawCommand={rawCommand}
                rawOutput={rawOutput}
                rawErrorText={rawErrorText}
            />
        );
    }

    return (
        <div className="overflow-hidden rounded-md border border-border/60 bg-card">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                {pending ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                )}
                <Badge
                    variant="outline"
                    className={cn("h-5 shrink-0 px-1.5 text-[10px] font-medium uppercase tracking-wide", TONE_BADGE[first.tone])}
                >
                    {first.action}
                </Badge>
                <span className="text-foreground">
                    {group.length} {ENTITY_LABEL[first.entity]}{group.length === 1 ? "" : "s"}
                </span>
                <span className="flex-1" />
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                >
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
            </div>
            <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleContent>
                    <ul className="border-t border-border/40 divide-y divide-border/30">
                        {group.map((call, i) => (
                            <li key={i} className="px-3 py-1.5 text-xs">
                                {call.title ? (
                                    <button
                                        type="button"
                                        onClick={() => onOpenEntity(call)}
                                        disabled={!canOpenEntity(call)}
                                        className={cn(
                                            "flex w-full items-center gap-1.5 text-left",
                                            canOpenEntity(call) ? "cursor-pointer hover:underline" : "cursor-default",
                                        )}
                                    >
                                        <Icon className="size-3 shrink-0 text-muted-foreground" />
                                        <span className="truncate">{call.title}</span>
                                    </button>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                        <Icon className="size-3 shrink-0" />
                                        <span className="truncate font-mono">{call.id ?? call.endpoint}</span>
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <RawSection
                        command={rawCommand}
                        output={rawOutput}
                        errorText={rawErrorText}
                    />
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

function ChangedFieldsList({ fields }: { fields: { key: string; value: unknown }[] }) {
    if (fields.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {fields.map(({ key, value }) => (
                <span key={key} className="text-muted-foreground">
                    <span className="text-foreground/80">{key}:</span>{" "}
                    <span className="font-mono text-foreground">{formatFieldValue(value)}</span>
                </span>
            ))}
        </div>
    );
}

function RawSection({
    command,
    output,
    errorText,
}: {
    command: string;
    output: string;
    errorText?: string;
}) {
    const prettyOutput = useMemo(() => {
        if (errorText) return errorText;
        if (!output) return "";
        try {
            return JSON.stringify(JSON.parse(output), null, 2);
        } catch {
            return output;
        }
    }, [output, errorText]);

    return (
        <div className="border-t border-border/40 bg-background">
            <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">Command</div>
            <div className="px-3 pb-2">
                <pre className="whitespace-pre-wrap break-all rounded bg-secondary/40 px-2 py-1.5 font-mono text-[11px] text-foreground">
                    {command}
                </pre>
            </div>
            {prettyOutput && (
                <>
                    <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                        {errorText ? "Error" : "Response"}
                    </div>
                    <div className="px-3 pb-2">
                        {errorText ? (
                            <pre className="whitespace-pre-wrap break-all rounded bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-destructive">
                                {prettyOutput}
                            </pre>
                        ) : (
                            <CodeBlock code={prettyOutput} language="json" />
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function endpointShort(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

function canOpenEntity(call: DetectedApiCall): boolean {
    if (call.endpoint === "delete") return false;
    switch (call.entity) {
        case "todo": return !!call.id;
        case "goal": return !!call.id;
        case "project": return !!call.title;
        case "note": return !!call.title;
        default: return false;
    }
}

function readProjectFromCall(call: DetectedApiCall): string | undefined {
    const fromResponse = isObj(call.response) ? call.response.project : undefined;
    if (typeof fromResponse === "string" && fromResponse) return fromResponse;
    const body = isObj(call.body) ? call.body : undefined;
    const updates = body && isObj(body.updates) ? body.updates : body;
    const fromBody = updates && typeof updates.project === "string" ? updates.project : undefined;
    return fromBody && fromBody.length > 0 ? fromBody : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function useOpenEntity() {
    const { openTab, updateTabProps } = useWorkspaceContext();
    return (call: DetectedApiCall) => {
        if (!canOpenEntity(call)) return;
        switch (call.entity) {
            case "todo":
                if (call.id) {
                    const project = readProjectFromCall(call);
                    // Nonce forces the auto-open effect to re-fire on repeat clicks.
                    const editorRequest = `${call.id}#${Date.now()}`;
                    const tab = openTab({
                        pluginMeta: todosPluginSerial,
                        view: "browser",
                        props: { project, selectedTodoId: call.id, openEditorForTodoId: editorRequest },
                    });
                    // Existing matching tab (same project) is reused without prop
                    // updates — push fresh values in so the right todo highlights AND opens.
                    if (tab) updateTabProps(tab.id, { selectedTodoId: call.id, openEditorForTodoId: editorRequest });
                }
                return;
            case "goal":
                if (call.id) {
                    openTab({
                        pluginMeta: goalsPluginSerial,
                        view: "detail",
                        props: { goalId: call.id },
                    });
                }
                return;
            case "project":
                if (call.title) {
                    openTab({
                        pluginMeta: projectsPluginSerial,
                        view: "detail",
                        props: { projectName: call.title },
                    });
                }
                return;
            case "note":
                if (call.title) {
                    openTab({
                        pluginMeta: notesPluginSerial,
                        view: "editor",
                        props: { noteFileName: call.title },
                    });
                }
                return;
        }
    };
}
