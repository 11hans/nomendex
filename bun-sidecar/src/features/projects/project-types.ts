import { z } from "zod";

// Board column schema for custom kanban boards
export const BoardColumnSchema = z.object({
    id: z.string(),
    title: z.string(),
    order: z.number(),
    status: z.enum(["todo", "in_progress", "done", "later"]).optional(), // Maps column to default status
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

export const BoardConfigSchema = z.object({
    columns: z.array(BoardColumnSchema),
    showDone: z.boolean().default(true),
});
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

export const ProjectConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    color: z.string().optional(),
    archived: z.boolean().optional(),
    board: BoardConfigSchema.optional(), // Custom kanban board configuration
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const ProjectsFileSchema = z.object({
    version: z.number(),
    projects: z.array(ProjectConfigSchema),
    migratedAt: z.string().optional(),
});

export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;
