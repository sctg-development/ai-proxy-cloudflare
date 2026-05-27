// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// (full license header omitted for brevity — same as project root)

import React from 'react';
import { Label, ListBox, Select } from '@heroui/react';
import type { AiModel, AiProvider } from '../../types/ai-config';
import { maskApiKey } from '../../lib/provider-models';
import { AUTO_ROUND_ROBIN_KEY } from '../../lib/playground/constants';

export interface ProviderModelKeySelectorProps {
  providerIds: string[];
  providerId: string;
  modelId: string;
  selectedKey: string;
  chatModels: AiModel[];
  usableKeys: AiProvider['keys'];
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onSelectedKeyChange: (key: string) => void;
}

/**
 * Renders the three provider / model / API-key selects.
 * Contains no business logic — all data flows in via props.
 */
export const ProviderModelKeySelector: React.FC<ProviderModelKeySelectorProps> = ({
  providerIds,
  providerId,
  modelId,
  selectedKey,
  chatModels,
  usableKeys,
  onProviderChange,
  onModelChange,
  onSelectedKeyChange,
}) => (
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    <Select
      className="w-full"
      placeholder="Select a provider"
      value={providerId}
      onChange={(value) => onProviderChange(String(value ?? ''))}
    >
      <Label>Provider</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {providerIds.map((id) => (
            <ListBox.Item key={id} id={id} textValue={id}>
              {id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>

    <Select
      className="w-full"
      placeholder="Select a model"
      value={modelId}
      onChange={(value) => onModelChange(String(value ?? ''))}
    >
      <Label>Model</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {chatModels.map((m) => (
            <ListBox.Item key={m.id} id={m.id} textValue={m.id}>
              {m.id}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>

    <Select
      className="w-full"
      isDisabled={usableKeys.length === 0}
      placeholder="Select a provider API key"
      value={selectedKey}
      onChange={(value) => onSelectedKeyChange(String(value ?? AUTO_ROUND_ROBIN_KEY))}
    >
      <Label>Provider API key</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={AUTO_ROUND_ROBIN_KEY} key={AUTO_ROUND_ROBIN_KEY} textValue="Auto (round robin)">
            Auto (round robin)
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {usableKeys.map((apiKey) => {
            const label = `${apiKey.owner ? `${apiKey.owner} - ` : ''}${maskApiKey(apiKey.key)}${apiKey.type ? ` (${apiKey.type})` : ''}`;
            return (
              <ListBox.Item key={apiKey.key} id={apiKey.key} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  </div>
);
