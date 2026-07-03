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
  Download,
  FlaskConical,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shield,
  Upload,
  Webhook,
  X,
  Cloud,
} from 'lucide-react';
import type { AiConfig, AiModel } from '../types/ai-config';
import {
  canDiscoverProviderModels,
  discoverProviderModels,
  maskApiKey,
  renumberPriorities,
} from '../lib/provider-models';
import { validateAiConfigSchema } from '../lib/utils/file-utils';
import { ChatbotPanel } from './chatbot-panel';
import { AdminPanel } from './admin-panel';
import { ProviderCard } from './ui/ProviderCard';
import { CrawlerCard } from './ui/CrawlerCard';
import { WeatherApiCard } from './ui/WeatherApiCard';
import { ConfigModal } from './ui/ConfigModal';
import { ApiService } from '../lib/api';
// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Identifies the entity being added or edited inside the modal.
 * `itemId` is optional:
 *   - provider: not used (providerId is the identifier)
 *   - crawler: not used (crawlerId is the identifier)
 *   - model: the model.id string
 *   - key: the numeric index in the keys array (as a string)
 */
interface EditTarget {
  type: 'provider' | 'model' | 'key' | 'crawler' | 'weatherApi';
  providerId?: string;
  crawlerId?: string;
  weatherApiId?: string;
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
  const { config, loading, error, logout, refresh, updateConfig, userContext } = useAi();

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

  /** Per-provider list of available model IDs from the last API refresh. */
  const [availableModelIds, setAvailableModelIds] = useState<Record<string, string[]>>({});

  /** Set of model IDs that are available for BYOK. */
  const [byokModelIds, setByokModelIds] = useState<Set<string>>(new Set());

  /** Set of crawler IDs that are available for BYOK. */
  const [byokCrawlerIds, setByokCrawlerIds] = useState<Set<string>>(new Set());

  /** Set of weather API IDs that are available for BYOK. */
  const [byokWeatherApiIds, setByokWeatherApiIds] = useState<Set<string>>(new Set());


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

