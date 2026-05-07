import { File, Workflow, BotMessageSquare, ListTodo, Mic, Image, Hash, Brain, CalendarDays, Star } from "lucide-react";
import { SemicolonIcon } from "./SemicolonIcon";
import { PluginIcon } from "@/types/Plugin";

export function getIcon(icon: PluginIcon) {
    switch (icon) {
        case "file":
            return File;
        case "workflow":
            return Workflow;
        case "bot-message-square":
            return BotMessageSquare;
        case "list-todo":
            return ListTodo;
        case "mic":
            return Mic;
        case "semicolon":
            return SemicolonIcon;
        case "image":
            return Image;
        case "hash":
            return Hash;
        case "brain":
            return Brain;
        case "calendar-days":
            return CalendarDays;
        case "star":
            return Star;
        default:
            throw new Error(`Unknown icon: ${icon}`);
    }
}
