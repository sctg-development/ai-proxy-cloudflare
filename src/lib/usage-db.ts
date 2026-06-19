// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// KeypoolLive Usage Database - KV-backed storage for shared usage statistics
// Compatible with apps/vscode/src/core/keypoollive/KeypoolUsageDb.ts format
//
// OPTIMIZED FOR CLOUDFLARE WORKERS FREE TIER:
// - Uses 1 KV write per hour per (user, provider, keyOwner, keyHint) combination
// - Reduces writes from N (per request) to ~N/period (per hour bucket)
// - Free tier: 1000 writes/day, 1 write/second per key

import { extractBearerToken } from "./auth";

/**
 * Time granularity for usage statistics aggregation.
 */
export type UsagePeriod = "hour" | "day" | "week" | "month";

/**
 * Represents a successful API request that consumed tokens from a pooled key.
 * Compatible with KeyUsageEntry from KeypoolUsageDb.ts
 */
export interface KeyUsageEntry {
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
}

/**
 * Represents a failed API key request associated with a pooled key.
 * Compatible with KeyErrorEntry from KeypoolUsageDb.ts
 */
export interface KeyErrorEntry {
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	errorCode: number | null;
}

/**
 * Aggregated usage statistics for one key within one period bucket.
 * Compatible with KeyUsageStat from KeypoolUsageDb.ts
 */
export interface KeyUsageStat {
	period: string;
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
	requestCount: number;
}

/**
 * Result returned when migrating usage NDJSON into KV.
 */
export interface MigrateResult {
	inserted: number;
	duplicates: number;
}

/**
 * Aggregated error statistics for one key over the retained error history.
 * Compatible with KeyErrorStat from KeypoolUsageDb.ts
 */
export interface KeyErrorStat {
	provider: string;
	keyOwner: string;
	keyHint: string;
	totalRequests: number;
	errorCount: number;
	errorRate: number;
	lastErrorCode: number | null;
}

// ─── Internal record shapes ───────────────────────────────────────────────────

/**
 * Aggregated usage record stored in KV.
 * One record per hour bucket, updated atomically.
 */
interface AggregatedUsageRecord {
	period: string;
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
	requestCount: number;
}

/**
 * Aggregated error record stored in KV.
 * One record per hour bucket, updated atomically.
 */
interface AggregatedErrorRecord {
	period: string;
	provider: string;
	keyOwner: string;
	keyHint: string;
	errorCount: number;
	lastErrorCode: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n: number): string {
	return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
	return n.toString().padStart(3, "0");
}

function utcWeek(d: Date): number {
	const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000 / 7);
}

/**
 * Get the current hour bucket label for KV key.
 * Format: YYYY-MM-DDTHH:00
 */
function getHourBucketLabel(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}:00`;
}

function formatPeriodLabel(ts: number, period: UsagePeriod): string {
	const d = new Date(ts);
	switch (period) {
		case "hour":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:00`;
		case "day":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
		case "week":
			return `${d.getUTCFullYear()}-W${pad2(utcWeek(d))}`;
		case "month":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
	}
}

function periodCutoffMs(period: UsagePeriod): number {
	const now = Date.now();
	switch (period) {
		case "hour":
			return now - 24 * 60 * 60 * 1000;
		case "day":
			return now - 24 * 60 * 60 * 1000;
		case "week":
			return now - 7 * 24 * 60 * 60 * 1000;
		case "month":
			return now - 30 * 24 * 60 * 60 * 1000;
	}
}

// ─── KV Storage Operations ───────────────────────────────────────────────────

/**
 * KV key prefix for aggregated usage records.
 * Format: usage:{userId}:{hour}:{provider}:{keyOwner}:{keyHint}
 * One key per hour per combination, updated atomically.
 */
const USAGE_KEY_PREFIX = "usage";

/**
 * KV key prefix for aggregated error records.
 * Format: errors:{userId}:{hour}:{provider}:{keyOwner}:{keyHint}
 * One key per hour per combination, updated atomically.
 */
const ERRORS_KEY_PREFIX = "errors";

/**
 * Maximum number of records to return in a single stats query.
 * Free tier KV can handle this without issues.
 */
const MAX_RECORDS_PER_QUERY = 10000;

/**
 * Get the user ID from the Authorization header.
 * Uses the Bearer token as the user identifier.
 */
export function getUserIdFromAuth(authHeader: string | null): string | null {
	const token = extractBearerToken(authHeader);
	if (!token) return null;
	// Use the full token as user ID (it's already a secret)
	return token;
}

