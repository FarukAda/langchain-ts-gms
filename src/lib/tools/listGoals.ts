import { tool } from "@langchain/core/tools";
import { ListGoalsInputSchema, coerceLifecycleInput, DEFAULT_PAGE_LIMIT } from "../schemas/lifecycleSchemas.js";
import { paginate, stripNulls, wrapToolResponse } from "../helpers.js";
import type { GmsToolDeps } from "../types.js";
import type { Goal } from "../../domain/contracts.js";

export const createListGoalsTool = (deps: GmsToolDeps) =>
  tool(
    async (rawInput) => {
      const input = stripNulls(coerceLifecycleInput(rawInput));
      const lim = Number(input.limit) || DEFAULT_PAGE_LIMIT;
      const off = Number(input.offset) || 0;
      const filter = {
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
        input.query && input.query.trim().length > 0
          ? paginate(items, lim, off)
          : { items, total };
      return wrapToolResponse({
        total: page.total,
        limit: lim,
        offset: off,
        items: page.items.map((g) => ({
          id: g.id,
          description: g.description,
          status: g.status,
          priority: g.priority,
          tenantId: g.tenantId,
          updatedAt: g.updatedAt,
        })),
      });
    },
    {
      name: "gms_list_goals",
      description:
        "List or search goals with optional filters and pagination. " +
        "Without a query: returns all goals (filtered by status/priority/tenantId). " +
        "With a query string: performs semantic similarity search against goal descriptions. " +
        "Returns paginated JSON: { total, limit, offset, items[] }. " +
        "Each item includes: id, description, status, priority, tenantId, updatedAt.",
      schema: ListGoalsInputSchema,
    },
  );
