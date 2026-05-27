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
  Chip,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import { useAi } from '../hooks/use-ai';
import {
  FlaskConical,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  X,
} from 'lucide-react';
import type { AiConfig, AiModel } from '../types/ai-config';
import {
  canDiscoverProviderModels,
  discoverProviderModels,
  maskApiKey,
  renumberPriorities,
} from '../lib/provider-models';
import { PlaygroundPanel } from './playground-panel';
import { ProviderCard } from './ui/ProviderCard';
import { ConfigModal } from './ui/ConfigModal';
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
   * Refreshes only the latest models (ending with "-latest") for Mistral.
   * Uses the same flow as refreshProviderModels but filters for "-latest" suffix.
   */
  const refreshProviderLatestModels = async (id: string) => {
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
      [id]: `Querying latest models with key ${maskApiKey(usableKey.key)}…`,
    }));

    try {
      const result = await discoverProviderModels(id, provider, usableKey.key, provider.models);
      // Filter models to keep only those ending with "-latest"
      const latestModels = result.models.filter(model => model.id.endsWith('-latest'));

      if (latestModels.length === 0) {
        setModelSyncMessages((messages) => ({
          ...messages,
          [id]: 'No models ending with "-latest" found in the API response.',
        }));
        return;
      }

      const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
      newConfig.providers[id].models = latestModels;
      stageConfig(newConfig);
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: [
          `${latestModels.length} latest model(s) synchronized.`,
          ...result.notes,
        ].join(' '),
      }));
    } catch (err) {
      setModelSyncMessages((messages) => ({
        ...messages,
        [id]: err instanceof Error ? err.message : 'Unable to synchronize latest models.',
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
                    onRefreshLatestModels={() => refreshProviderLatestModels(id)}
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

