---
title: "ai-proxy-cloudflare AI Proxy"
description: "ai-proxy-cloudflare is a all-in-one AI proxy and vault manager for storing LLM API keys and record usage"
framework: typescript
stack: "ai-proxy-cloudflare"
generated: "2026-07-03"
slim_mode: false
files_total: 62
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
├─ src
│  ├─ index.ts
│  ├─ lib
│  │  ├─ ai-enc.ts
│  │  ├─ auth.ts
│  │  ├─ balance.ts
│  │  ├─ gateway.ts
│  │  ├─ groups.ts
│  │  ├─ universal.ts
│  │  ├─ usage-db.ts
│  │  └─ vaults.ts
│  ├─ routes
│  │  ├─ groups.ts
│  │  └─ universal.ts
│  └─ types
│     └─ ai-config.ts
└─ ui
   ├─ package-lock.json
   ├─ package.json
   ├─ src
   │  ├─ App.tsx
   │  ├─ ai.sample.crawlers.json
   │  ├─ components
   │  │  ├─ admin-panel.tsx
   │  │  ├─ chatbot-panel.tsx
   │  │  ├─ dashboard.tsx
   │  │  ├─ login-screen.tsx
   │  │  ├─ main-layout.tsx
   │  │  ├─ playground
   │  │  │  ├─ code-block.tsx
   │  │  │  ├─ conversation-history-sidebar.tsx
   │  │  │  ├─ equivalent-code-panel.tsx
   │  │  │  ├─ file-preview.tsx
   │  │  │  ├─ generation-settings-panel.tsx
   │  │  │  ├─ image-modal.tsx
   │  │  │  ├─ message-bubble.tsx
   │  │  │  ├─ message-list.tsx
   │  │  │  ├─ multimodal-input.tsx
   │  │  │  ├─ provider-model-key-selector.tsx
   │  │  │  └─ text-to-speech-button.tsx
   │  │  ├─ playground-panel.tsx
   │  │  └─ ui
   │  │     ├─ ConfigModal.tsx
   │  │     ├─ CrawlerCard.tsx
   │  │     ├─ ModelDeletionModal.tsx
   │  │     ├─ ModelPriorityList.tsx
   │  │     ├─ ProviderCard.tsx
   │  │     └─ WeatherApiCard.tsx
   │  ├─ hooks
   │  │  ├─ use-ai.tsx
   │  │  ├─ use-playground-conversation.ts
   │  │  ├─ use-playground-indexed-db.ts
   │  │  ├─ use-playground-request.ts
   │  │  └─ use-playground-selection.ts
   │  ├─ lib
   │  │  ├─ api.ts
   │  │  ├─ crypto.ts
   │  │  ├─ playground
   │  │  │  ├─ constants.ts
   │  │  │  ├─ indexed-db.ts
   │  │  │  ├─ mistral-conversations.ts
   │  │  │  ├─ multimodal-files.ts
   │  │  │  ├─ payload.ts
   │  │  │  └─ tts.ts
   │  │  ├─ provider-models.ts
   │  │  └─ utils
   │  │     ├─ file-utils.ts
   │  │     └─ markdown-utils.ts
   │  ├─ main.tsx
   │  ├─ styles
   │  │  └─ index.css
   │  └─ types
   │     ├─ ai-config.ts
   │     └─ playground-types.ts
   ├─ test-openrouter-models.js
   ├─ tsconfig.json
   └─ vite.config.ts
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
 */
export function pickKey(provider: AiProvider): AiKey {
  if (provider.keys.length === 0) {
    throw new Error('No API keys configured for provider');
  }
  return provider.keys[Math.floor(Math.random() * provider.keys.length)];
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
  return btoa(String.fromCharCode(...result));
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

**Exports:** UsagePeriod, KeyUsageEntry, KeyErrorEntry, KeyUsageStat, MigrateResult, KeyErrorStat, getUserIdFromAuth, UsageDbDurableObject, recordUsage, recordError, getUsageStats, getErrorStats, migrateUsageNdjson, migrateErrorNdjson, purge, getFileSizeBytes

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
	 * Get usage statistics grouped by period.
	 */
	async getUsageStats(period: UsagePeriod): Promise<KeyUsageStat[]> {
		const cutoff = periodCutoffMs(period);
		const cutoffHour = formatPeriodLabel(cutoff, "hour");

		// Read hourly records from SQLite
		const cursor = this.sql.exec(
			`SELECT * FROM usage_hourly WHERE period_hour >= ? ORDER BY period_hour DESC`,
			cutoffHour,
		);

		// Aggregate by requested period
		const map = new Map<string, KeyUsageStat>();
		for (const row of cursor) {
			const label = formatPeriodLabel(parseHourBucket(row.period_hour), period);
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
 * @returns Array of KeyUsageStat objects containing aggregated usage statistics
 */
export async function getUsageStats(
	usageDo: DurableObjectNamespace,
	userId: string,
	period: UsagePeriod,
): Promise<KeyUsageStat[]> {
	try {
		const stub = await getUsageStub(usageDo, userId);
		return await stub.getUsageStats(period);
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
```

### `src/lib/vaults.ts`

**Exports:** invalidateVaultCache, loadAiConfig, loadGroupConfig, saveGroupConfig

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
import { recordError, recordUsage } from '../lib/usage-db';
import { decryptAiConfig } from '../lib/ai-enc';
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

## UI Components

### `ui/package-lock.json`

```json
{
  "name": "ui",
  "version": "1.5.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "ui",
      "version": "1.5.0",
      "license": "MIT",
      "dependencies": {
        "@heroui/react": "^3.2.1",
        "@heroui/styles": "^3.2.1",
        "highlight.js": "^11.11.1",
        "i18next": "^26.3.3",
        "idb": "^8.0.3",
        "lucide-react": "^1.22.0",
        "marked": "^18.0.5",
        "marked-highlight": "^2.2.4",
        "react": "^19.2.6",
        "react-i18next": "^17.0.8",
        "react-router-dom": "^7.18.0",
        "tailwindcss": "^4.3.1"
      },
      "devDependencies": {
        "@tailwindcss/vite": "^4.3.1",
        "@types/react": "^19.2.17",
        "@types/react-dom": "^19.2.3",
        "@types/react-router-dom": "^5.3.3",
        "@vitejs/plugin-react": "^6.0.3",
        "eslint": "^10.6.0",
        "eslint-plugin-react-hooks": "^7.1.1",
        "typescript": "^6.0.3",
        "typescript-eslint": "^8.62.0",
        "vite": "^8.1.0"
      }
    },
    "node_modules/@adobe/react-spectrum": {
      "version": "3.47.0",
      "resolved": "https://registry.npmjs.org/@adobe/react-spectrum/-/react-spectrum-3.47.0.tgz",
      "integrity": "sha512-EDQuMzz0kUeiMUUlxoeLFQyyxOXaAC7qlBw2PYOUfFLYd87xcV7VVV0JxiYx8zGk1IIY3UgQHgXrS1fv7CgezQ==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.1",
        "@react-types/shared": "^3.34.0",
        "@spectrum-icons/ui": "^3.7.0",
        "@spectrum-icons/workflow": "^4.3.0",
        "@swc/helpers": "^0.5.0",
        "client-only": "^0.0.1",
        "clsx": "^2.0.0",
        "react-aria": "3.48.0",
        "react-aria-components": "1.17.0",
        "react-stately": "3.46.0",
        "react-transition-group": "^4.4.5",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@adobe/react-spectrum-ui": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/@adobe/react-spectrum-ui/-/react-spectrum-ui-1.2.1.tgz",
      "integrity": "sha512-wcrbEE2O/9WnEn6avBnaVRRx88S5PLFsPLr4wffzlbMfXeQsy+RMQwaJd3cbzrn18/j04Isit7f7Emfn0dhrJA==",
      "license": "Apache-2.0",
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/@adobe/react-spectrum-workflow": {
      "version": "2.3.5",
      "resolved": "https://registry.npmjs.org/@adobe/react-spectrum-workflow/-/react-spectrum-workflow-2.3.5.tgz",
      "integrity": "sha512-b53VIPwPWKb/T5gzE3qs+QlGP5gVrw/LnWV3xMksDU+CRl3rzOKUwxIGiZO8ICyYh1WiyqY4myGlPU/nAynBUg==",
      "license": "Apache-2.0",
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/@babel/code-frame": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.29.7.tgz",
      "integrity": "sha512-Aup7aUOfpbAUg2ROOJN6Iw5f9DMBlzu0mIkm/malLQFN/YQgO48wCj0Kxa3sEHJvPVFg7siR+qRInwXd2qhQKw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-validator-identifier": "^7.29.7",
        "js-tokens": "^4.0.0",
        "picocolors": "^1.1.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/compat-data": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/compat-data/-/compat-data-7.29.7.tgz",
      "integrity": "sha512-locTkQyKvwIEgBzVrn8693ebc97F2U8ZHjbXwDXJ5Fn2TCpNwTlKcaKLkdHop5c/icOFE7qt7Q9JC5hnKNa6Gg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/core": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/core/-/core-7.29.7.tgz",
      "integrity": "sha512-RgHBCvtjbOK2gXSNBNIkNoEc9qoVEtau3hj8gEqKQuL3HZAibKarWFEI3Lfm6EYKkLalOh8eSrj9b+ch9H/VBA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/generator": "^7.29.7",
        "@babel/helper-compilation-targets": "^7.29.7",
        "@babel/helper-module-transforms": "^7.29.7",
        "@babel/helpers": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/template": "^7.29.7",
        "@babel/traverse": "^7.29.7",
        "@babel/types": "^7.29.7",
        "@jridgewell/remapping": "^2.3.5",
        "convert-source-map": "^2.0.0",
        "debug": "^4.1.0",
        "gensync": "^1.0.0-beta.2",
        "json5": "^2.2.3",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/babel"
      }
    },
    "node_modules/@babel/generator": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/generator/-/generator-7.29.7.tgz",
      "integrity": "sha512-DkXD5OJQaAQIdZ1bt3UZdEnHAn9Imd3IVBdX03UFe+ony9Ojw5pzr9YVKGDY1jt+Gcn/FnGkNf8r+Vj5NOJWtQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.29.7",
        "@babel/types": "^7.29.7",
        "@jridgewell/gen-mapping": "^0.3.12",
        "@jridgewell/trace-mapping": "^0.3.28",
        "jsesc": "^3.0.2"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-compilation-targets": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-compilation-targets/-/helper-compilation-targets-7.29.7.tgz",
      "integrity": "sha512-wem6WaBj4NaVYVdNhLPPVacES6ZJ+KBBfSkTMD3YZxbP3rm3Di85tJU5ljaUNhaOynt+Aj0xruhYuzQBt8n71g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/compat-data": "^7.29.7",
        "@babel/helper-validator-option": "^7.29.7",
        "browserslist": "^4.24.0",
        "lru-cache": "^5.1.1",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-globals": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-globals/-/helper-globals-7.29.7.tgz",
      "integrity": "sha512-3nQVUAtvkKH9zahfWgw96Jc/uFOmjACE1kQz82E2lqWmHBgjzbNlsC22nuQTfahmWeQtTq5nQ/4Nnd2A1wj4zA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-imports": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-imports/-/helper-module-imports-7.29.7.tgz",
      "integrity": "sha512-ejHwrQQYcm9xnTivShn2IDOlIzInN34AXskvq9QicvCtEzq1Vzclu/tKF8Jq1Cg8JG2GL6/EmjgsCT7lXepE3g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/traverse": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-transforms": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-transforms/-/helper-module-transforms-7.29.7.tgz",
      "integrity": "sha512-UPUVSyXbOh627KiCIGQSgwWzGeBKLkaJ9PJEdrngIwMSzxLR4jS4+f1f1jb7VzBbg8nFLaYotvVPFCTqdrmTAg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-module-imports": "^7.29.7",
        "@babel/helper-validator-identifier": "^7.29.7",
        "@babel/traverse": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0"
      }
    },
    "node_modules/@babel/helper-string-parser": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.29.7.tgz",
      "integrity": "sha512-Pb5ijPrZ89GDH8223L4UP8i6QApWxs04RbPQJTeWDV0/keR2E36MeKnyr6LYmUUvqRRI+Iv87SuF1W6ErINzYw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-identifier": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.29.7.tgz",
      "integrity": "sha512-qehxGkRj55h/ff8EMaJ+cYhyaKlHIxqYDn682wQD7RNp9UujOQsHog2uS0r2vzr4pW+sXf90NeeayjcNaX3fFg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-option": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-option/-/helper-validator-option-7.29.7.tgz",
      "integrity": "sha512-N9ZErrD+yW5geCDtBqnOoxmR8+tNKiGuxKlDpuJxfsqpa2dFcexaziGAE/qoHLiDDreVNMupxGmSoNlyvsA3gw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helpers": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helpers/-/helpers-7.29.7.tgz",
      "integrity": "sha512-1k2lAGRMfHTcwuNYcCNUmaUffmQv8KWMfh2iJUUeRlwlwH4FdNG7mfPI10NPfLHJFThE4Tyr4mv7kTNZOiPuBg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/template": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/parser": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/parser/-/parser-7.29.7.tgz",
      "integrity": "sha512-hnORnjP/1P/zFEndoeX+n+t1RwWRJiJpM/jO7FW32Kn9r5+sJB2JWOdYo4L6k78j15eCwY3Gm/7364B1EMwtNg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.29.7"
      },
      "bin": {
        "parser": "bin/babel-parser.js"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/runtime": {
      "version": "7.29.2",
      "resolved": "https://registry.npmjs.org/@babel/runtime/-/runtime-7.29.2.tgz",
      "integrity": "sha512-JiDShH45zKHWyGe4ZNVRrCjBz8Nh9TMmZG1kh4QTK8hCBTWBi8Da+i7s1fJw7/lYpM4ccepSNfqzZ/QvABBi5g==",
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/template": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/template/-/template-7.29.7.tgz",
      "integrity": "sha512-puq+Gf35oI24FeN11LkoUQFqv9uwNeWpxXZi/Ji3rRIoKAzKnxRaZ+Gkj0vKS9ZCiTESfng1N9LyOyXvo+m+Gg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/types": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/traverse": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/traverse/-/traverse-7.29.7.tgz",
      "integrity": "sha512-EhlfNQtZ+NK22w5BM61ciuiq1m58ed33Wr1Xan//ZRTy6hgjnwyCffRYwzsGXdASJSUJ1guZILsErh1eQcl+zw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.29.7",
        "@babel/generator": "^7.29.7",
        "@babel/helper-globals": "^7.29.7",
        "@babel/parser": "^7.29.7",
        "@babel/template": "^7.29.7",
        "@babel/types": "^7.29.7",
        "debug": "^4.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/types": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/types/-/types-7.29.7.tgz",
      "integrity": "sha512-4zBIxpPzowiZpusoFkyGVwakdRJUyuH5PxQ/PrqghfdFWWasvnCdPfQXHrenDai+gyLARulZjZowCOj6fjT4pA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-string-parser": "^7.29.7",
        "@babel/helper-validator-identifier": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@emnapi/core": {
      "version": "1.11.1",
      "resolved": "https://registry.npmjs.org/@emnapi/core/-/core-1.11.1.tgz",
      "integrity": "sha512-RSvbQmHzdKzNsLYa/wHrbc3KN4sYLKAdPZxqiM2HATqv/SBk2/ENSHpvXGaLOMcsAyz0poEGqkmmKYG3OWiJEQ==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/wasi-threads": "1.2.2",
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@emnapi/runtime": {
      "version": "1.11.1",
      "resolved": "https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.1.tgz",
      "integrity": "sha512-vgj7R3y3Wgx24IQaGPA/R6YFXLHVMOZ0uVEyIQPaWs+rd1AzfEMXlAC22FYwO1XkKR6NPsq7mUandH8oIRdZFw==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@emnapi/wasi-threads": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/@emnapi/wasi-threads/-/wasi-threads-1.2.2.tgz",
      "integrity": "sha512-c95qOXkHdydNKhscBTebqEC1CVAZpyqOfVfBzQ1qgzyl3gfeldUjIggDbIZgDKsHLgnsM+igH7TJ/eAasaVuMA==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@eslint-community/eslint-utils": {
      "version": "4.9.1",
      "resolved": "https://registry.npmjs.org/@eslint-community/eslint-utils/-/eslint-utils-4.9.1.tgz",
      "integrity": "sha512-phrYmNiYppR7znFEdqgfWHXR6NCkZEK7hwWDHZUjit/2/U0r6XvkDl0SYnoM51Hq7FhCGdLDT6zxCCOY1hexsQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "eslint-visitor-keys": "^3.4.3"
      },
      "engines": {
        "node": "^12.22.0 || ^14.17.0 || >=16.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      },
      "peerDependencies": {
        "eslint": "^6.0.0 || ^7.0.0 || >=8.0.0"
      }
    },
    "node_modules/@eslint-community/eslint-utils/node_modules/eslint-visitor-keys": {
      "version": "3.4.3",
      "resolved": "https://registry.npmjs.org/eslint-visitor-keys/-/eslint-visitor-keys-3.4.3.tgz",
      "integrity": "sha512-wpc+LXeiyiisxPlEkUzU6svyS1frIO3Mgxj1fdy7Pm8Ygzguax2N3Fa/D/ag1WqbOprdI+uY6wMUl8/a2G+iag==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^12.22.0 || ^14.17.0 || >=16.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/@eslint-community/regexpp": {
      "version": "4.12.2",
      "resolved": "https://registry.npmjs.org/@eslint-community/regexpp/-/regexpp-4.12.2.tgz",
      "integrity": "sha512-EriSTlt5OC9/7SXkRSCAhfSxxoSUgBm33OH+IkwbdpgoqsSsUg7y3uh+IICI/Qg4BBWr3U2i39RpmycbxMq4ew==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^12.0.0 || ^14.0.0 || >=16.0.0"
      }
    },
    "node_modules/@eslint/config-array": {
      "version": "0.23.5",
      "resolved": "https://registry.npmjs.org/@eslint/config-array/-/config-array-0.23.5.tgz",
      "integrity": "sha512-Y3kKLvC1dvTOT+oGlqNQ1XLqK6D1HU2YXPc52NmAlJZbMMWDzGYXMiPRJ8TYD39muD/OTjlZmNJ4ib7dvSrMBA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@eslint/object-schema": "^3.0.5",
        "debug": "^4.3.1",
        "minimatch": "^10.2.4"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      }
    },
    "node_modules/@eslint/config-helpers": {
      "version": "0.6.0",
      "resolved": "https://registry.npmjs.org/@eslint/config-helpers/-/config-helpers-0.6.0.tgz",
      "integrity": "sha512-ii6Bw9jJ2zi2cWA2Z+9/QZ/+3DX6kwaV5Q986D/CdP3Lap3w/pgQZ373FV7byY/i7L4IRH/G43I5dz1ClsCbpA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@eslint/core": "^1.2.1"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      }
    },
    "node_modules/@eslint/core": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/@eslint/core/-/core-1.2.1.tgz",
      "integrity": "sha512-MwcE1P+AZ4C6DWlpin/OmOA54mmIZ/+xZuJiQd4SyB29oAJjN30UW9wkKNptW2ctp4cEsvhlLY/CsQ1uoHDloQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@types/json-schema": "^7.0.15"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      }
    },
    "node_modules/@eslint/object-schema": {
      "version": "3.0.5",
      "resolved": "https://registry.npmjs.org/@eslint/object-schema/-/object-schema-3.0.5.tgz",
      "integrity": "sha512-vqTaUEgxzm+YDSdElad6PiRoX4t8VGDjCtt05zn4nU810UIx/uNEV7/lZJ6KwFThKZOzOxzXy48da+No7HZaMw==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      }
    },
    "node_modules/@eslint/plugin-kit": {
      "version": "0.7.2",
      "resolved": "https://registry.npmjs.org/@eslint/plugin-kit/-/plugin-kit-0.7.2.tgz",
      "integrity": "sha512-+CNAzxglkrpNf/kKywqQfk74QjtceuOE7Qm+AF8miRvPF/wmmK5+OJOgVh3AVTT3RP2mH3+FOaxlE5v72owk0A==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@eslint/core": "^1.2.1",
        "levn": "^0.4.1"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      }
    },
    "node_modules/@formatjs/ecma402-abstract": {
      "version": "2.3.6",
      "resolved": "https://registry.npmjs.org/@formatjs/ecma402-abstract/-/ecma402-abstract-2.3.6.tgz",
      "integrity": "sha512-HJnTFeRM2kVFVr5gr5kH1XP6K0JcJtE7Lzvtr3FS/so5f1kpsqqqxy5JF+FRaO6H2qmcMfAUIox7AJteieRtVw==",
      "license": "MIT",
      "dependencies": {
        "@formatjs/fast-memoize": "2.2.7",
        "@formatjs/intl-localematcher": "0.6.2",
        "decimal.js": "^10.4.3",
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@formatjs/fast-memoize": {
      "version": "2.2.7",
      "resolved": "https://registry.npmjs.org/@formatjs/fast-memoize/-/fast-memoize-2.2.7.tgz",
      "integrity": "sha512-Yabmi9nSvyOMrlSeGGWDiH7rf3a7sIwplbvo/dlz9WCIjzIQAfy1RMf4S0X3yG724n5Ghu2GmEl5NJIV6O9sZQ==",
      "license": "MIT",
      "dependencies": {
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@formatjs/icu-messageformat-parser": {
      "version": "2.11.4",
      "resolved": "https://registry.npmjs.org/@formatjs/icu-messageformat-parser/-/icu-messageformat-parser-2.11.4.tgz",
      "integrity": "sha512-7kR78cRrPNB4fjGFZg3Rmj5aah8rQj9KPzuLsmcSn4ipLXQvC04keycTI1F7kJYDwIXtT2+7IDEto842CfZBtw==",
      "license": "MIT",
      "dependencies": {
        "@formatjs/ecma402-abstract": "2.3.6",
        "@formatjs/icu-skeleton-parser": "1.8.16",
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@formatjs/icu-skeleton-parser": {
      "version": "1.8.16",
      "resolved": "https://registry.npmjs.org/@formatjs/icu-skeleton-parser/-/icu-skeleton-parser-1.8.16.tgz",
      "integrity": "sha512-H13E9Xl+PxBd8D5/6TVUluSpxGNvFSlN/b3coUp0e0JpuWXXnQDiavIpY3NnvSp4xhEMoXyyBvVfdFX8jglOHQ==",
      "license": "MIT",
      "dependencies": {
        "@formatjs/ecma402-abstract": "2.3.6",
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@formatjs/intl-localematcher": {
      "version": "0.6.2",
      "resolved": "https://registry.npmjs.org/@formatjs/intl-localematcher/-/intl-localematcher-0.6.2.tgz",
      "integrity": "sha512-XOMO2Hupl0wdd172Y06h6kLpBz6Dv+J4okPLl4LPtzbr8f66WbIoy4ev98EBuZ6ZK4h5ydTN6XneT4QVpD7cdA==",
      "license": "MIT",
      "dependencies": {
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@heroui/react": {
      "version": "3.2.1",
      "resolved": "https://registry.npmjs.org/@heroui/react/-/react-3.2.1.tgz",
      "integrity": "sha512-dEwOFHd2I199dm6nXynK96xeqeQZH2zcFlY8BaoqAjNNvVg24X4/dFua8GuayD2KS6FNX65/2BQhlxiV3ByFrQ==",
      "license": "MIT",
      "dependencies": {
        "@heroui/styles": "3.2.1",
        "@radix-ui/react-avatar": "1.1.11",
        "@react-aria/i18n": "3.13.1",
        "@react-aria/ssr": "3.10.1",
        "@react-aria/utils": "3.34.1",
        "@react-stately/utils": "3.12.1",
        "@react-types/color": "3.2.0",
        "@react-types/shared": "3.35.0",
        "input-otp": "1.4.2",
        "react-aria": "3.49.0",
        "react-aria-components": "1.18.0",
        "tailwind-merge": "3.4.0",
        "tailwind-variants": "3.2.2"
      },
      "peerDependencies": {
        "react": ">=19.0.0",
        "react-dom": ">=19.0.0",
        "tailwindcss": ">=4.0.0"
      }
    },
    "node_modules/@heroui/react/node_modules/react-aria": {
      "version": "3.49.0",
      "resolved": "https://registry.npmjs.org/react-aria/-/react-aria-3.49.0.tgz",
      "integrity": "sha512-4+oK9FwJQWYhyA5zLfj/feOGY0zZbkE1muoF4gyxMroHVypjcYaRSTlJwvxph2zIlxt757KX6xIK2wJ5Aw1Kog==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.2",
        "@internationalized/number": "^3.6.7",
        "@internationalized/string": "^3.2.9",
        "@react-types/shared": "^3.35.0",
        "@swc/helpers": "^0.5.0",
        "aria-hidden": "^1.2.3",
        "clsx": "^2.0.0",
        "react-stately": "3.47.0",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@heroui/react/node_modules/react-aria-components": {
      "version": "1.18.0",
      "resolved": "https://registry.npmjs.org/react-aria-components/-/react-aria-components-1.18.0.tgz",
      "integrity": "sha512-FhRQjuDkH4WhgFv+O2sYTzK3JzdZTGpBeaqfRlfTo+DcSZzD8elJEkytHe7SDpcexVKeire8NVd7OruZHfCVoA==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.2",
        "@react-types/shared": "^3.35.0",
        "@swc/helpers": "^0.5.0",
        "client-only": "^0.0.1",
        "react-aria": "3.49.0",
        "react-stately": "3.47.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@heroui/react/node_modules/react-stately": {
      "version": "3.47.0",
      "resolved": "https://registry.npmjs.org/react-stately/-/react-stately-3.47.0.tgz",
      "integrity": "sha512-H3ar+SOWP920EbVg7qWfP3fZjZiwhlEJAEJQqjt+w8oKijCwFgr0+R4941PIHscOXRNRvEOjvWilitImC0DdBg==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.2",
        "@internationalized/number": "^3.6.7",
        "@internationalized/string": "^3.2.9",
        "@react-types/shared": "^3.35.0",
        "@swc/helpers": "^0.5.0",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@heroui/styles": {
      "version": "3.2.1",
      "resolved": "https://registry.npmjs.org/@heroui/styles/-/styles-3.2.1.tgz",
      "integrity": "sha512-6mrVlG338D9sDyOVGmFWqrLruc3lhmCClz3JVmMFKMkngHDR9CzvEsAcobx4injsAajCcHtrj9GwFOIoE0/oaQ==",
      "license": "MIT",
      "dependencies": {
        "tailwind-variants": "3.2.2",
        "tw-animate-css": "1.4.0"
      },
      "peerDependencies": {
        "tailwindcss": ">=4.0.0"
      }
    },
    "node_modules/@humanfs/core": {
      "version": "0.19.2",
      "resolved": "https://registry.npmjs.org/@humanfs/core/-/core-0.19.2.tgz",
      "integrity": "sha512-UhXNm+CFMWcbChXywFwkmhqjs3PRCmcSa/hfBgLIb7oQ5HNb1wS0icWsGtSAUNgefHeI+eBrA8I1fxmbHsGdvA==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@humanfs/types": "^0.15.0"
      },
      "engines": {
        "node": ">=18.18.0"
      }
    },
    "node_modules/@humanfs/node": {
      "version": "0.16.8",
      "resolved": "https://registry.npmjs.org/@humanfs/node/-/node-0.16.8.tgz",
      "integrity": "sha512-gE1eQNZ3R++kTzFUpdGlpmy8kDZD/MLyHqDwqjkVQI0JMdI1D51sy1H958PNXYkM2rAac7e5/CnIKZrHtPh3BQ==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@humanfs/core": "^0.19.2",
        "@humanfs/types": "^0.15.0",
        "@humanwhocodes/retry": "^0.4.0"
      },
      "engines": {
        "node": ">=18.18.0"
      }
    },
    "node_modules/@humanfs/types": {
      "version": "0.15.0",
      "resolved": "https://registry.npmjs.org/@humanfs/types/-/types-0.15.0.tgz",
      "integrity": "sha512-ZZ1w0aoQkwuUuC7Yf+7sdeaNfqQiiLcSRbfI08oAxqLtpXQr9AIVX7Ay7HLDuiLYAaFPu8oBYNq/QIi9URHJ3Q==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18.0"
      }
    },
    "node_modules/@humanwhocodes/module-importer": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/@humanwhocodes/module-importer/-/module-importer-1.0.1.tgz",
      "integrity": "sha512-bxveV4V8v5Yb4ncFTT3rPSgZBOpCkjfK0y4oVVVJwIuDVBRMDXrPyXRL988i5ap9m9bnyEEjWfm5WkBmtffLfA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=12.22"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/nzakas"
      }
    },
    "node_modules/@humanwhocodes/retry": {
      "version": "0.4.3",
      "resolved": "https://registry.npmjs.org/@humanwhocodes/retry/-/retry-0.4.3.tgz",
      "integrity": "sha512-bV0Tgo9K4hfPCek+aMAn81RppFKv2ySDQeMoSZuvTASywNTnVJCArCZE2FWqpvIatKu7VMRLWlR1EazvVhDyhQ==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/nzakas"
      }
    },
    "node_modules/@internationalized/date": {
      "version": "3.12.2",
      "resolved": "https://registry.npmjs.org/@internationalized/date/-/date-3.12.2.tgz",
      "integrity": "sha512-FY1Y+H64NDs+HAF6omlnWxm3mEpfgaCSWtL5l551ZZfImA+kGjPFgrnJrGjH6lfmLL0g8Z/mBu1R3kufeCp6Jw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0"
      }
    },
    "node_modules/@internationalized/message": {
      "version": "3.1.10",
      "resolved": "https://registry.npmjs.org/@internationalized/message/-/message-3.1.10.tgz",
      "integrity": "sha512-nc0Or6EdWHqZRcsXb6P9hBIpLsfSl/ILh0rk5h/OVBpzmhdExXtPy2cQtWsq8XKRBpRHwDNnAHt4OpolcB7dog==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "intl-messageformat": "^10.1.0"
      }
    },
    "node_modules/@internationalized/number": {
      "version": "3.6.7",
      "resolved": "https://registry.npmjs.org/@internationalized/number/-/number-3.6.7.tgz",
      "integrity": "sha512-3ji1fcrT+FPAK86UqEhB/psHixYo6niWPJtt7+qRaYFynt/BaJG8GhAPimtWUpEiVSTq8ZM8L5psMxGquiB/Vg==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0"
      }
    },
    "node_modules/@internationalized/string": {
      "version": "3.2.9",
      "resolved": "https://registry.npmjs.org/@internationalized/string/-/string-3.2.9.tgz",
      "integrity": "sha512-kzP/M/mbQxODlmOt4bIQZ2SBVUWUSqMLXooXixnX7noche8WHaQcA+nwFN1K2KCF/cp+LDUhcJsCicwkvhD1pg==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0"
      }
    },
    "node_modules/@jridgewell/gen-mapping": {
      "version": "0.3.13",
      "resolved": "https://registry.npmjs.org/@jridgewell/gen-mapping/-/gen-mapping-0.3.13.tgz",
      "integrity": "sha512-2kkt/7niJ6MgEPxF0bYdQ6etZaA+fQvDcLKckhy1yIQOzaoKjBBjSj63/aLVjYE3qhRt5dvM+uUyfCg6UKCBbA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.0",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/remapping": {
      "version": "2.3.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/remapping/-/remapping-2.3.5.tgz",
      "integrity": "sha512-LI9u/+laYG4Ds1TDKSJW2YPrIlcVYOwi2fUC6xB43lueCjgxV4lffOCZCtYFiH6TNOX+tQKXx97T4IKHbhyHEQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/resolve-uri": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/@jridgewell/resolve-uri/-/resolve-uri-3.1.2.tgz",
      "integrity": "sha512-bRISgCIjP20/tbWSPWMEi54QVPRZExkuD9lJL+UIxUKtwVJA8wW1Trb1jMs1RFXo1CBTNZ/5hpC9QvmKWdopKw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.5.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.5.5.tgz",
      "integrity": "sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@jridgewell/trace-mapping": {
      "version": "0.3.31",
      "resolved": "https://registry.npmjs.org/@jridgewell/trace-mapping/-/trace-mapping-0.3.31.tgz",
      "integrity": "sha512-zzNR+SdQSDJzc8joaeP8QQoCQr8NuYx2dIIytl1QeBEZHJ9uW6hebsrYgbz8hJwUQao3TWCMtmfV8Nu1twOLAw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/resolve-uri": "^3.1.0",
        "@jridgewell/sourcemap-codec": "^1.4.14"
      }
    },
    "node_modules/@napi-rs/wasm-runtime": {
      "version": "1.1.5",
      "resolved": "https://registry.npmjs.org/@napi-rs/wasm-runtime/-/wasm-runtime-1.1.5.tgz",
      "integrity": "sha512-AWPoBRJ9tsnVhor4sjO7rkni+7p+2IAEFj6cx06UgP10jkQHqay/36uRV/bFkgrh18D9vb4cr8Q0Pthskgzy+Q==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@tybys/wasm-util": "^0.10.2"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/Brooooooklyn"
      },
      "peerDependencies": {
        "@emnapi/core": "^1.7.1",
        "@emnapi/runtime": "^1.7.1"
      }
    },
    "node_modules/@oxc-project/types": {
      "version": "0.137.0",
      "resolved": "https://registry.npmjs.org/@oxc-project/types/-/types-0.137.0.tgz",
      "integrity": "sha512-WT+Gb24i8hmvo85AIv2oEYouEXkRlKAlT9WaCa3TfLgNCN+GhrJOGZuIlMouAh38Qe4QOx26eUOVsq70qXrywA==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/Boshen"
      }
    },
    "node_modules/@radix-ui/react-avatar": {
      "version": "1.1.11",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-avatar/-/react-avatar-1.1.11.tgz",
      "integrity": "sha512-0Qk603AHGV28BOBO34p7IgD5m+V5Sg/YovfayABkoDDBM5d3NCx0Mp4gGrjzLGes1jV5eNOE1r3itqOR33VC6Q==",
      "license": "MIT",
      "dependencies": {
        "@radix-ui/react-context": "1.1.3",
        "@radix-ui/react-primitive": "2.1.4",
        "@radix-ui/react-use-callback-ref": "1.1.1",
        "@radix-ui/react-use-is-hydrated": "0.1.0",
        "@radix-ui/react-use-layout-effect": "1.1.1"
      },
      "peerDependencies": {
        "@types/react": "*",
        "@types/react-dom": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc",
        "react-dom": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        },
        "@types/react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-compose-refs": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-compose-refs/-/react-compose-refs-1.1.2.tgz",
      "integrity": "sha512-z4eqJvfiNnFMHIIvXP3CY57y2WJs5g2v3X0zm9mEJkrkNv4rDxu+sg9Jh8EkXyeqBkB7SOcboo9dMVqhyrACIg==",
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-context": {
      "version": "1.1.3",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-context/-/react-context-1.1.3.tgz",
      "integrity": "sha512-ieIFACdMpYfMEjF0rEf5KLvfVyIkOz6PDGyNnP+u+4xQ6jny3VCgA4OgXOwNx2aUkxn8zx9fiVcM8CfFYv9Lxw==",
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-primitive": {
      "version": "2.1.4",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-primitive/-/react-primitive-2.1.4.tgz",
      "integrity": "sha512-9hQc4+GNVtJAIEPEqlYqW5RiYdrr8ea5XQ0ZOnD6fgru+83kqT15mq2OCcbe8KnjRZl5vF3ks69AKz3kh1jrhg==",
      "license": "MIT",
      "dependencies": {
        "@radix-ui/react-slot": "1.2.4"
      },
      "peerDependencies": {
        "@types/react": "*",
        "@types/react-dom": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc",
        "react-dom": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        },
        "@types/react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-slot": {
      "version": "1.2.4",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-slot/-/react-slot-1.2.4.tgz",
      "integrity": "sha512-Jl+bCv8HxKnlTLVrcDE8zTMJ09R9/ukw4qBs/oZClOfoQk/cOTbDn+NceXfV7j09YPVQUryJPHurafcSg6EVKA==",
      "license": "MIT",
      "dependencies": {
        "@radix-ui/react-compose-refs": "1.1.2"
      },
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-use-callback-ref": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-use-callback-ref/-/react-use-callback-ref-1.1.1.tgz",
      "integrity": "sha512-FkBMwD+qbGQeMu1cOHnuGB6x4yzPjho8ap5WtbEJ26umhgqVXbhekKUQO+hZEL1vU92a3wHwdp0HAcqAUF5iDg==",
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-use-is-hydrated": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-use-is-hydrated/-/react-use-is-hydrated-0.1.0.tgz",
      "integrity": "sha512-U+UORVEq+cTnRIaostJv9AGdV3G6Y+zbVd+12e18jQ5A3c0xL03IhnHuiU4UV69wolOQp5GfR58NW/EgdQhwOA==",
      "license": "MIT",
      "dependencies": {
        "use-sync-external-store": "^1.5.0"
      },
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@radix-ui/react-use-layout-effect": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/@radix-ui/react-use-layout-effect/-/react-use-layout-effect-1.1.1.tgz",
      "integrity": "sha512-RbJRS4UWQFkzHTTwVymMTUv8EqYhOp8dOOviLj2ugtTiXRaRQS7GLGxZTLL1jWhMeoSCf5zmcZkqTl9IiYfXcQ==",
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "*",
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc"
      },
      "peerDependenciesMeta": {
        "@types/react": {
          "optional": true
        }
      }
    },
    "node_modules/@react-aria/color": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/@react-aria/color/-/color-3.2.0.tgz",
      "integrity": "sha512-Qw1TySxXnGlE4L7kzsi8v86U1yFs9FtonqsbySFzLPzsMV1Oar+rtkYHI5vwNSyNNF6TBJJikJNocS9Fi8xXwA==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "react-aria": "3.48.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-aria/i18n": {
      "version": "3.13.1",
      "resolved": "https://registry.npmjs.org/@react-aria/i18n/-/i18n-3.13.1.tgz",
      "integrity": "sha512-z56ZYcbfpNmMyiGLhyEjytpmEfoTlBaksk84q4kds3HvNkf7QWKj+DJVfVDrJX+c1LyuBsszLSX7yxJRiHsYKQ==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.1",
        "@internationalized/message": "^3.1.9",
        "@internationalized/string": "^3.2.8",
        "@swc/helpers": "^0.5.0",
        "react-aria": "^3.48.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-aria/ssr": {
      "version": "3.10.1",
      "resolved": "https://registry.npmjs.org/@react-aria/ssr/-/ssr-3.10.1.tgz",
      "integrity": "sha512-jn038/ZYmu6DpfXJ6r2U9zFFppjbc9wnApPJSCxao2RZVEqep4YyoniHSy8qv6V21/xyS4IV7W9a+X2jOjSuag==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "react-aria": "^3.48.0"
      },
      "engines": {
        "node": ">= 12"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-aria/utils": {
      "version": "3.34.1",
      "resolved": "https://registry.npmjs.org/@react-aria/utils/-/utils-3.34.1.tgz",
      "integrity": "sha512-H6+rGZL+0f58bBNaUMfctEnT+NogqwAk+nHiB8sR3K+YlQ37GTuCijy2U/pPvQtFMS5mURrjZeBH5JNNXsx14A==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "react-aria": "^3.48.0",
        "react-stately": "^3.46.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-spectrum/color": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/@react-spectrum/color/-/color-3.2.0.tgz",
      "integrity": "sha512-Xg/U8+l1CQdvPRF4Zrv7AvtqsjuYUNkMxJMG0cIug9RKtIfEoyh7VR4Xg3FNd4Y/AwKXNJZZN4l94qz4WlK23Q==",
      "license": "Apache-2.0",
      "dependencies": {
        "@adobe/react-spectrum": "3.47.0",
        "@swc/helpers": "^0.5.0",
        "react-stately": "3.46.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-spectrum/provider": {
      "version": "3.11.1",
      "resolved": "https://registry.npmjs.org/@react-spectrum/provider/-/provider-3.11.1.tgz",
      "integrity": "sha512-TsoNdVdmlQ7L+75ILq5Yb3+wp/I1AtIeat0o+Y+ZBxP+TtWpwT1ZtCB5l3cplFVzHzOpZlzO0VaDrDP9ElGYDw==",
      "license": "Apache-2.0",
      "peer": true,
      "dependencies": {
        "@adobe/react-spectrum": "^3.47.0",
        "@swc/helpers": "^0.5.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-stately/color": {
      "version": "3.10.0",
      "resolved": "https://registry.npmjs.org/@react-stately/color/-/color-3.10.0.tgz",
      "integrity": "sha512-P4tlvOYFA8hl/NXiMyPxfM+7rXV01hnwlvGCwbZqUK1aRv0Ry0yGCj2AbSzhYHx7i4J4+CVUJUYozNLzhm+6Sw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "react-stately": "3.46.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-stately/utils": {
      "version": "3.12.1",
      "resolved": "https://registry.npmjs.org/@react-stately/utils/-/utils-3.12.1.tgz",
      "integrity": "sha512-NqKfzrknpfwiewx7R2vk1P+CneClInPDsIhw15+jOcUYSEfej0nta4cJywuKQJ2gsPwqX/ojDNixedCve9FWGw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@swc/helpers": "^0.5.0",
        "react-stately": "^3.46.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-types/color": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/@react-types/color/-/color-3.2.0.tgz",
      "integrity": "sha512-beV3vz80nzZ1EuYUM7296Kyi3AHcMrbQw0qub/9yzHWVTKKc5sy/e4dCMKcWL/ArkeAyc7jDOiui190RQ4l0Fw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@react-aria/color": "^3.2.0",
        "@react-spectrum/color": "^3.2.0",
        "@react-stately/color": "^3.10.0"
      },
      "peerDependencies": {
        "@react-spectrum/provider": "^3.0.0",
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@react-types/shared": {
      "version": "3.35.0",
      "resolved": "https://registry.npmjs.org/@react-types/shared/-/shared-3.35.0.tgz",
      "integrity": "sha512-iNWvuzEwANttpQpdlu8nPBtdHb0mcCMj1ZTH//iRB5E/14IAnyRlR25rxH7pNLyzHINsPGEKnWvpwDMCT6vziQ==",
      "license": "Apache-2.0",
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@rolldown/binding-android-arm64": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-android-arm64/-/binding-android-arm64-1.1.2.tgz",
      "integrity": "sha512-2cZ+7xRS+DBcuJBJKnfzsbleumJhBqSlJVpuzHC0nTqfd3QQ7Vx2/x5YR/D7cBamKSeWplwo82Fn9lqYUDEMfA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-darwin-arm64": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-darwin-arm64/-/binding-darwin-arm64-1.1.2.tgz",
      "integrity": "sha512-RkPMJnygxsgOYdkfqgpwY0/Fzm8d0VQe6HGU2/B00Xa9eqdLbrII+DOKAodbJAn3ZL1AJxGHkZRPYazgGY6Ljw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-darwin-x64": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-darwin-x64/-/binding-darwin-x64-1.1.2.tgz",
      "integrity": "sha512-Uiczh6vFhwyfd7WNe7Q7mCA4KxAiLdz7jPE/WGizfRpIieoyFuNVMmM8HqZ9HwudTkY6/AeMQwlNJ9NJijguWw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-freebsd-x64": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-freebsd-x64/-/binding-freebsd-x64-1.1.2.tgz",
      "integrity": "sha512-+TpdtTRgHiJFjCVFbw311SuLk3KfytPOQQn+VlAEv+gBxYPtL7E6JS9e/tk+8CwxhIZvemJKo4rTKgfWNsKkkA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm-gnueabihf": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm-gnueabihf/-/binding-linux-arm-gnueabihf-1.1.2.tgz",
      "integrity": "sha512-4lv1/tkmi7ueIVHnyreaOeUpiZP26BH9rRy6hoYfR9310A2B9nUEVRDvBx69vx64Nr3eTPPRkyciqJJs+j9Jmw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm64-gnu": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm64-gnu/-/binding-linux-arm64-gnu-1.1.2.tgz",
      "integrity": "sha512-gBSUVO0eaWgw1JMjK3gB8BMlX2Mk148s2lTiVT3e9vjVxbl7UDfMWWY8CfIaaqiXuM9fVTMxIpUz6CAo/B6Vlw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-arm64-musl": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-arm64-musl/-/binding-linux-arm64-musl-1.1.2.tgz",
      "integrity": "sha512-LjQP/iZLBu8o8PjIfk4x3At0/mT6h282pvz8Z5LAyhGbu/kDezyO7ea62rF5uoqmgnIYqbN/MqJ3Si3Aymi7xQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-ppc64-gnu": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-ppc64-gnu/-/binding-linux-ppc64-gnu-1.1.2.tgz",
      "integrity": "sha512-X/7bVLWelEsbyWDUSXt7zVsTniLLPIY2n1rH58qr78l9i7MNbbxBWD8gI2vRfBWf4NUXJCUuQnfZDsp32LqsfQ==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-s390x-gnu": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-s390x-gnu/-/binding-linux-s390x-gnu-1.1.2.tgz",
      "integrity": "sha512-gb6dYKW/1KDorGXyy48glEBJs/sxVSC5pcVrox/pFGV4mvwSFeg2sK5L2tRkVsVlh7kueqOgg4GEcuipJcGuKg==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-x64-gnu": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-x64-gnu/-/binding-linux-x64-gnu-1.1.2.tgz",
      "integrity": "sha512-JY4w85pU3iAiJVMh5nuk4/Mh9GjMsupe8MrIN53rwxAZW64GKrWeJBuN6SxQg9QTU5uB1cxyhDzW8jqRn1EABw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-linux-x64-musl": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-linux-x64-musl/-/binding-linux-x64-musl-1.1.2.tgz",
      "integrity": "sha512-xvpA7o5KCYLB0Rwscmuylb1/zHHSUx4g4xilm4prC5jP76pEUlzBmMbgpbh7bVDbId4NcfT96gN5i6mE6UDaiw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-openharmony-arm64": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-openharmony-arm64/-/binding-openharmony-arm64-1.1.2.tgz",
      "integrity": "sha512-p/ts6KBLjuk49Bp21XH77poQGt02iNz7ChgHep7tudPOaLinR/De/RHdxF8w8Yj4r/bF/bqXwH6PZrB2sA+Nvw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-wasm32-wasi": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-wasm32-wasi/-/binding-wasm32-wasi-1.1.2.tgz",
      "integrity": "sha512-VMu/wmrZ9hJzYlRhbw7jK5PODlugyKZ5mOdX78+lS8OvuFkWNQdz1pFLrI2p3P0pjXOmUZ7B48o5VnMH9QOGtg==",
      "cpu": [
        "wasm32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/core": "1.11.1",
        "@emnapi/runtime": "1.11.1",
        "@napi-rs/wasm-runtime": "^1.1.5"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-win32-arm64-msvc": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-win32-arm64-msvc/-/binding-win32-arm64-msvc-1.1.2.tgz",
      "integrity": "sha512-xtUJqs8qEkuSviS0n1tsohaPuz3a1SPhZywOji4Oo+sgrJs8daEDMZ0QtqL0OS7dx8PoVpg2J/ZZycPY5I2+Zg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/binding-win32-x64-msvc": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/@rolldown/binding-win32-x64-msvc/-/binding-win32-x64-msvc-1.1.2.tgz",
      "integrity": "sha512-85YiLQqjUKgSO/Zjnf9e0XIn5Ymrh1fLDWBeAkZqpuBR/3R8TpfoHXuyblqyQrftSSgWO9qpcHN8mkyKsLraoA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      }
    },
    "node_modules/@rolldown/pluginutils": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/@rolldown/pluginutils/-/pluginutils-1.0.1.tgz",
      "integrity": "sha512-2j9bGt5Jh8hj+vPtgzPtl72j0yRxHAyumoo6TNfAjsLB04UtpSvPbPcDcBMxz7n+9CYB0c1GxQFxYRg2jimqGw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@spectrum-icons/ui": {
      "version": "3.7.0",
      "resolved": "https://registry.npmjs.org/@spectrum-icons/ui/-/ui-3.7.0.tgz",
      "integrity": "sha512-86iQSDfJb3Ama1WSJ/mEiFy4DJT7e/v4pSmEuX4aKKMzbNYft+O40N18S2POUnmblrb7MQneLC/pgIp1SDBwEQ==",
      "license": "Apache-2.0",
      "dependencies": {
        "@adobe/react-spectrum-ui": "1.2.1",
        "@babel/runtime": "^7.24.4",
        "@swc/helpers": "^0.5.0"
      },
      "peerDependencies": {
        "@adobe/react-spectrum": "^3.47.0",
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@spectrum-icons/workflow": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/@spectrum-icons/workflow/-/workflow-4.3.0.tgz",
      "integrity": "sha512-ILuhgWh9jMXaEVMRuOYgTAjMc22cKyvCtUDyZmc8OEMfOYuejj+Gcp5t6DhaCfE0M9rORtVxCrRgsO2WyEgfUw==",
      "license": "Apache-2.0",
      "dependencies": {
        "@adobe/react-spectrum-workflow": "2.3.5",
        "@swc/helpers": "^0.5.0"
      },
      "peerDependencies": {
        "@adobe/react-spectrum": "^3.47.0",
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/@swc/helpers": {
      "version": "0.5.21",
      "resolved": "https://registry.npmjs.org/@swc/helpers/-/helpers-0.5.21.tgz",
      "integrity": "sha512-jI/VAmtdjB/RnI8GTnokyX7Ug8c+g+ffD6QRLa6XQewtnGyukKkKSk3wLTM3b5cjt1jNh9x0jfVlagdN2gDKQg==",
      "license": "Apache-2.0",
      "dependencies": {
        "tslib": "^2.8.0"
      }
    },
    "node_modules/@tailwindcss/node": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/node/-/node-4.3.1.tgz",
      "integrity": "sha512-6NDaqRoAMSXD1mr/RXu0HBvNE9a2n5tHPsxu9XHLws8o4Twes5rBM2205SUUiJ9goAtadrN6xTGX0UDEwp/N4A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/remapping": "^2.3.5",
        "enhanced-resolve": "5.21.6",
        "jiti": "^2.7.0",
        "lightningcss": "1.32.0",
        "magic-string": "^0.30.21",
        "source-map-js": "^1.2.1",
        "tailwindcss": "4.3.1"
      }
    },
    "node_modules/@tailwindcss/oxide": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide/-/oxide-4.3.1.tgz",
      "integrity": "sha512-yVPyo8RNkabVr3O2EhHEE0Rewu7YKzc1DhIqfL46LKveFrmu9XbDazNOJY7/GRuvw1h6u3utWnR29H/p5JPlgA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 20"
      },
      "optionalDependencies": {
        "@tailwindcss/oxide-android-arm64": "4.3.1",
        "@tailwindcss/oxide-darwin-arm64": "4.3.1",
        "@tailwindcss/oxide-darwin-x64": "4.3.1",
        "@tailwindcss/oxide-freebsd-x64": "4.3.1",
        "@tailwindcss/oxide-linux-arm-gnueabihf": "4.3.1",
        "@tailwindcss/oxide-linux-arm64-gnu": "4.3.1",
        "@tailwindcss/oxide-linux-arm64-musl": "4.3.1",
        "@tailwindcss/oxide-linux-x64-gnu": "4.3.1",
        "@tailwindcss/oxide-linux-x64-musl": "4.3.1",
        "@tailwindcss/oxide-wasm32-wasi": "4.3.1",
        "@tailwindcss/oxide-win32-arm64-msvc": "4.3.1",
        "@tailwindcss/oxide-win32-x64-msvc": "4.3.1"
      }
    },
    "node_modules/@tailwindcss/oxide-android-arm64": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-android-arm64/-/oxide-android-arm64-4.3.1.tgz",
      "integrity": "sha512-SVlyf61g374l5cHyg8x9kf5xmLcOaxvOTsbsqDnSsDJaKOEFZ7GCvi84VAVGpxojYOs1+3K6M0UjXfqPU8vmOQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-arm64": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-arm64/-/oxide-darwin-arm64-4.3.1.tgz",
      "integrity": "sha512-hVnWLwv+e/l7c4WKyVtHVrIPvYdqWHjRB3MDIqARynzFtnQg85kmQEFCbV9Ja0VVx4xXTIiDWY60Y7iz/iNoDA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-x64": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-x64/-/oxide-darwin-x64-4.3.1.tgz",
      "integrity": "sha512-Cf7abu0WVgbhU7ANgPUnSAvm7nCvMweusHb8FnaHlLfv/Caq4GYaEZg7ZImzzmjx4lIAfuS8q+eLIS7A7IzxIg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-freebsd-x64": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-freebsd-x64/-/oxide-freebsd-x64-4.3.1.tgz",
      "integrity": "sha512-ZZqzX2Y+GXtXXfqSfpJhDm60OoZfvLHLCgm+J7NVqgHHJjG/m9ugZI77RwTsVd4fnBJuCFP6Ae6kTJb71UdS8g==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm-gnueabihf": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm-gnueabihf/-/oxide-linux-arm-gnueabihf-4.3.1.tgz",
      "integrity": "sha512-/Ah/xik0LaMYfv9DZ0S/t4pBlBNYOcqtRwusjgovHkvT8ixueWCLyJjsaF5kQIckjb4IT8Q6K6p/iPmZMixYgg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-gnu": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-gnu/-/oxide-linux-arm64-gnu-4.3.1.tgz",
      "integrity": "sha512-gqdFoVJlw444GvpnheZLHmvTzSxI/cOUUh2KSNejQjTcYkW062SVD+En0rUgD+QV91bz1XGIGtt1HJd48xUGbQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-musl": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-musl/-/oxide-linux-arm64-musl-4.3.1.tgz",
      "integrity": "sha512-Bwv9KwOvE0VKa86xPFif9b9c3Y1NxOV1P0gLti/IYaWEsQYZXDlxfGEtA8mdDZ7SG3wyNXAWYT5SIn3giL57oA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-gnu": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-gnu/-/oxide-linux-x64-gnu-4.3.1.tgz",
      "integrity": "sha512-Ymi8O8T15HYQdOUWUtTI6ldN0neHP85FC+Qz32xTcZ7iJXtem/x8ITev0o1e9e5rkqj4lONZfTRLvkmin1+tKg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-musl": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-musl/-/oxide-linux-x64-musl-4.3.1.tgz",
      "integrity": "sha512-M+P/91qJ6uILLw4k2G93GMDRAXj61SMvFQYt39AqvUqYgExXpLL5aepfns7sj4HiAQeolirQF9E0lzRvdf4zPQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-wasm32-wasi": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.1.tgz",
      "integrity": "sha512-zsM8uOeqvVGHsAXsJxsT28ttosFahLJKCLOTUBqRAtKnVgGSRitds9T432QiT8b77Yga7JIBkulIRRlJPtYhRA==",
      "bundleDependencies": [
        "@napi-rs/wasm-runtime",
        "@emnapi/core",
        "@emnapi/runtime",
        "@tybys/wasm-util",
        "@emnapi/wasi-threads",
        "tslib"
      ],
      "cpu": [
        "wasm32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/core": "^1.10.0",
        "@emnapi/runtime": "^1.10.0",
        "@emnapi/wasi-threads": "^1.2.1",
        "@napi-rs/wasm-runtime": "^1.1.4",
        "@tybys/wasm-util": "^0.10.2",
        "tslib": "^2.8.1"
      },
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-arm64-msvc": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-arm64-msvc/-/oxide-win32-arm64-msvc-4.3.1.tgz",
      "integrity": "sha512-aiNvSq9BsVk8V513lDKlrCFAgf8qBMPZTpgEhInL+NwQqs97mYmupVMrPrgBBSL8Pv/0zXu9MrMF9rMun1ZeNg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-x64-msvc": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-x64-msvc/-/oxide-win32-x64-msvc-4.3.1.tgz",
      "integrity": "sha512-xDEyu1rg290472FEGaKHnzyDyh5QH+AlWvsU5hMoMtPpzmKlRI0jaYKCgSHDYtaQWZOYbMaduSyCwFwY4n1HmA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/@tailwindcss/vite": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@tailwindcss/vite/-/vite-4.3.1.tgz",
      "integrity": "sha512-hItDHuIIlEV61R+faXu66s1K36aTurO/Qw0e45Vskz57gXl9pWOT6eg3zmcEui6CZXddbN7zd41bwmvag4JGwQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@tailwindcss/node": "4.3.1",
        "@tailwindcss/oxide": "4.3.1",
        "tailwindcss": "4.3.1"
      },
      "peerDependencies": {
        "vite": "^5.2.0 || ^6 || ^7 || ^8"
      }
    },
    "node_modules/@tybys/wasm-util": {
      "version": "0.10.2",
      "resolved": "https://registry.npmjs.org/@tybys/wasm-util/-/wasm-util-0.10.2.tgz",
      "integrity": "sha512-RoBvJ2X0wuKlWFIjrwffGw1IqZHKQqzIchKaadZZfnNpsAYp2mM0h36JtPCjNDAHGgYez/15uMBpfGwchhiMgg==",
      "dev": true,
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "tslib": "^2.4.0"
      }
    },
    "node_modules/@types/esrecurse": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/@types/esrecurse/-/esrecurse-4.3.1.tgz",
      "integrity": "sha512-xJBAbDifo5hpffDBuHl0Y8ywswbiAp/Wi7Y/GtAgSlZyIABppyurxVueOPE8LUQOxdlgi6Zqce7uoEpqNTeiUw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/estree": {
      "version": "1.0.9",
      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
      "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/history": {
      "version": "4.7.11",
      "resolved": "https://registry.npmjs.org/@types/history/-/history-4.7.11.tgz",
      "integrity": "sha512-qjDJRrmvBMiTx+jyLxvLfJU7UznFuokDv4f3WRuriHKERccVpFU+8XMQUAbDzoiJCsmexxRExQeMwwCdamSKDA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/json-schema": {
      "version": "7.0.15",
      "resolved": "https://registry.npmjs.org/@types/json-schema/-/json-schema-7.0.15.tgz",
      "integrity": "sha512-5+fP8P8MFNC+AyZCDxrB2pkZFPGzqQWUzpSeuuVLvm8VMcorNYavBqoFcxK8bQz4Qsbn4oUEEem4wDLfcysGHA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/react": {
      "version": "19.2.17",
      "resolved": "https://registry.npmjs.org/@types/react/-/react-19.2.17.tgz",
      "integrity": "sha512-MXfmqaVPEVgkBT/aY0aGCkRWWtByiYQXo3xdQ8r5RzuFrPiRn8Gar2tQdXSUQ2GKV3bkXckek89V8wQBY2Q/Aw==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "csstype": "^3.2.2"
      }
    },
    "node_modules/@types/react-dom": {
      "version": "19.2.3",
      "resolved": "https://registry.npmjs.org/@types/react-dom/-/react-dom-19.2.3.tgz",
      "integrity": "sha512-jp2L/eY6fn+KgVVQAOqYItbF0VY/YApe5Mz2F0aykSO8gx31bYCZyvSeYxCHKvzHG5eZjc+zyaS5BrBWya2+kQ==",
      "devOptional": true,
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "^19.2.0"
      }
    },
    "node_modules/@types/react-router": {
      "version": "5.1.20",
      "resolved": "https://registry.npmjs.org/@types/react-router/-/react-router-5.1.20.tgz",
      "integrity": "sha512-jGjmu/ZqS7FjSH6owMcD5qpq19+1RS9DeVRqfl1FeBMxTDQAGwlMWOcs52NDoXaNKyG3d1cYQFMs9rCrb88o9Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/history": "^4.7.11",
        "@types/react": "*"
      }
    },
    "node_modules/@types/react-router-dom": {
      "version": "5.3.3",
      "resolved": "https://registry.npmjs.org/@types/react-router-dom/-/react-router-dom-5.3.3.tgz",
      "integrity": "sha512-kpqnYK4wcdm5UaWI3fLcELopqLrHgLqNsdpHauzlQktfkHL3npOSwtj1Uz9oKBAzs7lFtVkV8j83voAz2D8fhw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/history": "^4.7.11",
        "@types/react": "*",
        "@types/react-router": "*"
      }
    },
    "node_modules/@typescript-eslint/eslint-plugin": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/eslint-plugin/-/eslint-plugin-8.62.0.tgz",
      "integrity": "sha512-o+mpz7EYiMzXoySXiKmzlabIvTVqUuK5yLrAedRPRDA0IpPFMUV1IXt6OqljIxX/kumN6EjUYp41Hqelh6p/Dw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@eslint-community/regexpp": "^4.12.2",
        "@typescript-eslint/scope-manager": "8.62.0",
        "@typescript-eslint/type-utils": "8.62.0",
        "@typescript-eslint/utils": "8.62.0",
        "@typescript-eslint/visitor-keys": "8.62.0",
        "ignore": "^7.0.5",
        "natural-compare": "^1.4.0",
        "ts-api-utils": "^2.5.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "@typescript-eslint/parser": "^8.62.0",
        "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/eslint-plugin/node_modules/ignore": {
      "version": "7.0.5",
      "resolved": "https://registry.npmjs.org/ignore/-/ignore-7.0.5.tgz",
      "integrity": "sha512-Hs59xBNfUIunMFgWAbGX5cq6893IbWg4KnrjbYwX3tx0ztorVgTDA6B2sxf8ejHJ4wz8BqGUMYlnzNBer5NvGg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 4"
      }
    },
    "node_modules/@typescript-eslint/parser": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/parser/-/parser-8.62.0.tgz",
      "integrity": "sha512-dzHeT2gySzZtLDsuqxU9AkYgIsQoHAHtRBpOqM+Ofzx1Bwrd2RcCjQJ+6iQbsHOIR6NS33bF2W1k3blN1zLDrA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/scope-manager": "8.62.0",
        "@typescript-eslint/types": "8.62.0",
        "@typescript-eslint/typescript-estree": "8.62.0",
        "@typescript-eslint/visitor-keys": "8.62.0",
        "debug": "^4.4.3"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/project-service": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/project-service/-/project-service-8.62.0.tgz",
      "integrity": "sha512-wexnCqiTg7BOGtbLDftYpRWlmLq4xfoMd7BKFR6Y75sZS3QmRKLdN3yWLhmIYgqMmP/OXWpj3H8odkb5nGURCQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/tsconfig-utils": "^8.62.0",
        "@typescript-eslint/types": "^8.62.0",
        "debug": "^4.4.3"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/scope-manager": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/scope-manager/-/scope-manager-8.62.0.tgz",
      "integrity": "sha512-1lX38kNxXIRb8mEc3lbq5mdHq1Pf2+U0nFU65KfT18mtPxxl0fvjuEE92mHuXPuCtElJhOrddOpyMlM3Z0umEA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/types": "8.62.0",
        "@typescript-eslint/visitor-keys": "8.62.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@typescript-eslint/tsconfig-utils": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/tsconfig-utils/-/tsconfig-utils-8.62.0.tgz",
      "integrity": "sha512-y2GAdB6ykaXUvuspbYnizQc4oDDz0Tz/Yc7iWrXf9mx8vm/L/0vLHCe0tS2boG96Zy+DivnVDQ9ZUEWoHqqx1g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/type-utils": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/type-utils/-/type-utils-8.62.0.tgz",
      "integrity": "sha512-+g5O3j0w2ldzC86Pv6fvbO/xhAonbJFIdf/MKQ1d30gndlsVzUOE83ldfSE15Qrl9fhFjK6AovHs5Wpp6vx86w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/types": "8.62.0",
        "@typescript-eslint/typescript-estree": "8.62.0",
        "@typescript-eslint/utils": "8.62.0",
        "debug": "^4.4.3",
        "ts-api-utils": "^2.5.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/types": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/types/-/types-8.62.0.tgz",
      "integrity": "sha512-KvAclkktORPvM54TgLgA4z9HIV1M8zOgw9ZVNXl9f/8dLYfXYX1wkMXP7qmabpijQRV5bHJLOmoyGQbLMaUYeg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/typescript-estree/-/typescript-estree-8.62.0.tgz",
      "integrity": "sha512-+hVbNxtW64pIcZWDPGbyaKF7vp2IBTVY5ma1blwwksrjdsbdqqEKvJWMGbBofei4F6Dovx1M0RJgoFeNu2279A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/project-service": "8.62.0",
        "@typescript-eslint/tsconfig-utils": "8.62.0",
        "@typescript-eslint/types": "8.62.0",
        "@typescript-eslint/visitor-keys": "8.62.0",
        "debug": "^4.4.3",
        "minimatch": "^10.2.2",
        "semver": "^7.7.3",
        "tinyglobby": "^0.2.15",
        "ts-api-utils": "^2.5.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree/node_modules/semver": {
      "version": "7.8.5",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.8.5.tgz",
      "integrity": "sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/@typescript-eslint/utils": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/utils/-/utils-8.62.0.tgz",
      "integrity": "sha512-82r66fi9zYwZ+mTq3vKgwjbZ1PVk/DJzrXFLpG6RnBbdvH8TEGVHIs9H4d2drhkOzf0syZuD/OZvvlu6GDbP4g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@eslint-community/eslint-utils": "^4.9.1",
        "@typescript-eslint/scope-manager": "8.62.0",
        "@typescript-eslint/types": "8.62.0",
        "@typescript-eslint/typescript-estree": "8.62.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/@typescript-eslint/visitor-keys": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/visitor-keys/-/visitor-keys-8.62.0.tgz",
      "integrity": "sha512-CY3uyFSRbcQv3nnSv8S0+lDftMVz6P963PoRlxrV7ew/Md564g9ut60PYzdLM5qW4jFn93GBF+Soi90ISAN+GQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/types": "8.62.0",
        "eslint-visitor-keys": "^5.0.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@vitejs/plugin-react": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-6.0.3.tgz",
      "integrity": "sha512-vmFvco5/QuC2f9Oj+wTk0+9XeDFkHxSamwZKYc7MxYwKICfvUvlMhqKI0VuICPltGqh1neqBKDvO4kes1ya8vg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@rolldown/pluginutils": "^1.0.1"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "peerDependencies": {
        "@rolldown/plugin-babel": "^0.1.7 || ^0.2.0",
        "babel-plugin-react-compiler": "^1.0.0",
        "vite": "^8.0.0"
      },
      "peerDependenciesMeta": {
        "@rolldown/plugin-babel": {
          "optional": true
        },
        "babel-plugin-react-compiler": {
          "optional": true
        }
      }
    },
    "node_modules/acorn": {
      "version": "8.16.0",
      "resolved": "https://registry.npmjs.org/acorn/-/acorn-8.16.0.tgz",
      "integrity": "sha512-UVJyE9MttOsBQIDKw1skb9nAwQuR5wuGD3+82K6JgJlm/Y+KI92oNsMNGZCYdDsVtRHSak0pcV5Dno5+4jh9sw==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "acorn": "bin/acorn"
      },
      "engines": {
        "node": ">=0.4.0"
      }
    },
    "node_modules/acorn-jsx": {
      "version": "5.3.2",
      "resolved": "https://registry.npmjs.org/acorn-jsx/-/acorn-jsx-5.3.2.tgz",
      "integrity": "sha512-rq9s+JNhf0IChjtDXxllJ7g41oZk5SlXtp0LHwyA5cejwn7vKmKp4pPri6YEePv2PU65sAsegbXtIinmDFDXgQ==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "acorn": "^6.0.0 || ^7.0.0 || ^8.0.0"
      }
    },
    "node_modules/ajv": {
      "version": "6.15.0",
      "resolved": "https://registry.npmjs.org/ajv/-/ajv-6.15.0.tgz",
      "integrity": "sha512-fgFx7Hfoq60ytK2c7DhnF8jIvzYgOMxfugjLOSMHjLIPgenqa7S7oaagATUq99mV6IYvN2tRmC0wnTYX6iPbMw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fast-deep-equal": "^3.1.1",
        "fast-json-stable-stringify": "^2.0.0",
        "json-schema-traverse": "^0.4.1",
        "uri-js": "^4.2.2"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/epoberezkin"
      }
    },
    "node_modules/aria-hidden": {
      "version": "1.2.6",
      "resolved": "https://registry.npmjs.org/aria-hidden/-/aria-hidden-1.2.6.tgz",
      "integrity": "sha512-ik3ZgC9dY/lYVVM++OISsaYDeg1tb0VtP5uL3ouh1koGOaUMDPpbFIei4JkFimWUFPn90sbMNMXQAIVOlnYKJA==",
      "license": "MIT",
      "dependencies": {
        "tslib": "^2.0.0"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/balanced-match": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-4.0.4.tgz",
      "integrity": "sha512-BLrgEcRTwX2o6gGxGOCNyMvGSp35YofuYzw9h1IMTRmKqttAZZVU67bdb9Pr2vUHA8+j3i2tJfjO6C6+4myGTA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "18 || 20 || >=22"
      }
    },
    "node_modules/baseline-browser-mapping": {
      "version": "2.10.37",
      "resolved": "https://registry.npmjs.org/baseline-browser-mapping/-/baseline-browser-mapping-2.10.37.tgz",
      "integrity": "sha512-girxaJ7WZssDOFhzCGZTDKoTa1gk6A1TbflaYTpykLJ4UU9Fz9kx1aREM8JCuoVHbL8X8T/mJg7w2oYSq72Oig==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "baseline-browser-mapping": "dist/cli.cjs"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/brace-expansion": {
      "version": "5.0.5",
      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.5.tgz",
      "integrity": "sha512-VZznLgtwhn+Mact9tfiwx64fA9erHH/MCXEUfB/0bX/6Fz6ny5EGTXYltMocqg4xFAQZtnO3DHWWXi8RiuN7cQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "balanced-match": "^4.0.2"
      },
      "engines": {
        "node": "18 || 20 || >=22"
      }
    },
    "node_modules/browserslist": {
      "version": "4.28.2",
      "resolved": "https://registry.npmjs.org/browserslist/-/browserslist-4.28.2.tgz",
      "integrity": "sha512-48xSriZYYg+8qXna9kwqjIVzuQxi+KYWp2+5nCYnYKPTr0LvD89Jqk2Or5ogxz0NUMfIjhh2lIUX/LyX9B4oIg==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "baseline-browser-mapping": "^2.10.12",
        "caniuse-lite": "^1.0.30001782",
        "electron-to-chromium": "^1.5.328",
        "node-releases": "^2.0.36",
        "update-browserslist-db": "^1.2.3"
      },
      "bin": {
        "browserslist": "cli.js"
      },
      "engines": {
        "node": "^6 || ^7 || ^8 || ^9 || ^10 || ^11 || ^12 || >=13.7"
      }
    },
    "node_modules/caniuse-lite": {
      "version": "1.0.30001799",
      "resolved": "https://registry.npmjs.org/caniuse-lite/-/caniuse-lite-1.0.30001799.tgz",
      "integrity": "sha512-hG1bReV+OUU+MOqK4t/ZWI0tZOyz3rqS9XuhOUz1cIcbwBKjOyJEJuw9ER5JuNyqxNk8u/JUVbGibBOL1yrjFw==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/caniuse-lite"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "CC-BY-4.0"
    },
    "node_modules/client-only": {
      "version": "0.0.1",
      "resolved": "https://registry.npmjs.org/client-only/-/client-only-0.0.1.tgz",
      "integrity": "sha512-IV3Ou0jSMzZrd3pZ48nLkT9DA7Ag1pnPzaiQhpW7c3RbcqqzvzzVu+L8gfqMp/8IM2MQtSiqaCxrrcfu8I8rMA==",
      "license": "MIT"
    },
    "node_modules/clsx": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/clsx/-/clsx-2.1.1.tgz",
      "integrity": "sha512-eYm0QWBtUrBWZWG0d386OGAw16Z995PiOVo2B7bjWSbHedGl5e0ZWaq65kOGgUSNesEIDkB9ISbTg/JK9dhCZA==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/convert-source-map": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/convert-source-map/-/convert-source-map-2.0.0.tgz",
      "integrity": "sha512-Kvp459HrV2FEJ1CAsi1Ku+MY3kasH19TFykTz2xWmMeq6bk2NU3XXvfJ+Q61m0xktWwt+1HSYf3JZsTms3aRJg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/cookie": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz",
      "integrity": "sha512-ei8Aos7ja0weRpFzJnEA9UHJ/7XQmqglbRwnf2ATjcB9Wq874VKH9kfjjirM6UhU2/E5fFYadylyhFldcqSidQ==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/cross-spawn": {
      "version": "7.0.6",
      "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
      "integrity": "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "path-key": "^3.1.0",
        "shebang-command": "^2.0.0",
        "which": "^2.0.1"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/csstype": {
      "version": "3.2.3",
      "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.2.3.tgz",
      "integrity": "sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ==",
      "license": "MIT"
    },
    "node_modules/debug": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/decimal.js": {
      "version": "10.6.0",
      "resolved": "https://registry.npmjs.org/decimal.js/-/decimal.js-10.6.0.tgz",
      "integrity": "sha512-YpgQiITW3JXGntzdUmyUR1V812Hn8T1YVXhCu+wO3OpS4eU9l4YdD3qjyiKdV6mvV29zapkMeD390UVEf2lkUg==",
      "license": "MIT"
    },
    "node_modules/deep-is": {
      "version": "0.1.4",
      "resolved": "https://registry.npmjs.org/deep-is/-/deep-is-0.1.4.tgz",
      "integrity": "sha512-oIPzksmTg4/MriiaYGO+okXDT7ztn/w3Eptv/+gSIdMdKsJo0u4CfYNFJPy+4SKMuCqGw2wxnA+URMg3t8a/bQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/detect-libc": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz",
      "integrity": "sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/dom-helpers": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/dom-helpers/-/dom-helpers-5.2.1.tgz",
      "integrity": "sha512-nRCa7CK3VTrM2NmGkIy4cbK7IZlgBE/PYMn55rrXefr5xXDP0LdtfPnblFDoVdcAfslJ7or6iqAUnx0CCGIWQA==",
      "license": "MIT",
      "dependencies": {
        "@babel/runtime": "^7.8.7",
        "csstype": "^3.0.2"
      }
    },
    "node_modules/electron-to-chromium": {
      "version": "1.5.372",
      "resolved": "https://registry.npmjs.org/electron-to-chromium/-/electron-to-chromium-1.5.372.tgz",
      "integrity": "sha512-M3yhbAlilnwqC8D21t28UCDGHyitShTmmLRU/H+b74P6Ski16Nb9HONYEaVpMj/pwC7BEo5B95FpjODLCWbtfA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/enhanced-resolve": {
      "version": "5.21.6",
      "resolved": "https://registry.npmjs.org/enhanced-resolve/-/enhanced-resolve-5.21.6.tgz",
      "integrity": "sha512-aNnGCvbJ/RIyWo1IuhNdVjnNF+EjH9wpzpNHt+ci/m9He9LJvUN8wrCcXjp9cWsGNAuvSpVFTx/vraAFQ8qGjQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "graceful-fs": "^4.2.4",
        "tapable": "^2.3.3"
      },
      "engines": {
        "node": ">=10.13.0"
      }
    },
    "node_modules/escalade": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz",
      "integrity": "sha512-WUj2qlxaQtO4g6Pq5c29GTcWGDyd8itL8zTlipgECz3JesAiiOKotd8JU6otB3PACgG6xkJUyVhboMS+bje/jA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/escape-string-regexp": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-4.0.0.tgz",
      "integrity": "sha512-TtpcNJ3XAzx3Gq8sWRzJaVajRs0uVxA2YAkdb1jm2YkPz4G6egUFAyA3n5vtEIZefPk5Wa4UXbKuS5fKkJWdgA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/eslint": {
      "version": "10.6.0",
      "resolved": "https://registry.npmjs.org/eslint/-/eslint-10.6.0.tgz",
      "integrity": "sha512-6lVbcqSodALYo+4ELD0heG6lFiFxnLMuLkiMi2qV8LMp54N8tE8FT1GMH+ev4Ti00nFjNze2+Su6DsV5OQW3Dg==",
      "dev": true,
      "license": "MIT",
      "workspaces": [
        "packages/*"
      ],
      "dependencies": {
        "@eslint-community/eslint-utils": "^4.8.0",
        "@eslint-community/regexpp": "^4.12.2",
        "@eslint/config-array": "^0.23.5",
        "@eslint/config-helpers": "^0.6.0",
        "@eslint/core": "^1.2.1",
        "@eslint/plugin-kit": "^0.7.2",
        "@humanfs/node": "^0.16.6",
        "@humanwhocodes/module-importer": "^1.0.1",
        "@humanwhocodes/retry": "^0.4.2",
        "@types/estree": "^1.0.6",
        "ajv": "^6.14.0",
        "cross-spawn": "^7.0.6",
        "debug": "^4.3.2",
        "escape-string-regexp": "^4.0.0",
        "eslint-scope": "^9.1.2",
        "eslint-visitor-keys": "^5.0.1",
        "espree": "^11.2.0",
        "esquery": "^1.7.0",
        "esutils": "^2.0.2",
        "fast-deep-equal": "^3.1.3",
        "file-entry-cache": "^8.0.0",
        "find-up": "^5.0.0",
        "glob-parent": "^6.0.2",
        "ignore": "^5.2.0",
        "imurmurhash": "^0.1.4",
        "is-glob": "^4.0.0",
        "json-stable-stringify-without-jsonify": "^1.0.1",
        "minimatch": "^10.2.4",
        "natural-compare": "^1.4.0",
        "optionator": "^0.9.3"
      },
      "bin": {
        "eslint": "bin/eslint.js"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      },
      "funding": {
        "url": "https://eslint.org/donate"
      },
      "peerDependencies": {
        "jiti": "*"
      },
      "peerDependenciesMeta": {
        "jiti": {
          "optional": true
        }
      }
    },
    "node_modules/eslint-plugin-react-hooks": {
      "version": "7.1.1",
      "resolved": "https://registry.npmjs.org/eslint-plugin-react-hooks/-/eslint-plugin-react-hooks-7.1.1.tgz",
      "integrity": "sha512-f2I7Gw6JbvCexzIInuSbZpfdQ44D7iqdWX01FKLvrPgqxoE7oMj8clOfto8U6vYiz4yd5oKu39rRSVOe1zRu0g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.24.4",
        "@babel/parser": "^7.24.4",
        "hermes-parser": "^0.25.1",
        "zod": "^3.25.0 || ^4.0.0",
        "zod-validation-error": "^3.5.0 || ^4.0.0"
      },
      "engines": {
        "node": ">=18"
      },
      "peerDependencies": {
        "eslint": "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0 || ^10.0.0"
      }
    },
    "node_modules/eslint-scope": {
      "version": "9.1.2",
      "resolved": "https://registry.npmjs.org/eslint-scope/-/eslint-scope-9.1.2.tgz",
      "integrity": "sha512-xS90H51cKw0jltxmvmHy2Iai1LIqrfbw57b79w/J7MfvDfkIkFZ+kj6zC3BjtUwh150HsSSdxXZcsuv72miDFQ==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "@types/esrecurse": "^4.3.1",
        "@types/estree": "^1.0.8",
        "esrecurse": "^4.3.0",
        "estraverse": "^5.2.0"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/eslint-visitor-keys": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/eslint-visitor-keys/-/eslint-visitor-keys-5.0.1.tgz",
      "integrity": "sha512-tD40eHxA35h0PEIZNeIjkHoDR4YjjJp34biM0mDvplBe//mB+IHCqHDGV7pxF+7MklTvighcCPPZC7ynWyjdTA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/espree": {
      "version": "11.2.0",
      "resolved": "https://registry.npmjs.org/espree/-/espree-11.2.0.tgz",
      "integrity": "sha512-7p3DrVEIopW1B1avAGLuCSh1jubc01H2JHc8B4qqGblmg5gI9yumBgACjWo4JlIc04ufug4xJ3SQI8HkS/Rgzw==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "acorn": "^8.16.0",
        "acorn-jsx": "^5.3.2",
        "eslint-visitor-keys": "^5.0.1"
      },
      "engines": {
        "node": "^20.19.0 || ^22.13.0 || >=24"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/esquery": {
      "version": "1.7.0",
      "resolved": "https://registry.npmjs.org/esquery/-/esquery-1.7.0.tgz",
      "integrity": "sha512-Ap6G0WQwcU/LHsvLwON1fAQX9Zp0A2Y6Y/cJBl9r/JbW90Zyg4/zbG6zzKa2OTALELarYHmKu0GhpM5EO+7T0g==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "estraverse": "^5.1.0"
      },
      "engines": {
        "node": ">=0.10"
      }
    },
    "node_modules/esrecurse": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/esrecurse/-/esrecurse-4.3.0.tgz",
      "integrity": "sha512-KmfKL3b6G+RXvP8N1vr3Tq1kL/oCFgn2NYXEtqP8/L3pKapUA4G8cFVaoF3SU323CD4XypR/ffioHmkti6/Tag==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "estraverse": "^5.2.0"
      },
      "engines": {
        "node": ">=4.0"
      }
    },
    "node_modules/estraverse": {
      "version": "5.3.0",
      "resolved": "https://registry.npmjs.org/estraverse/-/estraverse-5.3.0.tgz",
      "integrity": "sha512-MMdARuVEQziNTeJD8DgMqmhwR11BRQ/cBP+pLtYdSTnf3MIO8fFeiINEbX36ZdNlfU/7A9f3gUw49B3oQsvwBA==",
      "dev": true,
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=4.0"
      }
    },
    "node_modules/esutils": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/esutils/-/esutils-2.0.3.tgz",
      "integrity": "sha512-kVscqXk4OCp68SZ0dkgEKVi6/8ij300KBWTJq32P/dYeWTSwK41WyTxalN1eRmA5Z9UU/LX9D7FWSmV9SAYx6g==",
      "dev": true,
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/fast-deep-equal": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
      "integrity": "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-json-stable-stringify": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/fast-json-stable-stringify/-/fast-json-stable-stringify-2.1.0.tgz",
      "integrity": "sha512-lhd/wF+Lk98HZoTCtlVraHtfh5XYijIjalXck7saUtuanSDyLMxnHhSXEDJqHxD7msR8D0uCmqlkwjCV8xvwHw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-levenshtein": {
      "version": "2.0.6",
      "resolved": "https://registry.npmjs.org/fast-levenshtein/-/fast-levenshtein-2.0.6.tgz",
      "integrity": "sha512-DCXu6Ifhqcks7TZKY3Hxp3y6qphY5SJZmrWMDrKcERSOXWQdMhU9Ig/PYrzyw/ul9jOIyh0N4M0tbC5hodg8dw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fdir": {
      "version": "6.5.0",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.5.0.tgz",
      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12.0.0"
      },
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/file-entry-cache": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/file-entry-cache/-/file-entry-cache-8.0.0.tgz",
      "integrity": "sha512-XXTUwCvisa5oacNGRP9SfNtYBNAMi+RPwBFmblZEF7N7swHYQS6/Zfk7SRwx4D5j3CH211YNRco1DEMNVfZCnQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "flat-cache": "^4.0.0"
      },
      "engines": {
        "node": ">=16.0.0"
      }
    },
    "node_modules/find-up": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-5.0.0.tgz",
      "integrity": "sha512-78/PXT1wlLLDgTzDs7sjq9hzz0vXD+zn+7wypEe4fXQxCmdmqfGsEPQxmiCSQI3ajFV91bVSsvNtrJRiW6nGng==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^6.0.0",
        "path-exists": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/flat-cache": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/flat-cache/-/flat-cache-4.0.1.tgz",
      "integrity": "sha512-f7ccFPK3SXFHpx15UIGyRJ/FJQctuKZ0zVuN3frBo4HnK3cay9VEW0R6yPYFHC0AgqhukPzKjq22t5DmAyqGyw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "flatted": "^3.2.9",
        "keyv": "^4.5.4"
      },
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/flatted": {
      "version": "3.4.2",
      "resolved": "https://registry.npmjs.org/flatted/-/flatted-3.4.2.tgz",
      "integrity": "sha512-PjDse7RzhcPkIJwy5t7KPWQSZ9cAbzQXcafsetQoD7sOJRQlGikNbx7yZp2OotDnJyrDcbyRq3Ttb18iYOqkxA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/gensync": {
      "version": "1.0.0-beta.2",
      "resolved": "https://registry.npmjs.org/gensync/-/gensync-1.0.0-beta.2.tgz",
      "integrity": "sha512-3hN7NaskYvMDLQY55gnW3NQ+mesEAepTqlg+VEbj7zzqEMBVNhzcGYYeqFo/TlYz6eQiFcp1HcsCZO+nGgS8zg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/glob-parent": {
      "version": "6.0.2",
      "resolved": "https://registry.npmjs.org/glob-parent/-/glob-parent-6.0.2.tgz",
      "integrity": "sha512-XxwI8EOhVQgWp6iDL+3b0r86f4d6AX6zSU55HfB4ydCEuXLXc5FcYeOu+nnGftS4TEju/11rt4KJPTMgbfmv4A==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "is-glob": "^4.0.3"
      },
      "engines": {
        "node": ">=10.13.0"
      }
    },
    "node_modules/graceful-fs": {
      "version": "4.2.11",
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/hermes-estree": {
      "version": "0.25.1",
      "resolved": "https://registry.npmjs.org/hermes-estree/-/hermes-estree-0.25.1.tgz",
      "integrity": "sha512-0wUoCcLp+5Ev5pDW2OriHC2MJCbwLwuRx+gAqMTOkGKJJiBCLjtrvy4PWUGn6MIVefecRpzoOZ/UV6iGdOr+Cw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/hermes-parser": {
      "version": "0.25.1",
      "resolved": "https://registry.npmjs.org/hermes-parser/-/hermes-parser-0.25.1.tgz",
      "integrity": "sha512-6pEjquH3rqaI6cYAXYPcz9MS4rY6R4ngRgrgfDshRptUZIc3lw0MCIJIGDj9++mfySOuPTHB4nrSW99BCvOPIA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "hermes-estree": "0.25.1"
      }
    },
    "node_modules/highlight.js": {
      "version": "11.11.1",
      "resolved": "https://registry.npmjs.org/highlight.js/-/highlight.js-11.11.1.tgz",
      "integrity": "sha512-Xwwo44whKBVCYoliBQwaPvtd/2tYFkRQtXDWj1nackaV2JPXx3L0+Jvd8/qCJ2p+ML0/XVkJ2q+Mr+UVdpJK5w==",
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=12.0.0"
      }
    },
    "node_modules/html-parse-stringify": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/html-parse-stringify/-/html-parse-stringify-3.0.1.tgz",
      "integrity": "sha512-KknJ50kTInJ7qIScF3jeaFRpMpE8/lfiTdzf/twXyPBLAGrLRTmkz3AdTnKeh40X8k9L2fdYwEp/42WGXIRGcg==",
      "license": "MIT",
      "dependencies": {
        "void-elements": "3.1.0"
      }
    },
    "node_modules/i18next": {
      "version": "26.3.3",
      "resolved": "https://registry.npmjs.org/i18next/-/i18next-26.3.3.tgz",
      "integrity": "sha512-aYVegyBdXSO93CMMihvr47jI7GHSOcIahMpJX+qzUXDzW4xDJf2uenIA+45vDU+YhiVdcfsql70AC9RVdMNrHg==",
      "funding": [
        {
          "type": "individual",
          "url": "https://www.locize.com/i18next"
        },
        {
          "type": "individual",
          "url": "https://www.i18next.com/how-to/faq#i18next-is-awesome.-how-can-i-support-the-project"
        },
        {
          "type": "individual",
          "url": "https://www.locize.com"
        }
      ],
      "license": "MIT",
      "peerDependencies": {
        "typescript": "^5 || ^6"
      },
      "peerDependenciesMeta": {
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/idb": {
      "version": "8.0.3",
      "resolved": "https://registry.npmjs.org/idb/-/idb-8.0.3.tgz",
      "integrity": "sha512-LtwtVyVYO5BqRvcsKuB2iUMnHwPVByPCXFXOpuU96IZPPoPN6xjOGxZQ74pgSVVLQWtUOYgyeL4GE98BY5D3wg==",
      "license": "ISC"
    },
    "node_modules/ignore": {
      "version": "5.3.2",
      "resolved": "https://registry.npmjs.org/ignore/-/ignore-5.3.2.tgz",
      "integrity": "sha512-hsBTNUqQTDwkWtcdYI2i06Y/nUBEsNEDJKjWdigLvegy8kDuJAS8uRlpkkcQpyEXL0Z/pjDy5HBmMjRCJ2gq+g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 4"
      }
    },
    "node_modules/imurmurhash": {
      "version": "0.1.4",
      "resolved": "https://registry.npmjs.org/imurmurhash/-/imurmurhash-0.1.4.tgz",
      "integrity": "sha512-JmXMZ6wuvDmLiHEml9ykzqO6lwFbof0GG4IkcGaENdCRDDmMVnny7s5HsIgHCbaq0w2MyPhDqkhTUgS2LU2PHA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.8.19"
      }
    },
    "node_modules/input-otp": {
      "version": "1.4.2",
      "resolved": "https://registry.npmjs.org/input-otp/-/input-otp-1.4.2.tgz",
      "integrity": "sha512-l3jWwYNvrEa6NTCt7BECfCm48GvwuZzkoeG3gBL2w4CHeOXW3eKFmf9UNYkNfYc3mxMrthMnxjIE07MT0zLBQA==",
      "license": "MIT",
      "peerDependencies": {
        "react": "^16.8 || ^17.0 || ^18.0 || ^19.0.0 || ^19.0.0-rc",
        "react-dom": "^16.8 || ^17.0 || ^18.0 || ^19.0.0 || ^19.0.0-rc"
      }
    },
    "node_modules/intl-messageformat": {
      "version": "10.7.18",
      "resolved": "https://registry.npmjs.org/intl-messageformat/-/intl-messageformat-10.7.18.tgz",
      "integrity": "sha512-m3Ofv/X/tV8Y3tHXLohcuVuhWKo7BBq62cqY15etqmLxg2DZ34AGGgQDeR+SCta2+zICb1NX83af0GJmbQ1++g==",
      "license": "BSD-3-Clause",
      "dependencies": {
        "@formatjs/ecma402-abstract": "2.3.6",
        "@formatjs/fast-memoize": "2.2.7",
        "@formatjs/icu-messageformat-parser": "2.11.4",
        "tslib": "^2.8.0"
      }
    },
    "node_modules/is-extglob": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/is-extglob/-/is-extglob-2.1.1.tgz",
      "integrity": "sha512-SbKbANkN603Vi4jEZv49LeVJMn4yGwsbzZworEoyEiutsN3nJYdbO36zfhGJ6QEDpOZIFkDtnq5JRxmvl3jsoQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/is-glob": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/is-glob/-/is-glob-4.0.3.tgz",
      "integrity": "sha512-xelSayHH36ZgE7ZWhli7pW34hNbNl8Ojv5KVmkJD4hBdD3th8Tfk9vYasLM+mXWOZhFkgZfxhLSnrwRr4elSSg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-extglob": "^2.1.1"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/isexe": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
      "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/jiti": {
      "version": "2.7.0",
      "resolved": "https://registry.npmjs.org/jiti/-/jiti-2.7.0.tgz",
      "integrity": "sha512-AC/7JofJvZGrrneWNaEnJeOLUx+JlGt7tNa0wZiRPT4MY1wmfKjt2+6O2p2uz2+skll8OZZmJMNqeke7kKbNgQ==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jiti": "lib/jiti-cli.mjs"
      }
    },
    "node_modules/js-tokens": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
      "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
      "license": "MIT"
    },
    "node_modules/jsesc": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/jsesc/-/jsesc-3.1.0.tgz",
      "integrity": "sha512-/sM3dO2FOzXjKQhJuo0Q173wf2KOo8t4I8vHy6lF9poUp7bKT0/NHE8fPX23PwfhnykfqnC2xRxOnVw5XuGIaA==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jsesc": "bin/jsesc"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/json-buffer": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/json-buffer/-/json-buffer-3.0.1.tgz",
      "integrity": "sha512-4bV5BfR2mqfQTJm+V5tPPdf+ZpuhiIvTuAB5g8kcrXOZpTT/QwwVRWBywX1ozr6lEuPdbHxwaJlm9G6mI2sfSQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-schema-traverse": {
      "version": "0.4.1",
      "resolved": "https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-0.4.1.tgz",
      "integrity": "sha512-xbbCH5dCYU5T8LcEhhuh7HJ88HXuW3qsI3Y0zOZFKfZEHcpWiHU/Jxzk629Brsab/mMiHQti9wMP+845RPe3Vg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-stable-stringify-without-jsonify": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/json-stable-stringify-without-jsonify/-/json-stable-stringify-without-jsonify-1.0.1.tgz",
      "integrity": "sha512-Bdboy+l7tA3OGW6FjyFHWkP5LuByj1Tk33Ljyq0axyzdk9//JSi2u3fP1QSmd1KNwq6VOKYGlAu87CisVir6Pw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json5": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/json5/-/json5-2.2.3.tgz",
      "integrity": "sha512-XmOWe7eyHYH14cLdVPoyg+GOH3rYX++KpzrylJwSW98t3Nk+U8XOl8FWKOgwtzdb8lXGf6zYwDUzeHMWfxasyg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "json5": "lib/cli.js"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/keyv": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/keyv/-/keyv-4.5.4.tgz",
      "integrity": "sha512-oxVHkHR/EJf2CNXnWxRLW6mg7JyCCUcG0DtEGmL2ctUo1PNTin1PUil+r/+4r5MpVgC/fn1kjsx7mjSujKqIpw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "json-buffer": "3.0.1"
      }
    },
    "node_modules/levn": {
      "version": "0.4.1",
      "resolved": "https://registry.npmjs.org/levn/-/levn-0.4.1.tgz",
      "integrity": "sha512-+bT2uH4E5LGE7h/n3evcS/sQlJXCpIp6ym8OWJ5eV6+67Dsql/LaaT7qJBAt2rzfoa/5QBGBhxDix1dMt2kQKQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "prelude-ls": "^1.2.1",
        "type-check": "~0.4.0"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/lightningcss": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss/-/lightningcss-1.32.0.tgz",
      "integrity": "sha512-NXYBzinNrblfraPGyrbPoD19C1h9lfI/1mzgWYvXUTe414Gz/X1FD2XBZSZM7rRTrMA8JL3OtAaGifrIKhQ5yQ==",
      "dev": true,
      "license": "MPL-2.0",
      "dependencies": {
        "detect-libc": "^2.0.3"
      },
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      },
      "optionalDependencies": {
        "lightningcss-android-arm64": "1.32.0",
        "lightningcss-darwin-arm64": "1.32.0",
        "lightningcss-darwin-x64": "1.32.0",
        "lightningcss-freebsd-x64": "1.32.0",
        "lightningcss-linux-arm-gnueabihf": "1.32.0",
        "lightningcss-linux-arm64-gnu": "1.32.0",
        "lightningcss-linux-arm64-musl": "1.32.0",
        "lightningcss-linux-x64-gnu": "1.32.0",
        "lightningcss-linux-x64-musl": "1.32.0",
        "lightningcss-win32-arm64-msvc": "1.32.0",
        "lightningcss-win32-x64-msvc": "1.32.0"
      }
    },
    "node_modules/lightningcss-android-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-android-arm64/-/lightningcss-android-arm64-1.32.0.tgz",
      "integrity": "sha512-YK7/ClTt4kAK0vo6w3X+Pnm0D2cf2vPHbhOXdoNti1Ga0al1P4TBZhwjATvjNwLEBCnKvjJc2jQgHXH0NEwlAg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-arm64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-arm64/-/lightningcss-darwin-arm64-1.32.0.tgz",
      "integrity": "sha512-RzeG9Ju5bag2Bv1/lwlVJvBE3q6TtXskdZLLCyfg5pt+HLz9BqlICO7LZM7VHNTTn/5PRhHFBSjk5lc4cmscPQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-x64/-/lightningcss-darwin-x64-1.32.0.tgz",
      "integrity": "sha512-U+QsBp2m/s2wqpUYT/6wnlagdZbtZdndSmut/NJqlCcMLTWp5muCrID+K5UJ6jqD2BFshejCYXniPDbNh73V8w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-freebsd-x64": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-freebsd-x64/-/lightningcss-freebsd-x64-1.32.0.tgz",
      "integrity": "sha512-JCTigedEksZk3tHTTthnMdVfGf61Fky8Ji2E4YjUTEQX14xiy/lTzXnu1vwiZe3bYe0q+SpsSH/CTeDXK6WHig==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm-gnueabihf": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm-gnueabihf/-/lightningcss-linux-arm-gnueabihf-1.32.0.tgz",
      "integrity": "sha512-x6rnnpRa2GL0zQOkt6rts3YDPzduLpWvwAF6EMhXFVZXD4tPrBkEFqzGowzCsIWsPjqSK+tyNEODUBXeeVHSkw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-gnu/-/lightningcss-linux-arm64-gnu-1.32.0.tgz",
      "integrity": "sha512-0nnMyoyOLRJXfbMOilaSRcLH3Jw5z9HDNGfT/gwCPgaDjnx0i8w7vBzFLFR1f6CMLKF8gVbebmkUN3fa/kQJpQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-musl/-/lightningcss-linux-arm64-musl-1.32.0.tgz",
      "integrity": "sha512-UpQkoenr4UJEzgVIYpI80lDFvRmPVg6oqboNHfoH4CQIfNA+HOrZ7Mo7KZP02dC6LjghPQJeBsvXhJod/wnIBg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-gnu": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-gnu/-/lightningcss-linux-x64-gnu-1.32.0.tgz",
      "integrity": "sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "glibc"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-musl": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-musl/-/lightningcss-linux-x64-musl-1.32.0.tgz",
      "integrity": "sha512-bYcLp+Vb0awsiXg/80uCRezCYHNg1/l3mt0gzHnWV9XP1W5sKa5/TCdGWaR/zBM2PeF/HbsQv/j2URNOiVuxWg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "libc": [
        "musl"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-arm64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-arm64-msvc/-/lightningcss-win32-arm64-msvc-1.32.0.tgz",
      "integrity": "sha512-8SbC8BR40pS6baCM8sbtYDSwEVQd4JlFTOlaD3gWGHfThTcABnNDBda6eTZeqbofalIJhFx0qKzgHJmcPTnGdw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-x64-msvc": {
      "version": "1.32.0",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-x64-msvc/-/lightningcss-win32-x64-msvc-1.32.0.tgz",
      "integrity": "sha512-Amq9B/SoZYdDi1kFrojnoqPLxYhQ4Wo5XiL8EVJrVsB8ARoC1PWW6VGtT0WKCemjy8aC+louJnjS7U18x3b06Q==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/locate-path": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-6.0.0.tgz",
      "integrity": "sha512-iPZK6eYjbxRu3uB4/WZ3EsEIMJFMqAoopl3R+zuq0UjcAm/MO6KCweDgPfP3elTztoKP3KtnVHxTn2NHBSDVUw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^5.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/loose-envify": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/loose-envify/-/loose-envify-1.4.0.tgz",
      "integrity": "sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==",
      "license": "MIT",
      "dependencies": {
        "js-tokens": "^3.0.0 || ^4.0.0"
      },
      "bin": {
        "loose-envify": "cli.js"
      }
    },
    "node_modules/lru-cache": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-5.1.1.tgz",
      "integrity": "sha512-KpNARQA3Iwv+jTA0utUVVbrh+Jlrr1Fv0e56GGzAFOXN7dk/FviaDW8LHmK52DlcH4WP2n6gI8vN1aesBFgo9w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "yallist": "^3.0.2"
      }
    },
    "node_modules/lucide-react": {
      "version": "1.22.0",
      "resolved": "https://registry.npmjs.org/lucide-react/-/lucide-react-1.22.0.tgz",
      "integrity": "sha512-c9o3l0PiNcgOQDW4F31BEYHudE7kgxVt3o30qMl36ZPwTxXlGB4QnLilhERvVM4uh/pl5MDyY1/gzZSYcHDtBg==",
      "license": "ISC",
      "peerDependencies": {
        "react": "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/magic-string": {
      "version": "0.30.21",
      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.21.tgz",
      "integrity": "sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.5"
      }
    },
    "node_modules/marked": {
      "version": "18.0.5",
      "resolved": "https://registry.npmjs.org/marked/-/marked-18.0.5.tgz",
      "integrity": "sha512-S6GcvALHg6K4ohtu4E7x0a1AqhAjp6cV8KhLSyN9qVapnzJkusVBxZRcIU9AeYsbe6P1hKDusSbEOzGyyuce6w==",
      "license": "MIT",
      "bin": {
        "marked": "bin/marked.js"
      },
      "engines": {
        "node": ">= 20"
      }
    },
    "node_modules/marked-highlight": {
      "version": "2.2.4",
      "resolved": "https://registry.npmjs.org/marked-highlight/-/marked-highlight-2.2.4.tgz",
      "integrity": "sha512-PZxisNMJDduSjc0q6uvjsnqqHCXc9s0eyzxDO9sB1eNGJnd/H1/Fu+z6g/liC1dfJdFW4SftMwMlLvsBhUPrqQ==",
      "license": "MIT",
      "peerDependencies": {
        "marked": ">=4 <19"
      }
    },
    "node_modules/minimatch": {
      "version": "10.2.5",
      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-10.2.5.tgz",
      "integrity": "sha512-MULkVLfKGYDFYejP07QOurDLLQpcjk7Fw+7jXS2R2czRQzR56yHRveU5NDJEOviH+hETZKSkIk5c+T23GjFUMg==",
      "dev": true,
      "license": "BlueOak-1.0.0",
      "dependencies": {
        "brace-expansion": "^5.0.5"
      },
      "engines": {
        "node": "18 || 20 || >=22"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/nanoid": {
      "version": "3.3.12",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.12.tgz",
      "integrity": "sha512-ZB9RH/39qpq5Vu6Y+NmUaFhQR6pp+M2Xt76XBnEwDaGcVAqhlvxrl3B2bKS5D3NH3QR76v3aSrKaF/Kiy7lEtQ==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/natural-compare": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
      "integrity": "sha512-OWND8ei3VtNC9h7V60qff3SVobHr996CTwgxubgyQYEpg290h9J0buyECNNJexkFm5sOajh5G116RYA1c8ZMSw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/node-releases": {
      "version": "2.0.47",
      "resolved": "https://registry.npmjs.org/node-releases/-/node-releases-2.0.47.tgz",
      "integrity": "sha512-Uzmd6LXpouKo8EUK68IjH4+E01w/hXyV3R3g/geCJo+rXLNfh1xucB+LOzYEOQPSiUK3h/xZf0cQGcSsmyL2Og==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/object-assign": {
      "version": "4.1.1",
      "resolved": "https://registry.npmjs.org/object-assign/-/object-assign-4.1.1.tgz",
      "integrity": "sha512-rJgTQnkUnH1sFw8yT6VSU3zD3sWmu6sZhIseY8VX+GRu3P6F7Fu+JNDoXfklElbLJSnc3FUQHVe4cU5hj+BcUg==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/optionator": {
      "version": "0.9.4",
      "resolved": "https://registry.npmjs.org/optionator/-/optionator-0.9.4.tgz",
      "integrity": "sha512-6IpQ7mKUxRcZNLIObR0hz7lxsapSSIYNZJwXPGeF0mTVqGKFIXj1DQcMoT22S3ROcLyY/rz0PWaWZ9ayWmad9g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "deep-is": "^0.1.3",
        "fast-levenshtein": "^2.0.6",
        "levn": "^0.4.1",
        "prelude-ls": "^1.2.1",
        "type-check": "^0.4.0",
        "word-wrap": "^1.2.5"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/p-limit": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-3.1.0.tgz",
      "integrity": "sha512-TYOanM3wGwNGsZN2cVTYPArw454xnXj5qmWF1bEoAc4+cU/ol7GVh7odevjp1FNHduHc3KZMcFduxU5Xc6uJRQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "yocto-queue": "^0.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-locate": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-5.0.0.tgz",
      "integrity": "sha512-LaNjtRWUBY++zB5nE/NwcaoMylSPk+S+ZHNB1TzdbMJMny6dynpAGt7X/tl/QYq3TIeE6nxHppbo2LGymrG5Pw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^3.0.2"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/path-exists": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/path-key": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
      "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.4.tgz",
      "integrity": "sha512-QP88BAKvMam/3NxH6vj2o21R6MjxZUAd6nlwAS/pnGvN9IVLocLHxGYIzFhg6fUQ+5th6P4dv4eW9jX3DSIj7A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/postcss": {
      "version": "8.5.15",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.15.tgz",
      "integrity": "sha512-FfR8sjd4em2T6fb3I2MwAJU7HWVMr9zba+enmQeeWFfCbm+UOC/0X4DS8XtpUTMwWMGbjKYP7xjfNekzyGmB3A==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.12",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.1"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/prelude-ls": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/prelude-ls/-/prelude-ls-1.2.1.tgz",
      "integrity": "sha512-vkcDPrRZo1QZLbn5RLGPpg/WmIQ65qoWWhcGKf/b5eplkkarX0m9z8ppCat4mlOqUsWpyNuYgO3VRyrYHSzX5g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/prop-types": {
      "version": "15.8.1",
      "resolved": "https://registry.npmjs.org/prop-types/-/prop-types-15.8.1.tgz",
      "integrity": "sha512-oj87CgZICdulUohogVAR7AjlC0327U4el4L6eAvOqCeudMDVU0NThNaV+b9Df4dXgSP1gXMTnPdhfe/2qDH5cg==",
      "license": "MIT",
      "dependencies": {
        "loose-envify": "^1.4.0",
        "object-assign": "^4.1.1",
        "react-is": "^16.13.1"
      }
    },
    "node_modules/punycode": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/punycode/-/punycode-2.3.1.tgz",
      "integrity": "sha512-vYt7UD1U9Wg6138shLtLOvdAu+8DsC/ilFtEVHcH+wydcSpNE20AfSOduf6MkRFahL5FY7X1oU7nKVZFtfq8Fg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/react": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react/-/react-19.2.7.tgz",
      "integrity": "sha512-HNe9WslTbXmFK8o8cmwgAeJFSBvt1bPdHCVKtaaV+WlAN36mpT4hcRpwbf3fY56ar2oIXzsBpOAiIRHAdY0OlQ==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-aria": {
      "version": "3.48.0",
      "resolved": "https://registry.npmjs.org/react-aria/-/react-aria-3.48.0.tgz",
      "integrity": "sha512-jQjd4rBEIMqecBaAKYJbVGK6EqIHLa5znVQ7jwFyK5vCyljoj6KhgtiahmcIPsG5vG5vEDLw+ba+bEWn6A2P4w==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.1",
        "@internationalized/number": "^3.6.6",
        "@internationalized/string": "^3.2.8",
        "@react-types/shared": "^3.34.0",
        "@swc/helpers": "^0.5.0",
        "aria-hidden": "^1.2.3",
        "clsx": "^2.0.0",
        "react-stately": "3.46.0",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/react-aria-components": {
      "version": "1.17.0",
      "resolved": "https://registry.npmjs.org/react-aria-components/-/react-aria-components-1.17.0.tgz",
      "integrity": "sha512-0EyisMgvsFJ2aML3crDYv2tW5vT2Ryf8PGzY/g63JjDdCbLshlwazhS8JNtPF1vkTkungJJ6sVJbKyX+YKSoFA==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.1",
        "@react-types/shared": "^3.34.0",
        "@swc/helpers": "^0.5.0",
        "client-only": "^0.0.1",
        "react-aria": "3.48.0",
        "react-stately": "3.46.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1",
        "react-dom": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/react-dom": {
      "version": "19.2.7",
      "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-19.2.7.tgz",
      "integrity": "sha512-t0BRVXvbiE/o20Hfw669rLbMCDWtYZLvmJigy2f0MxsXF+71pxhR3xOkspmsO8h3ZlNzyibAmtCa3l4lYKk6gQ==",
      "license": "MIT",
      "peer": true,
      "dependencies": {
        "scheduler": "^0.27.0"
      },
      "peerDependencies": {
        "react": "^19.2.7"
      }
    },
    "node_modules/react-i18next": {
      "version": "17.0.8",
      "resolved": "https://registry.npmjs.org/react-i18next/-/react-i18next-17.0.8.tgz",
      "integrity": "sha512-0ooKbGLU8JXhe1zwpQUWIeXSgLPOfwJmgheWRIUpcoA0CpyabpGhayjdG+/eA5esC1AQ8h2jWpXjJfzQzeDOCw==",
      "license": "MIT",
      "dependencies": {
        "@babel/runtime": "^7.29.2",
        "html-parse-stringify": "^3.0.1",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "i18next": ">= 26.2.0",
        "react": ">= 16.8.0",
        "typescript": "^5 || ^6"
      },
      "peerDependenciesMeta": {
        "react-dom": {
          "optional": true
        },
        "react-native": {
          "optional": true
        },
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/react-is": {
      "version": "16.13.1",
      "resolved": "https://registry.npmjs.org/react-is/-/react-is-16.13.1.tgz",
      "integrity": "sha512-24e6ynE2H+OKt4kqsOvNd8kBpV65zoxbA4BVsEOB3ARVWQki/DHzaUoC5KuON/BiccDaCCTZBuOcfZs70kR8bQ==",
      "license": "MIT"
    },
    "node_modules/react-router": {
      "version": "7.18.0",
      "resolved": "https://registry.npmjs.org/react-router/-/react-router-7.18.0.tgz",
      "integrity": "sha512-pTTGt8J+ji1NOmYnjzT+bAJy/1zD+Jp4ziO6cL7T3ZLvXKtusO7BpFqlRXitqpcPVqllsIXFHRMt+2/k3Xn6HQ==",
      "license": "MIT",
      "dependencies": {
        "cookie": "^1.0.1",
        "set-cookie-parser": "^2.6.0"
      },
      "engines": {
        "node": ">=20.0.0"
      },
      "peerDependencies": {
        "react": ">=18",
        "react-dom": ">=18"
      },
      "peerDependenciesMeta": {
        "react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/react-router-dom": {
      "version": "7.18.0",
      "resolved": "https://registry.npmjs.org/react-router-dom/-/react-router-dom-7.18.0.tgz",
      "integrity": "sha512-Fi0yY6kgtKae/Th2xibdWK0KSdYZ4B53Gyf6wRtomOKWgpNm7H7+DyfDhncdz9FKbpS+1jmDhg3F4WoGJ+yFOA==",
      "license": "MIT",
      "dependencies": {
        "react-router": "7.18.0"
      },
      "engines": {
        "node": ">=20.0.0"
      },
      "peerDependencies": {
        "react": ">=18",
        "react-dom": ">=18"
      }
    },
    "node_modules/react-stately": {
      "version": "3.46.0",
      "resolved": "https://registry.npmjs.org/react-stately/-/react-stately-3.46.0.tgz",
      "integrity": "sha512-OdxhWvHgs2L4OJGIs7hnuTr5WjjMM6enhNEAMRqiekhF8+ITvA2LRwNftOZwcogaoCslGYq5S2VQTQwnm0GbCA==",
      "license": "Apache-2.0",
      "dependencies": {
        "@internationalized/date": "^3.12.1",
        "@internationalized/number": "^3.6.6",
        "@internationalized/string": "^3.2.8",
        "@react-types/shared": "^3.34.0",
        "@swc/helpers": "^0.5.0",
        "use-sync-external-store": "^1.6.0"
      },
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0-rc.1 || ^18.0.0 || ^19.0.0-rc.1"
      }
    },
    "node_modules/react-transition-group": {
      "version": "4.4.5",
      "resolved": "https://registry.npmjs.org/react-transition-group/-/react-transition-group-4.4.5.tgz",
      "integrity": "sha512-pZcd1MCJoiKiBR2NRxeCRg13uCXbydPnmB4EOeRrY7480qNWO8IIgQG6zlDkm6uRMsURXPuKq0GWtiM59a5Q6g==",
      "license": "BSD-3-Clause",
      "dependencies": {
        "@babel/runtime": "^7.5.5",
        "dom-helpers": "^5.0.1",
        "loose-envify": "^1.4.0",
        "prop-types": "^15.6.2"
      },
      "peerDependencies": {
        "react": ">=16.6.0",
        "react-dom": ">=16.6.0"
      }
    },
    "node_modules/rolldown": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/rolldown/-/rolldown-1.1.2.tgz",
      "integrity": "sha512-x0CrQQqCXWGeI8dTvFfN/Dnv3yMKT9hv5jFjlOreKAx9wqLq9wz7VvLLHyaAXC90/CpggTu9SisSbsJJTPSjNQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@oxc-project/types": "=0.137.0",
        "@rolldown/pluginutils": "^1.0.0"
      },
      "bin": {
        "rolldown": "bin/cli.mjs"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "optionalDependencies": {
        "@rolldown/binding-android-arm64": "1.1.2",
        "@rolldown/binding-darwin-arm64": "1.1.2",
        "@rolldown/binding-darwin-x64": "1.1.2",
        "@rolldown/binding-freebsd-x64": "1.1.2",
        "@rolldown/binding-linux-arm-gnueabihf": "1.1.2",
        "@rolldown/binding-linux-arm64-gnu": "1.1.2",
        "@rolldown/binding-linux-arm64-musl": "1.1.2",
        "@rolldown/binding-linux-ppc64-gnu": "1.1.2",
        "@rolldown/binding-linux-s390x-gnu": "1.1.2",
        "@rolldown/binding-linux-x64-gnu": "1.1.2",
        "@rolldown/binding-linux-x64-musl": "1.1.2",
        "@rolldown/binding-openharmony-arm64": "1.1.2",
        "@rolldown/binding-wasm32-wasi": "1.1.2",
        "@rolldown/binding-win32-arm64-msvc": "1.1.2",
        "@rolldown/binding-win32-x64-msvc": "1.1.2"
      }
    },
    "node_modules/scheduler": {
      "version": "0.27.0",
      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz",
      "integrity": "sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q==",
      "license": "MIT",
      "peer": true
    },
    "node_modules/semver": {
      "version": "6.3.1",
      "resolved": "https://registry.npmjs.org/semver/-/semver-6.3.1.tgz",
      "integrity": "sha512-BR7VvDCVHO+q2xBEWskxS6DJE1qRnb7DxzUrogb71CWoSficBxYsiAGd+Kl0mmq/MprG9yArRkyrQxTO6XjMzA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      }
    },
    "node_modules/set-cookie-parser": {
      "version": "2.7.2",
      "resolved": "https://registry.npmjs.org/set-cookie-parser/-/set-cookie-parser-2.7.2.tgz",
      "integrity": "sha512-oeM1lpU/UvhTxw+g3cIfxXHyJRc/uidd3yK1P242gzHds0udQBYzs3y8j4gCCW+ZJ7ad0yctld8RYO+bdurlvw==",
      "license": "MIT"
    },
    "node_modules/shebang-command": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "shebang-regex": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/shebang-regex": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/tailwind-merge": {
      "version": "3.4.0",
      "resolved": "https://registry.npmjs.org/tailwind-merge/-/tailwind-merge-3.4.0.tgz",
      "integrity": "sha512-uSaO4gnW+b3Y2aWoWfFpX62vn2sR3skfhbjsEnaBI81WD1wBLlHZe5sWf0AqjksNdYTbGBEd0UasQMT3SNV15g==",
      "license": "MIT",
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/dcastil"
      }
    },
    "node_modules/tailwind-variants": {
      "version": "3.2.2",
      "resolved": "https://registry.npmjs.org/tailwind-variants/-/tailwind-variants-3.2.2.tgz",
      "integrity": "sha512-Mi4kHeMTLvKlM98XPnK+7HoBPmf4gygdFmqQPaDivc3DpYS6aIY6KiG/PgThrGvii5YZJqRsPz0aPyhoFzmZgg==",
      "license": "MIT",
      "engines": {
        "node": ">=16.x",
        "pnpm": ">=7.x"
      },
      "peerDependencies": {
        "tailwind-merge": ">=3.0.0",
        "tailwindcss": "*"
      },
      "peerDependenciesMeta": {
        "tailwind-merge": {
          "optional": true
        }
      }
    },
    "node_modules/tailwindcss": {
      "version": "4.3.1",
      "resolved": "https://registry.npmjs.org/tailwindcss/-/tailwindcss-4.3.1.tgz",
      "integrity": "sha512-hk+TB1m+K8CYNrP6rjQaq/Y+4Zylwpa87mLYBKCunwnnQ9p+fHb7kmSfGqyEJoxF/O6CDyABWVFEafNSYKll+Q==",
      "license": "MIT"
    },
    "node_modules/tapable": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/tapable/-/tapable-2.3.3.tgz",
      "integrity": "sha512-uxc/zpqFg6x7C8vOE7lh6Lbda8eEL9zmVm/PLeTPBRhh1xCgdWaQ+J1CUieGpIfm2HdtsUpRv+HshiasBMcc6A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/webpack"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.4"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/ts-api-utils": {
      "version": "2.5.0",
      "resolved": "https://registry.npmjs.org/ts-api-utils/-/ts-api-utils-2.5.0.tgz",
      "integrity": "sha512-OJ/ibxhPlqrMM0UiNHJ/0CKQkoKF243/AEmplt3qpRgkW8VG7IfOS41h7V8TjITqdByHzrjcS/2si+y4lIh8NA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18.12"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4"
      }
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "license": "0BSD"
    },
    "node_modules/tw-animate-css": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/tw-animate-css/-/tw-animate-css-1.4.0.tgz",
      "integrity": "sha512-7bziOlRqH0hJx80h/3mbicLW7o8qLsH5+RaLR2t+OHM3D0JlWGODQKQ4cxbK7WlvmUxpcj6Kgu6EKqjrGFe3QQ==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/Wombosvideo"
      }
    },
    "node_modules/type-check": {
      "version": "0.4.0",
      "resolved": "https://registry.npmjs.org/type-check/-/type-check-0.4.0.tgz",
      "integrity": "sha512-XleUoc9uwGXqjWwXaUTZAmzMcFZ5858QA2vvx1Ur5xIcixXIP+8LnFDgRplU30us6teqdlskFfu+ae4K79Ooew==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "prelude-ls": "^1.2.1"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/typescript": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
      "integrity": "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
      "devOptional": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/typescript-eslint": {
      "version": "8.62.0",
      "resolved": "https://registry.npmjs.org/typescript-eslint/-/typescript-eslint-8.62.0.tgz",
      "integrity": "sha512-8QxXi+ZACKX0kaqO4gY8kn0RSD9gFfaHDWwjqtEN48aWCBkX4MJaufWN+c3BzlrXLOxfywDL8CaoqUwcRq4j4Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/eslint-plugin": "8.62.0",
        "@typescript-eslint/parser": "8.62.0",
        "@typescript-eslint/typescript-estree": "8.62.0",
        "@typescript-eslint/utils": "8.62.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0 || ^10.0.0",
        "typescript": ">=4.8.4 <6.1.0"
      }
    },
    "node_modules/update-browserslist-db": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.2.3.tgz",
      "integrity": "sha512-Js0m9cx+qOgDxo0eMiFGEueWztz+d4+M3rGlmKPT+T4IS/jP4ylw3Nwpu6cpTTP8R1MAC1kF4VbdLt3ARf209w==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "escalade": "^3.2.0",
        "picocolors": "^1.1.1"
      },
      "bin": {
        "update-browserslist-db": "cli.js"
      },
      "peerDependencies": {
        "browserslist": ">= 4.21.0"
      }
    },
    "node_modules/uri-js": {
      "version": "4.4.1",
      "resolved": "https://registry.npmjs.org/uri-js/-/uri-js-4.4.1.tgz",
      "integrity": "sha512-7rKUyy33Q1yc98pQ1DAmLtwX109F7TIfWlW1Ydo8Wl1ii1SeHieeh0HHfPeL2fMXK6z0s8ecKs9frCuLJvndBg==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "punycode": "^2.1.0"
      }
    },
    "node_modules/use-sync-external-store": {
      "version": "1.6.0",
      "resolved": "https://registry.npmjs.org/use-sync-external-store/-/use-sync-external-store-1.6.0.tgz",
      "integrity": "sha512-Pp6GSwGP/NrPIrxVFAIkOQeyw8lFenOHijQWkUTrDvrF4ALqylP2C/KCkeS9dpUM3KvYRQhna5vt7IL95+ZQ9w==",
      "license": "MIT",
      "peerDependencies": {
        "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/vite": {
      "version": "8.1.0",
      "resolved": "https://registry.npmjs.org/vite/-/vite-8.1.0.tgz",
      "integrity": "sha512-BuJcQK/56NQTWDGn4ABea3q4SSBdNPWwNZKTkkUpcMPnLoquSYH8llRtSUIgoL1KSCpHt5eghLShn50mH36y7Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "lightningcss": "^1.32.0",
        "picomatch": "^4.0.4",
        "postcss": "^8.5.15",
        "rolldown": "~1.1.2",
        "tinyglobby": "^0.2.17"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^20.19.0 || >=22.12.0",
        "@vitejs/devtools": "^0.3.0",
        "esbuild": "^0.27.0 || ^0.28.0",
        "jiti": ">=1.21.0",
        "less": "^4.0.0",
        "sass": "^1.70.0",
        "sass-embedded": "^1.70.0",
        "stylus": ">=0.54.8",
        "sugarss": "^5.0.0",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "@vitejs/devtools": {
          "optional": true
        },
        "esbuild": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/void-elements": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/void-elements/-/void-elements-3.1.0.tgz",
      "integrity": "sha512-Dhxzh5HZuiHQhbvTW9AMetFfBHDMYpo23Uo9btPXgdYP+3T5S+p+jgNy7spra+veYhBP2dCSgxR/i2Y02h5/6w==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/which": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "isexe": "^2.0.0"
      },
      "bin": {
        "node-which": "bin/node-which"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/word-wrap": {
      "version": "1.2.5",
      "resolved": "https://registry.npmjs.org/word-wrap/-/word-wrap-1.2.5.tgz",
      "integrity": "sha512-BN22B5eaMMI9UMtjrGd5g5eCYPpCPDUy0FJXbYsaT5zYxjFOckS53SQDE3pWkVoWpHXVb3BrYcEN4Twa55B5cA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/yallist": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-3.1.1.tgz",
      "integrity": "sha512-a4UGQaWPH59mOXUYnAG2ewncQS4i4F43Tv3JoAM+s2VDAmS9NsK8GpDMLrCHPksFT7h3K6TOoUNn2pb7RoXx4g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/yocto-queue": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-0.1.0.tgz",
      "integrity": "sha512-rVksvsnNCdJ/ohGc6xgPwyN8eheCxsiLM8mxuE/t/mOVqJewPuO1miLpTHQiRgTKCLexL4MeAFVagts7HmNZ2Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/zod": {
      "version": "3.25.76",
      "resolved": "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
      "integrity": "sha512-gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxWPx3d9p8S5QoaujKcNQxcQ==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/colinhacks"
      }
    },
    "node_modules/zod-validation-error": {
      "version": "3.5.4",
      "resolved": "https://registry.npmjs.org/zod-validation-error/-/zod-validation-error-3.5.4.tgz",
      "integrity": "sha512-+hEiRIiPobgyuFlEojnqjJnhFvg4r/i3cqgcm67eehZf/WBaK3g6cD02YU9mtdVxZjv8CzCA9n/Rhrs3yAAvAw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18.0.0"
      },
      "peerDependencies": {
        "zod": "^3.24.4"
      }
    }
  }
}
```

### `ui/package.json`

```json
{
  "name": "ui",
  "version": "1.5.0",
  "description": "UI for managing AI key vault",
  "homepage": "https://github.com/sctg-development/ai-proxy-cloudflare#readme",
  "bugs": {
    "url": "https://github.com/sctg-development/ai-proxy-cloudflare/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sctg-development/ai-proxy-cloudflare.git"
  },
  "license": "MIT",
  "author": "Ronan Le Meillat",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src",
    "test": "exit 0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@types/react-router-dom": "^5.3.3",
    "@vitejs/plugin-react": "^6.0.3",
    "eslint": "^10.6.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.62.0",
    "vite": "^8.1.0"
  },
  "dependencies": {
    "@heroui/react": "^3.2.1",
    "@heroui/styles": "^3.2.1",
    "@sctg/cline-chatbot": "4.0.0-beta.20260702235240",
    "highlight.js": "^11.11.1",
    "i18next": "^26.3.3",
    "idb": "^8.0.3",
    "lucide-react": "^1.22.0",
    "marked": "^18.0.5",
    "marked-highlight": "^2.2.4",
    "react": "^19.2.6",
    "react-i18next": "^17.0.8",
    "react-router-dom": "^7.18.0",
    "tailwindcss": "^4.3.1"
  }
}
```

### `ui/src/ai.sample.crawlers.json`

```json
{
  "version": 1,
  "providers": {
    "openai-primary": {
      "protocol": "openai",
      "endpoint": "https://api.openai.com/v1",
      "keys": [
        {
          "key": "sk-1234567890abcdef1234567890abcdef12345678",
          "owner": "team-backend",
          "type": "paid"
        }
      ],
      "models": [
        {
          "id": "gpt-4o",
          "usage": "chat",
          "contextWindow": 128000,
          "maxOutputTokens": 4096,
          "priority": 0,
          "tpmLimit": null,
          "inputModalities": ["text"],
          "outputModalities": ["text"]
        }
      ]
    }
  },
  "crawlers": {
    "firecrawl-primary": {
      "protocol": "firecrawl",
      "endpoint": "https://api.firecrawl.dev/v0",
      "keys": [
        {
          "key": "fc-1234567890abcdef1234567890abcdef12345678",
          "owner": "team-scraping",
          "type": "paid"
        }
      ]
    },
    "scrapegraphai-primary": {
      "protocol": "scrapegraphai",
      "endpoint": "https://api.scrapegraphai.com/v1",
      "keys": [
        {
          "key": "sg-1234567890abcdef1234567890abcdef12345678",
          "owner": "team-scraping",
          "type": "paid"
        }
      ]
    }
  }
}
```

### `ui/src/App.tsx`

**Exports:** App

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
import React from 'react';
import { useAi } from './hooks/use-ai';
import { LoginScreen } from './components/login-screen';
import { Dashboard } from './components/dashboard';

/**
 * Main application component.
 * We use the isAuthenticated state from our custom hook 
 * to decide which screen to show.
 */
export const App: React.FC = () => {
  const { isAuthenticated } = useAi();

  return (
    <div className="min-h-screen text-foreground selection:bg-primary/20">
      {isAuthenticated ? <Dashboard /> : <LoginScreen />}
    </div>
  );
};

```

### `ui/src/components/admin-panel.tsx`

**Exports:** AdminPanel

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
 * @file Administration panel: group management (superadmin) and per-group
 * user management (group admin or superadmin).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, Form, Input, Label, TextField } from '@heroui/react';
import { Copy, Plus, RefreshCw, Shield, Trash2, UserPlus, Users } from 'lucide-react';

import { useAi } from '../hooks/use-ai';
import { ApiService, type GroupMember, type GroupSummary } from '../lib/api';

/** A freshly created/regenerated API key, shown exactly once. */
interface RevealedKey {
  username: string;
  key: string;
}

export const AdminPanel: React.FC = () => {
  const { userContext } = useAi();
  const isSuperadmin = userContext?.role === 'superadmin';

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(userContext?.groupId ?? null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const reloadGroups = useCallback(async () => {
    try {
      const list = await ApiService.listGroups();
      setGroups(list);
      // Preselect: own group for admins, first group for superadmins
      setSelectedGroupId((current) => {
        if (current && list.some((g) => g.id === current)) return current;
        return userContext?.groupId ?? list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    }
  }, [userContext?.groupId]);

  const reloadMembers = useCallback(async (groupId: string) => {
    try {
      setMembers(await ApiService.listGroupUsers(groupId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
  }, [reloadGroups]);

  useEffect(() => {
    if (selectedGroupId) {
      void reloadMembers(selectedGroupId);
    } else {
      setMembers([]);
    }
  }, [selectedGroupId, reloadMembers]);

  /** Wraps an admin action with busy/error handling. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateGroup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    void run(async () => {
      await ApiService.createGroup(name);
      setNewGroupName('');
      await reloadGroups();
    });
  };

  const handleDeleteGroup = (group: GroupSummary) => {
    if (group.memberCount > 0) {
      if (!confirm(`Group "${group.name}" still has ${group.memberCount} member(s). Delete the group AND its members?`)) {
        return;
      }
    } else if (!confirm(`Delete group "${group.name}" and its vault?`)) {
      return;
    }
    void run(async () => {
      await ApiService.deleteGroup(group.id, group.memberCount > 0);
      if (selectedGroupId === group.id) setSelectedGroupId(null);
      await reloadGroups();
    });
  };

  const handleCreateUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const username = newUsername.trim();
    if (!username || !selectedGroupId) return;
    void run(async () => {
      const created = await ApiService.createGroupUser(selectedGroupId, username, newUserRole);
      setRevealedKey({ username: created.username, key: created.key });
      setNewUsername('');
      setNewUserRole('user');
      await reloadMembers(selectedGroupId);
      await reloadGroups();
    });
  };

  const handleToggleRole = (member: GroupMember) => {
    if (!selectedGroupId) return;
    const nextRole = member.role === 'admin' ? 'user' : 'admin';
    void run(async () => {
      await ApiService.updateGroupUser(selectedGroupId, member.username, { role: nextRole });
      await reloadMembers(selectedGroupId);
    });
  };

  const handleRegenerateKey = (member: GroupMember) => {
    if (!selectedGroupId) return;
    if (!confirm(`Regenerate the API key of "${member.username}"? The current key stops working immediately.`)) return;
    void run(async () => {
      const updated = await ApiService.updateGroupUser(selectedGroupId, member.username, { regenerateKey: true });
      if (updated.key) setRevealedKey({ username: member.username, key: updated.key });
      await reloadMembers(selectedGroupId);
    });
  };

  const handleDeleteUser = (member: GroupMember) => {
    if (!selectedGroupId) return;
    if (!confirm(`Remove "${member.username}" from the group?`)) return;
    void run(async () => {
      await ApiService.deleteGroupUser(selectedGroupId, member.username);
      await reloadMembers(selectedGroupId);
      await reloadGroups();
    });
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* One-time reveal of a freshly created/regenerated API key */}
      {revealedKey && (
        <Alert status="success">
          <Alert.Content>
            <Alert.Description>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  API key for <strong>{revealedKey.username}</strong> (copy it now, it will not be shown again):
                </span>
                <code className="rounded bg-black/10 px-2 py-1 font-mono text-sm">{revealedKey.key}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    void navigator.clipboard.writeText(revealedKey.key);
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setRevealedKey(null)}>
                  Dismiss
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* ── Groups (superadmin only) ─────────────────────────────── */}
      {isSuperadmin && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5" />
              Groups
            </h2>
            <Form onSubmit={handleCreateGroup} className="flex items-end gap-2">
              <TextField
                value={newGroupName}
                onChange={setNewGroupName}
                name="groupName"
                isRequired
              >
                <Label className="sr-only">New group name</Label>
                <Input placeholder="New group name" className="w-48" />
              </TextField>
              <Button size="sm" type="submit" isPending={busy}>
                <Plus className="mr-2 h-4 w-4" />
                Add Group
              </Button>
            </Form>
          </div>

          <div className="grid gap-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                  selectedGroupId === group.id ? 'border-primary bg-primary/5' : 'border-default-200 hover:bg-default-50'
                }`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{group.name}</span>
                  <code className="text-xs text-default-500">{group.id}</code>
                  {group.legacy && <Chip size="sm">legacy</Chip>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-sm text-default-500">
                    <Users className="h-4 w-4" />
                    {group.memberCount}
                  </span>
                  {!group.legacy && (
                    <Button
                      size="sm"
                      variant="danger-soft"
                      onPress={() => handleDeleteGroup(group)}
                      isPending={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-default-500">No groups yet. Create the first one above.</p>
            )}
          </div>
        </section>
      )}

      {/* ── Members of the selected group ────────────────────────── */}
      {selectedGroup && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5" />
              Members of {selectedGroup.name}
            </h2>
            <Form onSubmit={handleCreateUser} className="flex items-end gap-2">
              <TextField value={newUsername} onChange={setNewUsername} name="username" isRequired>
                <Label className="sr-only">Username</Label>
                <Input placeholder="Username" className="w-40" />
              </TextField>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'user')}
                className="h-9 rounded-md border border-default-200 bg-transparent px-2 text-sm"
                aria-label="Role"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <Button size="sm" type="submit" isPending={busy}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </Form>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <div
                key={member.username}
                className="flex items-center justify-between rounded-lg border border-default-200 p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{member.username}</span>
                  <Chip size="sm" color={member.role === 'user' ? 'default' : 'accent'}>
                    {member.role}
                  </Chip>
                  {member.keyHint && (
                    <code className="text-xs text-default-500">{member.keyHint}</code>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {member.role !== 'superadmin' && (
                    <Button size="sm" variant="ghost" onPress={() => handleToggleRole(member)} isPending={busy}>
                      {member.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onPress={() => handleRegenerateKey(member)} isPending={busy}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    New key
                  </Button>
                  {member.username !== userContext?.username && (
                    <Button size="sm" variant="danger-soft" onPress={() => handleDeleteUser(member)} isPending={busy}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-sm text-default-500">No members in this group yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
```

### `ui/src/components/chatbot-panel.tsx`

**Exports:** ChatbotPanel

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
 * @file Embedded @sctg/cline-chatbot panel — replaces the legacy playground.
 * The chatbot shares the vault session token (sessionStorage 'ai_vault_token')
 * with this dashboard, so an authenticated user lands directly in the chat.
 */

import React from 'react';
import { Chatbot } from '@sctg/cline-chatbot';
import '@sctg/cline-chatbot/style.css';

/** Base URL of the vault/usage Worker (same host for both roles). */
const WORKER_URL = import.meta.env.VAULT_URL as string;

export const ChatbotPanel: React.FC = () => {
  return (
    <div className="h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-default-200">
      <Chatbot vaultUrl={WORKER_URL} usageDbUrl={WORKER_URL} className="h-full" />
    </div>
  );
};
```

### `ui/src/components/dashboard.tsx`

**Exports:** Dashboard

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
 * @file Main dashboard for managing the AI vault.
 * Providers, their models and their API keys are all managed from here.
 * Changes are edited as a local draft first. The encrypted Worker vault is only
 * updated when the user explicitly presses the save button.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import { useAi } from '../hooks/use-ai';
import {
  Download,
  FlaskConical,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shield,
  Upload,
  Webhook,
  X,
  Cloud,
} from 'lucide-react';
import type { AiConfig, AiModel } from '../types/ai-config';
import {
  canDiscoverProviderModels,
  discoverProviderModels,
  maskApiKey,
  renumberPriorities,
} from '../lib/provider-models';
import { validateAiConfigSchema } from '../lib/utils/file-utils';
import { ChatbotPanel } from './chatbot-panel';
import { AdminPanel } from './admin-panel';
import { ProviderCard } from './ui/ProviderCard';
import { CrawlerCard } from './ui/CrawlerCard';
import { WeatherApiCard } from './ui/WeatherApiCard';
import { ConfigModal } from './ui/ConfigModal';
import { ApiService } from '../lib/api';
// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Identifies the entity being added or edited inside the modal.
 * `itemId` is optional:
 *   - provider: not used (providerId is the identifier)
 *   - crawler: not used (crawlerId is the identifier)
 *   - model: the model.id string
 *   - key: the numeric index in the keys array (as a string)
 */
interface EditTarget {
  type: 'provider' | 'model' | 'key' | 'crawler' | 'weatherApi';
  providerId?: string;
  crawlerId?: string;
  weatherApiId?: string;
  /** Model id or key array index (stringified) when editing an existing item. */
  itemId?: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Main application dashboard. Shown after the user authenticates.
 *
 * All state that needs to survive across modal opens/closes
 * (e.g. which provider we are editing) lives here, not inside the modal, so
 * it is not lost when the modal unmounts.
 */
export const Dashboard: React.FC = () => {
  const { config, loading, error, logout, refresh, updateConfig, userContext } = useAi();

  /** Editable copy of the loaded vault. Only this draft is mutated by UI actions. */
  const [draftConfig, setDraftConfig] = useState<AiConfig | null>(null);

  /** True when `draftConfig` contains changes that are not yet persisted. */
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  /** Currently selected top-level tab ("providers"). */
  const [activeTab, setActiveTab] = useState<string>('providers');

  /** Toggles between vault management and chat playground modes. */
  const [showPlayground, setShowPlayground] = useState(false);

  /** What type of form the modal should show. */
  const [modalType, setModalType] = useState<EditTarget['type']>('provider');

  /** Which provider/model/key is being edited. null = "add new" mode. */
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  /** Provider currently refreshing its model catalogue from an upstream API. */
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);

  /** Per-provider sync status shown next to the model list after refresh. */
  const [modelSyncMessages, setModelSyncMessages] = useState<Record<string, string>>({});

  /** Per-provider list of available model IDs from the last API refresh. */
  const [availableModelIds, setAvailableModelIds] = useState<Record<string, string[]>>({});

  /** Set of model IDs that are available for BYOK. */
  const [byokModelIds, setByokModelIds] = useState<Set<string>>(new Set());

  /** Set of crawler IDs that are available for BYOK. */
  const [byokCrawlerIds, setByokCrawlerIds] = useState<Set<string>>(new Set());

  /** Set of weather API IDs that are available for BYOK. */
  const [byokWeatherApiIds, setByokWeatherApiIds] = useState<Set<string>>(new Set());


  /**
   * Controlled open/close state for the config modal.
   * `useOverlayState` is the HeroUI-idiomatic way to drive a Modal from
   * outside (rather than using a trigger button inside the modal tree).
   */
  const modalState = useOverlayState();

  /**
   * Keeps the local draft aligned with the server config as long as the user has
   * no pending edits. Once the draft is dirty, incoming hook updates are ignored
   * until the user saves or discards their edits.
   */
  useEffect(() => {
    if (config && !hasUnsavedChanges) {
      setDraftConfig(JSON.parse(JSON.stringify(config)) as AiConfig);
    }
  }, [config, hasUnsavedChanges]);

  /**
   * Load BYOK configuration from the Worker on initial load.
   */
  useEffect(() => {
    const loadByokConfig = async () => {
      try {
        const token = ApiService.getToken();
        if (!token) return;

        const response = await fetch(`${import.meta.env.VAULT_URL}/v1/keypool/byok/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          // If BYOK config doesn't exist yet, that's fine - start with empty sets
          if (response.status === 404) {
            return;
          }
          throw new Error(`Failed to load BYOK config: ${response.status}`);
        }

        const byokConfig: AiConfig = await response.json();

        // Initialize BYOK model IDs from the loaded config
        const initialByokModelIds = new Set<string>();
        for (const provider of Object.values(byokConfig.providers || {})) {
          for (const model of provider.models) {
            initialByokModelIds.add(model.id);
          }
        }

        // Initialize BYOK crawler IDs from the loaded config
        const initialByokCrawlerIds = new Set<string>();
        for (const crawlerId of Object.keys(byokConfig.crawlers || {})) {
          initialByokCrawlerIds.add(crawlerId);
        }

        setByokModelIds(initialByokModelIds);
        setByokCrawlerIds(initialByokCrawlerIds);

      } catch (err) {
        console.error('Failed to load BYOK configuration:', err);
        // Don't show error to user - BYOK is optional feature
      }
    };

    // Only load BYOK config if we have a valid config loaded
    if (config) {
      loadByokConfig();
    }
  }, [config]);

  /** Config currently displayed by the dashboard; falls back during first render after load. */
  const activeConfig = draftConfig ?? config;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Opens the modal for a given operation.
   * @param type - The type of entity to add or edit.
   * @param target - Null for "add new", or the existing entity's coordinates.
   */
  const openModal = (type: EditTarget['type'], target: EditTarget | null) => {
    setModalType(type);
    setEditTarget(target);
    modalState.open();
  };

  /**
   * Stages a new config version locally without writing to the Worker.
   * deep-clone with JSON.parse(JSON.stringify()) avoids
   * mutating React state directly, which would cause subtle bugs.
   *
   * @param newConfig - The full updated config object.
   */
  const stageConfig = (newConfig: AiConfig) => {
    setDraftConfig(JSON.parse(JSON.stringify(newConfig)) as AiConfig);
    setHasUnsavedChanges(true);
    modalState.close();
    setEditTarget(null);
  };

  /**
   * Encrypts and persists the current draft. This is the only dashboard action
   * that calls PUT /ai.json.enc through the context's `updateConfig`.
   */
  const saveDraftToWorker = async () => {
    if (!draftConfig) return;
    try {
      await updateConfig(draftConfig);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Vault update failed', err);
    }
  };

  /**
   * Drops all local edits and restores the last configuration fetched from the
   * Worker.
   */
  const discardDraft = () => {
    if (!config) return;
    if (hasUnsavedChanges && !confirm('Discard unsaved vault changes?')) return;
    setDraftConfig(JSON.parse(JSON.stringify(config)) as AiConfig);
    setHasUnsavedChanges(false);
    modalState.close();
    setEditTarget(null);
  };

  /**
   * Saves the BYOK configuration to the Worker.
   * Creates an AiConfig with only the BYOK-enabled models and crawlers, with empty key arrays.
   */
  const saveByokConfig = async () => {
    if (!activeConfig) return;

    try {
      // Create a BYOK config with only the selected models and crawlers
      const byokConfig: AiConfig = {
        version: activeConfig.version,
        providers: {},
        crawlers: {},
      };

      // Add providers that have BYOK-enabled models
      for (const [providerId, provider] of Object.entries(activeConfig.providers)) {
        const byokModels = provider.models.filter(model => byokModelIds.has(model.id));

        if (byokModels.length > 0) {
          byokConfig.providers[providerId] = {
            ...provider,
            keys: [], // Empty keys for BYOK
            models: byokModels,
          };
        }
      }

      // Add BYOK-enabled crawlers
      for (const [crawlerId, crawler] of Object.entries(activeConfig.crawlers)) {
        if (byokCrawlerIds.has(crawlerId)) {
          byokConfig.crawlers[crawlerId] = {
            ...crawler,
            keys: [], // Empty keys for BYOK
          };
        }
      }

      // Send the BYOK config to the Worker
      const response = await fetch(`${import.meta.env.VAULT_URL}/v1/keypool/byok/models`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ApiService.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(byokConfig),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to save BYOK config');
      }

      alert('BYOK configuration saved successfully!');
    } catch (err) {
      console.error('BYOK save failed', err);
      alert(`Failed to save BYOK configuration: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  /**
   * Refreshes from the Worker. If the draft is dirty, this would overwrite the
   * local work, so the user decides explicitly.
   */
  const refreshFromWorker = async () => {
    if (hasUnsavedChanges && !confirm('Discard unsaved changes and reload from the Worker?')) return;
    setHasUnsavedChanges(false);
    await refresh();
  };

  /**
   * Removes a provider (and all its models and keys) from the config.
   * @param id - The provider dictionary key.
   */
  const deleteProvider = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete provider "${id}" and all its models and keys?`)) return;

    // Spread-clone the top level, then delete the key from the cloned providers map.
    const newConfig: AiConfig = {
      ...activeConfig,
      providers: { ...activeConfig.providers },
    };
    delete newConfig.providers[id];
    stageConfig(newConfig);
  };

  /**
   * Replaces one provider's model list with the catalogue returned by its
   * upstream API. The first non-expired key is used because expired keys are
   * deliberately kept in the vault for audit/history but must not be tested.
   */
  const refreshProviderModels = async (id: string) => {
    if (!activeConfig) return;

    const provider = activeConfig.providers[id];
    const usableKey = provider.keys.find((apiKey) => apiKey.type !== 'expired');
    if (!usableKey) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: 'No non-expired key available to query this provider.',
      }));
      return;
    }

    setSyncingProviderId(id);
    setModelSyncMessages((messages) => ({
      ...messages,
      [id]: `Querying with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models);
      if (result.models.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No usable chat or embedding models found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from result.models.
      const newModelIds = new Set(result.models.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...result.models, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = result.models.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${result.models.length} model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize models.',
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  /**
   * Refreshes only the free models (with ":free" in the name) for OpenRouter.
   * Uses the same flow as refreshProviderModels but with the freeOnly flag.
   */
  const refreshProviderFreeModels = async (id: string) => {
    if (!activeConfig) return;

    const provider = activeConfig.providers[id];
    const usableKey = provider.keys.find((apiKey) => apiKey.type !== 'expired');
    if (!usableKey) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: 'No non-expired key available to query this provider.',
      }));
      return;
    }

    setSyncingProviderId(id);
    setModelSyncMessages((messages) => ({
      ...messages,
      [id]: `Querying free models with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models, true);
      if (result.models.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No free models (":free") found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from result.models.
      const newModelIds = new Set(result.models.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...result.models, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = result.models.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${result.models.length} free model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize free models.',
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  /**
   * Refreshes only the latest models (ending with "-latest") for Mistral.
   * Uses the same flow as refreshProviderModels but filters for "-latest" suffix.
   */
  const refreshProviderLatestModels = async (id: string) => {
    if (!activeConfig) return;

    const provider = activeConfig.providers[id];
    const usableKey = provider.keys.find((apiKey) => apiKey.type !== 'expired');
    if (!usableKey) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: 'No non-expired key available to query this provider.',
      }));
      return;
    }

    setSyncingProviderId(id);
    setModelSyncMessages((messages) => ({
      ...messages,
      [id]: `Querying latest models with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models);
      // Filter models to keep only those ending with "-latest"
      const latestModels = result.models.filter(model => model.id.endsWith('-latest'));

      if (latestModels.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No models ending with "-latest" found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from latestModels.
      const newModelIds = new Set(latestModels.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...latestModels, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = latestModels.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${latestModels.length} latest model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize latest models.',
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  /**
   * Saves a reordered model array and regenerates priorities from the visible
   * order. Priority `0` is the first model in the list.
   */
  const reorderProviderModels = (id: string, models: AiModel[]) => {
    if (!activeConfig) return;
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(models);
    stageConfig(newConfig);
  };

  /**
   * Deletes several models at once and then compacts priorities using the same
   * step-based numbering as drag-and-drop.
   */
  const deleteProviderModels = (id: string, modelIds: string[]) => {
    if (!activeConfig || modelIds.length === 0) return;
    if (!confirm(`Delete ${modelIds.length} selected model(s) from "${id}"?`)) return;
    const toDelete = new Set(modelIds);
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(
      newConfig.providers[id].models.filter((model) => !toDelete.has(model.id)),
    );
    stageConfig(newConfig);
  };

  /**
   * Deletes models that are no longer available in the provider's API.
   * This is called from the ModelDeletionModal when the user confirms deletion.
   */
  const deleteMissingModels = (id: string, modelIds: string[]) => {
    if (!activeConfig || modelIds.length === 0) return;
    const toDelete = new Set(modelIds);
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(
      newConfig.providers[id].models.filter((model) => !toDelete.has(model.id)),
    );
    stageConfig(newConfig);

    // Clear the available model IDs for this provider to avoid re-triggering the modal
    setAvailableModelIds((prev) => ({
      ...prev,
      [id]: [],
    }));
  };

  /**
   * Removes a crawler (and all its keys) from the config.
   * @param id - The crawler dictionary key.
   */
  const deleteCrawler = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete crawler "${id}" and all its keys?`)) return;

    // Spread-clone the top level, then delete the key from the cloned crawlers map.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    delete newConfig.crawlers[id];
    stageConfig(newConfig);
  };

  /**
   * Removes a weather API (and all its keys) from the config.
   * @param id - The weather API dictionary key.
   */
  const deleteWeatherApi = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete weather API "${id}" and all its keys?`)) return;

    // Spread-clone the top level, then delete the weatherApi.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    delete newConfig.weatherApi;
    stageConfig(newConfig);
  };

  /**
   * Deletes a key from a weather API.
   * @param weatherApiId - The weather API dictionary key.
   * @param keyIndex - The index of the key to delete.
   */
  const deleteWeatherApiKey = (weatherApiId: string, keyIndex: number) => {
    if (!activeConfig) return;
    if (!confirm(`Delete this API key from "${weatherApiId}"?`)) return;

    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    if (newConfig.weatherApi) {
      newConfig.weatherApi.keys.splice(keyIndex, 1);
      stageConfig(newConfig);
    }
  };

  /**
   * Deletes a key from a crawler.
   * @param crawlerId - The crawler dictionary key.
   * @param keyIndex - The index of the key to delete.
   */
  const deleteCrawlerKey = (crawlerId: string, keyIndex: number) => {
    if (!activeConfig) return;
    if (!confirm(`Delete this API key from "${crawlerId}"?`)) return;

    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.crawlers[crawlerId].keys.splice(keyIndex, 1);
    stageConfig(newConfig);
  };

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!activeConfig && loading) {
    return (
      <div className="flex h-screen items-center justify-center font-medium">
        Loading Vault…
      </div>
    );
  }

  if (!activeConfig) {
    return (
      <div className="p-8 text-center">
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>Failed to load configuration</Alert.Title>
            <Alert.Description>
              Check that the Worker is reachable and your token is correct.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </div>
    );
  }

  // ── Full dashboard layout ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-muted/10">
      {/* ── Sticky top navigation bar ──────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b bg-surface p-4 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">AI Vault Manager</h1>
            {/* Chip used here as a small inline version badge */}
            <Chip size="sm" variant="secondary" className="ml-2">
              v{activeConfig.version}
            </Chip>
            {hasUnsavedChanges && (
              <Chip size="sm" variant="soft" color="warning" className="ml-1">
                Unsaved
              </Chip>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Refresh re-fetches the decrypted config from the Worker */}
            <Button variant="ghost" size="sm" onPress={refreshFromWorker} isPending={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={discardDraft}
              isDisabled={!hasUnsavedChanges}
            >
              <X className="mr-2 h-4 w-4" />
              Discard
            </Button>
            <Button
              size="sm"
              onPress={saveDraftToWorker}
              isPending={loading}
              isDisabled={!hasUnsavedChanges}
            >
              <Save className="mr-2 h-4 w-4" />
              Save Vault
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={saveByokConfig}
              isPending={loading}
            >
              <Save className="mr-2 h-4 w-4" />
              Save BYOK
            </Button>
            <Button
              variant={showPlayground ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setShowPlayground((current) => !current)}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              Chatbot
            </Button>
            <Button variant="ghost" size="sm" onPress={() => {
              const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
              const filename = `ai.${timestamp}.json`;
              const jsonData = JSON.stringify(activeConfig, null, 2);
              const blob = new Blob([jsonData], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onPress={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = '.json';
              fileInput.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const content = event.target?.result as string;
                    const parsedConfig = JSON.parse(content);

                    // Validate the schema
                    if (!validateAiConfigSchema(parsedConfig)) {
                      alert('Invalid configuration file. Please upload a valid AI configuration file.');
                      return;
                    }

                    // Merge with current config or replace?
                    if (confirm('Replace current configuration with the uploaded file?')) {
                      stageConfig(parsedConfig);
                    }
                  } catch (error) {
                    console.error('Error parsing configuration file:', error);
                    alert('Error parsing configuration file. Please check the file format.');
                  }
                };
                reader.readAsText(file);
              };
              fileInput.click();
            }}>
              <Upload className="h-4 w-4" />
            </Button>
            <Button variant="danger-soft" size="sm" onPress={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {/* Global error banner */}
        {error && (
          <Alert status="danger" className="mb-6">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {/* Role-based access control banner */}
        {userContext && userContext.role !== 'admin' && userContext.role !== 'superadmin' && (
          <Alert status="default" className="mb-6">
            <Alert.Content>
              <Alert.Description>
                Read-only mode. You are not an admin.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {showPlayground ? (
          <ChatbotPanel />
        ) : (
          /*
           * Top-level tabs. Currently only "Providers" exists but the tab bar
           * makes it easy to add an "Overview" or "Settings" tab later.
           *
           * selectedKey / onSelectionChange is react-aria's
           * controlled pattern for tabs — same idea as controlled inputs in React.
           */
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(k) => setActiveTab(k as string)}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Vault sections">
                <Tabs.Tab id="providers">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Providers
                  </div>
                </Tabs.Tab>
                <Tabs.Tab id="crawlers">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4" />
                    Crawlers
                  </div>
                </Tabs.Tab>
                <Tabs.Tab id="weatherApi">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    Weather APIs
                  </div>
                </Tabs.Tab>
                {(userContext?.role === 'admin' || userContext?.role === 'superadmin') && (
                  <Tabs.Tab id="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Administration
                    </div>
                  </Tabs.Tab>
                )}
              </Tabs.List>
            </Tabs.ListContainer>

            <Tabs.Panel id="providers" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Managed AI Providers</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('provider', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Provider
                </Button>
              </div>

              <div className="grid gap-6">
                {Object.entries(activeConfig.providers).map(([id, provider]) => (
                  <ProviderCard
                    key={id}
                    id={id}
                    provider={provider}
                    onDelete={() => deleteProvider(id)}
                    onEdit={() =>
                      openModal('provider', { type: 'provider', providerId: id })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', providerId: id })
                    }
                    onAddModel={() =>
                      openModal('model', { type: 'model', providerId: id })
                    }
                    onEditKey={(keyIndex) =>
                      openModal('key', {
                        type: 'key',
                        providerId: id,
                        itemId: keyIndex.toString(),
                      })
                    }
                    onEditModel={(modelId) =>
                      openModal('model', {
                        type: 'model',
                        providerId: id,
                        itemId: modelId,
                      })
                    }
                    onDeleteKey={(index) => {
                      // Immutably remove the key at `index` from the array.
                      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
                      newConfig.providers[id].keys.splice(index, 1);
                      stageConfig(newConfig);
                    }}
                    onDeleteModel={(modelId) => {
                      deleteProviderModels(id, [modelId]);
                    }}
                    onDeleteSelectedModels={(modelIds) => deleteProviderModels(id, modelIds)}
                    onRefreshModels={() => refreshProviderModels(id)}
                    onRefreshFreeModels={() => refreshProviderFreeModels(id)}
                    onRefreshLatestModels={() => refreshProviderLatestModels(id)}
                    canRefreshModels={canDiscoverProviderModels(id, provider)}
                    isRefreshingModels={syncingProviderId === id}
                    modelSyncMessage={modelSyncMessages[id]}
                    onReorderModels={(models) => reorderProviderModels(id, models)}
                    onDeleteMissingModels={(modelIds) => deleteMissingModels(id, modelIds)}
                    availableModelIds={availableModelIds[id]}
                    onToggleByok={(modelId, isByok) => {
                      setByokModelIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) next.add(modelId);
                        else next.delete(modelId);
                        return next;
                      });
                    }}
                    byokModelIds={byokModelIds}
                  />
                ))}
              </div>
            </Tabs.Panel>

            <Tabs.Panel id="crawlers" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Web Crawlers</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('crawler', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Crawler
                </Button>
              </div>

              <div className="grid gap-6">
                {activeConfig.crawlers && Object.entries(activeConfig.crawlers).map(([id, crawler]) => (
                  <CrawlerCard
                    key={id}
                    id={id}
                    crawler={crawler}
                    onDelete={() => deleteCrawler(id)}
                    onEdit={() =>
                      openModal('crawler', { type: 'crawler', crawlerId: id })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', crawlerId: id })
                    }
                    onEditKey={(keyIndex) =>
                      openModal('key', {
                        type: 'key',
                        crawlerId: id,
                        itemId: keyIndex.toString(),
                      })
                    }
                    onDeleteKey={(index) => deleteCrawlerKey(id, index)}
                    onToggleByok={(isByok) => {
                      setByokCrawlerIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    isByok={byokCrawlerIds.has(id)}
                  />
                ))}
              </div>
            </Tabs.Panel>

            <Tabs.Panel id="weatherApi" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Weather APIs</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('weatherApi', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Weather API
                </Button>
              </div>

              <div className="grid gap-6">
                {activeConfig.weatherApi && (
                  <WeatherApiCard
                    key="weatherApi"
                    id="weatherApi"
                    weatherApi={activeConfig.weatherApi}
                    onDelete={() => deleteWeatherApi('weatherApi')}
                    onEdit={() =>
                      openModal('weatherApi', { type: 'weatherApi', weatherApiId: 'weatherApi' })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', weatherApiId: 'weatherApi' })
                    }
                    onEditKey={(keyIndex: number) =>
                      openModal('key', {
                        type: 'key',
                        weatherApiId: 'weatherApi',
                        itemId: keyIndex.toString(),
                      })
                    }
                    onDeleteKey={(index: number) => deleteWeatherApiKey('weatherApi', index)}
                    onToggleByok={(isByok: boolean) => {
                      setByokWeatherApiIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) {
                          next.add('weatherApi');
                        } else {
                          next.delete('weatherApi');
                        }
                        return next;
                      });
                    }}
                    isByok={byokWeatherApiIds.has('weatherApi')}
                  />
                )}
              </div>
            </Tabs.Panel>

            {(userContext?.role === 'admin' || userContext?.role === 'superadmin') && (
              <Tabs.Panel id="admin" className="mt-6">
                <AdminPanel />
              </Tabs.Panel>
            )}
          </Tabs>
        )}
      </main>

      {/* ── Config modal (add / edit provider, model, or key) ──────────────── */}
      <ConfigModal
        state={modalState}
        type={modalType}
        editTarget={editTarget}
        config={activeConfig}
        onSave={stageConfig}
      />
    </div>
  );
};
```

### `ui/src/components/login-screen.tsx`

**Exports:** LoginScreen

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
 * @file Login screen component.
 * The user enters the Bearer token that is both the HTTP auth token and the
 * AES-256-CBC decryption password for the encrypted vault stored in KV.
 */

import React, { useState } from 'react';
import { Alert, Button, Card, Form, Input, Label, TextField } from '@heroui/react';
import { useAi } from '../hooks/use-ai';
import { LogIn } from 'lucide-react';

/**
 * Full-page login screen shown when the user is not authenticated.
 *
 * The token is stored in sessionStorage (not localStorage),
 * so it is automatically cleared when the browser tab is closed. It is never
 * sent to anything other than the Cloudflare Worker endpoint.
 */
export const LoginScreen: React.FC = () => {
  /** Controlled value of the token input field. */
  const [token, setToken] = useState('');

  /** Error message to display when login fails (null = no error). */
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, loading } = useAi();

  /**
   * Submits the token to the `login` function from the AI context.
   * If login fails (e.g. wrong token / HTTP 401), shows an inline error.
   */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);
    try {
      await login(token);
    } catch {
      // We intentionally don't expose the raw error to the UI for security.
      setLocalError('Login failed. Please check your token.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-6">
        <Card.Header className="flex flex-col gap-1 text-center">
          <Card.Title className="text-2xl font-bold">AI Vault Manager</Card.Title>
          <Card.Description>
            Enter your authorization token to manage the AI Proxy vault.
          </Card.Description>
        </Card.Header>

        <Card.Content className="mt-4">
          <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* isRequired adds native HTML5 validation + aria-required attribute */}
            <TextField isRequired name="token">
              <Label>Authorization Token</Label>
              <Input type="hidden" autoComplete="username" value="AI Vault Admin" readOnly className="hidden" />
              <Input
                type="password"
                placeholder="Paste your token here..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="current-password"
                variant="secondary"
              />
            </TextField>

            {/* Only rendered when there is an error to show */}
            {localError && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Title>Authentication error</Alert.Title>
                  <Alert.Description>{localError}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {/*
             * isPending comes from react-aria's Button: it disables the button
             * and adds an animated spinner while the async login call is running.
             */}
            <Button
              type="submit"
              fullWidth
              isPending={loading}
              className="mt-2"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Connect to Vault
            </Button>
          </Form>
        </Card.Content>

        <Card.Footer className="mt-4 text-center">
          <p className="text-xs text-muted">
            The token is stored only in the session storage and is never persisted.
          </p>
        </Card.Footer>
      </Card>
    </div>
  );
};

```

### `ui/src/components/main-layout.tsx`

**Exports:** MainLayout

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
import React from 'react';
import { useAi } from '../hooks/use-ai';
import { LoginScreen } from './login-screen';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { isAuthenticated } = useAi();

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <nav className="w-64 border-r border-border bg-surface-secondary p-4">
        {/* Sidebar navigation */}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
};
```

### `ui/src/components/playground-panel.tsx`

**Exports:** PlaygroundPanelProps, PlaygroundPanel

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

import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Label,
  ProgressBar,
  Tooltip,
} from '@heroui/react';
import { Download, MessageSquare, PanelRight, Upload } from 'lucide-react';
import type { AiConfig } from '../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundTranscriber,
} from '../types/playground-types';
import {
  DEFAULT_CONVERSATION_ID,
  DEFAULT_SYSTEM_PROMPT,
} from '../lib/playground/constants';
import {
  buildPlaygroundPayload,
  estimateTokens,
  getMessageTokenText,
  getPartTokenText,
} from '../lib/playground/payload';
import {
  buildMistralConversationsPayload,
  buildMistralConversationsUrl,
} from '../lib/playground/mistral-conversations';
import { usePlaygroundSelection } from '../hooks/use-playground-selection';
import { usePlaygroundConversation } from '../hooks/use-playground-conversation';
import { usePlaygroundRequest } from '../hooks/use-playground-request';
import { usePlaygroundIndexedDb } from '../hooks/use-playground-indexed-db';
import { ProviderModelKeySelector } from './playground/provider-model-key-selector';
import { GenerationSettingsPanel } from './playground/generation-settings-panel';
import { MessageList } from './playground/message-list';
import { MultimodalInput } from './playground/multimodal-input';
import { EquivalentCodePanel } from './playground/equivalent-code-panel';
import { ConversationHistorySidebar } from './playground/conversation-history-sidebar';

export interface PlaygroundPanelProps {
  activeConfig: AiConfig;
  conversationId?: string;
  initialHistory?: PlaygroundMessage[];
  transcriber?: PlaygroundTranscriber;
}

const isPlaygroundMessageArray = (value: unknown): value is PlaygroundMessage[] => {
  if (!Array.isArray(value)) return false;

  return value.every((message) => (
    typeof message === 'object'
    && message !== null
    && 'id' in message
    && 'role' in message
    && 'parts' in message
    && Array.isArray((message as { parts?: unknown }).parts)
  ));
};

export const PlaygroundPanel: React.FC<PlaygroundPanelProps> = ({
  activeConfig,
  conversationId: _conversationId = DEFAULT_CONVERSATION_ID,
  initialHistory,
  transcriber,
}) => {
  // Inference parameters
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);
  // Mistral-only: route through /v1/conversations with image_generation tool
  const [enableImageGeneration, setEnableImageGeneration] = useState(false);

  // Active conversation — starts with the prop value, can be switched via sidebar
  const [conversationId, setConversationId] = useState(_conversationId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const conversation = usePlaygroundConversation();
  const request = usePlaygroundRequest();
  const selection = usePlaygroundSelection(activeConfig, setMaxTokens);

  const idb = usePlaygroundIndexedDb({
    conversationId,
    messages: conversation.messages,
    initialHistory,
    onMessagesLoaded: conversation.replaceMessages,
  });

  // Context window usage bar
  const contextWindowTokens = Math.max(selection.activeModel?.contextWindow ?? 1, 1);
  const baseMessages = conversation.getBaseMessages();
  const contextPromptTokens = baseMessages.reduce(
    (total, msg) => total + estimateTokens(getMessageTokenText(msg)),
    0,
  );
  const contextSystemTokens = systemPrompt.trim() ? estimateTokens(systemPrompt) : 0;
  const contextDraftTokens = estimateTokens(
    [conversation.inputText, ...conversation.inputParts.map(getPartTokenText)]
      .filter(Boolean)
      .join('\n\n'),
  );
  const contextUsedTokens = contextSystemTokens + contextPromptTokens + contextDraftTokens;
  const contextFillPercent = Math.min(100, Math.max(0, (contextUsedTokens / contextWindowTokens) * 100));
  const contextFillColor = contextFillPercent >= 90 ? 'danger' : contextFillPercent >= 70 ? 'warning' : 'accent';

  const useMistralConversations =
    enableImageGeneration && selection.provider?.protocol === 'mistral';

  // Payload and URL preview for the equivalent-code panel — must match the
  // actual request path chosen in sendPrompt / retryLastRequest.
  const payloadPreview = useMemo(
    () =>
      useMistralConversations
        ? buildMistralConversationsPayload({
            modelId: selection.modelId,
            systemPrompt,
            messages: baseMessages,
            temperature,
            maxTokens,
            topP,
          })
        : buildPlaygroundPayload({
            modelId: selection.modelId,
            systemPrompt,
            messages: baseMessages,
            temperature,
            maxTokens,
            topP,
            stream: streamEnabled,
          }),
    [baseMessages, maxTokens, selection.modelId, streamEnabled, systemPrompt, temperature, topP, useMistralConversations],
  );

  const urlPreview = useMistralConversations && selection.provider
    ? buildMistralConversationsUrl(selection.provider)
    : undefined;

  const sendPrompt = async () => {
    const providerKey = selection.resolveProviderKey();

    if (!selection.provider) {
      request.setError('Select a provider first.');
      return;
    }
    if (!selection.modelId) {
      request.setError('Select a chat model first.');
      return;
    }
    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    const nextUserMessage = conversation.createNextUserMessage();
    if (!nextUserMessage) return;

    const base = conversation.getBaseMessages();
    const nextMessages = [...base, nextUserMessage];

    conversation.replaceMessages(nextMessages);
    conversation.clearDraft();
    selection.setLastUsedProviderKey(providerKey);
    selection.advanceRoundRobinKey();

    try {
        const assistantParts = await request.sendRequest({
          provider: selection.provider,
          providerKey,
          modelId: selection.modelId,
          systemPrompt,
          messages: nextMessages,
          modelUsage: selection.activeModel?.usage,
          temperature,
          maxTokens,
          topP,
          stream: streamEnabled,
          enableImageGeneration,
        });
      conversation.appendAssistantMessage(nextMessages, assistantParts);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playground request failed';
      conversation.appendAssistantMessage(nextMessages, [{ type: 'text', text: `Error: ${message}` }]);
    }
  };

  const handleResumeFromIndex = (index: number) => {
    if (index < 0) {
      conversation.setResumeFromIndex(null);
    } else {
      conversation.setResumeFromIndex(index);
    }
  };

  const handleNewConversation = () => {
    setConversationId(crypto.randomUUID());
    conversation.clearConversation();
    request.clearError();
  };

  const handleSelectConversation = (id: string) => {
    if (id === conversationId) return;
    conversation.clearConversation();
    setConversationId(id);
    request.clearError();
  };

  const handleDeleteConversation = (id: string) => {
    void idb.deleteConversation(id);
    if (id === conversationId) {
      handleNewConversation();
    }
  };

  const exportConversation = () => {
    const payload = {
      id: conversationId,
      messages: conversation.messages,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${conversationId}.json`;
    link.click();

    URL.revokeObjectURL(url);
  };

  const importConversation = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    try {
      const raw = JSON.parse(await file.text()) as { messages?: unknown };
      const importedMessages = raw.messages;

      if (!isPlaygroundMessageArray(importedMessages)) {
        request.setError('Imported JSON does not contain a valid playground conversation.');
        return;
      }

      conversation.replaceMessages(importedMessages);
      request.clearError();
    } catch (error) {
      request.setError(error instanceof Error ? error.message : 'Could not import JSON conversation.');
    }
  };

  const retryLastRequest = async (rotateKey: boolean) => {
    if (!selection.provider || !selection.modelId) return;

    const providerKey = rotateKey
      ? selection.resolveNextProviderKey()
      : selection.resolveProviderKey();

    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    // Drop the last assistant error message and re-send with the same history
    const messagesWithoutError = conversation.messages.slice(0, -1);
    conversation.replaceMessages(messagesWithoutError);
    selection.setLastUsedProviderKey(providerKey);
    // For rotate: advance twice (skip failed key + the one we're about to use)
    // For plain retry: advance once (same cadence as sendPrompt)
    selection.advanceRoundRobinKey();
    if (rotateKey) selection.advanceRoundRobinKey();

    try {
        const assistantParts = await request.sendRequest({
          provider: selection.provider,
          providerKey,
          modelId: selection.modelId,
          systemPrompt,
          messages: messagesWithoutError,
          modelUsage: selection.activeModel?.usage,
          temperature,
          maxTokens,
          topP,
          stream: streamEnabled,
          enableImageGeneration,
        });
      conversation.appendAssistantMessage(messagesWithoutError, assistantParts);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playground request failed';
      conversation.appendAssistantMessage(messagesWithoutError, [{ type: 'text', text: `Error: ${message}` }]);
    }
  };

  return (
    <div className="flex gap-4 pt-2 items-start">
      {/* ── History Sidebar ────────────────────────────────────────── */}
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Show history"
          onPress={() => setSidebarOpen(true)}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
      <ConversationHistorySidebar
        conversations={idb.conversations}
        activeConversationId={conversationId}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onNew={handleNewConversation}
      />

      {/* ── Main Content ────────────────────────────────────────────── */}
      <div className="flex-1 grid gap-6 min-w-0">
        {/* ── Main Playground Card ──────────────────────────────────── */}
        <Card>
          <Card.Header className="flex flex-row items-center justify-between p-4">
            <div>
              <Card.Title className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                Chat Playground
              </Card.Title>
              <Card.Description>
                Test multimodal conversations with a vault provider, then copy equivalent request code.
              </Card.Description>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void importConversation(event)}
              />
              <Checkbox
                id="playground-streaming"
                isSelected={streamEnabled}
                onChange={setStreamEnabled}
              >
                <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                <Checkbox.Content>
                  <Label htmlFor="playground-streaming">Streaming</Label>
                </Checkbox.Content>
              </Checkbox>

              <Button
                size="sm"
                variant="ghost"
                onPress={exportConversation}
                isDisabled={conversation.messages.length === 0}
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export JSON
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onPress={() => importInputRef.current?.click()}
              >
                <Upload className="mr-2 h-3.5 w-3.5" />
                Import JSON
              </Button>

              {/* Image generation toggle — only relevant for Mistral providers */}
              {selection.provider?.protocol === 'mistral' && (
                <Checkbox
                  id="playground-image-gen"
                  isSelected={enableImageGeneration}
                  onChange={setEnableImageGeneration}
                >
                  <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                  <Checkbox.Content>
                    <Label htmlFor="playground-image-gen">Image generation</Label>
                  </Checkbox.Content>
                </Checkbox>
              )}
            </div>
          </Card.Header>

          <Card.Content className="space-y-4 p-4">
            <ProviderModelKeySelector
              providerIds={selection.providerIds}
              providerId={selection.providerId}
              modelId={selection.modelId}
              selectedKey={selection.selectedKey}
              chatModels={selection.chatModels}
              usableKeys={selection.usableKeys}
              onProviderChange={selection.setProviderId}
              onModelChange={selection.setModelId}
              onSelectedKeyChange={selection.setSelectedKey}
            />

            <GenerationSettingsPanel
              systemPrompt={systemPrompt}
              temperature={temperature}
              maxTokens={maxTokens}
              topP={topP}
              onSystemPromptChange={setSystemPrompt}
              onTemperatureChange={setTemperature}
              onMaxTokensChange={setMaxTokens}
              onTopPChange={setTopP}
            />

            {/* Chat display area */}
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3">
                <MessageList
                  messages={conversation.messages}
                  resumeFromIndex={conversation.resumeFromIndex}
                  onResumeFromIndex={handleResumeFromIndex}
                  onRetry={() => void retryLastRequest(false)}
                  onRotateAndRetry={() => void retryLastRequest(true)}
                />
              </div>

              {/* Context usage bar + input */}
              <div className="flex items-end justify-between gap-3 mb-3">
                <Tooltip delay={0}>
                  <Tooltip.Trigger aria-label="Context usage details" className="w-full max-w-xs">
                    <ProgressBar
                      aria-label="Context usage"
                      className="w-full"
                      color={contextFillColor}
                      value={contextFillPercent}
                    >
                      <Label>Context</Label>
                      <ProgressBar.Output />
                      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                    </ProgressBar>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow placement="top">
                    <Tooltip.Arrow />
                    {`${contextUsedTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()} tokens`}
                  </Tooltip.Content>
                </Tooltip>
              </div>

              <MultimodalInput
                text={conversation.inputText}
                parts={conversation.inputParts}
                isSending={request.isSending}
                inputModalities={selection.activeModel?.inputModalities ?? ['text']}
                onTextChange={conversation.setInputText}
                onPartsChange={conversation.setInputParts}
                onSend={() => void sendPrompt()}
                onCancel={request.cancelRequest}
                onError={(msg) => request.setError(msg)}
                transcriber={transcriber}
                isDisabled={!selection.providerId || !selection.modelId}
              />
            </div>

            {request.error && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{request.error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </Card.Content>
        </Card>

        {/* ── Equivalent Code Card ──────────────────────────────────── */}
        <EquivalentCodePanel
          provider={selection.provider}
          providerKey={selection.lastUsedProviderKey || selection.resolveProviderKey()}
          payload={payloadPreview}
          url={urlPreview}
        />
      </div>
    </div>
  );
};
```

### `ui/src/components/playground/code-block.tsx`

**Exports:** CodeBlockProps, CodeBlock

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Button } from '@heroui/react';
import { Download } from 'lucide-react';

export interface CodeBlockProps {
  code: string;
  language: string;
  filename: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  filename,
}) => {
  const downloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {language}
        </span>
        <Button size="sm" variant="ghost" onPress={downloadCode}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {filename}
        </Button>
      </div>
      <pre className="overflow-auto rounded-md bg-background p-3 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
};
```

### `ui/src/components/playground/conversation-history-sidebar.tsx`

**Exports:** ConversationHistorySidebarProps, ConversationHistorySidebar

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Button } from '@heroui/react';
import { MessageSquare, PanelRight, Plus, Trash2 } from 'lucide-react';
import type { PlaygroundConversation } from '../../types/playground-types';

export interface ConversationHistorySidebarProps {
  conversations: PlaygroundConversation[];
  activeConversationId: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

const formatTime = (ts: number): string => {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString();
};

export const ConversationHistorySidebar: React.FC<ConversationHistorySidebarProps> = ({
  conversations,
  activeConversationId,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  onNew,
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-60 shrink-0 rounded-md border bg-background flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">History</span>
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" onPress={onNew} aria-label="New conversation">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onPress={onToggle} aria-label="Hide history">
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No saved conversations yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={[
                    'group flex items-start gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer transition-colors select-none',
                    conv.id === activeConversationId
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'hover:bg-muted/60 text-foreground',
                  ].join(' ')}
                  onClick={() => onSelect(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect(conv.id);
                  }}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate leading-snug">{conv.title}</p>
                    <p className="text-muted-foreground mt-0.5">{formatTime(conv.updatedAt)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete "${conv.title}"`}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
```

### `ui/src/components/playground/equivalent-code-panel.tsx`

**Exports:** EquivalentCodePanelProps, EquivalentCodePanel

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useState } from 'react';
import { Button, Card, ListBox, Select } from '@heroui/react';
import { Code2, Copy } from 'lucide-react';
import type { AiProvider } from '../../types/ai-config';
import { maskApiKey } from '../../lib/provider-models';
import { buildDirectChatUrl } from '../../lib/playground/payload';

export interface EquivalentCodePanelProps {
  provider?: AiProvider;
  providerKey: string;
  payload: unknown;
  /** Override the request URL (e.g. for Mistral /v1/conversations). Falls back to buildDirectChatUrl(provider). */
  url?: string;
}

type SnippetLang = 'curl' | 'python' | 'typescript';

/** Renders curl / Python / TypeScript snippets equivalent to the current playground state. */
export const EquivalentCodePanel: React.FC<EquivalentCodePanelProps> = ({
  provider,
  providerKey,
  payload,
  url,
}) => {
  const [showCode, setShowCode] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLang>('curl');
  const [copied, setCopied] = useState<SnippetLang | null>(null);

  const playgroundUrl = url ?? (provider ? buildDirectChatUrl(provider) : '');
  const snippetJson = JSON.stringify(payload, null, 2);
  const escapedJson = snippetJson.replace(/'/g, "'\\''");

  const curlSnippet = [
    `curl -X POST '${playgroundUrl}'`,
    "  -H 'Content-Type: application/json'",
    `  -H 'Authorization: Bearer ${providerKey}'`,
    `  --data-raw '${escapedJson}'`,
  ].join(' \\\n');

  const pythonSnippet = [
    'import requests',
    '',
    `url = '${playgroundUrl}'`,
    'headers = {',
    `    'Authorization': 'Bearer ${providerKey}',`,
    "    'Content-Type': 'application/json',",
    '}',
    `payload = ${snippetJson}`,
    'response = requests.post(url, headers=headers, json=payload, timeout=60)',
    'response.raise_for_status()',
    'print(response.json())',
  ].join('\n');

  const tsSnippet = [
    `const url = '${playgroundUrl}';`,
    '',
    'const response = await fetch(url, {',
    "  method: 'POST',",
    '  headers: {',
    `    Authorization: 'Bearer ${providerKey}',`,
    "    'Content-Type': 'application/json',",
    '  },',
    `  body: JSON.stringify(${snippetJson}),`,
    '});',
    '',
    'if (!response.ok) throw new Error(await response.text());',
    'const data = await response.json();',
    'console.log(data);',
  ].join('\n');

  const snippets: Record<SnippetLang, string> = { curl: curlSnippet, python: pythonSnippet, typescript: tsSnippet };
  const titles: Record<SnippetLang, string> = { curl: 'curl', python: 'python', typescript: 'typescript fetch' };

  const copySnippet = async (lang: SnippetLang) => {
    try {
      await navigator.clipboard.writeText(snippets[lang]);
      setCopied(lang);
      setTimeout(() => setCopied((c) => (c === lang ? null : c)), 1400);
    } catch {
      // Clipboard unavailable — silently ignored.
    }
  };

  return (
    <Card>
      <Card.Header className="p-4">
        <Card.Title>Equivalent Code</Card.Title>
        <Card.Description>Code is hidden by default. Reveal and copy your preferred version.</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onPress={() => setShowCode((v) => !v)}>
            <Code2 className="mr-2 h-4 w-4" />
            {showCode ? 'Hide code' : 'Show code'}
          </Button>

          <Select
            className="w-55"
            value={snippetLanguage}
            onChange={(value) => setSnippetLanguage(String(value ?? 'curl') as SnippetLang)}
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="curl" textValue="curl">curl<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="python" textValue="python">python<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="typescript" textValue="typescript">typescript<ListBox.ItemIndicator /></ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          <span className="text-xs text-muted-foreground">
            Key used: {providerKey ? maskApiKey(providerKey) : 'none'}
          </span>
        </div>

        {showCode && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {titles[snippetLanguage]}
              </h3>
              <Button size="sm" variant="ghost" onPress={() => void copySnippet(snippetLanguage)}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                {copied === snippetLanguage ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs leading-relaxed">
              <code>{snippets[snippetLanguage]}</code>
            </pre>
          </div>
        )}
      </Card.Content>
    </Card>
  );
};
```

### `ui/src/components/playground/file-preview.tsx`

**Exports:** FilePreviewListProps, FilePreviewList

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { PlaygroundPart } from '../../types/playground-types';
import { formatBytes, revokePartObjectUrls } from '../../lib/playground/multimodal-files';

interface FilePreviewItemProps {
  part: PlaygroundPart;
  index: number;
  onRemove: (index: number) => void;
}

const FilePreviewItem: React.FC<FilePreviewItemProps> = ({ part, index, onRemove }) => {
  // Revoke Object URLs when the part is removed from the DOM.
  useEffect(
    () => () => { revokePartObjectUrls(part); },
    [part],
  );

  const name = 'name' in part ? (part.name ?? part.type) : part.type;
  const size = 'size' in part ? part.size : undefined;

  const preview = (() => {
    if (part.type === 'image' && part.thumbnailUrl) {
      return (
        <img
          src={part.thumbnailUrl}
          alt={name}
          className="h-8 w-8 rounded object-cover"
        />
      );
    }
    if (part.type === 'audio') {
      return <span className="text-xs text-muted-foreground">🎵</span>;
    }
    if (part.type === 'video' && part.thumbnailUrl) {
      return (
        <video
          src={part.thumbnailUrl}
          className="h-8 w-8 rounded object-cover"
          aria-label={name}
        />
      );
    }
    return null;
  })();

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
      {preview}
      <span className="max-w-[120px] truncate" title={name}>{name}</span>
      {size !== undefined && <span>({formatBytes(size)})</span>}
      <button
        type="button"
        className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
};

export interface FilePreviewListProps {
  parts: PlaygroundPart[];
  onRemove: (index: number) => void;
}

/** Renders a row of file attachment chips with remove buttons. */
export const FilePreviewList: React.FC<FilePreviewListProps> = ({ parts, onRemove }) => {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {parts.map((part, i) => (
        <FilePreviewItem
          key={`${part.type}-${i}`}
          part={part}
          index={i}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
};
```

### `ui/src/components/playground/generation-settings-panel.tsx`

**Exports:** GenerationSettingsPanelProps, GenerationSettingsPanel

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Label, NumberField, Slider, TextArea } from '@heroui/react';

export interface GenerationSettingsPanelProps {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  onSystemPromptChange: (value: string) => void;
  onTemperatureChange: (value: number) => void;
  onMaxTokensChange: (value: number) => void;
  onTopPChange: (value: number) => void;
}

/** System-prompt textarea and the three inference parameter controls. */
export const GenerationSettingsPanel: React.FC<GenerationSettingsPanelProps> = ({
  systemPrompt,
  temperature,
  maxTokens,
  topP,
  onSystemPromptChange,
  onTemperatureChange,
  onMaxTokensChange,
  onTopPChange,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col gap-1 text-sm">
      <Label htmlFor="playground-system-prompt">System prompt</Label>
      <TextArea
        id="playground-system-prompt"
        rows={3}
        value={systemPrompt}
        onChange={(e) => onSystemPromptChange(e.target.value)}
        placeholder="You are a helpful AI assistant."
      />
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <Slider
        className="w-full"
        value={temperature}
        minValue={0}
        maxValue={2}
        step={0.01}
        onChange={(value) => onTemperatureChange(Array.isArray(value) ? value[0] : value)}
      >
        <Label>Temperature</Label>
        <Slider.Output>{temperature.toFixed(2)}</Slider.Output>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>

      <NumberField
        minValue={1}
        step={1}
        value={maxTokens}
        onChange={(value) => onMaxTokensChange(Math.max(1, Math.round(value ?? 1)))}
      >
        <Label>Max tokens</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>

      <NumberField
        minValue={0}
        maxValue={1}
        step={0.05}
        value={topP}
        onChange={(value) => onTopPChange(Math.min(1, Math.max(0, value ?? 0)))}
      >
        <Label>Top-p</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    </div>
  </div>
);
```

### `ui/src/components/playground/image-modal.tsx`

**Exports:** ImageModalProps, ImageModal

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect } from 'react';
import { Button } from '@heroui/react';
import { Download, X } from 'lucide-react';

export interface ImageModalProps {
  imageUrl: string | null;
  filename?: string;
  onClose: () => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  imageUrl,
  filename = 'image.png',
  onClose,
}) => {
  useEffect(() => {
    if (!imageUrl) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-6xl rounded-lg bg-background p-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onPress={handleDownload}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Download
          </Button>
          <Button size="sm" variant="ghost" onPress={onClose} aria-label="Close image preview">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <img
          src={imageUrl}
          alt={filename}
          className="max-h-[80vh] max-w-[90vw] rounded-md object-contain"
        />
      </div>
    </div>
  );
};
```

### `ui/src/components/playground/message-bubble.tsx`

**Exports:** MessageBubble

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Download, RefreshCcw, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  PlaygroundMessage,
  PlaygroundPart,
} from '../../types/playground-types';
import { renderMarkdown } from '../../lib/utils/markdown-utils';
import { createMarkedRenderer } from '../../lib/utils/markdown-utils';
import { extractGeneratedFiles, getMarkdownFilename } from '../../lib/utils/file-utils';
import { formatBytes } from '../../lib/playground/multimodal-files';
import { CodeBlock } from './code-block';
import { ImageModal } from './image-modal';
interface MessageBubbleProps {
  message: PlaygroundMessage;
  index: number;
  onResume: () => void;
  /** When provided, a Retry button appears on assistant error messages. */
  onRetry?: () => void;
  /** When provided, a Rotate & retry button appears on assistant error messages. */
  onRotateAndRetry?: () => void;
}

const downloadRemoteImage = async (url: string, name: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = name;
    link.click();
    URL.revokeObjectURL(blobUrl);
  } catch { /* silently ignore if URL has expired */ }
};

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadBinaryFile = (filename: string, mimeType: string, base64Data: string) => {
  const binary = atob(base64Data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
};

/** Renders a single chat message with all its parts and action buttons. */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  index,
  onResume,
  onRetry,
  onRotateAndRetry,
}) => {
  const marked = useMemo(() => createMarkedRenderer(), []);
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  const assistantText = message.role === 'assistant'
    ? message.parts
        .filter((p): p is Extract<PlaygroundPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n')
    : null;

  const generatedFiles = assistantText ? extractGeneratedFiles(assistantText) : [];
  const isError = assistantText?.startsWith('Error:') ?? false;
  const getLanguageFromFilename = (filename: string): string =>
    filename.split('.').pop()?.toLowerCase() ?? 'text';

  return (
    <div
      className={[
        'rounded-md px-3 py-2 text-sm',
        message.role === 'user' ? 'bg-primary/10' : 'bg-background',
      ].join(' ')}
    >
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {message.role === 'user' ? 'user' : 'assistant'}
      </p>

      {message.parts.map((part, partIndex) => {
        if (part.type === 'text') {
          return message.role === 'assistant' ? (
            <div
              key={partIndex}
              className="playground-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text, marked) }}
            />
          ) : (
            <p key={partIndex} className="whitespace-pre-wrap">{part.text}</p>
          );
        }

        if (part.type === 'image') {
          const inlineDataUrl = part.inlineData
            ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
            : null;
          const displaySrc = part.thumbnailUrl ?? inlineDataUrl ?? part.remoteUrl;
          if (!displaySrc) return null;
          return (
            <div key={partIndex} className="mt-2 space-y-1">
              <button
                type="button"
                className="rounded-md"
                onClick={() => setPreviewImage({ url: inlineDataUrl ?? part.remoteUrl ?? displaySrc, name: part.name })}
              >
                <img
                  src={displaySrc}
                  alt={part.name ?? 'Attached image'}
                  className="max-h-64 rounded-md border object-contain"
                />
              </button>
              {part.remoteUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void downloadRemoteImage(part.remoteUrl!, part.name ?? 'generated_image.png')}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  {part.name ?? 'Download image'}
                </Button>
              )}
            </div>
          );
        }

        if (part.type === 'audio') {
          return (
            <div key={partIndex} className="mt-2">
              <audio controls src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}>
                <track kind="captions" />
              </audio>
              {part.transcription && (
                <p className="mt-1 text-xs text-muted-foreground italic">{part.transcription}</p>
              )}
            </div>
          );
        }

        if (part.type === 'video' && part.thumbnailUrl) {
          return (
            <video
              key={partIndex}
              controls
              src={part.thumbnailUrl}
              className="mt-2 max-h-48 rounded-md border"
              aria-label={part.name ?? 'Attached video'}
            >
              <track kind="captions" />
            </video>
          );
        }

        if (part.type === 'file') {
          return (
            <span
              key={partIndex}
              className="mt-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
            >
              {part.name}
              {part.size !== undefined && <span>({formatBytes(part.size)})</span>}
            </span>
          );
        }

        if (part.type === 'tts_audio') {
          const src = part.inlineData
            ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
            : part.audioUrl;
          const defaultExtension = part.inlineData?.mimeType.split('/')[1] ?? 'wav';
          const filename = part.filename ?? `assistant-audio-${index + 1}.${defaultExtension}`;

          if (!src) return null;

          return (
            <div key={partIndex} className="mt-2 space-y-2">
              <audio controls src={src}>
                <track kind="captions" />
              </audio>
              {part.transcript && (
                <p className="text-xs text-muted-foreground italic">{part.transcript}</p>
              )}
              {part.inlineData ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => downloadBinaryFile(filename, part.inlineData!.mimeType, part.inlineData!.data)}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Download audio
                </Button>
              ) : part.audioUrl ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void downloadRemoteImage(part.audioUrl!, filename)}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Download audio
                </Button>
              ) : null}
            </div>
          );
        }

        return null;
      })}

      {message.role === 'assistant' && generatedFiles.length > 0 && (
        <div className="mt-3 space-y-3">
          {generatedFiles.map((file) => (
            <CodeBlock
              key={file.name}
              code={file.content}
              language={getLanguageFromFilename(file.name)}
              filename={file.name}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {message.role === 'assistant' && assistantText && !isError && (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => downloadTextFile(getMarkdownFilename(assistantText, index), assistantText)}
          >
            <Download className="mr-2 h-3.5 w-3.5" />
            Markdown
          </Button>
        )}
        {!isError && generatedFiles.map((file) => (
          <Button
            key={file.name}
            size="sm"
            variant="ghost"
            onPress={() => downloadTextFile(file.name, file.content)}
          >
            <Download className="mr-2 h-3.5 w-3.5" />
            {file.name}
          </Button>
        ))}
        {isError && onRetry && (
          <Button size="sm" variant="ghost" onPress={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        )}
        {isError && onRotateAndRetry && (
          <Button size="sm" variant="ghost" onPress={onRotateAndRetry}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Rotate & retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={onResume}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Resume from here
        </Button>
      </div>

      <ImageModal
        imageUrl={previewImage?.url ?? null}
        filename={previewImage?.name}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};
```

### `ui/src/components/playground/message-list.tsx`

**Exports:** MessageListProps, MessageList

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import type { PlaygroundMessage } from '../../types/playground-types';
import { MessageBubble } from './message-bubble';

export interface MessageListProps {
  messages: PlaygroundMessage[];
  resumeFromIndex: number | null;
  onResumeFromIndex: (index: number) => void;
  onRetry?: () => void;
  onRotateAndRetry?: () => void;
}

const isAssistantError = (msg: PlaygroundMessage): boolean =>
  msg.role === 'assistant' &&
  msg.parts.some((p) => p.type === 'text' && p.text.startsWith('Error:'));

/** Renders the full conversation history or an empty-state prompt. */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  resumeFromIndex,
  onResumeFromIndex,
  onRetry,
  onRotateAndRetry,
}) => {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Start the conversation by sending your first message.
      </p>
    );
  }

  const lastIndex = messages.length - 1;
  const lastIsError = isAssistantError(messages[lastIndex]);

  return (
    <div className="space-y-2">
      {resumeFromIndex !== null && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Resume is active from message {resumeFromIndex + 1}.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => onResumeFromIndex(-1)}
          >
            Cancel
          </button>
        </div>
      )}
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          index={index}
          onResume={() => onResumeFromIndex(index)}
          onRetry={index === lastIndex && lastIsError ? onRetry : undefined}
          onRotateAndRetry={index === lastIndex && lastIsError ? onRotateAndRetry : undefined}
        />
      ))}
    </div>
  );
};
```

### `ui/src/components/playground/multimodal-input.tsx`

**Exports:** MultimodalInputProps, MultimodalInput

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useRef } from 'react';
import { Button, TextArea } from '@heroui/react';
import { FilePlus, Send, X } from 'lucide-react';
import type { AiModalityInput } from '../../types/ai-config';
import type { PlaygroundPart, PlaygroundTranscriber } from '../../types/playground-types';
import {
  createPartFromFile,
  getFileKind,
  isInlineable,
} from '../../lib/playground/multimodal-files';
import { FilePreviewList } from './file-preview';

export interface MultimodalInputProps {
  text: string;
  parts: PlaygroundPart[];
  isSending: boolean;
  /** Supported input modalities from the active model — controls which files are accepted. */
  inputModalities?: AiModalityInput[];
  onTextChange: (text: string) => void;
  onPartsChange: (parts: PlaygroundPart[]) => void;
  onSend: () => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
  transcriber?: PlaygroundTranscriber;
  isDisabled?: boolean;
}

const MODALITY_ACCEPT_MAP: Record<AiModalityInput, string> = {
  text: '.txt,.md,.csv,.json,.xml,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.rb,.java,.c,.cpp,.h,.cs,.php,.sh',
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

/** Text input with drag-and-drop file attachment support and a send/cancel button. */
export const MultimodalInput: React.FC<MultimodalInputProps> = ({
  text,
  parts,
  isSending,
  inputModalities = ['text'],
  onTextChange,
  onPartsChange,
  onSend,
  onCancel,
  onError,
  transcriber,
  isDisabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const acceptAttr = inputModalities
    .map((m) => MODALITY_ACCEPT_MAP[m])
    .filter(Boolean)
    .join(',');

  const addFiles = async (files: FileList | File[]) => {
    const nextParts: PlaygroundPart[] = [];

    for (const file of Array.from(files)) {
      if (!isInlineable(file)) {
        onError?.(`${file.name} exceeds the 8 MB limit.`);
        continue;
      }

      try {
        let part = await createPartFromFile(file);

        if (part.type === 'audio' && transcriber && getFileKind(file) === 'audio') {
          try {
            const transcription = await transcriber(file, file);
            if (transcription.trim()) {
              part = {
                ...part,
                transcription: transcription.trim(),
              };
            }
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : `Could not transcribe ${file.name}.`;
            onError?.(message);
          }
        }

        nextParts.push(part);
      } catch {
        onError?.(`Could not read ${file.name}.`);
      }
    }

    if (nextParts.length > 0) onPartsChange([...parts, ...nextParts]);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length === 0) return;
    await addFiles(event.dataTransfer.files);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div
      className="rounded-md border bg-muted/20 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
      aria-label="Message input area — drop files to attach"
    >
      <TextArea
        className="w-full"
        rows={4}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask something… (Ctrl+Enter to send)"
        disabled={isSending || isDisabled}
      />

      <FilePreviewList
        parts={parts}
        onRemove={(index) => onPartsChange(parts.filter((_, i) => i !== index))}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            onChange={(e) => void addFiles(e.target.files ?? [])}
          />
          {inputModalities.length > 1 || inputModalities.includes('image') || inputModalities.includes('audio') ? (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => fileInputRef.current?.click()}
              isDisabled={isSending || isDisabled}
            >
              <FilePlus className="mr-2 h-3.5 w-3.5" />
              Attach files
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => fileInputRef.current?.click()}
              isDisabled={isSending || isDisabled}
            >
              <FilePlus className="mr-2 h-3.5 w-3.5" />
              Add files
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isSending && onCancel && (
            <Button size="sm" variant="ghost" onPress={onCancel}>
              <X className="mr-2 h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          <Button onPress={onSend} isPending={isSending} isDisabled={isDisabled}>
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};
```

### `ui/src/components/playground/provider-model-key-selector.tsx`

**Exports:** ProviderModelKeySelectorProps, ProviderModelKeySelector

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// (full license header omitted for brevity — same as project root)

import React from 'react';
import { Label, ListBox, Select } from '@heroui/react';
import type { AiModel, AiProvider } from '../../types/ai-config';
import { maskApiKey } from '../../lib/provider-models';
import { AUTO_ROUND_ROBIN_KEY } from '../../lib/playground/constants';

export interface ProviderModelKeySelectorProps {
  providerIds: string[];
  providerId: string;
  modelId: string;
  selectedKey: string;
  chatModels: AiModel[];
  usableKeys: AiProvider['keys'];
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onSelectedKeyChange: (key: string) => void;
}

/**
 * Renders the three provider / model / API-key selects.
 * Contains no business logic — all data flows in via props.
 */
export const ProviderModelKeySelector: React.FC<ProviderModelKeySelectorProps> = ({
  providerIds,
  providerId,
  modelId,
  selectedKey,
  chatModels,
  usableKeys,
  onProviderChange,
  onModelChange,
  onSelectedKeyChange,
}) => (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    <Select
      className="w-full"
      placeholder="Select a provider"
      value={providerId}
      onChange={(value) => onProviderChange(String(value ?? ''))}
    >
      <Label>Provider</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {providerIds.map((id) => (
            <ListBox.Item key={id} id={id} textValue={id}>
              {id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>

    <Select
      className="w-full"
      placeholder="Select a model"
      value={modelId}
      onChange={(value) => onModelChange(String(value ?? ''))}
    >
      <Label>Model</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {chatModels.map((m) => (
            <ListBox.Item key={m.id} id={m.id} textValue={m.id}>
              {m.id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>

    <Select
      className="w-full"
      isDisabled={usableKeys.length === 0}
      placeholder="Select a provider API key"
      value={selectedKey}
      onChange={(value) => onSelectedKeyChange(String(value ?? AUTO_ROUND_ROBIN_KEY))}
    >
      <Label>Provider API key</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={AUTO_ROUND_ROBIN_KEY} key={AUTO_ROUND_ROBIN_KEY} textValue="Auto (round robin)">
            Auto (round robin)
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {usableKeys.map((apiKey) => {
            const label = `${apiKey.owner ? `${apiKey.owner} - ` : ''}${maskApiKey(apiKey.key)}${apiKey.type ? ` (${apiKey.type})` : ''}`;
            return (
              <ListBox.Item key={apiKey.key} id={apiKey.key} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  </div>
);
```

### `ui/src/components/playground/text-to-speech-button.tsx`

**Exports:** TextToSpeechButtonProps, TextToSpeechButton

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { Volume2 } from 'lucide-react';
import type { PlaygroundTtsProvider } from '../../types/playground-types';
import { speakWithWebSpeech } from '../../lib/playground/tts';

export interface TextToSpeechButtonProps {
  text: string;
  ttsProvider?: PlaygroundTtsProvider;
  onError?: (message: string) => void;
}

export const TextToSpeechButton: React.FC<TextToSpeechButtonProps> = ({
  text,
  ttsProvider,
  onError,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (audioUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    },
    [audioUrl],
  );

  const handlePress = async () => {
    if (!text.trim()) return;

    setIsGenerating(true);

    try {
      if (ttsProvider) {
        const result = await ttsProvider(text);

        if (result.audioUrl) {
          setAudioUrl((current) => {
            if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
            return result.audioUrl ?? null;
          });
          return;
        }

        if (result.audioBlob) {
          const audioBlob = result.audioBlob;
          setAudioUrl((current) => {
            if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
            return URL.createObjectURL(audioBlob);
          });
          return;
        }
      }

      await speakWithWebSpeech(text);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Text-to-speech failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" isPending={isGenerating} onPress={() => void handlePress()}>
        <Volume2 className="mr-2 h-3.5 w-3.5" />
        Play audio
      </Button>

      {audioUrl && (
        <audio controls src={audioUrl}>
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
};
```

### `ui/src/components/ui/ConfigModal.tsx`

**Exports:** ConfigModal

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

import React from 'react';
import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  useOverlayState,
} from '@heroui/react';
import { Save, X } from 'lucide-react';
import type { AiConfig, AiProtocol, AiProvider, AiModel, AiKey, Crawler, CrawlerProtocol, WeatherApi } from '../../types/ai-config';

/**
 * Identifies the entity being added or edited inside the modal.
 * `itemId` is optional:
 *   - provider: not used (providerId is the identifier)
 *   - crawler: not used (crawlerId is the identifier)
 *   - model: the model.id string
 *   - key: the numeric index in the keys array (as a string)
 */
interface EditTarget {
  type: 'provider' | 'model' | 'key' | 'crawler' | 'weatherApi';
  providerId?: string;
  crawlerId?: string;
  weatherApiId?: string;
  /** Model id or key array index (stringified) when editing an existing item. */
  itemId?: string;
}

/** Props for {@link ConfigModal}. */
interface ConfigModalProps {
  /** Controlled open/close state from `useOverlayState()`. */
  state: ReturnType<typeof useOverlayState>;
  /** Which form to render inside the modal. */
  type: EditTarget['type'];
  /**
   * When non-null, we are in "edit" mode and this locates the existing entity.
   * When null, we are in "add" mode.
   */
  editTarget: EditTarget | null;
  /** The full vault config — used to pre-fill edit forms. */
  config: AiConfig;
  /** Called with the updated config once the user submits the form. */
  onSave: (config: AiConfig) => void;
}

/**
 * Unified modal for adding and editing Providers, Models, and API Keys.
 *
 * We use the native `FormData` API to collect form values
 * instead of a form library, which keeps this component dependency-free.
 * The trade-off is that we must convert number fields manually.
 */
export const ConfigModal: React.FC<ConfigModalProps> = ({
  state,
  type,
  editTarget,
  config,
  onSave,
}) => {
  /**
   * Returns the pre-filled value for a given field when editing an existing entity.
   * Returns an empty string for "add new" mode.
   *
   * @param fieldName - The property name on the entity object (e.g. "endpoint").
   */
  const getInitialValue = (fieldName: string): string => {
    if (!editTarget) return '';

    if (type === 'weatherApi' && editTarget.weatherApiId) {
      const weatherApi = config.weatherApi;
      if (fieldName === 'id') return editTarget.weatherApiId;
      // Cast via unknown to safely index by string key — values come from known weatherApi fields.
      return String(((weatherApi as unknown) as Record<string, unknown>)[fieldName] ?? '');
    }

    if (type === 'crawler' && editTarget.crawlerId) {
      const crawler = config.crawlers[editTarget.crawlerId];
      if (fieldName === 'id') return editTarget.crawlerId;
      // Cast via unknown to safely index by string key — values come from known crawler fields.
      return String(((crawler as unknown) as Record<string, unknown>)[fieldName] ?? '');
    }

    if (type === 'provider' && editTarget.providerId) {
      const provider = config.providers[editTarget.providerId];
      if (fieldName === 'id') return editTarget.providerId;
      if (fieldName === 'modelCardEndpoint') {
        const providerWithLegacy = provider as AiProvider & { model_card_endpoint?: string };
        return String(provider.modelCardEndpoint ?? providerWithLegacy.model_card_endpoint ?? '');
      }
      // Cast via unknown to safely index by string key — values come from known provider fields.
      return String(((provider as unknown) as Record<string, unknown>)[fieldName] ?? '');
    }
    if (type === 'model' && editTarget.itemId && editTarget.providerId) {
      const provider = config.providers[editTarget.providerId];
      const model = provider.models.find((m) => m.id === editTarget.itemId);
      const val = (((model as unknown) as Record<string, unknown> | undefined))?.[fieldName];

      // Handle boolean fields with default false value
      if (['supportsImages', 'supportsPromptCache', 'supportsTools', 'supportsReasoning'].includes(fieldName)) {
        return String(val ?? false);
      }

      if (Array.isArray(val)) return JSON.stringify(val);
      return String(val ?? '');
    }
    if (type === 'key' && editTarget.itemId !== undefined) {
      if (editTarget.providerId) {
        const provider = config.providers[editTarget.providerId];
        const apiKey = provider.keys[Number(editTarget.itemId)];
        return String((((apiKey as unknown) as Record<string, unknown> | undefined))?.[fieldName] ?? '');
      } else if (editTarget.crawlerId) {
        const crawler = config.crawlers[editTarget.crawlerId];
        const apiKey = crawler.keys[Number(editTarget.itemId)];
        return String((((apiKey as unknown) as Record<string, unknown> | undefined))?.[fieldName] ?? '');
      } else if (editTarget.weatherApiId && config.weatherApi) {
        const apiKey = config.weatherApi.keys[Number(editTarget.itemId)];
        return String((((apiKey as unknown) as Record<string, unknown> | undefined))?.[fieldName] ?? '');
      }
    }
    return '';
  };

  /**
   * Processes the submitted form data and calls `onSave` with the updated config.
   * All mutation is done on a deep clone so we never modify React state directly.
   */
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries()) as Record<string, string>;

    // Deep clone to avoid mutating the state object that React holds.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(config));

    // Initialize crawlers if it doesn't exist
    if (!newConfig.crawlers) {
      newConfig.crawlers = {};
    }

    if (type === 'provider') {
      const providerId = data.id;
      const providerBody: AiProvider = {
        protocol: data.protocol as AiProtocol,
        endpoint: data.endpoint,
        gatewayEndpoint: data.gatewayEndpoint || undefined,
        gatewayModelPrefix: data.gatewayModelPrefix || undefined,
        modelCardEndpoint: data.modelCardEndpoint || undefined,
        userAgent: data.userAgent || undefined,
        // Preserve existing keys/models when renaming or editing a provider.
        keys: editTarget ? newConfig.providers[editTarget.providerId!].keys : [],
        models: editTarget
          ? newConfig.providers[editTarget.providerId!].models
          : [],
      };

      // If the provider was renamed (id changed), remove the old entry first.
      if (editTarget && editTarget.providerId && editTarget.providerId !== providerId) {
        delete newConfig.providers[editTarget.providerId];
      }
      newConfig.providers[providerId] = providerBody;
    } else if (type === 'crawler') {
      const crawlerId = data.id;
      const crawlerBody: Crawler = {
        protocol: data.protocol as CrawlerProtocol,
        endpoint: data.endpoint,
        // Preserve existing keys when renaming or editing a crawler, or initialize empty array for new crawlers
        keys: editTarget ? newConfig.crawlers[editTarget.crawlerId!].keys : [],
      };

      // If the crawler was renamed (id changed), remove the old entry first.
      if (editTarget && editTarget.crawlerId && editTarget.crawlerId !== crawlerId) {
        delete newConfig.crawlers[editTarget.crawlerId];
      }
      newConfig.crawlers[crawlerId] = crawlerBody;
    } else if (type === 'model' && editTarget && editTarget.providerId) {
      const usageValues = ['chat', 'embedding', 'transcription', 'tts', 'image-generation'] as const;
      const validUsage = usageValues.find((u) => u === data.usage) ?? 'chat';

      // Collect modality checkboxes (FormData entries named inputModalities or outputModalities).
      const rawInputModalities = formData.getAll('inputModalities') as string[];
      const rawOutputModalities = formData.getAll('outputModalities') as string[];
      const inputModalities = rawInputModalities as AiModel['inputModalities'];
      const outputModalities = rawOutputModalities as AiModel['outputModalities'];

      // Collect capability checkboxes
      const supportsImages = formData.get('supportsImages') === 'on';
      const supportsPromptCache = formData.get('supportsPromptCache') === 'on';
      const supportsTools = formData.get('supportsTools') === 'on';
      const supportsReasoning = formData.get('supportsReasoning') === 'on';

      const model: AiModel = {
        id: data.id,
        usage: validUsage,
        contextWindow: Number(data.contextWindow),
        maxOutputTokens: Number(data.maxOutputTokens),
        priority: Number(data.priority),
        tpmLimit: data.tpmLimit ? Number(data.tpmLimit) : null,
        ...(rawInputModalities.length > 0 ? { inputModalities } : {}),
        ...(rawOutputModalities.length > 0 ? { outputModalities } : {}),
        ...(supportsImages ? { supportsImages } : {}),
        ...(supportsPromptCache ? { supportsPromptCache } : {}),
        ...(supportsTools ? { supportsTools } : {}),
        ...(supportsReasoning ? { supportsReasoning } : {}),
      };

      const models = newConfig.providers[editTarget.providerId].models;
      if (editTarget.itemId) {
        // Replace the existing model by matching its id.
        const idx = models.findIndex((m) => m.id === editTarget.itemId);
        if (idx !== -1) models[idx] = model;
      } else {
        models.push(model);
      }
    } else if (type === 'weatherApi') {
      const weatherApiId = data.id;
      const weatherApiBody: WeatherApi = {
        protocol: {
          protocol: data.protocol as 'meteoblue',
        },
        endpoint: data.endpoint,
        // Preserve existing keys when renaming or editing a weatherApi, or initialize empty array for new weatherApis
        keys: editTarget ? newConfig.weatherApi?.keys || [] : [],
      };

      // If the weatherApi was renamed (id changed), remove the old entry first.
      if (editTarget && editTarget.weatherApiId && editTarget.weatherApiId !== weatherApiId) {
        delete newConfig.weatherApi;
      }
      newConfig.weatherApi = weatherApiBody;
    } else if (type === 'key' && editTarget) {
      const apiKey: AiKey = {
        key: data.key,
        owner: data.owner || undefined,
        type: (data.type as AiKey['type']) || undefined,
        sharedSecret: data.sharedSecret || undefined,
        signatureType: (data.signatureType as AiKey['signatureType']) || undefined,
      };

      // For crawler keys, we need to handle the crawlerId
      if (editTarget.crawlerId) {
        const keys = newConfig.crawlers[editTarget.crawlerId].keys;
        if (editTarget.itemId !== undefined) {
          // Replace the existing key at the stored array index.
          keys[Number(editTarget.itemId)] = apiKey;
        } else {
          keys.push(apiKey);
        }
      } else if (editTarget.providerId) {
        // For provider keys
        const keys = newConfig.providers[editTarget.providerId].keys;
        if (editTarget.itemId !== undefined) {
          // Replace the existing key at the stored array index.
          keys[Number(editTarget.itemId)] = apiKey;
        } else {
          keys.push(apiKey);
        }
      } else if (editTarget.weatherApiId) {
        // For weatherApi keys
        if (!newConfig.weatherApi) {
          newConfig.weatherApi = {
            protocol: { protocol: 'meteoblue' },
            endpoint: '',
            keys: [],
          };
        }
        const keys = newConfig.weatherApi.keys;
        if (editTarget.itemId !== undefined) {
          // Replace the existing key at the stored array index.
          keys[Number(editTarget.itemId)] = apiKey;
        } else {
          keys.push(apiKey);
        }
      }
    }

    // Sort providers by provider ID (alphabetically)
    newConfig.providers = Object.fromEntries(
      Object.entries(newConfig.providers).sort(([a], [b]) => a.localeCompare(b))
    );

    // Sort models by priority (ascending - lower number = higher priority)
    Object.values(newConfig.providers).forEach(provider => {
      provider.models.sort((a, b) => a.priority - b.priority);
    });

    onSave(newConfig);
  };

  /** Human-readable modal title. */
  const title = `${editTarget ? 'Edit' : 'Add'} ${
    type.charAt(0).toUpperCase() + type.slice(1)
  }`;

  return (
    /*
     * Modal.Root receives the `state` object from useOverlayState() which holds
     * `isOpen` and `setOpen`. HeroUI passes them down to the underlying
     * react-aria DialogTrigger so opening/closing is controlled from outside.
     */
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>

            <Form onSubmit={handleSubmit}>
              <Modal.Body className="flex flex-col gap-4">
                {/* ── Provider form ────────────────────────────────────── */}
                {type === 'provider' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Unique ID</Label>
                      <Input placeholder="openai-primary" />
                    </TextField>

                    <TextField
                      isRequired
                      name="protocol"
                      defaultValue={getInitialValue('protocol')}
                    >
                      <Label>Protocol</Label>
                      <Input placeholder="openai, groq, anthropic…" />
                    </TextField>

                    <TextField
                      isRequired
                      name="endpoint"
                      defaultValue={getInitialValue('endpoint')}
                    >
                      <Label>API Endpoint</Label>
                      <Input placeholder="https://api.openai.com/v1" />
                    </TextField>

                    <TextField
                      name="gatewayEndpoint"
                      defaultValue={getInitialValue('gatewayEndpoint')}
                    >
                      <Label>CF Gateway Endpoint (optional)</Label>
                      <Input />
                    </TextField>

                    <TextField
                      name="gatewayModelPrefix"
                      defaultValue={getInitialValue('gatewayModelPrefix')}
                    >
                      <Label>CF Gateway Model Prefix (optional)</Label>
                      <Input placeholder="@cf/openai/" />
                    </TextField>

                    <TextField
                      name="modelCardEndpoint"
                      defaultValue={getInitialValue('modelCardEndpoint')}
                    >
                      <Label>Model Card Endpoint (optional)</Label>
                      <Input placeholder="https://platform.openai.com/models/{model}" />
                    </TextField>

                    <TextField
                      name="userAgent"
                      defaultValue={getInitialValue('userAgent')}
                    >
                      <Label>Custom User Agent (optional)</Label>
                      <Input placeholder="e.g. MyApp/1.0" />
                    </TextField>
                  </>
                )}

                {/* ── Model form ───────────────────────────────────────── */}
                {type === 'model' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Model ID</Label>
                      <Input placeholder="gpt-4o" />
                    </TextField>

                    <TextField
                      isRequired
                      name="usage"
                      defaultValue={getInitialValue('usage') || 'chat'}
                    >
                      <Label>Usage</Label>
                      <Input placeholder="chat, embedding, transcription, tts, image-generation" />
                    </TextField>

                    <div className="grid grid-cols-2 gap-4">
                      <TextField
                        isRequired
                        name="contextWindow"
                        defaultValue={getInitialValue('contextWindow')}
                      >
                        <Label>Context Window</Label>
                        <Input type="number" min="1" />
                      </TextField>

                      <TextField
                        isRequired
                        name="maxOutputTokens"
                        defaultValue={getInitialValue('maxOutputTokens')}
                      >
                        <Label>Max Output Tokens</Label>
                        <Input type="number" min="1" />
                      </TextField>
                    </div>

                    <TextField
                      isRequired
                      name="priority"
                      defaultValue={getInitialValue('priority')}
                    >
                      <Label>Priority (0 = highest)</Label>
                      <Input type="number" min="0" />
                    </TextField>

                    <TextField
                      name="tpmLimit"
                      defaultValue={getInitialValue('tpmLimit')}
                    >
                      <Label>TPM Limit (optional)</Label>
                      <Input type="number" min="1" placeholder="Leave empty for unlimited" />
                    </TextField>

                    {/* Model capabilities checkboxes */}
                    <div className="grid grid-cols-2 gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="supportsImages"
                          defaultChecked={getInitialValue('supportsImages') === 'true'}
                        />
                        Supports Images
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="supportsPromptCache"
                          defaultChecked={getInitialValue('supportsPromptCache') === 'true'}
                        />
                        Supports Prompt Cache
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="supportsTools"
                          defaultChecked={getInitialValue('supportsTools') === 'true'}
                        />
                        Supports Tools
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="supportsReasoning"
                          defaultChecked={getInitialValue('supportsReasoning') === 'true'}
                        />
                        Supports Reasoning
                      </label>
                    </div>

                    {/* Option D — manual modality override */}
                    {(() => {
                      const currentInput: string[] = JSON.parse(
                        getInitialValue('inputModalities') || '["text"]',
                      );
                      const currentOutput: string[] = JSON.parse(
                        getInitialValue('outputModalities') || '["text"]',
                      );
                      return (
                        <>
                          <div>
                            <Label className="mb-1 block text-sm">Input modalities</Label>
                            <div className="flex flex-wrap gap-3">
                              {(['text', 'image', 'audio', 'video'] as const).map((m) => (
                                <label key={m} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    name="inputModalities"
                                    value={m}
                                    defaultChecked={currentInput.includes(m)}
                                  />
                                  {m}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="mb-1 block text-sm">Output modalities</Label>
                            <div className="flex flex-wrap gap-3">
                              {(['text', 'image', 'audio'] as const).map((m) => (
                                <label key={m} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    name="outputModalities"
                                    value={m}
                                    defaultChecked={currentOutput.includes(m)}
                                  />
                                  {m}
                                </label>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}

                {/* ── Crawler form ──────────────────────────────────────── */}
                {type === 'crawler' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Unique ID</Label>
                      <Input placeholder="firecrawl-primary" />
                    </TextField>

                    <TextField
                      isRequired
                      name="protocol"
                      defaultValue={getInitialValue('protocol')}
                    >
                      <Label>Protocol</Label>
                      <Input placeholder="firecrawl, scrapegraphai" />
                    </TextField>

                    <TextField
                      isRequired
                      name="endpoint"
                      defaultValue={getInitialValue('endpoint')}
                    >
                      <Label>API Endpoint</Label>
                      <Input placeholder="https://api.firecrawl.dev/v0" />
                    </TextField>
                  </>
                )}

                {/* ── Weather API form ──────────────────────────────────────── */}
                {type === 'weatherApi' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Unique ID</Label>
                      <Input placeholder="meteoblue-primary" />
                    </TextField>

                    <TextField
                      isRequired
                      name="protocol"
                      defaultValue={getInitialValue('protocol')}
                    >
                      <Label>Protocol</Label>
                      <Input placeholder="meteoblue" />
                    </TextField>

                    <TextField
                      isRequired
                      name="endpoint"
                      defaultValue={getInitialValue('endpoint')}
                    >
                      <Label>API Endpoint</Label>
                      <Input placeholder="https://my-api.meteoblue.com/v1" />
                    </TextField>
                  </>
                )}

                {/* ── API Key form ─────────────────────────────────────── */}
                {type === 'key' && (
                  <>
                    <TextField isRequired name="key" defaultValue={getInitialValue('key')}>
                      <Label>API Key</Label>
                      {/* type="password" hides the key value visually */}
                      <Input type="password" autoComplete="new-password" />
                    </TextField>

                    <TextField
                      name="owner"
                      defaultValue={getInitialValue('owner')}
                    >
                      <Label>Owner Name (optional)</Label>
                      <Input placeholder="e.g. team-backend" />
                    </TextField>

                    <TextField
                      name="type"
                      defaultValue={getInitialValue('type')}
                    >
                      <Label>Key Tier (optional)</Label>
                      <Input placeholder="free, paid, premium, unlimited…" />
                    </TextField>

                    <TextField
                      name="sharedSecret"
                      defaultValue={getInitialValue('sharedSecret')}
                    >
                      <Label>Shared Secret (optional)</Label>
                      <Input type="password" autoComplete="new-password" placeholder="Gateway shared secret" />
                    </TextField>

                    <TextField
                      name="signatureType"
                      defaultValue={getInitialValue('signatureType')}
                    >
                      <Label>Signature Type (optional)</Label>
                      <Input placeholder="hmac-md5, hmac-sha256, hmac-sha512" />
                    </TextField>
                  </>
                )}
              </Modal.Body>

              <Modal.Footer>
                {/* X button dismisses without saving */}
                <Button variant="ghost" onPress={() => state.close()}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  Apply to Draft
                </Button>
              </Modal.Footer>
            </Form>

            {/* Built-in close button in the modal top-right corner */}
            <Modal.CloseTrigger />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
```

### `ui/src/components/ui/CrawlerCard.tsx`

**Exports:** CrawlerCard

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

import React, { useState } from 'react';
import {
  Button,
  Card,
  Chip,
  Table,
  Tabs,
  Modal,
  useOverlayState,
} from '@heroui/react';
import { Edit, Key, Plus, Trash2, CreditCard } from 'lucide-react';
import type { Crawler } from '../../types/ai-config';

interface CreditUsage {
  remainingCredits: number;
  billingPeriodEnd: string;
  error?: string;
}

/** Props for {@link CrawlerCard}. */
interface CrawlerCardProps {
  /** Dictionary key of the crawler. */
  id: string;
  /** Crawler data from the vault. */
  crawler: Crawler;
  /** Called when the user clicks "Delete Crawler". */
  onDelete: () => void;
  /** Called when the user clicks "Edit Crawler". */
  onEdit: () => void;
  /** Called when the user clicks "Add Key". */
  onAddKey: () => void;
  /** Called with the array index of the key to edit. */
  onEditKey: (index: number) => void;
  /** Called with the array index of the key to delete. */
  onDeleteKey: (index: number) => void;
  /** Called when the user toggles BYOK availability. */
  onToggleByok: (isByok: boolean) => void;
  /** Whether the crawler is available for BYOK. */
  isByok: boolean;
}

/**
 * Card component that renders a single crawler with its API keys.
 */
export const CrawlerCard: React.FC<CrawlerCardProps> = ({
  id,
  crawler,
  onDelete,
  onEdit,
  onAddKey,
  onEditKey,
  onDeleteKey,
  onToggleByok,
  isByok,
}) => {
  const [creditUsages, setCreditUsages] = useState<CreditUsage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const creditModalState = useOverlayState();

  const fetchFirecrawlCreditUsage = async (apiKey: string): Promise<CreditUsage> => {
    try {
      const response = await fetch('https://api.firecrawl.dev/v2/team/credit-usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.data) {
        return {
          remainingCredits: data.data.remainingCredits,
          billingPeriodEnd: data.data.billingPeriodEnd
        };
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      return {
        remainingCredits: 0,
        billingPeriodEnd: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const handleShowCredits = async () => {
    setIsLoading(true);
    creditModalState.open();

    try {
      const results = await Promise.all(
        crawler.keys.map(key => fetchFirecrawlCreditUsage(key.key))
      );
      setCreditUsages(results);
    } catch (error) {
      console.error('Error fetching credit usage:', error);
      setCreditUsages(crawler.keys.map(() => ({
        remainingCredits: 0,
        billingPeriodEnd: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      })));
    } finally {
      setIsLoading(false);
    }
  };

  const calculateDaysRemaining = (billingPeriodEnd: string): string => {
    if (!billingPeriodEnd) return 'N/A';

    try {
      const endDate = new Date(billingPeriodEnd);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? `${diffDays} days` : 'Expired';
    } catch {
      return 'N/A';
    }
  };

  return (
    <>
      <Card className="overflow-hidden border-l-4 border-l-primary">
        {/* ── Crawler header ──────────────────────────────────────────────── */}
        <Card.Header className="flex flex-row items-center justify-between bg-muted/5 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Card.Title className="text-xl font-bold">{id}</Card.Title>
              {/* Protocol chip */}
              <Chip size="sm" variant="soft" color="accent">
                {crawler.protocol}
              </Chip>
              {/* BYOK checkbox */}
              <div className="flex items-center gap-1 ml-4">
                <input
                  type="checkbox"
                  checked={isByok}
                  onChange={(e) => onToggleByok(e.target.checked)}
                  id={`byok-${id}`}
                  className="h-4 w-4"
                />
                <label htmlFor={`byok-${id}`} className="text-sm text-muted-foreground">
                  Available for BYOK
                </label>
              </div>
            </div>
            <Card.Description className="font-mono text-xs">
              {crawler.endpoint}
            </Card.Description>
          </div>
          <div className="flex gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={onEdit} aria-label="Edit crawler">
              <Edit className="h-4 w-4" />
            </Button>
            <Button isIconOnly size="sm" variant="danger-soft" onPress={onDelete} aria-label="Delete crawler">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card.Header>

        {/* ── API Keys panel ──────────────────────────────────────────── */}
        <Card.Content className="p-0">
          <Tabs variant="secondary">
            <Tabs.ListContainer className="border-b px-4">
              <Tabs.List aria-label={`${id} sections`}>
                <Tabs.Tab id="keys">
                  <div className="flex items-center gap-2 py-2">
                    <Key className="h-3.5 w-3.5" />
                    API Keys ({crawler.keys.length})
                  </div>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            {/* ── API Keys panel ──────────────────────────────────────────── */}
            <Tabs.Panel id="keys" className="p-4">
              <div className="mb-2 flex justify-end gap-2">
                <Button size="sm" variant="tertiary" onPress={onAddKey}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add Key
                </Button>
                <Button size="sm" variant="tertiary" onPress={handleShowCredits}>
                  <CreditCard className="mr-2 h-3.5 w-3.5" />
                  Show Credits
                </Button>
              </div>
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label={`${id} API keys`}>
                    <Table.Header>
                      <Table.Column isRowHeader>Key (Masked)</Table.Column>
                      <Table.Column>Owner</Table.Column>
                      <Table.Column>Type</Table.Column>
                      <Table.Column className="text-end">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {crawler.keys.map((apiKey, index) => (
                        <Table.Row key={index}>
                          {/* Show only first 8 and last 4 chars to avoid exposing the key */}
                          <Table.Cell className="font-mono">
                            {apiKey.key.substring(0, 8)}…
                            {apiKey.key.substring(apiKey.key.length - 4)}
                          </Table.Cell>
                          <Table.Cell>{apiKey.owner ?? '—'}</Table.Cell>
                          <Table.Cell>
                            {apiKey.type && (
                              <Chip size="sm" variant="soft">
                                {apiKey.type}
                              </Chip>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex justify-end gap-1">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                onPress={() => onEditKey(index)}
                                aria-label={`Edit key ${index}`}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="danger-soft"
                                onPress={() => onDeleteKey(index)}
                                aria-label={`Delete key ${index}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      </Card>

      {/* Credit Usage Modal */}
      <Modal state={creditModalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-2xl">
              <Modal.Header>
                <Modal.Heading>Credit Usage for {id}</Modal.Heading>
              </Modal.Header>

              <Modal.Body>
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <p>Loading credit information...</p>
                  </div>
                ) : (
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Credit usage information">
                        <Table.Header>
                          <Table.Column isRowHeader>Key (Masked)</Table.Column>
                          <Table.Column>Remaining Credits</Table.Column>
                          <Table.Column>Days Until Reset</Table.Column>
                          <Table.Column>Status</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {creditUsages.map((usage, index) => {
                            const apiKey = crawler.keys[index];
                            const daysRemaining = calculateDaysRemaining(usage.billingPeriodEnd);
                            return (
                              <Table.Row key={index}>
                                <Table.Cell className="font-mono">
                                  {apiKey.key.substring(0, 8)}…
                                  {apiKey.key.substring(apiKey.key.length - 4)}
                                </Table.Cell>
                                <Table.Cell>
                                  {usage.error ? (
                                    <span className="text-danger-600">Error: {usage.error}</span>
                                  ) : (
                                    usage.remainingCredits.toLocaleString()
                                  )}
                                </Table.Cell>
                                <Table.Cell>
                                  {usage.error ? 'N/A' : daysRemaining}
                                </Table.Cell>
                                <Table.Cell>
                                  {!usage.error && usage.remainingCredits > 0 ? (
                                    <Chip size="sm" variant="soft" color="success">
                                      Active
                                    </Chip>
                                  ) : !usage.error ? (
                                    <Chip size="sm" variant="soft" color="warning">
                                      Low
                                    </Chip>
                                  ) : (
                                    <Chip size="sm" variant="soft" color="danger">
                                      Error
                                    </Chip>
                                  )}
                                </Table.Cell>
                              </Table.Row>
                            );
                          })}
                          {/* Total row */}
                          <Table.Row key="total">
                            <Table.Cell className="font-bold">Total</Table.Cell>
                            <Table.Cell className="font-bold">
                              {creditUsages.reduce((total, usage) =>
                                total + (usage.error ? 0 : usage.remainingCredits), 0
                              ).toLocaleString()}
                            </Table.Cell>
                            <Table.Cell className="font-bold">-</Table.Cell>
                            <Table.Cell className="font-bold">-</Table.Cell>
                          </Table.Row>
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                )}
              </Modal.Body>

              <Modal.Footer>
                <Button variant="ghost" onPress={() => creditModalState.close()}>
                  Close
                </Button>
              </Modal.Footer>

              <Modal.CloseTrigger />
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
};
```

### `ui/src/components/ui/ModelDeletionModal.tsx`

**Exports:** ModelDeletionModal

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
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import React, { useState } from 'react';
import {
  Button,
  Modal,
  Table,
  useOverlayState,
} from '@heroui/react';
import { AlertTriangle, Trash2, X} from 'lucide-react';
import type { AiModel } from '../../types/ai-config';

/** Props for {@link ModelDeletionModal}. */
interface ModelDeletionModalProps {
  /** Controlled open/close state from `useOverlayState()`. */
  state: ReturnType<typeof useOverlayState>;
  /** Provider ID for which models are being deleted. */
  providerId: string;
  /** Models that exist in the current config but not in the API response. */
  modelsToDelete: AiModel[];
  /** Called with the array of model IDs to delete. */
  onDeleteModels: (modelIds: string[]) => void;
}

/**
 * Modal for confirming deletion of models that are no longer available
 * in the provider's API after a refresh operation.
 */
export const ModelDeletionModal: React.FC<ModelDeletionModalProps> = ({
  state,
  providerId,
  modelsToDelete,
  onDeleteModels,
}) => {
  // Track which models are selected for deletion (all checked by default)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set()
  );

  // Synchronize state when modelsToDelete changes
  React.useEffect(() => {
    setSelectedModelIds(new Set(modelsToDelete.map((model) => model.id)));
  }, [modelsToDelete]);

  // Select/deselect all models
  const toggleAllModels = () => {
    if (selectedModelIds.size === modelsToDelete.length) {
      setSelectedModelIds(new Set());
    } else {
      setSelectedModelIds(new Set(modelsToDelete.map(model => model.id)));
    }
  };

  // Toggle selection for a single model
  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  // Handle form submission
  const handleDelete = () => {
    const modelIdsToDelete = Array.from(selectedModelIds);
    onDeleteModels(modelIdsToDelete);
    state.close();
  };

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-w-2xl">
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Models No Longer Available
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="mb-4">
                <p className="text-sm text-muted-foreground">
                  The following models exist in your {providerId} configuration but were not found in the provider's API.
                  These models may have been deprecated or removed by the provider.
                </p>
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Models to delete">
                      <Table.Header>
                        <Table.Column>
                          <input
                            type="checkbox"
                            checked={selectedModelIds.size === modelsToDelete.length && modelsToDelete.length > 0}
                            onChange={toggleAllModels}
                            aria-label="Select all models"
                          />
                        </Table.Column>
                        <Table.Column isRowHeader>Model ID</Table.Column>
                        <Table.Column>Usage</Table.Column>
                        <Table.Column>Context Window</Table.Column>
                        <Table.Column>Priority</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {modelsToDelete.length === 0 ? (
                          <Table.Row>
                            <Table.Cell colSpan={5} className="text-center py-4">
                              No models to delete.
                            </Table.Cell>
                          </Table.Row>
                        ) : (
                          modelsToDelete.map((model) => (
                            <Table.Row key={model.id}>
                              <Table.Cell>
                                <input
                                  type="checkbox"
                                  checked={selectedModelIds.has(model.id)}
                                  onChange={() => toggleModelSelection(model.id)}
                                  aria-label={`Select ${model.id} for deletion`}
                                />
                              </Table.Cell>
                              <Table.Cell className="font-medium">{model.id}</Table.Cell>
                              <Table.Cell>
                                <span className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">
                                  {model.usage}
                                </span>
                              </Table.Cell>
                              <Table.Cell>{model.contextWindow.toLocaleString()} tokens</Table.Cell>
                              <Table.Cell>
                                <span className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                                  {model.priority}
                                </span>
                              </Table.Cell>
                            </Table.Row>
                          ))
                        )}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="ghost" onPress={() => state.close()}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button
                variant="danger"
                onPress={handleDelete}
                isDisabled={selectedModelIds.size === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected ({selectedModelIds.size})
              </Button>
            </Modal.Footer>

            <Modal.CloseTrigger />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
```

### `ui/src/components/ui/ModelPriorityList.tsx`

**Exports:** ModelPriorityList

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

import React, { useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Edit, GripVertical, Trash2 } from 'lucide-react';
import type { AiModel } from '../../types/ai-config';

/** Props for {@link ModelPriorityList}. */
interface ModelPriorityListProps {
  /** Provider identifier used for accessible labels. */
  providerId: string;
  /** Optional model card endpoint for opening model documentation. */
  modelCardEndpoint?: string;
  /** Models in their current visual and priority order. */
  models: AiModel[];
  /** Opens the existing model edit modal. */
  onEditModel: (id: string) => void;
  /** Removes one model from the provider. */
  onDeleteModel: (id: string) => void;
  /** Stages deletion for all selected model ids. */
  onDeleteSelectedModels: (ids: string[]) => void;
  /** Stages a new model order and regenerates priorities upstream. */
  onReorderModels: (models: AiModel[]) => void;
  /** Toggles BYOK availability for a model. */
  onToggleByok: (modelId: string, isByok: boolean) => void;
  /** Set of model IDs that are available for BYOK. */
  byokModelIds: Set<string>;
}

/**
 * Drag-and-drop model list.
 *
 * HTML drag events are enough here: we only need to reorder an in-memory array
 * and then save the whole vault. When a row is dropped, the parent rewrites the
 * provider's `models` array and calls `renumberPriorities`, so the priority
 * numbers always match what the user sees on screen.
 */
export const ModelPriorityList: React.FC<ModelPriorityListProps> = ({
  providerId,
  modelCardEndpoint,
  models,
  onEditModel,
  onDeleteModel,
  onDeleteSelectedModels,
  onReorderModels,
  onToggleByok,
  byokModelIds,
}) => {
  /** Row currently being dragged, stored as an index into `models`. */
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  /** Row currently hovered as a drop target, used only for visual feedback. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const buildModelCardUrl = (modelId: string) => {
    if (!modelCardEndpoint) return '';
    const endpoint = modelCardEndpoint.trim();
    if (!endpoint) return '';
    if (endpoint.includes('{model}')) {
      return endpoint.split('{model}').join((modelId));
    }
    const trimmedBase = endpoint.replace(/\/+$/, '');
    return `${trimmedBase}/${(modelId)}`;
  };

  /** Model IDs checked for a batch delete operation. */
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  /** Clears stale selections when the provider model list changes. */
  useEffect(() => {
    setSelectedModelIds((selectedIds) => {
      const availableIds = new Set(models.map((model) => model.id));
      return new Set([...selectedIds].filter((id) => availableIds.has(id)));
    });
  }, [models]);

  const allModelIds = models.map((model) => model.id);
  const allSelected = allModelIds.length > 0 && allModelIds.every((id) => selectedModelIds.has(id));

  /** Toggles one model checkbox without changing row order. */
  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((selectedIds) => {
      const next = new Set(selectedIds);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  /** Toggles every model in the provider list. */
  const toggleAllModels = () => {
    setSelectedModelIds(allSelected ? new Set() : new Set(allModelIds));
  };

  /** Sends the current selection to the parent, then clears it locally. */
  const deleteSelectedModels = () => {
    const ids = [...selectedModelIds];
    if (ids.length === 0) return;
    onDeleteSelectedModels(ids);
    setSelectedModelIds(new Set());
  };

  /**
   * Moves a row and stages the resulting order. The operation is ignored when
   * the source and target are identical, which keeps accidental clicks cheap.
   */
  const reorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const next = [...models];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorderModels(next);
  };

  if (models.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No models configured for {providerId}.
      </div>
    );
  }

  return (
    <div className="rounded-md border" role="table" aria-label={`${providerId} models`}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-sm text-muted-foreground">
          {selectedModelIds.size} selected
        </p>
        <Button
          size="sm"
          variant="danger-soft"
          onPress={deleteSelectedModels}
          isDisabled={selectedModelIds.size === 0}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete Selected
        </Button>
      </div>
      <div
        className="grid min-w-230 grid-cols-[44px_44px_44px_minmax(260px,1fr)_110px_160px_160px_120px_120px] items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground"
        role="row"
      >
        <span role="columnheader" aria-label="Drag handle" />
        <span role="columnheader" aria-label="Select models">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAllModels}
            aria-label={`Select all ${providerId} models`}
          />
        </span>
        <span role="columnheader">BYOK</span>
        <span role="columnheader">Model ID</span>
        <span role="columnheader">Usage</span>
        <span role="columnheader">Context</span>
        <span role="columnheader">Modalities</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader" className="text-end">Actions</span>
      </div>

      <div className="overflow-x-auto">
        {models.map((model, index) => (
          <div
            key={model.id}
            draggable
            role="row"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(index));
              setDraggedIndex(index);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(event) => {
              event.preventDefault();
              const fromIndex = Number(event.dataTransfer.getData('text/plain'));
              if (Number.isInteger(fromIndex)) reorder(fromIndex, index);
              setDraggedIndex(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              setDraggedIndex(null);
              setDropIndex(null);
            }}
            className={[
              'grid min-w-230 grid-cols-[44px_44px_44px_minmax(260px,1fr)_110px_160px_160px_120px_120px] items-center gap-3 border-b px-3 py-2 last:border-b-0',
              'transition-colors',
              draggedIndex === index ? 'bg-muted/30 opacity-70' : '',
              dropIndex === index && draggedIndex !== index ? 'bg-primary/10' : '',
            ].join(' ')}
          >
            <div role="cell" className="flex h-9 items-center justify-center text-muted-foreground">
              <GripVertical className="h-4 w-4 cursor-grab" aria-hidden="true" />
            </div>
            <div role="cell" className="flex h-9 items-center justify-center">
              <input
                type="checkbox"
                checked={selectedModelIds.has(model.id)}
                onChange={() => toggleModelSelection(model.id)}
                aria-label={`Select model ${model.id}`}
              />
            </div>
            <div role="cell" className="flex h-9 items-center justify-center">
              <input
                type="checkbox"
                checked={byokModelIds.has(model.id)}
                onChange={(e) => onToggleByok(model.id, e.target.checked)}
                aria-label={`Available for BYOK ${model.id}`}
                title="Available for BYOK"
              />
            </div>
            <div role="cell" className="min-w-0 font-medium">
              {modelCardEndpoint ? (
                <a
                  href={buildModelCardUrl(model.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  draggable={false}
                  className="block truncate text-primary underline-offset-2 hover:underline"
                  title={`Open model card for ${model.id}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {model.id}
                </a>
              ) : (
                <span className="block truncate" title={model.id}>{model.id}</span>
              )}
            </div>
            <div role="cell">
              <Chip size="sm" variant="soft" color={model.usage === 'embedding' ? 'accent' : 'default'}>
                {model.usage}
              </Chip>
            </div>
            <div role="cell" className="text-sm">
              {model.contextWindow.toLocaleString()} tokens
            </div>
            <div role="cell" className="flex flex-wrap gap-1">
              {(model.inputModalities ?? ['text']).map((m) => (
                <Chip key={`in-${m}`} size="sm" variant="soft" color="accent" title={`Input: ${m}`}>
                  {m}↓
                </Chip>
              ))}
              {(model.outputModalities ?? ['text']).filter((m) =>
                !(model.inputModalities ?? ['text']).includes(m as 'text'),
              ).map((m) => (
                <Chip key={`out-${m}`} size="sm" variant="soft" color="default" title={`Output: ${m}`}>
                  {m}↑
                </Chip>
              ))}
            </div>
            <div role="cell">
              <Chip size="sm" variant={model.priority === 0 ? 'primary' : 'secondary'}>
                {model.priority}
              </Chip>
            </div>
            <div role="cell" className="flex justify-end gap-1">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => onEditModel(model.id)}
                aria-label={`Edit model ${model.id}`}
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                onPress={() => onDeleteModel(model.id)}
                aria-label={`Delete model ${model.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### `ui/src/components/ui/ProviderCard.tsx`

**Exports:** ProviderCard

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

import React, { useState, useEffect } from 'react';
import {
  Button,
  Card,
  Chip,
  Table,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import { Box, DownloadCloud, Edit, Eye, EyeOff, Key, Plus, Trash2, Clipboard, Check } from 'lucide-react';
import type { AiProvider, AiModel } from '../../types/ai-config';
import { ModelPriorityList } from './ModelPriorityList';
import { ModelDeletionModal } from './ModelDeletionModal';

/** Props for {@link ProviderCard}. */
interface ProviderCardProps {
  /** Dictionary key of the provider. */
  id: string;
  /** Provider data from the vault. */
  provider: AiProvider;
  /** Called when the user clicks "Delete Provider". */
  onDelete: () => void;
  /** Called when the user clicks "Edit Provider". */
  onEdit: () => void;
  /** Called when the user clicks "Add Key". */
  onAddKey: () => void;
  /** Called when the user clicks "Add Model". */
  onAddModel: () => void;
  /** Called with the array index of the key to edit. */
  onEditKey: (index: number) => void;
  /** Called with the model.id to edit. */
  onEditModel: (id: string) => void;
  /** Called with the array index of the key to delete. */
  onDeleteKey: (index: number) => void;
  /** Called with the model.id to delete. */
  onDeleteModel: (id: string) => void;
  /** Called with every selected model id to delete as one draft operation. */
  onDeleteSelectedModels: (ids: string[]) => void;
  /** Called when the user asks the UI to reload models from the provider API. */
  onRefreshModels: () => void;
  /** Called when the user asks to reload only free models (OpenRouter only). */
  onRefreshFreeModels?: () => void;
  /** Called when the user asks to reload only latest models (Mistral only). */
  onRefreshLatestModels?: () => void;
  /** Whether this provider has a known upstream model-list API implementation. */
  canRefreshModels: boolean;
  /** Whether the upstream model-list request is in flight. */
  isRefreshingModels: boolean;
  /** Last sync result or error for the provider. */
  modelSyncMessage?: string;
  /** Called with models in their new visual order. */
  onReorderModels: (models: AiModel[]) => void;
  /** Called when models need to be deleted after API refresh detects missing models. */
  onDeleteMissingModels?: (modelIds: string[]) => void;
  /** List of model IDs that are available from the provider API (used to detect missing models). */
  availableModelIds?: string[];
  /** Called when the user toggles BYOK availability for a model. */
  onToggleByok?: (modelId: string, isByok: boolean) => void;
  /** Set of model IDs that are available for BYOK. */
  byokModelIds?: Set<string>;
}

/** Backward-compatible read for legacy snake_case provider field. */
const getProviderModelCardEndpoint = (provider: AiProvider): string | undefined => {
  const providerWithLegacy = provider as AiProvider & { model_card_endpoint?: string };
  return provider.modelCardEndpoint ?? providerWithLegacy.model_card_endpoint;
};

/**
 * Card component that renders a single AI provider with its models and keys
 * in nested tabs.
 *
 * Each ProviderCard manages its own uncontrolled tab state
 * (react-aria defaults to the first tab), so we don't need `selectedKey` here.
 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  id,
  provider,
  onDelete,
  onEdit,
  onAddKey,
  onAddModel,
  onEditKey,
  onEditModel,
  onDeleteKey,
  onDeleteModel,
  onDeleteSelectedModels,
  onRefreshModels,
  onRefreshFreeModels,
  onRefreshLatestModels,
  canRefreshModels,
  isRefreshingModels,
  modelSyncMessage,
  onReorderModels,
  onDeleteMissingModels,
  availableModelIds,
  onToggleByok,
  byokModelIds,
}) => {
  const resolvedModelCardEndpoint = getProviderModelCardEndpoint(provider);
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set());
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);
  const [modelsToDelete, setModelsToDelete] = useState<AiModel[]>([]);
  const deletionModalState = useOverlayState();

  // Detect models that exist in config but not in API response
  const detectMissingModels = () => {
    if (!availableModelIds || availableModelIds.length === 0) {
      return;
    }

    const missingModels = provider.models.filter(model =>
      !availableModelIds.includes(model.id)
    );

    if (missingModels.length > 0) {
      setModelsToDelete(missingModels);
      deletionModalState.open();
    }
  };

  // Automatically detect missing models when availableModelIds changes
  useEffect(() => {
    if (availableModelIds && availableModelIds.length > 0) {
      detectMissingModels();
    }
  }, [availableModelIds]);

  // Handle deletion of selected models
  const handleDeleteMissingModels = (modelIds: string[]) => {
    onDeleteMissingModels?.(modelIds);
    setModelsToDelete([]);
  };

  const toggleKeyVisibility = (index: number) => {
    setVisibleKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const copyToClipboard = (key: string, index: number) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKeyIndex(index);
      setTimeout(() => {
        setCopiedKeyIndex(null);
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy key to clipboard:', err);
    });
  };

  return (
    <>
      <Card className="overflow-hidden border-l-4 border-l-primary">
      {/* ── Provider header ──────────────────────────────────────────────── */}
      <Card.Header className="flex flex-row items-center justify-between bg-muted/5 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Card.Title className="text-xl font-bold">{id}</Card.Title>
            {/* Protocol chip — e.g. "openai", "anthropic" */}
            <Chip size="sm" variant="soft" color="accent">
              {provider.protocol}
            </Chip>
          </div>
          <Card.Description className="font-mono text-xs">
            {provider.endpoint}
          </Card.Description>
          {resolvedModelCardEndpoint && (
            <Card.Description className="font-mono text-xs text-primary">
              Model cards: {resolvedModelCardEndpoint}
            </Card.Description>
          )}
        </div>
        <div className="flex gap-2">
          <Button isIconOnly size="sm" variant="ghost" onPress={onEdit} aria-label="Edit provider">
            <Edit className="h-4 w-4" />
          </Button>
          <Button isIconOnly size="sm" variant="danger-soft" onPress={onDelete} aria-label="Delete provider">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </Card.Header>

      {/* ── Nested tabs: Models | Keys ───────────────────────────────────── */}
      <Card.Content className="p-0">
        <Tabs variant="secondary">
          <Tabs.ListContainer className="border-b px-4">
            <Tabs.List aria-label={`${id} sections`}>
              <Tabs.Tab id="models">
                <div className="flex items-center gap-2 py-2">
                  <Box className="h-3.5 w-3.5" />
                  Models ({provider.models.length})
                </div>
              </Tabs.Tab>
              <Tabs.Tab id="keys">
                <div className="flex items-center gap-2 py-2">
                  <Key className="h-3.5 w-3.5" />
                  API Keys ({provider.keys.length})
                </div>
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* ── Models panel ────────────────────────────────────────────── */}
          <Tabs.Panel id="models" className="p-4">
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="tertiary"
                onPress={onRefreshModels}
                isPending={isRefreshingModels}
                isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
              >
                <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                Refresh from API
              </Button>
              {id === 'openrouter' && onRefreshFreeModels && (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={onRefreshFreeModels}
                  isPending={isRefreshingModels}
                  isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
                >
                  <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                  Refresh free from API
                </Button>
              )}
              {id === 'mistral' && onRefreshLatestModels && (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={onRefreshLatestModels}
                  isPending={isRefreshingModels}
                  isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
                >
                  <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                  Refresh latest from API
                </Button>
              )}
              <Button size="sm" variant="tertiary" onPress={onAddModel}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Model
              </Button>
            </div>
            {modelSyncMessage && (
              <p className="mb-3 text-sm text-muted-foreground">{modelSyncMessage}</p>
            )}
            <ModelPriorityList
              providerId={id}
              models={provider.models}
              modelCardEndpoint={resolvedModelCardEndpoint}
              onEditModel={onEditModel}
              onDeleteModel={onDeleteModel}
              onDeleteSelectedModels={onDeleteSelectedModels}
              onReorderModels={onReorderModels}
              onToggleByok={onToggleByok || ((_modelId, _isByok) => {})}
              byokModelIds={byokModelIds || new Set()}
            />
          </Tabs.Panel>

          {/* ── API Keys panel ──────────────────────────────────────────── */}
          <Tabs.Panel id="keys" className="p-4">
            <div className="mb-2 flex justify-end">
              <Button size="sm" variant="tertiary" onPress={onAddKey}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Key
              </Button>
            </div>
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label={`${id} API keys`}>
                  <Table.Header>
                    <Table.Column isRowHeader>Key (Masked)</Table.Column>
                    <Table.Column>Owner</Table.Column>
                    <Table.Column>Type</Table.Column>
                    <Table.Column className="text-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {provider.keys.map((apiKey, index) => (
                      <Table.Row key={index}>
                        {/* Show full key if visible, otherwise show masked version */}
                        <Table.Cell className="font-mono">
                          <div className="flex items-center gap-2">
                            {visibleKeys.has(index) ? (
                              apiKey.key
                            ) : (
                              <>
                                {apiKey.key.substring(0, 8)}…
                                {apiKey.key.substring(apiKey.key.length - 4)}
                              </>
                            )}
                            <div className="flex gap-1 ml-2">
                              {/* Toggle visibility button */}
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                onPress={() => toggleKeyVisibility(index)}
                                aria-label={visibleKeys.has(index) ? `Hide key ${index}` : `Show key ${index}`}
                              >
                                {visibleKeys.has(index) ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              {/* Copy to clipboard button (only shown when key is visible) */}
                              {visibleKeys.has(index) && (
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="ghost"
                                  onPress={() => copyToClipboard(apiKey.key, index)}
                                  aria-label={`Copy key ${index} to clipboard`}
                                >
                                  {copiedKeyIndex === index ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Clipboard className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>{apiKey.owner ?? '—'}</Table.Cell>
                        <Table.Cell>
                          {apiKey.type && (
                            <Chip size="sm" variant="soft">
                              {apiKey.type}
                            </Chip>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end gap-1">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => onEditKey(index)}
                              aria-label={`Edit key ${index}`}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="danger-soft"
                              onPress={() => onDeleteKey(index)}
                              aria-label={`Delete key ${index}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Tabs.Panel>
        </Tabs>
      </Card.Content>
    </Card>

    {/* Model Deletion Modal */}
    <ModelDeletionModal
      state={deletionModalState}
      providerId={id}
      modelsToDelete={modelsToDelete}
      onDeleteModels={handleDeleteMissingModels}
    />
    </>
  );
};
```

### `ui/src/components/ui/WeatherApiCard.tsx`

**Exports:** WeatherApiCard

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

import React from 'react';
import {
  Button,
  Card,
  Chip,
  Table,
  Tabs,
} from '@heroui/react';
import { Edit, Key, Plus, Trash2 } from 'lucide-react';
import type { WeatherApi } from '../../types/ai-config';

/** Props for {@link WeatherApiCard}. */
interface WeatherApiCardProps {
  /** Dictionary key of the weather API. */
  id: string;
  /** Weather API data from the vault. */
  weatherApi: WeatherApi;
  /** Called when the user clicks "Delete Weather API". */
  onDelete: () => void;
  /** Called when the user clicks "Edit Weather API". */
  onEdit: () => void;
  /** Called when the user clicks "Add Key". */
  onAddKey: () => void;
  /** Called with the array index of the key to edit. */
  onEditKey: (index: number) => void;
  /** Called with the array index of the key to delete. */
  onDeleteKey: (index: number) => void;
  /** Called when the user toggles BYOK availability. */
  onToggleByok: (isByok: boolean) => void;
  /** Whether the weather API is available for BYOK. */
  isByok: boolean;
}

export const WeatherApiCard: React.FC<WeatherApiCardProps> = ({
  id,
  weatherApi,
  onDelete,
  onEdit,
  onAddKey,
  onEditKey,
  onDeleteKey,
  onToggleByok,
  isByok,
}) => {
  return (
    <>
      <Card className="overflow-hidden border-l-4 border-l-primary">
        {/* ── Weather API header ──────────────────────────────────────────────── */}
        <Card.Header className="flex flex-row items-center justify-between bg-muted/5 p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Card.Title className="text-xl font-bold">{id}</Card.Title>
              {/* Protocol chip */}
              <Chip size="sm" variant="soft" color="accent">
                {weatherApi.protocol.protocol}
              </Chip>
              {/* BYOK checkbox */}
              <div className="flex items-center gap-1 ml-4">
                <input
                  type="checkbox"
                  checked={isByok}
                  onChange={(e) => onToggleByok(e.target.checked)}
                  id={`byok-${id}`}
                  className="h-4 w-4"
                />
                <label htmlFor={`byok-${id}`} className="text-sm text-muted-foreground">
                  Available for BYOK
                </label>
              </div>
            </div>
            <Card.Description className="font-mono text-xs">
              {weatherApi.endpoint}
            </Card.Description>
          </div>
          <div className="flex gap-2">
            <Button isIconOnly size="sm" variant="ghost" onPress={onEdit} aria-label="Edit weather API">
              <Edit className="h-4 w-4" />
            </Button>
            <Button isIconOnly size="sm" variant="danger-soft" onPress={onDelete} aria-label="Delete weather API">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card.Header>

        {/* ── API Keys panel ──────────────────────────────────────────── */}
        <Card.Content className="p-0">
          <Tabs variant="secondary">
            <Tabs.ListContainer className="border-b px-4">
              <Tabs.List aria-label={`${id} sections`}>
                <Tabs.Tab id="keys">
                  <div className="flex items-center gap-2 py-2">
                    <Key className="h-3.5 w-3.5" />
                    API Keys ({weatherApi.keys.length})
                  </div>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            {/* ── API Keys panel ──────────────────────────────────────────── */}
            <Tabs.Panel id="keys" className="p-4">
              <div className="mb-2 flex justify-end gap-2">
                <Button size="sm" variant="tertiary" onPress={onAddKey}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add Key
                </Button>
              </div>
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label={`${id} API keys`}>
                    <Table.Header>
                      <Table.Column isRowHeader>Key (Masked)</Table.Column>
                      <Table.Column>Owner</Table.Column>
                      <Table.Column>Type</Table.Column>
                      <Table.Column className="text-end">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {weatherApi.keys.map((apiKey, index) => (
                        <Table.Row key={index}>
                          {/* Show only first 8 and last 4 chars to avoid exposing the key */}
                          <Table.Cell className="font-mono">
                            {apiKey.key.substring(0, 8)}…
                            {apiKey.key.substring(apiKey.key.length - 4)}
                          </Table.Cell>
                          <Table.Cell>{apiKey.owner ?? '—'}</Table.Cell>
                          <Table.Cell>
                            {apiKey.type && (
                              <Chip size="sm" variant="soft">
                                {apiKey.type}
                              </Chip>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex justify-end gap-1">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                onPress={() => onEditKey(index)}
                                aria-label={`Edit key ${index}`}
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="danger-soft"
                                onPress={() => onDeleteKey(index)}
                                aria-label={`Delete key ${index}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Tabs.Panel>
          </Tabs>
        </Card.Content>
      </Card>
    </>
  );
};
```

### `ui/src/hooks/use-ai.tsx`

**Exports:** AiProvider, useAi

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
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AiConfig } from '../types/ai-config';
import { ApiService, type UserContext } from '../lib/api';
import { encryptVault } from '../lib/crypto';

/**
 * Interface for the AI Context.
 */
interface AiContextType {
  config: AiConfig | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  userContext: UserContext | null;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateConfig: (newConfig: AiConfig) => Promise<void>;
}

const AiContext = createContext<AiContextType | undefined>(undefined);

/**
 * Provider component for AI configuration state.
 */
export const AiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(!!ApiService.getToken());

  /**
   * Refreshes the configuration from the Worker.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ApiService.fetchConfig();
      setConfig(data);

      // Fetch user context (new)
      try {
        const ctx = await ApiService.fetchUserContext();
        setUserContext(ctx);
      } catch (userContextError) {
        // Legacy mode: assume admin for backwards compatibility
        setUserContext({ username: 'legacy', vaultId: 'legacy', role: 'admin', isLegacy: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      if (err instanceof Error && err.message.includes('authorized')) {
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Logs in with a token.
   */
  const login = async (token: string) => {
    ApiService.setToken(token);
    setIsAuthenticated(true);
    await refresh();
  };

  /**
   * Logs out.
   */
  const logout = () => {
    ApiService.clearToken();
    setIsAuthenticated(false);
    setConfig(null);
  };

  /**
   * Updates the configuration on the Worker.
   * Encrypts the JSON before sending.
   */
  const updateConfig = async (newConfig: AiConfig) => {
    const token = ApiService.getToken();
    if (!token) throw new Error('Not authenticated');

    setLoading(true);
    try {
      const json = JSON.stringify(newConfig);
      const encrypted = await encryptVault(json, token);
      await ApiService.updateVault(encrypted);
      setConfig(newConfig); // Optimistic update or just sync after refresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    }
  }, [isAuthenticated, refresh]);

  return (
    <AiContext.Provider value={{ config, loading, error, isAuthenticated, userContext, login, logout, refresh, updateConfig }}>
      {children}
    </AiContext.Provider>
  );
};

/**
 * Hook to use the AI context.
 */
export const useAi = () => {
  const context = useContext(AiContext);
  if (!context) throw new Error('useAi must be used within an AiProvider');
  return context;
};

```

### `ui/src/hooks/use-playground-conversation.ts`

**Exports:** PlaygroundConversationState, usePlaygroundConversation

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

import { useCallback, useState } from 'react';
import type React from 'react';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTextPart,
} from '../types/playground-types';
import { revokePartObjectUrls } from '../lib/playground/multimodal-files';

export interface PlaygroundConversationState {
  messages: PlaygroundMessage[];
  inputText: string;
  inputParts: PlaygroundPart[];
  resumeFromIndex: number | null;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setInputParts: React.Dispatch<React.SetStateAction<PlaygroundPart[]>>;
  setResumeFromIndex: React.Dispatch<React.SetStateAction<number | null>>;
  /** Returns the history to use as context (honoring resumeFromIndex). */
  getBaseMessages: () => PlaygroundMessage[];
  /** Builds a user message from the current draft, or null if empty. */
  createNextUserMessage: () => PlaygroundMessage | null;
  /** Replaces the entire message array. */
  replaceMessages: (messages: PlaygroundMessage[]) => void;
  /** Appends an assistant message with the given parts. */
  appendAssistantMessage: (nextMessages: PlaygroundMessage[], parts: PlaygroundPart[]) => void;
  /** Clears the text input and input parts (revokes Object URLs). */
  clearDraft: () => void;
  /** Resets to an empty conversation. */
  clearConversation: () => void;
}

/**
 * Manages the conversation history and the current draft (text + attachments).
 */
export const usePlaygroundConversation = (): PlaygroundConversationState => {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputParts, setInputParts] = useState<PlaygroundPart[]>([]);
  const [resumeFromIndex, setResumeFromIndex] = useState<number | null>(null);

  const getBaseMessages = useCallback((): PlaygroundMessage[] => {
    if (resumeFromIndex === null) return messages;
    return messages.slice(0, resumeFromIndex + 1);
  }, [messages, resumeFromIndex]);

  const createNextUserMessage = useCallback((): PlaygroundMessage | null => {
    const textPart: PlaygroundTextPart | null = inputText.trim()
      ? { type: 'text', text: inputText.trim() }
      : null;

    const transcriptionParts: PlaygroundTextPart[] = inputParts
      .filter((part): part is Extract<PlaygroundPart, { type: 'audio' }> => (
        part.type === 'audio' && typeof part.transcription === 'string' && part.transcription.trim().length > 0
      ))
      .map((part) => ({
        type: 'text',
        text: part.transcription!.trim(),
      }));

    const parts: PlaygroundPart[] = [
      ...(textPart ? [textPart] : []),
      ...transcriptionParts,
      ...inputParts,
    ];

    if (parts.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      role: 'user',
      parts,
      timestamp: Date.now(),
    };
  }, [inputText, inputParts]);

  const replaceMessages = useCallback((next: PlaygroundMessage[]) => {
    setMessages(next);
  }, []);

  const appendAssistantMessage = useCallback(
    (nextMessages: PlaygroundMessage[], parts: PlaygroundPart[]) => {
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts,
          timestamp: Date.now(),
        },
      ]);
      setResumeFromIndex(null);
    },
    [],
  );

  const clearDraft = useCallback(() => {
    setInputText('');
    setInputParts((current) => {
      current.forEach(revokePartObjectUrls);
      return [];
    });
  }, []);

  const clearConversation = useCallback(() => {
    setMessages((current) => {
      current.forEach((msg) => msg.parts.forEach(revokePartObjectUrls));
      return [];
    });
    setResumeFromIndex(null);
    clearDraft();
  }, [clearDraft]);

  return {
    messages,
    inputText,
    inputParts,
    resumeFromIndex,
    setInputText,
    setInputParts,
    setResumeFromIndex,
    getBaseMessages,
    createNextUserMessage,
    replaceMessages,
    appendAssistantMessage,
    clearDraft,
    clearConversation,
  };
};
```

### `ui/src/hooks/use-playground-indexed-db.ts`

**Exports:** UsePlaygroundIndexedDbOptions, PlaygroundIndexedDbState, usePlaygroundIndexedDb

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaygroundConversation, PlaygroundMessage } from '../types/playground-types';
import {
  deleteStoredConversation,
  getAllStoredConversations,
  getConversationTitle,
  getStoredConversation,
  saveStoredConversation,
} from '../lib/playground/indexed-db';

export interface UsePlaygroundIndexedDbOptions {
  conversationId: string;
  messages: PlaygroundMessage[];
  initialHistory?: PlaygroundMessage[];
  onMessagesLoaded: (messages: PlaygroundMessage[]) => void;
}

export interface PlaygroundIndexedDbState {
  /** All stored conversations, sorted by updatedAt descending. */
  conversations: PlaygroundConversation[];
  deleteConversation: (id: string) => Promise<void>;
}

/**
 * Persists the active conversation to IndexedDB with a 500 ms debounce.
 * Also maintains a sorted list of all conversations for the history sidebar.
 */
export const usePlaygroundIndexedDb = ({
  conversationId,
  messages,
  initialHistory,
  onMessagesLoaded,
}: UsePlaygroundIndexedDbOptions): PlaygroundIndexedDbState => {
  const [conversations, setConversations] = useState<PlaygroundConversation[]>([]);
  // true while the initial load for the current conversationId is in flight
  const loadingRef = useRef(true);

  const refreshConversations = useCallback(async () => {
    try {
      const all = await getAllStoredConversations();
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(all);
    } catch {
      // IndexedDB unavailable (private browsing, storage quota exceeded, …)
    }
  }, []);

  // Load the conversation whenever conversationId changes
  useEffect(() => {
    loadingRef.current = true;
    let isMounted = true;

    const load = async () => {
      try {
        const stored = await getStoredConversation(conversationId);
        if (!isMounted) return;
        if (stored && stored.messages.length > 0) {
          onMessagesLoaded(stored.messages);
          return;
        }
        if (initialHistory && initialHistory.length > 0) {
          onMessagesLoaded(initialHistory);
        }
      } catch {
        // Silently degrade — the playground still works without persistence
      } finally {
        if (isMounted) loadingRef.current = false;
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [conversationId, initialHistory, onMessagesLoaded]);

  // Populate sidebar on mount
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Debounced save whenever messages change (skip while loading)
  useEffect(() => {
    if (loadingRef.current) return;
    if (messages.length === 0) return;

    const id = conversationId;
    const snapshot = messages;

    const timeout = window.setTimeout(() => {
      const now = Date.now();
      void (async () => {
        try {
          const existing = await getStoredConversation(id);
          await saveStoredConversation({
            id,
            title: getConversationTitle(snapshot),
            messages: snapshot,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          });
          await refreshConversations();
        } catch {
          // Silently degrade
        }
      })();
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [conversationId, messages, refreshConversations]);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await deleteStoredConversation(id);
        await refreshConversations();
      } catch {
        // Silently degrade
      }
    },
    [refreshConversations],
  );

  return { conversations, deleteConversation };
};
```

### `ui/src/hooks/use-playground-request.ts`

**Exports:** SendPlaygroundRequestOptions, PlaygroundRequestState, usePlaygroundRequest

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

import { useCallback, useRef, useState } from 'react';
import type { AiModel, AiProvider } from '../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTtsAudioPart,
} from '../types/playground-types';
import {
  buildDirectChatUrl,
  buildDirectSpeechUrl,
  buildPlaygroundPayload,
  buildPlaygroundSpeechPayload,
  extractAssistantParts,
  extractStreamedAssistantText,
} from '../lib/playground/payload';
import {
  buildMistralConversationsPayload,
  buildMistralConversationsUrl,
  extractMistralConversationsParts,
} from '../lib/playground/mistral-conversations';

export interface SendPlaygroundRequestOptions {
  provider: AiProvider;
  providerKey: string;
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  modelUsage?: AiModel['usage'];
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
  /**
   * When true and the provider is Mistral, routes through /v1/conversations
   * with the image_generation built-in tool enabled.
   */
  enableImageGeneration?: boolean;
}

export interface PlaygroundRequestState {
  isSending: boolean;
  error: string | null;
  sendRequest: (options: SendPlaygroundRequestOptions) => Promise<PlaygroundPart[]>;
  cancelRequest: () => void;
  clearError: () => void;
  setError: (message: string) => void;
}

const isAudioContentType = (contentType: string | null): boolean => {
  if (!contentType) return false;

  const normalized = contentType.toLowerCase();
  return normalized.startsWith('audio/')
    || normalized.includes('application/octet-stream');
};

const extractFilenameFromContentDisposition = (contentDisposition: string | null): string | undefined => {
  if (!contentDisposition) return undefined;

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  return plainMatch?.[1]?.trim();
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

/**
 * Handles the HTTP request lifecycle for a single playground send action.
 * Exposes an AbortController-backed cancel method and streaming SSE parsing.
 */
export const usePlaygroundRequest = (): PlaygroundRequestState => {
  const [isSending, setIsSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
  }, []);

  const clearError = useCallback(() => setErrorState(null), []);
  const setError = useCallback((message: string) => setErrorState(message), []);

  const sendRequest = useCallback(
    async (options: SendPlaygroundRequestOptions): Promise<PlaygroundPart[]> => {
      const {
        provider,
        providerKey,
        modelId,
        systemPrompt,
        messages,
        modelUsage,
        temperature,
        maxTokens,
        topP,
        stream,
        enableImageGeneration,
      } = options;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSending(true);
      setErrorState(null);

      // Mistral conversations API path — used when image generation tool is enabled.
      const useMistralConversations =
        enableImageGeneration === true && provider.protocol === 'mistral';

      try {
        const url = useMistralConversations
          ? buildMistralConversationsUrl(provider)
          : modelUsage === 'tts'
            ? buildDirectSpeechUrl(provider)
            : buildDirectChatUrl(provider);

        const payload = useMistralConversations
          ? buildMistralConversationsPayload({ modelId, systemPrompt, messages, temperature, maxTokens, topP })
          : modelUsage === 'tts'
            ? buildPlaygroundSpeechPayload({ provider, modelId, messages })
            : buildPlaygroundPayload({ modelId, systemPrompt, messages, temperature, maxTokens, topP, stream });

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${providerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type');
        const contentDisposition = response.headers.get('content-disposition');

        if (modelUsage === 'tts' && isAudioContentType(contentType)) {
          const audioBuffer = await response.arrayBuffer();

          if (!response.ok) {
            throw new Error(`Provider failure (${response.status}): audio response could not be processed.`);
          }

          const audioPart: PlaygroundTtsAudioPart = {
            type: 'tts_audio',
            inlineData: {
              mimeType: contentType?.split(';')[0]?.trim() || 'audio/wav',
              data: arrayBufferToBase64(audioBuffer),
            },
            mimeType: contentType?.split(';')[0]?.trim() || 'audio/wav',
            filename: extractFilenameFromContentDisposition(contentDisposition),
          };

          return [audioPart];
        }

        const responseText = await response.text();
        let responseBody: unknown = responseText;

        if (!useMistralConversations && modelUsage !== 'tts') {
          // Streaming: reconstruct full text from SSE deltas.
          const streamPayload = payload as { stream?: boolean };
          if (streamPayload.stream) {
            const streamedText = extractStreamedAssistantText(responseText);
            if (streamedText.length > 0) {
              responseBody = { choices: [{ message: { content: streamedText } }] };
            }
          }
        }

        // Try to parse remaining text as JSON if not already done above.
        if (typeof responseBody === 'string') {
          try {
            responseBody = JSON.parse(responseText);
          } catch {
            // Keep plain text if provider returns non-JSON.
          }
        }

        if (!response.ok) {
          throw new Error(
            typeof responseBody === 'object' && responseBody !== null
              ? JSON.stringify(responseBody)
              : `Provider failure (${response.status}): ${responseText}`,
          );
        }

        return useMistralConversations
          ? extractMistralConversationsParts(responseBody)
          : extractAssistantParts(responseBody);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return [{ type: 'text', text: '[Request cancelled]' }];
        }
        const message = err instanceof Error ? err.message : 'Playground request failed';
        setErrorState(message);
        throw err;
      } finally {
        abortControllerRef.current = null;
        setIsSending(false);
      }
    },
    [],
  );

  return { isSending, error, sendRequest, cancelRequest, clearError, setError };
};
```

### `ui/src/hooks/use-playground-selection.ts`

**Exports:** PlaygroundSelectionState, usePlaygroundSelection

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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { AiConfig, AiModel, AiProvider } from '../types/ai-config';
import { AUTO_ROUND_ROBIN_KEY } from '../lib/playground/constants';

export interface PlaygroundSelectionState {
  providerIds: string[];
  providerId: string;
  modelId: string;
  selectedKey: string;
  provider?: AiProvider;
  activeModel?: AiModel;
  chatModels: AiModel['id'] extends string ? AiModel[] : never;
  usableKeys: AiProvider['keys'];
  lastUsedProviderKey: string;
  setProviderId: React.Dispatch<React.SetStateAction<string>>;
  setModelId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedKey: React.Dispatch<React.SetStateAction<string>>;
  setLastUsedProviderKey: React.Dispatch<React.SetStateAction<string>>;
  setMaxTokens: React.Dispatch<React.SetStateAction<number>>;
  resolveProviderKey: () => string;
  /** Returns the key that would be used after one round-robin advance. */
  resolveNextProviderKey: () => string;
  advanceRoundRobinKey: () => void;
}

/**
 * Manages provider / model / API-key selection state for the playground.
 * Keeps the three selects in sync when the config changes and handles
 * the round-robin key rotation logic.
 */
export const usePlaygroundSelection = (
  config: AiConfig,
  setMaxTokens: React.Dispatch<React.SetStateAction<number>>,
): PlaygroundSelectionState => {
  const providerIds = useMemo(
    () => Object.keys(config.providers).sort(),
    [config.providers],
  );

  const [providerId, setProviderId] = useState<string>(providerIds[0] ?? '');
  const [modelId, setModelId] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string>(AUTO_ROUND_ROBIN_KEY);
  const [autoKeyIndex, setAutoKeyIndex] = useState(0);
  const [lastUsedProviderKey, setLastUsedProviderKey] = useState('');

  const provider = config.providers[providerId];

  const chatModels = useMemo<AiModel[]>(() => {
    if (!provider) return [];
    return provider.models
      .filter((m) => m.usage === 'chat' || (m.outputModalities ?? []).includes('audio'))
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [provider]);

  const usableKeys = useMemo(
    () => (provider ? provider.keys.filter((k) => k.key.trim().length > 0) : []),
    [provider],
  );

  const activeModel = chatModels.find((m) => m.id === modelId);

  // Ensure a valid provider is always selected.
  useEffect(() => {
    if (providerIds.length === 0) return;
    if (!providerId || !config.providers[providerId]) {
      setProviderId(providerIds[0]);
    }
  }, [providerId, providerIds, config.providers]);

  // Reset or update model when the provider changes.
  useEffect(() => {
    if (chatModels.length === 0) { setModelId(''); return; }
    if (!chatModels.some((m) => m.id === modelId)) {
      const first = chatModels[0];
      setModelId(first.id);
      setMaxTokens(Math.min(first.maxOutputTokens, 1024));
    }
  }, [chatModels, modelId, setMaxTokens]);

  // Reset key selection when the currently selected key is removed.
  useEffect(() => {
    if (usableKeys.length === 0) { setSelectedKey(AUTO_ROUND_ROBIN_KEY); return; }
    if (selectedKey !== AUTO_ROUND_ROBIN_KEY && !usableKeys.some((k) => k.key === selectedKey)) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
    }
  }, [usableKeys, selectedKey]);

  const resolveProviderKey = useCallback((): string => {
    if (usableKeys.length === 0) return '';
    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      return usableKeys[autoKeyIndex % usableKeys.length]?.key ?? '';
    }
    return selectedKey;
  }, [autoKeyIndex, selectedKey, usableKeys]);

  const resolveNextProviderKey = useCallback((): string => {
    if (usableKeys.length === 0) return '';
    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      return usableKeys[(autoKeyIndex + 1) % usableKeys.length]?.key ?? '';
    }
    return selectedKey;
  }, [autoKeyIndex, selectedKey, usableKeys]);

  const advanceRoundRobinKey = useCallback(() => {
    if (selectedKey !== AUTO_ROUND_ROBIN_KEY || usableKeys.length === 0) return;
    setAutoKeyIndex((i) => (i + 1) % usableKeys.length);
  }, [selectedKey, usableKeys.length]);

  return {
    providerIds,
    providerId,
    modelId,
    selectedKey,
    provider,
    activeModel,
    chatModels,
    usableKeys,
    lastUsedProviderKey,
    setProviderId,
    setModelId,
    setSelectedKey,
    setLastUsedProviderKey,
    setMaxTokens,
    resolveProviderKey,
    resolveNextProviderKey,
    advanceRoundRobinKey,
  };
};
```

### `ui/src/lib/api.ts`

**Exports:** UserContext, GroupSummary, GroupMember, ApiError, ChatCompletionOptions, ApiService

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
 * @file API client for interacting with the Cloudflare Worker.
 */

import type { AiConfig, UserRole } from '../types/ai-config';
import { decryptAiConfig } from './crypto';

/**
 * User context returned by the /v1/auth/me endpoint.
 */
export interface UserContext {
  username: string;
  vaultId: string;
  role: UserRole;
  isLegacy: boolean;
  groupId?: string;
  groupName?: string;
}

/** A group as returned by GET /v1/groups. */
export interface GroupSummary {
  id: string;
  name: string;
  createdAt: number;
  createdBy?: string;
  legacy: boolean;
  memberCount: number;
}

/** A group member as returned by GET /v1/groups/:id/users. */
export interface GroupMember {
  username: string;
  owner: string;
  role: UserRole;
  keyHint: string | null;
}

/**
 * Interface for API response errors.
 */
export interface ApiError {
  error: string;
  message?: string;
}

export interface ChatCompletionOptions {
  providerKeyMode?: 'auto' | 'manual';
  providerApiKey?: string;
}

/**
 * Service to handle communication with the Worker.
 */
export const ApiService = {
  /**
   * Get the auth token from session storage.
   * @returns The token or null if not set.
   */
  getToken(): string | null {
    return sessionStorage.getItem('ai_vault_token');
  },

  /**
   * Save the auth token to session storage.
   * @param token The token to store.
   */
  setToken(token: string): void {
    sessionStorage.setItem('ai_vault_token', token);
  },

  /**
   * Clear the auth token from session storage.
   */
  clearToken(): void {
    sessionStorage.removeItem('ai_vault_token');
  },

  /**
   * Fetch the decrypted configuration.
   * @returns The AiConfig object.
   * @throws Error if unauthorized or fetch fails.
   */
  async fetchConfig(): Promise<AiConfig> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    // Use the encrypted endpoint to save CPU on the Cloudflare Worker
    const response = await fetch(`${import.meta.env.VAULT_URL}/ai.json.enc`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to fetch config');
    }

    const encryptedConfig = await response.text();
    const decryptedConfig = await decryptAiConfig(encryptedConfig, token);
    return JSON.parse(decryptedConfig) as AiConfig;
  },

  /**
   * Update the encrypted vault.
   * Note: This requires the encrypted payload, which in this UI we assume
   * we manage by re-encrypting or the worker handles the encryption logic
   * if we send it as plain JSON to a specific endpoint.
   *
   * Looking at src/index.ts, PUT /ai.json.enc EXPECTS an encrypted body.
   * But we don't have the encryption logic in the browser easily without the password.
   * Actually, the password IS the token.
   *
   * WAIT: The worker's GET /ai.json decrypts the KV value using the Bearer token.
   * So we can download the decrypted JSON, edit it, and then we need to
   * encrypt it back before PUT /ai.json.enc.
   *
   * I should probably add an encryption utility in the UI that matches the worker's logic.
   */
  async updateVault(encryptedVault: string): Promise<void> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}/ai.json.enc`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: encryptedVault
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to update vault');
    }
  },

  /**
   * Fetch the current user's context information.
   * @returns The user context object.
   * @throws Error if unauthorized or fetch fails.
   */
  async fetchUserContext(): Promise<UserContext> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}/v1/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to fetch user context');
    }

    return await response.json() as UserContext;
  },

  /**
   * Generic authenticated JSON request against the Worker.
   * Throws with the server-provided message on non-2xx responses.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
        'Authorization': `Bearer ${token}`,
      },
    });

    const body = (await response.json().catch(() => ({}))) as T & ApiError;
    if (!response.ok) {
      throw new Error(body.message || body.error || `Request failed with status ${response.status}`);
    }
    return body;
  },

  // ── Group administration ─────────────────────────────────────────

  /** List the groups visible to the caller. */
  async listGroups(): Promise<GroupSummary[]> {
    const body = await this.request<{ data: GroupSummary[] }>('/v1/groups');
    return body.data;
  },

  /** Create a group (superadmin only). */
  async createGroup(name: string, id?: string): Promise<{ id: string; seededFromByok: boolean }> {
    return this.request('/v1/groups', {
      method: 'POST',
      body: JSON.stringify({ name, ...(id ? { id } : {}) }),
    });
  },

  /** Delete a group; force also removes its members (superadmin only). */
  async deleteGroup(groupId: string, force = false): Promise<{ deletedUsers: string[] }> {
    return this.request(`/v1/groups/${encodeURIComponent(groupId)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    });
  },

  /** List the members of a group. */
  async listGroupUsers(groupId: string): Promise<GroupMember[]> {
    const body = await this.request<{ data: GroupMember[] }>(
      `/v1/groups/${encodeURIComponent(groupId)}/users`,
    );
    return body.data;
  },

  /** Create a group member. Returns the generated API key (shown once). */
  async createGroupUser(
    groupId: string,
    username: string,
    role: 'admin' | 'user',
    key?: string,
  ): Promise<{ username: string; role: string; key: string }> {
    return this.request(`/v1/groups/${encodeURIComponent(groupId)}/users`, {
      method: 'POST',
      body: JSON.stringify({ username, role, ...(key ? { key } : {}) }),
    });
  },

  /** Update a member (role change or key regeneration). */
  async updateGroupUser(
    groupId: string,
    username: string,
    update: { role?: 'admin' | 'user'; regenerateKey?: boolean },
  ): Promise<{ username: string; role: string; key?: string }> {
    return this.request(
      `/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(username)}`,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  },

  /** Remove a member from a group. */
  async deleteGroupUser(groupId: string, username: string): Promise<void> {
    await this.request(
      `/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(username)}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Send a chat completion request through the Worker for a specific provider.
   * The optional provider-key headers are consumed by playground-compatible setups.
   */
  async createChatCompletion(
    providerId: string,
    payload: Record<string, unknown>,
    options?: ChatCompletionOptions,
  ): Promise<unknown> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    if (options?.providerKeyMode) {
      headers['X-Provider-Key-Mode'] = options.providerKeyMode;
    }
    if (options?.providerApiKey) {
      headers['X-Provider-Api-Key'] = options.providerApiKey;
    }

    const response = await fetch(`${import.meta.env.VAULT_URL}/${providerId}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let parsedBody: unknown = responseText;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      // Keep raw text for non-json errors and compatibility payloads.
    }

    if (!response.ok) {
      const errorBody = parsedBody as ApiError;
      throw new Error(
        errorBody?.message || errorBody?.error || `Request failed with status ${response.status}`,
      );
    }

    return parsedBody;
  }
};

```

### `ui/src/lib/crypto.ts`

**Exports:** encryptVault, decryptAiConfig

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
 * @file Encryption/Decryption utilities compatible with OpenSSL -aes-256-cbc.
 * Matches the logic in src/lib/ai-enc.ts.
 */

/**
 * Encrypts a string using PBKDF2 and AES-256-CBC, compatible with OpenSSL "Salted__" format.
 *
 * @param plaintext The string to encrypt.
 * @param password The password for derivation.
 * @returns Base64 encoded ciphertext with "Salted__" header.
 */
export async function encryptVault(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const passwordBytes = encoder.encode(password);

  // Generate a random 8-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(8));

  // PBKDF2 derivation
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt,
      iterations: 100_000
    },
    baseKey,
    384 // 256 for key + 128 for IV
  );

  const keyBytes = derivedBits.slice(0, 32);
  const ivBytes = derivedBits.slice(32, 48);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    'AES-CBC',
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: ivBytes },
    aesKey,
    data
  );

  // Construct OpenSSL format: "Salted__" + salt + ciphertext
  const saltedHeader = encoder.encode('Salted__');
  const result = new Uint8Array(saltedHeader.length + salt.length + encrypted.byteLength);
  result.set(saltedHeader, 0);
  result.set(salt, saltedHeader.length);
  result.set(new Uint8Array(encrypted), saltedHeader.length + salt.length);

  // Convert to Base64
  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypts ai.json.enc encrypted with OpenSSL aes-256-cbc format.
 * Matches the logic in src/lib/ai-enc.ts decryptAiConfig function.
 *
 * @param base64Ciphertext Base64 encoded ciphertext with "Salted__" header.
 * @param password The password for decryption.
 * @returns Decrypted string.
 * @throws Error if decryption fails or format is invalid.
 */
export async function decryptAiConfig(
  base64Ciphertext: string,
  password: string,
): Promise<string> {
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

  return new TextDecoder().decode(plaintext);
}

```

### `ui/src/lib/playground/constants.ts`

**Exports:** AUTO_ROUND_ROBIN_KEY, PLAYGROUND_DATABASE_NAME, PLAYGROUND_CONVERSATION_STORE, DEFAULT_CONVERSATION_ID, DEFAULT_SYSTEM_PROMPT, MAX_INLINE_FILE_BYTES, MAX_TEXT_CONTEXT_FILE_BYTES, SUPPORTED_IMAGE_TYPES, SUPPORTED_AUDIO_TYPES, SUPPORTED_VIDEO_TYPES

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

/** Sentinel value for the API key selector meaning "cycle all keys". */
export const AUTO_ROUND_ROBIN_KEY = '__auto_round_robin__';

export const PLAYGROUND_DATABASE_NAME = 'chatbot-playground';
export const PLAYGROUND_CONVERSATION_STORE = 'conversations';
export const DEFAULT_CONVERSATION_ID = 'default';

export const DEFAULT_SYSTEM_PROMPT = 'You are a concise, accurate, and helpful AI assistant.';

/** Maximum size for inline base64 file payloads (8 MB). */
export const MAX_INLINE_FILE_BYTES = 8 * 1024 * 1024;

/** Maximum size for plain-text context files embedded as XML (256 KB). */
export const MAX_TEXT_CONTEXT_FILE_BYTES = 256 * 1024;

export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
] as const;

export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
] as const;
```

### `ui/src/lib/playground/indexed-db.ts`

**Exports:** getStoredConversation, getAllStoredConversations, saveStoredConversation, deleteStoredConversation, getConversationTitle

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import { openDB } from 'idb';
import type { PlaygroundConversation, PlaygroundMessage, PlaygroundPart } from '../../types/playground-types';
import {
  PLAYGROUND_CONVERSATION_STORE,
  PLAYGROUND_DATABASE_NAME,
} from './constants';

const getPlaygroundDb = () =>
  openDB(PLAYGROUND_DATABASE_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PLAYGROUND_CONVERSATION_STORE)) {
        db.createObjectStore(PLAYGROUND_CONVERSATION_STORE, { keyPath: 'id' });
      }
    },
  });

// ---------------------------------------------------------------------------
// Storage sanitisation — blob: Object URLs are session-only and must not
// be persisted. Strip thumbnailUrl before writing to IndexedDB.
// ---------------------------------------------------------------------------

const sanitizePart = (part: PlaygroundPart): PlaygroundPart => {
  if (part.type === 'image' || part.type === 'video') {
    const { thumbnailUrl: _, ...rest } = part as typeof part & { thumbnailUrl?: string };
    return rest as PlaygroundPart;
  }
  return part;
};

const sanitizeMessage = (msg: PlaygroundMessage): PlaygroundMessage => ({
  ...msg,
  parts: msg.parts.map(sanitizePart),
});

// ---------------------------------------------------------------------------
// Public CRUD helpers
// ---------------------------------------------------------------------------

export const getStoredConversation = async (
  conversationId: string,
): Promise<PlaygroundConversation | undefined> => {
  const db = await getPlaygroundDb();
  return db.get(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

export const getAllStoredConversations = async (): Promise<PlaygroundConversation[]> => {
  const db = await getPlaygroundDb();
  return db.getAll(PLAYGROUND_CONVERSATION_STORE);
};

export const saveStoredConversation = async (
  conversation: PlaygroundConversation,
): Promise<void> => {
  const db = await getPlaygroundDb();
  const sanitized: PlaygroundConversation = {
    ...conversation,
    messages: conversation.messages.map(sanitizeMessage),
  };
  await db.put(PLAYGROUND_CONVERSATION_STORE, sanitized);
};

export const deleteStoredConversation = async (
  conversationId: string,
): Promise<void> => {
  const db = await getPlaygroundDb();
  await db.delete(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

// ---------------------------------------------------------------------------
// Title helper — derived from the first user message text part
// ---------------------------------------------------------------------------

export const getConversationTitle = (messages: PlaygroundMessage[]): string => {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') return 'New conversation';
  const raw = text.text.trim();
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw || 'New conversation';
};
```

### `ui/src/lib/playground/mistral-conversations.ts`

**Exports:** buildMistralConversationsUrl, MistralConversationsPayloadOptions, buildMistralConversationsPayload, extractMistralConversationsParts

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

/**
 * Adapter for Mistral's native /v1/conversations endpoint.
 *
 * The conversations API differs from /v1/chat/completions in three ways:
 *  - Body shape: { inputs, tools, completion_args, instructions } instead of
 *    { messages, temperature, … }
 *  - Built-in tools (image_generation) can produce image outputs natively.
 *  - Response shape: { outputs: [ { type: 'tool.execution'|'message.output', … } ] }
 *    where image URLs are nested inside outputs[].info.result (a JSON string).
 */

import type { AiProvider } from '../../types/ai-config';
import type { PlaygroundImagePart, PlaygroundMessage, PlaygroundPart } from '../../types/playground-types';

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/** Derives the /v1/conversations URL from the provider's endpoint. */
export function buildMistralConversationsUrl(provider: AiProvider): string {
  const base = provider.endpoint
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/models$/, '');
  return `${base}/conversations`;
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export interface MistralConversationsPayloadOptions {
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens: number;
  topP: number;
}

/** Converts a PlaygroundPart to plain text for the conversations inputs array. */
function partToText(part: PlaygroundPart): string | null {
  if (part.type === 'text') return part.text;
  if (part.type === 'audio' && part.transcription) return part.transcription;
  if (part.type === 'file' && part.textContent) return part.textContent;
  return null;
}

/**
 * Builds the request body for POST /v1/conversations.
 * Images generated by previous turns are skipped (they live server-side
 * and cannot be re-uploaded to the stateless inputs array).
 */
export function buildMistralConversationsPayload(
  options: MistralConversationsPayloadOptions,
): unknown {
  const { modelId, systemPrompt, messages, temperature, maxTokens, topP } = options;

  const inputs = messages
    .map((msg) => {
      const text = msg.parts
        .map(partToText)
        .filter((t): t is string => t !== null)
        .join('\n\n')
        .trim();
      if (!text) return null;
      return { role: msg.role, content: text };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return {
    model: modelId,
    inputs,
    tools: [{ type: 'image_generation' }],
    completion_args: {
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
    },
    ...(systemPrompt.trim() ? { instructions: systemPrompt.trim() } : {}),
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

/**
 * Parses a /v1/conversations response body into playground parts.
 *
 * Strategy:
 *  1. Scan outputs[] for tool.execution entries whose info.result JSON holds
 *     the generated image URL.
 *  2. Scan outputs[] for message.output entries to extract text and tool_file
 *     items, substituting the collected URL for each tool_file placeholder.
 */
export function extractMistralConversationsParts(body: unknown): PlaygroundPart[] {
  if (typeof body !== 'object' || body === null) {
    return [{ type: 'text', text: 'No response.' }];
  }

  const outputs = (body as JsonRecord)['outputs'];
  if (!Array.isArray(outputs)) return [{ type: 'text', text: 'No response.' }];

  // Pass 1 — collect image URLs from tool executions (in order of appearance).
  const imageUrls: string[] = [];
  for (const raw of outputs) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as JsonRecord;
    if (entry['type'] !== 'tool.execution' || entry['name'] !== 'image_generation') continue;
    const info = entry['info'];
    if (typeof info !== 'object' || info === null) continue;
    const result = (info as JsonRecord)['result'];
    if (typeof result !== 'string') continue;
    try {
      const parsed = JSON.parse(result) as JsonRecord;
      if (typeof parsed['url'] === 'string') imageUrls.push(parsed['url']);
    } catch { /* malformed JSON inside result — skip */ }
  }

  // Pass 2 — build parts from message.output entries.
  const parts: PlaygroundPart[] = [];
  let imageIndex = 0;

  for (const raw of outputs) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as JsonRecord;
    if (entry['type'] !== 'message.output') continue;
    const content = entry['content'];
    if (!Array.isArray(content)) continue;

    for (const rawItem of content) {
      if (typeof rawItem !== 'object' || rawItem === null) continue;
      const item = rawItem as JsonRecord;

      if (item['type'] === 'text' && typeof item['text'] === 'string') {
        const trimmed = (item['text'] as string).trim();
        if (trimmed) parts.push({ type: 'text', text: item['text'] as string });
        continue;
      }

      if (item['type'] === 'tool_file' && item['tool'] === 'image_generation') {
        const url = imageUrls[imageIndex++];
        if (!url) continue;
        const fileName =
          typeof item['file_name'] === 'string'
            ? `${item['file_name']}.${item['file_type'] ?? 'png'}`
            : 'generated_image.png';
        const imagePart: PlaygroundImagePart = {
          type: 'image',
          remoteUrl: url,
          name: fileName,
        };
        parts.push(imagePart);
      }
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: 'No response.' }];
}
```

### `ui/src/lib/playground/multimodal-files.ts`

**Exports:** fileToBase64, fileToText, getFileKind, isInlineable, isTextContextFile, createPartFromFile, createPartsFromFiles, revokePartObjectUrls, formatBytes

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
 * Utilities for converting browser File objects into PlaygroundPart values.
 * Object URLs created here must be revoked by the caller after use.
 */

import type { PlaygroundPart } from '../../types/playground-types';
import {
  MAX_INLINE_FILE_BYTES,
  MAX_TEXT_CONTEXT_FILE_BYTES,
  SUPPORTED_AUDIO_TYPES,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
} from './constants';

/** Converts a File to its base64 data string (no data-URL prefix). */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Reads a File as UTF-8 text, returning null if it fails. */
export const fileToText = async (file: File): Promise<string | null> => {
  try {
    return await file.text();
  } catch {
    return null;
  }
};

/** Returns the PlaygroundPart type that best describes the file's MIME type. */
export const getFileKind = (
  file: File,
): 'image' | 'audio' | 'video' | 'file' => {
  if (SUPPORTED_IMAGE_TYPES.some((t) => file.type === t) || file.type.startsWith('image/')) {
    return 'image';
  }
  if (SUPPORTED_AUDIO_TYPES.some((t) => file.type === t) || file.type.startsWith('audio/')) {
    return 'audio';
  }
  if (SUPPORTED_VIDEO_TYPES.some((t) => file.type === t) || file.type.startsWith('video/')) {
    return 'video';
  }
  return 'file';
};

/** Returns true if the file can be safely encoded as inline base64. */
export const isInlineable = (file: File): boolean =>
  file.size <= MAX_INLINE_FILE_BYTES;

/** Returns true if the file is small enough to embed as plain text context. */
export const isTextContextFile = (file: File): boolean =>
  file.size <= MAX_TEXT_CONTEXT_FILE_BYTES;

/**
 * Converts a browser File into the appropriate PlaygroundPart.
 *
 * - Images, audio, and video become inline base64 parts.
 * - Plain-text files small enough for context become file parts with decoded text.
 * - Large binary files become file parts with base64 data.
 *
 * The caller is responsible for revoking any Object URLs stored in
 * `thumbnailUrl` when the part is removed from state.
 */
export const createPartFromFile = async (file: File): Promise<PlaygroundPart> => {
  const kind = getFileKind(file);

  if (kind === 'image') {
    const data = await fileToBase64(file);
    return {
      type: 'image',
      inlineData: { mimeType: file.type || 'image/png', data },
      name: file.name,
      size: file.size,
      thumbnailUrl: URL.createObjectURL(file),
    };
  }

  if (kind === 'audio') {
    const data = await fileToBase64(file);
    return {
      type: 'audio',
      inlineData: { mimeType: file.type || 'audio/mpeg', data },
      name: file.name,
      size: file.size,
    };
  }

  if (kind === 'video') {
    const data = await fileToBase64(file);
    return {
      type: 'video',
      inlineData: { mimeType: file.type || 'video/mp4', data },
      name: file.name,
      size: file.size,
      thumbnailUrl: URL.createObjectURL(file),
    };
  }

  // Generic file — embed text content when small enough, otherwise base64.
  const isText =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.name.match(/\.(txt|md|csv|json|xml|yaml|yml|toml|ini|env|ts|tsx|js|jsx|py|rs|go|rb|java|c|cpp|h|cs|php|sh|bash)$/i) !== null;

  if (isText && isTextContextFile(file)) {
    const textContent = await fileToText(file);
    return {
      type: 'file',
      inlineData: { mimeType: file.type || 'text/plain', data: '' },
      name: file.name,
      size: file.size,
      textContent: textContent ?? undefined,
    };
  }

  const data = await fileToBase64(file);
  return {
    type: 'file',
    inlineData: { mimeType: file.type || 'application/octet-stream', data },
    name: file.name,
    size: file.size,
  };
};

/** Converts a list of Files to parts, skipping files that exceed the inline size limit. */
export const createPartsFromFiles = async (
  files: File[],
  onSkipped?: (file: File, reason: string) => void,
): Promise<PlaygroundPart[]> => {
  const parts: PlaygroundPart[] = [];
  for (const file of files) {
    if (!isInlineable(file)) {
      onSkipped?.(file, `${file.name} exceeds the ${MAX_INLINE_FILE_BYTES / (1024 * 1024)} MB limit.`);
      continue;
    }
    try {
      parts.push(await createPartFromFile(file));
    } catch {
      onSkipped?.(file, `Could not read ${file.name}.`);
    }
  }
  return parts;
};

/** Revokes any Object URLs embedded in a part's thumbnailUrl. */
export const revokePartObjectUrls = (part: PlaygroundPart): void => {
  if ('thumbnailUrl' in part && typeof part.thumbnailUrl === 'string' && part.thumbnailUrl.startsWith('blob:')) {
    URL.revokeObjectURL(part.thumbnailUrl);
  }
};

/** Formats file size for display. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
```

### `ui/src/lib/playground/payload.ts`

**Exports:** buildDirectChatUrl, buildDirectSpeechUrl, playgroundPartsToText, playgroundPartsToOpenAiContent, BuildPlaygroundPayloadOptions, BuildPlaygroundSpeechPayloadOptions, buildPlaygroundPayload, buildPlaygroundSpeechPayload, estimateTokens, getPartTokenText, getMessageTokenText, extractStreamedAssistantText, extractAssistantText, extractAssistantParts

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
 * Playground payload builders and response parsers.
 * All provider-specific HTTP logic lives here to keep React components clean.
 */

import type { AiProvider } from '../../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTextPart,
  PlaygroundTtsAudioPart,
} from '../../types/playground-types';

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Ensures the provider endpoint resolves to the chat completions path.
 * Handles endpoints that already end with `/chat/completions`, endpoints
 * ending with a versioned segment like `/v1` or `/v1beta`, and plain base URLs.
 */
export const buildDirectChatUrl = (provider: AiProvider): string => {
  const base = provider.endpoint.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (/(?:\/v\d+(?:beta\d*)?)$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
};

/**
 * Ensures the provider endpoint resolves to the OpenAI-compatible speech path.
 */
export const buildDirectSpeechUrl = (provider: AiProvider): string => {
  const base = provider.endpoint.replace(/\/+$/, '');
  if (base.endsWith('/audio/speech')) return base;
  if (/(?:\/v\d+(?:beta\d*)?)$/i.test(base)) return `${base}/audio/speech`;
  return `${base}/v1/audio/speech`;
};

// ---------------------------------------------------------------------------
// Parts → OpenAI content conversion
// ---------------------------------------------------------------------------

/**
 * Converts playground parts to a text-only string.
 * Used as a safe fallback for providers that do not support multimodal content.
 */
export const playgroundPartsToText = (parts: PlaygroundPart[]): string =>
  parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'audio' && part.transcription) return part.transcription;
      if (part.type === 'file' && part.textContent) {
        return `<file name="${part.name}">\n${part.textContent}\n</file>`;
      }
      if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;
      return `[Attached ${part.type}]`;
    })
    .filter(Boolean)
    .join('\n\n');

/**
 * Converts playground parts to the OpenAI multimodal content array format.
 * Falls back to a plain text string when there is only one text part.
 */
export const playgroundPartsToOpenAiContent = (
  parts: PlaygroundPart[],
): string | Array<Record<string, unknown>> => {
  const contentParts = parts.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }];
    }

    if (part.type === 'image') {
      if (part.inlineData) {
        return [{
          type: 'image_url',
          image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
        }];
      }
      if (part.remoteUrl) {
        return [{ type: 'image_url', image_url: { url: part.remoteUrl } }];
      }
      return [{ type: 'text', text: `[Generated image: ${part.name ?? 'image'}]` }];
    }

    if (part.type === 'audio') {
      return [
        ...(part.transcription ? [{ type: 'text', text: part.transcription }] : []),
        {
          type: 'input_audio',
          input_audio: {
            data: part.inlineData.data,
            format: part.inlineData.mimeType.split('/')[1] ?? 'mp3',
          },
        },
      ];
    }

    if (part.type === 'file' && part.textContent) {
      return [{ type: 'text', text: `<file name="${part.name}">\n${part.textContent}\n</file>` }];
    }

    const label = 'name' in part && part.name ? `: ${part.name}` : '';
    return [{ type: 'text', text: `[Attached ${part.type}${label}]` }];
  });

  if (contentParts.length === 0) return '';
  if (contentParts.length === 1 && contentParts[0].type === 'text') {
    return String(contentParts[0].text);
  }
  return contentParts;
};

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export interface BuildPlaygroundPayloadOptions {
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
  /** When true, uses multimodal content parts for image/audio. Default: true. */
  multimodal?: boolean;
}

export interface BuildPlaygroundSpeechPayloadOptions {
  provider: AiProvider;
  modelId: string;
  messages: PlaygroundMessage[];
}

/**
 * Builds the OpenAI-compatible JSON body for a chat completions request.
 */
export const buildPlaygroundPayload = ({
  modelId,
  systemPrompt,
  messages,
  temperature,
  maxTokens,
  topP,
  stream,
  multimodal = true,
}: BuildPlaygroundPayloadOptions) => {
  const requestMessages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: unknown;
  }> = [];

  if (systemPrompt.trim()) {
    requestMessages.push({ role: 'system', content: systemPrompt.trim() });
  }

  const toContent = multimodal ? playgroundPartsToOpenAiContent : playgroundPartsToText;

  requestMessages.push(
    ...messages.map((message) => ({
      role: message.role,
      content: toContent(message.parts),
    })),
  );

  return {
    model: modelId,
    messages: requestMessages,
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream,
  };
};

const resolveDefaultSpeechVoice = (provider: AiProvider, modelId: string): string => {
  const lowerModelId = modelId.toLowerCase();

  if (provider.protocol === 'openai' && lowerModelId.includes('canopylabs/orpheus')) {
    return 'autumn';
  }

  return 'alloy';
};

export const buildPlaygroundSpeechPayload = ({
  provider,
  modelId,
  messages,
}: BuildPlaygroundSpeechPayloadOptions) => {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const input = latestUserMessage ? playgroundPartsToText(latestUserMessage.parts).trim() : '';

  return {
    model: modelId,
    input,
    voice: resolveDefaultSpeechVoice(provider, modelId),
    response_format: 'wav',
  };
};

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough 1-token-per-4-chars estimate — good enough for the context usage bar. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Returns the representative text of a part for token estimation. */
export const getPartTokenText = (part: PlaygroundPart): string => {
  if (part.type === 'text') return part.text;
  if (part.type === 'audio' && part.transcription) return part.transcription;
  if (part.type === 'file' && part.textContent) return part.textContent;
  if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;
  return `[Attached ${part.type}]`;
};

/** Returns the combined token-estimation text for a whole message. */
export const getMessageTokenText = (message: PlaygroundMessage): string =>
  message.parts.map(getPartTokenText).join('\n\n');

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

/**
 * Parses raw SSE text produced by a streaming response into the accumulated
 * assistant text.
 */
export const extractStreamedAssistantText = (rawStream: string): string => {
  const fragments: string[] = [];
  for (const line of rawStream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
        }>;
      };
      const piece =
        payload.choices?.[0]?.delta?.content ??
        payload.choices?.[0]?.message?.content;
      if (typeof piece === 'string' && piece.length > 0) fragments.push(piece);
    } catch {
      // Ignore non-JSON SSE lines.
    }
  }
  return fragments.join('').trim();
};

/**
 * Extracts the assistant text from a standard JSON response body.
 */
export const extractAssistantText = (responseBody: unknown): string => {
  if (typeof responseBody === 'string') return responseBody;
  if (!responseBody || typeof responseBody !== 'object') return 'No usable assistant response.';

  const typed = responseBody as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };

  const content = typed.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    return text || JSON.stringify(responseBody, null, 2);
  }

  return JSON.stringify(responseBody, null, 2);
};

const normalizeAudioMimeType = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) return 'audio/wav';
  return value.includes('/') ? value : `audio/${value}`;
};

const audioPartFromChoiceMessage = (responseBody: unknown): PlaygroundTtsAudioPart | null => {
  if (!responseBody || typeof responseBody !== 'object') return null;

  const typed = responseBody as {
    choices?: Array<{
      message?: {
        audio?: {
          data?: string;
          format?: string;
          mime_type?: string;
          url?: string;
          transcript?: string;
          filename?: string;
        };
        content?: Array<{
          type?: string;
          audio?: {
            data?: string;
            format?: string;
            mime_type?: string;
            url?: string;
            transcript?: string;
            filename?: string;
          };
          audio_url?: { url?: string };
        }>;
      };
    }>;
  };

  const message = typed.choices?.[0]?.message;
  const directAudio = message?.audio;
  if (directAudio && (typeof directAudio.data === 'string' || typeof directAudio.url === 'string')) {
    return {
      type: 'tts_audio',
      ...(typeof directAudio.data === 'string'
        ? {
            inlineData: {
              mimeType: normalizeAudioMimeType(directAudio.mime_type ?? directAudio.format),
              data: directAudio.data,
            },
          }
        : {}),
      ...(typeof directAudio.url === 'string' ? { audioUrl: directAudio.url } : {}),
      ...(typeof directAudio.mime_type === 'string' || typeof directAudio.format === 'string'
        ? { mimeType: normalizeAudioMimeType(directAudio.mime_type ?? directAudio.format) }
        : {}),
      ...(typeof directAudio.filename === 'string' ? { filename: directAudio.filename } : {}),
      ...(typeof directAudio.transcript === 'string' ? { transcript: directAudio.transcript } : {}),
    };
  }

  const contentAudio = Array.isArray(message?.content) ? message.content.find((part) => (
    part?.type === 'output_audio' ||
    part?.type === 'audio' ||
    typeof part?.audio?.data === 'string' ||
    typeof part?.audio?.url === 'string' ||
    typeof part?.audio_url?.url === 'string'
  )) : null;

  if (!contentAudio) return null;

  const audio = contentAudio.audio;
  const remoteUrl = contentAudio.audio_url?.url ?? audio?.url;

  if (audio && typeof audio.data === 'string') {
    return {
      type: 'tts_audio',
      inlineData: {
        mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format),
        data: audio.data,
      },
      ...(typeof remoteUrl === 'string' ? { audioUrl: remoteUrl } : {}),
      ...(typeof audio.mime_type === 'string' || typeof audio.format === 'string'
        ? { mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format) }
        : {}),
      ...(typeof audio.filename === 'string' ? { filename: audio.filename } : {}),
      ...(typeof audio.transcript === 'string' ? { transcript: audio.transcript } : {}),
    };
  }

  if (typeof remoteUrl === 'string') {
    return {
      type: 'tts_audio',
      audioUrl: remoteUrl,
      ...(audio?.mime_type || audio?.format
        ? { mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format) }
        : {}),
      ...(typeof audio?.filename === 'string' ? { filename: audio.filename } : {}),
      ...(typeof audio?.transcript === 'string' ? { transcript: audio.transcript } : {}),
    };
  }

  return null;
};

/**
 * Converts a provider response body into playground parts.
 * Prefers model-generated audio when present, and preserves assistant text when available.
 */
export const extractAssistantParts = (responseBody: unknown): PlaygroundPart[] => {
  const parts: PlaygroundPart[] = [];
  const text = extractAssistantText(responseBody);
  const audioPart = audioPartFromChoiceMessage(responseBody);

  if (text) {
    parts.push({ type: 'text', text } satisfies PlaygroundTextPart);
  }

  if (audioPart) {
    parts.push(audioPart);
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: 'No usable assistant response.' } satisfies PlaygroundTextPart);
  }

  return parts;
};
```

### `ui/src/lib/playground/tts.ts`

**Exports:** speakWithWebSpeech

```typescript
// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

/**
 * Plays text using the browser Web Speech API.
 * This is a fallback when no downloadable TTS provider is injected.
 */
export const speakWithWebSpeech = (text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis is not available in this browser.'));
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(trimmed);

    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Speech synthesis failed.'));

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
```

### `ui/src/lib/provider-models.ts`

**Exports:** SupportedDiscoveryProvider, ProviderModelDiscoveryResult, discoverProviderModels, canDiscoverProviderModels, maskApiKey, renumberPriorities

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
 * @file Provider model discovery for the vault UI.
 *
 * Each provider exposes its catalogue with slightly different response shapes.
 * This module normalises them into the vault's `AiModel` shape, now including
 * `inputModalities` and `outputModalities` using a three-stage pipeline:
 *
 *   B — Provider-specific field mapping (Mistral capabilities, OpenRouter
 *       architecture, Gemini supportedGenerationMethods, Anthropic family).
 *   C — Heuristic ID patterns as a fallback for providers with sparse metadata
 *       (Groq, SambaNova, generic OpenAI-compat proxies).
 *
 * Option D (manual override) is handled in the ConfigModal UI.
 */

import type { AiModel, AiModalityInput, AiModalityOutput, AiProvider } from '../types/ai-config';

/** Providers whose public APIs are explicitly handled by this file. */
export type SupportedDiscoveryProvider =
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'openai'
  | 'morph'
  | 'cohere';

/** Result returned to the UI after a provider catalogue has been normalized. */
export interface ProviderModelDiscoveryResult {
  /** Normalized model records ready to be saved into ai.json. */
  models: AiModel[];
  /** Human-readable notes shown after sync for provider-specific caveats. */
  notes: string[];
}

/** Generic JSON object used to safely inspect provider responses. */
type JsonRecord = Record<string, unknown>;

/**
 * Fetches and normalizes the model catalogue for one provider.
 */
export async function discoverProviderModels(
  providerId: string,
  provider: AiProvider,
  apiKey: string,
  previousModels: AiModel[],
  freeOnly = false,
): Promise<ProviderModelDiscoveryResult> {
  const knownProvider = canonicalProviderId(providerId, provider);

  switch (knownProvider) {
    case 'anthropic':
      return withStablePriority(await fetchAnthropicModels(provider, apiKey), previousModels);
    case 'gemini':
      return withStablePriority(await fetchGeminiModels(provider, apiKey), previousModels);
    case 'mistral':
      return withStablePriority(await fetchMistralModels(provider, apiKey), previousModels);
    case 'openrouter':
      return withStablePriority(await fetchOpenRouterModels(provider, apiKey, freeOnly), previousModels);
    case 'openai':
      return withStablePriority(await fetchOpenAiModels(provider, apiKey), previousModels);
    case 'morph':
      return withStablePriority(await fetchMorphModels(provider, apiKey), previousModels);
    case 'cohere':
      return withStablePriority(await fetchCohereModels(provider, apiKey), previousModels);
    case 'groq':
    case 'sambanova':
      return withStablePriority(
        await fetchOpenAiCompatibleModels(provider, apiKey, knownProvider),
        previousModels,
      );
  }
}

/**
 * Returns true when the UI knows how to query the provider directly.
 */
export function canDiscoverProviderModels(providerId: string, provider: AiProvider): boolean {
  return isSupportedDiscoveryProvider(canonicalProviderId(providerId, provider));
}

/**
 * Builds a compact label for the API key used by the sync action.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Reassigns priorities from the current visual order. */
export function renumberPriorities(models: AiModel[]): AiModel[] {
  return models.map((model, index) => ({ ...model, priority: index * 10 }));
}

/**
 * Infers the provider implementation from the vault key, protocol, endpoint,
 * and gateway prefix.
 */
function canonicalProviderId(
  providerId: string,
  provider: AiProvider,
): SupportedDiscoveryProvider {
  const haystack = [
    providerId,
    provider.protocol,
    provider.endpoint,
    provider.gatewayEndpoint ?? '',
    provider.gatewayModelPrefix ?? '',
  ].join(' ').toLowerCase();

  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic';
  if (haystack.includes('generativelanguage') || haystack.includes('gemini')) return 'gemini';
  if (haystack.includes('mistral')) return 'mistral';
  if (haystack.includes('openrouter')) return 'openrouter';
  if (haystack.includes('sambanova') || haystack.includes('samba')) return 'sambanova';
  if (haystack.includes('groq')) return 'groq';
  if (haystack.includes('morphllm') || /\bmorph\b/.test(haystack)) return 'morph';
  if (haystack.includes('cohere')) return 'cohere';
  return 'openai';
}

function isSupportedDiscoveryProvider(providerId: string): providerId is SupportedDiscoveryProvider {
  return [
    'groq', 'sambanova', 'anthropic', 'gemini', 'mistral', 'openrouter', 'openai', 'morph', 'cohere',
  ].includes(providerId);
}

/**
 * Applies stable priorities after a refresh.
 * Known models keep their existing relative ordering; new models are appended
 * alphabetically with chat models preceding embeddings.
 */
function withStablePriority(
  result: ProviderModelDiscoveryResult,
  previousModels: AiModel[],
): ProviderModelDiscoveryResult {
  const previousOrder = new Map(previousModels.map((m, i) => [m.id, i]));
  const usageOrder: Record<AiModel['usage'], number> = {
    chat: 0,
    transcription: 1,
    tts: 2,
    'image-generation': 3,
    embedding: 4,
  };
  const sorted = [...dedupeModels(result.models)].sort((a, b) => {
    const aKnown = previousOrder.get(a.id);
    const bKnown = previousOrder.get(b.id);
    if (aKnown !== undefined && bKnown !== undefined) return aKnown - bKnown;
    if (aKnown !== undefined) return -1;
    if (bKnown !== undefined) return 1;
    const usageDiff = (usageOrder[a.usage] ?? 99) - (usageOrder[b.usage] ?? 99);
    if (usageDiff !== 0) return usageDiff;
    return a.id.localeCompare(b.id);
  });

  return { models: renumberPriorities(sorted), notes: result.notes };
}

function dedupeModels(models: AiModel[]): AiModel[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

async function fetchJson(url: URL, init: RequestInit, providerName: string): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `${providerName}: ${response.status} ${response.statusText}${errorText ? ` — ${errorText.slice(0, 240)}` : ''}`,
    );
  }
  return response.json();
}

function providerBaseUrl(provider: AiProvider, fallback: string): URL {
  const rawEndpoint = provider.endpoint || fallback;
  const endpoint = rawEndpoint.endsWith('/') ? rawEndpoint.slice(0, -1) : rawEndpoint;
  return new URL(endpoint);
}

function modelsUrl(provider: AiProvider, fallback: string): URL {
  const url = providerBaseUrl(provider, fallback);
  url.pathname = url.pathname
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/embeddings\/?$/, '');
  if (!url.pathname.endsWith('/models')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Option B — Provider-specific field extraction
// ---------------------------------------------------------------------------

async function fetchOpenAiCompatibleModels(
  provider: AiProvider,
  apiKey: string,
  providerName: 'groq' | 'sambanova',
): Promise<ProviderModelDiscoveryResult> {
  const fallback = providerName === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.sambanova.ai/v1';
  const payload = await fetchJson(
    modelsUrl(provider, fallback),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    providerName,
  );
  const models = arrayFromData(payload).map((item) =>
    normalizeFromOpenAiCompatible(item, 'chat'),
  );
  return { models, notes: [] };
}

async function fetchAnthropicModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.anthropic.com/v1'),
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    },
    'anthropic',
  );
  // All Claude 3+ models support vision (image input).
  const models = arrayFromData(payload).map((item) => {
    const id = stringField(item, 'id');
    const limits = anthropicLimits(id);
    return model(
      id,
      'chat',
      limits.contextWindow,
      limits.maxOutputTokens,
      null,
      ['text', 'image'],  // B: Anthropic documents all Claude 3+ as vision-capable
      ['text'],
    );
  });

  return {
    models,
    notes: ['Anthropic does not return limits in /v1/models; limits come from the Claude family table.'],
  };
}

async function fetchGeminiModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const url = modelsUrl(provider, 'https://generativelanguage.googleapis.com/v1beta');
  url.searchParams.set('key', apiKey);
  const payload = await fetchJson(url, {}, 'gemini');
  const records = arrayFromField(payload, 'models');
  const models = records
    .map((item) => {
      const rawName = stringField(item, 'name');
      const id = rawName.replace(/^models\//, '');
      const methods = stringArrayField(item, 'supportedGenerationMethods');
      const isEmbedding =
        methods.some((m) => m.toLowerCase().includes('embed')) ||
        id.toLowerCase().includes('embedding');
      const contextWindow = numberField(item, 'inputTokenLimit') ?? 0;
      const maxOutputTokens = isEmbedding ? 0 : numberField(item, 'outputTokenLimit') ?? 0;
      // B: Gemini API does not return modalities; apply heuristics by family name.
      const { inputModalities, outputModalities } = geminiModalitiesFromId(id);
      return model(
        id,
        isEmbedding ? 'embedding' : 'chat',
        contextWindow,
        maxOutputTokens,
        null,
        isEmbedding ? undefined : inputModalities,
        isEmbedding ? undefined : outputModalities,
      );
    })
    .filter((m) => m.contextWindow > 0);

  return { models, notes: [] };
}

async function fetchMistralModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.mistral.ai/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'mistral',
  );
  const models = arrayFromData(payload)
    .map((item) => {
      const id = stringField(item, 'id');
      const { usage, inputModalities, outputModalities } = mistralCapabilitiesFromItem(item, id);
      const contextWindow = numberField(item, 'max_context_length') ?? 0;
      const maxOutputTokens =
        usage === 'embedding'
          ? 0
          : numberField(item, 'max_output_tokens') ??
            numberField(item, 'max_completion_tokens') ??
            contextWindow;
      return model(id, usage, contextWindow, maxOutputTokens, null, inputModalities, outputModalities);
    })
    .filter((m) => m.contextWindow > 0 || m.usage === 'embedding');

  return {
    models,
    notes: ['Mistral does not always return a distinct output limit; max_context_length is used as fallback.'],
  };
}

async function fetchOpenRouterModels(
  provider: AiProvider,
  apiKey: string,
  freeOnly = false,
): Promise<ProviderModelDiscoveryResult> {
  const url = modelsUrl(provider, 'https://openrouter.ai/api/v1');
  url.searchParams.set('output_modalities', 'all');
  const payload = await fetchJson(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'openrouter',
  );
  const models = arrayFromData(payload)
    .filter((item) => !freeOnly || stringField(item, 'id').includes(':free'))
    .map((item) => {
      const id = stringField(item, 'id');
      const topProvider = recordField(item, 'top_provider');
      const architecture = recordField(item, 'architecture');
      // B: OpenRouter provides explicit modalities in architecture.
      const { usage, inputModalities, outputModalities } = openRouterCapabilitiesFromItem(item, architecture);
      const contextWindow =
        numberField(topProvider, 'context_length') ?? numberField(item, 'context_length') ?? 0;
      const maxOutputTokens =
        usage === 'embedding'
          ? 0
          : numberField(topProvider, 'max_completion_tokens') ??
            numberField(item, 'max_completion_tokens') ??
            contextWindow;

      // Extract additional capabilities from the API response
      const pricing = recordField(item, 'pricing');
      const supportedParameters = stringArrayField(item, 'supported_parameters');

      // Determine support for various features
      const supportsImages = inputModalities?.includes('image') ?? false;
      const supportsPromptCache = numberField(pricing, 'input_cache_read') !== null;
      const supportsTools = supportedParameters.includes('tool_choice') || supportedParameters.includes('tools');
      const supportsReasoning = supportedParameters.includes('structured_outputs') || supportedParameters.includes('reasoning');

      return model(
        id,
        usage,
        contextWindow,
        maxOutputTokens,
        null,
        inputModalities,
        outputModalities,
        supportsImages,
        supportsPromptCache,
        supportsTools,
        supportsReasoning
      );
    });

  return {
    models,
    notes: freeOnly ? ['Only models with ":free" in their name have been synchronized.'] : [],
  };
}

async function fetchOpenAiModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.openai.com/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'openai',
  );
  const models = arrayFromData(payload)
    .map((item) => openAiModelFromId(stringField(item, 'id')))
    .filter((m): m is AiModel => m !== null);

  return {
    models,
    notes: ['OpenAI /v1/models does not return limits; recognized chat/embedding models are enriched from documented limits.'],
  };
}

async function fetchMorphModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.morphllm.com/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'morph',
  );
  const models = arrayFromData(payload)
    .map((item) => morphModelFromId(stringField(item, 'id'), item))
    .filter((m): m is AiModel => m !== null);

  return {
    models,
    notes: ['Morph is enriched by model family when /v1/models does not return limits.'],
  };
}

async function fetchCohereModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.cohere.ai/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'cohere',
  );

  const models = arrayFromField(payload, 'models')
    .map((item) => {
      const id = stringField(item, 'name');
      const endpoints = stringArrayField(item, 'endpoints');
      const features = stringArrayField(item, 'features');
      const contextLength = numberField(item, 'context_length') ?? 0;

      // Determine usage based on endpoints
      let usage: AiModel['usage'] = 'chat';
      if (endpoints.includes('embed') || id.toLowerCase().includes('embed')) {
        usage = 'embedding';
      } else if (endpoints.includes('transcriptions')) {
        usage = 'transcription';
      }

      // Determine input/output modalities based on features
      const inputModalities: AiModalityInput[] = ['text'];
      const outputModalities: AiModalityOutput[] = ['text'];

      if (features.includes('vision')) {
        inputModalities.push('image');
      }
      if (features.includes('tool_images')) {
        outputModalities.push('image');
      }

      return model(
        id,
        usage,
        contextLength,
        contextLength, // Cohere does not provide a separate maxOutputTokens, so use contextLength as a fallback
        null,
        inputModalities,
        outputModalities,
        features.includes('vision'),
        undefined, // supportsPromptCache: Cohere doesn't explicitly return this in /models features
        features.includes('tools'),
        features.includes('reasoning'),
      );
    })
    .filter((m) => m.contextWindow > 0 || m.usage === 'embedding');

  return { models, notes: [] };
}

// ---------------------------------------------------------------------------
// Option C — Heuristic modality inference from model ID
// ---------------------------------------------------------------------------

interface ModalityResult {
  inputModalities: AiModalityInput[];
  outputModalities: AiModalityOutput[];
  usage: AiModel['usage'];
}

/**
 * Infers modalities and usage from the model ID alone.
 * Applied as a fallback when the provider API does not return capability info.
 */
function inferModalitiesFromId(
  id: string,
  defaultUsage: AiModel['usage'] = 'chat',
): ModalityResult {
  const lower = id.toLowerCase();

  // Transcription (audio-in, text-out)
  if (/whisper|transcri/.test(lower)) {
    return { inputModalities: ['audio'], outputModalities: ['text'], usage: 'transcription' };
  }

  // TTS (text-in, audio-out) — voxtral-*-tts, orpheus, tts-1, etc.
  if (/voxtral[^/]*tts|orpheus|^tts[-_]/.test(lower)) {
    return { inputModalities: ['text'], outputModalities: ['audio'], usage: 'tts' };
  }

  // Image generation (text-in, image-out)
  if (/dall[-_]e|stable[-_]diffusion|flux|imagen|image[-_]gen/.test(lower)) {
    return { inputModalities: ['text'], outputModalities: ['image'], usage: 'image-generation' };
  }

  // Voxtral audio chat (text+audio-in, text-out) — not TTS variants
  if (/voxtral/.test(lower)) {
    return { inputModalities: ['text', 'audio'], outputModalities: ['text'], usage: defaultUsage };
  }

  // OCR / document understanding (text+image-in, text-out)
  if (/ocr/.test(lower)) {
    return { inputModalities: ['text', 'image'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Vision / multimodal models
  if (/vision|pixtral|llava|llama-3\.2.*(11b|90b)|llama-4[-_](scout|maverick)|nemotron.*vl|gpt-4o|gpt-5/.test(lower)) {
    return { inputModalities: ['text', 'image'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Gemini multimodal families
  if (/gemini[-_]?2\.|gemini[-_]?1\.5/.test(lower)) {
    return { inputModalities: ['text', 'image', 'audio', 'video'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Default — text only
  return { inputModalities: ['text'], outputModalities: ['text'], usage: defaultUsage };
}

// ---------------------------------------------------------------------------
// Option B helpers — provider-specific capability extraction
// ---------------------------------------------------------------------------

/** Maps Mistral capability fields to playground modalities and usage. */
function mistralCapabilitiesFromItem(
  item: JsonRecord,
  id: string,
): ModalityResult {
  // C fallback: if Mistral did not return a capabilities object at all, use heuristics.
  // But when the capabilities object IS present (even all-false), trust the API — don't
  // let a vision-sounding name override an explicit API "vision: false".
  const hasCapabilitiesObject = isRecord(item['capabilities']);
  if (!hasCapabilitiesObject) {
    return inferModalitiesFromId(id, 'chat');
  }

  const capabilities = recordField(item, 'capabilities');

  // Embedding type check
  if (
    stringField(item, 'type').toLowerCase().includes('embedding') ||
    id.toLowerCase().includes('embed') ||
    capabilities.embedding === true
  ) {
    return { inputModalities: ['text'], outputModalities: ['text'], usage: 'embedding' };
  }

  // B: Use Mistral capability flags directly
  const hasAudioTranscription =
    capabilities.audio_transcription === true ||
    capabilities.audio_transcription_realtime === true;
  const hasAudioSpeech = capabilities.audio_speech === true;
  const hasAudio = capabilities.audio === true;
  const hasVision = capabilities.vision === true || capabilities.ocr === true;

  if (hasAudioTranscription) {
    return { inputModalities: ['audio'], outputModalities: ['text'], usage: 'transcription' };
  }
  if (hasAudioSpeech && !hasAudio) {
    return { inputModalities: ['text'], outputModalities: ['audio'], usage: 'tts' };
  }

  const inputModalities: AiModalityInput[] = ['text'];
  if (hasVision) inputModalities.push('image');
  if (hasAudio || hasAudioSpeech) inputModalities.push('audio');

  const outputModalities: AiModalityOutput[] = ['text'];
  if (hasAudioSpeech) outputModalities.push('audio');

  return { inputModalities, outputModalities, usage: 'chat' };
}

/** Maps OpenRouter architecture fields to playground modalities and usage. */
function openRouterCapabilitiesFromItem(
  item: JsonRecord,
  architecture: JsonRecord,
): ModalityResult {
  const outputMods = stringArrayField(architecture, 'output_modalities');
  const inputMods = stringArrayField(architecture, 'input_modalities');
  const modality = stringField(architecture, 'modality').toLowerCase();
  const id = stringField(item, 'id');

  // Embedding detection
  if (
    outputMods.some((m) => m.toLowerCase().includes('embedding')) ||
    modality.includes('embedding') ||
    id.toLowerCase().includes('embed')
  ) {
    return { inputModalities: ['text'], outputModalities: ['text'], usage: 'embedding' };
  }

  // B: Direct mapping from OpenRouter architecture fields
  if (inputMods.length > 0 || outputMods.length > 0) {
    const inputModalities = mapOpenRouterModalities<AiModalityInput>(
      inputMods,
      ['text', 'image', 'audio', 'video'],
    );
    const outputModalities = mapOpenRouterModalities<AiModalityOutput>(
      outputMods,
      ['text', 'image', 'audio'],
    );

    const hasOnlyAudioOut = outputModalities.length === 1 && outputModalities[0] === 'audio';
    const usage: AiModel['usage'] = hasOnlyAudioOut ? 'tts' : 'chat';

    return {
      inputModalities: inputModalities.length > 0 ? inputModalities : ['text'],
      outputModalities: outputModalities.length > 0 ? outputModalities : ['text'],
      usage,
    };
  }

  // C fallback
  return inferModalitiesFromId(id, 'chat');
}

function mapOpenRouterModalities<T extends string>(
  raw: string[],
  allowed: T[],
): T[] {
  const result: T[] = [];
  for (const entry of raw) {
    const normalized = entry.toLowerCase() as T;
    if (allowed.includes(normalized)) result.push(normalized);
  }
  return result;
}

/** Applies Gemini-family heuristics — the Gemini API does not expose modalities. */
function geminiModalitiesFromId(id: string): { inputModalities: AiModalityInput[]; outputModalities: AiModalityOutput[] } {
  const lower = id.toLowerCase();
  // Gemini 2.x and 1.5 are multimodal
  if (/gemini[-_]?2\.|gemini[-_]?1\.5/.test(lower)) {
    return { inputModalities: ['text', 'image', 'audio', 'video'], outputModalities: ['text'] };
  }
  // Gemini 1.0 Pro — text only
  return { inputModalities: ['text'], outputModalities: ['text'] };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function normalizeFromOpenAiCompatible(
  item: JsonRecord,
  defaultUsage: 'chat' | 'embedding',
): AiModel {
  const id = stringField(item, 'id');
  const { usage, inputModalities, outputModalities } = inferModalitiesFromId(id, defaultUsage);
  const contextWindow =
    numberField(item, 'context_window') ??
    numberField(item, 'context_length') ??
    numberField(item, 'max_context_length') ??
    0;
  const maxOutputTokens =
    usage === 'embedding'
      ? 0
      : numberField(item, 'max_completion_tokens') ??
        numberField(item, 'max_output_tokens') ??
        contextWindow;
  return model(id, usage, contextWindow, maxOutputTokens, null, inputModalities, outputModalities);
}

function model(
  id: string,
  usage: AiModel['usage'],
  contextWindow: number,
  maxOutputTokens: number,
  tpmLimit: number | null,
  inputModalities?: AiModalityInput[],
  outputModalities?: AiModalityOutput[],
  supportsImages?: boolean,
  supportsPromptCache?: boolean,
  supportsTools?: boolean,
  supportsReasoning?: boolean,
): AiModel {
  return {
    id,
    usage,
    contextWindow: Math.max(0, Math.trunc(contextWindow)),
    maxOutputTokens: Math.max(0, Math.trunc(maxOutputTokens)),
    tpmLimit,
    priority: 0,
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
    ...(supportsPromptCache !== undefined ? { supportsPromptCache } : {}),
    ...(supportsTools !== undefined ? { supportsTools } : {}),
    ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
  };
}

function arrayFromData(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  return [];
}

function arrayFromField(payload: unknown, field: string): JsonRecord[] {
  if (isRecord(payload) && Array.isArray(payload[field])) {
    return (payload[field] as unknown[]).filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordField(value: JsonRecord, field: string): JsonRecord {
  const nested = value[field];
  return isRecord(nested) ? nested : {};
}

function stringField(value: JsonRecord, field: string): string {
  const v = value[field];
  return typeof v === 'string' ? v : '';
}

function numberField(value: JsonRecord, field: string): number | null {
  const v = value[field];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringArrayField(value: JsonRecord, field: string): string[] {
  const v = value[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Returns the usage type inferred from a model ID.
 * Non-chat/embedding models now return their specialized usage type instead of null.
 */
function inferUsageFromId(id: string): AiModel['usage'] | null {
  const lower = id.toLowerCase();
  if (lower.includes('embedding') || lower.includes('embed')) return 'embedding';
  if (/whisper|transcri/.test(lower)) return 'transcription';
  if (/voxtral[^/]*tts|orpheus|^tts[-_]/.test(lower)) return 'tts';
  if (/dall[-_]e|stable[-_]diffusion|flux\b|image[-_]gen/.test(lower)) return 'image-generation';
  if (/moderation|rerank|sora/.test(lower)) return null; // still filtered
  return 'chat';
}

function anthropicLimits(id: string): { contextWindow: number; maxOutputTokens: number } {
  if (id.includes('claude-3-7-sonnet')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-sonnet-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-opus-4')) return { contextWindow: 200_000, maxOutputTokens: 32_000 };
  if (id.includes('claude-3-5-haiku')) return { contextWindow: 200_000, maxOutputTokens: 8_192 };
  if (id.includes('claude-3-haiku')) return { contextWindow: 200_000, maxOutputTokens: 4_096 };
  if (id.includes('claude-haiku-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  return { contextWindow: 200_000, maxOutputTokens: 8_192 };
}

function openAiModelFromId(id: string): AiModel | null {
  const usage = inferUsageFromId(id);
  if (!usage) return null;
  const { inputModalities, outputModalities } = inferModalitiesFromId(id, usage === 'chat' ? 'chat' : usage);
  if (usage === 'embedding') return model(id, 'embedding', 8_192, 0, null, ['text'], ['text']);
  if (usage === 'transcription') return model(id, 'transcription', 0, 0, null, inputModalities, outputModalities);
  if (usage === 'tts') return model(id, 'tts', 0, 0, null, inputModalities, outputModalities);
  if (usage === 'image-generation') return model(id, 'image-generation', 0, 0, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-5.2') || id.startsWith('gpt-5.1-codex')) return model(id, 'chat', 400_000, 128_000, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-5')) return model(id, 'chat', 400_000, 128_000, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-4.1')) return model(id, 'chat', 1_047_576, 32_768, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-4o')) return model(id, 'chat', 128_000, 16_384, null, ['text', 'image'], ['text']);
  if (id.startsWith('gpt-4-turbo')) return model(id, 'chat', 128_000, 4_096, null, ['text', 'image'], ['text']);
  if (id.startsWith('gpt-4')) return model(id, 'chat', 8_192, 8_192, null, ['text'], ['text']);
  if (id.startsWith('gpt-3.5-turbo-16k')) return model(id, 'chat', 16_385, 4_096, null, ['text'], ['text']);
  if (id.startsWith('gpt-3.5-turbo')) return model(id, 'chat', 16_385, 4_096, null, ['text'], ['text']);
  if (id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o1')) return model(id, 'chat', 200_000, 100_000, null, ['text'], ['text']);
  if (id.startsWith('gpt-oss')) return model(id, 'chat', 131_072, 131_072, null, ['text'], ['text']);
  return null;
}

function morphModelFromId(id: string, item: JsonRecord): AiModel | null {
  const usage = inferUsageFromId(id);
  if (!usage) return null;
  const contextWindow =
    numberField(item, 'context_window') ??
    numberField(item, 'context_length') ??
    numberField(item, 'max_context_length');
  const maxOutputTokens =
    numberField(item, 'max_completion_tokens') ?? numberField(item, 'max_output_tokens');
  if (usage === 'embedding') return model(id, 'embedding', contextWindow ?? 8_192, 0, null, ['text'], ['text']);
  if (id.includes('dsv4flash')) return model(id, 'chat', contextWindow ?? 393_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
  if (id.startsWith('morph-v3')) return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
  return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
}
```

### `ui/src/lib/utils/file-utils.ts`

**Exports:** MAX_CONTEXT_FILE_BYTES, formatBytes, getFileExtension, makeUniqueFilename, getMarkdownFilename, buildUserContent, messageTokenText, extractGeneratedFiles, validateAiConfigSchema

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
 * File utility functions for handling file operations and formatting.
 */
import type { PlaygroundFile } from '../../types/playground-types';
import type { AiConfig, AiProtocol, CrawlerProtocol } from '../../types/ai-config';

export const MAX_CONTEXT_FILE_BYTES = 256 * 1024;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getFileExtension = (language: string): string => ({
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  html: 'html',
  javascript: 'js',
  js: 'js',
  json: 'json',
  markdown: 'md',
  md: 'md',
  python: 'py',
  sh: 'sh',
  shell: 'sh',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yml',
}[language.toLowerCase()] ?? 'txt');

export const makeUniqueFilename = (filename: string, usedNames: Set<string>): string => {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : '';
  let suffix = 2;
  let candidate = `${basename}-${suffix}${extension}`;

  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${basename}-${suffix}${extension}`;
  }

  usedNames.add(candidate);
  return candidate;
};

export const getMarkdownFilename = (content: string, index: number): string => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${heading || `assistant-response-${index + 1}`}.md`;
};

export const buildUserContent = (prompt: string, files: PlaygroundFile[] = []): string => {
  if (files.length === 0) return prompt;

  const fileContext = files
    .map((file) => [
      `<file name="${file.name}" type="${file.type || 'text/plain'}" size="${file.size}">`,
      file.content,
      '</file>',
    ].join('\n'))
    .join('\n\n');

  return [
    prompt,
    '',
    'Attached context files:',
    fileContext,
  ].join('\n');
};

export const messageTokenText = (message: { content: string; files?: PlaygroundFile[] }): string =>
  buildUserContent(message.content, message.files);

export const extractGeneratedFiles = (content: string) => {
  const files: Array<{ name: string; content: string }> = [];
  const usedNames = new Set<string>();
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = fencePattern.exec(content)) !== null) {
    const info = match[1]?.trim() ?? '';
    const code = match[2] ?? '';
    const filename = info.match(/(?:file(?:name)?|path|title)=["']?([^"'\s]+)["']?/i)?.[1];
    const language = info.split(/\s+/)[0] || 'txt';

    if (filename) {
      files.push({
        name: makeUniqueFilename(filename, usedNames),
        content: code.replace(/\n$/, ''),
      });
    } else {
      files.push({
        name: makeUniqueFilename(`generated-${index + 1}.${getFileExtension(language)}`, usedNames),
        content: code.replace(/\n$/, ''),
      });
    }

    index += 1;
  }

  return files;
};

/**
 * Validates that a parsed JSON object matches the expected AI configuration schema.
 * @param config - The parsed configuration object to validate.
 * @returns True if the configuration is valid, false otherwise.
 */
export const validateAiConfigSchema = (config: any): config is AiConfig => {
  // Check basic structure
  if (typeof config !== 'object' || config === null) return false;
  if (typeof config.version !== 'number') return false;
  if (typeof config.providers !== 'object' || config.providers === null) return false;
  if (typeof config.crawlers !== 'object' || config.crawlers === null) return false;

  // Validate providers
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (typeof providerId !== 'string' || !providerId.trim()) return false;

    // Check provider structure - use type assertion since we're validating
    const providerObj = provider as any;
    if (typeof providerObj !== 'object' || providerObj === null) return false;

    // Validate protocol
    const validProtocols: AiProtocol[] = [
      'openai', 'groq', 'sambanova', 'anthropic', 'gemini',
      'mistral', 'openrouter', 'morph', 'cohere'
    ];
    if (!validProtocols.includes(providerObj.protocol as AiProtocol)) return false;

    // Validate endpoint
    if (typeof providerObj.endpoint !== 'string' || !providerObj.endpoint.trim()) return false;

    // Validate keys array
    if (!Array.isArray(providerObj.keys)) return false;
    for (const key of providerObj.keys) {
      if (typeof key !== 'object' || key === null) return false;
      if (typeof key.key !== 'string' || !key.key.trim()) return false;
      if (key.owner !== undefined && typeof key.owner !== 'string') return false;
      if (key.type !== undefined && !['expired', 'free', 'paid', 'premium', 'unlimited'].includes(key.type)) return false;
    }

    // Validate models array
    if (!Array.isArray(providerObj.models)) return false;
    for (const model of providerObj.models) {
      if (typeof model !== 'object' || model === null) return false;
      if (typeof model.id !== 'string' || !model.id.trim()) return false;
      if (!['chat', 'embedding', 'transcription', 'tts', 'image-generation'].includes(model.usage)) return false;
      if (typeof model.contextWindow !== 'number' || model.contextWindow <= 0) return false;
      if (typeof model.maxOutputTokens !== 'number' || model.maxOutputTokens < 0) return false;
      if (model.tpmLimit !== null && (typeof model.tpmLimit !== 'number' || model.tpmLimit <= 0)) return false;
      if (typeof model.priority !== 'number') return false;

      // Optional fields validation
      if (model.tags !== undefined && (!Array.isArray(model.tags) || !model.tags.every((tag: any) => typeof tag === 'string'))) return false;
      if (model.gatewayPrefix !== undefined && typeof model.gatewayPrefix !== 'string') return false;
      if (model.supportsImages !== undefined && typeof model.supportsImages !== 'boolean') return false;
      if (model.supportsPromptCache !== undefined && typeof model.supportsPromptCache !== 'boolean') return false;
      if (model.supportsTools !== undefined && typeof model.supportsTools !== 'boolean') return false;
      if (model.supportsReasoning !== undefined && typeof model.supportsReasoning !== 'boolean') return false;
      if (model.inputModalities !== undefined && (!Array.isArray(model.inputModalities) || !model.inputModalities.every((modality: any) => ['text', 'image', 'audio', 'video'].includes(modality)))) return false;
      if (model.outputModalities !== undefined && (!Array.isArray(model.outputModalities) || !model.outputModalities.every((modality: any) => ['text', 'image', 'audio'].includes(modality)))) return false;
    }

    // Optional provider fields
    if (providerObj.gatewayEndpoint !== undefined && typeof providerObj.gatewayEndpoint !== 'string') return false;
    if (providerObj.gatewayModelPrefix !== undefined && typeof providerObj.gatewayModelPrefix !== 'string') return false;
    if (providerObj.gatewayKey !== undefined && typeof providerObj.gatewayKey !== 'string') return false;
    if (providerObj.modelCardEndpoint !== undefined && typeof providerObj.modelCardEndpoint !== 'string') return false;
    if (providerObj.userAgent !== undefined && typeof providerObj.userAgent !== 'string') return false;
  }

  // Validate crawlers
  for (const [crawlerId, crawler] of Object.entries(config.crawlers)) {
    if (typeof crawlerId !== 'string' || !crawlerId.trim()) return false;

    // Check crawler structure - use type assertion since we're validating
    const crawlerObj = crawler as any;
    if (typeof crawlerObj !== 'object' || crawlerObj === null) return false;

    // Validate protocol
    const validCrawlerProtocols: CrawlerProtocol[] = ['firecrawl', 'exa', 'scrapegraphai'];
    if (!validCrawlerProtocols.includes(crawlerObj.protocol as CrawlerProtocol)) return false;

    // Validate endpoint
    if (typeof crawlerObj.endpoint !== 'string' || !crawlerObj.endpoint.trim()) return false;

    // Validate keys array
    if (!Array.isArray(crawlerObj.keys)) return false;
    for (const key of crawlerObj.keys) {
      if (typeof key !== 'object' || key === null) return false;
      if (typeof key.key !== 'string' || !key.key.trim()) return false;
      if (key.owner !== undefined && typeof key.owner !== 'string') return false;
      if (key.type !== undefined && !['expired', 'free', 'paid', 'premium', 'unlimited'].includes(key.type)) return false;
    }
  }

  return true;
};
```

### `ui/src/lib/utils/markdown-utils.ts`

**Exports:** createMarkedRenderer, sanitizeRenderedHtml, renderMarkdown

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
 * Markdown rendering and processing utilities.
 */
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import highlightJs from 'highlight.js';

export const createMarkedRenderer = () => new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = highlightJs.getLanguage(lang) ? lang : 'plaintext';
      return highlightJs.highlight(code, { language }).value;
    },
  }),
);

export const sanitizeRenderedHtml = (html: string): string => {
  if (typeof window === 'undefined') return html;

  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, link').forEach((element) => element.remove());
  document.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('vbscript:')) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return document.body.innerHTML;
};

export const renderMarkdown = (content: string, markedRenderer: Marked): string => {
  const rendered = markedRenderer.parse(content);
  return sanitizeRenderedHtml(typeof rendered === 'string' ? rendered : content);
};
```

### `ui/src/main.tsx`

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
 * @file Application entry point.
 * This is the first file executed when the app starts.
 * It mounts the React app into the <div id="root"> in index.html.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AiProvider } from './hooks/use-ai';
import './styles/index.css';

// Mount the React application into the DOM root element.
// React.StrictMode double-invokes renders in development to catch side effects.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* AiProvider wraps the whole app so every component can access vault state */}
    <AiProvider>
      <App />
    </AiProvider>
  </React.StrictMode>
);

```

### `ui/src/styles/index.css`

```css
/**
 * Global stylesheet.
 *
 * HeroUI v3 ships its own CSS bundle that already includes
 * Tailwind CSS v4 via @import "tailwindcss". Importing this single file is
 * enough to get both HeroUI component styles and the full Tailwind utility
 * class set. The @tailwindcss/vite plugin in vite.config.ts processes the
 * @import "tailwindcss" directive at build time.
 */
@import "@heroui/react/styles";
@import "highlight.js/styles/github-dark.css";

.playground-markdown {
  display: grid;
  gap: 0.75rem;
  line-height: 1.65;
}

.playground-markdown :where(h1, h2, h3, h4) {
  font-weight: 700;
  line-height: 1.25;
}

.playground-markdown :where(h1) {
  font-size: 1.25rem;
}

.playground-markdown :where(h2) {
  font-size: 1.1rem;
}

.playground-markdown :where(h3, h4) {
  font-size: 1rem;
}

.playground-markdown :where(p, ul, ol, pre, blockquote, table) {
  margin: 0;
}

.playground-markdown :where(ul, ol) {
  padding-left: 1.25rem;
}

.playground-markdown :where(ul) {
  list-style: disc;
}

.playground-markdown :where(ol) {
  list-style: decimal;
}

.playground-markdown :where(blockquote) {
  border-left: 3px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  padding-left: 0.75rem;
}

.playground-markdown :where(pre) {
  border-radius: 0.375rem;
  overflow: auto;
  padding: 0.75rem;
}

.playground-markdown :where(:not(pre) > code) {
  border-radius: 0.25rem;
  background: hsl(var(--muted) / 0.55);
  padding: 0.1rem 0.3rem;
  font-size: 0.875em;
}

.playground-markdown :where(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.playground-markdown :where(th, td) {
  border: 1px solid hsl(var(--border));
  padding: 0.35rem 0.5rem;
}
```

### `ui/src/types/ai-config.ts`

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

### `ui/src/types/playground-types.ts`

**Exports:** PlaygroundRole, PlaygroundInlineData, PlaygroundTextPart, PlaygroundImagePart, PlaygroundAudioPart, PlaygroundVideoPart, PlaygroundFilePart, PlaygroundCodePart, PlaygroundTtsAudioPart, PlaygroundPart, PlaygroundMessage, PlaygroundConversation, PlaygroundTranscriber, PlaygroundTtsResult, PlaygroundTtsProvider, PlaygroundFile

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
 * Multimodal playground types.
 * Supports text, image, audio, video, file, code, and TTS output parts.
 */

export type PlaygroundRole = 'user' | 'assistant';

export interface PlaygroundInlineData {
  mimeType: string;
  /** Base64-encoded file content (without the data-URL prefix). */
  data: string;
}

export interface PlaygroundTextPart {
  type: 'text';
  text: string;
}

export interface PlaygroundImagePart {
  type: 'image';
  /** Base64-encoded image. Present for user-uploaded images. */
  inlineData?: PlaygroundInlineData;
  /** Remote URL for API-generated images (e.g. Mistral image_generation tool). */
  remoteUrl?: string;
  name?: string;
  size?: number;
  /** Object URL for thumbnail display — must be revoked on unmount. */
  thumbnailUrl?: string;
}

export interface PlaygroundAudioPart {
  type: 'audio';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  /** Text produced by an optional speech-to-text pass. */
  transcription?: string;
}

export interface PlaygroundVideoPart {
  type: 'video';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  /** Object URL for thumbnail display — must be revoked on unmount. */
  thumbnailUrl?: string;
}

export interface PlaygroundFilePart {
  type: 'file';
  inlineData: PlaygroundInlineData;
  name: string;
  size?: number;
  /** Decoded text content for providers that receive files as inline text. */
  textContent?: string;
}

export interface PlaygroundCodePart {
  type: 'code';
  language: string;
  code: string;
  filename?: string;
}

export interface PlaygroundTtsAudioPart {
  type: 'tts_audio';
  /** Base64-encoded audio generated by the model. */
  inlineData?: PlaygroundInlineData;
  /** Remote URL when the provider returns a hosted audio asset. */
  audioUrl?: string;
  mimeType?: string;
  filename?: string;
  /** Optional transcript returned alongside the model-generated audio. */
  transcript?: string;
}

export type PlaygroundPart =
  | PlaygroundTextPart
  | PlaygroundImagePart
  | PlaygroundAudioPart
  | PlaygroundVideoPart
  | PlaygroundFilePart
  | PlaygroundCodePart
  | PlaygroundTtsAudioPart;

export interface PlaygroundMessage {
  id: string;
  role: PlaygroundRole;
  parts: PlaygroundPart[];
  timestamp: number;
}

export interface PlaygroundConversation {
  id: string;
  title: string;
  messages: PlaygroundMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Injected speech-to-text service. The playground calls this for audio parts
 * before sending the message — keeps provider keys server-side.
 */
export type PlaygroundTranscriber = (audio: Blob, file: File) => Promise<string>;

export interface PlaygroundTtsResult {
  audioBlob?: Blob;
  audioUrl?: string;
  mimeType?: string;
}

/**
 * @deprecated Assistant audio playback must come from model-generated `tts_audio`
 * parts, not from a client-side or injected text-to-speech function.
 */
export type PlaygroundTtsProvider = (text: string) => Promise<PlaygroundTtsResult>;

// ---------------------------------------------------------------------------
// Legacy types — kept for backward compatibility with existing code that still
// imports PlaygroundFile / PlaygroundMessage (old shape). The playground panel
// now uses the new PlaygroundMessage shape above.
// ---------------------------------------------------------------------------

/** @deprecated Use PlaygroundFilePart instead. */
export interface PlaygroundFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
}
```

### `ui/test-openrouter-models.js`

```javascript
import { fetchOpenRouterModels } from './src/lib/provider-models.js';

// Mock data simulating OpenRouter API response
const mockOpenRouterResponse = {
  data: [
    {
      id: "mistralai/mistral-medium-3",
      canonical_slug: "mistralai/mistral-medium-3",
      hugging_face_id: "",
      name: "Mistral: Mistral Medium 3",
      created: 1746627341,
      description: "Mistral Medium 3 is a high-performance enterprise-grade language model...",
      context_length: 131072,
      architecture: {
        modality: "text+image+file->text",
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
        tokenizer: "Mistral",
        instruct_type: null
      },
      pricing: {
        prompt: "0.0000004",
        completion: "0.000002",
        input_cache_read: "0.00000004"
      },
      top_provider: {
        context_length: 131072,
        max_completion_tokens: null,
        is_moderated: false
      },
      per_request_limits: null,
      supported_parameters: [
        "frequency_penalty",
        "max_tokens",
        "presence_penalty",
        "response_format",
        "seed",
        "stop",
        "structured_outputs",
        "temperature",
        "tool_choice",
        "tools",
        "top_p"
      ],
      default_parameters: {
        temperature: 0.3
      },
      supported_voices: null,
      knowledge_cutoff: "2025-03-31",
      expiration_date: null,
      links: {
        details: "/api/v1/models/mistralai/mistral-medium-3/endpoints"
      }
    }
  ]
};

// Mock provider configuration
const mockProvider = {
  protocol: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  keys: [{ key: 'test-key', type: 'free' }],
  models: []
};

// Test the function
async function testOpenRouterModels() {
  try {
    // Mock fetch to return our test data
    global.fetch = async (url, options) => {
      return {
        ok: true,
        json: async () => mockOpenRouterResponse
      };
    };

    const result = await fetchOpenRouterModels(mockProvider, 'test-key', false);

    console.log('Test Results:');
    console.log('=============');

    if (result.models.length === 0) {
      console.log('❌ No models returned');
      return;
    }

    const model = result.models[0];
    console.log('Model ID:', model.id);
    console.log('Usage:', model.usage);
    console.log('Context Window:', model.contextWindow);
    console.log('Max Output Tokens:', model.maxOutputTokens);
    console.log('Input Modalities:', model.inputModalities);
    console.log('Output Modalities:', model.outputModalities);
    console.log('Supports Images:', model.supportsImages);
    console.log('Supports Prompt Cache:', model.supportsPromptCache);
    console.log('Supports Tools:', model.supportsTools);
    console.log('Supports Reasoning:', model.supportsReasoning);

    // Verify the new fields are correctly populated
    const expectedValues = {
      supportsImages: true,
      supportsPromptCache: true,
      supportsTools: true,
      supportsReasoning: true
    };

    let allTestsPassed = true;

    for (const [field, expectedValue] of Object.entries(expectedValues)) {
      if (model[field] !== expectedValue) {
        console.log(`❌ ${field}: expected ${expectedValue}, got ${model[field]}`);
        allTestsPassed = false;
      } else {
        console.log(`✅ ${field}: ${model[field]}`);
      }
    }

    if (allTestsPassed) {
      console.log('\\n🎉 All tests passed! The new fields are correctly populated.');
    } else {
      console.log('\\n❌ Some tests failed.');
    }

  } catch (error) {
    console.error('Error running test:', error);
  }
}

// Run the test
testOpenRouterModels();
```

### `ui/tsconfig.json`

```json
{
  "compilerOptions": {
    /* Target modern browsers — matches Vite's default target */
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],

    /* Module resolution */
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* JSX — use the automatic runtime so you don't need to import React */
    "jsx": "react-jsx",

    /* Strict type checking */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "skipLibCheck": true
  },
  "include": ["src", "vite.config.ts"]
}
```

### `ui/vite.config.ts`

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

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VAULT_URL': JSON.stringify(process.env.VAULT_URL || 'https://ai-proxy.inet.pp.ua'),
  },
  plugins: [
    // React plugin enables JSX transform and Fast Refresh in development
    react(),
    // Tailwind CSS v4 Vite plugin — processes @import "tailwindcss" at build time
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias for the `@sctg/cline-llms` package to use the local tarball during development
      '@sctg/cline-chatbot': '@sctg/cline-chatbot',
    },
  },
  optimizeDeps: {
     include: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      external: ['react', 'react-dom'],
    },
  },
  server: {
    port: 3000,
  },
});
```

