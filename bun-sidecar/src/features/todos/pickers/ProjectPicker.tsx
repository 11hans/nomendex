import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/hooks/useTheme";
import { Folder } from "lucide-react";

interface ProjectPickerProps {
    value: string | undefined;
    onChange: (project: string) => void;
    availableProjects: string[];
    disabled?: boolean;
}

export function ProjectPicker({ value, onChange, availableProjects, disabled = false }: ProjectPickerProps) {
    const [open, setOpen] = useState(false);
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const handleOpenChange = (nextOpen: boolean) => {
        if (disabled) return;
        setOpen(nextOpen);
    };

    const selectProject = (project: string) => {
        onChange(project);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <button
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
                className="w-48 p-1 z-[100]"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                <div className="max-h-60 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
                    {availableProjects.map((project) => {
                        const isActive = value === project;
                        return (
                            <button
                                key={project}
                                type="button"
                                onClick={() => selectProject(project)}
                                className="flex items-center gap-2 w-full px-2.5 py-2 rounded text-sm transition-colors text-left hover:opacity-80"
                                style={{
                                    backgroundColor: isActive ? styles.surfaceTertiary : 'transparent',
                                    color: styles.contentPrimary,
                                }}
                            >
                                <Folder className="size-4 shrink-0" style={{ color: isActive ? styles.contentPrimary : styles.contentTertiary }} />
                                {project}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
