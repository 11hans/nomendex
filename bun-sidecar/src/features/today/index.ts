import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import TodayView from "./today-view";

const views = {
    default: {
        id: "default",
        name: "Today",
        component: TodayView,
    },
} as const;

export const todayPluginSerial: SerializablePlugin = {
    id: "today",
    name: "Today",
    icon: "calendar-days",
};

export const TodayPluginBase: PluginBase = {
    id: todayPluginSerial.id,
    name: todayPluginSerial.name,
    icon: todayPluginSerial.icon,
    views,
    mcpServers: {},
    functionStubs: {},
    commands: [],
};
