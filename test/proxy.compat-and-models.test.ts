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
// run with `AI_JSON_CRYPTOKEN=04e…d79 npm test`

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, SELF, reset } from 'cloudflare:test';

import aiConfig from '../ai.json';
import users from '../users.json';

const AI_JSON_ENC_KV_KEY = 'vault:ai.json.enc';

type UsersMap = Record<string, { key: string }>;
type AiConfigType = typeof aiConfig;

/**
 * Converts a Uint8Array of bytes to a base64-encoded string.
 * Uses chunked processing to handle large arrays efficiently.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks for efficient processing
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encrypts plaintext using OpenSSL-compatible AES-256-CBC encryption with PBKDF2 key derivation.
 * This mimics the encryption format used by OpenSSL's `enc -aes-256-cbc -pbkdf2 -md sha256 -a`.
 * 
 * @param plaintext - The text to encrypt
 * @param password - The password for key derivation
 * @returns Base64-encoded encrypted data with "Salted__" header
 */
async function encryptOpenSslAes256CbcBase64(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  // Generate random 8-byte salt as required by OpenSSL format
  const salt = crypto.getRandomValues(new Uint8Array(8));

  // Derive key material using PBKDF2 with SHA-256
  const pwBytes = encoder.encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384, // 32 bytes for AES key + 16 bytes for IV = 48 bytes = 384 bits
    ),
  );

  // First 32 bytes are the AES key, next 16 bytes are the IV
  const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-CBC', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: derived.slice(32, 48) },
      aesKey,
      encoder.encode(plaintext),
    ),
  );

  // Build OpenSSL-compatible format: "Salted__" + salt + ciphertext
  const header = new TextEncoder().encode('Salted__');
  const raw = new Uint8Array(header.length + salt.length + ciphertext.length);
  raw.set(header, 0);
  raw.set(salt, header.length);
  raw.set(ciphertext, header.length + salt.length);

  return bytesToBase64(raw);
}

/**
 * Builds a legacy request body for compatibility testing.
 * Uses the old OpenAI API format with specific model name.
 */
function buildLegacyBody(model: string) {
  return {
    messages: [
      { role: 'system', content: 'Compatibility test' },
      { role: 'user', content: 'What is Cloudflare?' },
    ],
    model,
    temperature: 1,
    max_completion_tokens: 8192,
    top_p: 1,
    stream: true,
    stop: null,
  };
}

/**
 * Checks if a provider has at least one non-expired API key.
 * 
 * @param provider - The provider configuration from ai.json
 * @returns true if provider has at least one active (non-expired) key
 */
function hasNonExpiredKey(provider: AiConfigType['providers'][string]) {
  return provider.keys.some((key) => key.type !== 'expired');
}

/**
 * Selects the chat model with the lowest priority value from a provider's model list.
 * Lower priority numbers indicate higher priority (0 = highest priority).
 * 
 * @param provider - The provider configuration from ai.json
 * @returns The chat model with lowest priority, or null if no chat models exist
 */
function selectLowestPriorityChatModel(provider: AiConfigType['providers'][string]) {
  const chatModels = provider.models.filter((model) => model.usage === 'chat');
  if (chatModels.length === 0) {
    return null;
  }

  // Sort by priority ascending (lower number = higher priority)
  // Return the last item (lowest priority/highest number)
  return [...chatModels].sort((left, right) => left.priority - right.priority)[0];
}

function isProxyRoutableUsage(usage: AiConfigType['providers'][string]['models'][number]['usage']) {
  return usage === 'chat' || usage === 'tts';
}

