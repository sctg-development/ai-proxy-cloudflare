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
// Multi-group endpoints: group CRUD, per-group users, group vault access.

import { beforeAll, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

import { decryptAiConfig, encryptVault } from '../src/lib/ai-enc';
import { deriveGroupSecret } from '../src/lib/groups';
import type { AiConfig } from '../src/types/ai-config';

const BASE = 'https://example.com';
const MASTER = String((env as { AI_JSON_CRYPTOKEN?: string }).AI_JSON_CRYPTOKEN);

const SUPERADMIN_KEY = 'kp_test_superadmin_key';
const byokTemplate: AiConfig = {
  version: 1,
  providers: {
    openai: {
      protocol: 'openai',
      endpoint: 'https://api.openai.com/v1',
      keys: [{ key: 'sk-template-should-be-stripped' }],
      models: [
        {
          id: 'gpt-test',
          usage: 'chat',
          contextWindow: 128000,
          maxOutputTokens: 4096,
          tpmLimit: null,
          priority: 0,
        },
      ],
    },
  },
  crawlers: {},
};

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

beforeAll(async () => {
  // Neutralize the lazy migration: this file tests explicit group management.
  await env.KV_AI_PROXY.put('migration:ran', 'true');
  await env.KV_AI_PROXY.put('migration:groups', 'true');
  // A superadmin without any group
  await env.KV_AI_PROXY.put(
    'users',
    JSON.stringify({ boss: { key: SUPERADMIN_KEY, owner: 'boss', role: 'superadmin' } }),
  );
  // The BYOK template used to seed new group vaults
  await env.KV_AI_PROXY.put('vault:byok', JSON.stringify(byokTemplate));
});

describe('group management', () => {
  it('rejects group creation for non-superadmin callers', async () => {
    const res = await SELF.fetch(
      `${BASE}/v1/groups`,
      authed('unknown-token', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) }),
    );
    expect(res.status).toBe(401);
  });

  it('creates a group seeded from the BYOK template with keys stripped', async () => {
    const res = await SELF.fetch(
      `${BASE}/v1/groups`,
      authed(SUPERADMIN_KEY, { method: 'POST', body: JSON.stringify({ id: 'acme', name: 'ACME Corp' }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string; seededFromByok: boolean };
    expect(body.ok).toBe(true);
    expect(body.id).toBe('acme');
    expect(body.seededFromByok).toBe(true);

    // The vault must decrypt with the group-derived secret
    const blob = await env.KV_AI_PROXY.get('vault:group:acme');
    expect(blob).toBeTruthy();
    const secret = await deriveGroupSecret(MASTER, 'acme');
    const vault = await decryptAiConfig(blob!, secret);
    expect(Object.keys(vault.providers)).toEqual(['openai']);
    expect(vault.providers.openai.keys).toEqual([]);
    expect(vault.providers.openai.models[0].id).toBe('gpt-test');
  });

  it('lists groups for the superadmin', async () => {
    const res = await SELF.fetch(`${BASE}/v1/groups`, authed(SUPERADMIN_KEY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; name: string }> };
    expect(body.data.some((g) => g.id === 'acme')).toBe(true);
  });

  it('creates group members and returns the generated key once', async () => {
    const adminRes = await SELF.fetch(
      `${BASE}/v1/groups/acme/users`,
      authed(SUPERADMIN_KEY, {
        method: 'POST',
        body: JSON.stringify({ username: 'alice', role: 'admin' }),
      }),
    );
    expect(adminRes.status).toBe(200);
    const alice = (await adminRes.json()) as { key: string; role: string };
    expect(alice.role).toBe('admin');
    expect(alice.key).toMatch(/^kp_[0-9a-f]{48}$/);

    // Group admin can create a plain member of their own group
    const userRes = await SELF.fetch(
      `${BASE}/v1/groups/acme/users`,
      authed(alice.key, { method: 'POST', body: JSON.stringify({ username: 'bob' }) }),
    );
    expect(userRes.status).toBe(200);
    const bob = (await userRes.json()) as { key: string; role: string };
    expect(bob.role).toBe('user');

    // Members are listed with masked keys
    const listRes = await SELF.fetch(`${BASE}/v1/groups/acme/users`, authed(alice.key));
    const list = (await listRes.json()) as { data: Array<{ username: string; keyHint: string }> };
    expect(list.data.map((u) => u.username).sort()).toEqual(['alice', 'bob']);
    expect(list.data[0].keyHint).toMatch(/^\*\*\*/);

    // A plain user cannot manage the group
    const forbidden = await SELF.fetch(
      `${BASE}/v1/groups/acme/users`,
      authed(bob.key, { method: 'POST', body: JSON.stringify({ username: 'eve' }) }),
    );
    expect(forbidden.status).toBe(403);

    // Keep tokens for the following tests
    (globalThis as Record<string, unknown>).__aliceKey = alice.key;
    (globalThis as Record<string, unknown>).__bobKey = bob.key;
  });

  it('an admin of another group cannot manage acme', async () => {
    await SELF.fetch(
      `${BASE}/v1/groups`,
      authed(SUPERADMIN_KEY, { method: 'POST', body: JSON.stringify({ id: 'other', name: 'Other' }) }),
    );
    const res = await SELF.fetch(
      `${BASE}/v1/groups/other/users`,
      authed(SUPERADMIN_KEY, {
        method: 'POST',
        body: JSON.stringify({ username: 'mallory', role: 'admin' }),
      }),
    );
    const mallory = (await res.json()) as { key: string };

    const forbidden = await SELF.fetch(`${BASE}/v1/groups/acme/users`, authed(mallory.key));
    expect(forbidden.status).toBe(403);
  });

  it('serves the group vault re-encrypted with the member token', async () => {
    const bobKey = (globalThis as Record<string, unknown>).__bobKey as string;
    const res = await SELF.fetch(`${BASE}/ai.json.enc`, authed(bobKey));
    expect(res.status).toBe(200);
    const blob = await res.text();
    // Bob can decrypt the downloaded vault with his own token
    const vault = await decryptAiConfig(blob, bobKey);
    expect(vault.providers.openai.models[0].id).toBe('gpt-test');
  });

  it('lets a group admin update the vault (re-encrypted server-side) and members see it', async () => {
    const aliceKey = (globalThis as Record<string, unknown>).__aliceKey as string;
    const bobKey = (globalThis as Record<string, unknown>).__bobKey as string;

    const updated: AiConfig = JSON.parse(JSON.stringify(byokTemplate));
    updated.providers.openai.keys = [{ key: 'sk-real-group-key', owner: 'alice' }];

    // The client encrypts with their own token, as the UI does
    const payload = await encryptVault(JSON.stringify(updated), aliceKey);
    const putRes = await SELF.fetch(
      `${BASE}/ai.json.enc`,
      authed(aliceKey, { method: 'PUT', body: payload }),
    );
    expect(putRes.status).toBe(200);

    // Stored blob is encrypted with the derived group secret
    const stored = await env.KV_AI_PROXY.get('vault:group:acme');
    const secret = await deriveGroupSecret(MASTER, 'acme');
    const storedVault = await decryptAiConfig(stored!, secret);
    expect(storedVault.providers.openai.keys[0].key).toBe('sk-real-group-key');

    // Another member sees the update through GET /ai.json
    const getRes = await SELF.fetch(`${BASE}/ai.json`, authed(bobKey));
    expect(getRes.status).toBe(200);
    const seen = (await getRes.json()) as AiConfig;
    expect(seen.providers.openai.keys[0].key).toBe('sk-real-group-key');
  });

  it('a plain member cannot update the group vault', async () => {
    const bobKey = (globalThis as Record<string, unknown>).__bobKey as string;
    const payload = await encryptVault(JSON.stringify(byokTemplate), bobKey);
    const res = await SELF.fetch(
      `${BASE}/ai.json.enc`,
      authed(bobKey, { method: 'PUT', body: payload }),
    );
    expect(res.status).toBe(403);
  });

  it('exposes group info in /v1/auth/me', async () => {
    const bobKey = (globalThis as Record<string, unknown>).__bobKey as string;
    const res = await SELF.fetch(`${BASE}/v1/auth/me`, authed(bobKey));
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as { username: string; role: string; groupId: string; groupName: string };
    expect(ctx.username).toBe('bob');
    expect(ctx.role).toBe('user');
    expect(ctx.groupId).toBe('acme');
    expect(ctx.groupName).toBe('ACME Corp');
  });

  it('records keypool usage into the shared group bucket', async () => {
    const aliceKey = (globalThis as Record<string, unknown>).__aliceKey as string;
    const bobKey = (globalThis as Record<string, unknown>).__bobKey as string;

    const post = await SELF.fetch(
      `${BASE}/v1/keypool/usage`,
      authed(bobKey, {
        method: 'POST',
        body: JSON.stringify({
          provider: 'openai',
          modelId: 'gpt-test',
          keyOwner: 'alice',
          keyHint: '***-key',
          promptTokens: 10,
          completionTokens: 5,
        }),
      }),
    );
    expect(post.status).toBe(200);

    // Alice (same group) sees Bob's usage: shared group stats bucket
    const stats = await SELF.fetch(`${BASE}/v1/keypool/stats?period=day`, authed(aliceKey));
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as { data: Array<{ provider: string; promptTokens: number }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].provider).toBe('openai');
    expect(body.data[0].promptTokens).toBe(10);
  });

  it('refuses to delete a group with members unless forced', async () => {
    const res = await SELF.fetch(`${BASE}/v1/groups/acme`, authed(SUPERADMIN_KEY, { method: 'DELETE' }));
    expect(res.status).toBe(409);

    const forced = await SELF.fetch(
      `${BASE}/v1/groups/acme?force=true`,
      authed(SUPERADMIN_KEY, { method: 'DELETE' }),
    );
    expect(forced.status).toBe(200);
    const body = (await forced.json()) as { deletedUsers: string[] };
    expect(body.deletedUsers.sort()).toEqual(['alice', 'bob']);
    expect(await env.KV_AI_PROXY.get('vault:group:acme')).toBeNull();
  });
});
