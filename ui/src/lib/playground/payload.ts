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
 * Playground payload builders and response parsers.
 * All provider-specific HTTP logic lives here to keep React components clean.
 */

import type { AiProvider } from '../../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTextPart,
  PlaygroundTtsAudioPart,
} from '../../types/playground-types';

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Ensures the provider endpoint resolves to the chat completions path.
 * Handles endpoints that already end with `/chat/completions`, endpoints
 * ending with a versioned segment like `/v1` or `/v1beta`, and plain base URLs.
 *
 * @param provider - The provider configuration containing the endpoint.
 * @returns The full chat completions URL.
 */
export const buildDirectChatUrl = (provider: AiProvider): string => {
  const base = provider.endpoint.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (/(?:\/v\d+(?:beta\d*)?)$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
};

/**
 * Ensures the provider endpoint resolves to the OpenAI-compatible speech path.
 *
 * @param provider - The provider configuration containing the endpoint.
 * @returns The full audio speech URL.
 */
export const buildDirectSpeechUrl = (provider: AiProvider): string => {
  const base = provider.endpoint.replace(/\/+$/, '');
  if (base.endsWith('/audio/speech')) return base;
  if (/(?:\/v\d+(?:beta\d*)?)$/i.test(base)) return `${base}/audio/speech`;
  return `${base}/v1/audio/speech`;
};

// ---------------------------------------------------------------------------
// Parts → OpenAI content conversion
// ---------------------------------------------------------------------------

/**
 * Converts playground parts to a text-only string.
 * Used as a safe fallback for providers that do not support multimodal content.
 *
 * @param parts - The playground parts to convert.
 * @returns A single string combining all parts' text representations.
 */
export const playgroundPartsToText = (parts: PlaygroundPart[]): string =>
  parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'audio' && part.transcription) return part.transcription;
      if (part.type === 'file' && part.textContent) {
        return `<file name="${part.name}">\n${part.textContent}\n</file>`;
      }
      if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;
      return `[Attached ${part.type}]`;
    })
    .filter(Boolean)
    .join('\n\n');

/**
 * Converts playground parts to the OpenAI multimodal content array format.
 * Falls back to a plain text string when there is only one text part.
 *
 * @param parts - The playground parts to convert.
 * @returns A string (single text part) or an array of content objects.
 */
