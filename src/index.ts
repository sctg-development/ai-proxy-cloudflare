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
// AI Proxy Worker — Routes API requests through Cloudflare AI Gateway
// ... existing code ...
//
// AI Proxy Worker — Routes API requests through Cloudflare AI Gateway
// Maintains backward compatibility with legacy endpoints
// Decrypts ai.json.enc stored in KV and validates user keys via KV

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { decryptAiConfig, type AiConfig, type AiModel } from "./lib/ai-enc";
import { validateUserKey, extractBearerToken } from "./lib/auth";
import { forwardToCfAiGateway, detectProvider } from "./lib/gateway";
import { checkBalance, deductBalance } from "./lib/balance";
import {
	recordUsage,
	recordError,
	getUsageStats,
	getErrorStats,
	purge,
	getFileSizeBytes,
	getUserIdFromAuth,
	migrateUsageNdjson,
	migrateErrorNdjson,
	type KeyUsageEntry,
	type KeyErrorEntry,
	type UsagePeriod,
} from "./lib/usage-db";

/**
 * KV key where the encrypted AI provider configuration is stored.
 */
const AI_JSON_ENC_KV_KEY = "vault:ai.json.enc";

declare global {
	interface Env {
		KV_AI_PROXY: KVNamespace;
		PROXY_RATE_LIMITER: RateLimit;
		CLOUDFLARE_ACCOUNT_ID: string;
		AI_JSON_CRYPTOKEN: string;
		CLOUDFLARE_AIG_TOKEN: string;
		DEBUG?: string;
		/** Base URL of the Fufuni merchant backend (e.g. https://api.fufuni.pp.ua). Optional. */
		FUFUNI_MERCHANT_URL?: string;
		/** Shared secret for proxy-to-merchant balance API. Optional. */
		AI_BALANCE_SHARED_SECRET?: string;
	}
}

type HonoEnv = {
	Bindings: Env;
};

const app = new Hono<HonoEnv>();

/**
 * In‑memory cache of the decrypted AI configuration.
 * Cleared after a successful PUT to force re‑decryption with current vault.
 */
let cachedConfig: AiConfig | null = null;

// ── Middleware ────────────────────────────────────────────────────────

app.use(logger());
app.use("*", cors());

/**
 * Read the raw encrypted configuration from KV.
 *
 * @param env - Worker environment bindings
 * @returns Base64‑encoded, OpenSSL‑compatible ciphertext
 * @throws If the vault does not exist in KV or is empty
 */
async function loadEncryptedVault(env: Env): Promise<string> {
	const encryptedPayload = await env.KV_AI_PROXY.get(AI_JSON_ENC_KV_KEY);
	if (!encryptedPayload || encryptedPayload.trim().length === 0) {
		throw new Error("Encrypted vault (vault:ai.json.enc) not found in KV");
	}
	return encryptedPayload;
}

/**
 * Obtain the decrypted AI configuration, caching it in memory.
 *
 * @param env - Worker environment bindings
 * @returns Decrypted AI configuration object
 * @throws If the vault cannot be read or decryption fails
 */
async function getAiConfig(env: Env): Promise<AiConfig> {
	if (cachedConfig) return cachedConfig;

	try {
		const encryptedConfig = await loadEncryptedVault(env);
		cachedConfig = await decryptAiConfig(encryptedConfig, env.AI_JSON_CRYPTOKEN);
		return cachedConfig;
	} catch (err) {
		console.error("Failed to decrypt vault:", err);
		throw new Error("Configuration unavailable");
	}
}

/**
 * Check rate limiting if a rate limiter is bound.
 *
 * @param request - Incoming Request
 * @param env - Worker environment bindings
 * @returns A 429 Response if the limit is exceeded, or null to proceed
 */
async function checkRateLimit(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const limiter = env.PROXY_RATE_LIMITER;
	if (!limiter) return null;

	const ip =
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-forwarded-for")?.split(",")[0] ||
		"unknown";

	const url = new URL(request.url);
	const key = `proxy:${ip}:${url.pathname}`;

	try {
		const { success } = await limiter.limit({ key });
		if (success) return null;

		return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": "60",
			},
		});
	} catch (err) {
		console.warn("Rate limiter unavailable:", err);
		return null; // Let request through if limiter fails
	}
}

