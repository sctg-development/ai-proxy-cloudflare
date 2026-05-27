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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { AiConfig, AiModel, AiProvider } from '../types/ai-config';
import { AUTO_ROUND_ROBIN_KEY } from '../lib/playground/constants';

export interface PlaygroundSelectionState {
  providerIds: string[];
  providerId: string;
  modelId: string;
  selectedKey: string;
  provider?: AiProvider;
  activeModel?: AiModel;
  chatModels: AiModel['id'] extends string ? AiModel[] : never;
  usableKeys: AiProvider['keys'];
  lastUsedProviderKey: string;
  setProviderId: React.Dispatch<React.SetStateAction<string>>;
  setModelId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedKey: React.Dispatch<React.SetStateAction<string>>;
  setLastUsedProviderKey: React.Dispatch<React.SetStateAction<string>>;
  setMaxTokens: React.Dispatch<React.SetStateAction<number>>;
  resolveProviderKey: () => string;
  /** Returns the key that would be used after one round-robin advance. */
  resolveNextProviderKey: () => string;
  advanceRoundRobinKey: () => void;
}

/**
 * Manages provider / model / API-key selection state for the playground.
 * Keeps the three selects in sync when the config changes and handles
 * the round-robin key rotation logic.
 */
export const usePlaygroundSelection = (
  config: AiConfig,
  setMaxTokens: React.Dispatch<React.SetStateAction<number>>,
): PlaygroundSelectionState => {
  const providerIds = useMemo(
    () => Object.keys(config.providers).sort(),
    [config.providers],
  );

  const [providerId, setProviderId] = useState<string>(providerIds[0] ?? '');
  const [modelId, setModelId] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string>(AUTO_ROUND_ROBIN_KEY);
  const [autoKeyIndex, setAutoKeyIndex] = useState(0);
  const [lastUsedProviderKey, setLastUsedProviderKey] = useState('');

  const provider = config.providers[providerId];

  const chatModels = useMemo<AiModel[]>(() => {
    if (!provider) return [];
    return provider.models
      .filter((m) => m.usage === 'chat' || (m.outputModalities ?? []).includes('audio'))
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [provider]);

  const usableKeys = useMemo(
    () => (provider ? provider.keys.filter((k) => k.key.trim().length > 0) : []),
    [provider],
  );

  const activeModel = chatModels.find((m) => m.id === modelId);

  // Ensure a valid provider is always selected.
  useEffect(() => {
    if (providerIds.length === 0) return;
    if (!providerId || !config.providers[providerId]) {
      setProviderId(providerIds[0]);
    }
  }, [providerId, providerIds, config.providers]);

  // Reset or update model when the provider changes.
  useEffect(() => {
    if (chatModels.length === 0) { setModelId(''); return; }
    if (!chatModels.some((m) => m.id === modelId)) {
      const first = chatModels[0];
      setModelId(first.id);
      setMaxTokens(Math.min(first.maxOutputTokens, 1024));
    }
  }, [chatModels, modelId, setMaxTokens]);

  // Reset key selection when the currently selected key is removed.
  useEffect(() => {
    if (usableKeys.length === 0) { setSelectedKey(AUTO_ROUND_ROBIN_KEY); return; }
    if (selectedKey !== AUTO_ROUND_ROBIN_KEY && !usableKeys.some((k) => k.key === selectedKey)) {
      setSelectedKey(AUTO_ROUND_ROBIN_KEY);
    }
  }, [usableKeys, selectedKey]);

  const resolveProviderKey = useCallback((): string => {
    if (usableKeys.length === 0) return '';
    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      return usableKeys[autoKeyIndex % usableKeys.length]?.key ?? '';
    }
    return selectedKey;
  }, [autoKeyIndex, selectedKey, usableKeys]);

  const resolveNextProviderKey = useCallback((): string => {
    if (usableKeys.length === 0) return '';
    if (selectedKey === AUTO_ROUND_ROBIN_KEY) {
      return usableKeys[(autoKeyIndex + 1) % usableKeys.length]?.key ?? '';
    }
    return selectedKey;
  }, [autoKeyIndex, selectedKey, usableKeys]);

  const advanceRoundRobinKey = useCallback(() => {
    if (selectedKey !== AUTO_ROUND_ROBIN_KEY || usableKeys.length === 0) return;
    setAutoKeyIndex((i) => (i + 1) % usableKeys.length);
  }, [selectedKey, usableKeys.length]);

  return {
    providerIds,
    providerId,
    modelId,
    selectedKey,
    provider,
    activeModel,
    chatModels,
    usableKeys,
    lastUsedProviderKey,
    setProviderId,
    setModelId,
    setSelectedKey,
    setLastUsedProviderKey,
    setMaxTokens,
    resolveProviderKey,
    resolveNextProviderKey,
    advanceRoundRobinKey,
  };
};
