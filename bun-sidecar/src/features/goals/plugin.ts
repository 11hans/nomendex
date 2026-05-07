import { PluginBase, SerializablePlugin } from "@/types/Plugin";
import { z } from "zod";
import GoalsBrowserView from "./goals-browser-view";
import GoalDetailView from "./goal-detail-view";

export const goalDetailViewPropsSchema = z.object({
    goalId: z.string(),
});
export type GoalDetailViewProps = z.infer<typeof goalDetailViewPropsSchema>;

const views = {
    default: {
        id: "default",
        name: "Goals Browser",
        component: GoalsBrowserView,
    },
    browser: {
        id: "browser",
        name: "Goals Browser",
        component: GoalsBrowserView,
    },
    detail: {
        id: "detail",
        name: "Goal Detail",
        component: GoalDetailView,
        props: goalDetailViewPropsSchema,
    },
} as const;

export const goalsPluginSerial: SerializablePlugin = {
    id: "goals",
    name: "Goals",
    icon: "star",
};

export const GoalsPluginBase: PluginBase = {
    id: goalsPluginSerial.id,
    name: goalsPluginSerial.name,
    icon: goalsPluginSerial.icon,
    mcpServers: {},
    views,
    functionStubs: {},
    commands: [],
};