/**
 * Validate the Bearer token against the configured crypto token.
 * Used for the PUT /ai.json.enc endpoint.
 *
 * @param authHeader - The Authorization header value (or null)
 * @param expected - The expected token string
 * @returns true if the token is present and matches exactly
 */
function isCryptoTokenValid(authHeader: string | null, expected: string): boolean {
	if (!authHeader) return false;
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	return match ? match[1] === expected : false;
}

function findProviderModel(provider: AiConfig["providers"][string], modelId: string): AiModel | null {
	return provider.models.find((model) => model.id === modelId) ?? null;
}

// ── Endpoints ─────────────────────────────────────────────────────

/**
 * GET /ai.json.enc
 *
 * Returns the raw OpenSSL‑encrypted vault as plain text (base64).
 * Unauthenticated – anyone with the worker URL can download the encrypted blob.
 */
app.get("/ai.json.enc", async (c) => {
	try {
		const encrypted = await c.env.KV_AI_PROXY.get(AI_JSON_ENC_KV_KEY);
		if (!encrypted) {
			return c.text("Vault not found", { status: 404 });
		}
		return c.text(encrypted, {
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	} catch (err) {
		console.error("Failed to serve encrypted vault:", err);
		return c.text("Internal Server Error", { status: 500 });
	}
});

/**
 * PUT /ai.json.enc
 *
 * Replaces the encrypted vault in KV.
 * Secured with an Authorization: Bearer token that must match
 * the environment variable AI_JSON_CRYPTOKEN.
 *
 * After a successful upload, the in‑memory decrypted configuration cache
 * is cleared so the next proxy request will re‑decrypt with the new vault.
 */
app.put("/ai.json.enc", async (c) => {
	const authHeader = c.req.header("Authorization");
	if (!isCryptoTokenValid(authHeader || null, c.env.AI_JSON_CRYPTOKEN)) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}

	try {
		const body = await c.req.text();
		if (!body || body.trim().length === 0) {
			return c.json({ error: "Empty body" }, { status: 400 });
		}

		await c.env.KV_AI_PROXY.put(AI_JSON_ENC_KV_KEY, body);

		// Invalidate in‑memory cache so the next configuration access
		// re‑decrypts the freshly stored vault.
		cachedConfig = null;

		return c.json({ ok: true, message: "Vault updated" }, { status: 200 });
	} catch (err) {
		console.error("Failed to update vault:", err);
		return c.json(
			{ error: "Failed to store vault", message: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
});

/**
 * GET /ai.json
 *
 * Returns the **decrypted** AI configuration as JSON.
 * Authentication is performed by decrypting the vault with the Bearer token
 * provided in the Authorization header. Only a correct token (i.e. the original
 * encryption password) will result in a successful decryption.
 *
 * It can be used for example in a bash script like this:
 *
 * ```bash
 * AI_JSON_CRYPTOKEN=04……9 curl -H "Authorization: Bearer $AI_JSON_CRYPTOKEN" "https://ai-proxy.inet.pp.ua/ai.json" | jq .
 * ```
 */
app.get("/ai.json", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);

	if (!token) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	try {
		const encrypted = await c.env.KV_AI_PROXY.get(AI_JSON_ENC_KV_KEY);
		if (!encrypted) {
			return c.json({ error: "Vault not found" }, { status: 404 });
		}

		const decrypted = await decryptAiConfig(encrypted, token);
		return c.json(decrypted);
	} catch (err) {
		// Decryption failure (wrong password, format error, etc.)
		console.error("Failed to decrypt vault for GET /ai.json:", err);
		return c.json(
			{
				error: "Decryption failed",
				message: "The provided token does not match the encryption password, or the vault is corrupted.",
			},
			{ status: 403 },
		);
	}
});

/**
 * Health check.
 */
app.get("/", (c) => {
	return c.json({ status: "ok", service: "ai-proxy-cloudflare" });
});

/**
 * GET /v1/providers
 *
 * Lists all providers that have at least one non-expired API key.
 * Requires a valid user Bearer token.
 */
app.get("/v1/providers", async (c) => {
	const env = c.env;

	const rateLimitResponse = await checkRateLimit(c.req.raw, env);
	if (rateLimitResponse) return rateLimitResponse;

	const bearerToken = extractBearerToken(c.req.header("Authorization") || null);
	if (!bearerToken) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	const username = await validateUserKey(env.KV_AI_PROXY, bearerToken);
	if (!username) {
		return c.json({ error: "Invalid API key" }, { status: 403 });
	}

	let config: AiConfig;
	try {
		config = await getAiConfig(env);
	} catch {
		return c.json({ error: "Configuration unavailable" }, { status: 500 });
	}

	const providers = Object.entries(config.providers)
		.filter(([, provider]) => provider.keys.some((k) => k.type !== "expired"))
		.map(([id, provider]) => ({ id, object: "provider", protocol: provider.protocol }));

	return c.json({ object: "list", data: providers });
});

/**
 * GET /:provider/v1/models
 *
 * Lists all models available for the given provider, in OpenAI-compatible format.
 * Requires a valid user Bearer token.
 */
app.get("/:provider/v1/models", async (c) => {
	const env = c.env;
	const providerKey = c.req.param("provider");

	const rateLimitResponse = await checkRateLimit(c.req.raw, env);
	if (rateLimitResponse) return rateLimitResponse;

	const bearerToken = extractBearerToken(c.req.header("Authorization") || null);
	if (!bearerToken) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	const username = await validateUserKey(env.KV_AI_PROXY, bearerToken);
	if (!username) {
		return c.json({ error: "Invalid API key" }, { status: 403 });
	}

	let config: AiConfig;
	try {
		config = await getAiConfig(env);
	} catch {
		return c.json({ error: "Configuration unavailable" }, { status: 500 });
	}

	const provider = config.providers[providerKey];
	if (!provider) {
		return c.json({ error: `Provider '${providerKey}' not found` }, { status: 404 });
	}

	return c.json({
		object: "list",
		data: provider.models.map((model) => ({
			id: model.id,
			object: "model",
			created: 0,
			owned_by: providerKey,
			context_window: model.contextWindow,
			context_length: model.contextWindow,
			max_completion_tokens: model.maxOutputTokens,
		})),
	});
});

/**
 * GET /:provider/v1/models/:modelId
 *
 * Returns metadata for a specific model, in OpenAI-compatible format.
 * Requires a valid user Bearer token.
 */
app.get("/:provider/v1/models/:modelId", async (c) => {
	const env = c.env;
	const providerKey = c.req.param("provider");
	const modelId = c.req.param("modelId");

	const rateLimitResponse = await checkRateLimit(c.req.raw, env);
	if (rateLimitResponse) return rateLimitResponse;

	const bearerToken = extractBearerToken(c.req.header("Authorization") || null);
	if (!bearerToken) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	const username = await validateUserKey(env.KV_AI_PROXY, bearerToken);
	if (!username) {
		return c.json({ error: "Invalid API key" }, { status: 403 });
	}

	let config: AiConfig;
	try {
		config = await getAiConfig(env);
	} catch {
		return c.json({ error: "Configuration unavailable" }, { status: 500 });
	}

	const provider = config.providers[providerKey];
	if (!provider) {
		return c.json({ error: `Provider '${providerKey}' not found` }, { status: 404 });
	}

	const model = provider.models.find((m) => m.id === modelId);
	if (!model) {
		return c.json({ error: `Model '${modelId}' not found for provider '${providerKey}'` }, { status: 404 });
	}

	return c.json({
		id: model.id,
		object: "model",
		created: 0,
		owned_by: providerKey,
		context_window: model.contextWindow,
		context_length: model.contextWindow,
		max_completion_tokens: model.maxOutputTokens,
	});
});

// ── Keypool Usage Endpoints ─────────────────────────────────────────

/**
 * Authenticate with decryption token for /v1/keypool/* endpoints.
 * /v1/keypool/* endpoints use the vault decryption token for authentication, not the user API keys.
 * This function checks if the provided Bearer decrypts the vault successfully.
 * 
 * @param token - The Bearer token extracted from the Authorization header	
 * @returns true if the token matches the vault decryption token, false otherwise
 */
export async function isKeypoolAuthValid(c: any, token: string | null, _env: Env): Promise<boolean> {
	try {
		if (!token) return false;
		const encrypted = await c.env.KV_AI_PROXY.get(AI_JSON_ENC_KV_KEY);
		if (!encrypted) return false;
		// Attempt to decrypt with the provided token
		const decrypted = await decryptAiConfig(encrypted, token);
		// check if the decrypted config is valid (has providers)
		if (!decrypted || !decrypted.providers || Object.keys(decrypted.providers).length === 0) {
			return false;
		}
		return true; // Decryption succeeded
	} catch (error: any) {
		console.error("Error validating keypool authorization:", error);
		return false; // Decryption failed
	}
}

/**
 * POST /v1/keypool/usage
 *
 * Record a successful API key usage event.
 * Requires a valid user Bearer token.
 */
app.post("/v1/keypool/usage", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	let entry: KeyUsageEntry;
	try {
		entry = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	// Validate required fields
	if (!entry.provider || !entry.modelId || !entry.keyOwner || !entry.keyHint) {
		return c.json({ error: "Missing required fields: provider, modelId, keyOwner, keyHint" }, { status: 400 });
	}

	await recordUsage(env.KV_AI_PROXY, userId, entry);
	return c.json({ ok: true }, { status: 200 });
});

/**
 * POST /v1/keypool/error
 *
 * Record a failed API key request.
 * Requires a valid user Bearer token.
 */
app.post("/v1/keypool/error", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	let entry: KeyErrorEntry;
	try {
		entry = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	// Validate required fields
	if (!entry.provider || !entry.modelId || !entry.keyOwner || !entry.keyHint) {
		return c.json({ error: "Missing required fields: provider, modelId, keyOwner, keyHint" }, { status: 400 });
	}

	await recordError(env.KV_AI_PROXY, userId, entry);
	return c.json({ ok: true }, { status: 200 });
});

/**
 * GET /v1/keypool/stats
 *
 * Get usage statistics grouped by period.
 * Query params: period (hour|day|week|month, default: day)
 * Requires a valid user Bearer token.
 * 
 * ```bash
 * curl -X GET "https://your-worker-url/v1/keypool/stats?period=day" \
 *      -H	 "Authorization: Bearer <user-token>"
 * ```
 */
app.get("/v1/keypool/stats", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	const period = (c.req.query("period") as UsagePeriod) || "day";
	const stats = await getUsageStats(env.KV_AI_PROXY, userId, period);
	return c.json({ object: "list", data: stats });
});

/**
 * GET /v1/keypool/errors
 *
 * Get error statistics.
 * Query params: period (hour|day|week|month, default: day)
 * Requires a valid user Bearer token.
 *
 * ```bash
 * curl -X GET "https://your-worker-url/v1/keypool/errors?period=day" \
 *      -H	 "Authorization: Bearer <user-token>"
 * ```
 */
app.get("/v1/keypool/errors", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	const period = (c.req.query("period") as UsagePeriod) || "day";
	const stats = await getErrorStats(env.KV_AI_PROXY, userId, period);
	return c.json({ object: "list", data: stats });
});

