/**
 * Domain error for optimistic-locking conflicts.
 *
 * Thrown when a goal's stored `_version` does not match the version the
 * caller expected, indicating another writer modified the goal concurrently.
 */
export class ConcurrentModificationError extends Error {
  readonly code = "GMS_CONCURRENT_MODIFICATION" as const;
  readonly goalId: string;
  readonly expectedVersion: number;

  constructor(goalId: string, expectedVersion: number) {
    super(
      `[GMS_CONCURRENT_MODIFICATION] Goal ${goalId} was modified concurrently ` +
        `(expected version ${expectedVersion}). Re-read and retry.`,
    );
    this.name = "ConcurrentModificationError";
    this.goalId = goalId;
    this.expectedVersion = expectedVersion;
  }
}
