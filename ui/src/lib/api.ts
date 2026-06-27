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

import type { AiConfig } from '../types/ai-config';
import { decryptAiConfig } from './crypto';

/**
 * User context returned by the /v1/auth/me endpoint.
 */
interface UserContext {
  username: string;
  vaultId: string;
  role: 'admin' | 'user';
  isLegacy: boolean;
}

/**
 * Interface for API response errors.
 */
export interface ApiError {
  error: string;
  message?: string;
}

export interface ChatCompletionOptions {
  providerKeyMode?: 'auto' | 'manual';
  providerApiKey?: string;
}

/**
 * Service to handle communication with the Worker.
 */
export const ApiService = {
  /**
   * Get the auth token from session storage.
   * @returns The token or null if not set.
   */
  getToken(): string | null {
    return sessionStorage.getItem('ai_vault_token');
  },

  /**
   * Save the auth token to session storage.
   * @param token The token to store.
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
   * Fetch the decrypted configuration.
   * @returns The AiConfig object.
   * @throws Error if unauthorized or fetch fails.
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
   * Update the encrypted vault.
   * Note: This requires the encrypted payload, which in this UI we assume
   * we manage by re-encrypting or the worker handles the encryption logic
   * if we send it as plain JSON to a specific endpoint.
   *
   * Looking at src/index.ts, PUT /ai.json.enc EXPECTS an encrypted body.
   * But we don't have the encryption logic in the browser easily without the password.
   * Actually, the password IS the token.
   *
   * WAIT: The worker's GET /ai.json decrypts the KV value using the Bearer token.
   * So we can download the decrypted JSON, edit it, and then we need to
   * encrypt it back before PUT /ai.json.enc.
   *
   * I should probably add an encryption utility in the UI that matches the worker's logic.
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
   * @returns The user context object.
   * @throws Error if unauthorized or fetch fails.
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
   * Send a chat completion request through the Worker for a specific provider.
   * The optional provider-key headers are consumed by playground-compatible setups.
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

