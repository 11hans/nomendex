import { z } from "zod";
import { FunctionStubs } from "@/types/Functions";

export const SkillSchema = z.object({
    name: z.string(),
    title: z.string(),
    preview: z.string(),
    source: z.string().optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

export const functionStubs = {
    getSkills: {
        input: z.object({}),
        output: z.array(SkillSchema),
    },
} satisfies FunctionStubs;
