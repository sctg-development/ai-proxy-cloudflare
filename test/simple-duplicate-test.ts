import { migrateUsageNdjson } from "../src/lib/usage-db";

// Simple test to debug the duplicate detection
async function testDuplicateDetection() {
  // Create a simple mock KV
  const mockData: Record<string, any> = {};

  const mockKV: any = {
    get: async (key: string, type?: string) => {
      console.log(`GET called with key: ${key}, type: ${type}`);
      if (type === "json") {
        // Cloudflare KV automatically parses JSON when type is "json"
        return mockData[key] ? JSON.parse(mockData[key]) : [];
      }
      return mockData[key] || JSON.stringify([]);
    },
    put: async (key: string, value: string) => {
      console.log(`PUT called with key: ${key}, value: ${value}`);
      mockData[key] = value;
    }
  };

  const userId = "test-user";
  const testData = `{"ts":1780690689852,"provider":"cohere","modelId":"command-a-plus-05-2026","keyOwner":"test@example.com","keyHint":"test-key","promptTokens":100,"completionTokens":50}
{"ts":1780690689853,"provider":"mistral","modelId":"mistral-medium-latest","keyOwner":"test@example.com","keyHint":"test-key-2","promptTokens":200,"completionTokens":100}`;

  console.log("=== First migration ===");
  const firstResult = await migrateUsageNdjson(mockKV, userId, testData);
  console.log("First result:", firstResult);
  console.log("Mock data after first migration:", mockData);

  console.log("\n=== Second migration (same data) ===");
  const secondResult = await migrateUsageNdjson(mockKV, userId, testData);
  console.log("Second result:", secondResult);
  console.log("Mock data after second migration:", mockData);

  console.log("\n=== Expected results ===");
  console.log("First migration should have: inserted=2, duplicates=0");
  console.log("Second migration should have: inserted=0, duplicates=2");
}

testDuplicateDetection().catch(console.error);
