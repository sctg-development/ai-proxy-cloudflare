// Copyright (c) 2024-2026 Ronan LE MEILLAT
// License: AGPL-3.0-or-later
//
// AI configuration decryption utility
// Decrypts ai.json.enc using Web Crypto API (Node.js ≥18 & Cloudflare Workers)

export type AiProtocol = 'openai' | 'groq' | 'sambanova' | 'anthropic' | 'gemini';

export interface AiKey {
  key: string;
  owner?: string;
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
}

export interface AiModel {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  tpmLimit: number | null;
  priority: number;
  tags?: string[];
  gatewayPrefix?: string;
}

export interface AiProvider {
  protocol: AiProtocol;
  endpoint: string;
  gatewayEndpoint?: string;
  gatewayModelPrefix?: string;
  gatewayKey?: string;
  keys: AiKey[];
  models: AiModel[];
}

export interface AiConfig {
  version: number;
  providers: Record<string, AiProvider>;
}

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
