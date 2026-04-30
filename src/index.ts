// Copyright (c) 2024-2026 Ronan LE MEILLAT
// License: AGPL-3.0-or-later
//
// AI Proxy Worker — Routes API requests through Cloudflare AI Gateway
// Maintains backward compatibility with legacy endpoints
// Decrypts ai.json.enc and validates user keys via KV

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

import { decryptAiConfig, type AiConfig } from './lib/ai-enc';
import { validateUserKey, extractBearerToken } from './lib/auth';
import { forwardToCfAiGateway, detectProvider } from './lib/gateway';

const AI_JSON_ENC_URL_DEFAULT = 'https://mcp.fufuni.pp.ua/ai.json.enc';
const AI_JSON_ENC_CACHE_KEY = 'cache:ai.json.enc';
const AI_JSON_ENC_CACHE_TTL_SECONDS = 3600;

declare global {
  interface Env {
    KV_AI_PROXY: KVNamespace;
    PROXY_RATE_LIMITER?: any;
    CLOUDFLARE_ACCOUNT_ID: string;
    AI_JSON_CRYPTOKEN: string;
    CLOUDFLARE_AIG_TOKEN: string;
    AI_JSON_ENC_URL?: string;
    DEBUG?: string;
  }
}

type HonoEnv = {
  Bindings: Env;
};

const app = new Hono<HonoEnv>();

// Cache decrypted config per environment
let cachedConfig: AiConfig | null = null;

// ── Middleware ────────────────────────────────────────────────────────

app.use(logger());
app.use('*', cors());

/**
 * Load encrypted ai.json.enc from KV cache or remote URL.
 * Cached in KV for 1 hour to reduce remote fetches.
 */
async function loadEncryptedAiJsonEnc(env: Env): Promise<string> {
  const cached = await env.KV_AI_PROXY.get(AI_JSON_ENC_CACHE_KEY);
  if (cached) return cached;

  const sourceUrl = env.AI_JSON_ENC_URL || AI_JSON_ENC_URL_DEFAULT;
  const response = await fetch(sourceUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Unable to fetch ai.json.enc from ${sourceUrl}: ${response.status}`);
  }

  const encryptedPayload = await response.text();
  if (!encryptedPayload || encryptedPayload.trim().length === 0) {
    throw new Error('Downloaded ai.json.enc is empty');
  }

  await env.KV_AI_PROXY.put(AI_JSON_ENC_CACHE_KEY, encryptedPayload, {
    expirationTtl: AI_JSON_ENC_CACHE_TTL_SECONDS,
  });

  return encryptedPayload;
}

/**
 * Decrypt and cache the AI configuration once.
 */
async function getAiConfig(env: Env): Promise<AiConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const encryptedConfig = await loadEncryptedAiJsonEnc(env);
    cachedConfig = await decryptAiConfig(encryptedConfig, env.AI_JSON_CRYPTOKEN);
    return cachedConfig;
  } catch (err) {
    console.error('Failed to decrypt ai.json.enc:', err);
    throw new Error('Configuration unavailable');
  }
}

/**
 * Validate rate limiting.
 */
async function checkRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const limiter = env.PROXY_RATE_LIMITER;
  if (!limiter) return null;

  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0] ||
    'unknown';

  const url = new URL(request.url);
  const key = `proxy:${ip}:${url.pathname}`;

  try {
    const { success } = await limiter.limit({ key });
    if (success) return null;

    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    });
  } catch (err) {
    console.warn('Rate limiter unavailable:', err);
    return null; // Let request through if limiter fails
  }
}

// ── Routes ────────────────────────────────────────────────────────

/**
 * Health check.
 */
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'ai-proxy-cloudflare' });
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
app.post('*', async (c) => {
  const env = c.env;

  // Check rate limit
  const rateLimitResponse = await checkRateLimit(c.req.raw, env);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Extract and validate authentication
    const authHeader = c.req.header('Authorization');
    const bearerToken = extractBearerToken(authHeader);

    if (!bearerToken) {
      return c.json(
        { error: 'Missing Authorization header' },
        { status: 401 },
      );
    }

    // Validate user key
    const username = await validateUserKey(env.KV_AI_PROXY, bearerToken);
    if (!username) {
      return c.json(
        { error: 'Invalid API key' },
        { status: 403 },
      );
    }

    if (env.DEBUG) {
      console.log(`User [${username}] validated`);
    }

    // Load AI configuration
    const config = await getAiConfig(env);

    // Parse request body
    let payload: any;
    try {
      payload = await c.req.json();
    } catch (err) {
      return c.json(
        { error: 'Invalid JSON payload' },
        { status: 400 },
      );
    }

    // Detect provider from path or X-Host-Final header
    const pathname = new URL(c.req.url).pathname;
    const xHostFinal = c.req.header('X-Host-Final');
    const detected = detectProvider(pathname, xHostFinal, config);

    if (!detected) {
      return c.json(
        {
          error: 'Unable to determine provider. ' +
                 'Use path prefix (/groq/, /sambanova/, /anthropic/, /openai/) ' +
                 'or X-Host-Final header for legacy routes.',
        },
        { status: 400 },
      );
    }

    const { key: providerKey, provider } = detected;

    if (env.DEBUG) {
      console.log(`Provider detected: ${providerKey}`);
    }

    // Validate payload structure
    if (!payload.messages || !Array.isArray(payload.messages)) {
      return c.json(
        { error: 'Missing or invalid messages array' },
        { status: 400 },
      );
    }

    if (!payload.model) {
      return c.json(
        { error: 'Missing model' },
        { status: 400 },
      );
    }

    // Forward to Cloudflare AI Gateway
    const response = await forwardToCfAiGateway(c.req.raw, payload, provider, {
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      aigToken: env.CLOUDFLARE_AIG_TOKEN,
      providerKey,
      debug: env.DEBUG === 'true',
    });

    return response;
  } catch (err) {
    console.error('Proxy error:', err);
    return c.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
});

// ── Fallback ───────────────────────────────────────────────────────

/**
 * 404 handler for unsupported paths/methods.
 */
app.all('*', (c) => {
  return c.json(
    {
      error: 'Not found',
      hint: 'POST to /v1/chat/completions, /groq/v1/chat/completions, etc.',
    },
    { status: 404 },
  );
});

export default app;