/**
 * POST /v1/keypool/migrate/usage
 *
 * Migrate a usage NDJSON file into KV for the authenticated user.
 * Existing KV records are skipped and counted as duplicates.
 * Requires a valid user Bearer token.
 * Optional query parameters: startline, endline (1-based line numbers)
 * ```bash
 * curl -X POST "https://your-worker-url/v1/keypool/migrate/usage" \
 *      -H "Authorization: Bearer <	user-token>" \
 *      -H "Content-Type: application/x-ndjson" \
 *      --data-binary "@usage.ndjson"
 * ```
 */
app.post("/v1/keypool/migrate/usage", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	let body: string;
	try {
		body = await c.req.text();
	} catch {
		return c.json({ error: "Failed to read request body" }, { status: 400 });
	}

	if (!body || body.trim().length === 0) {
		return c.json({ error: "Empty NDJSON payload" }, { status: 400 });
	}

	// Extract optional line range parameters
	const startline = c.req.query("startline");
	const endline = c.req.query("endline");

	// Convert to numbers if provided
	const start = startline ? parseInt(startline) : undefined;
	const end = endline ? parseInt(endline) : undefined;

	// Validate parameters
	if (startline && (start === undefined || isNaN(start))) {
		return c.json({ error: "startline must be a valid number" }, { status: 400 });
	}
	if (endline && (end === undefined || isNaN(end))) {
		return c.json({ error: "endline must be a valid number" }, { status: 400 });
	}

	if (start !== undefined && end !== undefined && start > end) {
		return c.json({ error: "startline must be less than or equal to endline" }, { status: 400 });
	}

	const result = await migrateUsageNdjson(env.KV_AI_PROXY, userId, body, start, end);
	return c.json({ ok: true, inserted: result.inserted, duplicates: result.duplicates });
});

