// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { Volume2 } from 'lucide-react';
import type { PlaygroundTtsProvider } from '../../types/playground-types';
import { speakWithWebSpeech } from '../../lib/playground/tts';

export interface TextToSpeechButtonProps {
  text: string;
  ttsProvider?: PlaygroundTtsProvider;
  onError?: (message: string) => void;
}

export const TextToSpeechButton: React.FC<TextToSpeechButtonProps> = ({
  text,
  ttsProvider,
  onError,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (audioUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    },
    [audioUrl],
  );

  const handlePress = async () => {
    if (!text.trim()) return;

    setIsGenerating(true);

    try {
      if (ttsProvider) {
        const result = await ttsProvider(text);

        if (result.audioUrl) {
          setAudioUrl((current) => {
            if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
            return result.audioUrl ?? null;
          });
          return;
        }

        if (result.audioBlob) {
          const audioBlob = result.audioBlob;
          setAudioUrl((current) => {
            if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
            return URL.createObjectURL(audioBlob);
          });
          return;
        }
      }

      await speakWithWebSpeech(text);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Text-to-speech failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" isPending={isGenerating} onPress={() => void handlePress()}>
        <Volume2 className="mr-2 h-3.5 w-3.5" />
        Play audio
      </Button>

      {audioUrl && (
        <audio controls src={audioUrl}>
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
};