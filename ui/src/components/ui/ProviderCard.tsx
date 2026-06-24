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

import React, { useState, useEffect } from 'react';
import {
  Button,
  Card,
  Chip,
  Table,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import { Box, DownloadCloud, Edit, Eye, EyeOff, Key, Plus, Trash2, Clipboard, Check } from 'lucide-react';
import type { AiProvider, AiModel } from '../../types/ai-config';
import { ModelPriorityList } from './ModelPriorityList';
import { ModelDeletionModal } from './ModelDeletionModal';

/** Props for {@link ProviderCard}. */
interface ProviderCardProps {
  /** Dictionary key of the provider. */
  id: string;
  /** Provider data from the vault. */
  provider: AiProvider;
  /** Called when the user clicks "Delete Provider". */
  onDelete: () => void;
  /** Called when the user clicks "Edit Provider". */
  onEdit: () => void;
  /** Called when the user clicks "Add Key". */
  onAddKey: () => void;
  /** Called when the user clicks "Add Model". */
  onAddModel: () => void;
  /** Called with the array index of the key to edit. */
  onEditKey: (index: number) => void;
  /** Called with the model.id to edit. */
  onEditModel: (id: string) => void;
  /** Called with the array index of the key to delete. */
  onDeleteKey: (index: number) => void;
  /** Called with the model.id to delete. */
  onDeleteModel: (id: string) => void;
  /** Called with every selected model id to delete as one draft operation. */
  onDeleteSelectedModels: (ids: string[]) => void;
  /** Called when the user asks the UI to reload models from the provider API. */
  onRefreshModels: () => void;
  /** Called when the user asks to reload only free models (OpenRouter only). */
  onRefreshFreeModels?: () => void;
  /** Called when the user asks to reload only latest models (Mistral only). */
  onRefreshLatestModels?: () => void;
  /** Whether this provider has a known upstream model-list API implementation. */
  canRefreshModels: boolean;
  /** Whether the upstream model-list request is in flight. */
  isRefreshingModels: boolean;
  /** Last sync result or error for the provider. */
  modelSyncMessage?: string;
  /** Called with models in their new visual order. */
  onReorderModels: (models: AiModel[]) => void;
  /** Called when models need to be deleted after API refresh detects missing models. */
  onDeleteMissingModels?: (modelIds: string[]) => void;
  /** List of model IDs that are available from the provider API (used to detect missing models). */
  availableModelIds?: string[];
  /** Called when the user toggles BYOK availability for a model. */
  onToggleByok?: (modelId: string, isByok: boolean) => void;
  /** Set of model IDs that are available for BYOK. */
  byokModelIds?: Set<string>;
}

/** Backward-compatible read for legacy snake_case provider field. */
const getProviderModelCardEndpoint = (provider: AiProvider): string | undefined => {
  const providerWithLegacy = provider as AiProvider & { model_card_endpoint?: string };
  return provider.modelCardEndpoint ?? providerWithLegacy.model_card_endpoint;
};

/**
 * Card component that renders a single AI provider with its models and keys
 * in nested tabs.
 *
 * Each ProviderCard manages its own uncontrolled tab state
 * (react-aria defaults to the first tab), so we don't need `selectedKey` here.
 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  id,
  provider,
  onDelete,
  onEdit,
  onAddKey,
  onAddModel,
  onEditKey,
  onEditModel,
  onDeleteKey,
  onDeleteModel,
  onDeleteSelectedModels,
  onRefreshModels,
  onRefreshFreeModels,
  onRefreshLatestModels,
  canRefreshModels,
  isRefreshingModels,
  modelSyncMessage,
  onReorderModels,
  onDeleteMissingModels,
  availableModelIds,
  onToggleByok,
  byokModelIds,
}) => {
  const resolvedModelCardEndpoint = getProviderModelCardEndpoint(provider);
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set());
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);
  const [modelsToDelete, setModelsToDelete] = useState<AiModel[]>([]);
  const deletionModalState = useOverlayState();

  // Detect models that exist in config but not in API response
  const detectMissingModels = () => {
    if (!availableModelIds || availableModelIds.length === 0) {
      return;
    }

    const missingModels = provider.models.filter(model =>
      !availableModelIds.includes(model.id)
    );

    if (missingModels.length > 0) {
      setModelsToDelete(missingModels);
      deletionModalState.open();
    }
  };

  // Automatically detect missing models when availableModelIds changes
  useEffect(() => {
    if (availableModelIds && availableModelIds.length > 0) {
      detectMissingModels();
    }
  }, [availableModelIds]);

  // Handle deletion of selected models
  const handleDeleteMissingModels = (modelIds: string[]) => {
    onDeleteMissingModels?.(modelIds);
    setModelsToDelete([]);
  };

  const toggleKeyVisibility = (index: number) => {
    setVisibleKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const copyToClipboard = (key: string, index: number) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKeyIndex(index);
      setTimeout(() => {
        setCopiedKeyIndex(null);
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy key to clipboard:', err);
    });
  };

  return (
    <>
      <Card className="overflow-hidden border-l-4 border-l-primary">
      {/* ── Provider header ──────────────────────────────────────────────── */}
      <Card.Header className="flex flex-row items-center justify-between bg-muted/5 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Card.Title className="text-xl font-bold">{id}</Card.Title>
            {/* Protocol chip — e.g. "openai", "anthropic" */}
            <Chip size="sm" variant="soft" color="accent">
              {provider.protocol}
            </Chip>
          </div>
          <Card.Description className="font-mono text-xs">
            {provider.endpoint}
          </Card.Description>
          {resolvedModelCardEndpoint && (
            <Card.Description className="font-mono text-xs text-primary">
              Model cards: {resolvedModelCardEndpoint}
            </Card.Description>
          )}
        </div>
        <div className="flex gap-2">
          <Button isIconOnly size="sm" variant="ghost" onPress={onEdit} aria-label="Edit provider">
            <Edit className="h-4 w-4" />
          </Button>
          <Button isIconOnly size="sm" variant="danger-soft" onPress={onDelete} aria-label="Delete provider">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </Card.Header>

      {/* ── Nested tabs: Models | Keys ───────────────────────────────────── */}
      <Card.Content className="p-0">
        <Tabs variant="secondary">
          <Tabs.ListContainer className="border-b px-4">
            <Tabs.List aria-label={`${id} sections`}>
              <Tabs.Tab id="models">
                <div className="flex items-center gap-2 py-2">
                  <Box className="h-3.5 w-3.5" />
                  Models ({provider.models.length})
                </div>
              </Tabs.Tab>
              <Tabs.Tab id="keys">
                <div className="flex items-center gap-2 py-2">
                  <Key className="h-3.5 w-3.5" />
                  API Keys ({provider.keys.length})
                </div>
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* ── Models panel ────────────────────────────────────────────── */}
          <Tabs.Panel id="models" className="p-4">
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="tertiary"
                onPress={onRefreshModels}
                isPending={isRefreshingModels}
                isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
              >
                <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                Refresh from API
              </Button>
              {id === 'openrouter' && onRefreshFreeModels && (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={onRefreshFreeModels}
                  isPending={isRefreshingModels}
                  isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
                >
                  <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                  Refresh free from API
                </Button>
              )}
              {id === 'mistral' && onRefreshLatestModels && (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={onRefreshLatestModels}
                  isPending={isRefreshingModels}
                  isDisabled={!canRefreshModels || provider.keys.every((apiKey) => apiKey.type === 'expired')}
                >
                  <DownloadCloud className="mr-2 h-3.5 w-3.5" />
                  Refresh latest from API
                </Button>
              )}
              <Button size="sm" variant="tertiary" onPress={onAddModel}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Model
              </Button>
            </div>
            {modelSyncMessage && (
              <p className="mb-3 text-sm text-muted-foreground">{modelSyncMessage}</p>
            )}
            <ModelPriorityList
              providerId={id}
              models={provider.models}
              modelCardEndpoint={resolvedModelCardEndpoint}
              onEditModel={onEditModel}
              onDeleteModel={onDeleteModel}
              onDeleteSelectedModels={onDeleteSelectedModels}
              onReorderModels={onReorderModels}
              onToggleByok={onToggleByok || ((_modelId, _isByok) => {})}
              byokModelIds={byokModelIds || new Set()}
            />
          </Tabs.Panel>

          {/* ── API Keys panel ──────────────────────────────────────────── */}
          <Tabs.Panel id="keys" className="p-4">
            <div className="mb-2 flex justify-end">
              <Button size="sm" variant="tertiary" onPress={onAddKey}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add Key
              </Button>
            </div>
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label={`${id} API keys`}>
                  <Table.Header>
                    <Table.Column isRowHeader>Key (Masked)</Table.Column>
                    <Table.Column>Owner</Table.Column>
                    <Table.Column>Type</Table.Column>
                    <Table.Column className="text-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {provider.keys.map((apiKey, index) => (
                      <Table.Row key={index}>
                        {/* Show full key if visible, otherwise show masked version */}
                        <Table.Cell className="font-mono">
                          <div className="flex items-center gap-2">
                            {visibleKeys.has(index) ? (
                              apiKey.key
                            ) : (
                              <>
                                {apiKey.key.substring(0, 8)}…
                                {apiKey.key.substring(apiKey.key.length - 4)}
                              </>
                            )}
                            <div className="flex gap-1 ml-2">
                              {/* Toggle visibility button */}
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                onPress={() => toggleKeyVisibility(index)}
                                aria-label={visibleKeys.has(index) ? `Hide key ${index}` : `Show key ${index}`}
                              >
                                {visibleKeys.has(index) ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              {/* Copy to clipboard button (only shown when key is visible) */}
                              {visibleKeys.has(index) && (
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="ghost"
                                  onPress={() => copyToClipboard(apiKey.key, index)}
                                  aria-label={`Copy key ${index} to clipboard`}
                                >
                                  {copiedKeyIndex === index ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Clipboard className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>{apiKey.owner ?? '—'}</Table.Cell>
                        <Table.Cell>
                          {apiKey.type && (
                            <Chip size="sm" variant="soft">
                              {apiKey.type}
                            </Chip>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end gap-1">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => onEditKey(index)}
                              aria-label={`Edit key ${index}`}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="danger-soft"
                              onPress={() => onDeleteKey(index)}
                              aria-label={`Delete key ${index}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Tabs.Panel>
        </Tabs>
      </Card.Content>
    </Card>

    {/* Model Deletion Modal */}
    <ModelDeletionModal
      state={deletionModalState}
      providerId={id}
      modelsToDelete={modelsToDelete}
      onDeleteModels={handleDeleteMissingModels}
    />
    </>
  );
};
