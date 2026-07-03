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

import { decryptAiConfig, encryptVault } from "./lib/ai-enc";
import { validateUserKey, extractBearerToken, getUserContext, isAdminRole, type UserContext } from "./lib/auth";
import { forwardToCfAiGateway, detectProvider } from "./lib/gateway";
import { checkBalance, deductBalance } from "./lib/balance";
import {
	BYOK_KV_KEY,
	DEFAULT_GROUP_ID,
	LEGACY_VAULT_KV_KEY,
	loadGroups,
	saveGroups,
} from "./lib/groups";
import {
	invalidateVaultCache,
	loadAiConfig,
	loadGroupConfig,
	saveGroupConfig,
} from "./lib/vaults";
import groupsRouter from "./routes/groups";
import universalRouter from "./routes/universal";
import {
	recordUsage,
	recordError,
	getUsageStats,
	getErrorStats,
	purge,
	getFileSizeBytes,
	migrateUsageNdjson,
	migrateErrorNdjson,
	type KeyUsageEntry,
	type KeyErrorEntry,
	type UsagePeriod,
} from "./lib/usage-db";
import type { AiConfig, AiKey, AiModel, AiProvider } from "./types/ai-config";
/**
 * KV key where the encrypted AI provider configuration is stored.
 */
const AI_JSON_ENC_KV_KEY = "vault:ai.json.enc";

declare global {
	interface Env {
		KV_AI_PROXY: KVNamespace;
		USAGE_DO: DurableObjectNamespace;
		PROXY_RATE_LIMITER: RateLimit;
		CLOUDFLARE_ACCOUNT_ID: string;
		AI_JSON_CRYPTOKEN: string;
		CLOUDFLARE_AIG_TOKEN: string;
		DEBUG?: string;
		/** Base URL of the Fufuni merchant backend (e.g. https://api.fufuni.pp.ua). Optional. */
		FUFUNI_MERCHANT_URL?: string;
		/** Shared secret for proxy-to-merchant balance API. Optional. */
		AI_BALANCE_SHARED_SECRET?: string;
		/** Internal flag to track if migration has run. */
		MIGRATION_RAN?: boolean;
	}
}

type HonoEnv = {
	Bindings: Env;
};

const app = new Hono<HonoEnv>();

// ── Middleware ────────────────────────────────────────────────────────

app.use(logger());
app.use("*", cors());

// Run the one-time migration lazily on the first request of each isolate
// (module scope has no access to bindings in the modules format).
let migrationChecked = false;
app.use("*", async (c, next) => {
	if (!migrationChecked) {
		migrationChecked = true;
		try {
			await runMigration(c.env);
		} catch (err) {
			console.error("Lazy migration failed:", err);
		}
	}
	await next();
});

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
 * Legacy function that loads the default 'legacy' vault.
 * Kept for backward compatibility.
 *
 * @param env - Worker environment bindings
 * @returns Decrypted AI configuration object
 * @throws If the vault cannot be read or decryption fails
 */
async function getAiConfig(env: Env): Promise<AiConfig> {
	return loadAiConfig(env, 'legacy', env.AI_JSON_CRYPTOKEN);
}

/**
 * Resolve the decrypted configuration for an authenticated user context:
 * group vault (derived secret) when the user belongs to a group, otherwise
 * the legacy/per-user vault decrypted with the bearer token.
 */
