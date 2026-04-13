import type { GoalRecord } from "./goal-types";
import type { ProjectConfig } from "@/features/projects/project-types";
import type { Todo } from "@/features/todos/todo-types";

export type GoalForestNodeView = {
    goal: GoalRecord;
    children: GoalForestNodeView[];
    linkedProjects: ProjectConfig[];
    linkedProjectCount: number;
    linkedTodoCount: number;
    openTodoCount: number;
    doneTodoCount: number;
    computedProgress: number;
};

export type GoalGraphView = {
    goal: GoalRecord;
    childGoals: GoalRecord[];
    linkedProjects: ProjectConfig[];
    linkedTodos: Todo[];
    computedProgress: number;
};
