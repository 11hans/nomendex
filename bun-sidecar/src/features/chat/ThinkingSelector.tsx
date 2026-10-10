import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { Brain } from "lucide-react";
import type { ThinkingEffort } from "@/features/chat/thinking-types";

type ThinkingPreset = {
    label: string;
    value: ThinkingEffort | undefined;
    description: string;
};

const PRESETS: ThinkingPreset[] = [
    { label: "Auto", value: undefined, description: "Model default" },
    { label: "Low", value: "low", description: "Fastest, least thinking" },
    { label: "Medium", value: "medium", description: "Balanced" },
    { label: "High", value: "high", description: "Thorough" },
    { label: "Max", value: "max", description: "Deepest, slowest" },
];

interface ThinkingSelectorProps {
    value: ThinkingEffort | undefined;
    onChange: (value: ThinkingEffort | undefined) => void;
    disabled?: boolean;
}

export function ThinkingSelector({ value, onChange, disabled }: ThinkingSelectorProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const current = PRESETS.find((p) => p.value === value) ?? PRESETS[0];
    const isNonDefault = value !== undefined;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="gap-1.5"
                    style={{ color: isNonDefault ? styles.semanticPrimary : styles.contentSecondary }}
                    title="Thinking effort"
                >
                    <Brain className="h-4 w-4" />
                    {isNonDefault && <span>{current.label}</span>}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="min-w-max"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                {PRESETS.map((preset) => (
                    <DropdownMenuItem
                        key={preset.label}
                        onClick={() => onChange(preset.value)}
                        className="flex items-center gap-4 cursor-pointer whitespace-nowrap"
                        style={{ color: styles.contentPrimary }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = styles.surfaceAccent;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                        }}
                    >
                        <span>{preset.label}</span>
                        <span className="ml-auto" style={{ color: styles.contentTertiary, fontSize: "0.7rem" }}>
                            {preset.description}
                        </span>
                        {preset.value === value && (
                            <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: styles.semanticSuccess }}
                            />
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