/**
 * Generate a KV key for an aggregated usage record.
 * Format: usage:{userId}:{hour}:{provider}:{keyOwner}:{keyHint}
 */
function makeUsageKey(
	userId: string,
	period: string,
	provider: string,
	keyOwner: string,
	keyHint: string,
): string {
	// Sanitize keyHint to be KV-safe (replace : and / with _)
	const safeKeyHint = keyHint.replace(/[:/]/g, "_");
	return `${USAGE_KEY_PREFIX}:${userId}:${period}:${provider}:${keyOwner}:${safeKeyHint}`;
}

/**
 * Generate a KV key for an aggregated error record.
 * Format: errors:{userId}:{hour}:{provider}:{keyOwner}:{keyHint}
 */
function makeErrorKey(
	userId: string,
	period: string,
	provider: string,
	keyOwner: string,
	keyHint: string,
): string {
	// Sanitize keyHint to be KV-safe (replace : and / with _)
	const safeKeyHint = keyHint.replace(/[:/]/g, "_");
	return `${ERRORS_KEY_PREFIX}:${userId}:${period}:${provider}:${keyOwner}:${safeKeyHint}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Record a successful API key usage event.
 * Uses atomic read-modify-write to aggregate in hourly buckets.
 * Called by the SDK after a successful request.
 */
export async function recordUsage(
	kv: KVNamespace,
	userId: string,
	entry: KeyUsageEntry,
): Promise<void> {
	const period = getHourBucketLabel();
	const key = makeUsageKey(userId, period, entry.provider, entry.keyOwner, entry.keyHint);

	try {
		// Atomic read-modify-write with retry
		let record: AggregatedUsageRecord | null = null;
		let attempts = 0;
		const maxAttempts = 3;

		while (attempts < maxAttempts) {
			// Read existing record
			const existing = await kv.get(key, "json");
			if (existing && typeof existing === "object") {
				record = existing as AggregatedUsageRecord;
			} else {
				record = {
					period,
					provider: entry.provider,
					modelId: entry.modelId,
					keyOwner: entry.keyOwner,
					keyHint: entry.keyHint,
					promptTokens: 0,
					completionTokens: 0,
					requestCount: 0,
				};
			}

			// Update counters
			record.promptTokens += entry.promptTokens;
			record.completionTokens += entry.completionTokens;
			record.requestCount += 1;

			// Write back
			try {
				await kv.put(key, JSON.stringify(record));
				return; // Success
			} catch (e) {
				attempts++;
				if (attempts >= maxAttempts) {
					console.error("[usage-db] Failed to record usage after retries:", e);
				}
				// Small delay before retry to reduce race condition
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
	} catch (e) {
		console.error("[usage-db] Failed to record usage:", e);
	}
}

/**
 * Record a failed API key request.
 * Uses atomic read-modify-write to aggregate in hourly buckets.
 * Called by the SDK after a failed request.
 */
export async function recordError(
	kv: KVNamespace,
	userId: string,
	entry: KeyErrorEntry,
): Promise<void> {
	const period = getHourBucketLabel();
	const key = makeErrorKey(userId, period, entry.provider, entry.keyOwner, entry.keyHint);

	try {
		// Atomic read-modify-write with retry
		let record: AggregatedErrorRecord | null = null;
		let attempts = 0;
		const maxAttempts = 3;

		while (attempts < maxAttempts) {
			// Read existing record
			const existing = await kv.get(key, "json");
			if (existing && typeof existing === "object") {
				record = existing as AggregatedErrorRecord;
			} else {
				record = {
					period,
					provider: entry.provider,
					keyOwner: entry.keyOwner,
					keyHint: entry.keyHint,
					errorCount: 0,
					lastErrorCode: null,
				};
			}

			// Update counters
			record.errorCount += 1;
			if (entry.errorCode !== null) {
				record.lastErrorCode = entry.errorCode;
			}

			// Write back
			try {
				await kv.put(key, JSON.stringify(record));
				return; // Success
			} catch (e) {
				attempts++;
				if (attempts >= maxAttempts) {
					console.error("[usage-db] Failed to record error after retries:", e);
				}
				// Small delay before retry to reduce race condition
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
	} catch (e) {
		console.error("[usage-db] Failed to record error:", e);
	}
}

interface UsageNdjsonRecord extends KeyUsageEntry {
	ts: number;
}

interface ErrorNdjsonRecord extends KeyErrorEntry {
	ts: number;
}

/**
 * Migrate a usage NDJSON payload into KV for the authenticated user.
 * Uses hourly buckets with raw NDJSON lines stored in arrays.
 */
export async function migrateUsageNdjson(
	kv: KVNamespace,
	userId: string,
	body: string,
	startline?: number,
	endline?: number,
): Promise<MigrateResult> {
	// Group records by hour period
	const hourlyRecords = new Map<string, UsageNdjsonRecord[]>();

	// Split body into lines
	const lines = body.split(/\r?\n/);

	// Determine the range of lines to process
	const start = startline !== undefined ? Math.max(0, startline - 1) : 0; // Convert to 0-based index
	const end = endline !== undefined ? Math.min(lines.length - 1, endline - 1) : lines.length - 1; // Convert to 0-based index

	for (let i = start; i <= end; i++) {
		const rawLine = lines[i];
		const line = rawLine.trim();
		if (!line) continue;

		let record: UsageNdjsonRecord;
		try {
			record = JSON.parse(line) as UsageNdjsonRecord;
		} catch {
			continue;
		}

		if (
			!record.provider ||
			!record.modelId ||
			!record.keyOwner ||
			!record.keyHint ||
			typeof record.promptTokens !== "number" ||
			typeof record.completionTokens !== "number" ||
			typeof record.ts !== "number"
		) {
			continue;
		}

		const period = formatPeriodLabel(record.ts, "hour");
		const existing = hourlyRecords.get(period) || [];
		existing.push(record);
		hourlyRecords.set(period, existing);
	}

	let inserted = 0;
	let duplicates = 0;

	// Process each hour bucket with rate limiting
	for (const [period, records] of hourlyRecords) {
		const kvKey = `usage:${userId}:${period}`;

		try {
			// Read existing records for this hour
			const existingData = await kv.get(kvKey, "json");
			const existingRecords = Array.isArray(existingData) ? existingData : [];

			// Merge with new records
			const updatedRecords = [...existingRecords, ...records];

			// Write with retry mechanism
			let attempts = 0;
			const maxAttempts = 3;
			let success = false;

			while (attempts < maxAttempts && !success) {
				try {
					await kv.put(kvKey, JSON.stringify(updatedRecords));
					inserted += 1;
					success = true;
				} catch (e) {
					attempts++;
					if (attempts >= maxAttempts) {
						console.error(`[usage-db] Failed to migrate usage for period ${period} after retries:`, e);
						duplicates += 1; // Treat as duplicate if we can't write
					} else {
						// Small delay before retry
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				}
			}

			// Rate limiting: wait between writes to different keys
			if (hourlyRecords.size > 1) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		} catch (e) {
			console.error(`[usage-db] Failed to process usage for period ${period}:`, e);
			duplicates += 1;
		}
	}

	return { inserted, duplicates };
}

/**
 * Migrate an error NDJSON payload into KV for the authenticated user.
 * Uses hourly buckets with raw NDJSON lines stored in arrays.
 */
export async function migrateErrorNdjson(
	kv: KVNamespace,
	userId: string,
	body: string,
	startline?: number,
	endline?: number,
): Promise<MigrateResult> {
	// Group records by hour period
	const hourlyRecords = new Map<string, ErrorNdjsonRecord[]>();

	// Split body into lines
	const lines = body.split(/\r?\n/);

	// Determine the range of lines to process
	const start = startline !== undefined ? Math.max(0, startline - 1) : 0; // Convert to 0-based index
	const end = endline !== undefined ? Math.min(lines.length - 1, endline - 1) : lines.length - 1; // Convert to 0-based index

	for (let i = start; i <= end; i++) {
		const rawLine = lines[i];
		const line = rawLine.trim();
		if (!line) continue;

		let record: ErrorNdjsonRecord;
		try {
			record = JSON.parse(line) as ErrorNdjsonRecord;
		} catch {
			continue;
		}

		if (
			!record.provider ||
			!record.modelId ||
			!record.keyOwner ||
			!record.keyHint ||
			(typeof record.errorCode !== "number" && record.errorCode !== null) ||
			typeof record.ts !== "number"
		) {
			continue;
		}

		const period = formatPeriodLabel(record.ts, "hour");
		const existing = hourlyRecords.get(period) || [];
		existing.push(record);
		hourlyRecords.set(period, existing);
	}

	let inserted = 0;
	let duplicates = 0;

	// Process each hour bucket with rate limiting
	for (const [period, records] of hourlyRecords) {
		const kvKey = `errors:${userId}:${period}`;

		try {
			// Read existing records for this hour
			const existingData = await kv.get(kvKey, "json");
			const existingRecords = Array.isArray(existingData) ? existingData : [];

			// Merge with new records
			const updatedRecords = [...existingRecords, ...records];

			// Write with retry mechanism
			let attempts = 0;
			const maxAttempts = 3;
			let success = false;

			while (attempts < maxAttempts && !success) {
				try {
					await kv.put(kvKey, JSON.stringify(updatedRecords));
					inserted += 1;
					success = true;
				} catch (e) {
					attempts++;
					if (attempts >= maxAttempts) {
						console.error(`[usage-db] Failed to migrate errors for period ${period} after retries:`, e);
						duplicates += 1; // Treat as duplicate if we can't write
					} else {
						// Small delay before retry
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				}
			}

			// Rate limiting: wait between writes to different keys
			if (hourlyRecords.size > 1) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		} catch (e) {
			console.error(`[usage-db] Failed to process errors for period ${period}:`, e);
			duplicates += 1;
		}
	}

	return { inserted, duplicates };
}

/**
 * Get usage statistics grouped by period, provider, owner, and key hint.
 * Reads raw hourly NDJSON arrays and aggregates them by requested period.
 * Compatible with KeypoolUsageDb.getUsageStats()
 */
export async function getUsageStats(
	kv: KVNamespace,
	userId: string,
	period: UsagePeriod,
): Promise<KeyUsageStat[]> {
	const cutoff = periodCutoffMs(period);
	const map = new Map<string, KeyUsageStat>();

	try {
		// List all usage keys for this user (new format: usage:{userId}:YYYY-MM-DDTHH:00)
		const listResult = await kv.list({
			prefix: `usage:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		// Process each hour bucket
		for (const kvKey of listResult.keys) {
			// Parse period from key: usage:{userId}:YYYY-MM-DDTHH:00
			const keyParts = kvKey.name.split(":");
			if (keyParts.length < 4) continue;

			// Reconstruct the full period: YYYY-MM-DDTHH:00
			const recordPeriod = `${keyParts[2]}:${keyParts[3]}`; // Combine HH and :00
			const recordDate = parseHourBucket(recordPeriod);
			if (recordDate < cutoff) continue;

			// Get the array of raw records for this hour
			const value = await kv.get(kvKey.name, "json");
			if (!Array.isArray(value)) continue;

			// Aggregate all records in this hour bucket
			for (const record of value) {
				if (
					!record.provider ||
					!record.modelId ||
					!record.keyOwner ||
					!record.keyHint ||
					typeof record.promptTokens !== "number" ||
					typeof record.completionTokens !== "number"
				) {
					continue;
				}

				// Group by requested period
				const label = formatPeriodLabel(recordDate, period);
				const mapKey = `${label}\x00${record.provider}\x00${record.keyOwner}\x00${record.keyHint}`;
				const existing = map.get(mapKey);

				if (existing) {
					existing.promptTokens += record.promptTokens;
					existing.completionTokens += record.completionTokens;
					existing.requestCount += 1;
				} else {
					map.set(mapKey, {
						period: label,
						provider: record.provider,
						modelId: record.modelId,
						keyOwner: record.keyOwner,
						keyHint: record.keyHint,
						promptTokens: record.promptTokens,
						completionTokens: record.completionTokens,
						requestCount: 1,
					});
				}
			}
		}
	} catch (e) {
		console.error("[usage-db] Failed to get usage stats:", e);
	}

	// Sort: period DESC, provider, keyOwner, keyHint (mirrors old SQL ORDER BY)
	return Array.from(map.values()).sort((a, b) => {
		if (b.period !== a.period) return b.period.localeCompare(a.period);
		if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
		if (a.keyOwner !== b.keyOwner) return a.keyOwner.localeCompare(b.keyOwner);
		if (a.modelId !== b.modelId) return a.modelId.localeCompare(b.modelId);
		return a.keyHint.localeCompare(b.keyHint);
	});
}

