import { describe, it, expect } from "vitest";
import type { Task } from "../../../../src/domain/contracts.js";
import { createListTasksTool } from "../../../../src/lib/tools/listTasks.js";
import { makeTask, makeGoal, createToolDeps } from "../../../helpers/mockRepository.js";

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseGoal(tasks: Task[]) {
  return makeGoal({ status: "planned", tasks });
}

interface ListResult {
  goalId: string;
  total: number;
  limit: number;
  offset: number;
  items: Task[];
}

describe("createListTasksTool", () => {
  it("returns all tasks in flat mode", async () => {
    const tasks = [makeTask(), makeTask()];
    const goal = baseGoal(tasks);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ListResult;
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("filters tasks by status", async () => {
    const tasks = [
      makeTask({ status: "completed" }),
      makeTask({ status: "pending" }),
      makeTask({ status: "failed" }),
    ];
    const goal = baseGoal(tasks);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, status: ["completed"] });
    const result = JSON.parse(raw) as ListResult;
    expect(result.total).toBe(1);
    expect(result.items[0]!.status).toBe("completed");
  });

  it("filters tasks by priority", async () => {
    const tasks = [
      makeTask({ priority: "high" }),
      makeTask({ priority: "low" }),
    ];
    const goal = baseGoal(tasks);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, priority: ["high"] });
    const result = JSON.parse(raw) as ListResult;
    expect(result.total).toBe(1);
    expect(result.items[0]!.priority).toBe("high");
  });

  it("respects pagination (limit and offset)", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ description: `Task ${i}` }),
    );
    const goal = baseGoal(tasks);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, limit: 2, offset: 1 });
    const result = JSON.parse(raw) as ListResult;
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.offset).toBe(1);
  });

  it("returns empty list for empty goal", async () => {
    const goal = baseGoal([]);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID });
    const result = JSON.parse(raw) as ListResult;
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("includes flattened sub-tasks when includeSubTasks is true", async () => {
    const child = makeTask({ description: "Sub-task" });
    const parent = makeTask({ description: "Parent", subTasks: [child] });
    const goal = baseGoal([parent]);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, flat: true, includeSubTasks: true });
    const result = JSON.parse(raw) as ListResult;
    // flat+includeSubTasks → flattenTasks, so both parent and child appear
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("returns hierarchical tree when flat is false", async () => {
    const child = makeTask({ description: "Child" });
    const parent = makeTask({ subTasks: [child] });
    const goal = baseGoal([parent]);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, flat: false });
    const result = JSON.parse(raw) as ListResult;
    expect(result.items[0]!.subTasks).toBeDefined();
    expect(result.items[0]!.subTasks).toHaveLength(1);
  });

  // --- Type filter test ---

  it("filters tasks by type", async () => {
    const tasks = [
      makeTask({ type: "research", description: "Research task" }),
      makeTask({ type: "action", description: "Action task" }),
      makeTask({ type: "validation", description: "Validation task" }),
    ];
    const goal = baseGoal(tasks);
    const tool = createListTasksTool(createToolDeps(GOAL_ID, goal));
    const raw = await tool.invoke({ goalId: GOAL_ID, flat: true, type: ["research"] });
    const result = JSON.parse(raw) as ListResult;
    expect(result.total).toBe(1);
    expect(result.items[0]!.description).toBe("Research task");
  });
});
