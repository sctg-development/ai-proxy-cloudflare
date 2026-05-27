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
 * Utilities for converting browser File objects into PlaygroundPart values.
 * Object URLs created here must be revoked by the caller after use.
 */

import type { PlaygroundPart } from '../../types/playground-types';
import {
  MAX_INLINE_FILE_BYTES,
  MAX_TEXT_CONTEXT_FILE_BYTES,
  SUPPORTED_AUDIO_TYPES,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
} from './constants';

/** Converts a File to its base64 data string (no data-URL prefix). */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Reads a File as UTF-8 text, returning null if it fails. */
export const fileToText = async (file: File): Promise<string | null> => {
  try {
    return await file.text();
  } catch {
    return null;
  }
};

/** Returns the PlaygroundPart type that best describes the file's MIME type. */
export const getFileKind = (
  file: File,
): 'image' | 'audio' | 'video' | 'file' => {
  if (SUPPORTED_IMAGE_TYPES.some((t) => file.type === t) || file.type.startsWith('image/')) {
    return 'image';
  }
  if (SUPPORTED_AUDIO_TYPES.some((t) => file.type === t) || file.type.startsWith('audio/')) {
    return 'audio';
  }
  if (SUPPORTED_VIDEO_TYPES.some((t) => file.type === t) || file.type.startsWith('video/')) {
    return 'video';
  }
  return 'file';
};

/** Returns true if the file can be safely encoded as inline base64. */
export const isInlineable = (file: File): boolean =>
  file.size <= MAX_INLINE_FILE_BYTES;

/** Returns true if the file is small enough to embed as plain text context. */
export const isTextContextFile = (file: File): boolean =>
  file.size <= MAX_TEXT_CONTEXT_FILE_BYTES;

/**
 * Converts a browser File into the appropriate PlaygroundPart.
 *
 * - Images, audio, and video become inline base64 parts.
 * - Plain-text files small enough for context become file parts with decoded text.
 * - Large binary files become file parts with base64 data.
 *
 * The caller is responsible for revoking any Object URLs stored in
 * `thumbnailUrl` when the part is removed from state.
 */
export const createPartFromFile = async (file: File): Promise<PlaygroundPart> => {
  const kind = getFileKind(file);

  if (kind === 'image') {
    const data = await fileToBase64(file);
    return {
      type: 'image',
      inlineData: { mimeType: file.type || 'image/png', data },
      name: file.name,
      size: file.size,
      thumbnailUrl: URL.createObjectURL(file),
    };
  }

  if (kind === 'audio') {
    const data = await fileToBase64(file);
    return {
      type: 'audio',
      inlineData: { mimeType: file.type || 'audio/mpeg', data },
      name: file.name,
      size: file.size,
    };
  }

  if (kind === 'video') {
    const data = await fileToBase64(file);
    return {
      type: 'video',
      inlineData: { mimeType: file.type || 'video/mp4', data },
      name: file.name,
      size: file.size,
      thumbnailUrl: URL.createObjectURL(file),
    };
  }

  // Generic file — embed text content when small enough, otherwise base64.
  const isText =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.name.match(/\.(txt|md|csv|json|xml|yaml|yml|toml|ini|env|ts|tsx|js|jsx|py|rs|go|rb|java|c|cpp|h|cs|php|sh|bash)$/i) !== null;

  if (isText && isTextContextFile(file)) {
    const textContent = await fileToText(file);
    return {
      type: 'file',
      inlineData: { mimeType: file.type || 'text/plain', data: '' },
      name: file.name,
      size: file.size,
      textContent: textContent ?? undefined,
    };
  }

  const data = await fileToBase64(file);
  return {
    type: 'file',
    inlineData: { mimeType: file.type || 'application/octet-stream', data },
    name: file.name,
    size: file.size,
  };
};

/** Converts a list of Files to parts, skipping files that exceed the inline size limit. */
export const createPartsFromFiles = async (
  files: File[],
  onSkipped?: (file: File, reason: string) => void,
): Promise<PlaygroundPart[]> => {
  const parts: PlaygroundPart[] = [];
  for (const file of files) {
    if (!isInlineable(file)) {
      onSkipped?.(file, `${file.name} exceeds the ${MAX_INLINE_FILE_BYTES / (1024 * 1024)} MB limit.`);
      continue;
    }
    try {
      parts.push(await createPartFromFile(file));
    } catch {
      onSkipped?.(file, `Could not read ${file.name}.`);
    }
  }
  return parts;
};

/** Revokes any Object URLs embedded in a part's thumbnailUrl. */
export const revokePartObjectUrls = (part: PlaygroundPart): void => {
  if ('thumbnailUrl' in part && typeof part.thumbnailUrl === 'string' && part.thumbnailUrl.startsWith('blob:')) {
    URL.revokeObjectURL(part.thumbnailUrl);
  }
};

/** Formats file size for display. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
