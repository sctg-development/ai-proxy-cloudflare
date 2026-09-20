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
/**
 * @file API client for interacting with the Cloudflare Worker.
 */

import type { AiConfig, UserRole } from '../types/ai-config';
import { decryptAiConfig } from './crypto';

/**
 * User context returned by the /v1/auth/me endpoint.
 */
export interface UserContext {
  /** The authenticated user's username. */
  username: string;
  /** The vault ID this user is authorized to access. */
  vaultId: string;
  /** The user's role within the multi-group architecture. */
  role: UserRole;
  /** Whether the user is on the legacy single-vault flow (pre-multi-group). */
  isLegacy: boolean;
  /** Multi-group: the group this user belongs to. Absent for legacy users. */
  groupId?: string;
  /** Human-readable name of the group the user belongs to. */
  groupName?: string;
}

export interface GroupSummary {
  /** Unique identifier of the group. */
  id: string;
  /** Human-readable group name. */
  name: string;
  /** Epoch timestamp (ms) when the group was created. */
  createdAt: number;
  /** Username of the group creator, if known. */
  createdBy?: string;
  /** Whether the group's vault is the legacy `vault:ai.json.enc` blob. */
  legacy: boolean;
  /** Number of users in the group. */
  memberCount: number;
}

export interface GroupMember {
  /** Username of the group member. */
  username: string;
  /** The key owner identifier (key Hint for encryption). */
  owner: string;
  /** The member's role within this group. */
  role: UserRole;
  /** Short hint identifying which API key the user holds, or null. */
  keyHint: string | null;
}

export interface QuotaObservation {
  /** ID of the provider that exhausted a key. */
  provider: string;
  /** Owner name of the exhausted key. */
  keyOwner: string;
  /** Short hint identifying which key was exhausted. */
  keyHint: string;
  /** ISO 8601 timestamp when the exhaustion was observed. */
  observedAt: string;
  /** ISO 8601 timestamp of the billing/usage period start. */
  periodStart: string;
  /** Number of prompt tokens consumed before the key was exhausted. */
  promptTokens: number;
  /** Number of completion tokens consumed before the key was exhausted. */
  completionTokens: number;
  /** Number of requests made before the key was exhausted. */
  requestCount: number;
}

/**
 * Interface for API response errors.
 */
export interface ApiError {
  /** Short machine-readable error code (e.g. `"Unauthorized"`). */
  error: string;
  /** Optional human-readable error message providing more detail. */
  message?: string;
}

/**
 * Optional parameters that control how a chat completion request is routed.
 */
export interface ChatCompletionOptions {
  /** When set to `'auto'`, the Worker cycles through available keys; `'manual'` uses a specific key. */
  providerKeyMode?: 'auto' | 'manual';
  /** The provider API key to use when `providerKeyMode` is `'manual'`. */
  providerApiKey?: string;
}

/**
 * Service to handle communication with the Worker.
 * Provides methods for authentication, config fetching/updating, group
 * administration, key health checks, and chat completion proxying.
 */
