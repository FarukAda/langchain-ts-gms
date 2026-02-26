import { QdrantClient } from "@qdrant/qdrant-js";
import { loadEnv } from "../../config/env.js";

/** Default Qdrant collection name for goal embeddings and hierarchical task data. */
export const GOALS_COLLECTION = "gms_goals";
/** Default Qdrant collection name for capability embeddings used in semantic task matching. */
export const CAPABILITIES_COLLECTION = "gms_capabilities";

const PAYLOAD_INDEX_FIELDS = [
  { field_name: "metadata.status", field_schema: "keyword" as const },
  { field_name: "metadata.priority", field_schema: "keyword" as const },
  { field_name: "metadata.tenant_id", field_schema: "keyword" as const },
  { field_name: "metadata.goal_id", field_schema: "keyword" as const },
  { field_name: "metadata.parent_goal_id", field_schema: "keyword" as const },
];

/** Connection configuration for a Qdrant vector store client. */
export interface QdrantClientConfig {
  url: string;
  apiKey?: string;
}

/** Creates a new Qdrant client using explicit config or environment defaults. */
export function createQdrantClient(config?: Partial<QdrantClientConfig>): QdrantClient {
  const env = loadEnv();
  const opts: { url: string; apiKey?: string } = {
    url: config?.url ?? env.QDRANT_URL,
  };
  const apiKey = config?.apiKey ?? env.QDRANT_API_KEY;
  if (apiKey) opts.apiKey = apiKey;
  return new QdrantClient(opts);
}

// ---------------------------------------------------------------------------
// Shared singleton — avoids creating a new TCP connection per repository
// ---------------------------------------------------------------------------

let _sharedClient: QdrantClient | null = null;
let _sharedUrl: string | null = null;

/**
 * Returns a shared QdrantClient singleton. If the effective URL changes
 * (e.g. after `resetEnv()`), the old client is discarded.
 */
export function getSharedQdrantClient(config?: Partial<QdrantClientConfig>): QdrantClient {
  const env = loadEnv();
  const effectiveUrl = config?.url ?? env.QDRANT_URL;
  if (_sharedClient && _sharedUrl === effectiveUrl) {
    return _sharedClient;
  }
  _sharedClient = createQdrantClient(config);
  _sharedUrl = effectiveUrl;
  return _sharedClient;
}

/** Reset the shared client — for test teardown (same pattern as `resetEnv()`). */
export function resetSharedQdrantClient(): void {
  _sharedClient = null;
  _sharedUrl = null;
}

/**
 * Ensures collections exist and creates payload indexes for filtered search.
 * Idempotent: safe to call on every startup.
 */
export async function bootstrapQdrantCollections(
  client: QdrantClient,
  vectorSize: number,
): Promise<void> {
  const collections = await client.getCollections();
  const names = new Set(collections.collections.map((c) => c.name));

  for (const name of [GOALS_COLLECTION, CAPABILITIES_COLLECTION]) {
    if (!names.has(name)) {
      await client.createCollection(name, {
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      });
    }

    for (const { field_name, field_schema } of PAYLOAD_INDEX_FIELDS) {
      try {
        await client.createPayloadIndex(name, {
          field_name,
          field_schema: { type: field_schema },
          wait: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("already exists") && !msg.includes("AlreadyExists")) {
          throw e;
        }
      }
    }
  }
}
