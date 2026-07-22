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
// /v1/keypool/universal — OpenAI-compatible proxy backed by the Cline SDK
// keypoollive provider. The caller authenticates with their personal API key;
// the endpoint decrypts their group vault server-side, rotates the group's
// provider keys, translates the request to the target LLM's native protocol,
// and feeds the group's usage statistics.

import { Hono } from 'hono';
import { type KeypoolEvent } from '@sctg/cline-llms';
import { createGateway } from "@sctg/cline-llms/worker";

import { extractBearerToken, getUserContext, type UserContext } from '../lib/auth';
import { getGroupVaultPassword, groupVaultKvKey, LEGACY_VAULT_KV_KEY } from '../lib/groups';
import { recordError, recordQuotaObservation, recordUsage } from '../lib/usage-db';
import { decryptAiConfig } from '../lib/ai-enc';
import { persistVaultForAccess } from '../lib/vaults';
import { computeNextMistralReset, currentQuotaPeriodStart } from '../lib/quota';
import {
	collectOpenAiCompletion,
	openAiSseStream,
	openAiToGatewayInput,
	type OpenAiChatRequest,
} from '../lib/universal';

type HonoEnv = { Bindings: Env; Variables: { userContext: UserContext } };

const universal = new Hono<HonoEnv>();

function openAiError(message: string, type: string, status: number) {
	return { body: { error: { message, type, code: null } }, status };
}

/** Everything needed to drive the keypoollive provider for one caller. */
interface VaultAccess {
	encryptedVault: string;
	vaultPassword: string;
	/** Isolation scope for the SDK's caches and rotation state. */
	scope: string;
	/** Stats bucket in the usage Durable Object. */
	statsUserId: string;
}

/**
 * Resolve the caller's vault ciphertext + password.
 * Group members use their group vault (derived secret, shared stats bucket);
 * legacy and per-user-vault callers keep their historical vault and stats key.
 */
async function resolveVaultAccess(
	env: Env,
	ctx: UserContext,
	bearerToken: string,
): Promise<VaultAccess | null> {
	if (ctx.groupId && ctx.group) {
		const encryptedVault = await env.KV_AI_PROXY.get(groupVaultKvKey(ctx.groupId, ctx.group));
		if (!encryptedVault) return null;
		return {
			encryptedVault,
			vaultPassword: await getGroupVaultPassword(env.AI_JSON_CRYPTOKEN, ctx.groupId, ctx.group),
			scope: `group:${ctx.groupId}`,
			statsUserId: `group:${ctx.groupId}`,
		};
	}

	if (ctx.isLegacy) {
		const encryptedVault = await env.KV_AI_PROXY.get(LEGACY_VAULT_KV_KEY);
		if (!encryptedVault) return null;
		return {
			encryptedVault,
			vaultPassword: env.AI_JSON_CRYPTOKEN,
			scope: 'legacy',
			statsUserId: bearerToken,
		};
	}

	const encryptedVault = await env.KV_AI_PROXY.get(`vault:${ctx.vaultId}`);
	if (!encryptedVault) return null;
	return {
		encryptedVault,
		vaultPassword: bearerToken,
		scope: `vault:${ctx.vaultId}`,
		statsUserId: bearerToken,
	};
}

/** Best-effort extraction of an HTTP status from a provider error string. */
function extractErrorCode(message: string): number | null {
	const match = message.match(/\b(4\d\d|5\d\d)\b/);
	return match ? Number(match[1]) : null;
}

/**
 * Persists a suspected quota exhaustion (see `quota-exhausted-suspected` in
 * the SDK) by patching the caller's vault: loads the current config, flags
 * the matching key with `quotaResetAt`/`quotaExhaustedAt`, and writes it back
 * through `persistVaultForAccess`. Best-effort — a failure here must not
 * break the in-flight request, since the SDK's own in-memory cooldown
 * already keeps the key out of rotation for this isolate regardless.
 */
async function flagKeyQuotaExhausted(
	env: Env,
	ctx: UserContext,
	token: string,
	access: VaultAccess,
	providerName: string,
	keyHint: string,
): Promise<void> {
	const config = await decryptAiConfig(access.encryptedVault, access.vaultPassword);
	const provider = config.providers[providerName];
	if (!provider) return;

	const suffix = keyHint.replace(/^\*+/, '');
	const key = provider.keys.find((k) => k.key.slice(-8) === suffix);
	if (!key) return;

	const periodStart = currentQuotaPeriodStart(key.quotaResetAt);
	key.quotaExhaustedAt = new Date().toISOString();
	key.quotaResetAt = computeNextMistralReset();
	await persistVaultForAccess(env, ctx, token, config);

	await recordQuotaObservation(env.USAGE_DO, access.statsUserId, {
		provider: providerName,
		keyOwner: key.owner ?? 'unknown',
		keyHint,
		periodStart,
	});
}

universal.use('*', async (c, next) => {
	const token = extractBearerToken(c.req.header('Authorization') || null);
	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
	if (!ctx) {
		const { body, status } = openAiError('Invalid API key', 'invalid_request_error', 401);
		return c.json(body, { status: status as 401 });
	}
	c.set('userContext', ctx);
	await next();
});

/**
 * GET /v1/keypool/universal/models
 *
 * OpenAI-compatible model list of the caller's vault. Model IDs use the
 * keypoollive composite format `vaultProvider/modelId`.
 */
