import type { GmsToolDeps } from "../types.js";
import type { Goal } from "../../domain/contracts.js";
import type { GoalSearchFilter } from "../../domain/ports.js";
import { paginate } from "../helpers.js";

// ---------------------------------------------------------------------------
// Shared handler payloads
// ---------------------------------------------------------------------------

/** Input for the list-goals handler. */
export interface ListGoalsInput {
  status?: Goal["status"] | undefined;
  priority?: Goal["priority"] | undefined;
  tenantId?: string | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** Summary item returned per goal in the list. */
export interface GoalSummary {
  id: string;
  description: string;
  status: string;
  priority: string;
  tenantId?: string;
  updatedAt?: string;
}

/** Response payload for list-goals. */
export interface ListGoalsResult {
  total: number;
  limit: number;
  offset: number;
  items: GoalSummary[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleListGoals(
  deps: GmsToolDeps,
  input: ListGoalsInput,
): Promise<ListGoalsResult> {
  const lim = input.limit ?? 50;
  const off = input.offset ?? 0;
  const filter: GoalSearchFilter = {
    ...(input.status !== undefined && { status: input.status }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
  };
  const hasFilter = Object.keys(filter).length > 0;

  let items: Goal[];
  let total: number;

  if (input.query && input.query.trim().length > 0) {
    const searched = await deps.goalRepository.search(input.query, {
      k: Math.min(lim + off, 200),
      ...(hasFilter && { filter }),
    });
    items = searched.map((r) => r.goal);
    total = items.length;
  } else {
    const listed = await deps.goalRepository.listWithTotal({
      limit: lim,
      offset: off,
      ...(hasFilter && { filter }),
    });
    total = listed.total;
    items = listed.items;
  }

  const page =
    input.query && input.query.trim().length > 0 ? paginate(items, lim, off) : { items, total };

  return {
    total: page.total,
    limit: lim,
    offset: off,
    items: page.items.map((g) => ({
      id: g.id,
      description: g.description,
      status: g.status,
      priority: g.priority,
      ...(g.tenantId !== undefined && { tenantId: g.tenantId }),
      ...(g.updatedAt !== undefined && { updatedAt: g.updatedAt }),
    })),
  };
}