async function loadConfigForContext(
	env: Env,
	ctx: UserContext,
	bearerToken: string,
): Promise<AiConfig> {
	if (ctx.groupId && ctx.group) {
		return loadGroupConfig(env, ctx.groupId, ctx.group);
	}
	// Legacy/per-user vaults keep the historical contract: the bearer token IS
	// the vault password, so a token that cannot decrypt gets nothing.
	return loadAiConfig(env, ctx.vaultId, bearerToken);
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
 * Returns the OpenSSL‑encrypted vault as plain text (base64).
 *
 * - Without Authorization (legacy contract): the raw legacy blob.
 * - With a Bearer token of a group member: the group vault is decrypted with
 *   the group-derived secret and re-encrypted on the fly with the caller's
 *   token, so SDK/chatbot clients keep using their own token as the vault
 *   password.
 * - With a Bearer token of a per-user-vault user: the raw blob of their vault
 *   (already encrypted with their token).
 */
app.get("/ai.json.enc", async (c) => {
	try {
		const token = extractBearerToken(c.req.header("Authorization") || null);
		if (token) {
			const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
			if (ctx?.groupId && ctx.group) {
				const config = await loadGroupConfig(c.env, ctx.groupId, ctx.group);
				const reEncrypted = await encryptVault(JSON.stringify(config), token);
				return c.text(reEncrypted, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				});
			}
			if (ctx && !ctx.isLegacy) {
				const encrypted = await c.env.KV_AI_PROXY.get(`vault:${ctx.vaultId}`);
				if (!encrypted) {
					return c.text("Vault not found", { status: 404 });
				}
				return c.text(encrypted, {
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				});
			}
			// Unknown token or legacy user: fall through to the legacy blob
		}

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
 * Secured with role-based access control in multi-user mode.
 *
 * After a successful upload, the in‑memory decrypted configuration cache
 * is cleared so the next proxy request will re‑decrypt with the new vault.
 */
app.put("/ai.json.enc", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);

	// Step 1: Check if we are in legacy mode (no users in KV)
	const users = await c.env.KV_AI_PROXY.get('users', 'json');
	const isLegacyMode = !users || Object.keys(users).length === 0;

	// If legacy mode, keep the old behavior
	if (isLegacyMode) {
		if (!isCryptoTokenValid(authHeader || null, c.env.AI_JSON_CRYPTOKEN)) {
			return c.json({ error: "Unauthorized" }, { status: 403 });
		}

		try {
			const body = await c.req.text();
			if (!body || body.trim().length === 0) {
				return c.json({ error: "Empty body" }, { status: 400 });
			}

			await c.env.KV_AI_PROXY.put(AI_JSON_ENC_KV_KEY, body);
			invalidateVaultCache('legacy');

			return c.json({ ok: true, message: "Vault updated" }, { status: 200 });
		} catch (err) {
			console.error("Failed to update vault:", err);
			return c.json(
				{ error: "Failed to store vault", message: err instanceof Error ? err.message : String(err) },
				{ status: 500 },
			);
		}
	}

	// Multi-user mode
	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
	if (!ctx) {
		return c.json({ error: "Invalid token" }, { status: 403 });
	}
	if (!isAdminRole(ctx.role)) {
		return c.json({ error: "Admin role required to modify vault" }, { status: 403 });
	}

	try {
		const body = await c.req.text();
		if (!body || body.trim().length === 0) {
			return c.json({ error: "Empty body" }, { status: 400 });
		}

		// Group vault: the client encrypted the payload with their own token.
		// Decrypt it, then re-encrypt with the group-derived secret.
		if (ctx.groupId && ctx.group) {
			let config: AiConfig;
			try {
				config = await decryptAiConfig(body, token!);
			} catch {
				return c.json(
					{ error: "Payload must be encrypted with your own token" },
					{ status: 400 },
				);
			}
			await saveGroupConfig(c.env, ctx.groupId, ctx.group, config);
			return c.json({ ok: true, message: `Group vault ${ctx.groupId} updated` }, { status: 200 });
		}

		// Legacy / per-user vault: store the ciphertext as-is
		const kvKey = ctx.vaultId === 'legacy' ? AI_JSON_ENC_KV_KEY : `vault:${ctx.vaultId}`;
		await c.env.KV_AI_PROXY.put(kvKey, body);
		invalidateVaultCache(ctx.vaultId);

		return c.json({ ok: true, message: `Vault ${ctx.vaultId} updated` }, { status: 200 });
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
 * Authentication is performed using getUserContext to determine the user's vault.
 * The Bearer token provided in the Authorization header is used to decrypt the user's specific vault.
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
		// Get user context to determine which vault to load
		const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
		if (!ctx) {
			return c.json({ error: "Invalid token" }, { status: 403 });
		}

		// Group members get their group vault; others decrypt with their token
		const config = await loadConfigForContext(c.env, ctx, token);
		return c.json(config);
	} catch (err) {
		// Decryption failure (wrong password, format error, etc.)
		console.error("Failed to decrypt vault for GET /ai.json:", err);
		return c.json(
			{
				error: "Decryption failed or vault not found",
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
 * GET /v1/auth/me
 *
 * Returns the current user's context information.
 * Requires a valid user Bearer token.
 */
app.get("/v1/auth/me", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);
	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
	if (!ctx) {
		return c.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Do not leak the raw group record; expose the useful scalar fields
	const { group: _group, ...publicCtx } = ctx;
	return c.json(publicCtx);
});

/**
 * Helper function to create a default empty vault configuration.
 */
function createDefaultVault(): AiConfig {
	return { version: 1, providers: {}, crawlers: {} };
}

/**
 * GET /v1/users
 *
 * List all users (admin only).
 * Returns user information with sensitive keys masked.
 * Requires admin role.
 */
app.get("/v1/users", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);
	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);

	if (!ctx || !isAdminRole(ctx.role)) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}

	const users = await c.env.KV_AI_PROXY.get('users', 'json');
	if (!users) return c.json({ data: [] });

	// Mask sensitive keys and format user data.
	// superadmin sees everyone; a group admin only sees their own group.
	const safeUsers = Object.entries(users)
		.filter(([, record]: [string, Record<string, any>]) =>
			ctx.role === 'superadmin' || (ctx.groupId && record.groupId === ctx.groupId))
		.map(([username, record]: [string, Record<string, any>]) => ({
			username,
			owner: record.owner || username,
			vaultId: record.vaultId || (record.groupId ? `group:${record.groupId}` : 'legacy'),
			groupId: record.groupId ?? null,
			role: record.role || 'user',
			keyHint: record.key ? `***${record.key.slice(-4)}` : null,
		}));

	return c.json({ data: safeUsers });
});

/**
 * POST /v1/users
 *
 * Create a new user with their own vault (admin only).
 * Requires admin role.
 * Accepts JSON: { username, password, role?, vaultId? }
 */
app.post("/v1/users", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);
	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);

	if (!ctx || !isAdminRole(ctx.role)) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}

	let body: any;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	const { username, password, role, vaultId: customVaultId } = body;

	if (!username || !password) {
		return c.json({ error: "username and password are required" }, { status: 400 });
	}

	// Check if user already exists
	const users: Record<string, any> = await c.env.KV_AI_PROXY.get('users', 'json') || {};
	if (users[username]) {
		return c.json({ error: "User already exists" }, { status: 409 });
	}

	const vaultId = customVaultId || `vault_${username}`;


	try {
		// 1. Create and encrypt default vault
		const defaultVault = createDefaultVault();
		const encrypted = await encryptVault(JSON.stringify(defaultVault), password);

		// 2. Store vault
		await c.env.KV_AI_PROXY.put(`vault:${vaultId}`, encrypted);

		// 3. Add user to users KV
		users[username] = {
			key: password,
			owner: username,
			vaultId,
			role: role || 'user',
		};
		await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

		return c.json({ ok: true, username, vaultId, role: role || 'user' });
	} catch (err) {
		console.error("Failed to create user:", err);
		return c.json(
			{ error: "Failed to create user", message: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
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
 * Resolve the stats identity for /v1/keypool/* endpoints.
 *
 * - Group members share their group's stats bucket (`group:<groupId>`), so the
 *   universal endpoint and every SDK client of the group feed the same stats.
 * - Known users without a group keep the historical token-based bucket.
 * - Unknown tokens fall back to the legacy contract: the token must decrypt
 *   the legacy vault (pre-multi-user SDK clients).
 */
async function resolveKeypoolIdentity(
	c: any,
	env: Env,
): Promise<{ userId: string } | { error: string; status: 401 | 403 }> {
	const authHeader = c.req.header("Authorization") ?? null;
	const token = extractBearerToken(authHeader);
	if (!token) {
		return { error: "Missing Authorization header", status: 401 };
	}

	const ctx = await getUserContext(env.KV_AI_PROXY, token, env.AI_JSON_CRYPTOKEN);
	if (ctx?.groupId) {
		return { userId: `group:${ctx.groupId}` };
	}
	if (ctx) {
		return { userId: token };
	}

	if (await isKeypoolAuthValid(c, token, env)) {
		return { userId: token };
	}
	return { error: "Invalid keypool authorization", status: 403 };
}

/**
 * POST /v1/keypool/usage
 *
 * Record a successful API key usage event.
 * Requires a valid user Bearer token.
 * 
 * ```bash
 * curl -X POST "https://your-worker-url/v1/keypool/usage" \
 *      -H "Authorization: Bearer <user-token>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"ts":1782109837012,"provider":"poolside","modelId":"poolside/laguna-xs.2","keyOwner":"weblate@gmail.com","keyHint":"***FQmLTtAu","promptTokens":1716,"completionTokens":354}'
 * ```
 */
app.post("/v1/keypool/usage", async (c) => {
	const env = c.env;
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

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

	await recordUsage(env.USAGE_DO, userId, entry);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

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

	await recordError(env.USAGE_DO, userId, entry);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

	const period = (c.req.query("period") as UsagePeriod) || "day";
	const stats = await getUsageStats(env.USAGE_DO, userId, period);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

	const period = (c.req.query("period") as UsagePeriod) || "day";
	const stats = await getErrorStats(env.USAGE_DO, userId, period);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

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

	const result = await migrateUsageNdjson(env.USAGE_DO, userId, body, start, end);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

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

	const result = await migrateErrorNdjson(env.USAGE_DO, userId, body, start, end);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

	const freed = await purge(c.env.USAGE_DO, userId);
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
	const identity = await resolveKeypoolIdentity(c, env);
	if ('error' in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}
	const { userId } = identity;

	const size = await getFileSizeBytes(env.USAGE_DO, userId);
	return c.json({ sizeBytes: size });
});

// ── BYOK Models Endpoints ─────────────────────────────────────────────
// (BYOK_KV_KEY is shared with the group provisioning code in lib/groups.ts)

/**
 *
 * Returns the BYOK configuration stored in KV.
 * Returns 404 if no configuration exists, 403 if unauthorized.
 */
app.get("/v1/keypool/byok/models", async (c) => {
	try {
		// Retrieve the BYOK configuration from KV as JSON
		const byokData = await c.env.KV_AI_PROXY.get(BYOK_KV_KEY, "json");
		if (!byokData) {
			// No configuration has been stored yet
			return c.json({ error: "BYOK configuration not found" }, { status: 404 });
		}
		// Return the stored configuration
		return c.json(byokData);
	} catch (err) {
		// Log and return any unexpected errors
		console.error("Failed to retrieve BYOK configuration:", err);
		return c.json(
			{ error: "Failed to retrieve BYOK configuration", message: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
});

/**
 * POST /v1/keypool/byok/models
 *
 * Stores the BYOK configuration in KV.
 * Requires Bearer token authentication matching AI_JSON_CRYPTOKEN.
 * Validates that the payload conforms to AiConfig type.
 */
app.post("/v1/keypool/byok/models", async (c) => {
	const authHeader = c.req.header("Authorization");
	if (!isCryptoTokenValid(authHeader || null, c.env.AI_JSON_CRYPTOKEN)) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}

	let payload: AiConfig;
	try {
		payload = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	// Validate AiConfig structure
	if (!payload || typeof payload !== "object") {
		return c.json({ error: "Invalid payload: must be an object" }, { status: 400 });
	}

	if (typeof payload.version !== "number") {
		return c.json({ error: "Invalid payload: 'version' must be a number" }, { status: 400 });
	}

	if (!payload.providers || typeof payload.providers !== "object") {
		return c.json({ error: "Invalid payload: 'providers' must be an object" }, { status: 400 });
	}

	if (!payload.crawlers || typeof payload.crawlers !== "object") {
		return c.json({ error: "Invalid payload: 'crawlers' must be an object" }, { status: 400 });
	}

	// Validate providers structure
	for (const [providerId, provider] of Object.entries(payload.providers)) {
		if (!provider || typeof provider !== "object") {
			return c.json({ error: `Invalid provider '${providerId}': must be an object` }, { status: 400 });
		}
		if (!provider.protocol || typeof provider.protocol !== "string") {
			return c.json({ error: `Invalid provider '${providerId}': 'protocol' must be a string` }, { status: 400 });
		}
		if (!provider.endpoint || typeof provider.endpoint !== "string") {
			return c.json({ error: `Invalid provider '${providerId}': 'endpoint' must be a string` }, { status: 400 });
		}
		if (!Array.isArray(provider.keys)) {
			return c.json({ error: `Invalid provider '${providerId}': 'keys' must be an array` }, { status: 400 });
		}
		if (!Array.isArray(provider.models)) {
			return c.json({ error: `Invalid provider '${providerId}': 'models' must be an array` }, { status: 400 });
		}

		// Validate each key in the provider
		for (let i = 0; i < provider.keys.length; i++) {
			const key = provider.keys[i];
			if (!key || typeof key !== "object") {
				return c.json({ error: `Invalid key at index ${i} in provider '${providerId}': must be an object` }, { status: 400 });
			}
			if (!key.key || typeof key.key !== "string") {
				return c.json({ error: `Invalid key at index ${i} in provider '${providerId}': 'key' must be a string` }, { status: 400 });
			}
		}

		// Validate each model in the provider
		for (let i = 0; i < provider.models.length; i++) {
			const model = provider.models[i];
			if (!model || typeof model !== "object") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': must be an object` }, { status: 400 });
			}
			if (!model.id || typeof model.id !== "string") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'id' must be a string` }, { status: 400 });
			}
			if (!model.usage || typeof model.usage !== "string") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'usage' must be a string` }, { status: 400 });
			}
			if (typeof model.contextWindow !== "number") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'contextWindow' must be a number` }, { status: 400 });
			}
			if (typeof model.maxOutputTokens !== "number") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'maxOutputTokens' must be a number` }, { status: 400 });
			}
			if (model.tpmLimit !== undefined && model.tpmLimit !== null && typeof model.tpmLimit !== "number") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'tpmLimit' must be a number or null` }, { status: 400 });
			}
			if (typeof model.priority !== "number") {
				return c.json({ error: `Invalid model at index ${i} in provider '${providerId}': 'priority' must be a number` }, { status: 400 });
			}
		}
	}

	// Validate crawlers structure
	for (const [crawlerId, crawler] of Object.entries(payload.crawlers)) {
		if (!crawler || typeof crawler !== "object") {
			return c.json({ error: `Invalid crawler '${crawlerId}': must be an object` }, { status: 400 });
		}
		if (!crawler.protocol || typeof crawler.protocol !== "string") {
			return c.json({ error: `Invalid crawler '${crawlerId}': 'protocol' must be a string` }, { status: 400 });
		}
		if (!crawler.endpoint || typeof crawler.endpoint !== "string") {
			return c.json({ error: `Invalid crawler '${crawlerId}': 'endpoint' must be a string` }, { status: 400 });
		}
		if (!Array.isArray(crawler.keys)) {
			return c.json({ error: `Invalid crawler '${crawlerId}': 'keys' must be an array` }, { status: 400 });
		}

		// Validate each key in the crawler
		for (let i = 0; i < crawler.keys.length; i++) {
			const key = crawler.keys[i];
			if (!key || typeof key !== "object") {
				return c.json({ error: `Invalid key at index ${i} in crawler '${crawlerId}': must be an object` }, { status: 400 });
			}
			if (!key.key || typeof key.key !== "string") {
				return c.json({ error: `Invalid key at index ${i} in crawler '${crawlerId}': 'key' must be a string` }, { status: 400 });
			}
		}
	}

	try {
		await c.env.KV_AI_PROXY.put(BYOK_KV_KEY, JSON.stringify(payload));
		return c.json({ ok: true, message: "BYOK configuration stored" }, { status: 200 });
	} catch (err) {
		console.error("Failed to store BYOK configuration:", err);
		return c.json(
			{ error: "Failed to store BYOK configuration", message: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
});

/**
 * ALL /v1/keypool/corsproxy
 *
 * CORS proxy endpoint that supports all HTTP methods.
 * Allows fetching resources from websites that don't send CORS headers.
 * Requires Bearer token authentication matching AI_JSON_CRYPTOKEN.
 */
app.all("/v1/keypool/corsproxy", async (c) => {
	const authHeader = c.req.header("Authorization");
	if (!isCryptoTokenValid(authHeader || null, c.env.AI_JSON_CRYPTOKEN)) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}

	// Extract the target URL from query parameters
	const targetUrl = c.req.query("url");
	if (!targetUrl) {
		return c.json({ error: "Missing 'url' query parameter" }, { status: 400 });
	}

	try {
		// Create a new URL object to validate and parse the target URL
		const url = new URL(targetUrl);

		// Forward the request to the target URL with the same method and headers
		const init: RequestInit = {
			method: c.req.method,
			headers: {
				"Content-Type": c.req.header("Content-Type") || "application/json",
				"User-Agent": c.req.header("User-Agent") || "ai-proxy-cors/1.0",
				"Accept": c.req.header("Accept") || "*/*",
			} as Record<string, string>,
		};

		// Forward request body if present (for POST, PUT, PATCH, etc.)
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			try {
				init.body = await c.req.text();
			} catch (err) {
				// If we can't read the body, proceed without it
				console.warn("Could not read request body for CORS proxy:", err);
			}
		}

		// Make the fetch request
		const response = await fetch(url.toString(), init);

		// Create a new response with the same status and headers
		const responseHeaders = new Headers();
		// Forward safe headers only
		const safeHeaders = [
			"content-type", "content-length", "content-disposition",
			"cache-control", "etag", "last-modified", "expires"
		];

		response.headers.forEach((value, name) => {
			if (safeHeaders.includes(name.toLowerCase())) {
				responseHeaders.set(name, value);
			}
		});

		// Add CORS headers to allow cross-origin requests
		responseHeaders.set("Access-Control-Allow-Origin", "*");
		responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS");
		responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

		// Stream the response body
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});

	} catch (err) {
		console.error("CORS proxy error:", err);
		return c.json(
			{
				error: "CORS proxy failed",
				message: err instanceof Error ? err.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
});

// ── Group management ──────────────────────────────────────────────────
// Mounted before the catch-all proxy handler so POST /v1/groups/... wins.
app.route("/v1/groups", groupsRouter);

// ── Universal OpenAI-compatible proxy (SDK keypoollive) ───────────────
app.route("/v1/keypool/universal", universalRouter);

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

		// STEP 1: Legacy proxy authentication (UNCHANGED)
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

		// STEP 2: Get user context to find the vault ID (NEW)
		// Note: We already validated the token, so getUserContext should succeed.
		// If it is null (e.g., race condition), fallback to legacy.
		const ctx = await getUserContext(env.KV_AI_PROXY, bearerToken, env.AI_JSON_CRYPTOKEN);
		// ctx should never be null here because validateUserKey passed.
		// If it is null (e.g., race condition), fallback to legacy.
		const vaultId = ctx?.vaultId || 'legacy';

		// STEP 3: Load the user-specific vault (group vault for group members)
		let config: AiConfig;
		try {
			config = ctx
				? await loadConfigForContext(env, ctx, bearerToken)
				: await loadAiConfig(env, vaultId, bearerToken);
		} catch (err) {
			console.error(`Failed to load vault ${vaultId} for user ${username}:`, err);
			// Fallback to legacy vault if specific vault fails? Better to return 500.
			// But to maintain resilience, try legacy as a last resort.
			try {
				config = await loadAiConfig(env, 'legacy', env.AI_JSON_CRYPTOKEN);
				console.warn(`Falling back to legacy vault for user ${username}`);
			} catch {
				return c.json({ error: "Configuration unavailable" }, { status: 500 });
			}
		}

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

// ── Migration routine ───────────────────────────────────────────────────

/**
 * KV key to track if the v1 (multi-user) migration has been executed
 */
const MIGRATION_KV_KEY = "migration:ran";

/**
 * KV key to track if the v2 (multi-group) migration has been executed
 */
const GROUPS_MIGRATION_KV_KEY = "migration:groups";

/**
 * Automatic migration routine that runs once per deployment (lazily, on the
 * first request of an isolate — guarded by KV flags).
 *
 * v1: creates a default admin user if we're in legacy mode (no users in KV).
 * v2: creates the 'default' group backed by the legacy vault, attaches every
 *     legacy-vault user to it, and promotes the master-token user to superadmin.
 */
async function runMigration(env: Env): Promise<void> {
  try {
    // ── v1: multi-user bootstrap ─────────────────────────────────────
    const migrationDone = await env.KV_AI_PROXY.get(MIGRATION_KV_KEY);
	console.log('Migration v1 status:', migrationDone);
    if (migrationDone !== 'true') {
      const users = await env.KV_AI_PROXY.get('users', 'json');
      const legacyVault = await env.KV_AI_PROXY.get(LEGACY_VAULT_KV_KEY);

      if (users && Object.keys(users).length > 0) {
        console.log('Migration v1 skipped: users already exist.');
      } else if (!legacyVault) {
        console.log('Migration v1 skipped: no legacy vault found.');
      } else {
        const newUsers = {
          admin: {
            key: env.AI_JSON_CRYPTOKEN,
            owner: 'admin',
            vaultId: 'legacy', // Keep the same vault to avoid data loss
            role: 'admin',
          },
        };
        await env.KV_AI_PROXY.put('users', JSON.stringify(newUsers));
        console.log('Migration v1 successful: created admin user with legacy vault.');
      }
      await env.KV_AI_PROXY.put(MIGRATION_KV_KEY, 'true');
    }

    // ── v2: multi-group bootstrap ────────────────────────────────────
    const groupsMigrationDone = await env.KV_AI_PROXY.get(GROUPS_MIGRATION_KV_KEY);
    if (groupsMigrationDone === 'true') {
      return;
    }

    const legacyVault = await env.KV_AI_PROXY.get(LEGACY_VAULT_KV_KEY);
    if (!legacyVault) {
      console.log('Migration v2 skipped: no legacy vault found.');
      await env.KV_AI_PROXY.put(GROUPS_MIGRATION_KV_KEY, 'true');
      return;
    }

    const groups = await loadGroups(env.KV_AI_PROXY);
    if (!groups[DEFAULT_GROUP_ID]) {
      groups[DEFAULT_GROUP_ID] = {
        name: 'Default',
        createdAt: Date.now(),
        createdBy: 'migration',
        legacy: true,
      };
      await saveGroups(env.KV_AI_PROXY, groups);
    }

    // Attach legacy-vault users to the default group; the master-token user
    // becomes superadmin. Users with their own vault are left untouched.
    const users = ((await env.KV_AI_PROXY.get('users', 'json')) ?? {}) as Record<string, any>;
    let usersChanged = false;
    for (const record of Object.values(users)) {
      if (!record || typeof record !== 'object') continue;
      if (record.key === env.AI_JSON_CRYPTOKEN && record.role !== 'superadmin') {
        record.role = 'superadmin';
        usersChanged = true;
      }
      if (!record.groupId && (!record.vaultId || record.vaultId === 'legacy')) {
        record.groupId = DEFAULT_GROUP_ID;
        delete record.vaultId;
        usersChanged = true;
      }
    }
    if (usersChanged) {
      await env.KV_AI_PROXY.put('users', JSON.stringify(users));
    }

    await env.KV_AI_PROXY.put(GROUPS_MIGRATION_KV_KEY, 'true');
    console.log('Migration v2 successful: default group created and users attached.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

export default app;
export { UsageDbDurableObject } from "./lib/usage-db";
