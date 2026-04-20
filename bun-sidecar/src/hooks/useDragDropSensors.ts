import {
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

export function useDragDropSensors(options?: { distance?: number }) {
    const distance = options?.distance ?? 8;
    return useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
}
