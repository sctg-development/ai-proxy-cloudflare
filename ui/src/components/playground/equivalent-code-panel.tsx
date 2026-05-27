// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useState } from 'react';
import { Button, Card, ListBox, Select } from '@heroui/react';
import { Code2, Copy } from 'lucide-react';
import type { AiProvider } from '../../types/ai-config';
import { maskApiKey } from '../../lib/provider-models';
import { buildDirectChatUrl } from '../../lib/playground/payload';

export interface EquivalentCodePanelProps {
  provider?: AiProvider;
  providerKey: string;
  payload: unknown;
  /** Override the request URL (e.g. for Mistral /v1/conversations). Falls back to buildDirectChatUrl(provider). */
  url?: string;
}

type SnippetLang = 'curl' | 'python' | 'typescript';

/** Renders curl / Python / TypeScript snippets equivalent to the current playground state. */
export const EquivalentCodePanel: React.FC<EquivalentCodePanelProps> = ({
  provider,
  providerKey,
  payload,
  url,
}) => {
  const [showCode, setShowCode] = useState(false);
  const [snippetLanguage, setSnippetLanguage] = useState<SnippetLang>('curl');
  const [copied, setCopied] = useState<SnippetLang | null>(null);

  const playgroundUrl = url ?? (provider ? buildDirectChatUrl(provider) : '');
  const snippetJson = JSON.stringify(payload, null, 2);
  const escapedJson = snippetJson.replace(/'/g, "'\\''");

  const curlSnippet = [
    `curl -X POST '${playgroundUrl}'`,
    "  -H 'Content-Type: application/json'",
    `  -H 'Authorization: Bearer ${providerKey}'`,
    `  --data-raw '${escapedJson}'`,
  ].join(' \\\n');

  const pythonSnippet = [
    'import requests',
    '',
    `url = '${playgroundUrl}'`,
    'headers = {',
    `    'Authorization': 'Bearer ${providerKey}',`,
    "    'Content-Type': 'application/json',",
    '}',
    `payload = ${snippetJson}`,
    'response = requests.post(url, headers=headers, json=payload, timeout=60)',
    'response.raise_for_status()',
    'print(response.json())',
  ].join('\n');

  const tsSnippet = [
    `const url = '${playgroundUrl}';`,
    '',
    'const response = await fetch(url, {',
    "  method: 'POST',",
    '  headers: {',
    `    Authorization: 'Bearer ${providerKey}',`,
    "    'Content-Type': 'application/json',",
    '  },',
    `  body: JSON.stringify(${snippetJson}),`,
    '});',
    '',
    'if (!response.ok) throw new Error(await response.text());',
    'const data = await response.json();',
    'console.log(data);',
  ].join('\n');

  const snippets: Record<SnippetLang, string> = { curl: curlSnippet, python: pythonSnippet, typescript: tsSnippet };
  const titles: Record<SnippetLang, string> = { curl: 'curl', python: 'python', typescript: 'typescript fetch' };

  const copySnippet = async (lang: SnippetLang) => {
    try {
      await navigator.clipboard.writeText(snippets[lang]);
      setCopied(lang);
      setTimeout(() => setCopied((c) => (c === lang ? null : c)), 1400);
    } catch {
      // Clipboard unavailable — silently ignored.
    }
  };

  return (
    <Card>
      <Card.Header className="p-4">
        <Card.Title>Equivalent Code</Card.Title>
        <Card.Description>Code is hidden by default. Reveal and copy your preferred version.</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onPress={() => setShowCode((v) => !v)}>
            <Code2 className="mr-2 h-4 w-4" />
            {showCode ? 'Hide code' : 'Show code'}
          </Button>

          <Select
            className="w-55"
            value={snippetLanguage}
            onChange={(value) => setSnippetLanguage(String(value ?? 'curl') as SnippetLang)}
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="curl" textValue="curl">curl<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="python" textValue="python">python<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="typescript" textValue="typescript">typescript<ListBox.ItemIndicator /></ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          <span className="text-xs text-muted-foreground">
            Key used: {providerKey ? maskApiKey(providerKey) : 'none'}
          </span>
        </div>

        {showCode && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {titles[snippetLanguage]}
              </h3>
              <Button size="sm" variant="ghost" onPress={() => void copySnippet(snippetLanguage)}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                {copied === snippetLanguage ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs leading-relaxed">
              <code>{snippets[snippetLanguage]}</code>
            </pre>
          </div>
        )}
      </Card.Content>
    </Card>
  );
};
