---
title: "ai-proxy-cloudflare AI Proxy"
description: "ai-proxy-cloudflare is a all-in-one AI proxy and vault manager for storing LLM API keys and record usage"
framework: typescript
stack: "ai-proxy-cloudflare"
generated: "2026-08-10"
slim_mode: false
files_total: 13
---

# AI Proxy Cloudflare Worker v3.0

Modern proxy to route API requests through the **Cloudflare AI Gateway** with **multi-user and multi-vault support**.

## 🚀 Features

- ✅ **On-the-fly decryption** of `ai.json.enc` stored in KV
- ✅ **User validation** using keys stored in KV (`users` key)
- ✅ **Multi-provider routing** (Groq, SambaNova, Anthropic, OpenAI, Gemini, Mistral, OpenRouter, Morph)
- ✅ **OpenAI-compatible `:provider/v1/models` endpoint** per provider
- ✅ **Vault UI model discovery** from provider APIs, with chat/embedding classification
- ✅ **Drag-and-drop model priority management** in the vault UI
- ✅ **Explicit vault saves**: UI edits stay local until the user saves
- ✅ **Backward compatibility** with both legacy request formats
- ✅ **Forwarding through Cloudflare AI Gateway** with automatic model ID prefixing
- ✅ Optional **rate limiting** via Durable Objects
- ✅ Preconfigured **CORS**
- ✅ Transparent **streaming** support
- ✅ **Vault management** via HTTP endpoints

## 📋 Requirements

### 1. Create `.dev.vars` for development

```bash
cp .dev.vars.example .dev.vars
# Fill in the values:
# - CLOUDFLARE_ACCOUNT_ID
# - AI_JSON_CRYPTOKEN (decryption token for ai.json.enc)
# - CLOUDFLARE_AIG_TOKEN (Cloudflare AI Gateway token)
```

### 2. Prepare ai.json.enc

The `src/config/ai.json.enc` file must be:
- Encrypted with `openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000`
- Using the same `AI_JSON_CRYPTOKEN` as the `AI_JSON_CRYPTOKEN` env variable
- Containing valid JSON with the `AiConfig` structure:

```json
{
  "version": 1,
  "providers": {
    "groq": {
      "protocol": "openai",
      "endpoint": "https://api.groq.com/openai/v1",
      "gatewayEndpoint": "https://gateway.ai.cloudflare.com/v1/{account}/default/compat",
      "gatewayModelPrefix": "groq",
      "gatewayKey": "optional_gateway_key",
      "keys": [
        { "key": "gsk_xxx...", "owner": "ronan", "type": "paid" }
      ],
      "models": [
        {
          "id": "llama-3.3-70b-versatile",
          "usage": "chat",
          "contextWindow": 8192,
          "maxOutputTokens": 2048,
          "tpmLimit": null,
          "priority": 1,
          "tags": ["fast", "reasoning"]
        }
      ]
    },
    "sambanova": {
      "protocol": "openai",
      "endpoint": "https://api.sambanova.ai/api/chat/completions",
      "gatewayEndpoint": "https://gateway.ai.cloudflare.com/v1/{account}/default/compat",
      "gatewayModelPrefix": "custom-sambanova",
      "keys": [
        { "key": "xxxxxxxxxxxxxxxxx" }
      ],
      "models": [
        {
          "id": "Meta-Llama-3.3-70B-Instruct",
          "usage": "chat",
          "contextWindow": 4096,
          "maxOutputTokens": 2048,
          "tpmLimit": null,
          "priority": 1
        }
      ]
    }
  }
}
```

### 3. Upload to Cloudflare KV:
```bash
wrangler kv:key put vault:ai.json.enc --path=ai.json.enc --namespace-id=YOUR_KV_NAMESPACE_ID
```

### 4. Initialize KV with users

Load valid users into KV (`KV_AI_PROXY`), key `users`:

```bash
wrangler kv:key put users '{"ronan":{"key":"AGE-SECRET-KEY-..."},"audrey":{"key":"AGE-SECRET-KEY-..."},...}' --namespace-id=0f6936bc4d9b4d5fa1cc85acd757e354
```

For development, keys are read from `users.json` if KV is empty.

---

## 📨 Usage

### List available providers

```bash
curl https://ai-proxy.inet.pp.ua/v1/providers \
  -H "Authorization: Bearer AGE-SECRET-KEY-..."
```

Returns only providers that have at least one non-expired API key:
```json
{
  "object": "list",
  "data": [
    { "id": "groq", "object": "provider", "protocol": "openai" },
    { "id": "anthropic", "object": "provider", "protocol": "anthropic" }
  ]
}
```

### List available models

```bash
# List all models for a provider
curl https://ai-proxy.inet.pp.ua/groq/v1/models \
  -H "Authorization: Bearer AGE-SECRET-KEY-..."

# Get a specific model
curl https://ai-proxy.inet.pp.ua/groq/v1/models/llama-3.3-70b-versatile \
  -H "Authorization: Bearer AGE-SECRET-KEY-..."
```

Response format (OpenAI-compatible):
```json
{
  "object": "list",
  "data": [
    {
      "id": "llama-3.3-70b-versatile",
      "object": "model",
      "created": 0,
      "owned_by": "groq",
      "context_window": 8192,
      "context_length": 8192,
      "max_completion_tokens": 2048
    }
  ]
}
```

### Model metadata fields

Every model entry in `ai.json` is normalized to the shape consumed by the Worker
and the UI:

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Provider model identifier exactly as it must be sent upstream. |
| `usage` | yes | `chat` for chat/completion models, `embedding` for embedding models. The UI sync only imports these two families because they are the proxy-supported model classes. |
| `contextWindow` | yes | Maximum context size in tokens. For embedding models this is the maximum input size. |
| `maxOutputTokens` | yes | Maximum generated output tokens. Embedding models use `0` because they do not generate completions. |
| `tpmLimit` | yes | Tokens-per-minute limit when known, otherwise `null`. Most provider model-list APIs do not expose account-specific TPM limits. |
| `priority` | yes | Lower numbers are preferred. The UI regenerates this field from the visible model order using steps of 10: `0`, `10`, `20`, etc. |
| `tags` | no | Optional free-form labels. |
| `gatewayPrefix` | no | Optional per-model gateway prefix override. |

### Vault UI model discovery

The UI can refresh one provider's model list directly from the provider API.
Open the provider card, then use **Refresh from API** in the Models tab. The UI
uses the first API key whose `type` is not `expired`, queries the provider's
model-list endpoint, normalizes the result, and replaces the provider's model
list in the local draft. Nothing is sent to `PUT /ai.json.enc` until the user
presses **Save Vault**.

Existing model order is preserved when a refreshed model ID was already present.
New models are appended after known models, grouped as chat models before
embedding models. After every refresh or drag-and-drop reorder, priorities are
rewritten in increments of 10 starting at `0`, so the first visible model has
the highest priority and there is room to insert manual priorities between rows.

Provider-specific discovery behavior:

| Provider | Model-list API | Limit source | Usage classification |
| --- | --- | --- | --- |
| Groq | `GET https://api.groq.com/openai/v1/models` with `Authorization: Bearer` | `context_window` and `max_completion_tokens` returned by Groq. | Groq catalogue models are imported as `chat` unless their ID indicates embeddings. |
| SambaNova | `GET /v1/models` with `Authorization: Bearer` against the configured SambaNova base URL. | `context_length` and `max_completion_tokens` returned by SambaNova. | SambaNova catalogue models are imported as `chat` unless their ID indicates embeddings. |
| Anthropic | `GET https://api.anthropic.com/v1/models` with `x-api-key` and `anthropic-version: 2023-06-01`. | Anthropic's list endpoint returns availability only, so the UI applies documented Claude family context and output limits. | All Anthropic list results are `chat`. |
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models?key=...`. | `inputTokenLimit` and `outputTokenLimit` returned by Gemini. | `supportedGenerationMethods` containing embedding methods, or an embedding model ID, becomes `embedding`; other importable models are `chat`. |
| Mistral | `GET https://api.mistral.ai/v1/models` with `Authorization: Bearer`. | `max_context_length`; if no separate output cap is returned, `maxOutputTokens` falls back to the context length because Mistral constrains prompt plus output to the model context. | Capability metadata and model IDs identify embedding models; other models are `chat`. |
| OpenRouter | `GET https://openrouter.ai/api/v1/models?output_modalities=all` with `Authorization: Bearer`. | `top_provider.context_length` and `top_provider.max_completion_tokens`, falling back to top-level fields. | Architecture output modalities and IDs identify embeddings; other text-output models are `chat`. |
| OpenAI | `GET https://api.openai.com/v1/models` with `Authorization: Bearer`. | OpenAI's list endpoint returns only basic metadata, so recognized chat and embedding families are enriched from documented OpenAI model limits. Non-chat/non-embedding assets are skipped. | Embedding IDs become `embedding`; recognized GPT/o-series/open-weight IDs become `chat`. |
| Morph | `GET https://api.morphllm.com/v1/models` with `Authorization: Bearer`. | Returned limit fields when present, otherwise Morph family defaults from the public model docs. | Morph embedding IDs become `embedding`; apply/general models are `chat`; rerank-only models are skipped. |

The refresh request runs in the browser. If a provider blocks browser CORS for
its model-list endpoint, the UI will show the provider error and leave the
existing vault unchanged.

### Modern request (recommended)

```bash
curl -X POST https://ai-proxy.inet.pp.ua/groq/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AGE-SECRET-KEY-..." \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Legacy request (compatibility)

```bash
curl -X POST https://ai-proxy.inet.pp.ua/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AGE-SECRET-KEY-..." \
  -H "X-Host-Final: api.groq.com" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "..."}]
  }'
```

### Provider routing

The proxy detects the provider using:
1. **Path prefix** (priority): `/groq/`, `/sambanova/`, `/anthropic/`, `/openai/`, `/gemini/`, `/mistral/`, `/openrouter/`, `/morph/`
2. **`X-Host-Final` header** (fallback): `api.groq.com`, `api.sambanova.ai`, etc.

If neither can be determined, a 400 error is returned.

---

## 🔄 Forwarding flow

```
Client request
    ↓
[Bearer token validation]
    ↓
[ai.json.enc decryption] (cached)
    ↓
[Provider detection]
    ↓
[Provider API key selection] (round-robin)
    ↓
[Model ID prefixing for gateway]
    ↓
Cloudflare AI Gateway
    ↓
