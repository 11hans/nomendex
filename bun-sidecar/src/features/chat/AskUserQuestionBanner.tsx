import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type QuestionOption = {
    label: string;
    description: string;
};

type Question = {
    question: string;
    header: string;
    options: QuestionOption[];
    multiSelect: boolean;
};

type AskUserQuestionBannerProps = {
    questions: Question[];
    onSubmit: (answers: Record<string, string>) => void;
    onDeny: () => void;
};

export function parseAskUserQuestionInput(
    input: Record<string, unknown>
): Question[] | null {
    const raw = input.questions;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // Basic validation — each item must have question, options
    for (const q of raw) {
        if (
            typeof q !== "object" ||
            q === null ||
            typeof q.question !== "string" ||
            !Array.isArray(q.options) ||
            q.options.length < 2
        ) {
            return null;
        }
    }
    return raw as Question[];
}

function SingleQuestion({
    q,
    answer,
    onAnswer,
}: {
    q: Question;
    answer: string | undefined;
    onAnswer: (value: string) => void;
}) {
    const [otherMode, setOtherMode] = useState(false);
    const [otherText, setOtherText] = useState("");

    const selectedLabels = answer ? answer.split(", ") : [];

    const handleOptionClick = (label: string) => {
        if (q.multiSelect) {
            const next = selectedLabels.includes(label)
                ? selectedLabels.filter((l) => l !== label)
                : [...selectedLabels, label];
            if (next.length > 0) {
                setOtherMode(false);
                onAnswer(next.join(", "));
            } else {
                onAnswer("");
            }
        } else {
            setOtherMode(false);
            onAnswer(label);
        }
    };

    const handleOtherSubmit = () => {
        const trimmed = otherText.trim();
        if (trimmed) {
            onAnswer(trimmed);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {q.header}
                </span>
                <span className="text-xs text-foreground">{q.question}</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                    const isSelected = selectedLabels.includes(opt.label);
                    return (
                        <button
                            key={opt.label}
                            type="button"
                            title={opt.description}
                            onClick={() => handleOptionClick(opt.label)}
                            className={cn(
                                "relative rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                                "hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                                isSelected
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card text-foreground"
                            )}
                        >
                            {q.multiSelect && isSelected && (
                                <Check className="mr-1 inline-block h-3 w-3" />
                            )}
                            {opt.label}
                        </button>
                    );
                })}

                {/* Other button */}
                {!otherMode ? (
                    <button
                        type="button"
                        onClick={() => {
                            setOtherMode(true);
                            if (!q.multiSelect) onAnswer("");
                        }}
                        className={cn(
                            "rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground transition-colors",
                            "hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                            otherMode && "border-primary text-primary"
                        )}
                    >
                        Other…
                    </button>
                ) : (
                    <div className="flex items-center gap-1">
                        <Input
                            autoFocus
                            placeholder="Type your answer…"
                            value={otherText}
                            onChange={(e) => setOtherText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleOtherSubmit();
                                if (e.key === "Escape") {
                                    setOtherMode(false);
                                    setOtherText("");
                                }
                            }}
                            className="h-7 w-40 text-xs"
                        />
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-1.5"
                            onClick={handleOtherSubmit}
                            disabled={!otherText.trim()}
                        >
                            <Check className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function AskUserQuestionBanner({
    questions,
    onSubmit,
    onDeny,
}: AskUserQuestionBannerProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});

    const setAnswer = useCallback((questionText: string, value: string) => {
        setAnswers((prev) => ({ ...prev, [questionText]: value }));
    }, []);

    const allAnswered = questions.every((q) => {
        const a = answers[q.question];
        return a !== undefined && a !== "";
    });

    const handleSubmit = () => {
        if (allAnswered) {
            onSubmit(answers);
        }
    };

    return (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                        Agent has a question
                    </span>
                </div>

                {questions.map((q) => (
                    <SingleQuestion
                        key={q.question}
                        q={q}
                        answer={answers[q.question]}
                        onAnswer={(val) => setAnswer(q.question, val)}
                    />
                ))}

                <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onDeny}
                    >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Skip
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={handleSubmit}
                        disabled={!allAnswered}
                    >
                        Submit
                    </Button>
                </div>
            </div>
        </div>
    );
}
