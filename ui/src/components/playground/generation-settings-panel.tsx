// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Label, NumberField, Slider, TextArea } from '@heroui/react';

export interface GenerationSettingsPanelProps {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  onSystemPromptChange: (value: string) => void;
  onTemperatureChange: (value: number) => void;
  onMaxTokensChange: (value: number) => void;
  onTopPChange: (value: number) => void;
}

/** System-prompt textarea and the three inference parameter controls. */
export const GenerationSettingsPanel: React.FC<GenerationSettingsPanelProps> = ({
  systemPrompt,
  temperature,
  maxTokens,
  topP,
  onSystemPromptChange,
  onTemperatureChange,
  onMaxTokensChange,
  onTopPChange,
}) => (
  <div className="space-y-4">
    <div className="flex flex-col gap-1 text-sm">
      <Label htmlFor="playground-system-prompt">System prompt</Label>
      <TextArea
        id="playground-system-prompt"
        rows={3}
        value={systemPrompt}
        onChange={(e) => onSystemPromptChange(e.target.value)}
        placeholder="You are a helpful AI assistant."
      />
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <Slider
        className="w-full"
        value={temperature}
        minValue={0}
        maxValue={2}
        step={0.01}
        onChange={(value) => onTemperatureChange(Array.isArray(value) ? value[0] : value)}
      >
        <Label>Temperature</Label>
        <Slider.Output>{temperature.toFixed(2)}</Slider.Output>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>

      <NumberField
        minValue={1}
        step={1}
        value={maxTokens}
        onChange={(value) => onMaxTokensChange(Math.max(1, Math.round(value ?? 1)))}
      >
        <Label>Max tokens</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>

      <NumberField
        minValue={0}
        maxValue={1}
        step={0.05}
        value={topP}
        onChange={(value) => onTopPChange(Math.min(1, Math.max(0, value ?? 0)))}
      >
        <Label>Top-p</Label>
        <NumberField.Group>
          <NumberField.DecrementButton />
          <NumberField.Input />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    </div>
  </div>
);
