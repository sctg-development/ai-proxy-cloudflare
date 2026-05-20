/**
 * @file Types for the AI Proxy configuration.
 * Mirroring the structure expected by the Cloudflare Worker.
 */

/**
 * Supported AI protocols.
 */
export type AiProtocol =
  | 'openai'
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'morph';

/**
 * Represents an API key in the vault.
 */
export interface AiKey {
  /** The actual API key string */
  key: string;
  /** Optional owner name for identification */
  owner?: string;
  /** Optional key status/tier */
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
}

/**
 * Represents an AI model configuration.
 */
export interface AiModel {
  /** The model identifier (e.g., 'gpt-4') */
  id: string;
  /** API surface this model should be used with. */
  usage: 'chat' | 'embedding';
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens allowed */
  maxOutputTokens: number;
  /** Tokens per minute limit, or null if unlimited */
  tpmLimit: number | null;
  /** Priority for selection (lower = higher priority) */
  priority: number;
  /** Optional tags for filtering */
  tags?: string[];
  /** Optional prefix for gateway routing */
  gatewayPrefix?: string;
}

/**
 * Represents an AI provider configuration.
 */
export interface AiProvider {
  /** Protocol used by the provider */
  protocol: AiProtocol;
  /** Base API endpoint */
  endpoint: string;
  /** Optional Cloudflare AI Gateway endpoint */
  gatewayEndpoint?: string;
  /** Optional model prefix for gateway */
  gatewayModelPrefix?: string;
  /** Optional shared key for gateway authentication */
  gatewayKey?: string;
  /** List of API keys for this provider */
  keys: AiKey[];
  /** List of available models for this provider */
  models: AiModel[];
}

/**
 * The root AI configuration object (the "vault").
 */
export interface AiConfig {
  /** Configuration schema version */
  version: number;
  /** Dictionary of providers keyed by their unique ID */
  providers: Record<string, AiProvider>;
}
