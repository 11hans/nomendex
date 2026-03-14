import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import MemoryBrowserView from "./browser-view";

const views = {
    default: {
        id: "default",
        name: "Memory",
        component: MemoryBrowserView,
    },
} as const;

export const memoryPluginSerial: SerializablePlugin = {
    id: "memory",
    name: "Memory",
    icon: "brain",
};

export const MemoryPluginBase: PluginBase = {
    id: memoryPluginSerial.id,
    name: memoryPluginSerial.name,
    icon: memoryPluginSerial.icon,
    views,
    mcpServers: {},
    functionStubs: {},
    commands: [],
};
