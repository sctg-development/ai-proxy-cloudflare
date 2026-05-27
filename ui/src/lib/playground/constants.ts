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

/** Sentinel value for the API key selector meaning "cycle all keys". */
export const AUTO_ROUND_ROBIN_KEY = '__auto_round_robin__';

export const PLAYGROUND_DATABASE_NAME = 'chatbot-playground';
export const PLAYGROUND_CONVERSATION_STORE = 'conversations';
export const DEFAULT_CONVERSATION_ID = 'default';

export const DEFAULT_SYSTEM_PROMPT = 'You are a concise, accurate, and helpful AI assistant.';

/** Maximum size for inline base64 file payloads (8 MB). */
export const MAX_INLINE_FILE_BYTES = 8 * 1024 * 1024;

/** Maximum size for plain-text context files embedded as XML (256 KB). */
export const MAX_TEXT_CONTEXT_FILE_BYTES = 256 * 1024;

export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
] as const;

export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
] as const;
