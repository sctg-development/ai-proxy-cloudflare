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
