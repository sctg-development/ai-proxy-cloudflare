# AI Proxy Cloudflare Worker v2.0

Proxy moderne pour router des requêtes API à travers la **Cloudflare AI Gateway**.

## 🚀 Fonctionnalités

- ✅ **Décryptage on-the-fly** de `ai.json.enc` au démarrage du worker (embarqué dans le bundle)
- ✅ **Validation des utilisateurs** via clés stockées dans KV (`users` key)
- ✅ **Routage multi-provider** (Groq, SambaNova, Anthropic, OpenAI, Gemini)
- ✅ **Compatibilité ascendante** avec les deux formats de requête legacy
- ✅ **Forwarding via Cloudflare AI Gateway** avec préfixage automatique des model IDs
- ✅ **Rate limiting** optionnel via Durable Objects
- ✅ **CORS** pré-configuré
- ✅ **Streaming** support transparent
- ✅ **Build automation** — `ai.json.enc` convertit automatiquement en TypeScript

## 📋 Configuration requise

### 1. Créer `.dev.vars` pour le développement

```bash
cp .dev.vars.example .dev.vars
# Remplir les valeurs :
# - CLOUDFLARE_ACCOUNT_ID
# - AI_JSON_CRYPTOKEN (token de déchiffrage de ai.json.enc)
# - CLOUDFLARE_AIG_TOKEN (token Cloudflare AI Gateway)
```

### 2. Préparer ai.json.enc

Le fichier `src/config/ai.json.enc` doit être:
- Chiffré avec `openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000`
- Utiliser le même `CRYPTOKEN` que la variable env `AI_JSON_CRYPTOKEN`
- Contenir un JSON valide avec structure `AiConfig`:

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

### 3. Initialiser KV avec les utilisateurs

Charger les utilisateurs valides dans KV (`KV_AI_PROXY`), clé `users`:

```bash
wrangler kv:key put users '{"ronan":{"key":"AGE-SECRET-KEY-..."},"audrey":{"key":"AGE-SECRET-KEY-..."},...}' --namespace-id=0f6936bc4d9b4d5fa1cc85acd757e354
```

Ou pour le développement, les clés sont lues depuis `users.json` si KV est vide.

---

## 📨 Utilisation

### Requête moderne (préféré)

```bash
curl -X POST https://ai-proxy.inet.pp.ua/groq/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AGE-SECRET-KEY-..." \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Bonjour!"}]
  }'
```

### Requête legacy (compatibilité)

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

### Routage par provider

Le proxy détecte le provider via:
1. **Préfixe de path** (priorité): `/groq/`, `/sambanova/`, `/anthropic/`, `/openai/`, `/gemini/`
2. **Header `X-Host-Final`** (fallback): `api.groq.com`, `api.sambanova.ai`, etc.

Si ni l'un ni l'autre ne peut être déterminé → erreur 400.

---

## 🔄 Flux de forwarding

```
Requête client
    ↓
[Validation Bearer token]
    ↓
[Décryptage ai.json.enc] (cached)
    ↓
[Détection du provider]
    ↓
[Sélection clé API du provider] (round-robin)
    ↓
[Préfixage model ID pour gateway]
    ↓
Cloudflare AI Gateway
    ↓
Provider final (Groq, SambaNova, etc.)
```

---

## 🛠 Développement

### Démarrer le serveur local

```bash
npm run dev
# Écoute sur http://localhost:8787
# Exécute automatiquement: scripts/embed-config.js → src/lib/embedded-config.ts
```

### Déployer

```bash
npm run deploy
```

### Tests

```bash
npm test
```

### Build & Embedding

Le script `scripts/embed-config.js` exécute automatiquement **avant chaque build/dev**:
1. Lit `src/config/ai.json.enc` (fichier binaire chiffré)
2. Le convertit en string JSON
3. Génère `src/lib/embedded-config.ts` avec le contenu
4. Importe ce contenu dans `src/index.ts`
5. Wrangler embarque le tout dans le worker bundle

Ce processus évite d'avoir à gérer les assets fichier au runtime.

Forcer la régénération:
```bash
node scripts/embed-config.js
```

---

## 📝 Exemples sample_request.sh

Le fichier `sample_request.sh` contient deux exemples fonctionnels:

1. **Route `/openai/v1/chat/completions`** avec `X-Host-Final: api.groq.com`
2. **Route `/v1/chat/completions`** avec `X-Host-Final: api.sambanova.ai`

Lancer les exemples:

```bash
source .dev.vars
./sample_request.sh
```

(Remplacer les clés par des vraies clés d'utilisateurs dans `users.json`)

---

## 🔐 Chiffrement ai.json.enc

### Créer ai.json.enc

```bash
# 1. Créer ai.json avec la structure AiConfig
cat > ai.json << 'EOF'
{
  "version": 1,
  "providers": { ... }
}
EOF

# 2. Chiffrer avec openssl
CRYPTOKEN="votre_token_secret"
openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
  -in ai.json -out ai.json.enc -pass pass:"$CRYPTOKEN"

# 3. Copier dans src/config/
cp ai.json.enc src/config/ai.json.enc

# 4. Supprimer le fichier en clair
rm ai.json
```

### Déchiffrer (manuel)

```bash
openssl enc -d -aes-256-cbc -a -in ai.json.enc -pass pass:"$CRYPTOKEN" -out ai.json
```

---

## 📂 Structure du projet

```
ai-proxy-cloudflare/
├── src/
│   ├── index.ts           # Hono app principale
│   ├── config/
│   │   └── ai.json.enc    # Config chiffré (bundled)
│   └── lib/
│       ├── ai-enc.ts      # Décryptage & helpers
│       ├── auth.ts        # Validation Bearer token
│       └── gateway.ts     # Forwarding vers Cloudflare AI Gateway
├── wrangler.jsonc         # Config Cloudflare Workers
├── package.json
├── tsconfig.json
├── .dev.vars.example
└── sample_request.sh
```

---

## 🔑 Variables d'environnement

| Var | Origine | Description |
|-----|---------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | .dev.vars / Wrangler secret | Votre ID compte Cloudflare |
| `AI_JSON_CRYPTOKEN` | .dev.vars / Wrangler secret | Token de déchiffrage de ai.json.enc |
| `CLOUDFLARE_AIG_TOKEN` | .dev.vars / Wrangler secret | Token Cloudflare AI Gateway |
| `DEBUG` | .dev.vars (optionnel) | `true` pour logs détaillés |

Pour deployer en production:

```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put AI_JSON_CRYPTOKEN
wrangler secret put CLOUDFLARE_AIG_TOKEN
```

---

## 🧪 Tests

Voir `vitest.config.mts` pour la configuration des tests.

```bash
npm test
```

---

## 📜 Licence

AGPL-3.0-or-later

Copyright © 2024-2026 Ronan LE MEILLAT
