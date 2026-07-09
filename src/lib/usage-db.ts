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
// KeypoolLive Usage Database - SQLite-backed Durable Objects storage
// Compatible with apps/vscode/src/core/keypoollive/KeypoolUsageDb.ts format
//
// OPTIMIZED FOR CLOUDFLARE WORKERS FREE TIER:
// - Uses 1 SQLite row per hour per (user, provider, keyOwner, keyHint) combination
// - Reduces writes from N (per request) to ~N/period (per hour bucket)
// - Free tier: 100,000 DO requests/day, 13,000 GB-s/day, 5 GB storage

import { extractBearerToken } from "./auth";
import { DurableObject } from "cloudflare:workers";

type DurableObjectNamespace = any;
type DurableObjectStub = any;

/**
 * Time granularity for usage statistics aggregation.
 */
export type UsagePeriod = "hour" | "day" | "week" | "month";

/**
 * Granularity for grouping statistics within a period.
 */
export type Granularity = "hour" | "day" | "week" | "month";

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
	ok: boolean;
	inserted: number;
	duplicates: number;
	"created-keys": number;
	"updated-keys": number;
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

/**
 * Pad a number with leading zeros to ensure it has 2 digits.
 * @param n - The number to pad
 * @returns String representation of the number with leading zero if needed
 */
function pad2(n: number): string {
	return n.toString().padStart(2, "0");
}

/**
 * Pad a number with leading zeros to ensure it has 3 digits.
 * @param n - The number to pad
 * @returns String representation of the number with leading zeros if needed
 */
function pad3(n: number): string {
	return n.toString().padStart(3, "0");
}

/**
 * Calculate the ISO week number for a given date.
 * @param d - The date to calculate the week number for
 * @returns ISO week number (1-53)
 */
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

/**
 * Format a timestamp into a period label based on the specified granularity.
 * @param ts - Timestamp in milliseconds
 * @param period - The time granularity (hour, day, week, month)
 * @returns Formatted period label string
 */
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

/**
 * Calculate the cutoff timestamp for filtering records based on the specified period.
 * @param period - The time granularity (hour, day, week, month)
 * @returns Timestamp in milliseconds representing the cutoff point
 */