/**
 * Parse an hour bucket label to a timestamp.
 * Format: YYYY-MM-DDTHH:00
 */
function parseHourBucket(label: string): number {
	const match = label.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/);
	if (!match) return 0;
	const [, year, month, day, hour] = match;
	return Date.UTC(
		parseInt(year, 10),
		parseInt(month, 10) - 1,
		parseInt(day, 10),
		parseInt(hour, 10),
	);
}

/**
 * Get error statistics grouped by provider, owner, and key hint.
 * Reads raw hourly NDJSON arrays and aggregates error rates.
 * Compatible with KeypoolUsageDb.getErrorStats()
 */
export async function getErrorStats(
	kv: KVNamespace,
	userId: string,
): Promise<KeyErrorStat[]> {
	const errorMap = new Map<string, {
		provider: string;
		keyOwner: string;
		keyHint: string;
		errorCount: number;
		lastErrorCode: number | null;
	}>();
	const usageMap = new Map<string, number>();

	try {
		// Get usage counts from raw hourly records (new format: usage:{userId}:YYYY-MM-DDTHH:00)
		const usageList = await kv.list({
			prefix: `usage:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of usageList.keys) {
			const value = await kv.get(kvKey.name, "json");
			if (!Array.isArray(value)) continue;

			// Count requests in this hour bucket
			for (const record of value) {
				if (
					!record.provider ||
					!record.keyOwner ||
					!record.keyHint
				) {
					continue;
				}

				const key = `${record.provider}\x00${record.keyOwner}\x00${record.keyHint}`;
				usageMap.set(key, (usageMap.get(key) ?? 0) + 1);
			}
		}

		// Get error counts from raw hourly records (new format: errors:{userId}:YYYY-MM-DDTHH:00)
		const errorList = await kv.list({
			prefix: `errors:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of errorList.keys) {
			const value = await kv.get(kvKey.name, "json");
			if (!Array.isArray(value)) continue;

			// Aggregate errors in this hour bucket
			for (const record of value) {
				if (
					!record.provider ||
					!record.keyOwner ||
					!record.keyHint ||
					(typeof record.errorCode !== "number" && record.errorCode !== null)
				) {
					continue;
				}

				const key = `${record.provider}\x00${record.keyOwner}\x00${record.keyHint}`;
				const existing = errorMap.get(key);

				if (existing) {
					existing.errorCount += 1;
					if (record.errorCode !== null) {
						existing.lastErrorCode = record.errorCode;
					}
				} else {
					errorMap.set(key, {
						provider: record.provider,
						keyOwner: record.keyOwner,
						keyHint: record.keyHint,
						errorCount: 1,
						lastErrorCode: record.errorCode,
					});
				}
			}
		}
	} catch (e) {
		console.error("[usage-db] Failed to get error stats:", e);
	}

	const result: KeyErrorStat[] = [];
	for (const [, e] of errorMap) {
		const totalRequests = usageMap.get(`${e.provider}\x00${e.keyOwner}\x00${e.keyHint}`) ?? 0;
		result.push({
			provider: e.provider,
			keyOwner: e.keyOwner,
			keyHint: e.keyHint,
			totalRequests,
			errorCount: e.errorCount,
			errorRate: e.errorCount / Math.max(totalRequests, 1),
			lastErrorCode: e.lastErrorCode,
		});
	}

	// Sort by descending error rate
	return result.sort((a, b) => b.errorRate - a.errorRate);
}

/**
 * Delete all usage and error records for a user.
 * Compatible with KeypoolUsageDb.purge()
 */
export async function purge(
	kv: KVNamespace,
	userId: string,
): Promise<number> {
	let freed = 0;

	try {
		// Delete all usage records (new format: usage:{userId}:YYYY-MM-DDTHH:00)
		const usageList = await kv.list({
			prefix: `usage:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of usageList.keys) {
			const value = await kv.get(kvKey.name);
			if (value) freed += value.length;
			await kv.delete(kvKey.name);
		}

		// Delete all error records (new format: errors:{userId}:YYYY-MM-DDTHH:00)
		const errorList = await kv.list({
			prefix: `errors:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of errorList.keys) {
			const value = await kv.get(kvKey.name);
			if (value) freed += value.length;
			await kv.delete(kvKey.name);
		}
	} catch (e) {
		console.error("[usage-db] Failed to purge:", e);
	}

	return freed;
}

/**
 * Get the total size of usage/error records for a user.
 * Compatible with KeypoolUsageDb.getFileSizeBytes()
 */
export async function getFileSizeBytes(
	kv: KVNamespace,
	userId: string,
): Promise<number> {
	let total = 0;

	try {
		// Get usage records (new format: usage:{userId}:YYYY-MM-DDTHH:00)
		const usageList = await kv.list({
			prefix: `usage:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of usageList.keys) {
			const value = await kv.get(kvKey.name);
			if (value) total += value.length;
		}

		// Get error records (new format: errors:{userId}:YYYY-MM-DDTHH:00)
		const errorList = await kv.list({
			prefix: `errors:${userId}:`,
			limit: MAX_RECORDS_PER_QUERY,
		});

		for (const kvKey of errorList.keys) {
			const value = await kv.get(kvKey.name);
			if (value) total += value.length;
		}
	} catch (e) {
		console.error("[usage-db] Failed to get file size:", e);
	}

	return total;
}
