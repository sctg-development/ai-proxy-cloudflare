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
 * @file Provider model discovery for the vault UI.
 *
 * Each provider exposes its catalogue with slightly different response shapes.
 * This module normalises them into the vault's `AiModel` shape, now including
 * `inputModalities` and `outputModalities` using a three-stage pipeline:
 *
 *   B — Provider-specific field mapping (Mistral capabilities, OpenRouter
 *       architecture, Gemini supportedGenerationMethods, Anthropic family).
 *   C — Heuristic ID patterns as a fallback for providers with sparse metadata
 *       (Groq, SambaNova, generic OpenAI-compat proxies).
 *
 * Option D (manual override) is handled in the ConfigModal UI.
 *
 * @module provider-models
 */

import type { AiModel, AiModalityInput, AiModalityOutput, AiProvider } from '../types/ai-config';
import {ApiService} from './api';

/** Providers whose public APIs are explicitly handled by this file. */
export type SupportedDiscoveryProvider =
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'poolside'
  | 'openrouter'
  | 'openai'
  | 'morph'
  | 'cohere';

/**
 * Result returned to the UI after a provider catalogue has been normalized.
 */
export interface ProviderModelDiscoveryResult {
  /** Normalized model records ready to be saved into ai.json. */
  models: AiModel[];
  /** Human-readable notes shown after sync for provider-specific caveats. */
  notes: string[];
}

/** Generic JSON object used to safely inspect provider responses. */
type JsonRecord = Record<string, unknown>;

/**
 * Fetches and normalizes the model catalogue for one provider.
 *
 * This is the main entry point for model discovery. It delegates to a
 * provider-specific fetcher (Option B) based on the inferred canonical
 * provider ID, then re-applies stable priorities so that existing model
 * ordering is preserved across refreshes.
 *
 * @param providerId - The vault key of the provider (may be an alias).
 * @param provider - The full provider configuration object.
 * @param apiKey - The API key used to authenticate the discovery request.
 * @param previousModels - The existing models, used to preserve priority ordering.
 * @param freeOnly - When true, restrict to free-tier models (currently only OpenRouter uses this).
 * @returns A promise resolving to the normalized models and any notes for the user.
 * @throws If the provider's API request fails or returns an error.
 */
export async function discoverProviderModels(
  providerId: string,
  provider: AiProvider,
  apiKey: string,
  previousModels: AiModel[],
  freeOnly = false,
): Promise<ProviderModelDiscoveryResult> {
  const knownProvider = canonicalProviderId(providerId, provider);

  switch (knownProvider) {
    case 'anthropic':
      return withStablePriority(await fetchAnthropicModels(provider, apiKey), previousModels);
    case 'gemini':
      return withStablePriority(await fetchGeminiModels(provider, apiKey), previousModels);
    case 'mistral':
      return withStablePriority(await fetchMistralModels(provider, apiKey), previousModels);
    case 'openrouter':
      return withStablePriority(await fetchOpenRouterModels(provider, apiKey, freeOnly), previousModels);
    case 'openai':
      return withStablePriority(await fetchOpenAiModels(provider, apiKey), previousModels);
    case 'poolside':
      return withStablePriority(await fetchPoolsideModels(provider, apiKey, ApiService.getToken()  ), previousModels);
    case 'morph':
      return withStablePriority(await fetchMorphModels(provider, apiKey), previousModels);
    case 'cohere':
      return withStablePriority(await fetchCohereModels(provider, apiKey), previousModels);
    case 'groq':
    case 'sambanova':
      return withStablePriority(
        await fetchOpenAiCompatibleModels(provider, apiKey, knownProvider),
        previousModels,
      );
  }
}

/**
 * Returns true when the UI knows how to query the provider directly.
 *
 * @param providerId - The ID of the provider to check.
 * @param provider - The provider configuration object.
 * @returns True if the provider can be discovered, false otherwise.
 */
export function canDiscoverProviderModels(providerId: string, provider: AiProvider): boolean {
  return isSupportedDiscoveryProvider(canonicalProviderId(providerId, provider));
}

/**
 * Builds a compact label for the API key used by the sync action.
 *
 * @param key - The API key to mask.
 * @returns A masked version of the API key with the first and last 4 characters visible.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/**
 * Reassigns priorities from the current visual order.
 *
 * @param models - The array of models to renumber.
 * @returns A new array of models with updated priorities (0, 10, 20, …).
 */
export function renumberPriorities(models: AiModel[]): AiModel[] {
  return models.map((model, index) => ({ ...model, priority: index * 10 }));
}

/**
 * Infers the provider implementation from the vault key, protocol, endpoint,
 * and gateway prefix.
 *
 * @param providerId - The provider ID from the vault.
 * @param provider - The provider configuration object.
 * @returns The canonical provider ID used to select a fetcher.
 */
