/** Barrel re-exports for all shared handlers. */
export {
  handleListGoals,
  type ListGoalsInput,
  type ListGoalsResult,
  type GoalSummary,
} from "./listGoalsHandler.js";

export {
  handleListTasks,
  handleGetTask,
  type ListTasksInput,
  type ListTasksResult,
  type GetTaskInput,
  type GetTaskResult,
} from "./taskHandlers.js";

export {
  handleSearchTasks,
  type SearchTasksInput,
  type SearchTasksResult,
} from "./searchTasksHandler.js";

export {
  handleUpdateGoal,
  handleUpdateTask,
  type UpdateGoalInput,
  type UpdateGoalResult,
  type UpdateTaskInput,
  type UpdateTaskResult,
} from "./updateHandlers.js";

export {
  handleGetProgress,
  type GetProgressResult,
} from "./getProgressHandler.js";

export {
  handleExpandTask,
  type ExpandTaskInput,
  type ExpandSubTaskInput,
  type ExpandTaskResult,
} from "./expandTaskHandler.js";

export {
  handleReplan,
  type ReplanInput,
  type ReplanStrategy,
  type ReplanResult,
  type ReplanHumanApprovalResult,
  type ReplanOutcome,
} from "./replanHandler.js";
