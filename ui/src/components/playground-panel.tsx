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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Label,
  ListBox,
  NumberField,
  ProgressBar,
  Select,
  Slider,
  TextArea,
  Tooltip,
} from '@heroui/react';
import {
  Code2,
  Copy,
  Download,
  FilePlus,
  MessageSquare,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import highlightJs from 'highlight.js';
import type { AiConfig, AiProvider } from '../types/ai-config';
import { maskApiKey } from '../lib/provider-models';

interface PlaygroundFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
}

/**
 * Represents a single message in the chat conversation.
 */
interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: PlaygroundFile[];
}

/**
 * Props for the PlaygroundPanel component.
 * @param config - The global AI configuration containing providers and keys.
 */
export interface PlaygroundPanelProps {
  config: AiConfig;
}

/**
 * Special value used for the API key selection to indicate that the application
 * should cycle through all available keys for a provider.
 */
const AUTO_ROUND_ROBIN_KEY = '__auto_round_robin__';
const MAX_CONTEXT_FILE_BYTES = 256 * 1024;

const createMarkedRenderer = () => new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = highlightJs.getLanguage(lang) ? lang : 'plaintext';
      return highlightJs.highlight(code, { language }).value;
    },
  }),
);

const sanitizeRenderedHtml = (html: string): string => {
  if (typeof window === 'undefined') return html;

  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, link').forEach((element) => element.remove());
  document.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return document.body.innerHTML;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const buildUserContent = (prompt: string, files: PlaygroundFile[] = []): string => {
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

const messageTokenText = (message: PlaygroundMessage): string => buildUserContent(message.content, message.files);

const getMarkdownFilename = (content: string, index: number): string => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${heading || `assistant-response-${index + 1}`}.md`;
};

const getFileExtension = (language: string): string => ({
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

const extractGeneratedFiles = (content: string) => {
  const files: Array<{ name: string; content: string }> = [];
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = fencePattern.exec(content)) !== null) {
    const info = match[1]?.trim() ?? '';
    const code = match[2] ?? '';
    const filename = info.match(/(?:file(?:name)?|path|title)=["']?([^"'\s]+)["']?/i)?.[1];
    if (filename) {
      files.push({ name: filename, content: code.replace(/\n$/, '') });
      continue;
    }

    if (files.length === 0 && index === 0) {
      const language = info.split(/\s+/)[0] || 'txt';
      files.push({
        name: `generated.${getFileExtension(language)}`,
        content: code.replace(/\n$/, ''),
      });
    }
    index += 1;
  }

  return files;
};

export const PlaygroundPanel: React.FC<PlaygroundPanelProps> = ({ config }) => {
  // --- State: Selection & Configuration ---
  const providerIds = Object.keys(config.providers).sort();
  const [providerId, setProviderId] = useState<string>(providerIds[0] ?? '');
  const [modelId, setModelId] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string>(AUTO_ROUND_ROBIN_KEY);
  
  // --- State: Inference Parameters ---
  const [systemPrompt, setSystemPrompt] = useState('You are a concise, accurate, and helpful AI assistant.');
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);
  
  // --- State: Chat History & Input ---
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [userPrompt, setUserPrompt] = useState('');
  const [contextFiles, setContextFiles] = useState<PlaygroundFile[]>([]);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // --- State: Code Snippet Generation ---
  const [showCode, setShowCode] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useState<'curl' | 'python' | 'typescript'>('curl');
  const [resumeFromIndex, setResumeFromIndex] = useState<number | null>(null);
  const [autoKeyIndex, setAutoKeyIndex] = useState(0);
  const [lastUsedProviderKey, setLastUsedProviderKey] = useState<string>('');
  const [copiedSnippet, setCopiedSnippet] = useState<'curl' | 'python' | 'typescript' | null>(null);
  const marked = useMemo(() => createMarkedRenderer(), []);

  // Derived data based on selected provider
  const provider = config.providers[providerId];
  const chatModels = provider
    ? provider.models
      .filter((model) => model.usage === 'chat')
      .slice()
      .sort((a, b) => a.priority - b.priority)
    : [];
  const usableKeys = provider
    ? provider.keys.filter((apiKey) => apiKey.key.trim().length > 0)
    : [];

  const activeModel = chatModels.find((model) => model.id === modelId);
  const contextWindowTokens = Math.max(activeModel?.contextWindow ?? 1, 1);

  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const contextMessages = resumeFromIndex === null
    ? messages
    : messages.slice(0, resumeFromIndex + 1);
  const contextPromptTokens = contextMessages.reduce((total, message) => total + estimateTokens(messageTokenText(message)), 0);
  const contextSystemTokens = systemPrompt.trim().length > 0 ? estimateTokens(systemPrompt) : 0;
  const contextDraftPromptTokens = userPrompt.trim().length > 0 || contextFiles.length > 0
    ? estimateTokens(buildUserContent(userPrompt, contextFiles))
    : 0;
  const contextUsedTokens = contextSystemTokens + contextPromptTokens + contextDraftPromptTokens;
  const contextFillPercent = Math.min(100, Math.max(0, (contextUsedTokens / contextWindowTokens) * 100));
  const contextFillColor = contextFillPercent >= 90
    ? 'danger'
    : contextFillPercent >= 70
      ? 'warning'
      : 'accent';

  /**
   * Effect: Ensure a valid provider is selected when the config changes.
   */
  useEffect(() => {
    if (providerIds.length === 0) return;
    if (!providerId || !config.providers[providerId]) {
      setProviderId(providerIds[0]);
    }
  }, [providerId, providerIds, config.providers]);

  /**
   * Effect: Reset or update model selection when the provider changes.
   */
  useEffect(() => {
    if (chatModels.length === 0) {
      setModelId('');
      return;
    }
    if (!chatModels.some((model) => model.id === modelId)) {
      setModelId(chatModels[0].id);
      setMaxTokens(Math.min(chatModels[0].maxOutputTokens, 1024));
    }
  }, [chatModels, modelId]);

  /**
   * Effect: Reset API key selection to Round Robin if the currently selected key is removed.
   */
  useEffect(() => {
    if (usableKeys.length === 0) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
      return;
    }
    if (
      selectedKey !== AUTO_ROUND_ROBIN_KEY
      && !usableKeys.some((apiKey) => apiKey.key === selectedKey)
    ) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
    }
  }, [usableKeys, selectedKey]);

  /**
   * Ensures the provider endpoint ends with the standard OpenAI chat completions suffix.
   */
  const buildDirectChatUrl = (activeProvider: AiProvider): string => {
    const base = activeProvider.endpoint.replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    if (base.endsWith('/v1')) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  };

  /**
   * Returns the actual API key string to use, handling the round-robin logic if enabled.
   */
  const resolveProviderKey = (): string => {
    if (usableKeys.length === 0) return '';
    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      const index = autoKeyIndex % usableKeys.length;
      return usableKeys[index]?.key ?? '';
    }
    return selectedKey;
  };

  /**
   * Constructs the OpenAI-compatible JSON payload for the chat request.
   */
  const buildPayload = (
    baseMessages: PlaygroundMessage[],
    nextUserPrompt?: string,
    nextFiles: PlaygroundFile[] = [],
  ) => {
    const requestMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (systemPrompt.trim()) {
      requestMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    requestMessages.push(...baseMessages.map((message) => ({
      role: message.role,
      content: message.role === 'user' ? buildUserContent(message.content, message.files) : message.content,
    })));
    if (nextUserPrompt && nextUserPrompt.trim().length > 0) {
      requestMessages.push({ role: 'user', content: buildUserContent(nextUserPrompt.trim(), nextFiles) });
    }

    return {
      model: modelId,
      messages: requestMessages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream: streamEnabled,
    };
  };

  /**
   * Parses raw SSE (Server-Sent Events) text to extract the accumulated assistant response.
   * This is used to display a final result even if the stream was processed as a single block.
   */
  const extractStreamedAssistantText = (rawStream: string): string => {
    const fragments: string[] = [];
    const lines = rawStream.split('\n');

    for (const line of lines) {
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
        const piece = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
        if (typeof piece === 'string' && piece.length > 0) {
          fragments.push(piece);
        }
      } catch {
        // Ignore non-json SSE lines.
      }
    }

    return fragments.join('').trim();
  };

  /**
   * Extracts assistant text from a standard JSON response body.
   */
  const extractAssistantText = (responseBody: unknown): string => {
    if (typeof responseBody === 'string') return responseBody;
    if (!responseBody || typeof responseBody !== 'object') {
      return 'No usable assistant response.';
    }

    const typed = responseBody as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
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

  const renderMarkdown = (content: string): string => {
    const rendered = marked.parse(content);
    return sanitizeRenderedHtml(typeof rendered === 'string' ? rendered : content);
  };

  const readContextFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const loadedFiles: PlaygroundFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_CONTEXT_FILE_BYTES) {
        setPlaygroundError(`${file.name} is larger than ${formatBytes(MAX_CONTEXT_FILE_BYTES)} and was skipped.`);
        continue;
      }

      try {
        loadedFiles.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          content: await file.text(),
        });
      } catch {
        setPlaygroundError(`Could not read ${file.name} as text.`);
      }
    }

    if (loadedFiles.length > 0) {
      setContextFiles((current) => [...current, ...loadedFiles]);
      setPlaygroundError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeContextFile = (fileId: string) => {
    setContextFiles((current) => current.filter((file) => file.id !== fileId));
  };

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Main function to send the user prompt to the AI provider.
   */
  const sendPrompt = async () => {
    const nextPrompt = userPrompt.trim();
    if (!nextPrompt && contextFiles.length === 0) return;
    if (!provider) {
      setPlaygroundError('Select a provider first.');
      return;
    }
    if (!modelId) {
      setPlaygroundError('Select a chat model first.');
      return;
    }
    const effectiveProviderKey = resolveProviderKey();
    if (!effectiveProviderKey) {
      setPlaygroundError('No provider API key available.');
      return;
    }

    // Determine the history to send (allowing "Resume from here" logic)
    const baseConversation = resumeFromIndex === null
      ? messages
      : messages.slice(0, resumeFromIndex + 1);

    const nextUserMessage: PlaygroundMessage = {
      role: 'user',
      content: nextPrompt || 'Use the attached context files.',
      files: contextFiles.length > 0 ? contextFiles : undefined,
    };
    setMessages([...baseConversation, nextUserMessage]);
    setUserPrompt('');
    setContextFiles([]);
    setPlaygroundError(null);
    setIsSending(true);
    setLastUsedProviderKey(effectiveProviderKey);
    
    // Update round robin index for the next request if applicable
    if (selectedKey === AUTO_ROUND_ROBIN_KEY && usableKeys.length > 0) {
      setAutoKeyIndex((index) => (index + 1) % usableKeys.length);
    }

    try {
      const payload = buildPayload(baseConversation, nextUserMessage.content, nextUserMessage.files);
      const response = await fetch(buildDirectChatUrl(provider), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveProviderKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let responseBody: unknown = responseText;

      // Special handling for streaming responses processed after completion
      if (payload.stream) {
        const streamedText = extractStreamedAssistantText(responseText);
        if (streamedText.length > 0) {
          responseBody = { choices: [{ message: { content: streamedText } }] };
        }
      }

      try {
        if (typeof responseBody === 'string') {
          responseBody = JSON.parse(responseText);
        }
      } catch {
        // Keep plain text payload if provider returns non-json output.
      }

      if (!response.ok) {
        throw new Error(
          typeof responseBody === 'object' && responseBody !== null
            ? JSON.stringify(responseBody)
            : `Provider failure (${response.status}): ${responseText}`,
        );
      }

      const assistantContent = extractAssistantText(responseBody);
      setMessages([...baseConversation, nextUserMessage, { role: 'assistant', content: assistantContent }]);
      setResumeFromIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playground request failed';
      setPlaygroundError(message);
      // Append an error message from the assistant to show the failure in the chat UI
      setMessages([
        ...baseConversation,
        nextUserMessage,
        { role: 'assistant', content: `Error: ${message}` },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // --- Logic for Generating Code Snippets ---
  const snippetPrompt = userPrompt.trim();
  const snippetBaseConversation = resumeFromIndex === null
    ? messages
    : messages.slice(0, resumeFromIndex + 1);
  const snippetNextPrompt = snippetPrompt.length > 0
    ? snippetPrompt
    : contextFiles.length > 0
      ? 'Use the attached context files.'
      : undefined;
  const snippetPayload = JSON.stringify(
    buildPayload(snippetBaseConversation, snippetNextPrompt, contextFiles),
    null,
    2,
  );
  const effectiveSnippetProviderKey = lastUsedProviderKey || resolveProviderKey();

  const playgroundUrl = provider ? buildDirectChatUrl(provider) : '';
  
  // cURL representation
  const curlSnippet = [
    `curl -X POST '${playgroundUrl}'`,
    "  -H 'Content-Type: application/json'",
    `  -H 'Authorization: Bearer ${effectiveSnippetProviderKey}'`,
    `  --data-raw '${snippetPayload.replace(/'/g, "'\\''")}'`,
  ].join(' \\\n');

  // Python (requests) representation
  const pythonSnippet = [
    'import requests',
    '',
    `url = '${playgroundUrl}'`,
    'headers = {',
    `    'Authorization': 'Bearer ${effectiveSnippetProviderKey}',`,
    "    'Content-Type': 'application/json',",
    '}',
    `payload = ${snippetPayload}`,
    'response = requests.post(url, headers=headers, json=payload, timeout=60)',
    'response.raise_for_status()',
    'print(response.json())',
  ].join('\n');

  // TypeScript (fetch) representation
  const tsSnippet = [
    `const url = '${playgroundUrl}';`,
    '',
    'const response = await fetch(url, {',
    "  method: 'POST',",
    '  headers: {',
    `    Authorization: 'Bearer ${effectiveSnippetProviderKey}',`,
    "    'Content-Type': 'application/json',",
    '  },',
    `  body: JSON.stringify(${snippetPayload}),`,
    '});',
    '',
    'if (!response.ok) {',
    '  throw new Error(await response.text());',
    '}',
    '',
    'const data = await response.json();',
    'console.log(data);',
  ].join('\n');

  /**
   * Copies the generated code snippet to the clipboard.
   */
  const copySnippet = async (kind: 'curl' | 'python' | 'typescript', code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedSnippet(kind);
      setTimeout(() => setCopiedSnippet((current) => (current === kind ? null : current)), 1400);
    } catch {
      setPlaygroundError('Clipboard unavailable in this browser context.');
    }
  };

  const selectedSnippet = {
    curl: curlSnippet,
    python: pythonSnippet,
    typescript: tsSnippet,
  }[snippetLanguage];

  const selectedSnippetTitle = {
    curl: 'curl',
    python: 'python',
    typescript: 'typescript fetch',
  }[snippetLanguage];

  const formatTemperature = (value: number) => value.toFixed(2);

  return (
    <div className="grid gap-6 pt-2">
      {/* --- Main Playground Controls Card --- */}
      <Card>
        <Card.Header className="flex flex-row items-center justify-between p-4">
          <div>
            <Card.Title className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5 text-primary" />
              Chat Playground
            </Card.Title>
            <Card.Description>
              Test a conversation with a vault provider, then copy equivalent request code.
            </Card.Description>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox id="playground-streaming" isSelected={streamEnabled} onChange={setStreamEnabled}>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content>
                <Label htmlFor="playground-streaming">Streaming</Label>
              </Checkbox.Content>
            </Checkbox>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setMessages([]);
                setContextFiles([]);
                setResumeFromIndex(null);
                setPlaygroundError(null);
              }}
            >
              New Chat
            </Button>
          </div>
        </Card.Header>
        
        <Card.Content className="space-y-4 p-4">
          {/* --- Provider and Model Selection --- */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Select
              className="w-full"
              placeholder="Select a provider"
              value={providerId}
              onChange={(value) => setProviderId(String(value ?? ''))}
            >
              <Label>Provider</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {providerIds.map((id) => (
                    <ListBox.Item key={id} id={id} textValue={id}>
                      {id}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              className="w-full"
              placeholder="Select a model"
              value={modelId}
              onChange={(value) => setModelId(String(value ?? ''))}
            >
              <Label>Model</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {chatModels.map((model) => (
                    <ListBox.Item key={model.id} id={model.id} textValue={model.id}>
                      {model.id}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              className="w-full"
              isDisabled={usableKeys.length === 0}
              placeholder="Select a provider API key"
              value={selectedKey}
              onChange={(value) => setSelectedKey(String(value ?? AUTO_ROUND_ROBIN_KEY))}
            >
              <Label>Provider API key</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item
                    id={AUTO_ROUND_ROBIN_KEY}
                    key={AUTO_ROUND_ROBIN_KEY}
                    textValue="Auto (round robin)"
                  >
                    Auto (round robin)
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {usableKeys.map((apiKey) => {
                    const label = `${apiKey.owner ? `${apiKey.owner} - ` : ''}${maskApiKey(apiKey.key)}${apiKey.type ? ` (${apiKey.type})` : ''}`;
                    return (
                      <ListBox.Item key={apiKey.key} id={apiKey.key} textValue={label}>
                        {label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    );
                  })}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* --- System Prompt Configuration --- */}
          <div className="flex flex-col gap-1 text-sm">
            <Label htmlFor="playground-system-prompt">System prompt</Label>
            <TextArea
              id="playground-system-prompt"
              rows={4}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="You are a helpful AI assistant."
            />
          </div>

          {/* --- Inference Parameters (Temperature, Max Tokens, Top-p) --- */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1 text-sm">
              <Slider
                className="w-full"
                value={temperature}
                minValue={0}
                maxValue={2}
                step={0.01}
                onChange={(value) => setTemperature(Array.isArray(value) ? value[0] : value)}
              >
                <Label>Temperature</Label>
                <Slider.Output>
                  {formatTemperature(temperature)}
                </Slider.Output>
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
            </div>
            <NumberField
              minValue={1}
              step={1}
              value={maxTokens}
              onChange={(value) => setMaxTokens(Math.max(1, Math.round(value ?? 1)))}
            >
              <Label>Max tokens</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
            <NumberField
              minValue={0}
              maxValue={1}
              step={0.05}
              value={topP}
              onChange={(value) => {
                const nextValue = value ?? 0;
                setTopP(Math.min(1, Math.max(0, nextValue)));
              }}
            >
              <Label>Top-p</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
            </NumberField>
          </div>

          {/* --- Resume Indicator --- */}
          {resumeFromIndex !== null && (
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
              Resume is active from message {resumeFromIndex + 1}.
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setResumeFromIndex(null)}
              >
                Cancel
              </button>
            </div>
          )}

          {/* --- Chat Display & Input Area --- */}
          <div className="rounded-md border bg-muted/20 p-3">
            {/* Message History */}
            <div className="mb-3 space-y-2 pr-1">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Start the conversation by sending your first message.
                </p>
              ) : (
                messages.map((message, index) => {
                  const generatedFiles = message.role === 'assistant'
                    ? extractGeneratedFiles(message.content)
                    : [];

                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={[
                        'rounded-md px-3 py-2 text-sm',
                        message.role === 'user' ? 'bg-primary/10' : 'bg-background',
                      ].join(' ')}
                    >
                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        {message.role === 'user' ? 'user' : 'assistant'}
                      </p>
                      {message.role === 'assistant' ? (
                        <div
                          className="playground-markdown"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                      {message.files && message.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.files.map((file) => (
                            <span
                              key={file.id}
                              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
                            >
                              {file.name}
                              <span>({formatBytes(file.size)})</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        {message.role === 'assistant' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => downloadTextFile(getMarkdownFilename(message.content, index), message.content)}
                          >
                            <Download className="mr-2 h-3.5 w-3.5" />
                            Markdown
                          </Button>
                        )}
                        {generatedFiles.map((file) => (
                          <Button
                            key={file.name}
                            size="sm"
                            variant="ghost"
                            onPress={() => downloadTextFile(file.name, file.content)}
                          >
                            <Download className="mr-2 h-3.5 w-3.5" />
                            {file.name}
                          </Button>
                        ))}
                        <Button size="sm" variant="ghost" onPress={() => setResumeFromIndex(index)}>
                          <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          Resume from here
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="flex flex-col gap-2">
              <TextArea
                rows={4}
                value={userPrompt}
                onChange={(event) => setUserPrompt(event.target.value)}
                placeholder="Ask something..."
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => void readContextFiles(event.target.files)}
                />
                <Button size="sm" variant="ghost" onPress={() => fileInputRef.current?.click()}>
                  <FilePlus className="mr-2 h-3.5 w-3.5" />
                  Add files
                </Button>
                {contextFiles.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
                  >
                    {file.name}
                    <span>({formatBytes(file.size)})</span>
                    <button
                      type="button"
                      className="ml-1 rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() => removeContextFile(file.id)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-end justify-between gap-3">
                <Tooltip delay={0}>
                  <Tooltip.Trigger aria-label="Context usage details" className="w-full max-w-xs">
                    <ProgressBar aria-label="Context usage" className="w-full" color={contextFillColor} value={contextFillPercent}>
                      <Label>Context</Label>
                      <ProgressBar.Output />
                      <ProgressBar.Track>
                        <ProgressBar.Fill />
                      </ProgressBar.Track>
                    </ProgressBar>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow placement="top">
                    <Tooltip.Arrow />
                    {`${contextUsedTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()} tokens`}
                  </Tooltip.Content>
                </Tooltip>
                <Button onPress={sendPrompt} isPending={isSending} isDisabled={!providerId || !modelId}>
                  <Send className="mr-2 h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {playgroundError && (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{playgroundError}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </Card.Content>
      </Card>

      {/* --- Code Generation Card --- */}
      <Card>
        <Card.Header className="p-4">
          <Card.Title>Equivalent Code</Card.Title>
          <Card.Description>
            Code is hidden by default. Reveal it and copy your preferred version.
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" onPress={() => setShowCode((open) => !open)}>
              <Code2 className="mr-2 h-4 w-4" />
              {showCode ? 'Hide code' : 'Show code'}
            </Button>
            <Select
              className="w-[220px]"
              value={snippetLanguage}
              onChange={(value) => setSnippetLanguage(String(value ?? 'curl') as 'curl' | 'python' | 'typescript')}
            >
              <Label>Language</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="curl" key="curl" textValue="curl">
                    curl
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="python" key="python" textValue="python">
                    python
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="typescript" key="typescript" textValue="typescript">
                    typescript
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <span className="text-xs text-muted-foreground">
              Key used: {effectiveSnippetProviderKey ? maskApiKey(effectiveSnippetProviderKey) : 'none'}
            </span>
          </div>

          {/* Snippet Code Block */}
          {showCode && (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {selectedSnippetTitle}
                </h3>
                <Button size="sm" variant="ghost" onPress={() => copySnippet(snippetLanguage, selectedSnippet)}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {copiedSnippet === snippetLanguage ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs leading-relaxed">
                <code>{selectedSnippet}</code>
              </pre>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
};
