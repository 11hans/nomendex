import { functions } from "@/features/skills/fx";
import {
    getPendingSkillUpdates,
    applySkillUpdate,
    applyAllSkillUpdates,
} from "@/services/default-skills";

export const skillsRoutes = {
    "/api/skills/list": {
        async POST() {
            const result = await functions.getSkills.fx({});
            return Response.json(result);
        },
    },
    "/api/skills/pending-updates": {
        async POST() {
            const updates = getPendingSkillUpdates();
            return Response.json(updates);
        },
    },
    "/api/skills/apply-update": {
        async POST(req: Request) {
            const { skillName } = (await req.json()) as { skillName: string };
            const success = await applySkillUpdate(skillName);
            return Response.json({ success });
        },
    },
    "/api/skills/apply-all-updates": {
        async POST() {
            const result = await applyAllSkillUpdates();
            return Response.json(result);
        },
    },
};
