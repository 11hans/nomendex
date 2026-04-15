import { useState } from "react";
import {
    DndContext,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
    arrayMove,
    useSortable,
    sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export interface PlanItem {
    id: string;
    title: string;
    /** Time slot shown as secondary label (e.g. "9:00 – 12:00"), used for table-format plans */
    meta?: string;
    /** Whether id is a real todo ID (numbered list) vs synthetic row index (table) */
    hasTodoId: boolean;
}

interface SortablePlanItemProps {
    item: PlanItem;
    index: number;
}

function SortablePlanItem({ item, index }: SortablePlanItemProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm"
            {...attributes}
        >
            <span className="shrink-0 w-4 text-right text-xs text-muted-foreground select-none">
                {index + 1}.
            </span>
            <button
                type="button"
                className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors"
                {...listeners}
            >
                <GripVertical className="size-3.5" />
            </button>
            {item.meta && (
                <span
                    className="shrink-0 text-xs tabular-nums"
                    style={{ color: styles.contentTertiary }}
                >
                    {item.meta}
                </span>
            )}
            <span
                className="min-w-0 flex-1 truncate text-sm"
                style={{ color: styles.contentPrimary }}
            >
                {item.title}
            </span>
        </div>
    );
}

interface ChatPlanWidgetProps {
    items: PlanItem[];
    onSend: (ordered: PlanItem[]) => void;
    onDismiss: () => void;
}

export function ChatPlanWidget({ items, onSend, onDismiss }: ChatPlanWidgetProps) {
    const { currentTheme } = useTheme();
    const { styles } = currentTheme;
    const [ordered, setOrdered] = useState<PlanItem[]>(items);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setOrdered((prev) => {
                const oldIndex = prev.findIndex((i) => i.id === active.id);
                const newIndex = prev.findIndex((i) => i.id === over.id);
                return arrayMove(prev, oldIndex, newIndex);
            });
        }
    }

    return (
        <div
            className="mt-2 rounded-lg border text-sm"
            style={{
                borderColor: styles.borderDefault,
                backgroundColor: styles.surfaceSecondary,
            }}
        >
            <div
                className="flex items-center gap-1.5 border-b px-3 py-2"
                style={{ borderColor: styles.borderDefault }}
            >
                <ArrowUpDown className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Upravit pořadí plánu
                </span>
            </div>

            <div className="py-1">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={ordered.map((i) => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {ordered.map((item, index) => (
                            <SortablePlanItem key={item.id} item={item} index={index} />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>

            <div
                className="flex items-center justify-end gap-2 border-t px-3 py-2"
                style={{ borderColor: styles.borderDefault }}
            >
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={onDismiss}
                >
                    Zavřít
                </Button>
                <Button
                    variant="default"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => onSend(ordered)}
                >
                    Odeslat agentovi
                </Button>
            </div>
        </div>
    );
}