/**
 * POST /v1/keypool/migrate/errors
 *
 * Migrate an error NDJSON file into KV for the authenticated user.
 * Existing KV records are skipped and counted as duplicates.
 * Requires a valid user Bearer token.
 * Optional query parameters: startline, endline (1-based line numbers)
 * ```bash
 * curl -X POST "https://your-worker-url/v1/keypool/migrate/errors" \
 * 	    -H "Authorization: Bearer <user-token>" \
 * 	    -H "Content-Type: application/x-ndjson" \
 * 	    --data-binary "@errors.ndjson"
 * ```
 */
app.post("/v1/keypool/migrate/errors", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	let body: string;
	try {
		body = await c.req.text();
	} catch {
		return c.json({ error: "Failed to read request body" }, { status: 400 });
	}

	if (!body || body.trim().length === 0) {
		return c.json({ error: "Empty NDJSON payload" }, { status: 400 });
	}

	// Extract optional line range parameters
	const startline = c.req.query("startline");
	const endline = c.req.query("endline");

	// Convert to numbers if provided
	const start = startline ? parseInt(startline) : undefined;
	const end = endline ? parseInt(endline) : undefined;

	// Validate parameters
	if (startline && (start === undefined || isNaN(start))) {
		return c.json({ error: "startline must be a valid number" }, { status: 400 });
	}
	if (endline && (end === undefined || isNaN(end))) {
		return c.json({ error: "endline must be a valid number" }, { status: 400 });
	}

	if (start !== undefined && end !== undefined && start > end) {
		return c.json({ error: "startline must be less than or equal to endline" }, { status: 400 });
	}

	const result = await migrateErrorNdjson(env.KV_AI_PROXY, userId, body, start, end);
	return c.json({ ok: true, inserted: result.inserted, duplicates: result.duplicates });
});

