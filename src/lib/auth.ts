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
// User authentication and key validation

import { GroupRecord, UserRecord, UserRole } from '../types/ai-config';
import { loadGroups } from './groups';

/**
 * User context returned by getUserContext for management endpoints.
 */
export interface UserContext {
  username: string;
  vaultId: string;
  role: UserRole;
  isLegacy: boolean;
  /** Group the user belongs to (multi-group mode). */
  groupId?: string;
  /** Human-readable name of the user's group. */
  groupName?: string;
  /** Resolved group record (avoids a second KV read downstream). */
  group?: GroupRecord;
}

/** True for roles allowed to manage users and vault content. */
export function isAdminRole(role: UserRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

/**
 * Load user keys from KV or fallback to embedded data.
 */
export async function loadUserKeys(kv: KVNamespace): Promise<Record<string, UserRecord>> {
  try {
    const stored = await kv.get('users', 'json');
    if (stored) return stored as Record<string, UserRecord>;
  } catch (err) {
    console.error('Failed to load users from KV:', err);
  }
  // Fallback: return empty record
  return {};
}

/**
 * New function for management endpoints (GET/PUT /ai.json, user management).
 * Does NOT affect the proxy's `validateUserKey`.
 */
export async function getUserContext(
  kv: KVNamespace,
  bearerToken: string | null,
  cryptoToken: string
): Promise<UserContext | null> {
  if (!bearerToken) return null;

  const users = await loadUserKeys(kv);

  // 1. Check against 'users' KV first (multi-user mode)
  for (const [username, record] of Object.entries(users)) {
    if (record.key === bearerToken) {
      const role: UserRole = (record.role as UserRole) || 'user';

      // Multi-group mode: groupId takes precedence over per-user vaultId
      if (record.groupId) {
        const groups = await loadGroups(kv);
        const group = groups[record.groupId];
        return {
          username,
          vaultId: `group:${record.groupId}`,
          role,
          isLegacy: false,
          groupId: record.groupId,
          groupName: group?.name,
          group,
        };
      }

      return {
        username,
        vaultId: record.vaultId || 'legacy',
        role,
        isLegacy: !record.vaultId,
      };
    }
  }

  // 2. Fallback to legacy master token — always superadmin
  if (bearerToken === cryptoToken) {
    return {
      username: 'legacy_admin',
      vaultId: 'legacy',
      role: 'superadmin',
      isLegacy: true,
    };
  }

  return null;
}

/**
 * Validate user API key against stored records.
 * Returns the username if valid, null otherwise.
 */
export async function validateUserKey(
  kv: KVNamespace,
  bearerToken: string,
): Promise<string | null> {
  const users = await loadUserKeys(kv);

  for (const [username, record] of Object.entries(users)) {
    if (record.key === bearerToken) {
      return username;
    }
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header.
 * Returns the token value or null if missing/invalid.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
