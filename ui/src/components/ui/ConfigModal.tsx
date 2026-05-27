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

import React from 'react';
import {
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  useOverlayState,
} from '@heroui/react';
import { Save, X } from 'lucide-react';
import type { AiConfig, AiProtocol, AiProvider, AiModel, AiKey } from '../../types/ai-config';

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
export const ConfigModal: React.FC<ConfigModalProps> = ({
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
      const val = (((model as unknown) as Record<string, unknown> | undefined))?.[fieldName];
      if (Array.isArray(val)) return JSON.stringify(val);
      return String(val ?? '');
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
      const usageValues = ['chat', 'embedding', 'transcription', 'tts', 'image-generation'] as const;
      const validUsage = usageValues.find((u) => u === data.usage) ?? 'chat';

      // Collect modality checkboxes (FormData entries named inputModalities or outputModalities).
      const rawInputModalities = formData.getAll('inputModalities') as string[];
      const rawOutputModalities = formData.getAll('outputModalities') as string[];
      const inputModalities = rawInputModalities as AiModel['inputModalities'];
      const outputModalities = rawOutputModalities as AiModel['outputModalities'];

      const model: AiModel = {
        id: data.id,
        usage: validUsage,
        contextWindow: Number(data.contextWindow),
        maxOutputTokens: Number(data.maxOutputTokens),
        priority: Number(data.priority),
        tpmLimit: data.tpmLimit ? Number(data.tpmLimit) : null,
        ...(rawInputModalities.length > 0 ? { inputModalities } : {}),
        ...(rawOutputModalities.length > 0 ? { outputModalities } : {}),
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
                      <Input placeholder="chat, embedding, transcription, tts, image-generation" />
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

                    {/* Option D — manual modality override */}
                    {(() => {
                      const currentInput: string[] = JSON.parse(
                        getInitialValue('inputModalities') || '["text"]',
                      );
                      const currentOutput: string[] = JSON.parse(
                        getInitialValue('outputModalities') || '["text"]',
                      );
                      return (
                        <>
                          <div>
                            <Label className="mb-1 block text-sm">Input modalities</Label>
                            <div className="flex flex-wrap gap-3">
                              {(['text', 'image', 'audio', 'video'] as const).map((m) => (
                                <label key={m} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    name="inputModalities"
                                    value={m}
                                    defaultChecked={currentInput.includes(m)}
                                  />
                                  {m}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="mb-1 block text-sm">Output modalities</Label>
                            <div className="flex flex-wrap gap-3">
                              {(['text', 'image', 'audio'] as const).map((m) => (
                                <label key={m} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    name="outputModalities"
                                    value={m}
                                    defaultChecked={currentOutput.includes(m)}
                                  />
                                  {m}
                                </label>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })()}
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