  /**
   * Load BYOK configuration from the Worker on initial load.
   */
  useEffect(() => {
    const loadByokConfig = async () => {
      try {
        const token = ApiService.getToken();
        if (!token) return;

        const response = await fetch(`${import.meta.env.VAULT_URL}/v1/keypool/byok/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          // If BYOK config doesn't exist yet, that's fine - start with empty sets
          if (response.status === 404) {
            return;
          }
          throw new Error(`Failed to load BYOK config: ${response.status}`);
        }

        const byokConfig: AiConfig = await response.json();

        // Initialize BYOK model IDs from the loaded config
        const initialByokModelIds = new Set<string>();
        for (const provider of Object.values(byokConfig.providers || {})) {
          for (const model of provider.models) {
            initialByokModelIds.add(model.id);
          }
        }

        // Initialize BYOK crawler IDs from the loaded config
        const initialByokCrawlerIds = new Set<string>();
        for (const crawlerId of Object.keys(byokConfig.crawlers || {})) {
          initialByokCrawlerIds.add(crawlerId);
        }

        setByokModelIds(initialByokModelIds);
        setByokCrawlerIds(initialByokCrawlerIds);

      } catch (err) {
        console.error('Failed to load BYOK configuration:', err);
        // Don't show error to user - BYOK is optional feature
      }
    };

    // Only load BYOK config if we have a valid config loaded
    if (config) {
      loadByokConfig();
    }
  }, [config]);

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
   * Saves the BYOK configuration to the Worker.
   * Creates an AiConfig with only the BYOK-enabled models and crawlers, with empty key arrays.
   */
  const saveByokConfig = async () => {
    if (!activeConfig) return;

    try {
      // Create a BYOK config with only the selected models and crawlers
      const byokConfig: AiConfig = {
        version: activeConfig.version,
        providers: {},
        crawlers: {},
      };

      // Add providers that have BYOK-enabled models
      for (const [providerId, provider] of Object.entries(activeConfig.providers)) {
        const byokModels = provider.models.filter(model => byokModelIds.has(model.id));

        if (byokModels.length > 0) {
          byokConfig.providers[providerId] = {
            ...provider,
            keys: [], // Empty keys for BYOK
            models: byokModels,
          };
        }
      }

      // Add BYOK-enabled crawlers
      for (const [crawlerId, crawler] of Object.entries(activeConfig.crawlers)) {
        if (byokCrawlerIds.has(crawlerId)) {
          byokConfig.crawlers[crawlerId] = {
            ...crawler,
            keys: [], // Empty keys for BYOK
          };
        }
      }

      // Send the BYOK config to the Worker
      const response = await fetch(`${import.meta.env.VAULT_URL}/v1/keypool/byok/models`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ApiService.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(byokConfig),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to save BYOK config');
      }

      alert('BYOK configuration saved successfully!');
    } catch (err) {
      console.error('BYOK save failed', err);
      alert(`Failed to save BYOK configuration: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
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
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from result.models.
      const newModelIds = new Set(result.models.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...result.models, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = result.models.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

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
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from result.models.
      const newModelIds = new Set(result.models.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...result.models, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = result.models.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

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
      
      // Merge: keep existing models that are not in the new list, 
      // but update existing ones and add new ones from latestModels.
      const newModelIds = new Set(latestModels.map(m => m.id));
      const missingModels = newConfig.providers[id].models.filter(m => !newModelIds.has(m.id));
      
      newConfig.providers[id].models = [...latestModels, ...missingModels];
      stageConfig(newConfig);

      // Store available model IDs for missing model detection
      const availableIds = latestModels.map(model => model.id);
      setAvailableModelIds((prev) => ({
        ...prev,
        [id]: availableIds,
      }));

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

  /**
   * Deletes models that are no longer available in the provider's API.
   * This is called from the ModelDeletionModal when the user confirms deletion.
   */
  const deleteMissingModels = (id: string, modelIds: string[]) => {
    if (!activeConfig || modelIds.length === 0) return;
    const toDelete = new Set(modelIds);
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.providers[id].models = renumberPriorities(
      newConfig.providers[id].models.filter((model) => !toDelete.has(model.id)),
    );
    stageConfig(newConfig);

    // Clear the available model IDs for this provider to avoid re-triggering the modal
    setAvailableModelIds((prev) => ({
      ...prev,
      [id]: [],
    }));
  };

  /**
   * Removes a crawler (and all its keys) from the config.
   * @param id - The crawler dictionary key.
   */
  const deleteCrawler = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete crawler "${id}" and all its keys?`)) return;

    // Spread-clone the top level, then delete the key from the cloned crawlers map.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    delete newConfig.crawlers[id];
    stageConfig(newConfig);
  };

  /**
   * Removes a weather API (and all its keys) from the config.
   * @param id - The weather API dictionary key.
   */
  const deleteWeatherApi = (id: string) => {
    if (!activeConfig) return;
    if (!confirm(`Delete weather API "${id}" and all its keys?`)) return;

    // Spread-clone the top level, then delete the weatherApi.
    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    delete newConfig.weatherApi;
    stageConfig(newConfig);
  };

  /**
   * Deletes a key from a weather API.
   * @param weatherApiId - The weather API dictionary key.
   * @param keyIndex - The index of the key to delete.
   */
  const deleteWeatherApiKey = (weatherApiId: string, keyIndex: number) => {
    if (!activeConfig) return;
    if (!confirm(`Delete this API key from "${weatherApiId}"?`)) return;

    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    if (newConfig.weatherApi) {
      newConfig.weatherApi.keys.splice(keyIndex, 1);
      stageConfig(newConfig);
    }
  };

  /**
   * Deletes a key from a crawler.
   * @param crawlerId - The crawler dictionary key.
   * @param keyIndex - The index of the key to delete.
   */
  const deleteCrawlerKey = (crawlerId: string, keyIndex: number) => {
    if (!activeConfig) return;
    if (!confirm(`Delete this API key from "${crawlerId}"?`)) return;

    const newConfig: AiConfig = JSON.parse(JSON.stringify(activeConfig));
    newConfig.crawlers[crawlerId].keys.splice(keyIndex, 1);
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
              size="sm"
              variant="secondary"
              onPress={saveByokConfig}
              isPending={loading}
            >
              <Save className="mr-2 h-4 w-4" />
              Save BYOK
            </Button>
            <Button
              variant={showPlayground ? 'primary' : 'ghost'}
              size="sm"
              onPress={() => setShowPlayground((current) => !current)}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              Chatbot
            </Button>
            <Button variant="ghost" size="sm" onPress={() => {
              const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
              const filename = `ai.${timestamp}.json`;
              const jsonData = JSON.stringify(activeConfig, null, 2);
              const blob = new Blob([jsonData], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onPress={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = '.json';
              fileInput.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                  try {
                    const content = event.target?.result as string;
                    const parsedConfig = JSON.parse(content);

                    // Validate the schema
                    if (!validateAiConfigSchema(parsedConfig)) {
                      alert('Invalid configuration file. Please upload a valid AI configuration file.');
                      return;
                    }

                    // Merge with current config or replace?
                    if (confirm('Replace current configuration with the uploaded file?')) {
                      stageConfig(parsedConfig);
                    }
                  } catch (error) {
                    console.error('Error parsing configuration file:', error);
                    alert('Error parsing configuration file. Please check the file format.');
                  }
                };
                reader.readAsText(file);
              };
              fileInput.click();
            }}>
              <Upload className="h-4 w-4" />
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

        {/* Role-based access control banner */}
        {userContext && userContext.role !== 'admin' && userContext.role !== 'superadmin' && (
          <Alert status="default" className="mb-6">
            <Alert.Content>
              <Alert.Description>
                Read-only mode. You are not an admin.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {showPlayground ? (
          <ChatbotPanel />
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
                <Tabs.Tab id="crawlers">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4" />
                    Crawlers
                  </div>
                </Tabs.Tab>
                <Tabs.Tab id="weatherApi">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    Weather APIs
                  </div>
                </Tabs.Tab>
                {(userContext?.role === 'admin' || userContext?.role === 'superadmin') && (
                  <Tabs.Tab id="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Administration
                    </div>
                  </Tabs.Tab>
                )}
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
                    onDeleteMissingModels={(modelIds) => deleteMissingModels(id, modelIds)}
                    availableModelIds={availableModelIds[id]}
                    onToggleByok={(modelId, isByok) => {
                      setByokModelIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) next.add(modelId);
                        else next.delete(modelId);
                        return next;
                      });
                    }}
                    byokModelIds={byokModelIds}
                  />
                ))}
              </div>
            </Tabs.Panel>

            <Tabs.Panel id="crawlers" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Web Crawlers</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('crawler', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Crawler
                </Button>
              </div>

              <div className="grid gap-6">
                {activeConfig.crawlers && Object.entries(activeConfig.crawlers).map(([id, crawler]) => (
                  <CrawlerCard
                    key={id}
                    id={id}
                    crawler={crawler}
                    onDelete={() => deleteCrawler(id)}
                    onEdit={() =>
                      openModal('crawler', { type: 'crawler', crawlerId: id })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', crawlerId: id })
                    }
                    onEditKey={(keyIndex) =>
                      openModal('key', {
                        type: 'key',
                        crawlerId: id,
                        itemId: keyIndex.toString(),
                      })
                    }
                    onDeleteKey={(index) => deleteCrawlerKey(id, index)}
                    onToggleByok={(isByok) => {
                      setByokCrawlerIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    isByok={byokCrawlerIds.has(id)}
                  />
                ))}
              </div>
            </Tabs.Panel>

            <Tabs.Panel id="weatherApi" className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Weather APIs</h2>
                <Button
                  size="sm"
                  onPress={() => openModal('weatherApi', null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Weather API
                </Button>
              </div>

              <div className="grid gap-6">
                {activeConfig.weatherApi && (
                  <WeatherApiCard
                    key="weatherApi"
                    id="weatherApi"
                    weatherApi={activeConfig.weatherApi}
                    onDelete={() => deleteWeatherApi('weatherApi')}
                    onEdit={() =>
                      openModal('weatherApi', { type: 'weatherApi', weatherApiId: 'weatherApi' })
                    }
                    onAddKey={() =>
                      openModal('key', { type: 'key', weatherApiId: 'weatherApi' })
                    }
                    onEditKey={(keyIndex: number) =>
                      openModal('key', {
                        type: 'key',
                        weatherApiId: 'weatherApi',
                        itemId: keyIndex.toString(),
                      })
                    }
                    onDeleteKey={(index: number) => deleteWeatherApiKey('weatherApi', index)}
                    onToggleByok={(isByok: boolean) => {
                      setByokWeatherApiIds((prev) => {
                        const next = new Set(prev);
                        if (isByok) {
                          next.add('weatherApi');
                        } else {
                          next.delete('weatherApi');
                        }
                        return next;
                      });
                    }}
                    isByok={byokWeatherApiIds.has('weatherApi')}
                  />
                )}
              </div>
            </Tabs.Panel>

            {(userContext?.role === 'admin' || userContext?.role === 'superadmin') && (
              <Tabs.Panel id="admin" className="mt-6">
                <AdminPanel />
              </Tabs.Panel>
            )}
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