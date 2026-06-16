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

import React, { useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Edit, GripVertical, Trash2 } from 'lucide-react';
import type { AiModel } from '../../types/ai-config';

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
export const ModelPriorityList: React.FC<ModelPriorityListProps> = ({
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
      return endpoint.split('{model}').join((modelId));
    }
    const trimmedBase = endpoint.replace(/\/+$/, '');
    return `${trimmedBase}/${(modelId)}`;
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
        className="grid min-w-230 grid-cols-[44px_44px_minmax(260px,1fr)_110px_160px_160px_120px_120px] items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground"
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
        <span role="columnheader">Modalities</span>
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
              'grid min-w-230 grid-cols-[44px_44px_minmax(260px,1fr)_110px_160px_160px_120px_120px] items-center gap-3 border-b px-3 py-2 last:border-b-0',
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
            <div role="cell" className="flex flex-wrap gap-1">
              {(model.inputModalities ?? ['text']).map((m) => (
                <Chip key={`in-${m}`} size="sm" variant="soft" color="accent" title={`Input: ${m}`}>
                  {m}↓
                </Chip>
              ))}
              {(model.outputModalities ?? ['text']).filter((m) =>
                !(model.inputModalities ?? ['text']).includes(m as 'text'),
              ).map((m) => (
                <Chip key={`out-${m}`} size="sm" variant="soft" color="default" title={`Output: ${m}`}>
                  {m}↑
                </Chip>
              ))}
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