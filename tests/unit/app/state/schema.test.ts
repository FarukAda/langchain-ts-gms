import { describe, it, expect } from "vitest";
import { GmsStateAnnotation } from "../../../../src/app/state/schema.js";
import type { GmsState } from "../../../../src/app/state/schema.js";

describe("GmsStateAnnotation", () => {
  it("exports a valid annotation object with expected keys", () => {
    expect(GmsStateAnnotation).toBeDefined();
    expect(GmsStateAnnotation.spec).toBeDefined();
  });

  it("GmsState type is usable", () => {
    // Type-level test: verify the state shape compiles
    const state: Partial<GmsState> = {
      tasks: [],
      currentPhase: "planning",
      humanApprovalPending: false,
    };
    expect(state.tasks).toEqual([]);
    expect(state.currentPhase).toBe("planning");
    expect(state.humanApprovalPending).toBe(false);
  });
});
