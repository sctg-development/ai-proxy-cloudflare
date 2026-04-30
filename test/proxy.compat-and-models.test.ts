import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, SELF, reset } from 'cloudflare:test';

import aiConfig from '../ai.json';
import users from '../users.json';

const AI_JSON_ENC_CACHE_KEY = 'cache:ai.json.enc';

type UsersMap = Record<string, { key: string }>;
type AiConfigType = typeof aiConfig;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function encryptOpenSslAes256CbcBase64(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(8));

  const pwBytes = encoder.encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384,
    ),
  );

  const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-CBC', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: derived.slice(32, 48) },
      aesKey,
      encoder.encode(plaintext),
    ),
  );

  const header = new TextEncoder().encode('Salted__');
  const raw = new Uint8Array(header.length + salt.length + ciphertext.length);
  raw.set(header, 0);
  raw.set(salt, header.length);
  raw.set(ciphertext, header.length + salt.length);

  return bytesToBase64(raw);
}

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

function hasNonExpiredKey(provider: AiConfigType['providers'][string]) {
  return provider.keys.some((key) => key.type !== 'expired');
}

function selectLowestPriorityChatModel(provider: AiConfigType['providers'][string]) {
  const chatModels = provider.models.filter((model) => model.usage === 'chat');
  if (chatModels.length === 0) {
    return null;
  }

  return [...chatModels].sort((left, right) => left.priority - right.priority)[0];
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

    // Seed encrypted ai.json.enc into KV cache to avoid network dependency
    const encrypted = await encryptOpenSslAes256CbcBase64(JSON.stringify(aiConfig), cryptoToken);
    await env.KV_AI_PROXY.put(AI_JSON_ENC_CACHE_KEY, encrypted, { expirationTtl: 3600 });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (!url.startsWith('https://gateway.ai.cloudflare.com/')) {
        return new Response(JSON.stringify({ error: `unexpected outbound URL: ${url}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : {};
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

    expect(outboundUrl).toContain('/v1/');
    expect(outboundUrl).toContain('/compat/chat/completions');
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

    expect(outboundBody.model).toBe('custom-sambanova/Meta-Llama-3.3-70B-Instruct');
  });

  it('route tous les modèles déclarés dans ai.json via la gateway avec préfixe provider', async () => {
    const config = aiConfig as AiConfigType;

    for (const [providerKey, provider] of Object.entries(config.providers)) {
      for (const model of provider.models) {
        vi.mocked(globalThis.fetch).mockClear();

        const req = new Request(`https://ai-proxy.inet.pp.ua/${providerKey}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${validUserToken}`,
          },
          body: JSON.stringify({
            model: model.id,
            messages: [{ role: 'user', content: `validate ${providerKey}/${model.id}` }],
            stream: false,
          }),
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

        expect(outboundUrl).toContain('/compat/chat/completions');
        expect(outboundBody.model).toBe(expectedModel);
      }
    }
  });

  it('interroge le modèle de chat à priorité minimale pour chaque provider avec clés non expirées', async () => {
    const config = aiConfig as AiConfigType;

    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (!hasNonExpiredKey(provider)) {
        continue;
      }

      const model = selectLowestPriorityChatModel(provider);
      if (!model) {
        continue;
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

  afterAll(() => {
    vi.stubGlobal('fetch', originalFetch);
  });
});
