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
   * Output modalities the model can produce. When absent the playground
   * assumes `['text']` for backward compatibility with existing configs.
   */
  outputModalities?: AiModalityOutput[];
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

