import { describe, it, expect, vi, beforeEach } from "vitest";
import { migrateUsageNdjson } from "../src/lib/usage-db";

describe("migrateUsageNdjson duplicate detection", () => {
  // Mock KV namespace
  const mockData: Record<string, any> = {};

  const mockKV: any = {
    get: vi.fn((key: string, type?: string) => {
      if (type === "json") {
        // Cloudflare KV automatically parses JSON when type is "json"
        return Promise.resolve(mockData[key] ? JSON.parse(mockData[key]) : []);
      }
      return Promise.resolve(mockData[key] || JSON.stringify([]));
    }),
    put: vi.fn((key: string, value: string) => {
      mockData[key] = value;
      return Promise.resolve();
    }),
    list: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear mock data
    for (const key in mockData) {
      delete mockData[key];
    }
  });

  it("should detect duplicates when same data is migrated twice", async () => {
    const userId = "test-user";
    const testData = `{"ts":1780690689852,"provider":"cohere","modelId":"command-a-plus-05-2026","keyOwner":"test@example.com","keyHint":"test-key","promptTokens":100,"completionTokens":50}
{"ts":1780690689853,"provider":"mistral","modelId":"mistral-medium-latest","keyOwner":"test@example.com","keyHint":"test-key-2","promptTokens":200,"completionTokens":100}`;

    // First migration - should insert 2 records
    const firstResult = await migrateUsageNdjson(mockKV, userId, testData);
    expect(firstResult.inserted).toBe(2);
    expect(firstResult.duplicates).toBe(0);

    // Second migration with same data - should detect duplicates
    const secondResult = await migrateUsageNdjson(mockKV, userId, testData);
    expect(secondResult.inserted).toBe(0);
    expect(secondResult.duplicates).toBe(2);
  });

  it("should handle mixed new and duplicate records", async () => {
    const userId = "test-user";
    const firstData = `{"ts":1780690689852,"provider":"cohere","modelId":"command-a-plus-05-2026","keyOwner":"test@example.com","keyHint":"test-key","promptTokens":100,"completionTokens":50}`;
    const secondData = `${firstData}
{"ts":1780690689853,"provider":"mistral","modelId":"mistral-medium-latest","keyOwner":"test@example.com","keyHint":"test-key-2","promptTokens":200,"completionTokens":100}`;

    // First migration
    const firstResult = await migrateUsageNdjson(mockKV, userId, firstData);
    expect(firstResult.inserted).toBe(1);
    expect(firstResult.duplicates).toBe(0);

    // Second migration with one duplicate and one new record
    const secondResult = await migrateUsageNdjson(mockKV, userId, secondData);
    expect(secondResult.inserted).toBe(1); // Only the new record
    expect(secondResult.duplicates).toBe(1); // The duplicate record
  });
});