describe('ai-proxy worker compatibility and model routing', () => {
  const originalFetch = globalThis.fetch;
  const usersMap = users as UsersMap;
  const validUserToken = usersMap.user094?.key;
  const cryptoToken = String((env as { AI_JSON_CRYPTOKEN?: string }).AI_JSON_CRYPTOKEN ?? '');

  if (!validUserToken) {
    throw new Error('Expected users.json to contain user094 token for compatibility tests');
  }

  beforeAll(async () => {
    await reset();

    if (!cryptoToken) {
      throw new Error('Missing AI_JSON_CRYPTOKEN in test environment');
    }

    // Seed user validation dataset in KV
    await env.KV_AI_PROXY.put('users', JSON.stringify(usersMap));

    // Seed encrypted ai.json.enc into KV to avoid network dependency
    // This simulates the production setup where ai.json is encrypted in KV
    const encrypted = await encryptOpenSslAes256CbcBase64(JSON.stringify(aiConfig), cryptoToken);
    await env.KV_AI_PROXY.put(AI_JSON_ENC_KV_KEY, encrypted, { expirationTtl: 3600 });
  });

  /**
   * Creates a mock Server-Sent Events (SSE) stream for testing streaming responses.
   * Simulates a typical AI API streaming response with a completion chunk and DONE marker.
   */
  function makeSseStream(model: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const chunks = [
      `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] })}\n\n`,
      'data: [DONE]\n\n',
    ];
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(env.PROXY_RATE_LIMITER, 'limit').mockResolvedValue({ success: true } as Awaited<ReturnType<typeof env.PROXY_RATE_LIMITER.limit>>);
    // Mock global fetch to intercept outbound requests to Cloudflare AI Gateway
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      // Ensure all outbound requests go to the expected AI Gateway
      if (!url.startsWith('https://gateway.ai.cloudflare.com/')) {
        return new Response(JSON.stringify({ error: `unexpected outbound URL: ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : {};

      // Handle streaming responses
      if (body.stream === true) {
        return new Response(makeSseStream(body.model), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      // Handle non-streaming responses
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }));
  });

  it('reste compatible avec /openai/v1/chat/completions (X-Host-Final: api.groq.com)', async () => {
    const req = new Request('https://ai-proxy.inet.pp.ua/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validUserToken}`,
        'X-Host-Final': 'api.groq.com',
      },
      body: JSON.stringify(buildLegacyBody('meta-llama/llama-4-scout-17b-16e-instruct')),
    });

    const res = await SELF.fetch(req);

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const outboundUrl = String(gatewayCall[0]);
    const outboundBody = JSON.parse(String(gatewayCall[1]?.body));

    // Verify the request is routed to the correct gateway endpoint
    expect(outboundUrl).toContain('/v1/');
    expect(outboundUrl).toContain('/compat/chat/completions');
    // Verify model name is prefixed with provider for gateway routing
    expect(outboundBody.model).toBe('groq/meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('reste compatible avec /v1/chat/completions (X-Host-Final: api.sambanova.ai)', async () => {
    const req = new Request('https://ai-proxy.inet.pp.ua/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validUserToken}`,
        'X-Host-Final': 'api.sambanova.ai',
      },
      body: JSON.stringify(buildLegacyBody('Meta-Llama-3.3-70B-Instruct')),
    });

    const res = await SELF.fetch(req);

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const outboundBody = JSON.parse(String(gatewayCall[1]?.body));

    // Verify model is prefixed with custom-sambanova/ for gateway routing
    expect(outboundBody.model).toBe('custom-sambanova/Meta-Llama-3.3-70B-Instruct');
  });

  it('route tous les modèles déclarés dans ai.json via la gateway avec préfixe provider', async () => {
    const config = aiConfig as AiConfigType;

    // Test every gateway-backed chat/tts model to ensure proper routing
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (!provider.gatewayEndpoint || !provider.gatewayModelPrefix) {
        continue;
      }

      for (const model of provider.models) {
        if (!isProxyRoutableUsage(model.usage)) {
          continue;
        }

        vi.mocked(globalThis.fetch).mockClear();

        const isTts = model.usage === 'tts';
        const routePath = isTts ? 'audio/speech' : 'chat/completions';
        const requestBody = isTts
          ? {
              model: model.id,
              input: `validate ${providerKey}/${model.id}`,
            }
          : {
              model: model.id,
              messages: [{ role: 'user', content: `validate ${providerKey}/${model.id}` }],
              stream: false,
            };

        const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/${routePath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${validUserToken}`,
          },
          body: JSON.stringify(requestBody),
        });

        const res = await SELF.fetch(req);
        const bodyText = await res.text();

        expect(res.status, `${providerKey}/${model.id} => ${bodyText}`).toBe(200);
        expect(globalThis.fetch, `${providerKey}/${model.id} should call gateway once`).toHaveBeenCalledTimes(1);

        const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
        const outboundUrl = String(gatewayCall[0]);
        const outboundBody = JSON.parse(String(gatewayCall[1]?.body));
        const expectedModel = model.id.startsWith(`${provider.gatewayModelPrefix}/`)
          ? model.id
          : `${provider.gatewayModelPrefix}/${model.id}`;

        expect(outboundUrl).toContain(isTts ? '/compat/audio/speech' : '/compat/chat/completions');
        expect(outboundBody.model).toBe(expectedModel);
      }
    }
  });

  it('interroge le modèle de chat à priorité minimale pour chaque provider avec clés non expirées', async () => {
    const config = aiConfig as AiConfigType;

    // Test the lowest priority chat model for each gateway-backed provider with active keys
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (!hasNonExpiredKey(provider) || !provider.gatewayEndpoint || !provider.gatewayModelPrefix) {
        continue; // Skip providers with only expired keys or without gateway routing
      }

      const model = selectLowestPriorityChatModel(provider);
      if (!model) {
        continue; // Skip providers without chat models
      }

      vi.mocked(globalThis.fetch).mockClear();

      const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validUserToken}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: 'system', content: 'Priority smoke test' },
            { role: 'user', content: `Ping ${providerKey}` },
          ],
          stream: false,
        }),
      });

      const res = await SELF.fetch(req);
      const bodyText = await res.text();

      expect(res.status, `${providerKey}/${model.id} => ${bodyText}`).toBe(200);
      expect(globalThis.fetch, `${providerKey}/${model.id} should call gateway once`).toHaveBeenCalledTimes(1);

      const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const outboundBody = JSON.parse(String(gatewayCall[1]?.body));
      const expectedModel = model.id.startsWith(`${provider.gatewayModelPrefix}/`)
        ? model.id
        : `${provider.gatewayModelPrefix}/${model.id}`;

      expect(outboundBody.model).toBe(expectedModel);
    }
  });

  it('liste les providers avec au moins une clé non expirée via /v1/providers', async () => {
    const config = aiConfig as AiConfigType;
    // Build expected provider list: only providers with at least one non-expired key
    const expectedProviders = Object.entries(config.providers)
      .filter(([, provider]) => provider.keys.some((key) => key.type !== 'expired'))
      .map(([id, provider]) => ({ id, object: 'provider', protocol: provider.protocol }));

    const req = new Request('https://ai-proxy.inet.pp.ua/v1/providers', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${validUserToken}`,
      },
    });

    const res = await SELF.fetch(req);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ object: 'list', data: expectedProviders });
  });

  it('retourne les modèles OpenAI-compatibles pour un provider via /:provider/v1/models', async () => {
    const config = aiConfig as AiConfigType;
    const [providerKey, provider] = Object.entries(config.providers)[0];
    // Build OpenAI-compatible model list response
    const expectedModels = provider.models.map((model) => ({
      id: model.id,
      object: 'model',
      created: 0, // Hardcoded timestamp for compatibility
      owned_by: providerKey,
      context_window: model.contextWindow,
      context_length: model.contextWindow, // Duplicate for compatibility
      max_completion_tokens: model.maxOutputTokens,
    }));

    const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${validUserToken}`,
      },
    });

    const res = await SELF.fetch(req);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ object: 'list', data: expectedModels });
  });

  it('retourne les métadonnées du modèle via /:provider/v1/models/:modelId', async () => {
    const config = aiConfig as AiConfigType;
    const [providerKey, provider] = Object.entries(config.providers)[0];
    const model = provider.models[0];

    const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/models/${encodeURIComponent(model.id)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${validUserToken}`,
      },
    });

    const res = await SELF.fetch(req);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: providerKey,
      context_window: model.contextWindow,
      context_length: model.contextWindow,
      max_completion_tokens: model.maxOutputTokens,
    });
  });

  it('refuse une clé utilisateur invalide', async () => {
    const req = new Request('https://ai-proxy.inet.pp.ua/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token',
        'X-Host-Final': 'api.groq.com',
      },
      body: JSON.stringify(buildLegacyBody('meta-llama/llama-4-scout-17b-16e-instruct')),
    });

    const res = await SELF.fetch(req);

    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('streams an SSE response when stream: true is sent to /:provider/v1/chat/completions', async () => {
    const config = aiConfig as AiConfigType;
    // Find first provider with non-expired keys
    const [providerKey, provider] = Object.entries(config.providers).find(
      ([, p]) => p.keys.some((k) => k.type !== 'expired'),
    )!;
    // Prefer chat models, fall back to any model
    const model = provider.models.find((m) => m.usage === 'chat') ?? provider.models[0];

    const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validUserToken}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    const res = await SELF.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data:');
    expect(text).toContain('[DONE]');

    // Verify stream: true was forwarded to the gateway
    const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const outboundBody = JSON.parse(String(gatewayCall[1]?.body));
    expect(outboundBody.stream).toBe(true);
  });

  it('forwards stream_options to the gateway when stream: true', async () => {
    const config = aiConfig as AiConfigType;
    // Find first provider with non-expired keys
    const [providerKey, provider] = Object.entries(config.providers).find(
      ([, p]) => p.keys.some((k) => k.type !== 'expired'),
    )!;
    // Prefer chat models, fall back to any model
    const model = provider.models.find((m) => m.usage === 'chat') ?? provider.models[0];

    const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validUserToken}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);

    const gatewayCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const outboundBody = JSON.parse(String(gatewayCall[1]?.body));
    expect(outboundBody.stream).toBe(true);
    expect(outboundBody.stream_options).toEqual({ include_usage: true });
  });

  afterAll(() => {
    vi.stubGlobal('fetch', originalFetch);
  });
});
