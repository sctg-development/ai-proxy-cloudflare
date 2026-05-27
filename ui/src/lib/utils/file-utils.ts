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
 * File utility functions for handling file operations and formatting.
 */
import type { PlaygroundFile } from '../../types/playground-types';

export const MAX_CONTEXT_FILE_BYTES = 256 * 1024;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getFileExtension = (language: string): string => ({
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  html: 'html',
  javascript: 'js',
  js: 'js',
  json: 'json',
  markdown: 'md',
  md: 'md',
  python: 'py',
  sh: 'sh',
  shell: 'sh',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yml',
}[language.toLowerCase()] ?? 'txt');

export const makeUniqueFilename = (filename: string, usedNames: Set<string>): string => {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : '';
  let suffix = 2;
  let candidate = `${basename}-${suffix}${extension}`;

  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${basename}-${suffix}${extension}`;
  }

  usedNames.add(candidate);
  return candidate;
};

export const getMarkdownFilename = (content: string, index: number): string => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${heading || `assistant-response-${index + 1}`}.md`;
};

export const buildUserContent = (prompt: string, files: PlaygroundFile[] = []): string => {
  if (files.length === 0) return prompt;

  const fileContext = files
    .map((file) => [
      `<file name="${file.name}" type="${file.type || 'text/plain'}" size="${file.size}">`,
      file.content,
      '</file>',
    ].join('\n'))
    .join('\n\n');

  return [
    prompt,
    '',
    'Attached context files:',
    fileContext,
  ].join('\n');
};

export const messageTokenText = (message: { content: string; files?: PlaygroundFile[] }): string =>
  buildUserContent(message.content, message.files);

export const extractGeneratedFiles = (content: string) => {
  const files: Array<{ name: string; content: string }> = [];
  const usedNames = new Set<string>();
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = fencePattern.exec(content)) !== null) {
    const info = match[1]?.trim() ?? '';
    const code = match[2] ?? '';
    const filename = info.match(/(?:file(?:name)?|path|title)=["']?([^"'\s]+)["']?/i)?.[1];
    const language = info.split(/\s+/)[0] || 'txt';

    if (filename) {
      files.push({
        name: makeUniqueFilename(filename, usedNames),
        content: code.replace(/\n$/, ''),
      });
    } else {
      files.push({
        name: makeUniqueFilename(`generated-${index + 1}.${getFileExtension(language)}`, usedNames),
        content: code.replace(/\n$/, ''),
      });
    }

    index += 1;
  }

  return files;
};