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

import { useCallback, useRef, useState } from 'react';
import type { AiModel, AiProvider } from '../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTtsAudioPart,
} from '../types/playground-types';
import {
  buildDirectChatUrl,
  buildDirectSpeechUrl,
  buildPlaygroundPayload,
  buildPlaygroundSpeechPayload,
  extractAssistantParts,
  extractStreamedAssistantText,
} from '../lib/playground/payload';
import {
  buildMistralConversationsPayload,
  buildMistralConversationsUrl,
  extractMistralConversationsParts,
} from '../lib/playground/mistral-conversations';

/**
 * Options required to send a single playground request.
 */
export interface SendPlaygroundRequestOptions {
  /** The provider configuration (endpoint, protocol, keys). */
  provider: AiProvider;
  /** The API key used to authenticate the request. */
  providerKey: string;
  /** The model ID to send the request to. */
  modelId: string;
  /** System prompt prepended to the conversation. */
  systemPrompt: string;
  /** The conversation messages to send. */
  messages: PlaygroundMessage[];
  /** Optional override for the model's usage type (e.g. `'tts'`). */
  modelUsage?: AiModel['usage'];
  /** Sampling temperature (0–2 range). */
  temperature: number;
  /** Maximum number of output tokens to generate. */
  maxTokens: number;
  /** Nucleus sampling parameter (0–1 range). */
  topP: number;
  /** Whether to stream the response via SSE. */
  stream: boolean;
  /**
   * When true and the provider is Mistral, routes through /v1/conversations
   * with the image_generation built-in tool enabled.
   */
  enableImageGeneration?: boolean;
}

/**
 * State returned by the `usePlaygroundRequest` hook.
 */
export interface PlaygroundRequestState {
  /** Whether a request is currently in flight. */
  isSending: boolean;
  /** Error message from the last failed request, or `null` if no error. */
  error: string | null;
  /** Sends a playground request and resolves with the returned parts. */
  sendRequest: (options: SendPlaygroundRequestOptions) => Promise<PlaygroundPart[]>;
  /** Aborts the current in-flight request and resets the sending state. */
  cancelRequest: () => void;
  /** Clears the current error message. */
  clearError: () => void;
  /** Manually sets an error message. */
  setError: (message: string) => void;
}

/**
 * Checks whether a content-type header indicates an audio response.
 *
 * @param contentType - The raw content-type header value, or `null`.
 * @returns True if the content type is audio or a binary stream.
 */
const isAudioContentType = (contentType: string | null): boolean => {
  if (!contentType) return false;

  const normalized = contentType.toLowerCase();
  return normalized.startsWith('audio/')
    || normalized.includes('application/octet-stream');
};

/**
 * Extracts the filename from a `Content-Disposition` HTTP header.
 * Supports both UTF-8 encoded filenames (`filename*=UTF-8''...`) and standard quoted filenames.
 *
 * @param contentDisposition - The raw `Content-Disposition` header value, or `null`.
 * @returns The extracted filename, or `undefined` if not present.
 */
const extractFilenameFromContentDisposition = (contentDisposition: string | null): string | undefined => {
  if (!contentDisposition) return undefined;

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  return plainMatch?.[1]?.trim();
};

/**
 * Converts an ArrayBuffer to a Base64-encoded string.
 *
 * @param buffer - The raw ArrayBuffer to encode.
 * @returns A Base64 string representation of the buffer.
 */
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

/**
 * Handles the HTTP request lifecycle for a single playground send action.
 * Exposes an AbortController-backed cancel method and streaming SSE parsing.
 *
 * The hook manages:
 *  - AbortController creation and cleanup for request cancellation.
 *  - Loading state management (`isSending`).
 *  - Error capture and clearing.
 *  - Three response paths: Mistral conversations (image generation), TTS (binary audio),
 *    and standard streaming JSON chat completions.
 *
 * @returns The current request state, including `sendRequest`, `cancelRequest`,
 *          `clearError`, and `setError` actions.
 */
