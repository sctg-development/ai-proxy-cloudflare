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

import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Label,
  ProgressBar,
  Tooltip,
} from '@heroui/react';
import { Download, MessageSquare, PanelRight, Upload } from 'lucide-react';
import type { AiConfig } from '../types/ai-config';
import type {
  PlaygroundMessage,
  PlaygroundTranscriber,
  PlaygroundTtsProvider,
} from '../types/playground-types';
import {
  DEFAULT_CONVERSATION_ID,
  DEFAULT_SYSTEM_PROMPT,
} from '../lib/playground/constants';
import {
  buildPlaygroundPayload,
  estimateTokens,
  getMessageTokenText,
  getPartTokenText,
} from '../lib/playground/payload';
import {
  buildMistralConversationsPayload,
  buildMistralConversationsUrl,
} from '../lib/playground/mistral-conversations';
import { usePlaygroundSelection } from '../hooks/use-playground-selection';
import { usePlaygroundConversation } from '../hooks/use-playground-conversation';
import { usePlaygroundRequest } from '../hooks/use-playground-request';
import { usePlaygroundIndexedDb } from '../hooks/use-playground-indexed-db';
import { ProviderModelKeySelector } from './playground/provider-model-key-selector';
import { GenerationSettingsPanel } from './playground/generation-settings-panel';
import { MessageList } from './playground/message-list';
import { MultimodalInput } from './playground/multimodal-input';
import { EquivalentCodePanel } from './playground/equivalent-code-panel';
import { ConversationHistorySidebar } from './playground/conversation-history-sidebar';

export interface PlaygroundPanelProps {
  activeConfig: AiConfig;
  conversationId?: string;
  initialHistory?: PlaygroundMessage[];
  transcriber?: PlaygroundTranscriber;
  ttsProvider?: PlaygroundTtsProvider;
}

const isPlaygroundMessageArray = (value: unknown): value is PlaygroundMessage[] => {
  if (!Array.isArray(value)) return false;

  return value.every((message) => (
    typeof message === 'object'
    && message !== null
    && 'id' in message
    && 'role' in message
    && 'parts' in message
    && Array.isArray((message as { parts?: unknown }).parts)
  ));
};

