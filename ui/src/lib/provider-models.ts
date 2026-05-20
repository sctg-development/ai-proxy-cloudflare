/**
 * @file Provider model discovery for the vault UI.
 *
 * Each provider exposes its catalogue with slightly different response shapes:
 * OpenAI-compatible APIs usually return `data`, Gemini returns `models`,
 * Anthropic paginates with `data` but omits token limits, and OpenRouter nests
 * provider-specific limits under `top_provider`.
 *
 * This module keeps those differences out of React components. It always
 * returns the vault's normalized `AiModel` shape, with:
 * - `usage`: only `chat` or `embedding`, because those are the proxy-supported
 *   routing classes today.
 * - `contextWindow`: the maximum input+output context when the provider gives
 *   one, or a documented fallback for providers whose list endpoint is sparse.
 * - `maxOutputTokens`: the provider's generation cap when exposed; embedding
 *   models use `0` because they do not generate completion tokens.
 */

import type { AiModel, AiProvider } from '../types/ai-config';

/** Providers whose public APIs are explicitly handled by this file. */
export type SupportedDiscoveryProvider =
  | 'groq'
  | 'sambanova'
  | 'anthropic'
  | 'gemini'
  | 'mistral'
  | 'openrouter'
  | 'openai'
  | 'morph';

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
 *
 * @param providerId The key used in `ai.json.providers`.
 * @param provider The provider configuration from the current vault.
 * @param apiKey A non-expired API key selected by the user/config.
 * @param previousModels Existing models, used only to preserve user ordering
 *   when a fetched model already exists in the vault.
 */
export async function discoverProviderModels(
  providerId: string,
  provider: AiProvider,
  apiKey: string,
  previousModels: AiModel[],
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
      return withStablePriority(await fetchOpenRouterModels(provider, apiKey), previousModels);
    case 'openai':
      return withStablePriority(await fetchOpenAiModels(provider, apiKey), previousModels);
    case 'morph':
      return withStablePriority(await fetchMorphModels(provider, apiKey), previousModels);
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
 * Unknown providers can still be edited manually.
 */
export function canDiscoverProviderModels(providerId: string, provider: AiProvider): boolean {
  return isSupportedDiscoveryProvider(canonicalProviderId(providerId, provider));
}

/**
 * Builds a compact label for the API key used by the sync action.
 * The full key is never rendered into the DOM.
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
 * and gateway prefix. This makes sync robust when users name providers like
 * `openai-primary` or `team-groq` instead of exactly `openai` or `groq`.
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
  return 'openai';
}

function isSupportedDiscoveryProvider(providerId: string): providerId is SupportedDiscoveryProvider {
  return [
    'groq',
    'sambanova',
    'anthropic',
    'gemini',
    'mistral',
    'openrouter',
    'openai',
    'morph',
  ].includes(providerId);
}

/**
 * Applies stable priorities after a refresh:
 * - known models keep their existing relative ordering;
 * - newly discovered models are appended alphabetically inside their usage
 *   class so chat models remain ahead of embeddings by default.
 */
function withStablePriority(
  result: ProviderModelDiscoveryResult,
  previousModels: AiModel[],
): ProviderModelDiscoveryResult {
  const previousOrder = new Map(previousModels.map((model, index) => [model.id, index]));
  const sorted = [...dedupeModels(result.models)].sort((left, right) => {
    const leftKnown = previousOrder.get(left.id);
    const rightKnown = previousOrder.get(right.id);
    if (leftKnown !== undefined && rightKnown !== undefined) return leftKnown - rightKnown;
    if (leftKnown !== undefined) return -1;
    if (rightKnown !== undefined) return 1;
    if (left.usage !== right.usage) return left.usage === 'chat' ? -1 : 1;
    return left.id.localeCompare(right.id);
  });

  return {
    models: renumberPriorities(sorted),
    notes: result.notes,
  };
}

/** Removes duplicate model IDs while keeping the first normalized record. */
function dedupeModels(models: AiModel[]): AiModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/** Fetches and parses JSON with provider-aware error messages. */
async function fetchJson(url: URL, init: RequestInit, providerName: string): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `${providerName}: ${response.status} ${response.statusText}${
        errorText ? ` — ${errorText.slice(0, 240)}` : ''
      }`,
    );
  }
  return response.json();
}

/** Returns a provider base URL without trailing slashes or endpoint suffixes. */
function providerBaseUrl(provider: AiProvider, fallback: string): URL {
  const rawEndpoint = provider.endpoint || fallback;
  const endpoint = rawEndpoint.endsWith('/') ? rawEndpoint.slice(0, -1) : rawEndpoint;
  return new URL(endpoint);
}

/** Appends `/models` to OpenAI-compatible base URLs without duplicating it. */
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

/**
 * Handles Groq and SambaNova, which both expose useful model limits through
 * an OpenAI-compatible `GET /models` response.
 */
