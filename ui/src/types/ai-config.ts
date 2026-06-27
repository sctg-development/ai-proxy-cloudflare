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
  | 'morph'
  | 'cohere';

/**
 * Supported crawler protocols.
 */
export type CrawlerProtocol = 'firecrawl' | 'exa' | 'scrapegraphai';

/** Supported input modalities for a model. */
export type AiModalityInput = 'text' | 'image' | 'audio' | 'video';

/** Supported output modalities for a model. */
export type AiModalityOutput = 'text' | 'image' | 'audio';

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
  /** Optional shared secret for gateway authentication */
  sharedSecret?: string;
  /** Optional hash type for the signature */
  signatureType?: 'hmac-md5' | 'hmac-sha256' | 'hmac-sha512';
}

/**
 * Represents an AI model configuration.
 */
export interface AiModel {
  /** The model identifier (e.g., 'gpt-4') */
  id: string;
  /**
   * API surface this model should be used with.
   * `chat` and `embedding` are the two original proxy-routing classes.
   * `transcription`, `tts`, and `image-generation` extend the type for
   * specialized models such as Whisper, Voxtral-TTS, and DALL-E.
   */
  usage: 'chat' | 'embedding' | 'transcription' | 'tts' | 'image-generation';
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
  /**
   * Input modalities the model accepts. When absent the playground assumes
   * `['text']` for backward compatibility with existing configs.
   */
  inputModalities?: AiModalityInput[];
  /**
   * Output modalities the model can produce. When absent the playground assumes
   * `['text']` for backward compatibility with existing configs.
   */
  outputModalities?: AiModalityOutput[];
  /** Whether the model supports image inputs */
  supportsImages?: boolean;
  /** Whether the model supports prompt caching */
  supportsPromptCache?: boolean;
  /** Whether the model supports tools/function calling */
  supportsTools?: boolean;
  /** Whether the model supports advanced reasoning capabilities */
  supportsReasoning?: boolean;
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
  /** Optional model card endpoint */
  modelCardEndpoint?: string;
  /** Optional custom user agent for requests */
  userAgent?: string;
}

/**
 * Represents a crawler service configuration.
 */
export interface Crawler {
  /** Protocol used by the crawler */
  protocol: CrawlerProtocol;
  /** Base API endpoint */
  endpoint: string;
  /** List of API keys for this crawler */
  keys: AiKey[];
}

/**
 * Represents a Weather API protocol.
 */
export interface WeatherApiProtocol {
  /** Protocol used by the Weather API */
  protocol: 'meteoblue';
}

/**
 * Represents a Weather API configuration.
 */
export interface WeatherApi { 
  protocol: WeatherApiProtocol;
  endpoint: string;
  keys: AiKey[];
}

/**
 * Represents a user record in the users KV store.
 * This interface supports both legacy and new fields for backward compatibility.
 */
export interface UserRecord {
  /** The actual authentication token (legacy field, required) */
  key?: string;
  /** Human-readable owner name (legacy field, optional) */
  owner?: string;
  /** Key status (legacy field, optional) */
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
  /** New: ID of the vault this user should access (defaults to 'legacy') */
  vaultId?: string;
  /** New: Admin or standard user (defaults to 'user') */
  role?: 'admin' | 'user';
}


/**
 * The root AI configuration object (the "vault").
 */
export interface AiConfig {
  /** Configuration schema version */
  version: number;
  /** Dictionary of providers keyed by their unique ID */
  providers: Record<string, AiProvider>;
  /** Dictionary of crawlers keyed by their unique ID */
  crawlers: Record<string, Crawler>;
  /** Optional Weather API configuration */
  weatherApi?: WeatherApi;
}