export const ApiService = {
  /**
    * Get the auth token from session storage.
    *
    * @returns The token string, or null if not set.
    */
   getToken(): string | null {
    return sessionStorage.getItem('ai_vault_token');
  },

   /**
    * Save the auth token to session storage.
    *
    * @param token - The token string to store.
    */
   setToken(token: string): void {
    sessionStorage.setItem('ai_vault_token', token);
  },

  /**
   * Clear the auth token from session storage.
   */
  clearToken(): void {
    sessionStorage.removeItem('ai_vault_token');
  },

   /**
    * Fetch the decrypted configuration from the Worker.
    * Downloads the encrypted vault and decrypts it client-side using the auth token.
    *
    * @returns A promise resolving to the parsed `AiConfig` object.
    * @throws Error if no token is found, the request is unauthorized, or decryption fails.
    */
   async fetchConfig(): Promise<AiConfig> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    // Use the encrypted endpoint to save CPU on the Cloudflare Worker
    const response = await fetch(`${import.meta.env.VAULT_URL}/ai.json.enc`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to fetch config');
    }

    const encryptedConfig = await response.text();
    const decryptedConfig = await decryptAiConfig(encryptedConfig, token);
    return JSON.parse(decryptedConfig) as AiConfig;
  },

  /**
   * Update the encrypted vault by uploading a new encrypted payload.
   *
   * The Worker expects a PUT to `/ai.json.enc` with an encrypted body.
   * Since the browser has access to the decryption utilities (`encryptVault`),
   * the caller can re-encrypt the edited JSON before calling this method.
   *
   * @param encryptedVault - The Base64-encoded, AES-256-CBC encrypted vault content.
   * @throws Error if the user is not authenticated or the upload fails.
   */
  async updateVault(encryptedVault: string): Promise<void> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}/ai.json.enc`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: encryptedVault
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to update vault');
    }
  },

   /**
    * Fetch the current user's context information.
    *
    * @returns A promise resolving to the user context object.
    * @throws Error if no token is found or the request fails.
    */
   async fetchUserContext(): Promise<UserContext> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}/v1/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to fetch user context');
    }

    return await response.json() as UserContext;
  },

   /**
    * Generic authenticated JSON request against the Worker.
    * Throws with the server-provided message on non-2xx responses.
    *
    * @param path - The URL path relative to `VAULT_URL` (e.g. `"/v1/groups"`).
    * @param init - Optional `RequestInit` overrides (method, headers, body).
    * @returns A promise resolving to the parsed response body of type `T`.
    * @throws Error if no token is found or the response is not OK.
    */
   async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const response = await fetch(`${import.meta.env.VAULT_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
        'Authorization': `Bearer ${token}`,
      },
    });

    const body = (await response.json().catch(() => ({}))) as T & ApiError;
    if (!response.ok) {
      throw new Error(body.message || body.error || `Request failed with status ${response.status}`);
    }
    return body;
  },

   /**
    * Admin-only: test every non-expired, non-quota-flagged "mistral" key with
    * a free `GET /v1/models` call and flag any that return 401 as quota-
    * exhausted until the next reset. Persists directly server-side — the
    * caller should reload the config afterward to see the updated flags.
    *
    * @param force - When true, re-tests all keys even if recently checked.
    * @returns An object with the count of tested keys and arrays of exhausted and healthy key owners.
    */
    async testMistralKeys(force: boolean = true): Promise<{ tested: number; nowExhausted: string[]; healthy: string[] }> {
    return this.request('/v1/keypool/mistral/healthcheck' + (force ? '?force=true' : ''), { method: 'POST' });
   },

   /**
    * Recorded quota-exhaustion observations (usage-until-exhaustion samples),
    * most recent first. Optionally filtered by provider (e.g. "mistral").
    *
    * @param provider - Optional provider name to filter observations by.
    * @returns An array of quota observation records.
    */
   async getQuotaObservations(provider?: string): Promise<QuotaObservation[]> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    const body = await this.request<{ data: QuotaObservation[] }>(`/v1/keypool/quota-observations${query}`);
    return body.data;
  },

  // ── Group administration ─────────────────────────────────────────

  /**
   * Lists the groups visible to the caller.
   *
   * @returns An array of group summaries.
   */
  async listGroups(): Promise<GroupSummary[]> {
    const body = await this.request<{ data: GroupSummary[] }>('/v1/groups');
    return body.data;
  },

  /**
   * Creates a new group (superadmin only).
   *
   * @param name - The human-readable group name.
   * @param id - Optional explicit group ID; a random UUID is generated if omitted.
   * @returns An object with the new group ID and a flag indicating whether a BYOK key was used.
   */
  async createGroup(name: string, id?: string): Promise<{ id: string; seededFromByok: boolean }> {
    return this.request('/v1/groups', {
      method: 'POST',
      body: JSON.stringify({ name, ...(id ? { id } : {}) }),
    });
  },

  /**
   * Deletes a group (superadmin only). When `force` is true, also removes
   * all members from the group before deletion.
   *
   * @param groupId - The ID of the group to delete.
   * @param force - When true, also removes all members from the group.
   * @returns An object listing the usernames that were removed.
   */
  async deleteGroup(groupId: string, force = false): Promise<{ deletedUsers: string[] }> {
    return this.request(`/v1/groups/${encodeURIComponent(groupId)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    });
  },

  /**
   * Lists all members of a group.
   *
   * @param groupId - The ID of the group whose members to list.
   * @returns An array of group member summaries.
   */
  async listGroupUsers(groupId: string): Promise<GroupMember[]> {
    const body = await this.request<{ data: GroupMember[] }>(
      `/v1/groups/${encodeURIComponent(groupId)}/users`,
    );
    return body.data;
  },

  /**
   * Creates a new member in a group. Returns the generated API key (shown once).
   *
   * @param groupId - The ID of the group to add the member to.
   * @param username - The username for the new member.
   * @param role - The member's role (`'admin'` or `'user'`).
   * @param key - Optional explicit API key; a random key is generated if omitted.
   * @returns An object with the username, role, and generated key.
   */
  async createGroupUser(
    groupId: string,
    username: string,
    role: 'admin' | 'user',
    key?: string,
  ): Promise<{ username: string; role: string; key: string }> {
    return this.request(`/v1/groups/${encodeURIComponent(groupId)}/users`, {
      method: 'POST',
      body: JSON.stringify({ username, role, ...(key ? { key } : {}) }),
    });
  },

  /**
   * Updates a group member's role or regenerates their API key.
   *
   * @param groupId - The ID of the group containing the member.
   * @param username - The username of the member to update.
   * @param update - Partial update object with optional `role` and `regenerateKey` fields.
   * @returns An object with the updated username, role, and new key (if regenerated).
   */
  async updateGroupUser(
    groupId: string,
    username: string,
    update: { role?: 'admin' | 'user'; regenerateKey?: boolean },
  ): Promise<{ username: string; role: string; key?: string }> {
    return this.request(
      `/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(username)}`,
      { method: 'PUT', body: JSON.stringify(update) },
    );
  },

  /**
   * Removes a member from a group.
   *
   * @param groupId - The ID of the group containing the member.
   * @param username - The username of the member to remove.
   * @returns A promise that resolves when the member has been removed.
   */
  async deleteGroupUser(groupId: string, username: string): Promise<void> {
    await this.request(
      `/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(username)}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Send a chat completion request through the Worker for a specific provider.
   *
   * @param providerId - The vault provider key (e.g. `"openai"`) used to build the request URL.
   * @param payload - The JSON request body, typically an OpenAI-compatible chat completion payload.
   * @param options - Optional provider-key routing and authentication headers.
   * @returns The parsed provider response (JSON object or raw text for non-JSON responses).
   * @throws Error if the user is not authenticated, the network fails, or the provider returns a non-2xx status.
   */
  async createChatCompletion(
    providerId: string,
    payload: Record<string, unknown>,
    options?: ChatCompletionOptions,
  ): Promise<unknown> {
    const token = this.getToken();
    if (!token) throw new Error('No authorization token found');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    if (options?.providerKeyMode) {
      headers['X-Provider-Key-Mode'] = options.providerKeyMode;
    }
    if (options?.providerApiKey) {
      headers['X-Provider-Api-Key'] = options.providerApiKey;
    }

    const response = await fetch(`${import.meta.env.VAULT_URL}/${providerId}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let parsedBody: unknown = responseText;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      // Keep raw text for non-json errors and compatibility payloads.
    }

    if (!response.ok) {
      const errorBody = parsedBody as ApiError;
      throw new Error(
        errorBody?.message || errorBody?.error || `Request failed with status ${response.status}`,
      );
    }

    return parsedBody;
  }
};

