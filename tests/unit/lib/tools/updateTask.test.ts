import { describe, it, expect, vi } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createUpdateTaskTool } from "../../../../src/lib/tools/updateTask.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";
const CHILD_ID = "550e8400-e29b-41d4-a716-446655440002";

function baseGoal(tasks: Task[]) {
  return makeGoal({ tasks });
}

describe("createUpdateTaskTool", () => {
  it("succeeds with valid status transition (pending → in_progress)", async () => {
    const goal = baseGoal([makeTask({ id: TASK_ID })]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      status: "in_progress",
    });
    const result = JSON.parse(raw) as { task: { status: string } };
    expect(result.task.status).toBe("in_progress");
  });

  it("throws on invalid status transition (completed → pending)", async () => {
    const goal = baseGoal([makeTask({ id: TASK_ID, status: "completed" })]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    await expect(
      tool.invoke({ goalId: GOAL_ID, taskId: TASK_ID, status: "pending" }),
    ).rejects.toThrow("INVALID_TRANSITION");
  });

  it("throws on invalid status transition (cancelled → in_progress)", async () => {
    const goal = baseGoal([makeTask({ id: TASK_ID, status: "cancelled" })]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    await expect(
      tool.invoke({ goalId: GOAL_ID, taskId: TASK_ID, status: "in_progress" }),
    ).rejects.toThrow("INVALID_TRANSITION");
  });

  it("throws when task does not exist", async () => {
    const goal = baseGoal([makeTask({ id: TASK_ID })]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    const missingId = "550e8400-e29b-41d4-a716-44665544ffff";
    await expect(
      tool.invoke({ goalId: GOAL_ID, taskId: missingId, status: "in_progress" }),
    ).rejects.toThrow("TASK_NOT_FOUND");
  });

  it("updates result and error fields on a task", async () => {
    const goal = baseGoal([makeTask({ id: TASK_ID, status: "in_progress" })]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      status: "failed",
      result: "partial output",
      error: "timeout exceeded",
    });
    const result = JSON.parse(raw) as { task: Task };
    expect(result.task.status).toBe("failed");
    expect(result.task.result).toBe("partial output");
    expect(result.task.error).toBe("timeout exceeded");
  });

  it("updates nested sub-task by id", async () => {
    const child = makeTask({ id: CHILD_ID, description: "Child task", parentId: TASK_ID });
    const parent = makeTask({ id: TASK_ID, subTasks: [child] });
    const goal = baseGoal([parent]);
    const tool = createUpdateTaskTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({
      goalId: GOAL_ID,
      taskId: CHILD_ID,
      status: "in_progress",
    });
    const result = JSON.parse(raw) as { task: { status: string } };
    expect(result.task.status).toBe("in_progress");
  });

  // ── Lifecycle hook tests ──────────────────────────────────────────

  it("fires onTaskReady when a task becomes ready (all deps completed)", async () => {
    const depTask = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "in_progress",
    });
    const waitingTask = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440011",
      status: "pending",
      dependencies: [depTask.id],
    });
    const goal = baseGoal([depTask, waitingTask]);
    const onTaskReady = vi.fn();
    const deps = { ...createToolDeps(GOAL_ID, goal), onTaskReady };
    const tool = createUpdateTaskTool(deps);
    await tool.invoke({
      goalId: GOAL_ID,
      taskId: depTask.id,
      status: "completed",
    });
    expect(onTaskReady).toHaveBeenCalledTimes(1);
    expect(onTaskReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: waitingTask.id }),
      expect.objectContaining({ id: GOAL_ID }),
    );
  });

  it("fires onGoalCompleted when all tasks are completed", async () => {
    const t1 = makeTask({ id: "550e8400-e29b-41d4-a716-446655440010", status: "completed" });
    const t2 = makeTask({ id: "550e8400-e29b-41d4-a716-446655440011", status: "in_progress" });
    const goal = baseGoal([t1, t2]);
    const onGoalCompleted = vi.fn();
    const deps = { ...createToolDeps(GOAL_ID, goal), onGoalCompleted };
    const tool = createUpdateTaskTool(deps);
    await tool.invoke({
      goalId: GOAL_ID,
      taskId: t2.id,
      status: "completed",
    });
    expect(onGoalCompleted).toHaveBeenCalledTimes(1);
    expect(onGoalCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: GOAL_ID }));
  });

  it("does not crash when a hook throws", async () => {
    const t1 = makeTask({
      id: "550e8400-e29b-41d4-a716-446655440010",
      status: "in_progress",
    });
    const goal = baseGoal([t1]);
    const onGoalCompleted = vi.fn().mockRejectedValue(new Error("hook boom"));
    const deps = { ...createToolDeps(GOAL_ID, goal), onGoalCompleted };
    const tool = createUpdateTaskTool(deps);
    // Should not throw despite onGoalCompleted throwing
    const raw = await tool.invoke({
      goalId: GOAL_ID,
      taskId: t1.id,
      status: "completed",
    });
    const result = JSON.parse(raw) as { task: { status: string } };
    expect(result.task.status).toBe("completed");
    expect(onGoalCompleted).toHaveBeenCalledTimes(1);
  });
});