function canonicalProviderId(
  providerId: string,
  provider: AiProvider,
): SupportedDiscoveryProvider {
  const haystack = [
    providerId,
    provider.protocol,
    provider.endpoint,
    provider.gatewayEndpoint ?? '',
    provider.gatewayModelPrefix ?? '',
  ].join(' ').toLowerCase();

  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic';
  if (haystack.includes('generativelanguage') || haystack.includes('gemini')) return 'gemini';
  if (haystack.includes('mistral')) return 'mistral';
  if (haystack.includes('openrouter')) return 'openrouter';
  if (haystack.includes('sambanova') || haystack.includes('samba')) return 'sambanova';
  if (haystack.includes('groq')) return 'groq';
  if (haystack.includes('morphllm') || /\bmorph\b/.test(haystack)) return 'morph';
  if (haystack.includes('cohere')) return 'cohere';
  if (haystack.includes('poolside')) return 'poolside'; // Poolside is OpenAI-compatible  
  return 'openai';
}

/**
 * Type guard that checks whether a string is a supported discovery provider.
 *
 * @param providerId - The provider ID to check.
 * @returns True if the provider has a dedicated fetcher, false otherwise.
 */
function isSupportedDiscoveryProvider(providerId: string): providerId is SupportedDiscoveryProvider {
  return [
    'groq', 'sambanova', 'anthropic', 'gemini', 'mistral', 'openrouter', 'openai', 'morph', 'cohere', 'poolside'
  ].includes(providerId);
}

/**
 * Applies stable priorities after a refresh.
 * Known models keep their existing relative ordering; new models are appended
 * alphabetically with chat models preceding embeddings.
 *
 * @param result - The freshly discovered result to re-prioritize.
 * @param previousModels - The existing models, used to preserve ordering.
 * @returns A new result with deduplicated, stably-prioritized models.
 */
function withStablePriority(
  result: ProviderModelDiscoveryResult,
  previousModels: AiModel[],
): ProviderModelDiscoveryResult {
  const previousOrder = new Map(previousModels.map((m, i) => [m.id, i]));
  const usageOrder: Record<AiModel['usage'], number> = {
    chat: 0,
    transcription: 1,
    tts: 2,
    'image-generation': 3,
    embedding: 4,
  };
  const sorted = [...dedupeModels(result.models)].sort((a, b) => {
    const aKnown = previousOrder.get(a.id);
    const bKnown = previousOrder.get(b.id);
    if (aKnown !== undefined && bKnown !== undefined) return aKnown - bKnown;
    if (aKnown !== undefined) return -1;
    if (bKnown !== undefined) return 1;
    const usageDiff = (usageOrder[a.usage] ?? 99) - (usageOrder[b.usage] ?? 99);
    if (usageDiff !== 0) return usageDiff;
    return a.id.localeCompare(b.id);
  });

  return { models: renumberPriorities(sorted), notes: result.notes };
}

/**
 * Removes duplicate models by `id`, keeping the first occurrence.
 *
 * @param models - The array of models to de-duplicate.
 * @returns A new array with duplicates removed.
 */
function dedupeModels(models: AiModel[]): AiModel[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * Wrapper around `fetch` that throws a descriptive error on non-2xx responses.
 *
 * @param url - The fully-qualified URL to fetch.
 * @param init - The fetch request options.
 * @param providerName - Human-readable provider name for error messages.
 * @returns The parsed JSON response body.
 * @throws Error if the response status is not OK.
 */
async function fetchJson(url: URL, init: RequestInit, providerName: string): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `${providerName}: ${response.status} ${response.statusText}${errorText ? ` — ${errorText.slice(0, 240)}` : ''}`,
    );
  }
  return response.json();
}

/**
 * Builds a URL from the provider's endpoint, falling back to a default if the endpoint is empty.
 * Strips any trailing slash from the endpoint.
 *
 * @param provider - The provider configuration.
 * @param fallback - URL to use when the provider has no endpoint set.
 * @returns A parsed URL object.
 */
function providerBaseUrl(provider: AiProvider, fallback: string): URL {
  const rawEndpoint = provider.endpoint || fallback;
  const endpoint = rawEndpoint.endsWith('/') ? rawEndpoint.slice(0, -1) : rawEndpoint;
  return new URL(endpoint);
}

/**
 * Derives the `/models` endpoint URL from a provider's endpoint.
 * Strips any trailing `/chat/completions` or `/embeddings` path segments
 * before appending `/models`.
 *
 * @param provider - The provider configuration.
 * @param fallback - Default API base URL if the provider has no endpoint.
 * @returns A URL object pointing to the models endpoint.
 */