/**
 * POST /v1/keypool/purge
 *
 * Delete all usage and error records for the authenticated user.
 * Requires a valid user Bearer token.
 * 
 * ```markdown
 * curl -X POST "https://your-worker-url/v1/keypool/purge" \
 *      -H "Authorization: Bearer <user-token>"
 * ```
 */
app.post("/v1/keypool/purge", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}
	
	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	const freed = await purge(c.env.KV_AI_PROXY, userId);
	return c.json({ ok: true, freedBytes: freed });
});

/**
 * GET /v1/keypool/size
 *
 * Get the total size of usage/error records for the authenticated user.
 * Requires a valid user Bearer token.
 */
app.get("/v1/keypool/size", async (c) => {
	const env = c.env;
	const authHeader = c.req.header("Authorization") ?? null;
	const userId = getUserIdFromAuth(authHeader);

	if (!userId) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}
	
	if (!await isKeypoolAuthValid(c, extractBearerToken(authHeader), env)) {
		return c.json({ error: "Invalid keypool authorization" }, { status: 403 });
	}

	const size = await getFileSizeBytes(env.KV_AI_PROXY, userId);
	return c.json({ sizeBytes: size });
});

/**
 * Main API endpoint — handles both legacy and new request formats.
 * Supports:
 *   - /openai/v1/chat/completions (legacy, with X-Host-Final)
 *   - /v1/chat/completions (legacy, with X-Host-Final)
 *   - /groq/v1/chat/completions (new)
 *   - /sambanova/v1/chat/completions (new)
 *   - etc.
 */