function periodCutoffMs(period: UsagePeriod): number {
	const now = Date.now();
	switch (period) {
		case "hour":
			return now - 1 * 60 * 60 * 1000;
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
const MAX_RECORDS_PER_QUERY = 1000;

/**
 * Get the user ID from the Authorization header.
 * Uses the Bearer token as the user identifier.
 *
 * @param authHeader - Authorization header value
 * @returns User ID (Bearer token) or null if not present
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

// ─── Durable Object Implementation ─────────────────────────────────────────

/**
 * Durable Object for SQLite-backed usage database.
 * One instance per user, identified by hashed user ID.
 */
export class UsageDbDurableObject extends DurableObject {
	private sql: any;

	constructor(state: DurableObjectState, env: any) {
		super(state, env);
		this.sql = state.storage.sql;
		this.initializeSchema();
	}

	private initializeSchema(): void {
		// Create tables for aggregated usage and errors
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS usage_hourly (
				period_hour TEXT NOT NULL,
				provider TEXT NOT NULL,
				model_id TEXT NOT NULL,
				key_owner TEXT NOT NULL,
				key_hint TEXT NOT NULL,
				prompt_tokens INTEGER NOT NULL DEFAULT 0,
				completion_tokens INTEGER NOT NULL DEFAULT 0,
				request_count INTEGER NOT NULL DEFAULT 0,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (period_hour, provider, model_id, key_owner, key_hint)
			);
		`);

		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS errors_hourly (
				period_hour TEXT NOT NULL,
				provider TEXT NOT NULL,
				model_id TEXT NOT NULL,
				key_owner TEXT NOT NULL,
				key_hint TEXT NOT NULL,
				error_count INTEGER NOT NULL DEFAULT 0,
				last_error_code INTEGER,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (period_hour, provider, model_id, key_owner, key_hint)
			);
		`);

		// Table for idempotent NDJSON migration
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS imported_events (
				event_hash TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				period_hour TEXT NOT NULL,
				imported_at INTEGER NOT NULL
			);
		`);

		// Indexes for faster queries
		this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_usage_hourly_period ON usage_hourly(period_hour);`);
		this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_hourly_period ON errors_hourly(period_hour);`);
	}

	/**
	 * Record a successful API key usage event.
	 */
	async recordUsage(entry: KeyUsageEntry): Promise<void> {
		const period = getHourBucketLabel();
		const now = Date.now();

		this.sql.exec(
			`
			INSERT INTO usage_hourly (
				period_hour,
				provider,
				model_id,
				key_owner,
				key_hint,
				prompt_tokens,
				completion_tokens,
				request_count,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
			ON CONFLICT(period_hour, provider, model_id, key_owner, key_hint)
			DO UPDATE SET
				prompt_tokens = prompt_tokens + excluded.prompt_tokens,
				completion_tokens = completion_tokens + excluded.completion_tokens,
				request_count = request_count + 1,
				updated_at = excluded.updated_at
			`,
			period,
			entry.provider,
			entry.modelId,
			entry.keyOwner,
			entry.keyHint,
			entry.promptTokens,
			entry.completionTokens,
			now,
		);
	}

	/**
	 * Record a failed API key request.
	 */
	async recordError(entry: KeyErrorEntry): Promise<void> {
		const period = getHourBucketLabel();
		const now = Date.now();

		this.sql.exec(
			`
			INSERT INTO errors_hourly (
				period_hour,
				provider,
				model_id,
				key_owner,
				key_hint,
				error_count,
				last_error_code,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, 1, ?, ?)
			ON CONFLICT(period_hour, provider, model_id, key_owner, key_hint)
			DO UPDATE SET
				error_count = error_count + 1,
				last_error_code = COALESCE(excluded.last_error_code, last_error_code),
				updated_at = excluded.updated_at
			`,
			period,
			entry.provider,
			entry.modelId,
			entry.keyOwner,
			entry.keyHint,
			entry.errorCode,
			now,
		);
	}

	/**
	 * Get usage statistics grouped by period and granularity.
	 * @param period - The time period (hour, day, week, month)
	 * @param granularity - The granularity for grouping within the period (hour, day, week, month)
	 */
	async getUsageStats(period: UsagePeriod, granularity?: Granularity): Promise<KeyUsageStat[]> {
		const cutoff = periodCutoffMs(period);
		const cutoffHour = formatPeriodLabel(cutoff, "hour");

		// Use granularity for labeling, fall back to period if not provided
		const labelGranularity = granularity || period;

		// Read hourly records from SQLite
		const cursor = this.sql.exec(
			`SELECT * FROM usage_hourly WHERE period_hour >= ? ORDER BY period_hour DESC`,
			cutoffHour,
		);

		// Aggregate by requested granularity
		const map = new Map<string, KeyUsageStat>();
		for (const row of cursor) {
			const label = formatPeriodLabel(parseHourBucket(row.period_hour), labelGranularity);
			const mapKey = `${label}\x00${row.provider}\x00${row.key_owner}\x00${row.key_hint}`;

			const existing = map.get(mapKey);
			if (existing) {
				existing.promptTokens += row.prompt_tokens;
				existing.completionTokens += row.completion_tokens;
				existing.requestCount += row.request_count;
			} else {
				map.set(mapKey, {
					period: label,
					provider: row.provider,
					modelId: row.model_id,
					keyOwner: row.key_owner,
					keyHint: row.key_hint,
					promptTokens: row.prompt_tokens,
					completionTokens: row.completion_tokens,
					requestCount: row.request_count,
				});
			}
		}

		// Sort: period DESC, provider, keyOwner, keyHint
		return Array.from(map.values()).sort((a, b) => {
			if (b.period !== a.period) return b.period.localeCompare(a.period);
			if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
			if (a.keyOwner !== b.keyOwner) return a.keyOwner.localeCompare(b.keyOwner);
			if (a.keyHint !== b.keyHint) return a.keyHint.localeCompare(b.keyHint);
			return a.modelId.localeCompare(b.modelId);
		});
	}

	/**
	 * Get error statistics grouped by provider, owner, and key hint.
	 */
	async getErrorStats(period: UsagePeriod): Promise<KeyErrorStat[]> {
		const cutoff = periodCutoffMs(period);
		const cutoffHour = formatPeriodLabel(cutoff, "hour");

		// Read usage counts
		const usageCursor = this.sql.exec(
			`SELECT provider, key_owner, key_hint, SUM(request_count) as totalRequests
			 FROM usage_hourly
			 WHERE period_hour >= ?
			 GROUP BY provider, key_owner, key_hint`,
			cutoffHour,
		);

		const usageMap = new Map<string, number>();
		for (const row of usageCursor) {
			const key = `${row.provider}\x00${row.key_owner}\x00${row.key_hint}`;
			usageMap.set(key, row.totalRequests || 0);
		}

		// Read error counts
		const errorCursor = this.sql.exec(
			`SELECT * FROM errors_hourly WHERE period_hour >= ?`,
			cutoffHour,
		);

		const errorMap = new Map<string, { errorCount: number; lastErrorCode: number | null }>();
		for (const row of errorCursor) {
			const key = `${row.provider}\x00${row.key_owner}\x00${row.key_hint}`;
			const existing = errorMap.get(key) || { errorCount: 0, lastErrorCode: null };
			existing.errorCount += row.error_count;
			if (row.last_error_code !== null && row.last_error_code !== undefined) {
				existing.lastErrorCode = row.last_error_code;
			}
			errorMap.set(key, existing);
		}

		// Build result
		const result: KeyErrorStat[] = [];
		for (const [key, e] of errorMap) {
			const [provider, keyOwner, keyHint] = key.split('\x00');
			result.push({
				provider,
				keyOwner,
				keyHint,
				totalRequests: usageMap.get(key) || 0,
				errorCount: e.errorCount,
				errorRate: e.errorCount / Math.max(usageMap.get(key) || 1, 1),
				lastErrorCode: e.lastErrorCode,
			});
		}

		// Sort by descending error rate
		return result.sort((a, b) => b.errorRate - a.errorRate);
	}

	/**
	 * Migrate usage NDJSON payload into SQLite.
	 */
	async migrateUsageNdjson(body: string, startline?: number, endline?: number): Promise<MigrateResult> {
		const lines = body.split(/\r?\n/);
		const start = startline !== undefined ? Math.max(0, startline - 1) : 0;
		const end = endline !== undefined ? Math.min(lines.length - 1, endline - 1) : lines.length - 1;

		let inserted = 0;
		let duplicates = 0;
		let createdKeys = 0;
		let updatedKeys = 0;

		for (let i = start; i <= end; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			try {
				const record = JSON.parse(line) as any;
				if (!record.provider || !record.modelId || !record.keyOwner || !record.keyHint ||
					typeof record.promptTokens !== "number" || typeof record.completionTokens !== "number" ||
					typeof record.ts !== "number") {
					continue;
				}

				// Create unique hash for idempotency
				const hash = await this.createEventHash(
					`${record.ts}:${record.provider}:${record.modelId}:${record.keyOwner}:${record.keyHint}:${record.promptTokens}:${record.completionTokens}`,
					"usage"
				);

				// Check if already imported
				const existing = this.sql.exec(
					`SELECT 1 FROM imported_events WHERE event_hash = ?`,
					hash,
				).toArray();

				if (existing.length > 0) {
					duplicates++;
					continue;
				}

				// Insert into imported_events
				this.sql.exec(
					`INSERT INTO imported_events (event_hash, kind, period_hour, imported_at) VALUES (?, ?, ?, ?)`,
					hash,
					"usage",
					formatPeriodLabel(record.ts, "hour"),
					Date.now(),
				);

				// Aggregate into usage_hourly
				const period = formatPeriodLabel(record.ts, "hour");
				this.sql.exec(
					`
					INSERT INTO usage_hourly (
						period_hour,
						provider,
						model_id,
						key_owner,
						key_hint,
						prompt_tokens,
						completion_tokens,
						request_count,
						updated_at
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
					ON CONFLICT(period_hour, provider, model_id, key_owner, key_hint)
					DO UPDATE SET
						prompt_tokens = prompt_tokens + excluded.prompt_tokens,
						completion_tokens = completion_tokens + excluded.completion_tokens,
						request_count = request_count + 1,
						updated_at = excluded.updated_at
					`,
					period,
					record.provider,
					record.modelId,
					record.keyOwner,
					record.keyHint,
					record.promptTokens,
					record.completionTokens,
					Date.now(),
				);

				inserted++;
			} catch (e) {
				console.error(`[usage-db] Failed to parse usage line ${i}:`, e);
				duplicates++;
			}
		}

		return { ok: true, inserted, duplicates, "created-keys": createdKeys, "updated-keys": updatedKeys };
	}

	/**
	 * Migrate error NDJSON payload into SQLite.
	 */
	async migrateErrorNdjson(body: string, startline?: number, endline?: number): Promise<MigrateResult> {
		const lines = body.split(/\r?\n/);
		const start = startline !== undefined ? Math.max(0, startline - 1) : 0;
		const end = endline !== undefined ? Math.min(lines.length - 1, endline - 1) : lines.length - 1;

		let inserted = 0;
		let duplicates = 0;
		let createdKeys = 0;
		let updatedKeys = 0;

		for (let i = start; i <= end; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			try {
				const record = JSON.parse(line) as any;
				if (!record.provider || !record.modelId || !record.keyOwner || !record.keyHint ||
					(typeof record.errorCode !== "number" && record.errorCode !== null) ||
					typeof record.ts !== "number") {
					continue;
				}

				// Create unique hash for idempotency
				const hash = await this.createEventHash(
					`${record.ts}:${record.provider}:${record.modelId}:${record.keyOwner}:${record.keyHint}:${record.errorCode}`,
					"error"
				);

				// Check if already imported
				const existing = this.sql.exec(
					`SELECT 1 FROM imported_events WHERE event_hash = ?`,
					hash,
				).toArray();

				if (existing.length > 0) {
					duplicates++;
					continue;
				}

				// Insert into imported_events
				this.sql.exec(
					`INSERT INTO imported_events (event_hash, kind, period_hour, imported_at) VALUES (?, ?, ?, ?)`,
					hash,
					"error",
					formatPeriodLabel(record.ts, "hour"),
					Date.now(),
				);

				// Aggregate into errors_hourly
				const period = formatPeriodLabel(record.ts, "hour");
				this.sql.exec(
					`
					INSERT INTO errors_hourly (
						period_hour,
						provider,
						model_id,
						key_owner,
						key_hint,
						error_count,
						last_error_code,
						updated_at
					)
					VALUES (?, ?, ?, ?, ?, 1, ?, ?)
					ON CONFLICT(period_hour, provider, model_id, key_owner, key_hint)
					DO UPDATE SET
						error_count = error_count + 1,
						last_error_code = COALESCE(excluded.last_error_code, last_error_code),
						updated_at = excluded.updated_at
					`,
					period,
					record.provider,
					record.modelId,
					record.keyOwner,
					record.keyHint,
					record.errorCode,
					Date.now(),
				);

				inserted++;
			} catch (e) {
				console.error(`[usage-db] Failed to parse error line ${i}:`, e);
				duplicates++;
			}
		}

		return { ok: true, inserted, duplicates, "created-keys": createdKeys, "updated-keys": updatedKeys };
	}

	/**
	 * Delete all usage and error records for a user.
	 */
	async purge(): Promise<number> {
		// Get approximate size before deletion
		const usageCursor = this.sql.exec(`SELECT COUNT(*) as count FROM usage_hourly`);
		const errorCursor = this.sql.exec(`SELECT COUNT(*) as count FROM errors_hourly`);

		const usageCount = usageCursor.toArray()[0]?.count || 0;
		const errorCount = errorCursor.toArray()[0]?.count || 0;

		// Estimate size: ~200 bytes per row
		const freed = (usageCount + errorCount) * 200;

		// Delete all records
		this.sql.exec(`DELETE FROM usage_hourly`);
		this.sql.exec(`DELETE FROM errors_hourly`);
		this.sql.exec(`DELETE FROM imported_events`);

		return freed;
	}

	/**
	 * Get the total size of usage/error records for a user.
	 */
	async getFileSizeBytes(): Promise<number> {
		// Approximate size calculation
		const usageCursor = this.sql.exec(`SELECT COUNT(*) as count FROM usage_hourly`);
		const errorCursor = this.sql.exec(`SELECT COUNT(*) as count FROM errors_hourly`);

		const usageCount = usageCursor.toArray()[0]?.count || 0;
		const errorCount = errorCursor.toArray()[0]?.count || 0;

		// Estimate ~200 bytes per row
		return (usageCount + errorCount) * 200;
	}

	/**
	 * Create SHA-256 hash of a string for idempotent migration.
	 */
	private async createEventHash(data: string, kind: string): Promise<string> {
		const text = `${kind}:${data}`;
		const encoder = new TextEncoder();
		const encoded = encoder.encode(text);
		const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}
}

/**
 * Parse an hour bucket label to a timestamp.
 * Format: YYYY-MM-DDTHH:00
 *
 * @param label - Hour bucket label string
 * @returns Timestamp in milliseconds (UTC) or 0 if invalid
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

// ─── Public API (Durable Object version) ─────────────────────────────────────

/**
 * Get a Durable Object stub for a user.
 */
async function getUsageStub(usageDo: DurableObjectNamespace, userId: string): Promise<DurableObjectStub> {
	// Hash user ID for privacy (don't use raw token in DO ID)
	const hash = await createUserIdHash(userId);
	return usageDo.get(usageDo.idFromName(`usage:${hash}`));
}

/**
 * Create SHA-256 hash of user ID for Durable Object naming.
 */
async function createUserIdHash(userId: string): Promise<string> {
	const encoder = new TextEncoder();
	const encoded = encoder.encode(userId);
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Record a successful API key usage event.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param entry - Usage entry containing provider, model, key details and token counts
 */
export async function recordUsage(
	usageDo: DurableObjectNamespace,
	userId: string,
	entry: KeyUsageEntry,
): Promise<void> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		await stub.recordUsage(entry);
	} catch (e) {
		console.error("[usage-db] Failed to record usage:", e);
	}
}

/**
 * Record a failed API key request.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param entry - Error entry containing provider, model, key details and error code
 */
export async function recordError(
	usageDo: DurableObjectNamespace,
	userId: string,
	entry: KeyErrorEntry,
): Promise<void> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		await stub.recordError(entry);
	} catch (e) {
		console.error("[usage-db] Failed to record error:", e);
	}
}

/**
 * Get usage statistics grouped by period, provider, owner, and key hint.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param period - Time period for filtering statistics (hour|day|week|month)
 * @param granularity - Granularity for grouping data within the period (hour|day|week|month, optional)
 * @returns Array of KeyUsageStat objects containing aggregated usage statistics
 */
export async function getUsageStats(
	usageDo: DurableObjectNamespace,
	userId: string,
	period: UsagePeriod,
	granularity?: Granularity,
): Promise<KeyUsageStat[]> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.getUsageStats(period, granularity);
	} catch (e) {
		console.error("[usage-db] Failed to get usage stats:", e);
		return [];
	}
}

/**
 * Get error statistics grouped by provider, owner, and key hint.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param period - Time period for filtering statistics (hour|day|week|month)
 * @returns Array of KeyErrorStat objects containing aggregated error statistics
 */
export async function getErrorStats(
	usageDo: DurableObjectNamespace,
	userId: string,
	period: UsagePeriod = "day",
): Promise<KeyErrorStat[]> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.getErrorStats(period);
	} catch (e) {
		console.error("[usage-db] Failed to get error stats:", e);
		return [];
	}
}

/**
 * Migrate a usage NDJSON payload into Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param body - NDJSON string containing usage records
 * @param startline - Optional starting line number (1-based) to process
 * @param endline - Optional ending line number (1-based) to process
 * @returns MigrateResult containing counts of inserted, duplicates, created keys, and updated keys
 */
export async function migrateUsageNdjson(
	usageDo: DurableObjectNamespace,
	userId: string,
	body: string,
	startline?: number,
	endline?: number,
): Promise<MigrateResult> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.migrateUsageNdjson(body, startline, endline);
	} catch (e) {
		console.error("[usage-db] Failed to migrate usage:", e);
		return { ok: false, inserted: 0, duplicates: 0, "created-keys": 0, "updated-keys": 0 };
	}
}

/**
 * Migrate an error NDJSON payload into Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param body - NDJSON string containing error records
 * @param startline - Optional starting line number (1-based) to process
 * @param endline - Optional ending line number (1-based) to process
 * @returns MigrateResult containing counts of inserted, duplicates, created keys, and updated keys
 */
export async function migrateErrorNdjson(
	usageDo: DurableObjectNamespace,
	userId: string,
	body: string,
	startline?: number,
	endline?: number,
): Promise<MigrateResult> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.migrateErrorNdjson(body, startline, endline);
	} catch (e) {
		console.error("[usage-db] Failed to migrate errors:", e);
		return { ok: false, inserted: 0, duplicates: 0, "created-keys": 0, "updated-keys": 0 };
	}
}

/**
 * Delete all usage and error records for a user.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @returns Total number of bytes freed by deletion
 */
export async function purge(
	usageDo: DurableObjectNamespace,
	userId: string,
): Promise<number> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.purge();
	} catch (e) {
		console.error("[usage-db] Failed to purge:", e);
		return 0;
	}
}

/**
 * Get the total size of usage/error records for a user.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @returns Total size in bytes of all usage and error records for the user
 */
export async function getFileSizeBytes(
	usageDo: DurableObjectNamespace,
	userId: string,
): Promise<number> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.getFileSizeBytes();
	} catch (e) {
		console.error("[usage-db] Failed to get file size:", e);
		return 0;
	}
}