function modelsUrl(provider: AiProvider, fallback: string): URL {
  const url = providerBaseUrl(provider, fallback);
  url.pathname = url.pathname
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/embeddings\/?$/, '');
  if (!url.pathname.endsWith('/models')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Option B — Provider-specific field extraction
// ---------------------------------------------------------------------------

/**
 * Fetches and normalizes models from an OpenAI-compatible API (Groq / SambaNova).
 *
 * @param provider - The provider configuration containing the endpoint.
 * @param apiKey - The API key for authentication.
 * @param providerName - Either `'groq'` or `'sambanova'` to determine the fallback URL.
 * @returns Normalized model discovery result.
 */
async function fetchOpenAiCompatibleModels(
  provider: AiProvider,
  apiKey: string,
  providerName: 'groq' | 'sambanova',
): Promise<ProviderModelDiscoveryResult> {
  const fallback = providerName === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.sambanova.ai/v1';
  const payload = await fetchJson(
    modelsUrl(provider, fallback),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    providerName,
  );
  const models = arrayFromData(payload).map((item) =>
    normalizeFromOpenAiCompatible(item, 'chat'),
  );
  return { models, notes: [] };
}

/**
 * Fetches and normalizes models from the Anthropic /v1/models endpoint.
 * Uses the Claude family table for context-window and output limits,
 * since Anthropic does not return them in the models response.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The Anthropic API key.
 * @returns Normalized model discovery result with a note about limits.
 */
async function fetchAnthropicModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.anthropic.com/v1'),
    {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    },
    'anthropic',
  );
  // All Claude 3+ models support vision (image input).
  const models = arrayFromData(payload).map((item) => {
    const id = stringField(item, 'id');
    const limits = anthropicLimits(id);
    return model(
      id,
      'chat',
      limits.contextWindow,
      limits.maxOutputTokens,
      null,
      ['text', 'image'],  // B: Anthropic documents all Claude 3+ as vision-capable
      ['text'],
    );
  });

  return {
    models,
    notes: ['Anthropic does not return limits in /v1/models; limits come from the Claude family table.'],
  };
}

/**
 * Fetches and normalizes models from the Google Gemini API.
 * The API key is sent as a query parameter (not a header).
 * Modality inference falls back to heuristics since Gemini does not expose modalities.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The Gemini API key.
 * @returns Normalized model discovery result.
 */
async function fetchGeminiModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const url = modelsUrl(provider, 'https://generativelanguage.googleapis.com/v1beta');
  url.searchParams.set('key', apiKey);
  const payload = await fetchJson(url, {}, 'gemini');
  const records = arrayFromField(payload, 'models');
  const models = records
    .map((item) => {
      const rawName = stringField(item, 'name');
      const id = rawName.replace(/^models\//, '');
      const methods = stringArrayField(item, 'supportedGenerationMethods');
      const isEmbedding =
        methods.some((m) => m.toLowerCase().includes('embed')) ||
        id.toLowerCase().includes('embedding');
      const contextWindow = numberField(item, 'inputTokenLimit') ?? 0;
      const maxOutputTokens = isEmbedding ? 0 : numberField(item, 'outputTokenLimit') ?? 0;
      // B: Gemini API does not return modalities; apply heuristics by family name.
      const { inputModalities, outputModalities } = geminiModalitiesFromId(id);
      return model(
        id,
        isEmbedding ? 'embedding' : 'chat',
        contextWindow,
        maxOutputTokens,
        null,
        isEmbedding ? undefined : inputModalities,
        isEmbedding ? undefined : outputModalities,
      );
    })
    .filter((m) => m.contextWindow > 0);

  return { models, notes: [] };
}

/**
 * Fetches and normalizes models from the Mistral API.
 * Uses the Mistral `capabilities` object when available; falls back to
 * ID-based heuristics otherwise.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The Mistral API key.
 * @returns Normalized model discovery result.
 */
async function fetchMistralModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.mistral.ai/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'mistral',
  );
  const models = arrayFromData(payload)
    .map((item) => {
      const id = stringField(item, 'id');
      const { usage, inputModalities, outputModalities } = mistralCapabilitiesFromItem(item, id);
      const contextWindow = numberField(item, 'max_context_length') ?? 0;
      const maxOutputTokens =
        usage === 'embedding'
          ? 0
          : numberField(item, 'max_output_tokens') ??
          numberField(item, 'max_completion_tokens') ??
          contextWindow;
      return model(id, usage, contextWindow, maxOutputTokens, null, inputModalities, outputModalities);
    })
    .filter((m) => m.contextWindow > 0 || m.usage === 'embedding');

  return {
    models,
    notes: ['Mistral does not always return a distinct output limit; max_context_length is used as fallback.'],
  };
}

/**
 * Fetches and normalizes models from the OpenRouter API.
 * OpenRouter provides explicit modalities via its `architecture` field.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The OpenRouter API key.
 * @param freeOnly - When true, filter to models with `":free"` in the ID.
 * @returns Normalized model discovery result.
 */