app.post("*", async (c) => {
	const env = c.env;

	// Check rate limit
	const rateLimitResponse = await checkRateLimit(c.req.raw, env);
	if (rateLimitResponse) return rateLimitResponse;

	try {
		// Extract and validate authentication
		const authHeader = c.req.header("Authorization");
		const bearerToken = extractBearerToken(authHeader || null);

		if (!bearerToken) {
			return c.json(
				{ error: "Missing Authorization header" },
				{ status: 401 },
			);
		}

		// Validate user key
		const username = await validateUserKey(env.KV_AI_PROXY, bearerToken);
		if (!username) {
			return c.json(
				{ error: "Invalid API key" },
				{ status: 403 },
			);
		}

		if (env.DEBUG) {
			console.log(`User [${username}] validated`);
		}

		// Enforce AI token balance if Fufuni integration is configured.
		// When FUFUNI_MERCHANT_URL is unset, balance check is skipped (standalone mode).
		const balance = await checkBalance(bearerToken, env);
		if (balance !== null && balance <= 0) {
			return c.json(
				{ error: "Insufficient AI token balance. Purchase more tokens at the store." },
				{ status: 402 },
			);
		}

		// Load AI configuration (vault from KV, decrypted with env.AI_JSON_CRYPTOKEN)
		const config = await getAiConfig(env);

		// Parse request body
		let payload: any;
		try {
			payload = await c.req.json();
		} catch (err) {
			return c.json(
				{ error: "Invalid JSON payload" },
				{ status: 400 },
			);
		}

		// Detect provider from path or X-Host-Final header
		const pathname = new URL(c.req.url).pathname;
		const xHostFinal = c.req.header("X-Host-Final");
		const detected = detectProvider(pathname, xHostFinal || null, config);

		if (!detected) {
			return c.json(
				{
					error: "Unable to determine provider. " +
						"Use path prefix (/groq/, /sambanova/, /anthropic/, /openai/) " +
						"or X-Host-Final header for legacy routes.",
				},
				{ status: 400 },
			);
		}

		const { key: providerKey, provider } = detected;

		if (env.DEBUG) {
			console.log(`Provider detected: ${providerKey}`);
		}

		// Validate payload structure
		if (!payload.model) {
			return c.json(
				{ error: "Missing model" },
				{ status: 400 },
			);
		}

		const selectedModel = findProviderModel(provider, String(payload.model));
		if (!selectedModel) {
			return c.json(
				{ error: `Model '${String(payload.model)}' not found for provider '${providerKey}'` },
				{ status: 404 },
			);
		}

		const modelUsage = selectedModel.usage ?? "chat";

		if (modelUsage === "chat") {
			if (!payload.messages || !Array.isArray(payload.messages)) {
				return c.json(
					{ error: "Missing or invalid messages array" },
					{ status: 400 },
				);
			}
		} else if (modelUsage === "tts") {
			if (typeof payload.input !== "string" || payload.input.trim().length === 0) {
				return c.json(
					{ error: "Missing or invalid input for text-to-speech request" },
					{ status: 400 },
				);
			}
		} else {
			return c.json(
				{ error: `Model usage '${modelUsage}' is not yet supported on this proxy route` },
				{ status: 400 },
			);
		}

		// Forward to Cloudflare AI Gateway
		const response = await forwardToCfAiGateway(c.req.raw, payload, provider, {
			accountId: env.CLOUDFLARE_ACCOUNT_ID,
			aigToken: env.CLOUDFLARE_AIG_TOKEN,
			providerKey,
			modelUsage,
			debug: env.DEBUG === "true",
		});

		// Deduct 1 token unit from balance after successful request (non-blocking).
		if (response.status < 400 && balance !== null) {
			c.executionCtx.waitUntil(deductBalance(bearerToken, 1, env));
		}

		return response;
	} catch (err) {
		console.error("Proxy error:", err);
		return c.json(
			{
				error: "Internal server error",
				message: err instanceof Error ? err.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
});

/**
 * 404 handler for unsupported paths/methods.
 */
app.all("*", (c) => {
	return c.json(
		{
			error: "Not found",
			hint: "POST to /v1/chat/completions, /groq/v1/chat/completions, etc.",
		},
		{ status: 404 },
	);
});

export default app;
