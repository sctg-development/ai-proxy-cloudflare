# AI Proxy Cloudflare Worker v2.0

Modern proxy to route API requests through the **Cloudflare AI Gateway**.

## 🚀 Features

- ✅ **On-the-fly decryption** of `ai.json.enc` when the worker starts (embedded in the bundle)
- ✅ **User validation** using keys stored in KV (`users` key)
- ✅ **Multi-provider routing** (Groq, SambaNova, Anthropic, OpenAI, Gemini)
- ✅ **Backward compatibility** with both legacy request formats
- ✅ **Forwarding through Cloudflare AI Gateway** with automatic model ID prefixing
- ✅ Optional **rate limiting** via Durable Objects
- ✅ Preconfigured **CORS**
- ✅ Transparent **streaming** support
- ✅ **Build automation** — `ai.json.enc` is automatically converted to TypeScript

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

### 3. Initialize KV with users

Load valid users into KV (`KV_AI_PROXY`), key `users`:

```bash
wrangler kv:key put users '{"ronan":{"key":"AGE-SECRET-KEY-..."},"audrey":{"key":"AGE-SECRET-KEY-..."},...}' --namespace-id=0f6936bc4d9b4d5fa1cc85acd757e354
```

For development, keys are read from `users.json` if KV is empty.

---

## 📨 Usage

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
1. **Path prefix** (priority): `/groq/`, `/sambanova/`, `/anthropic/`, `/openai/`, `/gemini/`
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
