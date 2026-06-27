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
// AI configuration decryption utility
// Decrypts ai.json.enc using Web Crypto API (Node.js ≥18 & Cloudflare Workers)

import type { AiConfig, AiKey, AiModel, AiProvider } from '../types/ai-config'; 

/**
 * Decrypt ai.json.enc encrypted with:
 *   openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
 *     -in ai.json -out ai.json.enc -pass pass:"${CRYPTOKEN}"
 */
export async function decryptAiConfig(
  base64Ciphertext: string,
  password: string,
): Promise<AiConfig> {
  const raw = Uint8Array.from(atob(base64Ciphertext.trim()), c => c.charCodeAt(0));

  if (new TextDecoder().decode(raw.slice(0, 8)) !== 'Salted__') {
    throw new Error(
      'ai.json.enc: invalid format — expected OpenSSL "Salted__" header. ' +
      'Ensure file was encrypted with -a flag.',
    );
  }

  const salt = raw.slice(8, 16);
  const ciphertext = raw.slice(16);

  const pwBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384,
    ),
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    derived.slice(0, 32),
    'AES-CBC',
    false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: derived.slice(32, 48) },
    aesKey,
    ciphertext,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as AiConfig;
}

/**
 * Resolve the effective API endpoint for a provider.
 * When gateway is available, prefer it. Fall back to direct endpoint.
 */
export function resolveProviderEndpoint(
  provider: AiProvider,
  aigToken: string | undefined,
): { endpoint: string; useGateway: boolean } {
  if (aigToken && provider.gatewayEndpoint) {
    return { endpoint: provider.gatewayEndpoint, useGateway: true };
  }
  return { endpoint: provider.endpoint, useGateway: false };
}

/**
 * Build the model ID string for API requests.
 * Gateway routing requires "prefix/model-id" format.
 */
export function resolveModelId(
  modelId: string,
  provider: AiProvider,
  useGateway: boolean,
): string {
  if (useGateway && provider.gatewayModelPrefix) {
    const prefix = `${provider.gatewayModelPrefix}/`;
    if (modelId.startsWith(prefix)) return modelId;
    return `${provider.gatewayModelPrefix}/${modelId}`;
  }
  return modelId;
}

/**
 * Pick one API key at random (load-balancing).
 */
export function pickKey(provider: AiProvider): AiKey {
  if (provider.keys.length === 0) {
    throw new Error('No API keys configured for provider');
  }
  return provider.keys[Math.floor(Math.random() * provider.keys.length)];
}

/**
 * Select the first available model from a provider.
 */
export function selectModel(provider: AiProvider): AiModel {
  if (provider.models.length === 0) {
    throw new Error('No models configured for provider');
  }
  // Sort by priority (lower = better) and pick first
  return provider.models.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Encrypt a vault configuration using the same algorithm as OpenSSL.
 * This is the reverse operation of decryptAiConfig.
 *
 * @param plaintext - The JSON string to encrypt
 * @param password - The encryption password
 * @returns Base64-encoded OpenSSL-compatible ciphertext with "Salted__" header
 */
export async function encryptVault(
  plaintext: string,
  password: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const passwordBytes = encoder.encode(password);

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(8));

  // Derive key using PBKDF2 (same parameters as OpenSSL)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      baseKey,
      384 // 32 bytes for key + 16 bytes for IV
    )
  );

  // Extract key and IV
  const key = derived.slice(0, 32);
  const iv = derived.slice(32, 48);

  // Import AES key and encrypt
  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-CBC',
    false,
    ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    aesKey,
    data
  );

  // Build OpenSSL-compatible format: Salted__ + salt + ciphertext
  const saltedHeader = encoder.encode('Salted__');
  const result = new Uint8Array(
    saltedHeader.length + salt.length + encrypted.byteLength
  );
  result.set(saltedHeader, 0);
  result.set(salt, saltedHeader.length);
  result.set(new Uint8Array(encrypted), saltedHeader.length + salt.length);

  // Return as Base64
  return btoa(String.fromCharCode(...result));
}

