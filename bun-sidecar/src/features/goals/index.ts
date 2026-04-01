export { GoalRecordSchema, GoalBaseSchema, GoalProgressSchema } from "./goal-types";
export type { GoalRecord, GoalProgress } from "./goal-types";

export {
    initializeGoalsService,
    getGoals,
    getGoalById,
    createGoal,
    updateGoal,
    deleteGoal,
    getGoalGraph,
} from "./fx";

export {
    GoalCandidateSchema,
    ProjectGoalLinkSchema,
    MigrationPlanSchema,
    MigrationResultSchema,
    parseGoalsFromMarkdown,
    parseProjectGoalLinks,
    buildMigrationPlan,
    executeMigration,
} from "./migration";

export type {
    GoalCandidate,
    ProjectGoalLink,
    MigrationPlan,
    MigrationGoal,
    ProjectUpdate,
    MigrationResult,
} from "./migration";
