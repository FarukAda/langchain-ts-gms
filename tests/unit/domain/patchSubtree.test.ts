import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Goal, Task } from "../../../src/domain/contracts.js";
import { patchPlanSubtree } from "../../../src/domain/patchSubtree.js";
import { ConcurrentModificationError } from "../../../src/domain/errors.js";
import { createStaticGoalRepo, makeTask, makeGoal } from "../../helpers/mockRepository.js";
import { setLogSilent } from "../../../src/infra/observability/tracing.js";

setLogSilent(true);

const GOAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const ROOT_TASK_ID = "550e8400-e29b-41d4-a716-446655440001";
const CHILD_A_ID = "550e8400-e29b-41d4-a716-44665544000a";
const CHILD_B_ID = "550e8400-e29b-41d4-a716-44665544000b";

describe("patchPlanSubtree", () => {
  let goal: Goal;

  beforeEach(() => {
    const childA = makeTask({ id: CHILD_A_ID, description: "Old child A", parentId: ROOT_TASK_ID });
    const childB = makeTask({ id: CHILD_B_ID, description: "Old child B", parentId: ROOT_TASK_ID });
    const root = makeTask({
      id: ROOT_TASK_ID,
      description: "Root task",
      subTasks: [childA, childB],
    });
    goal = makeGoal({ id: GOAL_ID, tasks: [root], _version: 1 });
  });

  it("passes _version to upsert for optimistic concurrency control", async () => {
    const repo = createStaticGoalRepo(GOAL_ID, goal);
    const replacement: Task[] = [makeTask({ id: crypto.randomUUID(), description: "New child" })];

    await patchPlanSubtree(repo, {
      goalId: GOAL_ID,
      subtreeRootId: ROOT_TASK_ID,
      replacementTasks: replacement,
    });

    // Verify upsert was called with _version = 1 (the initial version)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest spy assertion
    expect(vi.mocked(repo.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({ id: GOAL_ID }),
      1,
    );
  });

  it("throws ConcurrentModificationError on version mismatch", async () => {
    const repo = createStaticGoalRepo(GOAL_ID, goal);
    const replacement: Task[] = [makeTask({ id: crypto.randomUUID(), description: "New child" })];

    // Simulate a concurrent write that bumps the version
    Object.assign(goal, { _version: 2 });

    // patchSubtree reads goal with _version=2 but the repo expects _version=1
    // — actually, the repo stores version 2 now, and patchSubtree reads it
    // with _version=2, so let's simulate a race by modifying the stored version
    // after getById but before upsert.

    // Instead, directly test by setting up a repo that will reject the version.
    const raceRepo = {
      ...repo,
      getById: vi.fn().mockResolvedValue({ ...goal, _version: 1 }),
      upsert: vi.fn().mockRejectedValue(new ConcurrentModificationError(GOAL_ID, 1)),
    } as unknown as typeof repo;

    await expect(
      patchPlanSubtree(raceRepo, {
        goalId: GOAL_ID,
        subtreeRootId: ROOT_TASK_ID,
        replacementTasks: replacement,
      }),
    ).rejects.toThrow(ConcurrentModificationError);
  });

  it("replaces sub-tree children and tracks removed/added IDs", async () => {
    const repo = createStaticGoalRepo(GOAL_ID, goal);
    const newChild = makeTask({ id: crypto.randomUUID(), description: "Replacement" });

    const result = await patchPlanSubtree(repo, {
      goalId: GOAL_ID,
      subtreeRootId: ROOT_TASK_ID,
      replacementTasks: [newChild],
    });

    expect(result.success).toBe(true);
    expect(result.removedTaskIds).toContain(CHILD_A_ID);
    expect(result.removedTaskIds).toContain(CHILD_B_ID);
    expect(result.addedTaskIds).toHaveLength(1);
    expect(result.patchedGoal.tasks[0]!.subTasks).toHaveLength(1);
    expect(result.patchedGoal.tasks[0]!.subTasks[0]!.parentId).toBe(ROOT_TASK_ID);
  });
});