export const playgroundPartsToOpenAiContent = (
  parts: PlaygroundPart[],
): string | Array<Record<string, unknown>> => {
  const contentParts = parts.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }];
    }

    if (part.type === 'image') {
      if (part.inlineData) {
        return [{
          type: 'image_url',
          image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` },
        }];
      }
      if (part.remoteUrl) {
        return [{ type: 'image_url', image_url: { url: part.remoteUrl } }];
      }
      return [{ type: 'text', text: `[Generated image: ${part.name ?? 'image'}]` }];
    }

    if (part.type === 'audio') {
      return [
        ...(part.transcription ? [{ type: 'text', text: part.transcription }] : []),
        {
          type: 'input_audio',
          input_audio: {
            data: part.inlineData.data,
            format: part.inlineData.mimeType.split('/')[1] ?? 'mp3',
          },
        },
      ];
    }

    if (part.type === 'file' && part.textContent) {
      return [{ type: 'text', text: `<file name="${part.name}">\n${part.textContent}\n</file>` }];
    }

    const label = 'name' in part && part.name ? `: ${part.name}` : '';
    return [{ type: 'text', text: `[Attached ${part.type}${label}]` }];
  });

  if (contentParts.length === 0) return '';
  if (contentParts.length === 1 && contentParts[0].type === 'text') {
    return String(contentParts[0].text);
  }
  return contentParts;
};

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

/**
 * Options for building a playground chat completions payload.
 */
export interface BuildPlaygroundPayloadOptions {
  /** The model ID to send the request to. */
  modelId: string;
  /** System prompt prepended to the conversation. */
  systemPrompt: string;
  /** The conversation messages to include in the payload. */
  messages: PlaygroundMessage[];
  /** Sampling temperature. */
  temperature: number;
  /** Maximum output tokens to generate. */
  maxTokens: number;
  /** Nucleus sampling parameter (0–1). */
  topP: number;
  /** Whether to stream the response. */
  stream: boolean;
  /** When true, uses multimodal content parts for image/audio. Default: true. */
  multimodal?: boolean;
}

/**
 * Options for building a playground text-to-speech payload.
 */
export interface BuildPlaygroundSpeechPayloadOptions {
  /** The provider configuration (used for protocol-specific voice selection). */
  provider: AiProvider;
  /** The TTS model ID. */
  modelId: string;
  /** The conversation messages (only the latest user message is used as input). */
  messages: PlaygroundMessage[];
}

/**
 * Builds the OpenAI-compatible JSON body for a chat completions request.
 *
 * @param options - The payload options including model, messages, and sampling parameters.
 * @returns A serialized chat completion request body.
 */
export const buildPlaygroundPayload = ({
  modelId,
  systemPrompt,
  messages,
  temperature,
  maxTokens,
  topP,
  stream,
  multimodal = true,
}: BuildPlaygroundPayloadOptions) => {
  const requestMessages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: unknown;
  }> = [];

  if (systemPrompt.trim()) {
    requestMessages.push({ role: 'system', content: systemPrompt.trim() });
  }

  const toContent = multimodal ? playgroundPartsToOpenAiContent : playgroundPartsToText;

  requestMessages.push(
    ...messages.map((message) => ({
      role: message.role,
      content: toContent(message.parts),
    })),
  );

  return {
    model: modelId,
    messages: requestMessages,
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream,
  };
};

/**
 * Resolves a default speech voice for TTS requests based on the provider and model.
 * Currently only Orpheus models on OpenAI use a non-default voice (`'autumn'`).
 *
 * @param provider - The provider configuration (for protocol detection).
 * @param modelId - The TTS model ID.
 * @returns The voice identifier to use in the TTS request.
 */
const resolveDefaultSpeechVoice = (provider: AiProvider, modelId: string): string => {
  const lowerModelId = modelId.toLowerCase();

  if (provider.protocol === 'openai' && lowerModelId.includes('canopylabs/orpheus')) {
    return 'autumn';
  }

  return 'alloy';
};

/**
 * Builds the text-to-speech request payload using the latest user message as input.
 *
 * @param options - The speech payload options (provider, model ID, messages).
 * @returns A serialized TTS request body with model, input, voice, and format.
 */
export const buildPlaygroundSpeechPayload = ({
  provider,
  modelId,
  messages,
}: BuildPlaygroundSpeechPayloadOptions) => {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const input = latestUserMessage ? playgroundPartsToText(latestUserMessage.parts).trim() : '';

  return {
    model: modelId,
    input,
    voice: resolveDefaultSpeechVoice(provider, modelId),
    response_format: 'wav',
  };
};

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough 1-token-per-4-chars estimate — good enough for the context usage bar. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Returns the representative text of a part for token estimation purposes.
 *
 * @param part - A playground part to extract text from.
 * @returns The text content, or a placeholder for non-textual parts.
 */
export const getPartTokenText = (part: PlaygroundPart): string => {
  if (part.type === 'text') return part.text;
  if (part.type === 'audio' && part.transcription) return part.transcription;
  if (part.type === 'file' && part.textContent) return part.textContent;
  if ('name' in part && part.name) return `[Attached ${part.type}: ${part.name}]`;
  return `[Attached ${part.type}]`;
};

/**
 * Returns the combined token-estimation text for a whole message.
 *
 * @param message - A playground message whose parts should be combined.
 * @returns A concatenated string of all part texts.
 */
export const getMessageTokenText = (message: PlaygroundMessage): string =>
  message.parts.map(getPartTokenText).join('\n\n');

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

/**
 * Parses raw SSE text produced by a streaming response into the accumulated
 * assistant text.
 *
 * @param rawStream - The raw response body text containing SSE `data:` lines.
 * @returns The concatenated assistant text, trimmed.
 */
export const extractStreamedAssistantText = (rawStream: string): string => {
  const fragments: string[] = [];
  for (const line of rawStream.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
        }>;
      };
      const piece =
        payload.choices?.[0]?.delta?.content ??
        payload.choices?.[0]?.message?.content;
      if (typeof piece === 'string' && piece.length > 0) fragments.push(piece);
    } catch {
      // Ignore non-JSON SSE lines.
    }
  }
  return fragments.join('').trim();
};

/**
 * Extracts the assistant text from a standard JSON response body.
 *
 * @param responseBody - The parsed provider response (object or string).
 * @returns The extracted text, or a JSON stringified fallback.
 */
export const extractAssistantText = (responseBody: unknown): string => {
  if (typeof responseBody === 'string') return responseBody;
  if (!responseBody || typeof responseBody !== 'object') return 'No usable assistant response.';

  const typed = responseBody as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };

  const content = typed.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    return text || JSON.stringify(responseBody, null, 2);
  }

  return JSON.stringify(responseBody, null, 2);
};

/**
 * Normalizes an audio MIME type value into a valid `audio/*` type.
 * Returns `'audio/wav'` for empty or invalid input.
 *
 * @param value - The raw MIME type string from the provider response.
 * @returns A normalized audio MIME type.
 */
const normalizeAudioMimeType = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) return 'audio/wav';
  return value.includes('/') ? value : `audio/${value}`;
};

/**
 * Extracts a TTS audio part from a provider response body's `choices[0].message`.
 * Handles both direct `message.audio` fields and `message.content` arrays
 * containing audio content items.
 *
 * @param responseBody - The raw provider response body.
 * @returns A `PlaygroundTtsAudioPart` if audio is found, otherwise `null`.
 */
const audioPartFromChoiceMessage = (responseBody: unknown): PlaygroundTtsAudioPart | null => {
  if (!responseBody || typeof responseBody !== 'object') return null;

  const typed = responseBody as {
    choices?: Array<{
      message?: {
        audio?: {
          data?: string;
          format?: string;
          mime_type?: string;
          url?: string;
          transcript?: string;
          filename?: string;
        };
        content?: Array<{
          type?: string;
          audio?: {
            data?: string;
            format?: string;
            mime_type?: string;
            url?: string;
            transcript?: string;
            filename?: string;
          };
          audio_url?: { url?: string };
        }>;
      };
    }>;
  };

  const message = typed.choices?.[0]?.message;
  const directAudio = message?.audio;
  if (directAudio && (typeof directAudio.data === 'string' || typeof directAudio.url === 'string')) {
    return {
      type: 'tts_audio',
      ...(typeof directAudio.data === 'string'
        ? {
            inlineData: {
              mimeType: normalizeAudioMimeType(directAudio.mime_type ?? directAudio.format),
              data: directAudio.data,
            },
          }
        : {}),
      ...(typeof directAudio.url === 'string' ? { audioUrl: directAudio.url } : {}),
      ...(typeof directAudio.mime_type === 'string' || typeof directAudio.format === 'string'
        ? { mimeType: normalizeAudioMimeType(directAudio.mime_type ?? directAudio.format) }
        : {}),
      ...(typeof directAudio.filename === 'string' ? { filename: directAudio.filename } : {}),
      ...(typeof directAudio.transcript === 'string' ? { transcript: directAudio.transcript } : {}),
    };
  }

  const contentAudio = Array.isArray(message?.content) ? message.content.find((part) => (
    part?.type === 'output_audio' ||
    part?.type === 'audio' ||
    typeof part?.audio?.data === 'string' ||
    typeof part?.audio?.url === 'string' ||
    typeof part?.audio_url?.url === 'string'
  )) : null;

  if (!contentAudio) return null;

  const audio = contentAudio.audio;
  const remoteUrl = contentAudio.audio_url?.url ?? audio?.url;

  if (audio && typeof audio.data === 'string') {
    return {
      type: 'tts_audio',
      inlineData: {
        mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format),
        data: audio.data,
      },
      ...(typeof remoteUrl === 'string' ? { audioUrl: remoteUrl } : {}),
      ...(typeof audio.mime_type === 'string' || typeof audio.format === 'string'
        ? { mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format) }
        : {}),
      ...(typeof audio.filename === 'string' ? { filename: audio.filename } : {}),
      ...(typeof audio.transcript === 'string' ? { transcript: audio.transcript } : {}),
    };
  }

  if (typeof remoteUrl === 'string') {
    return {
      type: 'tts_audio',
      audioUrl: remoteUrl,
      ...(audio?.mime_type || audio?.format
        ? { mimeType: normalizeAudioMimeType(audio.mime_type ?? audio.format) }
        : {}),
      ...(typeof audio?.filename === 'string' ? { filename: audio.filename } : {}),
      ...(typeof audio?.transcript === 'string' ? { transcript: audio.transcript } : {}),
    };
  }

  return null;
};

/**
 * Converts a provider response body into playground parts.
 * Prefers model-generated audio when present, and preserves assistant text when available.
 *
 * @param responseBody - The parsed provider response.
 * @returns An array of `PlaygroundPart` (text and/or TTS audio parts).
 */
export const extractAssistantParts = (responseBody: unknown): PlaygroundPart[] => {
  const parts: PlaygroundPart[] = [];
  const text = extractAssistantText(responseBody);
  const audioPart = audioPartFromChoiceMessage(responseBody);

  if (text) {
    parts.push({ type: 'text', text } satisfies PlaygroundTextPart);
  }

  if (audioPart) {
    parts.push(audioPart);
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: 'No usable assistant response.' } satisfies PlaygroundTextPart);
  }

  return parts;
};
