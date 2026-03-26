import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface CommitBoxProps {
    stagedCount: number;
    onCommit: (message: string) => Promise<void>;
    committing: boolean;
}

export function CommitBox({ stagedCount, onCommit, committing }: CommitBoxProps) {
    const [message, setMessage] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing;

    const handleCommit = async () => {
        if (!canCommit) return;
        await onCommit(message.trim());
        setMessage("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            void handleCommit();
        }
    };

    // Auto-resize textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, [message]);

    return (
        <div className="space-y-1.5">
            <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Commit message (⌘Enter to commit)"
                className="w-full resize-none rounded-md border bg-background px-2.5 py-2 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                rows={1}
            />
            <Button
                size="sm"
                className="w-full h-7 text-xs"
                disabled={!canCommit}
                onClick={handleCommit}
            >
                {committing ? (
                    <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        Committing...
                    </>
                ) : (
                    <>
                        Commit
                        {stagedCount > 0 && (
                            <span className="ml-1 text-[10px] opacity-70">({stagedCount})</span>
                        )}
                    </>
                )}
            </Button>
        </div>
    );
}
