import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useTheme } from "@/hooks/useTheme";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CreateProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateProject: (name: string) => Promise<void>;
    loading: boolean;
    existingProjects: string[];
}

export function CreateProjectDialog({
    open,
    onOpenChange,
    onCreateProject,
    loading,
    existingProjects
}: CreateProjectDialogProps) {
    const [projectName, setProjectName] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    // Reset input when dialog opens
    useEffect(() => {
        if (open) {
            setProjectName("");
            // Focus input after a short delay to allow dialog to render
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    const handleCreate = async () => {
        const trimmed = projectName.trim();
        if (trimmed && !loading) {
            await onCreateProject(trimmed);
            onOpenChange(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && projectName.trim()) {
            e.preventDefault();
            handleCreate();
        }
    };

    const isDuplicate = existingProjects.some(p => p.toLowerCase() === projectName.trim().toLowerCase());
    const isValid = projectName.trim().length > 0 && !isDuplicate;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button
                    variant="default"
                    size="sm"
                    className="projects-create-btn h-7 px-2 text-[11px] font-medium rounded-md"
                >
                    + new
                </Button>
            </DialogTrigger>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: '440px',
                    maxWidth: '90vw',
                }}
            >
                <div
                    className="px-6 py-3 flex items-center justify-between"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderBottom: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: styles.contentPrimary }}>
                        Create Project
                    </span>
                    <span className="text-[10px]" style={{ color: styles.contentTertiary }}>
                        Enter to confirm
                    </span>
                </div>

                <div className="px-6 pt-5 pb-4 space-y-3">
                    <div className="space-y-2">
                        <div className="text-[10px] uppercase tracking-[0.08em]" style={{ color: styles.contentTertiary }}>
                            Name
                        </div>
                        <Input
                            ref={inputRef}
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            placeholder="Project name"
                            className="h-10 text-sm border rounded-md px-3 focus-visible:ring-0"
                            style={{
                                color: styles.contentPrimary,
                                backgroundColor: styles.surfaceSecondary,
                                borderColor: isDuplicate ? styles.semanticDestructive : styles.borderDefault,
                            }}
                            onKeyDown={handleKeyDown}
                        />
                        {isDuplicate && (
                            <p className="text-xs" style={{ color: styles.semanticDestructive }}>
                                A project with this name already exists
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div
                    className="px-6 py-3 flex items-center justify-end gap-2"
                    style={{
                        backgroundColor: styles.surfaceSecondary,
                        borderTop: `1px solid ${styles.borderDefault}`,
                    }}
                >
                    <Button
                        onClick={() => onOpenChange(false)}
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs"
                    >
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={handleCreate}
                                disabled={!isValid || loading}
                                size="sm"
                                className="h-8 px-3 text-xs"
                            >
                                {loading ? "Creating..." : "Create"}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent
                            className="z-[100]"
                            style={{
                                backgroundColor: styles.surfaceTertiary,
                                color: styles.contentPrimary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <KeyboardIndicator keys={["enter"]} />
                        </TooltipContent>
                    </Tooltip>
                </div>
            </DialogContent>
        </Dialog>
    );
}
