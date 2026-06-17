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
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import React, { useState } from 'react';
import {
  Button,
  Modal,
  Table,
  useOverlayState,
} from '@heroui/react';
import { AlertTriangle, Trash2, X} from 'lucide-react';
import type { AiModel } from '../../types/ai-config';

/** Props for {@link ModelDeletionModal}. */
interface ModelDeletionModalProps {
  /** Controlled open/close state from `useOverlayState()`. */
  state: ReturnType<typeof useOverlayState>;
  /** Provider ID for which models are being deleted. */
  providerId: string;
  /** Models that exist in the current config but not in the API response. */
  modelsToDelete: AiModel[];
  /** Called with the array of model IDs to delete. */
  onDeleteModels: (modelIds: string[]) => void;
}

/**
 * Modal for confirming deletion of models that are no longer available
 * in the provider's API after a refresh operation.
 */
export const ModelDeletionModal: React.FC<ModelDeletionModalProps> = ({
  state,
  providerId,
  modelsToDelete,
  onDeleteModels,
}) => {
  // Track which models are selected for deletion (all checked by default)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set()
  );

  // Synchronize state when modelsToDelete changes
  React.useEffect(() => {
    setSelectedModelIds(new Set(modelsToDelete.map((model) => model.id)));
  }, [modelsToDelete]);

  // Select/deselect all models
  const toggleAllModels = () => {
    if (selectedModelIds.size === modelsToDelete.length) {
      setSelectedModelIds(new Set());
    } else {
      setSelectedModelIds(new Set(modelsToDelete.map(model => model.id)));
    }
  };

  // Toggle selection for a single model
  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  // Handle form submission
  const handleDelete = () => {
    const modelIdsToDelete = Array.from(selectedModelIds);
    onDeleteModels(modelIdsToDelete);
    state.close();
  };

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-w-2xl">
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Models No Longer Available
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="mb-4">
                <p className="text-sm text-muted-foreground">
                  The following models exist in your {providerId} configuration but were not found in the provider's API.
                  These models may have been deprecated or removed by the provider.
                </p>
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table variant="secondary">
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Models to delete">
                      <Table.Header>
                        <Table.Column>
                          <input
                            type="checkbox"
                            checked={selectedModelIds.size === modelsToDelete.length && modelsToDelete.length > 0}
                            onChange={toggleAllModels}
                            aria-label="Select all models"
                          />
                        </Table.Column>
                        <Table.Column isRowHeader>Model ID</Table.Column>
                        <Table.Column>Usage</Table.Column>
                        <Table.Column>Context Window</Table.Column>
                        <Table.Column>Priority</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {modelsToDelete.length === 0 ? (
                          <Table.Row>
                            <Table.Cell colSpan={5} className="text-center py-4">
                              No models to delete.
                            </Table.Cell>
                          </Table.Row>
                        ) : (
                          modelsToDelete.map((model) => (
                            <Table.Row key={model.id}>
                              <Table.Cell>
                                <input
                                  type="checkbox"
                                  checked={selectedModelIds.has(model.id)}
                                  onChange={() => toggleModelSelection(model.id)}
                                  aria-label={`Select ${model.id} for deletion`}
                                />
                              </Table.Cell>
                              <Table.Cell className="font-medium">{model.id}</Table.Cell>
                              <Table.Cell>
                                <span className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">
                                  {model.usage}
                                </span>
                              </Table.Cell>
                              <Table.Cell>{model.contextWindow.toLocaleString()} tokens</Table.Cell>
                              <Table.Cell>
                                <span className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                                  {model.priority}
                                </span>
                              </Table.Cell>
                            </Table.Row>
                          ))
                        )}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="ghost" onPress={() => state.close()}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button
                variant="danger"
                onPress={handleDelete}
                isDisabled={selectedModelIds.size === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected ({selectedModelIds.size})
              </Button>
            </Modal.Footer>

            <Modal.CloseTrigger />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};