Final provider (Groq, SambaNova, etc.)
```

--- 

## 🔄 Vault Management Endpoints

The worker now includes endpoints to manage the encrypted configuration vault:

### GET /ai.json.enc

Returns the raw encrypted vault. Unauthenticated - anyone can download the encrypted blob.

### PUT /ai.json.enc

Updates the encrypted vault in KV. Requires `Authorization: Bearer` header matching `AI_JSON_CRYPTOKEN`.

Example:
```bash
curl -X PUT https://ai-proxy.inet.pp.ua/ai.json.enc \
  -H "Authorization: Bearer YOUR_CRYPTO_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary @ai.json.enc
```

### GET /ai.json

Returns the decrypted configuration. Authentication is performed by decrypting with the provided Bearer token.

```bash
curl -X GET https://ai-proxy.inet.pp.ua/ai.json \
  -H "Authorization: Bearer YOUR_CRYPTO_TOKEN"
```

---

## 👥 Multi-User & Multi-Vault Support (NEW in v3.0)

### Overview

The worker now supports multiple users with isolated vaults, enabling secure multi-tenant deployments while maintaining 100% backward compatibility with legacy single-user setups.

### Key Features

- **User Isolation**: Each user has their own encrypted vault
- **Role-Based Access Control**: Admin and user roles with different permissions
- **Automatic Migration**: Legacy installations are automatically migrated to multi-user mode
- **Backward Compatibility**: Existing clients continue to work without modification

### User Management Endpoints

#### GET /v1/auth/me

Returns the current user's context information.

```bash
curl https://ai-proxy.inet.pp.ua/v1/auth/me \
  -H "Authorization: Bearer USER_TOKEN"
```

Response:
```json
{
  "username": "ronan",
  "vaultId": "vault_ronan",
  "role": "admin",
  "isLegacy": false
}
```

#### GET /v1/users (Admin only)

List all users with masked credentials.

```bash
curl https://ai-proxy.inet.pp.ua/v1/users \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

Response:
```json
{
  "data": [
    {
      "username": "ronan",
      "owner": "ronan",
      "vaultId": "vault_ronan",
      "role": "admin",
      "keyHint": "***1234"
    },
    {
      "username": "audrey",
      "owner": "audrey",
      "vaultId": "vault_audrey",
      "role": "user",
      "keyHint": "***5678"
    }
  ]
}
```

#### POST /v1/users (Admin only)

Create a new user with their own vault.

```bash
curl -X POST https://ai-proxy.inet.pp.ua/v1/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "password": "secure_password_123",
    "role": "user"
  }'
```

Response:
```json
{
  "ok": true,
  "username": "newuser",
  "vaultId": "vault_newuser",
  "role": "user"
}
```

### Multi-Vault Architecture

#### Vault Storage

- **Legacy mode**: Single vault at `vault:ai.json.enc`
- **Multi-user mode**: Individual vaults at `vault:{vaultId}`
- **Automatic detection**: The system detects the mode based on KV contents

#### Migration Process

1. **First request**: Automatic migration routine runs
2. **Legacy detection**: Checks for existing `vault:ai.json.enc`
3. **User creation**: Creates `admin` user with legacy vault
4. **Seamless transition**: No downtime or data loss

Migration logs:
```
Migration successful: created admin user with legacy vault.
```

#### Vault Isolation

Each user's vault is:
- ✅ Encrypted with their own password
- ✅ Stored separately in KV
- ✅ Accessible only with their token
- ✅ Completely isolated from other users

### Usage Examples

#### Legacy client (unchanged)

```bash
# Existing clients continue to work without modification
curl -X POST https://ai-proxy.inet.pp.ua/groq/v1/chat/completions \
  -H "Authorization: Bearer LEGACY_TOKEN" \
  -d '{"model": "llama-3.3-70b-versatile", "messages": [...]}'
```

#### Multi-user client

```bash
# New clients use the multi-user system
curl -X POST https://ai-proxy.inet.pp.ua/groq/v1/chat/completions \
  -H "Authorization: Bearer USER_SPECIFIC_TOKEN" \
  -d '{"model": "llama-3.3-70b-versatile", "messages": [...]}'
```

#### Admin operations

```bash
# Admin can manage all users and vaults
curl -X POST https://ai-proxy.inet.pp.ua/v1/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"username": "team_member", "password": "secure123", "role": "user"}'
```

### Role-Based Access Control

| Role | Permissions |
|------|-------------|
| **admin** | Full access: create users, modify any vault, access all endpoints |
| **user** | Limited access: only their own vault, read-only for shared resources |

### Backward Compatibility

**100% compatible with existing deployments:**

- ✅ Legacy tokens continue to work
- ✅ No configuration changes required
- ✅ Automatic migration on first request
- ✅ Rollback possible at any time

### Migration Rollback

If needed, rollback to legacy mode:

```bash
# 1. Rollback worker version
wrangler rollback

# 2. Remove users KV (optional)
wrangler kv:key delete users

# 3. Verify legacy mode
curl -H "Authorization: Bearer LEGACY_TOKEN" https://worker-url/ai.json
```

---

## 🔄 Forwarding flow

```
Client request
    ↓
[Bearer token validation]
    ↓
[ai.json.enc decryption] (cached)
    ↓
[Provider detection]
    ↓
[Provider API key selection] (round-robin)
    ↓
[Model ID prefixing for gateway]
    ↓
Cloudflare AI Gateway
    ↓
Final provider (Groq, SambaNova, etc.)
```

---

## 🛠 Development

### Start local server

```bash
npm run dev
# Listens on http://localhost:8787
# Automatically runs: scripts/embed-config.js -> src/lib/embedded-config.ts
```

### Deploy

```bash
npm run deploy
```

### Tests

```bash
npm test
```

### Build & embedding

The `scripts/embed-config.js` script runs automatically **before every build/dev**:
1. Reads `src/config/ai.json.enc` (encrypted binary file)
2. Converts it to a JSON string
3. Generates `src/lib/embedded-config.ts` with that content
4. Imports that content into `src/index.ts`
5. Wrangler embeds everything into the worker bundle

This process avoids managing file assets at runtime.

Force regeneration:
```bash
node scripts/embed-config.js
```

---

## 📝 sample_request.sh examples

The `sample_request.sh` file contains two working examples:

1. **`/openai/v1/chat/completions` route** with `X-Host-Final: api.groq.com`
2. **`/v1/chat/completions` route** with `X-Host-Final: api.sambanova.ai`

Run the examples:

```bash
source .dev.vars
./sample_request.sh
```

(Replace keys with real user keys in `users.json`)

---

## 🔐 ai.json.enc encryption

### Create ai.json.enc

```bash
# 1. Create ai.json with the AiConfig structure
cat > ai.json << 'EOF'
{
  "version": 1,
  "providers": { ... }
}
EOF

# 2. Encrypt with openssl
AI_JSON_CRYPTOKEN="your_secret_token"
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in ai.json -out ai.json.enc -pass pass:"$AI_JSON_CRYPTOKEN"

# 3. Copy to src/config/
cp ai.json.enc src/config/ai.json.enc

# 4. Remove plaintext file
rm ai.json
```

### Decrypt (manual)

```bash
openssl enc -d -aes-256-cbc -a -in ai.json.enc -pass pass:"$AI_JSON_CRYPTOKEN" -out ai.json
```

---

## 📂 Project structure

```
ai-proxy-cloudflare/
├── src/
│   ├── index.ts           # Main Hono app
│   ├── config/
│   │   └── ai.json.enc    # Encrypted config (bundled)
│   └── lib/
│       ├── ai-enc.ts      # Decryption & helpers
│       ├── auth.ts        # Bearer token validation
│       └── gateway.ts     # Forwarding to Cloudflare AI Gateway
├── wrangler.jsonc         # Cloudflare Workers config
├── package.json
├── tsconfig.json
├── .dev.vars.example
└── sample_request.sh
```

---

## 🔑 Environment variables

| Var | Source | Description |
|-----|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | .dev.vars / Wrangler secret | Your Cloudflare account ID |
| `AI_JSON_CRYPTOKEN` | .dev.vars / Wrangler secret | Decryption token for ai.json.enc |
| `CLOUDFLARE_AIG_TOKEN` | .dev.vars / Wrangler secret | Cloudflare AI Gateway token |
| `DEBUG` | .dev.vars (optional) | `true` for verbose logs |

To deploy in production:

```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put AI_JSON_CRYPTOKEN
wrangler secret put CLOUDFLARE_AIG_TOKEN
```

---

## 🧪 Tests

See `vitest.config.mts` for test configuration.

```bash
npm test
```

---

## 📜 License

AGPL-3.0-or-later

Copyright © 2024-2026 Ronan LE MEILLAT

---

## Architecture overview

ai-proxy-cloudflare is a all-in-one AI proxy and vault manager for storing LLM API keys and record usage

### Stack

Cloudflare Worker+KV, TypeScript, Hono

---

## Project structure

```
└─ src
   ├─ index.ts
   ├─ lib
   │  ├─ ai-enc.ts
   │  ├─ auth.ts
   │  ├─ balance.ts
   │  ├─ gateway.ts
   │  ├─ groups.ts
   │  ├─ quota.ts
   │  ├─ universal.ts
   │  ├─ usage-db.ts
   │  └─ vaults.ts
   ├─ routes
   │  ├─ groups.ts
   │  └─ universal.ts
   └─ types
      └─ ai-config.ts
```

## Source code

### `src/index.ts`

**Exports:** isKeypoolAuthValid

```typescript
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
	persistVaultForAccess,
} from "./lib/vaults";
import { computeNextMistralReset, currentQuotaPeriodStart, isQuotaExhausted } from "./lib/quota";
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
	recordQuotaObservation,
	getQuotaObservations,
	type KeyUsageEntry,
	type KeyErrorEntry,
	type UsagePeriod,
	type Granularity,
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
		ASSETS: Fetcher;
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
			console.log(`GET /ai.json.enc with token: ${token}, groupId: ${ctx?.groupId}, vaultId: ${ctx?.vaultId}, isLegacy: ${ctx?.isLegacy}`);
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
 * Health check endpoint (kept for monitoring / load balancer probes).
 */
app.get("/health", (c) => {
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
 * Get usage statistics grouped by period and granularity.
 * Query params:
 *   - period (hour|day|week|month, default: day)
 *   - granularity (hour|day|week|month, optional)
 * Requires a valid user Bearer token.
 * 
 * ```bash
 * curl -X GET "https://your-worker-url/v1/keypool/stats?period=day&granularity=hour" \
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
	const granularity = c.req.query("granularity") as Granularity | undefined;
	const stats = await getUsageStats(env.USAGE_DO, userId, period, granularity);
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
	const authHeader = c.req.header("X-Proxy-Authorization") ? c.req.header("X-Proxy-Authorization") : c.req.header("X-Proxy-Authorization") ? c.req.header("X-Proxy-Authorization") : c.req.header("Authorization");
	console.log("Proxy request received with method:", c.req.method, "and URL:", c.req.url, " authenticated using header:", c.req.header("X-Proxy-Authorization") ? "X-Proxy-Authorization" : c.req.header("Authorization") ? "Authorization" : "None");
	const token = extractBearerToken(authHeader || null);
	if (!token) {
		return c.json({ error: "Unauthorized" }, { status: 403 });
	}
	const username = await validateUserKey(c.env.KV_AI_PROXY, token);
	if (!username) {
		return c.json({ error: "Invalid API key" }, { status: 403 });
	}
	console.log("CORS proxy authorized for user:", username);

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

		if (c.req.header("Authorization") && c.req.header("X-Proxy-Authorization")) {
			(init.headers as Record<string, string>)["Authorization"] = c.req.header("Authorization")!;
		}

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
		responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Proxy-Authorization");

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

