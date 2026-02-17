import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/hooks/useTheme";
import { Tag } from "lucide-react";

interface TagsPickerProps {
    value: string[];
    onChange: (tags: string[]) => void;
    availableTags: string[];
}

export function TagsPicker({ value, onChange, availableTags }: TagsPickerProps) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;

    const addTag = (tag: string) => {
        const trimmed = tag.trim();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
        }
        setInput("");
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center justify-center p-2 rounded-md text-sm font-medium transition-colors hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
                    style={{
                        backgroundColor: styles.surfaceTertiary,
                        color: value.length > 0 ? styles.contentPrimary : styles.contentTertiary,
                    }}
                >
                    <Tag className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                className="w-60 p-3"
                align="start"
                style={{
                    backgroundColor: styles.surfacePrimary,
                    borderColor: styles.borderDefault,
                }}
            >
                <div className="space-y-3">
                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type and press Enter..."
                        className="h-9 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && input.trim()) {
                                e.preventDefault();
                                addTag(input);
                            }
                        }}
                    />
                    {availableTags.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium" style={{ color: styles.contentTertiary }}>
                                Suggestions
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {availableTags
                                    .filter(t => !value.includes(t))
                                    .slice(0, 6)
                                    .map((tag) => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => addTag(tag)}
                                            className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80"
                                            style={{
                                                backgroundColor: styles.surfaceTertiary,
                                                color: styles.contentSecondary,
                                            }}
                                        >
                                            {tag}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
