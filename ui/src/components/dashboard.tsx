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
 * @file Main dashboard for managing the AI vault.
 * Providers, their models and their API keys are all managed from here.
 * Changes are edited as a local draft first. The encrypted Worker vault is only
 * updated when the user explicitly presses the save button.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Chip,
  Form,
  Input,
  Label,
  Modal,
  Table,
  Tabs,
  TextField,
  useOverlayState,
} from '@heroui/react';
import { useAi } from '../hooks/use-ai';
import {
  Box,
  DownloadCloud,
  Edit,
  FlaskConical,
  GripVertical,
  Key,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type { AiConfig, AiKey, AiModel, AiProtocol, AiProvider } from '../types/ai-config';
import {
  canDiscoverProviderModels,
  discoverProviderModels,
  maskApiKey,
  renumberPriorities,
} from '../lib/provider-models';
import { PlaygroundPanel } from './playground-panel';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Identifies the entity being added or edited inside the modal.
 * `itemId` is optional:
 *   - provider: not used (providerId is the identifier)
 *   - model: the model.id string
 *   - key: the numeric index in the keys array (as a string)
 */
interface EditTarget {
  type: 'provider' | 'model' | 'key';
  providerId: string;
  /** Model id or key array index (stringified) when editing an existing item. */
  itemId?: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Main application dashboard. Shown after the user authenticates.
 *
 * All state that needs to survive across modal opens/closes
 * (e.g. which provider we are editing) lives here, not inside the modal, so
 * it is not lost when the modal unmounts.
 */
export const Dashboard: React.FC = () => {
  const { config, loading, error, logout, refresh, updateConfig } = useAi();

  /** Editable copy of the loaded vault. Only this draft is mutated by UI actions. */
  const [draftConfig, setDraftConfig] = useState<AiConfig | null>(null);

  /** True when `draftConfig` contains changes that are not yet persisted. */
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  /** Currently selected top-level tab ("providers"). */
  const [activeTab, setActiveTab] = useState<string>('providers');

  /** Toggles between vault management and chat playground modes. */
  const [showPlayground, setShowPlayground] = useState(false);

  /** What type of form the modal should show. */
  const [modalType, setModalType] = useState<EditTarget['type']>('provider');

  /** Which provider/model/key is being edited. null = "add new" mode. */
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  /** Provider currently refreshing its model catalogue from an upstream API. */
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);

  /** Per-provider sync status shown next to the model list after refresh. */
  const [modelSyncMessages, setModelSyncMessages] = useState<Record<string, string>>({});

  /**
   * Controlled open/close state for the config modal.
   * `useOverlayState` is the HeroUI-idiomatic way to drive a Modal from
   * outside (rather than using a trigger button inside the modal tree).
   */
  const modalState = useOverlayState();

  /**
   * Keeps the local draft aligned with the server config as long as the user has
   * no pending edits. Once the draft is dirty, incoming hook updates are ignored
   * until the user saves or discards their edits.
   */
  useEffect(() => {
    if (config && !hasUnsavedChanges) {
      setDraftConfig(JSON.parse(JSON.stringify(config)) as AiConfig);
    }
  }, [config, hasUnsavedChanges]);

  /** Config currently displayed by the dashboard; falls back during first render after load. */
  const activeConfig = draftConfig ?? config;

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Opens the modal for a given operation.
   * @param type - The type of entity to add or edit.
   * @param target - Null for "add new", or the existing entity's coordinates.
   */
  const openModal = (type: EditTarget['type'], target: EditTarget | null) => {
    setModalType(type);
    setEditTarget(target);
    modalState.open();
  };

  /**
   * Stages a new config version locally without writing to the Worker.
   * deep-clone with JSON.parse(JSON.stringify()) avoids
   * mutating React state directly, which would cause subtle bugs.
   *
   * @param newConfig - The full updated config object.
   */
  const stageConfig = (newConfig: AiConfig) => {
    setDraftConfig(JSON.parse(JSON.stringify(newConfig)) as AiConfig);
    setHasUnsavedChanges(true);
    modalState.close();
    setEditTarget(null);
  };

  /**
   * Encrypts and persists the current draft. This is the only dashboard action
   * that calls PUT /ai.json.enc through the context's `updateConfig`.
   */
  const saveDraftToWorker = async () => {
    if (!draftConfig) return;
    try {
      await updateConfig(draftConfig);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Vault update failed', err);
    }
  };

  /**
   * Drops all local edits and restores the last configuration fetched from the
   * Worker.
   */
  const discardDraft = () => {
    if (!config) return;
    if (hasUnsavedChanges && !confirm('Discard unsaved vault changes?')) return;
    setDraftConfig(JSON.parse(JSON.stringify(config)) as AiConfig);
    setHasUnsavedChanges(false);
    modalState.close();
    setEditTarget(null);
  };

  /**
   * Refreshes from the Worker. If the draft is dirty, this would overwrite the
   * local work, so the user decides explicitly.
   */
  const refreshFromWorker = async () => {
    if (hasUnsavedChanges && !confirm('Discard unsaved changes and reload from the Worker?')) return;
    setHasUnsavedChanges(false);
    await refresh();
  };

  /**
   * Removes a provider (and all its models and keys) from the config.
   * @param id - The provider dictionary key.
   */
  const deleteProvider = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete provider "${id}" and all its models and keys?`)) return;

    // Spread-clone the top level, then delete the key from the cloned providers map.
    const newConfig: AiConfig = {
      ...activeConfig,
      providers: { ...activeConfig.providers },
    };
    delete newConfig.providers[id];
    stageConfig(newConfig);
  };

  /**
   * Replaces one provider's model list with the catalogue returned by its
   * upstream API. The first non-expired key is used because expired keys are
   * deliberately kept in the vault for audit/history but must not be tested.
   */
  const refreshProviderModels = async (id: string) => {
    if (!activeConfig) return;

    const provider = activeConfig.providers[id];
    const usableKey = provider.keys.find((apiKey) => apiKey.type !== 'expired');
    if (!usableKey) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: 'No non-expired key available to query this provider.',
      }));
      return;
    }

    setSyncingProviderId(id);
    setModelSyncMessages((messages) => ({
      ...messages,
      [id]: `Querying with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models);
      if (result.models.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No usable chat or embedding models found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      newConfig.providers[id].models = result.models;
      stageConfig(newConfig);
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${result.models.length} model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize models.',
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  /**
   * Refreshes only the free models (with ":free" in the name) for OpenRouter.
   * Uses the same flow as refreshProviderModels but with the freeOnly flag.
   */
  const refreshProviderFreeModels = async (id: string) => {
    if (!activeConfig) return;

    const provider = activeConfig.providers[id];
    const usableKey = provider.keys.find((apiKey) => apiKey.type !== 'expired');
    if (!usableKey) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: 'No non-expired key available to query this provider.',
      }));
      return;
    }

    setSyncingProviderId(id);
    setModelSyncMessages((messages) => ({
      ...messages,
      [id]: `Querying free models with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models, true);
      if (result.models.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No free models (":free") found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      newConfig.providers[id].models = result.models;
      stageConfig(newConfig);
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${result.models.length} free model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize free models.',
      }));
    } finally {
      setSyncingProviderId(null);
    }
  };

  /**
   * Saves a reordered model array and regenerates priorities from the visible
   * order. Priority `0` is the first model in the list.
   */
  const reorderProviderModels = (id: string, models: AiModel[]) => {
    if (!activeConfig) return;
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(models);
    stageConfig(newConfig);
  };

  /**
   * Deletes several models at once and then compacts priorities using the same
   * step-based numbering as drag-and-drop.
   */
  const deleteProviderModels = (id: string, modelIds: string[]) => {
    if (!activeConfig || modelIds.length === 0) return;
    if (!confirm(`Delete ${modelIds.length} selected model(s) from "${id}"?`)) return;
    const toDelete = new Set(modelIds);
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(
      newConfig.providers[id].models.filter((model) => !toDelete.has(model.id)),
    );
    stageConfig(newConfig);
  };

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!activeConfig && loading) {
    return (
      <div className="flex h-screen items-center justify-center font-medium">
        Loading Vault…
      </div>
    );
  }

  if (!activeConfig) {
    return (
      <div className="p-8 text-center">
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>Failed to load configuration</Alert.Title>
            <Alert.Description>
              Check that the Worker is reachable and your token is correct.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </div>
    );
  }

  // ── Full dashboard layout ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-muted/10">
      {/* ── Sticky top navigation bar ──────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b bg-surface p-4 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">AI Vault Manager</h1>
            {/* Chip used here as a small inline version badge */}
            <Chip size="sm" variant="secondary" className="ml-2">
              v{activeConfig.version}
            </Chip>
            {hasUnsavedChanges && (
              <Chip size="sm" variant="soft" color="warning" className="ml-1">
                Unsaved
              </Chip>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Refresh re-fetches the decrypted config from the Worker */}
            <Button variant="ghost" size="sm" onPress={refreshFromWorker} isPending={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={discardDraft}
              isDisabled={!hasUnsavedChanges}
            >
              <X className="mr-2 h-4 w-4" />
              Discard
            </Button>
            <Button
              size="sm"
              onPress={saveDraftToWorker}
              isPending={loading}
              isDisabled={!hasUnsavedChanges}
            >
              <Save className="mr-2 h-4 w-4" />
              Save Vault
            </Button>
            <Button
              variant={showPlayground ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setShowPlayground((current) => !current)}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              Playground
            </Button>
            <Button variant="danger-soft" size="sm" onPress={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {/* Global error banner */}
        {error && (
          <Alert status="danger" className="mb-6">
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {showPlayground ? (
          <PlaygroundPanel config={activeConfig} />
        ) : (
          /*
           * Top-level tabs. Currently only "Providers" exists but the tab bar
           * makes it easy to add an "Overview" or "Settings" tab later.
           *
           * selectedKey / onSelectionChange is react-aria's
           * controlled pattern for tabs — same idea as controlled inputs in React.
           */
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(k) => setActiveTab(k as string)}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Vault sections">
                <Tabs.Tab id="providers">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Providers
                  </div>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            <Tabs.Panel id="providers" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Managed AI Providers</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('provider', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Provider
                </Button>
              </div>

              <div className="grid gap-6">
                {Object.entries(activeConfig.providers).map(([id, provider]) => (
                  <ProviderCard
                    key={id}
                    id={id}
                    provider={provider}
                    onDelete={() => deleteProvider(id)}
                    onEdit={() =>
                      openModal('provider', { type: 'provider', providerId: id })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', providerId: id })
                    }
                    onAddModel={() =>
                      openModal('model', { type: 'model', providerId: id })
                    }
                    onEditKey={(keyIndex) =>
                      openModal('key', {
                        type: 'key',
                        providerId: id,
                        itemId: keyIndex.toString(),
                      })
                    }
                    onEditModel={(modelId) =>
                      openModal('model', {
                        type: 'model',
                        providerId: id,
                        itemId: modelId,
                      })
                    }
                    onDeleteKey={(index) => {
                      // Immutably remove the key at `index` from the array.
                      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
                      newConfig.providers[id].keys.splice(index, 1);
                      stageConfig(newConfig);
                    }}
                    onDeleteModel={(modelId) => {
                      deleteProviderModels(id, [modelId]);
                    }}
                    onDeleteSelectedModels={(modelIds) => deleteProviderModels(id, modelIds)}
                    onRefreshModels={() => refreshProviderModels(id)}
                    onRefreshFreeModels={() => refreshProviderFreeModels(id)}
                    canRefreshModels={canDiscoverProviderModels(id, provider)}
                    isRefreshingModels={syncingProviderId === id}
                    modelSyncMessage={modelSyncMessages[id]}
                    onReorderModels={(models) => reorderProviderModels(id, models)}
                  />
                ))}
              </div>
            </Tabs.Panel>
          </Tabs>
        )}
      </main>

      {/* ── Config modal (add / edit provider, model, or key) ──────────────── */}
      <ConfigModal
        state={modalState}
        type={modalType}
        editTarget={editTarget}
        config={activeConfig}
        onSave={stageConfig}
      />
    </div>
  );
};

// ─── ProviderCard ─────────────────────────────────────────────────────────────

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
  /** Whether this provider has a known upstream model-list API implementation. */
  canRefreshModels: boolean;
  /** Whether the upstream model-list request is in flight. */
  isRefreshingModels: boolean;
  /** Last sync result or error for the provider. */
  modelSyncMessage?: string;
  /** Called with models in their new visual order. */
  onReorderModels: (models: AiModel[]) => void;
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
const ProviderCard: React.FC<ProviderCardProps> = ({
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
  canRefreshModels,
  isRefreshingModels,
  modelSyncMessage,
  onReorderModels,
}) => {
  const resolvedModelCardEndpoint = getProviderModelCardEndpoint(provider);

  return (
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
                        {/* Show only first 8 and last 4 chars to avoid exposing the key */}
                        <Table.Cell className="font-mono">
                          {apiKey.key.substring(0, 8)}…
                          {apiKey.key.substring(apiKey.key.length - 4)}
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
  );
};

// ─── ModelPriorityList ───────────────────────────────────────────────────────

/** Props for {@link ModelPriorityList}. */
interface ModelPriorityListProps {
  /** Provider identifier used for accessible labels. */
  providerId: string;
  /** Optional model card endpoint for opening model documentation. */
  modelCardEndpoint?: string;
  /** Models in their current visual and priority order. */
  models: AiModel[];
  /** Opens the existing model edit modal. */
  onEditModel: (id: string) => void;
  /** Removes one model from the provider. */
  onDeleteModel: (id: string) => void;
  /** Stages deletion for all selected model ids. */
  onDeleteSelectedModels: (ids: string[]) => void;
  /** Stages a new model order and regenerates priorities upstream. */
  onReorderModels: (models: AiModel[]) => void;
}

/**
 * Drag-and-drop model list.
 *
 * HTML drag events are enough here: we only need to reorder an in-memory array
 * and then save the whole vault. When a row is dropped, the parent rewrites the
 * provider's `models` array and calls `renumberPriorities`, so the priority
 * numbers always match what the user sees on screen.
 */
const ModelPriorityList: React.FC<ModelPriorityListProps> = ({
  providerId,
  modelCardEndpoint,
  models,
  onEditModel,
  onDeleteModel,
  onDeleteSelectedModels,
  onReorderModels,
}) => {
  /** Row currently being dragged, stored as an index into `models`. */
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  /** Row currently hovered as a drop target, used only for visual feedback. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const buildModelCardUrl = (modelId: string) => {
    if (!modelCardEndpoint) return '';
    const endpoint = modelCardEndpoint.trim();
    if (!endpoint) return '';
    if (endpoint.includes('{model}')) {
      return endpoint.split('{model}').join(encodeURIComponent(modelId));
    }
    const trimmedBase = endpoint.replace(/\/+$/, '');
    return `${trimmedBase}/${encodeURIComponent(modelId)}`;
  };

  /** Model IDs checked for a batch delete operation. */
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  /** Clears stale selections when the provider model list changes. */
  useEffect(() => {
    setSelectedModelIds((selectedIds) => {
      const availableIds = new Set(models.map((model) => model.id));
      return new Set([...selectedIds].filter((id) => availableIds.has(id)));
    });
  }, [models]);

  const allModelIds = models.map((model) => model.id);
  const allSelected = allModelIds.length > 0 && allModelIds.every((id) => selectedModelIds.has(id));

  /** Toggles one model checkbox without changing row order. */
  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((selectedIds) => {
      const next = new Set(selectedIds);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  /** Toggles every model in the provider list. */
  const toggleAllModels = () => {
    setSelectedModelIds(allSelected ? new Set() : new Set(allModelIds));
  };

  /** Sends the current selection to the parent, then clears it locally. */
  const deleteSelectedModels = () => {
    const ids = [...selectedModelIds];
    if (ids.length === 0) return;
    onDeleteSelectedModels(ids);
    setSelectedModelIds(new Set());
  };

  /**
   * Moves a row and stages the resulting order. The operation is ignored when
   * the source and target are identical, which keeps accidental clicks cheap.
   */
  const reorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const next = [...models];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorderModels(next);
  };

  if (models.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No models configured for {providerId}.
      </div>
    );
  }

  return (
    <div className="rounded-md border" role="table" aria-label={`${providerId} models`}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-sm text-muted-foreground">
          {selectedModelIds.size} selected
        </p>
        <Button
          size="sm"
          variant="danger-soft"
          onPress={deleteSelectedModels}
          isDisabled={selectedModelIds.size === 0}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete Selected
        </Button>
      </div>
      <div
        className="grid min-w-[920px] grid-cols-[44px_44px_minmax(260px,1fr)_110px_160px_120px_120px] items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground"
        role="row"
      >
        <span role="columnheader" aria-label="Drag handle" />
        <span role="columnheader" aria-label="Select models">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAllModels}
            aria-label={`Select all ${providerId} models`}
          />
        </span>
        <span role="columnheader">Model ID</span>
        <span role="columnheader">Usage</span>
        <span role="columnheader">Context</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader" className="text-end">Actions</span>
      </div>

      <div className="overflow-x-auto">
        {models.map((model, index) => (
          <div
            key={model.id}
            draggable
            role="row"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', String(index));
              setDraggedIndex(index);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(event) => {
              event.preventDefault();
              const fromIndex = Number(event.dataTransfer.getData('text/plain'));
              if (Number.isInteger(fromIndex)) reorder(fromIndex, index);
              setDraggedIndex(null);
              setDropIndex(null);
            }}
            onDragEnd={() => {
              setDraggedIndex(null);
              setDropIndex(null);
            }}
            className={[
              'grid min-w-[920px] grid-cols-[44px_44px_minmax(260px,1fr)_110px_160px_120px_120px] items-center gap-3 border-b px-3 py-2 last:border-b-0',
              'transition-colors',
              draggedIndex === index ? 'bg-muted/30 opacity-70' : '',
              dropIndex === index && draggedIndex !== index ? 'bg-primary/10' : '',
            ].join(' ')}
          >
            <div role="cell" className="flex h-9 items-center justify-center text-muted-foreground">
              <GripVertical className="h-4 w-4 cursor-grab" aria-hidden="true" />
            </div>
            <div role="cell" className="flex h-9 items-center justify-center">
              <input
                type="checkbox"
                checked={selectedModelIds.has(model.id)}
                onChange={() => toggleModelSelection(model.id)}
                aria-label={`Select model ${model.id}`}
              />
            </div>
            <div role="cell" className="min-w-0 font-medium">
              {modelCardEndpoint ? (
                <a
                  href={buildModelCardUrl(model.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  draggable={false}
                  className="block truncate text-primary underline-offset-2 hover:underline"
                  title={`Open model card for ${model.id}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {model.id}
                </a>
              ) : (
                <span className="block truncate" title={model.id}>{model.id}</span>
              )}
            </div>
            <div role="cell">
              <Chip size="sm" variant="soft" color={model.usage === 'embedding' ? 'accent' : 'default'}>
                {model.usage}
              </Chip>
            </div>
            <div role="cell" className="text-sm">
              {model.contextWindow.toLocaleString()} tokens
            </div>
            <div role="cell">
              <Chip size="sm" variant={model.priority === 0 ? 'primary' : 'secondary'}>
                {model.priority}
              </Chip>
            </div>
            <div role="cell" className="flex justify-end gap-1">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => onEditModel(model.id)}
                aria-label={`Edit model ${model.id}`}
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                onPress={() => onDeleteModel(model.id)}
                aria-label={`Delete model ${model.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── ConfigModal ──────────────────────────────────────────────────────────────

/** Props for {@link ConfigModal}. */
interface ConfigModalProps {
  /** Controlled open/close state from `useOverlayState()`. */
  state: ReturnType<typeof useOverlayState>;
  /** Which form to render inside the modal. */
  type: EditTarget['type'];
  /**
   * When non-null, we are in "edit" mode and this locates the existing entity.
   * When null, we are in "add" mode.
   */
  editTarget: EditTarget | null;
  /** The full vault config — used to pre-fill edit forms. */
  config: AiConfig;
  /** Called with the updated config once the user submits the form. */
  onSave: (config: AiConfig) => void;
}

/**
 * Unified modal for adding and editing Providers, Models, and API Keys.
 *
 * We use the native `FormData` API to collect form values
 * instead of a form library, which keeps this component dependency-free.
 * The trade-off is that we must convert number fields manually.
 */
const ConfigModal: React.FC<ConfigModalProps> = ({
  state,
  type,
  editTarget,
  config,
  onSave,
}) => {
  /**
   * Returns the pre-filled value for a given field when editing an existing entity.
   * Returns an empty string for "add new" mode.
   *
   * @param fieldName - The property name on the entity object (e.g. "endpoint").
   */
  const getInitialValue = (fieldName: string): string => {
    if (!editTarget) return '';
    const provider = config.providers[editTarget.providerId];

    if (type === 'provider') {
      if (fieldName === 'id') return editTarget.providerId;
      if (fieldName === 'modelCardEndpoint') {
        const providerWithLegacy = provider as AiProvider & { model_card_endpoint?: string };
        return String(provider.modelCardEndpoint ?? providerWithLegacy.model_card_endpoint ?? '');
      }
      // Cast via unknown to safely index by string key — values come from known provider fields.
      return String(((provider as unknown) as Record<string, unknown>)[fieldName] ?? '');
    }
    if (type === 'model' && editTarget.itemId) {
      const model = provider.models.find((m) => m.id === editTarget.itemId);
      return String((((model as unknown) as Record<string, unknown> | undefined))?.[fieldName] ?? '');
    }
    if (type === 'key' && editTarget.itemId !== undefined) {
      const apiKey = provider.keys[Number(editTarget.itemId)];
      return String((((apiKey as unknown) as Record<string, unknown> | undefined))?.[fieldName] ?? '');
    }
    return '';
  };

  /**
   * Processes the submitted form data and calls `onSave` with the updated config.
   * All mutation is done on a deep clone so we never modify React state directly.
   */
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries()) as Record<string, string>;

    // Deep clone to avoid mutating the state object that React holds.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(config));

    if (type === 'provider') {
      const providerId = data.id;
      const providerBody: AiProvider = {
        protocol: data.protocol as AiProtocol,
        endpoint: data.endpoint,
        gatewayEndpoint: data.gatewayEndpoint || undefined,
        gatewayModelPrefix: data.gatewayModelPrefix || undefined,
        modelCardEndpoint: data.modelCardEndpoint || undefined,
        // Preserve existing keys/models when renaming or editing a provider.
        keys: editTarget ? newConfig.providers[editTarget.providerId].keys : [],
        models: editTarget
          ? newConfig.providers[editTarget.providerId].models
          : [],
      };

      // If the provider was renamed (id changed), remove the old entry first.
      if (editTarget && editTarget.providerId !== providerId) {
        delete newConfig.providers[editTarget.providerId];
      }
      newConfig.providers[providerId] = providerBody;
    } else if (type === 'model' && editTarget) {
      const model: AiModel = {
        id: data.id,
        usage: data.usage === 'embedding' ? 'embedding' : 'chat',
        contextWindow: Number(data.contextWindow),
        maxOutputTokens: Number(data.maxOutputTokens),
        priority: Number(data.priority),
        tpmLimit: data.tpmLimit ? Number(data.tpmLimit) : null,
      };

      const models = newConfig.providers[editTarget.providerId].models;
      if (editTarget.itemId) {
        // Replace the existing model by matching its id.
        const idx = models.findIndex((m) => m.id === editTarget.itemId);
        if (idx !== -1) models[idx] = model;
      } else {
        models.push(model);
      }
    } else if (type === 'key' && editTarget) {
      const apiKey: AiKey = {
        key: data.key,
        owner: data.owner || undefined,
        type: (data.type as AiKey['type']) || undefined,
      };

      const keys = newConfig.providers[editTarget.providerId].keys;
      if (editTarget.itemId !== undefined) {
        // Replace the existing key at the stored array index.
        keys[Number(editTarget.itemId)] = apiKey;
      } else {
        keys.push(apiKey);
      }
    }

    onSave(newConfig);
  };

  /** Human-readable modal title. */
  const title = `${editTarget ? 'Edit' : 'Add'} ${
    type.charAt(0).toUpperCase() + type.slice(1)
  }`;

  return (
    /*
     * Modal.Root receives the `state` object from useOverlayState() which holds
     * `isOpen` and `setOpen`. HeroUI passes them down to the underlying
     * react-aria DialogTrigger so opening/closing is controlled from outside.
     */
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>

            <Form onSubmit={handleSubmit}>
              <Modal.Body className="flex flex-col gap-4">
                {/* ── Provider form ────────────────────────────────────── */}
                {type === 'provider' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Unique ID</Label>
                      <Input placeholder="openai-primary" />
                    </TextField>

                    <TextField
                      isRequired
                      name="protocol"
                      defaultValue={getInitialValue('protocol')}
                    >
                      <Label>Protocol</Label>
                      <Input placeholder="openai, groq, anthropic…" />
                    </TextField>

                    <TextField
                      isRequired
                      name="endpoint"
                      defaultValue={getInitialValue('endpoint')}
                    >
                      <Label>API Endpoint</Label>
                      <Input placeholder="https://api.openai.com/v1" />
                    </TextField>

                    <TextField
                      name="gatewayEndpoint"
                      defaultValue={getInitialValue('gatewayEndpoint')}
                    >
                      <Label>CF Gateway Endpoint (optional)</Label>
                      <Input />
                    </TextField>

                    <TextField
                      name="gatewayModelPrefix"
                      defaultValue={getInitialValue('gatewayModelPrefix')}
                    >
                      <Label>CF Gateway Model Prefix (optional)</Label>
                      <Input placeholder="@cf/openai/" />
                    </TextField>

                    <TextField
                      name="modelCardEndpoint"
                      defaultValue={getInitialValue('modelCardEndpoint')}
                    >
                      <Label>Model Card Endpoint (optional)</Label>
                      <Input placeholder="https://platform.openai.com/models/{model}" />
                    </TextField>
                  </>
                )}

                {/* ── Model form ───────────────────────────────────────── */}
                {type === 'model' && (
                  <>
                    <TextField isRequired name="id" defaultValue={getInitialValue('id')}>
                      <Label>Model ID</Label>
                      <Input placeholder="gpt-4o" />
                    </TextField>

                    <TextField
                      isRequired
                      name="usage"
                      defaultValue={getInitialValue('usage') || 'chat'}
                    >
                      <Label>Usage</Label>
                      <Input placeholder="chat or embedding" />
                    </TextField>

                    <div className="grid grid-cols-2 gap-4">
                      <TextField
                        isRequired
                        name="contextWindow"
                        defaultValue={getInitialValue('contextWindow')}
                      >
                        <Label>Context Window</Label>
                        <Input type="number" min="1" />
                      </TextField>

                      <TextField
                        isRequired
                        name="maxOutputTokens"
                        defaultValue={getInitialValue('maxOutputTokens')}
                      >
                        <Label>Max Output Tokens</Label>
                        <Input type="number" min="1" />
                      </TextField>
                    </div>

                    <TextField
                      isRequired
                      name="priority"
                      defaultValue={getInitialValue('priority')}
                    >
                      <Label>Priority (0 = highest)</Label>
                      <Input type="number" min="0" />
                    </TextField>

                    <TextField
                      name="tpmLimit"
                      defaultValue={getInitialValue('tpmLimit')}
                    >
                      <Label>TPM Limit (optional)</Label>
                      <Input type="number" min="1" placeholder="Leave empty for unlimited" />
                    </TextField>
                  </>
                )}

                {/* ── API Key form ─────────────────────────────────────── */}
                {type === 'key' && (
                  <>
                    <TextField isRequired name="key" defaultValue={getInitialValue('key')}>
                      <Label>API Key</Label>
                      {/* type="password" hides the key value visually */}
                      <Input type="password" autoComplete="new-password" />
                    </TextField>

                    <TextField
                      name="owner"
                      defaultValue={getInitialValue('owner')}
                    >
                      <Label>Owner Name (optional)</Label>
                      <Input placeholder="e.g. team-backend" />
                    </TextField>

                    <TextField
                      name="type"
                      defaultValue={getInitialValue('type')}
                    >
                      <Label>Key Tier (optional)</Label>
                      <Input placeholder="free, paid, premium, unlimited…" />
                    </TextField>
                  </>
                )}
              </Modal.Body>

              <Modal.Footer>
                {/* X button dismisses without saving */}
                <Button variant="ghost" onPress={() => state.close()}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button type="submit">
                  <Save className="mr-2 h-4 w-4" />
                  Apply to Draft
                </Button>
              </Modal.Footer>
            </Form>

            {/* Built-in close button in the modal top-right corner */}
            <Modal.CloseTrigger />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};

