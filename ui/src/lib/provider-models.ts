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
 */

import type { AiModel, AiModalityInput, AiModalityOutput, AiProvider } from '../types/ai-config';

/** Providers whose public APIs are explicitly handled by this file. */
export type SupportedDiscoveryProvider =
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'openai'
  | 'morph'
  | 'cohere';

/** Result returned to the UI after a provider catalogue has been normalized. */
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
 */
export function canDiscoverProviderModels(providerId: string, provider: AiProvider): boolean {
  return isSupportedDiscoveryProvider(canonicalProviderId(providerId, provider));
}

/**
 * Builds a compact label for the API key used by the sync action.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Reassigns priorities from the current visual order. */
export function renumberPriorities(models: AiModel[]): AiModel[] {
  return models.map((model, index) => ({ ...model, priority: index * 10 }));
}

/**
 * Infers the provider implementation from the vault key, protocol, endpoint,
 * and gateway prefix.
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
  return 'openai';
}

function isSupportedDiscoveryProvider(providerId: string): providerId is SupportedDiscoveryProvider {
  return [
    'groq', 'sambanova', 'anthropic', 'gemini', 'mistral', 'openrouter', 'openai', 'morph', 'cohere',
  ].includes(providerId);
}

/**
 * Applies stable priorities after a refresh.
 * Known models keep their existing relative ordering; new models are appended
 * alphabetically with chat models preceding embeddings.
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

function dedupeModels(models: AiModel[]): AiModel[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

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

function providerBaseUrl(provider: AiProvider, fallback: string): URL {
  const rawEndpoint = provider.endpoint || fallback;
  const endpoint = rawEndpoint.endsWith('/') ? rawEndpoint.slice(0, -1) : rawEndpoint;
  return new URL(endpoint);
}

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

interface ModalityResult {
  inputModalities: AiModalityInput[];
  outputModalities: AiModalityOutput[];
  usage: AiModel['usage'];
}

/**
 * Infers modalities and usage from the model ID alone.
 * Applied as a fallback when the provider API does not return capability info.
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

/** Maps Mistral capability fields to playground modalities and usage. */
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

/** Maps OpenRouter architecture fields to playground modalities and usage. */
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

/** Applies Gemini-family heuristics — the Gemini API does not expose modalities. */
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
  };
}

function arrayFromData(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  return [];
}

function arrayFromField(payload: unknown, field: string): JsonRecord[] {
  if (isRecord(payload) && Array.isArray(payload[field])) {
    return (payload[field] as unknown[]).filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordField(value: JsonRecord, field: string): JsonRecord {
  const nested = value[field];
  return isRecord(nested) ? nested : {};
}

function stringField(value: JsonRecord, field: string): string {
  const v = value[field];
  return typeof v === 'string' ? v : '';
}

function numberField(value: JsonRecord, field: string): number | null {
  const v = value[field];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringArrayField(value: JsonRecord, field: string): string[] {
  const v = value[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Returns the usage type inferred from a model ID.
 * Non-chat/embedding models now return their specialized usage type instead of null.
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

function anthropicLimits(id: string): { contextWindow: number; maxOutputTokens: number } {
  if (id.includes('claude-3-7-sonnet')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-sonnet-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  if (id.includes('claude-opus-4')) return { contextWindow: 200_000, maxOutputTokens: 32_000 };
  if (id.includes('claude-3-5-haiku')) return { contextWindow: 200_000, maxOutputTokens: 8_192 };
  if (id.includes('claude-3-haiku')) return { contextWindow: 200_000, maxOutputTokens: 4_096 };
  if (id.includes('claude-haiku-4')) return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  return { contextWindow: 200_000, maxOutputTokens: 8_192 };
}

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
