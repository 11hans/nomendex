import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { Brain } from "lucide-react";

type ThinkingPreset = {
    label: string;
    value: number | undefined;
    description: string;
};

const PRESETS: ThinkingPreset[] = [
    { label: "Auto", value: undefined, description: "~Medium (default)" },
    { label: "Low", value: 1024, description: "~1K tokens" },
    { label: "Medium", value: 5000, description: "~5K tokens" },
    { label: "High", value: 10000, description: "~10K tokens" },
    { label: "Max", value: 20000, description: "~20K tokens" },
];

interface ThinkingSelectorProps {
    value: number | undefined;
    onChange: (value: number | undefined) => void;
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
                    title="Thinking budget"
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
