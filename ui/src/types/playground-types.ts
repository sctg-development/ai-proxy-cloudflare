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
 * Multimodal playground types.
 * Supports text, image, audio, video, file, code, and TTS output parts.
 */

export type PlaygroundRole = 'user' | 'assistant';

export interface PlaygroundInlineData {
  mimeType: string;
  /** Base64-encoded file content (without the data-URL prefix). */
  data: string;
}

export interface PlaygroundTextPart {
  type: 'text';
  text: string;
}

export interface PlaygroundImagePart {
  type: 'image';
  /** Base64-encoded image. Present for user-uploaded images. */
  inlineData?: PlaygroundInlineData;
  /** Remote URL for API-generated images (e.g. Mistral image_generation tool). */
  remoteUrl?: string;
  name?: string;
  size?: number;
  /** Object URL for thumbnail display — must be revoked on unmount. */
  thumbnailUrl?: string;
}

export interface PlaygroundAudioPart {
  type: 'audio';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  /** Text produced by an optional speech-to-text pass. */
  transcription?: string;
}

export interface PlaygroundVideoPart {
  type: 'video';
  inlineData: PlaygroundInlineData;
  name?: string;
  size?: number;
  /** Object URL for thumbnail display — must be revoked on unmount. */
  thumbnailUrl?: string;
}

export interface PlaygroundFilePart {
  type: 'file';
  inlineData: PlaygroundInlineData;
  name: string;
  size?: number;
  /** Decoded text content for providers that receive files as inline text. */
  textContent?: string;
}

export interface PlaygroundCodePart {
  type: 'code';
  language: string;
  code: string;
  filename?: string;
}

export interface PlaygroundTtsAudioPart {
  type: 'tts_audio';
  /** Object URL pointing to the generated audio blob. */
  audioUrl?: string;
  mimeType?: string;
  filename?: string;
}

export type PlaygroundPart =
  | PlaygroundTextPart
  | PlaygroundImagePart
  | PlaygroundAudioPart
  | PlaygroundVideoPart
  | PlaygroundFilePart
  | PlaygroundCodePart
  | PlaygroundTtsAudioPart;

export interface PlaygroundMessage {
  id: string;
  role: PlaygroundRole;
  parts: PlaygroundPart[];
  timestamp: number;
}

export interface PlaygroundConversation {
  id: string;
  title: string;
  messages: PlaygroundMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Injected speech-to-text service. The playground calls this for audio parts
 * before sending the message — keeps provider keys server-side.
 */
export type PlaygroundTranscriber = (audio: Blob, file: File) => Promise<string>;

export interface PlaygroundTtsResult {
  audioBlob?: Blob;
  audioUrl?: string;
  mimeType?: string;
}

/**
 * Injected text-to-speech service. When provided, assistant text responses
 * get a "Play audio" button backed by this provider.
 */
export type PlaygroundTtsProvider = (text: string) => Promise<PlaygroundTtsResult>;

// ---------------------------------------------------------------------------
// Legacy types — kept for backward compatibility with existing code that still
// imports PlaygroundFile / PlaygroundMessage (old shape). The playground panel
// now uses the new PlaygroundMessage shape above.
// ---------------------------------------------------------------------------

/** @deprecated Use PlaygroundFilePart instead. */
export interface PlaygroundFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
}