export const usePlaygroundRequest = (): PlaygroundRequestState => {
  const [isSending, setIsSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Aborts the current request and resets the sending state. */
  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
  }, []);

  /** Clears the error state by setting it to `null`. */
  const clearError = useCallback(() => setErrorState(null), []);

  /** Manually sets an error message in state. */
  const setError = useCallback((message: string) => setErrorState(message), []);

  /** Sends a playground request, handling streaming, TTS, and Mistral conversations paths. */
  const sendRequest = useCallback(
    async (options: SendPlaygroundRequestOptions): Promise<PlaygroundPart[]> => {
      const {
        provider,
        providerKey,
        modelId,
        systemPrompt,
        messages,
        modelUsage,
        temperature,
        maxTokens,
        topP,
        stream,
        enableImageGeneration,
      } = options;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSending(true);
      setErrorState(null);

      // Mistral conversations API path — used when image generation tool is enabled.
      const useMistralConversations =
        enableImageGeneration === true && provider.protocol === 'mistral';

      try {
        const url = useMistralConversations
          ? buildMistralConversationsUrl(provider)
          : modelUsage === 'tts'
            ? buildDirectSpeechUrl(provider)
            : buildDirectChatUrl(provider);

        const payload = useMistralConversations
          ? buildMistralConversationsPayload({ modelId, systemPrompt, messages, temperature, maxTokens, topP })
          : modelUsage === 'tts'
            ? buildPlaygroundSpeechPayload({ provider, modelId, messages })
            : buildPlaygroundPayload({ modelId, systemPrompt, messages, temperature, maxTokens, topP, stream });

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${providerKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type');
        const contentDisposition = response.headers.get('content-disposition');

        if (modelUsage === 'tts' && isAudioContentType(contentType)) {
          const audioBuffer = await response.arrayBuffer();

          if (!response.ok) {
            throw new Error(`Provider failure (${response.status}): audio response could not be processed.`);
          }

          const audioPart: PlaygroundTtsAudioPart = {
            type: 'tts_audio',
            inlineData: {
              mimeType: contentType?.split(';')[0]?.trim() || 'audio/wav',
              data: arrayBufferToBase64(audioBuffer),
            },
            mimeType: contentType?.split(';')[0]?.trim() || 'audio/wav',
            filename: extractFilenameFromContentDisposition(contentDisposition),
          };

          return [audioPart];
        }

        const responseText = await response.text();
        let responseBody: unknown = responseText;

        if (!useMistralConversations && modelUsage !== 'tts') {
          // Streaming: reconstruct full text from SSE deltas.
          const streamPayload = payload as { stream?: boolean };
          if (streamPayload.stream) {
            const streamedText = extractStreamedAssistantText(responseText);
            if (streamedText.length > 0) {
              responseBody = { choices: [{ message: { content: streamedText } }] };
            }
          }
        }

        // Try to parse remaining text as JSON if not already done above.
        if (typeof responseBody === 'string') {
          try {
            responseBody = JSON.parse(responseText);
          } catch {
            // Keep plain text if provider returns non-JSON.
          }
        }

        if (!response.ok) {
          throw new Error(
            typeof responseBody === 'object' && responseBody !== null
              ? JSON.stringify(responseBody)
              : `Provider failure (${response.status}): ${responseText}`,
          );
        }

        return useMistralConversations
          ? extractMistralConversationsParts(responseBody)
          : extractAssistantParts(responseBody);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return [{ type: 'text', text: '[Request cancelled]' }];
        }
        const message = err instanceof Error ? err.message : 'Playground request failed';
        setErrorState(message);
        throw err;
      } finally {
        abortControllerRef.current = null;
        setIsSending(false);
      }
    },
    [],
  );

  return { isSending, error, sendRequest, cancelRequest, clearError, setError };
};