async function fetchOpenAiCompatibleModels(
  provider: AiProvider,
  apiKey: string,
  providerName: 'groq' | 'sambanova',
): Promise<ProviderModelDiscoveryResult> {
  const fallback =
    providerName === 'groq'
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
 * Anthropic's List Models endpoint returns availability metadata but not
 * context/output limits, so documented limits are applied by model family.
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
  const models = arrayFromData(payload).map((item) => {
    const id = stringField(item, 'id');
    const limits = anthropicLimits(id);
    return model(id, 'chat', limits.contextWindow, limits.maxOutputTokens, null);
  });

  return {
    models,
    notes: [
      'Anthropic ne renvoie pas les limites dans /v1/models; les limites viennent de la table officielle des familles Claude.',
    ],
  };
}

/**
 * Gemini returns rich per-model metadata directly from `GET /v1beta/models`.
 * The API key is passed as `?key=...`, which is the documented REST style and
 * avoids custom auth headers in browsers.
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
        methods.some((method) => method.toLowerCase().includes('embed')) ||
        id.toLowerCase().includes('embedding');
      const contextWindow = numberField(item, 'inputTokenLimit') ?? 0;
      const maxOutputTokens = isEmbedding ? 0 : numberField(item, 'outputTokenLimit') ?? 0;
      return model(id, isEmbedding ? 'embedding' : 'chat', contextWindow, maxOutputTokens, null);
    })
    .filter((item) => item.contextWindow > 0);

  return { models, notes: [] };
}

/**
 * Mistral exposes `max_context_length` and model capabilities. The list API
 * does not consistently expose a separate output cap, so `maxOutputTokens`
 * uses explicit output fields when present and otherwise falls back to the
 * context length, matching Mistral's documented request constraint.
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
      const usage = inferMistralUsage(item, id);
      const contextWindow = numberField(item, 'max_context_length') ?? 0;
      const maxOutputTokens =
        usage === 'embedding'
          ? 0
          : numberField(item, 'max_output_tokens') ??
            numberField(item, 'max_completion_tokens') ??
            contextWindow;
      return model(id, usage, contextWindow, maxOutputTokens, null);
    })
    .filter((item) => item.contextWindow > 0 || item.usage === 'embedding');

  return {
    models,
    notes: [
      'Mistral ne renvoie pas toujours un plafond de sortie distinct; la sortie reprend max_context_length quand aucun champ plus précis n’existe.',
    ],
  };
}

/**
 * OpenRouter exposes context and output limits with the most detailed shape of
 * all supported routers. `output_modalities=all` is used so embedding models
 * are not hidden by the default text-only filter.
 */
async function fetchOpenRouterModels(
  provider: AiProvider,
  apiKey: string,
): Promise<ProviderModelDiscoveryResult> {
  const url = modelsUrl(provider, 'https://openrouter.ai/api/v1');
  url.searchParams.set('output_modalities', 'all');
  const payload = await fetchJson(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    'openrouter',
  );
  const models = arrayFromData(payload).map((item) => {
    const id = stringField(item, 'id');
    const topProvider = recordField(item, 'top_provider');
    const architecture = recordField(item, 'architecture');
    const usage = inferOpenRouterUsage(item, architecture);
    const contextWindow =
      numberField(topProvider, 'context_length') ?? numberField(item, 'context_length') ?? 0;
    const maxOutputTokens =
      usage === 'embedding'
        ? 0
        : numberField(topProvider, 'max_completion_tokens') ??
          numberField(item, 'max_completion_tokens') ??
          contextWindow;
    return model(id, usage, contextWindow, maxOutputTokens, null);
  });

  return { models, notes: [] };
}

/**
 * OpenAI's List Models endpoint intentionally returns only basic metadata.
 * For chat and embedding models that can be recognized, this function applies
 * documented limits by family. Unrecognized asset/audio/image/moderation models
 * are omitted because the proxy currently needs only chat and embedding rows.
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
    .filter((item): item is AiModel => item !== null);

  return {
    models,
    notes: [
      'OpenAI /v1/models ne renvoie pas les limites; les modèles chat/embedding reconnus sont enrichis depuis les limites documentées.',
    ],
  };
}

/**
 * Morph is OpenAI-compatible for model listing and currently publishes several
 * model-specific docs instead of a universal catalogue shape. We therefore
 * combine returned IDs with documented Morph model-family defaults.
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
    .filter((item): item is AiModel => item !== null);

  return {
    models,
    notes: [
      'Morph est enrichi par famille de modèle quand /v1/models ne renvoie pas les limites.',
    ],
  };
}

/** Normalizes a typical OpenAI-compatible model object. */
function normalizeFromOpenAiCompatible(
  item: JsonRecord,
  defaultUsage: 'chat' | 'embedding',
): AiModel {
  const id = stringField(item, 'id');
  const usage = inferUsageFromId(id) ?? defaultUsage;
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
  return model(id, usage, contextWindow, maxOutputTokens, null);
}

