import { useState } from "react";
import { History, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CommitInfo } from "./sync-types";

interface RecentCommitsProps {
    commits: CommitInfo[];
}

export function RecentCommits({ commits }: RecentCommitsProps) {
    const [open, setOpen] = useState(false);

    if (commits.length === 0) return null;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                <History className="h-3.5 w-3.5" />
                <span>Recent commits</span>
                <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-1 pt-1">
                    {commits.slice(0, 5).map((commit) => (
                        <div
                            key={commit.hash}
                            className="flex items-baseline gap-3 py-1.5 text-xs"
                        >
                            <code className="text-muted-foreground font-mono shrink-0">
                                {commit.hash}
                            </code>
                            <span className="truncate flex-1">
                                {commit.message}
                            </span>
                            <span className="text-muted-foreground shrink-0">
                                {commit.date}
                            </span>
                        </div>
                    ))}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
