/**
 * @file API client for interacting with the Cloudflare Worker.
 */

import type { AiConfig } from '../types/ai-config';

/**
 * Interface for API response errors.
 */
export interface ApiError {
  error: string;
  message?: string;
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

    const response = await fetch(`${import.meta.env.VAULT_URL}/ai.json`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiError;
      throw new Error(errorData.message || errorData.error || 'Failed to fetch config');
    }

    return response.json();
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

    const response = await fetch('/ai.json.enc', {
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
  }
};
