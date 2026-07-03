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