/**
 * POST /v1/keypool/mistral/healthcheck
 *
 * Admin-only. Tests every non-expired, not-already-quota-flagged key on the
 * caller's "mistral" vault provider with a free `GET /v1/models` call (no
 * completion cost). Any key that comes back `401` is flagged
 * `quotaExhaustedAt`/`quotaResetAt` (reset = 1st of next UTC month) so it's
 * excluded from rotation and never handed to a real client request. Lets an
 * admin catch exhausted keys proactively instead of waiting for the 3-strike
 * passive detection in the universal proxy.
 * An optional parameter `?force=true` can be used to test all keys, even those already flagged	
 */
app.post("/v1/keypool/mistral/healthcheck", async (c) => {
	const authHeader = c.req.header("Authorization");
	const token = extractBearerToken(authHeader || null);
	if (!token) {
		return c.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	const force = c.req.query("force") === "true";

	const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
	if (!ctx) {
		return c.json({ error: "Invalid token" }, { status: 403 });
	}
	if (!isAdminRole(ctx.role)) {
		return c.json({ error: "Admin role required" }, { status: 403 });
	}

	let config: AiConfig;
	try {
		config = await loadConfigForContext(c.env, ctx, token);
	} catch (err) {
		return c.json(
			{ error: "Failed to load vault", message: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}

	const provider = config.providers["mistral"];
	if (!provider) {
		return c.json({ error: "No 'mistral' provider configured in this vault" }, { status: 404 });
	}

	const tested: string[] = [];
	const nowExhausted: string[] = [];
	const healthy: string[] = [];
	const now = new Date().toISOString();
	const observations: { keyOwner: string; keyHint: string; periodStart: string }[] = [];
	let changed = false;

  for (const key of provider.keys) {
		if (key.type === "expired" && !force) continue; // Skip expired keys unless forced
		const hint = `***${key.key.slice(-8)}`;
		tested.push(hint);

		try {
			const res = await fetch(`${provider.endpoint}/models`, {
				headers: { Authorization: `Bearer ${key.key}` },
				signal: AbortSignal.timeout(10_000),
			});
			if (res.status === 401) {
				observations.push({
					keyOwner: key.owner ?? "unknown",
					keyHint: hint,
					periodStart: currentQuotaPeriodStart(key.quotaResetAt),
				});
				key.quotaExhaustedAt = now;
				key.quotaResetAt = computeNextMistralReset();
				nowExhausted.push(hint);
				changed = true;
			} else {
				// Key is healthy - clear any existing exhaustion flags
				if (key.quotaExhaustedAt || key.quotaResetAt) {
					key.quotaExhaustedAt = undefined;
					key.quotaResetAt = undefined;
					changed = true;
				}
				healthy.push(hint);
			}
		} catch (err) {
			console.error(`Mistral healthcheck failed for key ${hint}:`, err);
		}
	}

	if (changed) {
		try {
			await persistVaultForAccess(c.env, ctx, token, config);
		} catch (err) {
			return c.json(
				{ error: "Tested keys but failed to persist vault", message: err instanceof Error ? err.message : String(err) },
				{ status: 500 },
			);
		}
	}
	if (nowExhausted.length > 0) {
		const statsUserId = ctx.groupId ? `group:${ctx.groupId}` : token;
		for (const obs of observations) {
			await recordQuotaObservation(c.env.USAGE_DO, statsUserId, {
				provider: "mistral",
				keyOwner: obs.keyOwner,
				keyHint: obs.keyHint,
				periodStart: obs.periodStart,
			});
		}
	}

	return c.json({ tested: tested.length, nowExhausted, healthy });
});

/**
 * GET /v1/keypool/quota-observations
 *
 * Returns recorded quota-exhaustion observations (usage-until-exhaustion
 * samples) for the caller's stats bucket, optionally filtered by provider.
 * Descriptive only — used to visualize how a key's real quota trends across
 * months, not yet consulted by key selection.
 */
app.get("/v1/keypool/quota-observations", async (c) => {
	const env = c.env;
	const identity = await resolveKeypoolIdentity(c, env);
	if ("error" in identity) {
		return c.json({ error: identity.error }, { status: identity.status });
	}

	const provider = c.req.query("provider") ?? undefined;
	const data = await getQuotaObservations(env.USAGE_DO, identity.userId, provider);
	return c.json({ object: "list", data });
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

/**
 * Serve static UI assets with SPA fallback.
 *
 * Catches all GET requests that did not match an API route above and tries to
 * serve a file from the ASSETS binding (built from ui/dist). When the asset is
 * not found (e.g. a client-side route like /settings), fall back to
 * index.html so the SPA router can handle it.
 */
app.get("/*", async (c) => {
	const resp = await c.env.ASSETS.fetch(c.req.raw);
	if (resp.status === 404) {
		const url = new URL(c.req.url);
		url.pathname = "/index.html";
		const indexResp = await c.env.ASSETS.fetch(new Request(url, c.req));
		if (indexResp.ok) return indexResp;
	}
	return resp;
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
    console.log('Migration v2 successful: default group created and users attached.  ');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

export default app;
export { UsageDbDurableObject } from "./lib/usage-db";
```

### `src/lib/ai-enc.ts`

**Exports:** decryptAiConfig, resolveProviderEndpoint, resolveModelId, pickKey, selectModel, encryptVault

```typescript
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
// AI configuration decryption utility
// Decrypts ai.json.enc using Web Crypto API (Node.js ≥18 & Cloudflare Workers)

import type { AiConfig, AiKey, AiModel, AiProvider } from '../types/ai-config';
import { isQuotaExhausted } from './quota';

/**
 * Decrypt ai.json.enc encrypted with:
 *   openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
 *     -in ai.json -out ai.json.enc -pass pass:"${CRYPTOKEN}"
 */
export async function decryptAiConfig(
  base64Ciphertext: string,
  password: string,
): Promise<AiConfig> {
  const raw = Uint8Array.from(atob(base64Ciphertext.trim()), c => c.charCodeAt(0));

  if (new TextDecoder().decode(raw.slice(0, 8)) !== 'Salted__') {
    throw new Error(
      'ai.json.enc: invalid format — expected OpenSSL "Salted__" header. ' +
      'Ensure file was encrypted with -a flag.',
    );
  }

  const salt = raw.slice(8, 16);
  const ciphertext = raw.slice(16);

  const pwBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384,
    ),
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    derived.slice(0, 32),
    'AES-CBC',
    false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: derived.slice(32, 48) },
    aesKey,
    ciphertext,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as AiConfig;
}

/**
 * Resolve the effective API endpoint for a provider.
 * When gateway is available, prefer it. Fall back to direct endpoint.
 */
export function resolveProviderEndpoint(
  provider: AiProvider,
  aigToken: string | undefined,
): { endpoint: string; useGateway: boolean } {
  if (aigToken && provider.gatewayEndpoint) {
    return { endpoint: provider.gatewayEndpoint, useGateway: true };
  }
  return { endpoint: provider.endpoint, useGateway: false };
}

/**
 * Build the model ID string for API requests.
 * Gateway routing requires "prefix/model-id" format.
 */
export function resolveModelId(
  modelId: string,
  provider: AiProvider,
  useGateway: boolean,
): string {
  if (useGateway && provider.gatewayModelPrefix) {
    const prefix = `${provider.gatewayModelPrefix}/`;
    if (modelId.startsWith(prefix)) return modelId;
    return `${provider.gatewayModelPrefix}/${modelId}`;
  }
  return modelId;
}

/**
 * Pick one API key at random (load-balancing).
 * Excludes expired and known quota-exhausted keys (see `quotaResetAt`).
 */
export function pickKey(provider: AiProvider): AiKey {
  const eligible = provider.keys.filter((k) => k.type !== 'expired' && !isQuotaExhausted(k));
  if (eligible.length === 0) {
    throw new Error('No API keys configured for provider');
  }
  return eligible[Math.floor(Math.random() * eligible.length)];
}

/**
 * Select the first available model from a provider.
 */
export function selectModel(provider: AiProvider): AiModel {
  if (provider.models.length === 0) {
    throw new Error('No models configured for provider');
  }
  // Sort by priority (lower = better) and pick first
  return provider.models.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Encrypt a vault configuration using the same algorithm as OpenSSL.
 * This is the reverse operation of decryptAiConfig.
 * each line is only 64 characters long, except the last line which may be shorter.
 *
 * @param plaintext - The JSON string to encrypt
 * @param password - The encryption password
 * @returns Base64-encoded OpenSSL-compatible ciphertext with "Salted__" header
 */
export async function encryptVault(
  plaintext: string,
  password: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const passwordBytes = encoder.encode(password);

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(8));

  // Derive key using PBKDF2 (same parameters as OpenSSL)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384 // 32 bytes for key + 16 bytes for IV
    )
  );

  // Extract key and IV
  const key = derived.slice(0, 32);
  const iv = derived.slice(32, 48);

  // Import AES key and encrypt
  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-CBC',
    false,
    ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    aesKey,
    data
  );

  // Build OpenSSL-compatible format: Salted__ + salt + ciphertext
  const saltedHeader = encoder.encode('Salted__');
  const result = new Uint8Array(
    saltedHeader.length + salt.length + encrypted.byteLength
  );
  result.set(saltedHeader, 0);
  result.set(salt, saltedHeader.length);
  result.set(new Uint8Array(encrypted), saltedHeader.length + salt.length);

  // Return as Base64
  const base64SingleLine = btoa(String.fromCharCode(...result));
  // Wrap at 64 characters per line
  const wrapped = base64SingleLine.match(/.{1,64}/g)?.join('\n') ?? '';
  return wrapped;
}

```

### `src/lib/auth.ts`

**Exports:** UserContext, isAdminRole, loadUserKeys, getUserContext, validateUserKey, extractBearerToken

```typescript
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
// User authentication and key validation

import { GroupRecord, UserRecord, UserRole } from '../types/ai-config';
import { loadGroups } from './groups';

/**
 * User context returned by getUserContext for management endpoints.
 */
export interface UserContext {
  username: string;
  vaultId: string;
  role: UserRole;
  isLegacy: boolean;
  /** Group the user belongs to (multi-group mode). */
  groupId?: string;
  /** Human-readable name of the user's group. */
  groupName?: string;
  /** Resolved group record (avoids a second KV read downstream). */
  group?: GroupRecord;
}

/** True for roles allowed to manage users and vault content. */
export function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

/**
 * Load user keys from KV or fallback to embedded data.
 */
export async function loadUserKeys(kv: KVNamespace): Promise<Record<string, UserRecord>> {
  try {
    const stored = await kv.get('users', 'json');
    if (stored) return stored as Record<string, UserRecord>;
  } catch (err) {
    console.error('Failed to load users from KV:', err);
  }
  // Fallback: return empty record
  return {};
}

/**
 * New function for management endpoints (GET/PUT /ai.json, user management).
 * Does NOT affect the proxy's `validateUserKey`.
 */
export async function getUserContext(
  kv: KVNamespace,
  bearerToken: string | null,
  cryptoToken: string
): Promise<UserContext | null> {
  if (!bearerToken) return null;

  const users = await loadUserKeys(kv);

  // 1. Check against 'users' KV first (multi-user mode)
  for (const [username, record] of Object.entries(users)) {
    if (record.key === bearerToken) {
      const role: UserRole = (record.role as UserRole) || 'user';

      // Multi-group mode: groupId takes precedence over per-user vaultId
      if (record.groupId) {
        const groups = await loadGroups(kv);
        const group = groups[record.groupId];
        return {
          username,
          vaultId: `group:${record.groupId}`,
          role,
          isLegacy: false,
          groupId: record.groupId,
          groupName: group?.name,
          group,
        };
      }

      return {
        username,
        vaultId: record.vaultId || 'legacy',
        role,
        isLegacy: !record.vaultId,
      };
    }
  }

  // 2. Fallback to legacy master token — always superadmin
  if (bearerToken === cryptoToken) {
    return {
      username: 'legacy_admin',
      vaultId: 'legacy',
      role: 'superadmin',
      isLegacy: true,
    };
  }

  return null;
}

/**
 * Validate user API key against stored records.
 * Returns the username if valid, null otherwise.
 */
export async function validateUserKey(
  kv: KVNamespace,
  bearerToken: string,
): Promise<string | null> {
  const users = await loadUserKeys(kv);

  for (const [username, record] of Object.entries(users)) {
    if (record.key === bearerToken) {
      return username;
    }
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header.
 * Returns the token value or null if missing/invalid.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
```

### `src/lib/balance.ts`

**Exports:** checkBalance, deductBalance

```typescript
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
// Balance integration with Fufuni merchant backend.
// All functions are no-ops when FUFUNI_MERCHANT_URL is unset, ensuring the
// proxy works in standalone mode without any Fufuni dependency.

interface BalanceEnv {
  FUFUNI_MERCHANT_URL?: string;
  AI_BALANCE_SHARED_SECRET?: string;
}

/**
 * Check the remaining AI token balance for the given API key.
 *
 * @returns Token units remaining, or null when the balance feature is not
 *          configured (proxy operates without balance enforcement).
 */
export async function checkBalance(apiKey: string, env: BalanceEnv): Promise<number | null> {
  if (!env.FUFUNI_MERCHANT_URL || !env.AI_BALANCE_SHARED_SECRET) return null;

  try {
    const url = `${env.FUFUNI_MERCHANT_URL}/v1/ai-tokens/proxy/balance/${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.AI_BALANCE_SHARED_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`Balance check failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json<{ balance: number }>();
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (err) {
    console.warn('Balance check error (allowing request):', err);
    return null;
  }
}

/**
 * Deduct token units from the account after a successful AI request.
 * This is fire-and-forget — failures are logged but never thrown.
 *
 * @param apiKey  - The API key that consumed the tokens
 * @param units   - Number of token units to deduct (typically 1 per request)
 * @param env     - Worker environment bindings
 */
export async function deductBalance(apiKey: string, units: number, env: BalanceEnv): Promise<void> {
  if (!env.FUFUNI_MERCHANT_URL || !env.AI_BALANCE_SHARED_SECRET) return;

  try {
    const url = `${env.FUFUNI_MERCHANT_URL}/v1/ai-tokens/proxy/deduct`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_BALANCE_SHARED_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey, units }),
    });

    if (!res.ok) {
      console.warn(`Balance deduction failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('Balance deduction error (non-fatal):', err);
  }
}
```

### `src/lib/gateway.ts`

**Exports:** GatewayForwardRequest, forwardToCfAiGateway, detectProvider

```typescript
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
// Forward requests to Cloudflare AI Gateway

import type { AiConfig, AiModel, AiProvider } from '../types/ai-config';
import { resolveProviderEndpoint, resolveModelId, pickKey } from './ai-enc';

export interface GatewayForwardRequest {
  model: string;
  messages?: Array<{ role: string; content: string }>;
  input?: string;
  [key: string]: any;
}

interface ForwardResult {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | string;
  headers: Record<string, string>;
}

/**
 * Forward a chat completion request to Cloudflare AI Gateway.
 * Handles model ID prefixing, authentication, and streaming.
 */
export async function forwardToCfAiGateway(
  request: Request,
  payload: GatewayForwardRequest,
  provider: AiProvider,
  config: {
    accountId: string;
    aigToken: string;
    providerKey?: string;
    modelUsage?: AiModel['usage'];
    debug?: boolean;
  },
): Promise<Response> {
  const { endpoint, useGateway } = resolveProviderEndpoint(provider, config.aigToken);

  if (!useGateway) {
    throw new Error(
      'Gateway endpoint not configured for this provider. ' +
      'Check ai.json configuration.',
    );
  }

  // Build gateway URL
  const gatewayUrl = new URL(endpoint);
  const requestPath = new URL(request.url).pathname;
  const compatPathSuffix = config.modelUsage === 'tts'
    ? '/audio/speech'
    : requestPath.endsWith('/audio/speech')
      ? '/audio/speech'
      : requestPath.endsWith('/chat/completions')
        ? '/chat/completions'
        : config.modelUsage === 'chat' || config.modelUsage === undefined
          ? '/chat/completions'
          : null;

  if (!compatPathSuffix) {
    throw new Error(`Unsupported compatibility route: ${requestPath}`);
  }

  const basePath = gatewayUrl.pathname.replace('{account}', config.accountId).replace(/\/$/, '');
  gatewayUrl.pathname = basePath.endsWith(compatPathSuffix)
    ? basePath
    : `${basePath}${compatPathSuffix}`;

  // Resolve and prefix model ID
  const modelId = resolveModelId(payload.model, provider, true);

  // Pick an API key from the provider
  const keyObj = pickKey(provider);

  // Prepare request headers
  const headers = new Headers({
    'Content-Type': 'application/json',
    'cf-aig-authorization': `Bearer ${config.aigToken}`,
    'Authorization': `Bearer ${keyObj.key}`,
  });

  // Preserve streaming preference
  const isStream = payload.stream === true;

  // Build the forwarded payload
  const forwardPayload = {
    ...payload,
    model: modelId,
    stream: isStream,
  };

  if (config.debug) {
    console.log('[ai-proxy] gateway-forward', JSON.stringify({
      requestPath,
      provider: config.providerKey ?? 'unknown',
      gatewayUrl: gatewayUrl.toString(),
        useGateway,
        model: modelId,
        modelUsage: config.modelUsage ?? 'chat',
        stream: isStream,
      }));
  }

  // Forward the request
  const response = await fetch(gatewayUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(forwardPayload),
  });

  if (config.debug) {
    console.log('[ai-proxy] gateway-response', JSON.stringify({
      requestPath,
      provider: config.providerKey ?? 'unknown',
      gatewayUrl: gatewayUrl.toString(),
      status: response.status,
      ok: response.ok,
    }));
  }

  // If streaming, return the response as-is
  if (isStream && response.ok) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }),
    });
  }

  // Non-streaming: preserve the upstream body and content type.
  // Some providers (for example Groq TTS) return raw audio bytes directly.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

/**
 * Detect provider from request path or X-Host-Final header.
 */
export function detectProvider(
  pathname: string,
  xHostFinal: string | null,
  config: AiConfig,
): { key: string; provider: AiProvider } | null {
  // Try X-Host-Final header first (legacy compatibility)
  if (xHostFinal) {
    const hostMap: Record<string, string> = {
      'api.groq.com': 'groq',
      'api.sambanova.ai': 'sambanova',
      'api.anthropic.com': 'anthropic',
      'api.openai.com': 'openai',
      'generativelanguage.googleapis.com': 'gemini',
      'api.mistral.ai': 'mistral',
      'openrouter.ai': 'openrouter',
      'api.morphllm.com': 'morph',
    };

    for (const [host, providerKey] of Object.entries(hostMap)) {
      if (xHostFinal.includes(host)) {
        const provider = config.providers[providerKey];
        if (provider) {
          return { key: providerKey, provider };
        }
      }
    }
  }

  // Try path-based detection
  if (pathname.includes('/groq/')) {
    const provider = config.providers['groq'];
    if (provider) return { key: 'groq', provider };
  }

  if (pathname.includes('/sambanova/') || pathname.includes('/sambanova-ai/')) {
    const provider = config.providers['sambanova'];
    if (provider) return { key: 'sambanova', provider };
  }

  if (pathname.includes('/anthropic/')) {
    const provider = config.providers['anthropic'];
    if (provider) return { key: 'anthropic', provider };
  }

  if (pathname.includes('/openai/')) {
    const provider = config.providers['openai'];
    if (provider) return { key: 'openai', provider };
  }

  if (pathname.includes('/gemini/')) {
    const provider = config.providers['gemini'];
    if (provider) return { key: 'gemini', provider };
  }

  if (pathname.includes('/mistral/')) {
    const provider = config.providers['mistral'];
    if (provider) return { key: 'mistral', provider };
  }

  if (pathname.includes('/openrouter/')) {
    const provider = config.providers['openrouter'];
    if (provider) return { key: 'openrouter', provider };
  }

  if (pathname.includes('/morph/')) {
    const provider = config.providers['morph'];
    if (provider) return { key: 'morph', provider };
  }

  return null;
}
```

### `src/lib/groups.ts`

**Exports:** GROUPS_KV_KEY, DEFAULT_GROUP_ID, LEGACY_VAULT_KV_KEY, BYOK_KV_KEY, deriveGroupSecret, getGroupVaultPassword, groupVaultKvKey, loadGroups, saveGroups, createGroupVaultTemplate, isValidGroupId, slugifyGroupId

```typescript
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
// Multi-group support: group records, derived vault secrets, vault template.

import type { AiConfig, GroupRecord } from '../types/ai-config';

/** KV key holding the Record<groupId, GroupRecord> map. */
export const GROUPS_KV_KEY = 'groups';

/** Group ID of the migrated legacy vault. */
export const DEFAULT_GROUP_ID = 'default';

/** KV key of the historical single vault. */
export const LEGACY_VAULT_KV_KEY = 'vault:ai.json.enc';

/** KV key where the BYOK template (new-group vault seed) is stored. */
export const BYOK_KV_KEY = 'vault:byok';

/**
 * Derive the vault encryption secret for a group from the master crypto token.
 * HKDF-SHA256(ikm = AI_JSON_CRYPTOKEN, salt = fixed, info = groupId) → 32 bytes hex.
 * Nothing needs to be stored: possession of the master secret and the group ID
 * is enough to re-derive the vault password.
 */
export async function deriveGroupSecret(masterSecret: string, groupId: string): Promise<string> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterSecret),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('ai-proxy-group-vault-v1'),
        info: encoder.encode(groupId),
      },
      baseKey,
      256,
    ),
  );
  return Array.from(bits, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolve the effective vault password for a group.
 * The legacy group keeps the master token so the historical blob stays readable
 * by every pre-existing consumer.
 */
export async function getGroupVaultPassword(
  masterSecret: string,
  groupId: string,
  group: GroupRecord,
): Promise<string> {
  if (group.legacy) return masterSecret;
  return deriveGroupSecret(masterSecret, groupId);
}

/** KV key storing a group's encrypted vault. */
export function groupVaultKvKey(groupId: string, group: GroupRecord): string {
  if (group.legacy) return LEGACY_VAULT_KV_KEY;
  return `vault:group:${groupId}`;
}

/** Load the groups map from KV (empty map when unset). */
export async function loadGroups(kv: KVNamespace): Promise<Record<string, GroupRecord>> {
  try {
    const stored = await kv.get(GROUPS_KV_KEY, 'json');
    if (stored) return stored as Record<string, GroupRecord>;
  } catch (err) {
    console.error('Failed to load groups from KV:', err);
  }
  return {};
}

/** Persist the groups map to KV. */
export async function saveGroups(kv: KVNamespace, groups: Record<string, GroupRecord>): Promise<void> {
  await kv.put(GROUPS_KV_KEY, JSON.stringify(groups));
}

/**
 * Build the initial vault of a new group: the BYOK template (providers, models,
 * crawlers, weather API) with every key list emptied.
 */
export function createGroupVaultTemplate(byokTemplate: AiConfig | null): AiConfig {
  if (!byokTemplate) {
    return { version: 1, providers: {}, crawlers: {} };
  }
  const template: AiConfig = JSON.parse(JSON.stringify(byokTemplate));
  for (const provider of Object.values(template.providers ?? {})) {
    provider.keys = [];
  }
  for (const crawler of Object.values(template.crawlers ?? {})) {
    crawler.keys = [];
  }
  if (template.weatherApi) {
    template.weatherApi.keys = [];
  }
  return template;
}

/**
 * Validate a candidate group ID: short slug usable in KV keys and URLs.
 */
export function isValidGroupId(groupId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(groupId);
}

/** Derive a slug group ID from a human-readable name. */
export function slugifyGroupId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
```

### `src/lib/quota.ts`

**Exports:** computeNextMistralReset, isQuotaExhausted, currentQuotaPeriodStart

```typescript
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
// Quota-exhaustion helpers for AiKey.quotaResetAt / quotaExhaustedAt.
// Mistral (currently the only provider this applies to) resets free-tier
// monthly quotas on the 1st of the calendar month at 00:00 UTC.

import type { AiKey } from '../types/ai-config';

/** ISO 8601 timestamp of the 1st of next UTC calendar month at 00:00Z. */
export function computeNextMistralReset(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString();
}

/** True if this key is known to be quota-exhausted right now (resetAt in the future). */
export function isQuotaExhausted(key: Pick<AiKey, 'quotaResetAt'>, now: Date = new Date()): boolean {
  return !!key.quotaResetAt && now.getTime() < Date.parse(key.quotaResetAt);
}

/**
 * Start of the quota period a newly-detected exhaustion belongs to: the
 * key's previous `quotaResetAt` (the boundary of the cycle now ending), or
 * the start of the current UTC month if the key had never been flagged
 * before. Used to sum usage-until-exhaustion for `quota_observations`.
 */
export function currentQuotaPeriodStart(previousQuotaResetAt: string | undefined, now: Date = new Date()): string {
  if (previousQuotaResetAt) return previousQuotaResetAt;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}
```

### `src/lib/universal.ts`

**Exports:** OpenAiContentPart, OpenAiToolCall, OpenAiChatMessage, OpenAiTool, OpenAiChatRequest, UniversalGatewayInput, openAiToGatewayInput, collectOpenAiCompletion, openAiSseStream

```typescript
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
// OpenAI-compatible ⇄ Cline gateway adapters for the universal endpoint.
// Inbound: OpenAI chat/completions JSON → GatewayStreamRequest fields.
// Outbound: AgentModelEvent stream → OpenAI SSE chunks / completion object.

import type {
	AgentMessage,
	AgentMessagePart,
	AgentModelEvent,
	AgentToolDefinition,
} from '@sctg/cline-llms';

// ─── OpenAI wire types (minimal subset) ───────────────────────────────────────

export interface OpenAiContentPart {
	type: string;
	text?: string;
	image_url?: { url: string };
}

export interface OpenAiToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface OpenAiChatMessage {
	role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
	content: string | OpenAiContentPart[] | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface OpenAiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface OpenAiChatRequest {
	model: string;
	messages: OpenAiChatMessage[];
	tools?: OpenAiTool[];
	temperature?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
	stream?: boolean;
	stream_options?: { include_usage?: boolean };
}

export interface UniversalGatewayInput {
	modelId: string;
	systemPrompt?: string;
	messages: AgentMessage[];
	tools?: AgentToolDefinition[];
	temperature?: number;
	maxTokens?: number;
}

// ─── Inbound: OpenAI → gateway ────────────────────────────────────────────────

function textOfContent(content: OpenAiChatMessage['content']): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((p) => p.type === 'text' && typeof p.text === 'string')
			.map((p) => p.text)
			.join('');
	}
	return '';
}

function userParts(content: OpenAiChatMessage['content']): AgentMessagePart[] {
	if (typeof content === 'string') {
		return [{ type: 'text', text: content }];
	}
	const parts: AgentMessagePart[] = [];
	for (const p of content ?? []) {
		if (p.type === 'text' && typeof p.text === 'string') {
			parts.push({ type: 'text', text: p.text });
		} else if (p.type === 'image_url' && p.image_url?.url) {
			parts.push({ type: 'image', image: p.image_url.url });
		}
	}
	return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

/**
 * Translate an OpenAI chat/completions payload into the Cline gateway shape.
 * The `model` field carries the keypoollive composite ID (`provider/modelId`).
 */
export function openAiToGatewayInput(payload: OpenAiChatRequest): UniversalGatewayInput {
	const systemChunks: string[] = [];
	const messages: AgentMessage[] = [];
	// OpenAI `tool` role messages reference a tool_call_id; the tool name lives
	// on the originating assistant message, so track it while iterating.
	const toolNamesById = new Map<string, string>();
	const now = Date.now();
	let index = 0;

	for (const message of payload.messages ?? []) {
		const id = `msg-${index++}`;
		switch (message.role) {
			case 'system':
			case 'developer':
				systemChunks.push(textOfContent(message.content));
				break;
			case 'user':
				messages.push({ id, role: 'user', content: userParts(message.content), createdAt: now });
				break;
			case 'assistant': {
				const parts: AgentMessagePart[] = [];
				const text = textOfContent(message.content);
				if (text) parts.push({ type: 'text', text });
				for (const call of message.tool_calls ?? []) {
					toolNamesById.set(call.id, call.function.name);
					let input: unknown = call.function.arguments;
					try {
						input = JSON.parse(call.function.arguments || '{}');
					} catch {
						// keep raw string when arguments are not valid JSON
					}
					parts.push({
						type: 'tool-call',
						toolCallId: call.id,
						toolName: call.function.name,
						input,
					});
				}
				if (parts.length > 0) {
					messages.push({ id, role: 'assistant', content: parts, createdAt: now });
				}
				break;
			}
			case 'tool': {
				const toolCallId = message.tool_call_id ?? '';
				messages.push({
					id,
					role: 'tool',
					content: [
						{
							type: 'tool-result',
							toolCallId,
							toolName: message.name ?? toolNamesById.get(toolCallId) ?? 'unknown',
							output: textOfContent(message.content),
						},
					],
					createdAt: now,
				});
				break;
			}
		}
	}

	const tools: AgentToolDefinition[] | undefined = payload.tools?.map((tool) => ({
		name: tool.function.name,
		description: tool.function.description ?? '',
		inputSchema: tool.function.parameters ?? { type: 'object', properties: {} },
	}));

	return {
		modelId: payload.model,
		systemPrompt: systemChunks.filter(Boolean).join('\n\n') || undefined,
		messages,
		tools: tools?.length ? tools : undefined,
		temperature: payload.temperature,
		maxTokens: payload.max_completion_tokens ?? payload.max_tokens,
	};
}

// ─── Outbound: gateway events → OpenAI ────────────────────────────────────────

type OpenAiFinishReason = 'stop' | 'length' | 'tool_calls' | null;

function mapFinishReason(reason: string): OpenAiFinishReason {
	switch (reason) {
		case 'tool-calls':
			return 'tool_calls';
		case 'max-tokens':
			return 'length';
		default:
			return 'stop';
	}
}

interface AccumulatedToolCall {
	id: string;
	name: string;
	arguments: string;
}

interface AccumulatedCompletion {
	content: string;
	reasoning: string;
	toolCalls: AccumulatedToolCall[];
	finishReason: OpenAiFinishReason;
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function newUsage() {
	return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/**
 * Consume the full gateway stream and build a non-streaming OpenAI
 * chat.completion response body.
 */
export async function collectOpenAiCompletion(
	events: AsyncIterable<AgentModelEvent>,
	model: string,
	completionId: string,
): Promise<Record<string, unknown>> {
	const acc: AccumulatedCompletion = {
		content: '',
		reasoning: '',
		toolCalls: [],
		finishReason: null,
		usage: newUsage(),
	};
	const callsById = new Map<string, AccumulatedToolCall>();

	for await (const event of events) {
		switch (event.type) {
			case 'text-delta':
				acc.content += event.text;
				break;
			case 'reasoning-delta':
				acc.reasoning += event.text;
				break;
			case 'tool-call-delta': {
				const callId = event.toolCallId ?? `call_${callsById.size}`;
				let call = callsById.get(callId);
				if (!call) {
					call = { id: callId, name: event.toolName ?? '', arguments: '' };
					callsById.set(callId, call);
					acc.toolCalls.push(call);
				}
				if (event.toolName) call.name = event.toolName;
				if (typeof event.inputText === 'string') {
					call.arguments += event.inputText;
				} else if (event.input !== undefined) {
					call.arguments = JSON.stringify(event.input);
				}
				break;
			}
			case 'usage':
				acc.usage.prompt_tokens += event.usage.inputTokens ?? 0;
				acc.usage.completion_tokens += event.usage.outputTokens ?? 0;
				break;
			case 'finish':
				if (event.reason === 'error') {
					throw new Error(event.error || 'Stream finished with error');
				}
				acc.finishReason = mapFinishReason(event.reason);
				break;
		}
	}

	acc.usage.total_tokens = acc.usage.prompt_tokens + acc.usage.completion_tokens;

	const message: Record<string, unknown> = {
		role: 'assistant',
		content: acc.content || (acc.toolCalls.length > 0 ? null : ''),
	};
	if (acc.reasoning) {
		message.reasoning_content = acc.reasoning;
	}
	if (acc.toolCalls.length > 0) {
		message.tool_calls = acc.toolCalls.map((call) => ({
			id: call.id,
			type: 'function',
			function: { name: call.name, arguments: call.arguments },
		}));
		if (!acc.finishReason) acc.finishReason = 'tool_calls';
	}

	return {
		id: completionId,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message,
				finish_reason: acc.finishReason ?? 'stop',
			},
		],
		usage: acc.usage,
	};
}

/**
 * Convert the gateway stream into an OpenAI-compatible SSE body.
 * Emits `chat.completion.chunk` objects, an optional usage chunk, and the
 * terminal `[DONE]` sentinel. Provider errors surface as an SSE `error` object
 * (after which the stream terminates) so clients do not hang.
 */
export function openAiSseStream(
	events: AsyncIterable<AgentModelEvent>,
	model: string,
	completionId: string,
	includeUsage: boolean,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const created = Math.floor(Date.now() / 1000);
	const usage = newUsage();
	const toolCallIndexes = new Map<string, number>();
	let firstChunk = true;
	let finishReason: OpenAiFinishReason = null;
	let sawToolCall = false;

	function chunk(delta: Record<string, unknown>, finish: OpenAiFinishReason = null): string {
		const body = {
			id: completionId,
			object: 'chat.completion.chunk',
			created,
			model,
			choices: [{ index: 0, delta, finish_reason: finish }],
		};
		return `data: ${JSON.stringify(body)}\n\n`;
	}

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (text: string) => controller.enqueue(encoder.encode(text));
			try {
				for await (const event of events) {
					const withRole = (delta: Record<string, unknown>) => {
						if (firstChunk) {
							firstChunk = false;
							return { role: 'assistant', ...delta };
						}
						return delta;
					};
					switch (event.type) {
						case 'text-delta':
							if (event.text) send(chunk(withRole({ content: event.text })));
							break;
						case 'reasoning-delta':
							if (event.text) send(chunk(withRole({ reasoning_content: event.text })));
							break;
						case 'tool-call-delta': {
							sawToolCall = true;
							const callId = event.toolCallId ?? `call_${toolCallIndexes.size}`;
							let index = toolCallIndexes.get(callId);
							const isNew = index === undefined;
							if (index === undefined) {
								index = toolCallIndexes.size;
								toolCallIndexes.set(callId, index);
							}
							const fn: Record<string, unknown> = {};
							if (isNew && event.toolName) fn.name = event.toolName;
							if (typeof event.inputText === 'string') {
								fn.arguments = event.inputText;
							} else if (event.input !== undefined) {
								fn.arguments = JSON.stringify(event.input);
							}
							send(
								chunk(
									withRole({
										tool_calls: [
											{
												index,
												...(isNew ? { id: callId, type: 'function' } : {}),
												function: fn,
											},
										],
									}),
								),
							);
							break;
						}
						case 'usage':
							usage.prompt_tokens += event.usage.inputTokens ?? 0;
							usage.completion_tokens += event.usage.outputTokens ?? 0;
							break;
						case 'finish':
							if (event.reason === 'error') {
								throw new Error(event.error || 'Stream finished with error');
							}
							finishReason = mapFinishReason(event.reason);
							break;
					}
				}

				// Terminal chunk with the finish reason
				send(chunk({}, finishReason ?? (sawToolCall ? 'tool_calls' : 'stop')));

				if (includeUsage) {
					usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
					send(
						`data: ${JSON.stringify({
							id: completionId,
							object: 'chat.completion.chunk',
							created,
							model,
							choices: [],
							usage,
						})}\n\n`,
					);
				}
				send('data: [DONE]\n\n');
				controller.close();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				try {
					send(
						`data: ${JSON.stringify({
							error: { message, type: 'upstream_error', code: null },
						})}\n\n`,
					);
					send('data: [DONE]\n\n');
					controller.close();
				} catch {
					controller.error(err);
				}
			}
		},
	});
}
```

### `src/lib/usage-db.ts`

**Exports:** UsagePeriod, Granularity, KeyUsageEntry, KeyErrorEntry, KeyUsageStat, MigrateResult, KeyErrorStat, QuotaObservationEntry, QuotaObservationStat, getUserIdFromAuth, UsageDbDurableObject, recordUsage, recordError, getUsageStats, getErrorStats, recordQuotaObservation, getQuotaObservations, migrateUsageNdjson, migrateErrorNdjson, purge, getFileSizeBytes

```typescript
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

/**
 * Recorded whenever a key is newly flagged quota-exhausted. `periodStart` is
 * the previous `quotaResetAt` (or start of the current UTC month if the key
 * had never been flagged before) — the observation sums `usage_hourly` for
 * that key from `periodStart` up to the moment of exhaustion, giving a
 * sample of "how much usage this key's quota actually allows".
 */
export interface QuotaObservationEntry {
	provider: string;
	keyOwner: string;
	keyHint: string;
	periodStart: string;
}

/** One recorded quota-exhaustion observation, as read back for display. */
export interface QuotaObservationStat {
	provider: string;
	keyOwner: string;
	keyHint: string;
	observedAt: string;
	periodStart: string;
	promptTokens: number;
	completionTokens: number;
	requestCount: number;
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

		// One row per detected quota exhaustion, sampling usage-until-exhaustion
		// so the trend can be tracked across months (see recordQuotaObservation).
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS quota_observations (
				provider TEXT NOT NULL,
				key_owner TEXT NOT NULL,
				key_hint TEXT NOT NULL,
				observed_at INTEGER NOT NULL,
				period_start TEXT NOT NULL,
				prompt_tokens INTEGER NOT NULL DEFAULT 0,
				completion_tokens INTEGER NOT NULL DEFAULT 0,
				request_count INTEGER NOT NULL DEFAULT 0
			);
		`);

		// Indexes for faster queries
		this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_usage_hourly_period ON usage_hourly(period_hour);`);
		this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_errors_hourly_period ON errors_hourly(period_hour);`);
		this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_quota_observations_provider ON quota_observations(provider, observed_at);`);
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
	 * Records one quota-exhaustion sample: sums `usage_hourly` for this key
	 * from `entry.periodStart` to now and inserts it as a `quota_observations`
	 * row. Called whenever a key is newly flagged exhausted (passive 3-strike
	 * detection or the admin health-check), never on every request.
	 */
	async recordQuotaObservation(entry: QuotaObservationEntry): Promise<void> {
		const periodStartHour = formatPeriodLabel(Date.parse(entry.periodStart), "hour");

		const cursor = this.sql.exec(
			`SELECT
				COALESCE(SUM(prompt_tokens), 0) as promptTokens,
				COALESCE(SUM(completion_tokens), 0) as completionTokens,
				COALESCE(SUM(request_count), 0) as requestCount
			 FROM usage_hourly
			 WHERE provider = ? AND key_hint = ? AND period_hour >= ?`,
			entry.provider,
			entry.keyHint,
			periodStartHour,
		);
		const row = cursor.toArray()[0] as
			| { promptTokens: number; completionTokens: number; requestCount: number }
			| undefined;

		this.sql.exec(
			`INSERT INTO quota_observations (
				provider, key_owner, key_hint, observed_at, period_start,
				prompt_tokens, completion_tokens, request_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			entry.provider,
			entry.keyOwner,
			entry.keyHint,
			Date.now(),
			entry.periodStart,
			row?.promptTokens ?? 0,
			row?.completionTokens ?? 0,
			row?.requestCount ?? 0,
		);
	}

	/**
	 * Reads back recorded quota-exhaustion observations, most recent first.
	 */
	async getQuotaObservations(provider?: string): Promise<QuotaObservationStat[]> {
		const cursor = provider
			? this.sql.exec(
					`SELECT * FROM quota_observations WHERE provider = ? ORDER BY observed_at DESC`,
					provider,
				)
			: this.sql.exec(`SELECT * FROM quota_observations ORDER BY observed_at DESC`);

		const result: QuotaObservationStat[] = [];
		for (const row of cursor) {
			result.push({
				provider: row.provider,
				keyOwner: row.key_owner,
				keyHint: row.key_hint,
				observedAt: new Date(row.observed_at).toISOString(),
				periodStart: row.period_start,
				promptTokens: row.prompt_tokens,
				completionTokens: row.completion_tokens,
				requestCount: row.request_count,
			});
		}
		return result;
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
 * Records a quota-exhaustion observation (usage-until-exhaustion sample).
 * Uses Durable Object SQLite storage. Best-effort: a failure here must not
 * break the request/health-check that triggered it.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param entry - Provider/key/periodStart describing the observation window
 */
export async function recordQuotaObservation(
	usageDo: DurableObjectNamespace,
	userId: string,
	entry: QuotaObservationEntry,
): Promise<void> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		await stub.recordQuotaObservation(entry);
	} catch (e) {
		console.error("[usage-db] Failed to record quota observation:", e);
	}
}

/**
 * Reads back recorded quota-exhaustion observations, most recent first.
 * Uses Durable Object SQLite storage.
 *
 * @param usageDo - Durable Object namespace
 * @param userId - User identifier (Bearer token)
 * @param provider - Optional provider filter (e.g. "mistral")
 */
export async function getQuotaObservations(
	usageDo: DurableObjectNamespace,
	userId: string,
	provider?: string,
): Promise<QuotaObservationStat[]> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.getQuotaObservations(provider);
	} catch (e) {
		console.error("[usage-db] Failed to get quota observations:", e);
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
```

### `src/lib/vaults.ts`

**Exports:** invalidateVaultCache, loadAiConfig, loadGroupConfig, saveGroupConfig, persistVaultForAccess

```typescript
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
// Vault loading/saving with a per-isolate decrypted-config cache.
// Handles the three vault flavors: legacy blob, per-user vaults, group vaults.

import { decryptAiConfig, encryptVault } from './ai-enc';
import {
  getGroupVaultPassword,
  groupVaultKvKey,
  LEGACY_VAULT_KV_KEY,
} from './groups';
import type { AiConfig, GroupRecord } from '../types/ai-config';
import type { UserContext } from './auth';

/**
 * In-memory cache of decrypted AI configurations.
 * Keys: 'legacy', '<vaultId>' (per-user vaults) or 'group:<groupId>'.
 * Cleared after a successful PUT to force re-decryption with the new blob.
 */
const cachedConfigs = new Map<string, AiConfig>();

/** Drop a cached decrypted config (after a vault write). */
export function invalidateVaultCache(cacheKey: string): void {
  cachedConfigs.delete(cacheKey);
}

/**
 * Load a legacy or per-user AI configuration vault by ID.
 * Caches decrypted configurations in memory per vaultId.
 *
 * @param env - Worker environment bindings
 * @param vaultId - ID of the vault to load ('legacy' or custom ID)
 * @param password - Password used to decrypt the vault (the user's token)
 */
export async function loadAiConfig(
  env: Env,
  vaultId: string,
  password: string,
): Promise<AiConfig> {
  const cacheKey = vaultId;
  if (cachedConfigs.has(cacheKey)) {
    return cachedConfigs.get(cacheKey)!;
  }

  const kvKey = vaultId === 'legacy' ? LEGACY_VAULT_KV_KEY : `vault:${vaultId}`;
  const encryptedPayload = await env.KV_AI_PROXY.get(kvKey);
  if (!encryptedPayload) {
    throw new Error(`Vault "${vaultId}" not found in KV`);
  }

  const decrypted = await decryptAiConfig(encryptedPayload, password);
  cachedConfigs.set(cacheKey, decrypted);
  return decrypted;
}

/**
 * Load and decrypt a group vault using the group-derived secret.
 */
export async function loadGroupConfig(
  env: Env,
  groupId: string,
  group: GroupRecord,
): Promise<AiConfig> {
  const cacheKey = `group:${groupId}`;
  if (cachedConfigs.has(cacheKey)) {
    return cachedConfigs.get(cacheKey)!;
  }

  const encryptedPayload = await env.KV_AI_PROXY.get(groupVaultKvKey(groupId, group));
  if (!encryptedPayload) {
    throw new Error(`Vault for group "${groupId}" not found in KV`);
  }

  const password = await getGroupVaultPassword(env.AI_JSON_CRYPTOKEN, groupId, group);
  const decrypted = await decryptAiConfig(encryptedPayload, password);
  cachedConfigs.set(cacheKey, decrypted);
  return decrypted;
}

/**
 * Encrypt and persist a group vault with the group-derived secret,
 * then invalidate the cache entry.
 */
export async function saveGroupConfig(
  env: Env,
  groupId: string,
  group: GroupRecord,
  config: AiConfig,
): Promise<void> {
  const password = await getGroupVaultPassword(env.AI_JSON_CRYPTOKEN, groupId, group);
  const encrypted = await encryptVault(JSON.stringify(config), password);
  await env.KV_AI_PROXY.put(groupVaultKvKey(groupId, group), encrypted);
  invalidateVaultCache(`group:${groupId}`);
  if (group.legacy) {
    invalidateVaultCache('legacy');
  }
}

/**
 * Encrypt and persist an already-decrypted config for whichever vault flavor
 * `ctx` resolves to (group / legacy / per-user), then invalidate the right
 * cache entry. This is the write-side counterpart of `resolveVaultAccess` in
 * `routes/universal.ts` and mirrors the branching in the `PUT /ai.json.enc`
 * handler, so server-side code that has already decrypted+patched a config
 * in memory (e.g. auto-detected quota exhaustion, the admin health-check)
 * doesn't need to re-derive the per-flavor password/KV-key logic.
 *
 * @param token - Caller's bearer token; used as the encryption password for
 *   per-user vaults (matches how those vaults are encrypted on write today).
 */
export async function persistVaultForAccess(
  env: Env,
  ctx: UserContext,
  token: string,
  config: AiConfig,
): Promise<void> {
  if (ctx.groupId && ctx.group) {
    await saveGroupConfig(env, ctx.groupId, ctx.group, config);
    return;
  }

  if (ctx.isLegacy) {
    const encrypted = await encryptVault(JSON.stringify(config), env.AI_JSON_CRYPTOKEN);
    await env.KV_AI_PROXY.put(LEGACY_VAULT_KV_KEY, encrypted);
    invalidateVaultCache('legacy');
    return;
  }

  const encrypted = await encryptVault(JSON.stringify(config), token);
  await env.KV_AI_PROXY.put(`vault:${ctx.vaultId}`, encrypted);
  invalidateVaultCache(ctx.vaultId);
}
```

### `src/routes/groups.ts`

```typescript
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
// /v1/groups — group and per-group user management.
// superadmin: all groups; admin: users of their own group.

import { Hono } from 'hono';

import { extractBearerToken, getUserContext, loadUserKeys, type UserContext } from '../lib/auth';
import {
  BYOK_KV_KEY,
  createGroupVaultTemplate,
  groupVaultKvKey,
  isValidGroupId,
  loadGroups,
  saveGroups,
  slugifyGroupId,
} from '../lib/groups';
import { invalidateVaultCache, saveGroupConfig } from '../lib/vaults';
import type { AiConfig, GroupRecord, UserRecord, UserRole } from '../types/ai-config';

type HonoEnv = { Bindings: Env; Variables: { userContext: UserContext } };

const groups = new Hono<HonoEnv>();

/** Generate a personal API key for a new user. */
function generateUserKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `kp_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function maskKey(key: string | undefined): string | null {
  return key ? `***${key.slice(-4)}` : null;
}

/**
 * Authentication middleware: resolves the caller context and requires
 * at least an admin role. Fine-grained scope checks happen per route.
 */
groups.use('*', async (c, next) => {
  const token = extractBearerToken(c.req.header('Authorization') || null);
  const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
  if (!ctx) {
    return c.json({ error: 'Unauthorized' }, { status: 401 });
  }
  c.set('userContext', ctx);
  await next();
});

/** Scope check: superadmin, or admin of the group in the URL. */
function canManageGroup(ctx: UserContext, groupId: string): boolean {
  if (ctx.role === 'superadmin') return true;
  return ctx.role === 'admin' && ctx.groupId === groupId;
}

/**
 * GET /v1/groups
 *
 * superadmin: every group (with member counts).
 * admin/user: only their own group.
 */
groups.get('/', async (c) => {
  const ctx = c.get('userContext');
  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  const users = await loadUserKeys(c.env.KV_AI_PROXY);

  const memberCounts: Record<string, number> = {};
  for (const record of Object.values(users)) {
    if (record.groupId) {
      memberCounts[record.groupId] = (memberCounts[record.groupId] ?? 0) + 1;
    }
  }

  const visible = Object.entries(allGroups)
    .filter(([groupId]) => ctx.role === 'superadmin' || ctx.groupId === groupId)
    .map(([groupId, group]) => ({
      id: groupId,
      name: group.name,
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      legacy: group.legacy ?? false,
      memberCount: memberCounts[groupId] ?? 0,
    }));

  return c.json({ object: 'list', data: visible });
});

/**
 * POST /v1/groups
 *
 * Create a group (superadmin only). Body: { id?, name }.
 * The group vault is seeded from the BYOK template (vault:byok) with all
 * key lists emptied, then encrypted with the group-derived secret.
 */
groups.post('/', async (c) => {
  const ctx = c.get('userContext');
  if (ctx.role !== 'superadmin') {
    return c.json({ error: 'superadmin role required' }, { status: 403 });
  }

  let body: { id?: string; name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) {
    return c.json({ error: "'name' is required" }, { status: 400 });
  }

  const groupId = body.id?.trim() || slugifyGroupId(name);
  if (!isValidGroupId(groupId)) {
    return c.json(
      { error: `Invalid group id '${groupId}': lowercase letters, digits, '-' and '_' only` },
      { status: 400 },
    );
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' already exists` }, { status: 409 });
  }

  const byokTemplate = (await c.env.KV_AI_PROXY.get(BYOK_KV_KEY, 'json')) as AiConfig | null;
  const vault = createGroupVaultTemplate(byokTemplate);

  const group: GroupRecord = {
    name,
    createdAt: Date.now(),
    createdBy: ctx.username,
  };

  try {
    await saveGroupConfig(c.env, groupId, group, vault);
    allGroups[groupId] = group;
    await saveGroups(c.env.KV_AI_PROXY, allGroups);
  } catch (err) {
    console.error('Failed to create group:', err);
    return c.json(
      { error: 'Failed to create group', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return c.json({
    ok: true,
    id: groupId,
    name,
    seededFromByok: !!byokTemplate,
  });
});

/**
 * DELETE /v1/groups/:groupId
 *
 * Delete a group and its vault (superadmin only).
 * Refuses when members remain unless ?force=true (which also deletes them).
 * The legacy group cannot be deleted.
 */
groups.delete('/:groupId', async (c) => {
  const ctx = c.get('userContext');
  if (ctx.role !== 'superadmin') {
    return c.json({ error: 'superadmin role required' }, { status: 403 });
  }

  const groupId = c.req.param('groupId');
  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  const group = allGroups[groupId];
  if (!group) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }
  if (group.legacy) {
    return c.json({ error: 'The legacy group cannot be deleted' }, { status: 400 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const members = Object.entries(users).filter(([, record]) => record.groupId === groupId);
  const force = c.req.query('force') === 'true';

  if (members.length > 0 && !force) {
    return c.json(
      {
        error: `Group '${groupId}' still has ${members.length} member(s). Use ?force=true to delete them too.`,
        members: members.map(([username]) => username),
      },
      { status: 409 },
    );
  }

  for (const [username] of members) {
    delete users[username];
  }
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  await c.env.KV_AI_PROXY.delete(groupVaultKvKey(groupId, group));
  invalidateVaultCache(`group:${groupId}`);

  delete allGroups[groupId];
  await saveGroups(c.env.KV_AI_PROXY, allGroups);

  return c.json({ ok: true, deletedUsers: members.map(([username]) => username) });
});

/**
 * GET /v1/groups/:groupId/users
 *
 * List the members of a group (superadmin, or admin of that group).
 */
groups.get('/:groupId/users', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (!allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const members = Object.entries(users)
    .filter(([, record]) => record.groupId === groupId)
    .map(([username, record]) => ({
      username,
      owner: record.owner || username,
      role: record.role || 'user',
      keyHint: maskKey(record.key),
    }));

  return c.json({ object: 'list', data: members });
});

/**
 * POST /v1/groups/:groupId/users
 *
 * Create a user inside a group (superadmin, or admin of that group).
 * Body: { username, key?, role?, owner? }. When key is omitted a personal
 * API key is generated and returned once in the response.
 */
groups.post('/:groupId/users', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (!allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }

  let body: { username?: string; key?: string; role?: UserRole; owner?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const username = body.username?.trim();
  if (!username) {
    return c.json({ error: "'username' is required" }, { status: 400 });
  }

  const role: UserRole = body.role ?? 'user';
  if (!['superadmin', 'admin', 'user'].includes(role)) {
    return c.json({ error: `Invalid role '${role}'` }, { status: 400 });
  }
  if (role === 'superadmin' && ctx.role !== 'superadmin') {
    return c.json({ error: 'Only a superadmin can grant the superadmin role' }, { status: 403 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  if (users[username]) {
    return c.json({ error: `User '${username}' already exists` }, { status: 409 });
  }

  const key = body.key?.trim() || generateUserKey();
  if (Object.values(users).some((record) => record.key === key)) {
    return c.json({ error: 'This key is already assigned to another user' }, { status: 409 });
  }

  const record: UserRecord = {
    key,
    owner: body.owner || username,
    role,
    groupId,
  };
  users[username] = record;
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  // The key is returned once; only the hint is exposed afterwards.
  return c.json({ ok: true, username, groupId, role, key });
});

/**
 * PUT /v1/groups/:groupId/users/:username
 *
 * Update a member's role, key or owner (superadmin, or admin of that group).
 */
groups.put('/:groupId/users/:username', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  const username = c.req.param('username');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const record = users[username];
  if (!record || record.groupId !== groupId) {
    return c.json({ error: `User '${username}' not found in group '${groupId}'` }, { status: 404 });
  }

  let body: { key?: string; role?: UserRole; owner?: string; regenerateKey?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (body.role !== undefined) {
    if (!['superadmin', 'admin', 'user'].includes(body.role)) {
      return c.json({ error: `Invalid role '${body.role}'` }, { status: 400 });
    }
    if ((body.role === 'superadmin' || record.role === 'superadmin') && ctx.role !== 'superadmin') {
      return c.json({ error: 'Only a superadmin can change superadmin roles' }, { status: 403 });
    }
    record.role = body.role;
  }

  let newKey: string | undefined;
  if (body.regenerateKey) {
    newKey = generateUserKey();
  } else if (body.key !== undefined) {
    newKey = body.key.trim();
    if (!newKey) {
      return c.json({ error: 'key cannot be empty' }, { status: 400 });
    }
  }
  if (newKey) {
    const conflict = Object.entries(users).some(
      ([otherName, other]) => otherName !== username && other.key === newKey,
    );
    if (conflict) {
      return c.json({ error: 'This key is already assigned to another user' }, { status: 409 });
    }
    record.key = newKey;
  }

  if (body.owner !== undefined) {
    record.owner = body.owner;
  }

  users[username] = record;
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  return c.json({
    ok: true,
    username,
    groupId,
    role: record.role || 'user',
    ...(newKey ? { key: newKey } : {}),
  });
});

/**
 * DELETE /v1/groups/:groupId/users/:username
 *
 * Remove a member from a group (superadmin, or admin of that group).
 * Callers cannot delete themselves.
 */
groups.delete('/:groupId/users/:username', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  const username = c.req.param('username');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.username === username) {
    return c.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const record = users[username];
  if (!record || record.groupId !== groupId) {
    return c.json({ error: `User '${username}' not found in group '${groupId}'` }, { status: 404 });
  }
  if (record.role === 'superadmin' && ctx.role !== 'superadmin') {
    return c.json({ error: 'Only a superadmin can delete a superadmin' }, { status: 403 });
  }

  delete users[username];
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  return c.json({ ok: true, deleted: username });
});

export default groups;
```

### `src/routes/universal.ts`

```typescript
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
```

### `src/types/ai-config.ts`

**Exports:** AiProtocol, CrawlerProtocol, AiModalityInput, AiModalityOutput, AiKey, AiModel, AiProvider, Crawler, WeatherApiProtocol, WeatherApi, UserRole, UserRecord, GroupRecord, AiConfig

```typescript
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
/**
 * @file Types for the AI Proxy configuration.
 * Mirroring the structure expected by the Cloudflare Worker.
 */

/**
 * Supported AI protocols.
 */
export type AiProtocol =
  | 'openai'
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'morph'
  | 'cohere';

/**
 * Supported crawler protocols.
 */
export type CrawlerProtocol = 'firecrawl' | 'exa' | 'scrapegraphai';

/** Supported input modalities for a model. */
export type AiModalityInput = 'text' | 'image' | 'audio' | 'video';

/** Supported output modalities for a model. */
export type AiModalityOutput = 'text' | 'image' | 'audio';

/**
 * Represents an API key in the vault.
 */
export interface AiKey {
  /** The actual API key string */
  key: string;
  /** Optional owner name for identification */
  owner?: string;
  /** Optional key status/tier */
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
  /** Optional shared secret for gateway authentication */
  sharedSecret?: string;
  /** Optional hash type for the signature */
  signatureType?: 'hmac-md5' | 'hmac-sha256' | 'hmac-sha512';
  /** ISO 8601 timestamp: key becomes usable again at/after this instant. Unset = not known to be quota-exhausted. */
  quotaResetAt?: string;
  /** ISO 8601 timestamp: when we learned this key was quota-exhausted (audit only). */
  quotaExhaustedAt?: string;
  /** Optional management key for administrative purposes for example exa use a service key for retrieving usage*/
  managementKey?: string;
}

/**
 * Represents an AI model configuration.
 */
export interface AiModel {
  /** The model identifier (e.g., 'gpt-4') */
  id: string;
  /**
   * API surface this model should be used with.
   * `chat` and `embedding` are the two original proxy-routing classes.
   * `transcription`, `tts`, and `image-generation` extend the type for
   * specialized models such as Whisper, Voxtral-TTS, and DALL-E.
   */
  usage: 'chat' | 'embedding' | 'transcription' | 'tts' | 'image-generation';
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens allowed */
  maxOutputTokens: number;
  /** Tokens per minute limit, or null if unlimited */
  tpmLimit: number | null;
  /** Priority for selection (lower = higher priority) */
  priority: number;
  /** Optional tags for filtering */
  tags?: string[];
  /** Optional prefix for gateway routing */
  gatewayPrefix?: string;
  /**
   * Input modalities the model accepts. When absent the playground assumes
   * `['text']` for backward compatibility with existing configs.
   */
  inputModalities?: AiModalityInput[];
  /**
   * Output modalities the model can produce. When absent the playground assumes
   * `['text']` for backward compatibility with existing configs.
   */
  outputModalities?: AiModalityOutput[];
  /** Whether the model supports image inputs */
  supportsImages?: boolean;
  /** Whether the model supports prompt caching */
  supportsPromptCache?: boolean;
  /** Whether the model supports tools/function calling */
  supportsTools?: boolean;
  /** Whether the model supports advanced reasoning capabilities */
  supportsReasoning?: boolean;
}

/**
 * Represents an AI provider configuration.
 */
export interface AiProvider {
  /** Protocol used by the provider */
  protocol: AiProtocol;
  /** Base API endpoint */
  endpoint: string;
  /** Optional Cloudflare AI Gateway endpoint */
  gatewayEndpoint?: string;
  /** Optional model prefix for gateway */
  gatewayModelPrefix?: string;
  /** Optional shared key for gateway authentication */
  gatewayKey?: string;
  /** List of API keys for this provider */
  keys: AiKey[];
  /** List of available models for this provider */
  models: AiModel[];
  /** Optional model card endpoint */
  modelCardEndpoint?: string;
  /** Optional custom user agent for requests */
  userAgent?: string;
}

/**
 * Represents a crawler service configuration.
 */
export interface Crawler {
  /** Protocol used by the crawler */
  protocol: CrawlerProtocol;
  /** Base API endpoint */
  endpoint: string;
  /** List of API keys for this crawler */
  keys: AiKey[];
}

/**
 * Represents a Weather API protocol.
 */
export interface WeatherApiProtocol {
  /** Protocol used by the Weather API */
  protocol: 'meteoblue';
}

/**
 * Represents a Weather API configuration.
 */
export interface WeatherApi { 
  protocol: WeatherApiProtocol;
  endpoint: string;
  keys: AiKey[];
}

/**
 * Roles supported by the multi-group architecture.
 * - `superadmin`: manages all groups and their users (typically no group of their own)
 * - `admin`: manages the users and vault of their own group
 * - `user`: consumes the proxy and reads their group vault
 */
export type UserRole = 'superadmin' | 'admin' | 'user';

/**
 * Represents a user record in the users KV store.
 * This interface supports both legacy and new fields for backward compatibility.
 */
export interface UserRecord {
  /** The actual authentication token (legacy field, required) */
  key?: string;
  /** Human-readable owner name (legacy field, optional) */
  owner?: string;
  /** Key status (legacy field, optional) */
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
  /** New: ID of the vault this user should access (defaults to 'legacy') */
  vaultId?: string;
  /** New: role of the user (defaults to 'user') */
  role?: UserRole;
  /** Multi-group: ID of the group this user belongs to. Takes precedence over vaultId. */
  groupId?: string;
}

/**
 * Represents a group in the groups KV store (KV key: 'groups').
 * A group owns exactly one shared vault, encrypted with a secret derived
 * from AI_JSON_CRYPTOKEN and the group ID (see lib/groups.ts).
 */
export interface GroupRecord {
  /** Human-readable group name */
  name: string;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Username of the creator */
  createdBy?: string;
  /**
   * Legacy group flag: the vault is the historical vault:ai.json.enc blob,
   * encrypted with AI_JSON_CRYPTOKEN instead of a derived secret.
   */
  legacy?: boolean;
}


/**
 * The root AI configuration object (the "vault").
 */
export interface AiConfig {
  /** Configuration schema version */
  version: number;
  /** Dictionary of providers keyed by their unique ID */
  providers: Record<string, AiProvider>;
  /** Dictionary of crawlers keyed by their unique ID */
  crawlers: Record<string, Crawler>;
  /** Optional Weather API configuration */
  weatherApi?: WeatherApi;
}

```