async function fetchOpenRouterModels(
  provider: AiProvider,
  apiKey: string,
  freeOnly = false,
): Promise<ProviderModelDiscoveryResult> {
  const url = modelsUrl(provider, 'https://openrouter.ai/api/v1');
  url.searchParams.set('output_modalities', 'all');
  const payload = await fetchJson(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'openrouter',
  );
  const models = arrayFromData(payload)
    .filter((item) => !freeOnly || stringField(item, 'id').includes(':free'))
    .map((item) => {
      const id = stringField(item, 'id');
      const topProvider = recordField(item, 'top_provider');
      const architecture = recordField(item, 'architecture');
      // B: OpenRouter provides explicit modalities in architecture.
      const { usage, inputModalities, outputModalities } = openRouterCapabilitiesFromItem(item, architecture);
      const contextWindow =
        numberField(topProvider, 'context_length') ?? numberField(item, 'context_length') ?? 0;
      const maxOutputTokens =
        usage === 'embedding'
          ? 0
          : numberField(topProvider, 'max_completion_tokens') ??
          numberField(item, 'max_completion_tokens') ??
          contextWindow;

      // Extract additional capabilities from the API response
      const pricing = recordField(item, 'pricing');
      const supportedParameters = stringArrayField(item, 'supported_parameters');

      // Determine support for various features
      const supportsImages = inputModalities?.includes('image') ?? false;
      const supportsPromptCache = numberField(pricing, 'input_cache_read') !== null;
      const supportsTools = supportedParameters.includes('tool_choice') || supportedParameters.includes('tools');
      const supportsReasoning = supportedParameters.includes('structured_outputs') || supportedParameters.includes('reasoning');

      return model(
        id,
        usage,
        contextWindow,
        maxOutputTokens,
        null,
        inputModalities,
        outputModalities,
        supportsImages,
        supportsPromptCache,
        supportsTools,
        supportsReasoning
      );
    });

  return {
    models,
    notes: freeOnly ? ['Only models with ":free" in their name have been synchronized.'] : [],
  };
}

/**
 * Fetches and normalizes models from the OpenAI /v1/models endpoint.
 * Since OpenAI does not return limits, recognized models are enriched
 * with documented context-window and output-token limits from a local table.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The OpenAI API key.
 * @returns Normalized model discovery result.
 */
async function fetchOpenAiModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.openai.com/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'openai',
  );
  const models = arrayFromData(payload)
    .map((item) => openAiModelFromId(stringField(item, 'id')))
    .filter((m): m is AiModel => m !== null);

  return {
    models,
    notes: ['OpenAI /v1/models does not return limits; recognized chat/embedding models are enriched from documented limits.'],
  };
}


// Poolside AI needs to be proxied via the Worker's corsproxy endpoint.
/**
 * Fetches and normalizes models from the Poolside AI API.
 * Poolside requires a CORS proxy (the Worker's `/v1/keypool/corsproxy`) and
 * an additional `X-Proxy-Authorization` header for the user's own key.
 *
 * @param _provider - The provider configuration (unused; URL is hardcoded).
 * @param apiKey - The vault API key for authentication with the Worker.
 * @param userApiKey - The user's own API key, passed via `X-Proxy-Authorization`.
 * @returns Normalized model discovery result.
 */
async function fetchPoolsideModels(
  _provider: AiProvider,
  apiKey: string,
  userApiKey: string | null,
): Promise<ProviderModelDiscoveryResult> {
  const url = new URL(`${import.meta.env.VAULT_URL}/v1/keypool/corsproxy?url=https://inference.poolside.ai/v1/models`);
  console.log(`fetchPoolsideModels called with userApiKey: ${userApiKey} url= ${url}`);
  const payload = await fetchJson(
    url,
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "X-Proxy-Authorization": `Bearer ${userApiKey}`
      }
    },

    'poolside',
  );
  const records = arrayFromData(payload);
  const models = records.map((item): AiModel | null => {
    const id = stringField(item, 'id');
    if (!id) return null;

    const usage = inferUsageFromId(id);
    if (!usage) return null;

    const contextWindow = numberField(item, 'context_length') ?? 0;
    const maxOutputTokens = numberField(item, 'max_completion_tokens') ?? 32768;
    const inputModalities = stringArrayField(item, 'input_modalities');
    const outputModalities = stringArrayField(item, 'output_modalities');
    const supportedFeatures = stringArrayField(item, 'supported_features');
    const tags = supportedFeatures.length > 0 ? supportedFeatures : undefined;

    if (usage === 'embedding') {
      return model(id, 'embedding', contextWindow, 0, null, ['text'] as AiModalityInput[], ['text'] as AiModalityOutput[]);
    }

    return model(
      id,
      'chat',
      contextWindow,
      maxOutputTokens,
      null,
      modalityInputArray(inputModalities.length > 0 ? inputModalities : ['text']),
      modalityOutputArray(outputModalities.length > 0 ? outputModalities : ['text']),
      undefined, // supportsImages
      undefined, // supportsPromptCache
      supportedFeatures?.includes('tools'),
      supportedFeatures?.includes('reasoning'),
      tags
    );
  }).filter((m): m is AiModel => m !== null);

  return {
    models,
    notes: [],
  };
}

/**
 * Fetches and normalizes models from the Morph API (OpenAI-compatible).
 * Enriches known model families with documented limits.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The Morph API key.
 * @returns Normalized model discovery result.
 */
async function fetchMorphModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.morphllm.com/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'morph',
  );
  const models = arrayFromData(payload)
    .map((item) => morphModelFromId(stringField(item, 'id'), item))
    .filter((m): m is AiModel => m !== null);

  return {
    models,
    notes: ['Morph is enriched by model family when /v1/models does not return limits.'],
  };
}

/**
 * Fetches and normalizes models from the Cohere API.
 * Determines usage (chat/embedding/transcription) and capabilities from endpoints and features fields.
 *
 * @param provider - The provider configuration.
 * @param apiKey - The Cohere API key.
 * @returns Normalized model discovery result.
 */
