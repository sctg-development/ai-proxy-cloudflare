# AI Proxy Cloudflare Worker v2.2

Modern proxy to route API requests through the **Cloudflare AI Gateway**.

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
