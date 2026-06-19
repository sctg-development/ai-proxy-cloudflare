import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUsageStats } from "../src/lib/usage-db";

describe("getUsageStats bug fix", () => {
  // Mock KV namespace
  const mockData: Record<string, any> = {};

  const mockKV: any = {
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      // Return mock keys that match the prefix
      const keys = Object.keys(mockData).filter(key => key.startsWith(prefix));
      return {
        keys: keys.map(name => ({ name })),
        list_complete: true
      };
    }),
    get: vi.fn(async (key: string, type?: string) => {
      if (type === "json") {
        return mockData[key] ? JSON.parse(mockData[key]) : [];
      }
      return mockData[key] || null;
    })
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear mock data
    for (const key in mockData) {
      delete mockData[key];
    }
  });

    it("should correctly parse KV keys with format usage:userId:YYYY-MM-DDTHH:00", async () => {
      const userId = "user-anonymized-1";

      // Add test data - key format: usage:userId:2026-06-05T20:00
      const testKey = `usage:${userId}:2026-06-05T20:00`;
      mockData[testKey] = JSON.stringify([
        {
          ts: 1780690689852,
          provider: "cohere",
          modelId: "command-a-plus-05-2026",
          keyOwner: "user-anonymized@example.com",
          keyHint: "***hqCG26wf",
          promptTokens: 0,
          completionTokens: 0
        }
      ]);

    // Mock the list method to return our test key
    mockKV.list.mockResolvedValue({
      keys: [{ name: testKey }],
      list_complete: true
    });

    // Call getUsageStats with period=month
    const result = await getUsageStats(mockKV, userId, "month");

    // Should return 1 record, not an empty array
    expect(result.length).toBe(1);
    expect(result[0].provider).toBe("cohere");
    expect(result[0].modelId).toBe("command-a-plus-05-2026");
    expect(result[0].keyOwner).toBe("user-anonymized@example.com");
    expect(result[0].promptTokens).toBe(0);
    expect(result[0].completionTokens).toBe(0);
    expect(result[0].requestCount).toBe(1);
  });

  it("should handle multiple records and aggregate correctly", async () => {
    const userId = "user-anonymized-2";

    // Add multiple test records
    const testKey1 = `usage:${userId}:2026-06-05T20:00`;
    mockData[testKey1] = JSON.stringify([
      {
        ts: 1780690689852,
        provider: "cohere",
        modelId: "command-a-plus-05-2026",
        keyOwner: "user-anonymized@example.com",
        keyHint: "key1",
        promptTokens: 100,
        completionTokens: 50
      },
      {
        ts: 1780690689853,
        provider: "cohere",
        modelId: "command-a-plus-05-2026",
        keyOwner: "user-anonymized@example.com",
        keyHint: "key1",
        promptTokens: 200,
        completionTokens: 100
      }
    ]);

    const testKey2 = `usage:${userId}:2026-06-06T10:00`;
    mockData[testKey2] = JSON.stringify([
      {
        ts: 1780690689854,
        provider: "mistral",
        modelId: "mistral-medium-latest",
        keyOwner: "user-anonymized@example.com",
        keyHint: "key2",
        promptTokens: 50,
        completionTokens: 25
      }
    ]);

    // Mock the list method to return our test keys
    mockKV.list.mockResolvedValue({
      keys: [{ name: testKey1 }, { name: testKey2 }],
      list_complete: true
    });

    // Call getUsageStats with period=month
    const result = await getUsageStats(mockKV, userId, "month");

    // Should return aggregated results
    expect(result.length).toBe(2);

    // Find the cohere record
    const cohereRecord = result.find(r => r.provider === "cohere");
    expect(cohereRecord).toBeDefined();
    expect(cohereRecord?.promptTokens).toBe(300); // 100 + 200
    expect(cohereRecord?.completionTokens).toBe(150); // 50 + 100
    expect(cohereRecord?.requestCount).toBe(2);

    // Find the mistral record
    const mistralRecord = result.find(r => r.provider === "mistral");
    expect(mistralRecord).toBeDefined();
    expect(mistralRecord?.promptTokens).toBe(50);
    expect(mistralRecord?.completionTokens).toBe(25);
    expect(mistralRecord?.requestCount).toBe(1);
  });
});