/** Creates a normalized model with safe integer limits. */
function model(
  id: string,
  usage: 'chat' | 'embedding',
  contextWindow: number,
  maxOutputTokens: number,
  tpmLimit: number | null,
): AiModel {
  return {
    id,
    usage,
    contextWindow: Math.max(0, Math.trunc(contextWindow)),
    maxOutputTokens: Math.max(0, Math.trunc(maxOutputTokens)),
    tpmLimit,
    priority: 0,
  };
}

function arrayFromData(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data.filter(isRecord);
  return [];
}

function arrayFromField(payload: unknown, field: string): JsonRecord[] {
  if (isRecord(payload) && Array.isArray(payload[field])) return payload[field].filter(isRecord);
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
  const fieldValue = value[field];
  return typeof fieldValue === 'string' ? fieldValue : '';
}

function numberField(value: JsonRecord, field: string): number | null {
  const fieldValue = value[field];
  if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) return fieldValue;
  if (typeof fieldValue === 'string' && fieldValue.trim() !== '') {
    const parsed = Number(fieldValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringArrayField(value: JsonRecord, field: string): string[] {
  const fieldValue = value[field];
  return Array.isArray(fieldValue)
    ? fieldValue.filter((item): item is string => typeof item === 'string')
    : [];
}

function inferUsageFromId(id: string): 'chat' | 'embedding' | null {
  const lower = id.toLowerCase();
  if (lower.includes('embedding') || lower.includes('embed')) return 'embedding';
  if (
    lower.includes('moderation') ||
    lower.includes('rerank') ||
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('image') ||
    lower.includes('dall-e') ||
    lower.includes('sora') ||
    lower.includes('transcribe')
  ) {
    return null;
  }
  return 'chat';
}

function inferMistralUsage(item: JsonRecord, id: string): 'chat' | 'embedding' {
  const capabilities = recordField(item, 'capabilities');
  if (
    stringField(item, 'type').toLowerCase().includes('embedding') ||
    id.toLowerCase().includes('embed') ||
    capabilities.embedding === true
  ) {
    return 'embedding';
  }
  return 'chat';
}

function inferOpenRouterUsage(
  item: JsonRecord,
  architecture: JsonRecord,
): 'chat' | 'embedding' {
  const outputModalities = stringArrayField(architecture, 'output_modalities');
  const modality = stringField(architecture, 'modality').toLowerCase();
  if (
    outputModalities.some((entry) => entry.toLowerCase().includes('embedding')) ||
    modality.includes('embedding') ||
    stringField(item, 'id').toLowerCase().includes('embed')
  ) {
    return 'embedding';
  }
  return 'chat';
}

function anthropicLimits(id: string): { contextWindow: number; maxOutputTokens: number } {
  if (id.includes('claude-3-7-sonnet')) {
    return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  }
  if (id.includes('claude-sonnet-4')) {
    return { contextWindow: 200_000, maxOutputTokens: 64_000 };
  }
  if (id.includes('claude-opus-4')) {
    return { contextWindow: 200_000, maxOutputTokens: 32_000 };
  }
  if (id.includes('claude-3-5-haiku')) {
    return { contextWindow: 200_000, maxOutputTokens: 8_192 };
  }
  if (id.includes('claude-3-haiku')) {
    return { contextWindow: 200_000, maxOutputTokens: 4_096 };
  }
  return { contextWindow: 200_000, maxOutputTokens: 8_192 };
}

function openAiModelFromId(id: string): AiModel | null {
  const usage = inferUsageFromId(id);
  if (!usage) return null;
  if (usage === 'embedding') return model(id, 'embedding', 8_192, 0, null);
  if (id.startsWith('gpt-5.2') || id.startsWith('gpt-5.1-codex')) {
    return model(id, 'chat', 400_000, 128_000, null);
  }
  if (id.startsWith('gpt-5')) return model(id, 'chat', 400_000, 128_000, null);
  if (id.startsWith('gpt-4.1')) return model(id, 'chat', 1_047_576, 32_768, null);
  if (id.startsWith('gpt-4o')) return model(id, 'chat', 128_000, 16_384, null);
  if (id.startsWith('gpt-4-turbo')) return model(id, 'chat', 128_000, 4_096, null);
  if (id.startsWith('gpt-4')) return model(id, 'chat', 8_192, 8_192, null);
  if (id.startsWith('gpt-3.5-turbo-16k')) return model(id, 'chat', 16_385, 4_096, null);
  if (id.startsWith('gpt-3.5-turbo')) return model(id, 'chat', 16_385, 4_096, null);
  if (id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o1')) {
    return model(id, 'chat', 200_000, 100_000, null);
  }
  if (id.startsWith('gpt-oss')) return model(id, 'chat', 131_072, 131_072, null);
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
  if (usage === 'embedding') {
    return model(id, 'embedding', contextWindow ?? 8_192, 0, null);
  }
  if (id.includes('dsv4flash')) return model(id, 'chat', contextWindow ?? 393_000, maxOutputTokens ?? 12_000, null);
  if (id.startsWith('morph-v3')) return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null);
  return model(id, 'chat', contextWindow ?? 50_000, maxOutputTokens ?? 12_000, null);
}