universal.get('/models', async (c) => {
	const ctx = c.get('userContext');
	const token = extractBearerToken(c.req.header('Authorization') || null)!;
	const access = await resolveVaultAccess(c.env, ctx, token);
	if (!access) {
		const { body, status } = openAiError('Vault not found', 'invalid_request_error', 404);
		return c.json(body, { status: status as 404 });
	}

	try {
		const vault = await decryptAiConfig(access.encryptedVault, access.vaultPassword);
		const data = Object.entries(vault.providers).flatMap(([providerName, provider]) =>
			provider.models
				.filter((m) => !m.usage || m.usage === 'chat')
				.filter(() => provider.keys.some((k) => k.type !== 'expired'))
				.map((m) => ({
					id: `${providerName}/${m.id}`,
					object: 'model',
					created: 0,
					owned_by: providerName,
					context_window: m.contextWindow,
					context_length: m.contextWindow,
					max_completion_tokens: m.maxOutputTokens,
				})),
		);
		return c.json({ object: 'list', data });
	} catch (err) {
		console.error('universal/models failed:', err);
		const { body, status } = openAiError('Failed to read vault', 'server_error', 500);
		return c.json(body, { status: status as 500 });
	}
});

/**
 * POST /v1/keypool/universal/chat/completions
 *
 * OpenAI-compatible chat completions (streaming and non-streaming) with
 * server-side vault decryption, key rotation and per-group usage tracking.
 */
universal.post('/chat/completions', async (c) => {
	const env = c.env;
	const ctx = c.get('userContext');
	const token = extractBearerToken(c.req.header('Authorization') || null)!;

	let payload: OpenAiChatRequest;
	try {
		payload = await c.req.json<OpenAiChatRequest>();
	} catch {
		const { body, status } = openAiError('Invalid JSON payload', 'invalid_request_error', 400);
		return c.json(body, { status: status as 400 });
	}

	if (!payload.model || typeof payload.model !== 'string' || !payload.model.includes('/')) {
		const { body, status } = openAiError(
			"'model' must use the composite format '<vaultProvider>/<modelId>' (e.g. 'mistral/devstral-latest')",
			'invalid_request_error',
			400,
		);
		return c.json(body, { status: status as 400 });
	}
	if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
		const { body, status } = openAiError("'messages' must be a non-empty array", 'invalid_request_error', 400);
		return c.json(body, { status: status as 400 });
	}

	const access = await resolveVaultAccess(env, ctx, token);
	if (!access) {
		const { body, status } = openAiError('Vault not found for this account', 'invalid_request_error', 404);
		return c.json(body, { status: status as 404 });
	}

	// Track the selected key so rotation errors can be attributed in the stats.
	let lastKey: { keyHint: string; keyOwner: string } = { keyHint: 'unknown', keyOwner: 'unknown' };
	const [providerName] = payload.model.split('/', 1);

	const keypoolEventHandler = (event: KeypoolEvent) => {
		switch (event.type) {
			case 'key-selected':
				lastKey = { keyHint: event.keyHint, keyOwner: event.keyOwner ?? 'unknown' };
				break;
			case 'usage-recorded':
				c.executionCtx.waitUntil(
					recordUsage(env.USAGE_DO, access.statsUserId, {
						provider: event.providerName,
						modelId: event.modelId,
						keyOwner: event.keyOwner ?? 'unknown',
						keyHint: event.keyHint,
						promptTokens: event.inputTokens,
						completionTokens: event.outputTokens,
					}).catch((err) => console.error('universal usage recording failed:', err)),
				);
				break;
			case 'key-rotated':
				c.executionCtx.waitUntil(
					recordError(env.USAGE_DO, access.statsUserId, {
						provider: event.providerName,
						modelId: event.modelId,
						keyOwner: lastKey.keyOwner,
						keyHint: event.failedKeyHint,
						errorCode: extractErrorCode(event.error ?? ''),
					}).catch((err) => console.error('universal error recording failed:', err)),
				);
				break;
			case 'quota-exhausted-suspected':
				c.executionCtx.waitUntil(
					flagKeyQuotaExhausted(env, ctx, token, access, event.providerName, event.keyHint).catch((err) =>
						console.error('universal quota-exhausted-suspected persistence failed:', err),
					),
				);
				break;
		}
	};

	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: 'keypoollive',
				apiKey: 'auto',
				options: {
					loadVaultText: () => access.encryptedVault,
					vaultSecret: access.vaultPassword,
					scope: access.scope,
					remoteStorage: false,
					persistState: false,
				},
			},
		],
		keypoolEventHandler,
	});

	const input = openAiToGatewayInput(payload);
	const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;

	let events: AsyncIterable<import('@sctg/cline-llms').AgentModelEvent>;
	try {
		events = await gateway.stream({
			providerId: 'keypoollive',
			modelId: input.modelId,
			systemPrompt: input.systemPrompt,
			messages: input.messages,
			tools: input.tools,
			temperature: input.temperature,
			maxTokens: input.maxTokens,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`universal stream setup failed (${providerName}):`, message);
		const status = /no usable key|not found/i.test(message) ? 404 : 502;
		const { body } = openAiError(message, 'upstream_error', status);
		return c.json(body, { status: status as 404 | 502 });
	}

	if (payload.stream) {
		const sse = openAiSseStream(
			events,
			payload.model,
			completionId,
			payload.stream_options?.include_usage ?? false,
		);
		return new Response(sse, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	}

	try {
		const completion = await collectOpenAiCompletion(events, payload.model, completionId);
		return c.json(completion);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`universal completion failed (${providerName}):`, message);
		const { body } = openAiError(message, 'upstream_error', 502);
		return c.json(body, { status: 502 });
	}
});

export default universal;
