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

import { useCallback, useState } from 'react';
import type React from 'react';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTextPart,
} from '../types/playground-types';
import { revokePartObjectUrls } from '../lib/playground/multimodal-files';

export interface PlaygroundConversationState {
  messages: PlaygroundMessage[];
  inputText: string;
  inputParts: PlaygroundPart[];
  resumeFromIndex: number | null;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setInputParts: React.Dispatch<React.SetStateAction<PlaygroundPart[]>>;
  setResumeFromIndex: React.Dispatch<React.SetStateAction<number | null>>;
  /** Returns the history to use as context (honoring resumeFromIndex). */
  getBaseMessages: () => PlaygroundMessage[];
  /** Builds a user message from the current draft, or null if empty. */
  createNextUserMessage: () => PlaygroundMessage | null;
  /** Replaces the entire message array. */
  replaceMessages: (messages: PlaygroundMessage[]) => void;
  /** Appends an assistant message with the given parts. */
  appendAssistantMessage: (nextMessages: PlaygroundMessage[], parts: PlaygroundPart[]) => void;
  /** Clears the text input and input parts (revokes Object URLs). */
  clearDraft: () => void;
  /** Resets to an empty conversation. */
  clearConversation: () => void;
}

/**
 * Manages the conversation history and the current draft (text + attachments).
 */
export const usePlaygroundConversation = (): PlaygroundConversationState => {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputParts, setInputParts] = useState<PlaygroundPart[]>([]);
  const [resumeFromIndex, setResumeFromIndex] = useState<number | null>(null);

  const getBaseMessages = useCallback((): PlaygroundMessage[] => {
    if (resumeFromIndex === null) return messages;
    return messages.slice(0, resumeFromIndex + 1);
  }, [messages, resumeFromIndex]);

  const createNextUserMessage = useCallback((): PlaygroundMessage | null => {
    const textPart: PlaygroundTextPart | null = inputText.trim()
      ? { type: 'text', text: inputText.trim() }
      : null;

    const transcriptionParts: PlaygroundTextPart[] = inputParts
      .filter((part): part is Extract<PlaygroundPart, { type: 'audio' }> => (
        part.type === 'audio' && typeof part.transcription === 'string' && part.transcription.trim().length > 0
      ))
      .map((part) => ({
        type: 'text',
        text: part.transcription!.trim(),
      }));

    const parts: PlaygroundPart[] = [
      ...(textPart ? [textPart] : []),
      ...transcriptionParts,
      ...inputParts,
    ];

    if (parts.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      role: 'user',
      parts,
      timestamp: Date.now(),
    };
  }, [inputText, inputParts]);

  const replaceMessages = useCallback((next: PlaygroundMessage[]) => {
    setMessages(next);
  }, []);

  const appendAssistantMessage = useCallback(
    (nextMessages: PlaygroundMessage[], parts: PlaygroundPart[]) => {
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts,
          timestamp: Date.now(),
        },
      ]);
      setResumeFromIndex(null);
    },
    [],
  );

  const clearDraft = useCallback(() => {
    setInputText('');
    setInputParts((current) => {
      current.forEach(revokePartObjectUrls);
      return [];
    });
  }, []);

  const clearConversation = useCallback(() => {
    setMessages((current) => {
      current.forEach((msg) => msg.parts.forEach(revokePartObjectUrls));
      return [];
    });
    setResumeFromIndex(null);
    clearDraft();
  }, [clearDraft]);

  return {
    messages,
    inputText,
    inputParts,
    resumeFromIndex,
    setInputText,
    setInputParts,
    setResumeFromIndex,
    getBaseMessages,
    createNextUserMessage,
    replaceMessages,
    appendAssistantMessage,
    clearDraft,
    clearConversation,
  };
};