export const PlaygroundPanel: React.FC<PlaygroundPanelProps> = ({
  activeConfig,
  conversationId: _conversationId = DEFAULT_CONVERSATION_ID,
  initialHistory,
  transcriber,
  ttsProvider,
}) => {
  // Inference parameters
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [topP, setTopP] = useState(1);
  // Mistral-only: route through /v1/conversations with image_generation tool
  const [enableImageGeneration, setEnableImageGeneration] = useState(false);

  // Active conversation — starts with the prop value, can be switched via sidebar
  const [conversationId, setConversationId] = useState(_conversationId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const conversation = usePlaygroundConversation();
  const request = usePlaygroundRequest();
  const selection = usePlaygroundSelection(activeConfig, setMaxTokens);

  const idb = usePlaygroundIndexedDb({
    conversationId,
    messages: conversation.messages,
    initialHistory,
    onMessagesLoaded: conversation.replaceMessages,
  });

  // Context window usage bar
  const contextWindowTokens = Math.max(selection.activeModel?.contextWindow ?? 1, 1);
  const baseMessages = conversation.getBaseMessages();
  const contextPromptTokens = baseMessages.reduce(
    (total, msg) => total + estimateTokens(getMessageTokenText(msg)),
    0,
  );
  const contextSystemTokens = systemPrompt.trim() ? estimateTokens(systemPrompt) : 0;
  const contextDraftTokens = estimateTokens(
    [conversation.inputText, ...conversation.inputParts.map(getPartTokenText)]
      .filter(Boolean)
      .join('\n\n'),
  );
  const contextUsedTokens = contextSystemTokens + contextPromptTokens + contextDraftTokens;
  const contextFillPercent = Math.min(100, Math.max(0, (contextUsedTokens / contextWindowTokens) * 100));
  const contextFillColor = contextFillPercent >= 90 ? 'danger' : contextFillPercent >= 70 ? 'warning' : 'accent';

  const useMistralConversations =
    enableImageGeneration && selection.provider?.protocol === 'mistral';

  // Payload and URL preview for the equivalent-code panel — must match the
  // actual request path chosen in sendPrompt / retryLastRequest.
  const payloadPreview = useMemo(
    () =>
      useMistralConversations
        ? buildMistralConversationsPayload({
            modelId: selection.modelId,
            systemPrompt,
            messages: baseMessages,
            temperature,
            maxTokens,
            topP,
          })
        : buildPlaygroundPayload({
            modelId: selection.modelId,
            systemPrompt,
            messages: baseMessages,
            temperature,
            maxTokens,
            topP,
            stream: streamEnabled,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseMessages, maxTokens, selection.modelId, streamEnabled, systemPrompt, temperature, topP, useMistralConversations],
  );

  const urlPreview = useMistralConversations && selection.provider
    ? buildMistralConversationsUrl(selection.provider)
    : undefined;

  const sendPrompt = async () => {
    const providerKey = selection.resolveProviderKey();

    if (!selection.provider) {
      request.setError('Select a provider first.');
      return;
    }
    if (!selection.modelId) {
      request.setError('Select a chat model first.');
      return;
    }
    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    const nextUserMessage = conversation.createNextUserMessage();
    if (!nextUserMessage) return;

    const base = conversation.getBaseMessages();
    const nextMessages = [...base, nextUserMessage];

    conversation.replaceMessages(nextMessages);
    conversation.clearDraft();
    selection.setLastUsedProviderKey(providerKey);
    selection.advanceRoundRobinKey();

    try {
      const assistantParts = await request.sendRequest({
        provider: selection.provider,
        providerKey,
        modelId: selection.modelId,
        systemPrompt,
        messages: nextMessages,
        temperature,
        maxTokens,
        topP,
        stream: streamEnabled,
        enableImageGeneration,
      });
      conversation.appendAssistantMessage(nextMessages, assistantParts);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playground request failed';
      conversation.appendAssistantMessage(nextMessages, [{ type: 'text', text: `Error: ${message}` }]);
    }
  };

  const handleResumeFromIndex = (index: number) => {
    if (index < 0) {
      conversation.setResumeFromIndex(null);
    } else {
      conversation.setResumeFromIndex(index);
    }
  };

  const handleNewConversation = () => {
    setConversationId(crypto.randomUUID());
    conversation.clearConversation();
    request.clearError();
  };

  const handleSelectConversation = (id: string) => {
    if (id === conversationId) return;
    conversation.clearConversation();
    setConversationId(id);
    request.clearError();
  };

  const handleDeleteConversation = (id: string) => {
    void idb.deleteConversation(id);
    if (id === conversationId) {
      handleNewConversation();
    }
  };

  const exportConversation = () => {
    const payload = {
      id: conversationId,
      messages: conversation.messages,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${conversationId}.json`;
    link.click();

    URL.revokeObjectURL(url);
  };

  const importConversation = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    try {
      const raw = JSON.parse(await file.text()) as { messages?: unknown };
      const importedMessages = raw.messages;

      if (!isPlaygroundMessageArray(importedMessages)) {
        request.setError('Imported JSON does not contain a valid playground conversation.');
        return;
      }

      conversation.replaceMessages(importedMessages);
      request.clearError();
    } catch (error) {
      request.setError(error instanceof Error ? error.message : 'Could not import JSON conversation.');
    }
  };

  const retryLastRequest = async (rotateKey: boolean) => {
    if (!selection.provider || !selection.modelId) return;

    const providerKey = rotateKey
      ? selection.resolveNextProviderKey()
      : selection.resolveProviderKey();

    if (!providerKey) {
      request.setError('No provider API key available.');
      return;
    }

    // Drop the last assistant error message and re-send with the same history
    const messagesWithoutError = conversation.messages.slice(0, -1);
    conversation.replaceMessages(messagesWithoutError);
    selection.setLastUsedProviderKey(providerKey);
    // For rotate: advance twice (skip failed key + the one we're about to use)
    // For plain retry: advance once (same cadence as sendPrompt)
    selection.advanceRoundRobinKey();
    if (rotateKey) selection.advanceRoundRobinKey();

    try {
      const assistantParts = await request.sendRequest({
        provider: selection.provider,
        providerKey,
        modelId: selection.modelId,
        systemPrompt,
        messages: messagesWithoutError,
        temperature,
        maxTokens,
        topP,
        stream: streamEnabled,
        enableImageGeneration,
      });
      conversation.appendAssistantMessage(messagesWithoutError, assistantParts);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playground request failed';
      conversation.appendAssistantMessage(messagesWithoutError, [{ type: 'text', text: `Error: ${message}` }]);
    }
  };

  return (
    <div className="flex gap-4 pt-2 items-start">
      {/* ── History Sidebar ────────────────────────────────────────── */}
      {!sidebarOpen && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Show history"
          onPress={() => setSidebarOpen(true)}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
      <ConversationHistorySidebar
        conversations={idb.conversations}
        activeConversationId={conversationId}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSelect={handleSelectConversation}
        onDelete={handleDeleteConversation}
        onNew={handleNewConversation}
      />

      {/* ── Main Content ────────────────────────────────────────────── */}
      <div className="flex-1 grid gap-6 min-w-0">
        {/* ── Main Playground Card ──────────────────────────────────── */}
        <Card>
          <Card.Header className="flex flex-row items-center justify-between p-4">
            <div>
              <Card.Title className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                Chat Playground
              </Card.Title>
              <Card.Description>
                Test multimodal conversations with a vault provider, then copy equivalent request code.
              </Card.Description>
            </div>

            <div className="flex items-center gap-3">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void importConversation(event)}
              />
              <Checkbox
                id="playground-streaming"
                isSelected={streamEnabled}
                onChange={setStreamEnabled}
              >
                <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                <Checkbox.Content>
                  <Label htmlFor="playground-streaming">Streaming</Label>
                </Checkbox.Content>
              </Checkbox>

              <Button
                size="sm"
                variant="ghost"
                onPress={exportConversation}
                isDisabled={conversation.messages.length === 0}
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export JSON
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onPress={() => importInputRef.current?.click()}
              >
                <Upload className="mr-2 h-3.5 w-3.5" />
                Import JSON
              </Button>

              {/* Image generation toggle — only relevant for Mistral providers */}
              {selection.provider?.protocol === 'mistral' && (
                <Checkbox
                  id="playground-image-gen"
                  isSelected={enableImageGeneration}
                  onChange={setEnableImageGeneration}
                >
                  <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                  <Checkbox.Content>
                    <Label htmlFor="playground-image-gen">Image generation</Label>
                  </Checkbox.Content>
                </Checkbox>
              )}
            </div>
          </Card.Header>

          <Card.Content className="space-y-4 p-4">
            <ProviderModelKeySelector
              providerIds={selection.providerIds}
              providerId={selection.providerId}
              modelId={selection.modelId}
              selectedKey={selection.selectedKey}
              chatModels={selection.chatModels}
              usableKeys={selection.usableKeys}
              onProviderChange={selection.setProviderId}
              onModelChange={selection.setModelId}
              onSelectedKeyChange={selection.setSelectedKey}
            />

            <GenerationSettingsPanel
              systemPrompt={systemPrompt}
              temperature={temperature}
              maxTokens={maxTokens}
              topP={topP}
              onSystemPromptChange={setSystemPrompt}
              onTemperatureChange={setTemperature}
              onMaxTokensChange={setMaxTokens}
              onTopPChange={setTopP}
            />

            {/* Chat display area */}
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3">
                <MessageList
                  messages={conversation.messages}
                  resumeFromIndex={conversation.resumeFromIndex}
                  onResumeFromIndex={handleResumeFromIndex}
                  ttsProvider={ttsProvider}
                  onError={request.setError}
                  onRetry={() => void retryLastRequest(false)}
                  onRotateAndRetry={() => void retryLastRequest(true)}
                />
              </div>

              {/* Context usage bar + input */}
              <div className="flex items-end justify-between gap-3 mb-3">
                <Tooltip delay={0}>
                  <Tooltip.Trigger aria-label="Context usage details" className="w-full max-w-xs">
                    <ProgressBar
                      aria-label="Context usage"
                      className="w-full"
                      color={contextFillColor}
                      value={contextFillPercent}
                    >
                      <Label>Context</Label>
                      <ProgressBar.Output />
                      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                    </ProgressBar>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow placement="top">
                    <Tooltip.Arrow />
                    {`${contextUsedTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()} tokens`}
                  </Tooltip.Content>
                </Tooltip>
              </div>

              <MultimodalInput
                text={conversation.inputText}
                parts={conversation.inputParts}
                isSending={request.isSending}
                inputModalities={selection.activeModel?.inputModalities ?? ['text']}
                onTextChange={conversation.setInputText}
                onPartsChange={conversation.setInputParts}
                onSend={() => void sendPrompt()}
                onCancel={request.cancelRequest}
                onError={(msg) => request.setError(msg)}
                transcriber={transcriber}
                isDisabled={!selection.providerId || !selection.modelId}
              />
            </div>

            {request.error && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{request.error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </Card.Content>
        </Card>

        {/* ── Equivalent Code Card ──────────────────────────────────── */}
        <EquivalentCodePanel
          provider={selection.provider}
          providerKey={selection.lastUsedProviderKey || selection.resolveProviderKey()}
          payload={payloadPreview}
          url={urlPreview}
        />
      </div>
    </div>
  );
};
