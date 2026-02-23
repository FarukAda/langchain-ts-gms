import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetEnv } from "../../../../src/config/env.js";

// ---------- Mock @qdrant/qdrant-js ----------------------------------------
const mockGetCollections = vi.fn();
const mockCreateCollection = vi.fn();
const mockCreatePayloadIndex = vi.fn();

vi.mock("@qdrant/qdrant-js", () => ({
  QdrantClient: class MockQdrantClient {
    url: string;
    apiKey: string | undefined;
    constructor(opts: { url: string; apiKey?: string }) {
      this.url = opts.url;
      this.apiKey = opts.apiKey;
    }
    getCollections = mockGetCollections;
    createCollection = mockCreateCollection;
    createPayloadIndex = mockCreatePayloadIndex;
  },
}));

const {
  createQdrantClient,
  bootstrapQdrantCollections,
  GOALS_COLLECTION,
  CAPABILITIES_COLLECTION,
} = await import("../../../../src/infra/vector/qdrantClient.js");

describe("qdrantClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
  });

  describe("createQdrantClient", () => {
    it("creates client with env defaults", () => {
      process.env.NODE_ENV = "test";
      process.env.QDRANT_URL = "http://my-qdrant:6333";

      const client = createQdrantClient();
      expect(client).toBeDefined();
      expect((client as unknown as { url: string }).url).toBe(
        "http://my-qdrant:6333",
      );
    });

    it("uses provided config overrides", () => {
      process.env.NODE_ENV = "test";
      const client = createQdrantClient({
        url: "http://custom:1234",
        apiKey: "key-123",
      });
      expect((client as unknown as { url: string }).url).toBe(
        "http://custom:1234",
      );
      expect((client as unknown as { apiKey: string }).apiKey).toBe("key-123");
    });

    it("omits apiKey when not set in env or config", () => {
      process.env.NODE_ENV = "test";
      delete process.env.QDRANT_API_KEY;

      const client = createQdrantClient();
      expect((client as unknown as { apiKey?: string }).apiKey).toBeUndefined();
    });

    it("uses QDRANT_API_KEY from env when set", () => {
      process.env.NODE_ENV = "test";
      process.env.QDRANT_API_KEY = "env-key";

      const client = createQdrantClient();
      expect((client as unknown as { apiKey: string }).apiKey).toBe("env-key");
    });
  });

  describe("bootstrapQdrantCollections", () => {
    it("creates both collections when they do not exist", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockResolvedValue(undefined);

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();
      await bootstrapQdrantCollections(client, 384);

      expect(mockCreateCollection).toHaveBeenCalledTimes(2);
      expect(mockCreateCollection).toHaveBeenCalledWith(
        GOALS_COLLECTION,
        expect.objectContaining({
          vectors: { size: 384, distance: "Cosine" },
        }),
      );
      expect(mockCreateCollection).toHaveBeenCalledWith(
        CAPABILITIES_COLLECTION,
        expect.objectContaining({
          vectors: { size: 384, distance: "Cosine" },
        }),
      );
    });

    it("skips collection creation when collections already exist", async () => {
      mockGetCollections.mockResolvedValue({
        collections: [
          { name: GOALS_COLLECTION },
          { name: CAPABILITIES_COLLECTION },
        ],
      });
      mockCreatePayloadIndex.mockResolvedValue(undefined);

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();
      await bootstrapQdrantCollections(client, 384);

      expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it("creates payload indexes for each collection", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockResolvedValue(undefined);

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();
      await bootstrapQdrantCollections(client, 384);

      // 5 index fields × 2 collections = 10 calls
      expect(mockCreatePayloadIndex).toHaveBeenCalledTimes(10);
    });

    it("tolerates 'already exists' errors on payload indexes", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockRejectedValue(
        new Error("field already exists"),
      );

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();

      // Should NOT throw because the error message contains "already exists"
      await expect(
        bootstrapQdrantCollections(client, 384),
      ).resolves.toBeUndefined();
    });

    it("tolerates 'AlreadyExists' errors on payload indexes", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockRejectedValue(
        new Error("AlreadyExists: some detail"),
      );

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();

      await expect(
        bootstrapQdrantCollections(client, 384),
      ).resolves.toBeUndefined();
    });

    it("rethrows unexpected errors from createPayloadIndex", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockRejectedValue(
        new Error("Connection refused"),
      );

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();

      await expect(
        bootstrapQdrantCollections(client, 384),
      ).rejects.toThrow("Connection refused");
    });

    it("rethrows non-Error thrown values", async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);
      mockCreatePayloadIndex.mockRejectedValue("string error");

      process.env.NODE_ENV = "test";
      const client = createQdrantClient();

      await expect(
        bootstrapQdrantCollections(client, 384),
      ).rejects.toBe("string error");
    });
  });

  describe("constants", () => {
    it("exports expected collection names", () => {
      expect(GOALS_COLLECTION).toBe("gms_goals");
      expect(CAPABILITIES_COLLECTION).toBe("gms_capabilities");
    });
  });
});
