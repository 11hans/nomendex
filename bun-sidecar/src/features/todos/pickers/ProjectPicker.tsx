import { useState, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/hooks/useTheme";
import { Folder, Plus } from "lucide-react";

interface ProjectPickerProps {
    value: string | undefined;
    onChange: (project: string) => void;
    availableProjects: string[];
    disabled?: boolean;
}

export function ProjectPicker({ value, onChange, availableProjects, disabled = false }: ProjectPickerProps) {
    const [open, setOpen] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const filteredProjects = availableProjects.filter(p =>
        p.toLowerCase().includes(input.toLowerCase())
    );

    const handleOpenChange = (nextOpen: boolean) => {
        if (disabled) return;
        setOpen(nextOpen);
        if (nextOpen) {
            setInput(value || "");
            setHighlightIndex(-1);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    };

    const selectProject = (project: string) => {
        onChange(project);
        setOpen(false);
        triggerRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const items = filteredProjects;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setHighlightIndex(prev =>
                    prev < items.length - 1 ? prev + 1 : 0
                );
                break;
            case "ArrowUp":
                e.preventDefault();
                setHighlightIndex(prev =>
                    prev > 0 ? prev - 1 : items.length - 1
                );
                break;
            case "Enter":
                e.preventDefault();
                if (highlightIndex >= 0 && highlightIndex < items.length) {
                    selectProject(items[highlightIndex]);
                } else if (input.trim()) {
                    selectProject(input.trim());
                }
                break;
            case "Escape":
                e.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
                break;
        }
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: value ? styles.contentPrimary : styles.contentTertiary,
                        opacity: disabled ? 0.6 : 1,
                    }}
                    disabled={disabled}
                >
                    <Folder className="size-4 shrink-0" />
                    <span className="truncate max-w-[100px]">{value || "Project"}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-52 p-2"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                <div className="space-y-2">
                    <Input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            setHighlightIndex(-1);
                        }}
                        placeholder="Search or create project..."
                        className="h-9 text-sm"
                        onKeyDown={handleKeyDown}
                    />
                    {filteredProjects.length > 0 && (
                        <div className="max-h-40 overflow-y-auto">
                            {filteredProjects.map((project, index) => {
                                const isHighlighted = index === highlightIndex;
                                const isActive = value === project;
                                return (
                                    <button
                                        key={project}
                                        type="button"
                                        onClick={() => selectProject(project)}
                                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                                        style={{
                                            backgroundColor: isHighlighted ? styles.surfaceTertiary : isActive ? styles.surfaceTertiary : 'transparent',
                                            color: styles.contentPrimary,
                                            outline: isHighlighted ? `2px solid ${styles.borderDefault}` : 'none',
                                        }}
                                    >
                                        <Folder className="size-4" />
                                        {project}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {input.trim() && !filteredProjects.includes(input.trim()) && (
                        <button
                            type="button"
                            onClick={() => selectProject(input.trim())}
                            className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left"
                            style={{
                                backgroundColor: 'transparent',
                                color: styles.contentSecondary,
                            }}
                        >
                            <Plus className="size-4" />
                            Create &quot;{input.trim()}&quot;
                        </button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