async function fetchCohereModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const payload = await fetchJson(
    modelsUrl(provider, 'https://api.cohere.ai/v1'),
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'cohere',
  );

  const models = arrayFromField(payload, 'models')
    .map((item) => {
      const id = stringField(item, 'name');
      const endpoints = stringArrayField(item, 'endpoints');
      const features = stringArrayField(item, 'features');
      const contextLength = numberField(item, 'context_length') ?? 0;

      // Determine usage based on endpoints
      let usage: AiModel['usage'] = 'chat';
      if (endpoints.includes('embed') || id.toLowerCase().includes('embed')) {
        usage = 'embedding';
      } else if (endpoints.includes('transcriptions')) {
        usage = 'transcription';
      }

      // Determine input/output modalities based on features
      const inputModalities: AiModalityInput[] = ['text'];
      const outputModalities: AiModalityOutput[] = ['text'];

      if (features.includes('vision')) {
        inputModalities.push('image');
      }
      if (features.includes('tool_images')) {
        outputModalities.push('image');
      }

      return model(
        id,
        usage,
        contextLength,
        contextLength, // Cohere does not provide a separate maxOutputTokens, so use contextLength as a fallback
        null,
        inputModalities,
        outputModalities,
        features.includes('vision'),
        undefined, // supportsPromptCache: Cohere doesn't explicitly return this in /models features
        features.includes('tools'),
        features.includes('reasoning'),
      );
    })
    .filter((m) => m.contextWindow > 0 || m.usage === 'embedding');

  return { models, notes: [] };
}

// ---------------------------------------------------------------------------
// Option C — Heuristic modality inference from model ID
// ---------------------------------------------------------------------------

/** Result of inferring modalities and usage from a model ID. */
interface ModalityResult {
  /** Input modalities the model accepts (e.g. `['text', 'image']`). */
  inputModalities: AiModalityInput[];
  /** Output modalities the model can produce. */
  outputModalities: AiModalityOutput[];
  /** The usage type (chat, embedding, tts, etc.). */
  usage: AiModel['usage'];
}

/**
 * Infers modalities and usage from the model ID alone.
 * Applied as a fallback (Option C) when the provider API does not return capability info.
 *
 * @param id - The model identifier (e.g. `"gpt-4o"`, `"whisper-1"`).
 * @param defaultUsage - The fallback usage type when the ID doesn't match a specific pattern.
 * @returns An object containing the inferred input/output modalities and usage type.
 */
