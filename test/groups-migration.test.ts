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
// v2 (multi-group) lazy migration: default group creation and user attachment.

import { beforeAll, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

import { encryptVault } from '../src/lib/ai-enc';
import type { AiConfig, GroupRecord, UserRecord } from '../src/types/ai-config';

const BASE = 'https://example.com';
const MASTER = String((env as { AI_JSON_CRYPTOKEN?: string }).AI_JSON_CRYPTOKEN);

const legacyConfig: AiConfig = {
  version: 1,
  providers: {
    groq: {
      protocol: 'groq',
      endpoint: 'https://api.groq.com/openai/v1',
      keys: [{ key: 'gsk-legacy' }],
      models: [
        { id: 'llama-test', usage: 'chat', contextWindow: 8192, maxOutputTokens: 1024, tpmLimit: null, priority: 0 },
      ],
    },
  },
  crawlers: {},
};

beforeAll(async () => {
  // Simulate a pre-migration deployment: legacy vault + v1-era users.
  await env.KV_AI_PROXY.put('vault:ai.json.enc', await encryptVault(JSON.stringify(legacyConfig), MASTER));
  await env.KV_AI_PROXY.put(
    'users',
    JSON.stringify({
      admin: { key: MASTER, owner: 'admin', vaultId: 'legacy', role: 'admin' },
      ronan: { key: 'legacy-user-key', owner: 'ronan' },
      solo: { key: 'solo-key', owner: 'solo', vaultId: 'vault_solo', role: 'user' },
    }),
  );
  await env.KV_AI_PROXY.put('migration:ran', 'true');
  // The first request triggers the lazy v2 migration.
  await SELF.fetch(`${BASE}/`);
});

describe('multi-group migration', () => {
  it('creates the legacy-backed default group', async () => {
    const groups = (await env.KV_AI_PROXY.get('groups', 'json')) as Record<string, GroupRecord>;
    expect(groups).toBeTruthy();
    expect(groups.default).toBeTruthy();
    expect(groups.default.legacy).toBe(true);
    expect(await env.KV_AI_PROXY.get('migration:groups')).toBe('true');
  });

  it('attaches legacy-vault users to the default group and promotes the master user', async () => {
    const users = (await env.KV_AI_PROXY.get('users', 'json')) as Record<string, UserRecord>;
    expect(users.admin.role).toBe('superadmin');
    expect(users.admin.groupId).toBe('default');
    expect(users.ronan.groupId).toBe('default');
    // Per-user vault owners are left untouched
    expect(users.solo.groupId).toBeUndefined();
    expect(users.solo.vaultId).toBe('vault_solo');
  });

  it('serves the default group vault to migrated users, re-encrypted with their token', async () => {
    const res = await SELF.fetch(`${BASE}/ai.json.enc`, {
      headers: { Authorization: 'Bearer legacy-user-key' },
    });
    expect(res.status).toBe(200);
    const blob = await res.text();
    const { decryptAiConfig } = await import('../src/lib/ai-enc');
    const vault = await decryptAiConfig(blob, 'legacy-user-key');
    expect(vault.providers.groq.keys[0].key).toBe('gsk-legacy');
  });

  it('keeps the unauthenticated legacy download intact', async () => {
    const res = await SELF.fetch(`${BASE}/ai.json.enc`);
    expect(res.status).toBe(200);
    const blob = await res.text();
    const { decryptAiConfig } = await import('../src/lib/ai-enc');
    const vault = await decryptAiConfig(blob, MASTER);
    expect(vault.providers.groq.keys[0].key).toBe('gsk-legacy');
  });
});
