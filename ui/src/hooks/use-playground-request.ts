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
import type { AiProvider } from '../types/ai-config';
import type { PlaygroundMessage, PlaygroundPart } from '../types/playground-types';
import {
  buildDirectChatUrl,
  buildPlaygroundPayload,
  extractAssistantParts,
  extractStreamedAssistantText,
} from '../lib/playground/payload';
import {
  buildMistralConversationsPayload,
  buildMistralConversationsUrl,
  extractMistralConversationsParts,
} from '../lib/playground/mistral-conversations';

export interface SendPlaygroundRequestOptions {
  provider: AiProvider;
  providerKey: string;
  modelId: string;
  systemPrompt: string;
  messages: PlaygroundMessage[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stream: boolean;
  /**
   * When true and the provider is Mistral, routes through /v1/conversations
   * with the image_generation built-in tool enabled.
   */
  enableImageGeneration?: boolean;
}

export interface PlaygroundRequestState {
  isSending: boolean;
  error: string | null;
  sendRequest: (options: SendPlaygroundRequestOptions) => Promise<PlaygroundPart[]>;
  cancelRequest: () => void;
  clearError: () => void;
  setError: (message: string) => void;
}

/**
 * Handles the HTTP request lifecycle for a single playground send action.
 * Exposes an AbortController-backed cancel method and streaming SSE parsing.
 */
export const usePlaygroundRequest = (): PlaygroundRequestState => {
  const [isSending, setIsSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
  }, []);

  const clearError = useCallback(() => setErrorState(null), []);
  const setError = useCallback((message: string) => setErrorState(message), []);

  const sendRequest = useCallback(
    async (options: SendPlaygroundRequestOptions): Promise<PlaygroundPart[]> => {
      const {
        provider,
        providerKey,
        modelId,
        systemPrompt,
        messages,
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
          : buildDirectChatUrl(provider);

        const payload = useMistralConversations
          ? buildMistralConversationsPayload({ modelId, systemPrompt, messages, temperature, maxTokens, topP })
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

        const responseText = await response.text();
        let responseBody: unknown = responseText;

        if (!useMistralConversations) {
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
