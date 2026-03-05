import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useProjectsAPI } from "@/hooks/useProjectsAPI";
import { KeyboardIndicator } from "@/components/KeyboardIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROJECT_COLORS } from "./project-color";

interface RenameProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    projectName: string;
    projectColor?: string;
    existingProjects: string[];
    onRenamed: () => void;
}

export function RenameProjectDialog({
    open,
    onOpenChange,
    projectId,
    projectName,
    projectColor,
    existingProjects,
    onRenamed,
}: RenameProjectDialogProps) {
    const [newName, setNewName] = useState(projectName);
    const [selectedColor, setSelectedColor] = useState<string | undefined>(projectColor);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<{ todoCount: number; noteCount: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const projectsAPI = useProjectsAPI();

    // Reset and load stats when dialog opens
    useEffect(() => {
        if (open && projectName) {
            setNewName(projectName);
            setSelectedColor(projectColor);
            setStats(null);
            projectsAPI.getProjectStats({ projectName }).then(setStats);
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 50);
        }
    }, [open, projectName, projectColor, projectsAPI]);

    const handleSave = async () => {
        const trimmed = newName.trim();
        if (!trimmed || loading) return;

        const nameChanged = trimmed !== projectName;
        const colorChanged = selectedColor !== projectColor;

        if (!nameChanged && !colorChanged) return;

        setLoading(true);
        try {
            if (nameChanged) {
                await projectsAPI.renameProject({ projectId, newName: trimmed });
            }
            if (colorChanged) {
                await projectsAPI.updateProject({ projectId, updates: { color: selectedColor ?? "" } });
            }
            onOpenChange(false);
            onRenamed();
        } catch (err) {
            console.error("Failed to update project:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && isValid) {
            e.preventDefault();
            handleSave();
        }
    };

    const isDuplicate = existingProjects.some(
        (p) => p.toLowerCase() === newName.trim().toLowerCase() && p !== projectName
    );
    const nameUnchanged = newName.trim() === projectName;
    const colorUnchanged = selectedColor === projectColor;
    const isValid = newName.trim().length > 0 && !isDuplicate && !(nameUnchanged && colorUnchanged);

    const hasAssociatedItems = stats && (stats.todoCount > 0 || stats.noteCount > 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 overflow-hidden gap-0"
                showCloseButton={true}
                style={{
                    backgroundColor: styles.surfacePrimary,
                    width: "450px",
                    maxWidth: "90vw",
                }}
            >
                {/* Content Area */}
                <div className="px-6 pt-6 pb-4 space-y-4">
                    <div className="flex items-start gap-3">
                        <div
                            className="p-2 rounded-full"
                            style={{ backgroundColor: `${styles.contentAccent}20` }}
                        >
                            <Pencil size={20} style={{ color: styles.contentAccent }} />
                        </div>
                        <div>
                            <h2
                                className="text-lg font-semibold"
                                style={{ color: styles.contentPrimary }}
                            >
                                Edit Project
                            </h2>
                            <p
                                className="text-sm mt-1"
                                style={{ color: styles.contentSecondary }}
                            >
                                Edit <strong>{projectName}</strong>
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Input
                            ref={inputRef}
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Project name"
                            className="text-base"
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
                        <div>
                            <p className="text-xs mb-2" style={{ color: styles.contentSecondary }}>Color</p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSelectedColor(undefined)}
                                    className="w-6 h-6 rounded-full border-2 transition-all focus:outline-none"
                                    style={{
                                        backgroundColor: styles.surfaceSecondary,
                                        borderColor: !selectedColor ? styles.contentPrimary : styles.borderDefault,
                                    }}
                                    title="No color"
                                />
                                {PROJECT_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        onClick={() => setSelectedColor(color)}
                                        className="w-6 h-6 rounded-full border-2 transition-all focus:outline-none"
                                        style={{
                                            backgroundColor: color,
                                            borderColor: selectedColor === color ? styles.contentPrimary : "transparent",
                                        }}
                                        title={color}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Stats info */}
                    {stats && hasAssociatedItems && (
                        <div
                            className="p-3 rounded-lg text-sm"
                            style={{
                                backgroundColor: styles.surfaceSecondary,
                                border: `1px solid ${styles.borderDefault}`,
                            }}
                        >
                            <p style={{ color: styles.contentSecondary }}>
                                The following items will be updated:
                            </p>
                            <ul className="mt-2 space-y-1" style={{ color: styles.contentPrimary }}>
                                {stats.todoCount > 0 && (
                                    <li>
                                        <strong>{stats.todoCount}</strong> todo{stats.todoCount !== 1 ? "s" : ""} will have their project field updated
                                    </li>
                                )}
                                {stats.noteCount > 0 && (
                                    <li>
                                        <strong>{stats.noteCount}</strong> note{stats.noteCount !== 1 ? "s" : ""} will have their project field updated
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

                    {stats && !hasAssociatedItems && (
                        <p
                            className="text-sm"
                            style={{ color: styles.contentSecondary }}
                        >
                            This project has no associated todos or notes.
                        </p>
                    )}
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
                        className="h-9 px-4"
                    >
                        Cancel
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={handleSave}
                                disabled={!isValid || loading}
                                size="sm"
                                className="h-9 px-4"
                            >
                                {loading ? "Saving..." : "Save"}
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