function inferModalitiesFromId(
  id: string,
  defaultUsage: AiModel['usage'] = 'chat',
): ModalityResult {
  const lower = id.toLowerCase();

  // Transcription (audio-in, text-out)
  if (/whisper|transcri/.test(lower)) {
    return { inputModalities: ['audio'], outputModalities: ['text'], usage: 'transcription' };
  }

  // TTS (text-in, audio-out) — voxtral-*-tts, orpheus, tts-1, etc.
  if (/voxtral[^/]*tts|orpheus|^tts[-_]/.test(lower)) {
    return { inputModalities: ['text'], outputModalities: ['audio'], usage: 'tts' };
  }

  // Image generation (text-in, image-out)
  if (/dall[-_]e|stable[-_]diffusion|flux|imagen|image[-_]gen/.test(lower)) {
    return { inputModalities: ['text'], outputModalities: ['image'], usage: 'image-generation' };
  }

  // Voxtral audio chat (text+audio-in, text-out) — not TTS variants
  if (/voxtral/.test(lower)) {
    return { inputModalities: ['text', 'audio'], outputModalities: ['text'], usage: defaultUsage };
  }

  // OCR / document understanding (text+image-in, text-out)
  if (/ocr/.test(lower)) {
    return { inputModalities: ['text', 'image'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Vision / multimodal models
  if (/vision|pixtral|llava|llama-3\.2.*(11b|90b)|llama-4[-_](scout|maverick)|nemotron.*vl|gpt-4o|gpt-5/.test(lower)) {
    return { inputModalities: ['text', 'image'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Gemini multimodal families
  if (/gemini[-_]?2\.|gemini[-_]?1\.5/.test(lower)) {
    return { inputModalities: ['text', 'image', 'audio', 'video'], outputModalities: ['text'], usage: defaultUsage };
  }

  // Default — text only
  return { inputModalities: ['text'], outputModalities: ['text'], usage: defaultUsage };
}

// ---------------------------------------------------------------------------
// Option B helpers — provider-specific capability extraction
// ---------------------------------------------------------------------------

/**
 * Maps Mistral capability fields to playground modalities and usage.
 *
 * @param item - The raw model object from the Mistral API.
 * @param id - The model ID string.
 * @returns The inferred modalities and usage type.
 */
function mistralCapabilitiesFromItem(
  item: JsonRecord,
  id: string,
): ModalityResult {
  // C fallback: if Mistral did not return a capabilities object at all, use heuristics.
  // But when the capabilities object IS present (even all-false), trust the API — don't
  // let a vision-sounding name override an explicit API "vision: false".
  const hasCapabilitiesObject = isRecord(item['capabilities']);
  if (!hasCapabilitiesObject) {
    return inferModalitiesFromId(id, 'chat');
  }

  const capabilities = recordField(item, 'capabilities');

  // Embedding type check
  if (
    stringField(item, 'type').toLowerCase().includes('embedding') ||
    id.toLowerCase().includes('embed') ||
    capabilities.embedding === true
  ) {
    return { inputModalities: ['text'], outputModalities: ['text'], usage: 'embedding' };
  }

  // B: Use Mistral capability flags directly
  const hasAudioTranscription =
    capabilities.audio_transcription === true ||
    capabilities.audio_transcription_realtime === true;
  const hasAudioSpeech = capabilities.audio_speech === true;
  const hasAudio = capabilities.audio === true;
  const hasVision = capabilities.vision === true || capabilities.ocr === true;

  if (hasAudioTranscription) {
    return { inputModalities: ['audio'], outputModalities: ['text'], usage: 'transcription' };
  }
  if (hasAudioSpeech && !hasAudio) {
    return { inputModalities: ['text'], outputModalities: ['audio'], usage: 'tts' };
  }

  const inputModalities: AiModalityInput[] = ['text'];
  if (hasVision) inputModalities.push('image');
  if (hasAudio || hasAudioSpeech) inputModalities.push('audio');

  const outputModalities: AiModalityOutput[] = ['text'];
  if (hasAudioSpeech) outputModalities.push('audio');

  return { inputModalities, outputModalities, usage: 'chat' };
}

/**
 * Maps OpenRouter architecture fields to playground modalities and usage.
 *
 * @param item - The raw model object from the OpenRouter API.
 * @param architecture - The architecture sub-object containing modality info.
 * @returns The inferred modalities and usage type.
 */
function openRouterCapabilitiesFromItem(
  item: JsonRecord,
  architecture: JsonRecord,
): ModalityResult {
  const outputMods = stringArrayField(architecture, 'output_modalities');
  const inputMods = stringArrayField(architecture, 'input_modalities');
  const modality = stringField(architecture, 'modality').toLowerCase();
  const id = stringField(item, 'id');

  // Embedding detection
  if (
    outputMods.some((m) => m.toLowerCase().includes('embedding')) ||
    modality.includes('embedding') ||
    id.toLowerCase().includes('embed')
  ) {
    return { inputModalities: ['text'], outputModalities: ['text'], usage: 'embedding' };
  }

  // B: Direct mapping from OpenRouter architecture fields
  if (inputMods.length > 0 || outputMods.length > 0) {
    const inputModalities = mapOpenRouterModalities<AiModalityInput>(
      inputMods,
      ['text', 'image', 'audio', 'video'],
    );
    const outputModalities = mapOpenRouterModalities<AiModalityOutput>(
      outputMods,
      ['text', 'image', 'audio'],
    );

    const hasOnlyAudioOut = outputModalities.length === 1 && outputModalities[0] === 'audio';
    const usage: AiModel['usage'] = hasOnlyAudioOut ? 'tts' : 'chat';

    return {
      inputModalities: inputModalities.length > 0 ? inputModalities : ['text'],
      outputModalities: outputModalities.length > 0 ? outputModalities : ['text'],
      usage,
    };
  }

  // C fallback
  return inferModalitiesFromId(id, 'chat');
}

/**
 * Filters and normalizes a raw modality string array against an allowed set.
 *
 * @param raw - The raw string array from the provider response.
 * @param allowed - The allowed modality values for this type.
 * @returns A filtered, lowercased array of valid modalities.
 */
function mapOpenRouterModalities<T extends string>(
  raw: string[],
  allowed: T[],
): T[] {
  const result: T[] = [];
  for (const entry of raw) {
    const normalized = entry.toLowerCase() as T;
    if (allowed.includes(normalized)) result.push(normalized);
  }
  return result;
}

/**
 * Applies Gemini-family heuristics — the Gemini API does not expose modalities.
 *
 * @param id - The model ID (e.g. `"gemini-2.0-flash"`).
 * @returns The input and output modalities inferred from the model family.
 */
function geminiModalitiesFromId(id: string): { inputModalities: AiModalityInput[]; outputModalities: AiModalityOutput[] } {
  const lower = id.toLowerCase();
  // Gemini 2.x and 1.5 are multimodal
  if (/gemini[-_]?2\.|gemini[-_]?1\.5/.test(lower)) {
    return { inputModalities: ['text', 'image', 'audio', 'video'], outputModalities: ['text'] };
  }
  // Gemini 1.0 Pro — text only
  return { inputModalities: ['text'], outputModalities: ['text'] };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a single OpenAI-compatible model object into an `AiModel`.
 * Uses heuristics (Option C) to infer modalities from the model ID.
 *
 * @param item - The raw model object from the provider.
 * @param defaultUsage - The default usage type (`'chat'` or `'embedding'`).
 * @returns A normalized `AiModel`.
 */
function normalizeFromOpenAiCompatible(
  item: JsonRecord,
  defaultUsage: 'chat' | 'embedding',
): AiModel {
  const id = stringField(item, 'id');
  const { usage, inputModalities, outputModalities } = inferModalitiesFromId(id, defaultUsage);
  const contextWindow =
    numberField(item, 'context_window') ??
    numberField(item, 'context_length') ??
    numberField(item, 'max_context_length') ??
    0;
  const maxOutputTokens =
    usage === 'embedding'
      ? 0
      : numberField(item, 'max_completion_tokens') ??
      numberField(item, 'max_output_tokens') ??
      contextWindow;
  return model(id, usage, contextWindow, maxOutputTokens, null, inputModalities, outputModalities);
}

/**
 * Factory function that builds an `AiModel` object, normalizing numeric values
 * and conditionally including optional capability fields.
 *
 * @param id - The model identifier.
 * @param usage - The model's usage class.
 * @param contextWindow - Context window size in tokens.
 * @param maxOutputTokens - Maximum output tokens.
 * @param tpmLimit - Tokens-per-minute limit, or `null` for unlimited.
 * @param inputModalities - Optional input modalities array.
 * @param outputModalities - Optional output modalities array.
 * @param supportsImages - Whether the model supports image inputs.
 * @param supportsPromptCache - Whether the model supports prompt caching.
 * @param supportsTools - Whether the model supports tools/function calling.
 * @param supportsReasoning - Whether the model supports advanced reasoning.
 * @param tags - Optional tags for filtering or display.
 * @returns A fully-formed `AiModel` object.
 */
function model(
  id: string,
  usage: AiModel['usage'],
  contextWindow: number,
  maxOutputTokens: number,
  tpmLimit: number | null,
  inputModalities?: AiModalityInput[],
  outputModalities?: AiModalityOutput[],
  supportsImages?: boolean,
  supportsPromptCache?: boolean,
  supportsTools?: boolean,
  supportsReasoning?: boolean,
  tags?: string[],
): AiModel {
  return {
    id,
    usage,
    contextWindow: Math.max(0, Math.trunc(contextWindow)),
    maxOutputTokens: Math.max(0, Math.trunc(maxOutputTokens)),
    tpmLimit,
    priority: 0,
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
    ...(supportsPromptCache !== undefined ? { supportsPromptCache } : {}),
    ...(supportsTools !== undefined ? { supportsTools } : {}),
    ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
    ...(tags ? { tags } : {}),
  };
}

/**
 * Extracts the `data` array from a provider response payload.
 * Handles both bare arrays and `{ data: [...] }` wrappers.
 *
 * @param payload - The raw provider response.
 * @returns An array of JSON record objects.
 */
function arrayFromData(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  return [];
}

/**
 * Extracts a named field that holds an array of JSON records from a payload.
 *
 * @param payload - The raw provider response.
 * @param field - The field name to extract (e.g. `"models"`).
 * @returns An array of JSON record objects, or an empty array if the field is absent.
 */
function arrayFromField(payload: unknown, field: string): JsonRecord[] {
  if (isRecord(payload) && Array.isArray(payload[field])) {
    return (payload[field] as unknown[]).filter(isRecord);
  }
  return [];
}

/**
 * Type guard that checks whether a value is a plain JSON object (not an array or null).
 *
 * @param value - The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Safely extracts a nested object field from a JSON record.
 *
 * @param value - The parent JSON record.
 * @param field - The field name to extract.
 * @returns The nested record, or an empty object if the field is absent or not an object.
 */
function recordField(value: JsonRecord, field: string): JsonRecord {
  const nested = value[field];
  return isRecord(nested) ? nested : {};
}

/**
 * Safely extracts a string field from a JSON record, returning `""` if missing.
 *
 * @param value - The JSON record to read from.
 * @param field - The field name to extract.
 * @returns The string value, or an empty string if the field is absent or not a string.
 */
function stringField(value: JsonRecord, field: string): string {
  const v = value[field];
  return typeof v === 'string' ? v : '';
}

/**
 * Safely extracts a numeric field from a JSON record.
 * Accepts both numbers and numeric strings.
 *
 * @param value - The JSON record to read from.
 * @param field - The field name to extract.
 * @returns The parsed number, or `null` if the field is absent, non-numeric, or not finite.
 */
function numberField(value: JsonRecord, field: string): number | null {
  const v = value[field];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Safely extracts a string array from a JSON record, filtering out non-string entries.
 *
 * @param value - The JSON record to read from.
 * @param field - The field name to extract.
 * @returns An array of strings, or an empty array if the field is absent or not an array.
 */
function stringArrayField(value: JsonRecord, field: string): string[] {
  const v = value[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Converts an array of strings to typed AiModalityInput array.
 *
 * @param arr - The raw string array to filter.
 * @returns A filtered array containing only valid `AiModalityInput` values.
 */
function modalityInputArray(arr: string[]): AiModalityInput[] {
  const validInputs: AiModalityInput[] = ['text', 'image', 'audio', 'video'];
  return arr.filter((s): s is AiModalityInput => validInputs.includes(s as AiModalityInput));
}

/**
 * Converts an array of strings to typed AiModalityOutput array.
 *
 * @param arr - The raw string array to filter.
 * @returns A filtered array containing only valid `AiModalityOutput` values.
 */
function modalityOutputArray(arr: string[]): AiModalityOutput[] {
  const validOutputs: AiModalityOutput[] = ['text', 'image', 'audio'];
  return arr.filter((s): s is AiModalityOutput => validOutputs.includes(s as AiModalityOutput));
}

/**
 * Returns the usage type inferred from a model ID.
 * Non-chat/embedding models now return their specialized usage type instead of null.
 *
 * @param id - The model identifier.
 * @returns The inferred usage type, or `null` for models that should be filtered out.
 */
function inferUsageFromId(id: string): AiModel['usage'] | null {
  const lower = id.toLowerCase();
  if (lower.includes('embedding') || lower.includes('embed')) return 'embedding';
  if (/whisper|transcri/.test(lower)) return 'transcription';
  if (/voxtral[^/]*tts|orpheus|^tts[-_]/.test(lower)) return 'tts';
  if (/dall[-_]e|stable[-_]diffusion|flux\b|image[-_]gen/.test(lower)) return 'image-generation';
  if (/moderation|rerank|sora/.test(lower)) return null; // still filtered
  return 'chat';
}

/**
 * Returns the known context-window and output-token limits for a Claude model.
 * Used because Anthropic's /v1/models endpoint does not return these values.
 *
 * @param id - The Claude model ID (e.g. `"claude-3-5-sonnet-20241022"`).
 * @returns An object with `contextWindow` and `maxOutputTokens` in tokens.
 */
function anthropicLimits(id: string): { contextWindow: number; maxOutputTokens: number } {
  if (id.includes('claude-3-7-sonnet')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-sonnet-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-opus-4')) return { contextWindow: 200_000, maxOutputTokens: 32_000 };
  if (id.includes('claude-3-5-haiku')) return { contextWindow: 200_000, maxOutputTokens: 8_192 };
  if (id.includes('claude-3-haiku')) return { contextWindow: 200_000, maxOutputTokens: 4_096 };
  if (id.includes('claude-haiku-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  return { contextWindow: 200_000, maxOutputTokens: 8_192 };
}

/**
 * Enriches a model ID from the OpenAI API with documented limits and modalities.
 * Uses a local table of known family prefixes to assign context windows and
 * output limits (Option C — OpenAI /v1/models does not return these).
 *
 * @param id - The model identifier (e.g. `"gpt-4o"`, `"text-embedding-3-small"`).
 * @returns A normalized `AiModel`, or `null` if the model is not recognized.
 */
function openAiModelFromId(id: string): AiModel | null {
  const usage = inferUsageFromId(id);
  if (!usage) return null;
  const { inputModalities, outputModalities } = inferModalitiesFromId(id, usage === 'chat' ? 'chat' : usage);
  if (usage === 'embedding') return model(id, 'embedding', 8_192, 0, null, ['text'], ['text']);
  if (usage === 'transcription') return model(id, 'transcription', 0, 0, null, inputModalities, outputModalities);
  if (usage === 'tts') return model(id, 'tts', 0, 0, null, inputModalities, outputModalities);
  if (usage === 'image-generation') return model(id, 'image-generation', 0, 0, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-5.2') || id.startsWith('gpt-5.1-codex')) return model(id, 'chat', 400_000, 128_000, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-5')) return model(id, 'chat', 400_000, 128_000, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-4.1')) return model(id, 'chat', 1_047_576, 32_768, null, inputModalities, outputModalities);
  if (id.startsWith('gpt-4o')) return model(id, 'chat', 128_000, 16_384, null, ['text', 'image'], ['text']);
  if (id.startsWith('gpt-4-turbo')) return model(id, 'chat', 128_000, 4_096, null, ['text', 'image'], ['text']);
  if (id.startsWith('gpt-4')) return model(id, 'chat', 8_192, 8_192, null, ['text'], ['text']);
  if (id.startsWith('gpt-3.5-turbo-16k')) return model(id, 'chat', 16_385, 4_096, null, ['text'], ['text']);
  if (id.startsWith('gpt-3.5-turbo')) return model(id, 'chat', 16_385, 4_096, null, ['text'], ['text']);
  if (id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o1')) return model(id, 'chat', 200_000, 100_000, null, ['text'], ['text']);
  if (id.startsWith('gpt-oss')) return model(id, 'chat', 131_072, 131_072, null, ['text'], ['text']);
  return null;
}

/**
 * Enriches a model ID from the Morph API with documented limits and modalities.
 * Uses the API response fields for limits, falling back to family-specific defaults.
 *
 * @param id - The model identifier.
 * @param item - The raw model object from the Morph API.
 * @returns A normalized `AiModel`, or `null` if the model should be filtered out.
 */
function morphModelFromId(id: string, item: JsonRecord): AiModel | null {
  const usage = inferUsageFromId(id);
  if (!usage) return null;
  const contextWindow =
    numberField(item, 'context_window') ??
    numberField(item, 'context_length') ??
    numberField(item, 'max_context_length');
  const maxOutputTokens =
    numberField(item, 'max_completion_tokens') ?? numberField(item, 'max_output_tokens');
  if (usage === 'embedding') return model(id, 'embedding', contextWindow ?? 8_192, 0, null, ['text'], ['text']);
  if (id.includes('dsv4flash')) return model(id, 'chat', contextWindow ?? 393_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
  if (id.startsWith('morph-v3')) return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
  return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null, ['text'], ['text']);
}
