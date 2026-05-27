// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useRef } from 'react';
import { Button, TextArea } from '@heroui/react';
import { FilePlus, Send, X } from 'lucide-react';
import type { AiModalityInput } from '../../types/ai-config';
import type { PlaygroundPart, PlaygroundTranscriber } from '../../types/playground-types';
import {
  createPartFromFile,
  getFileKind,
  isInlineable,
} from '../../lib/playground/multimodal-files';
import { FilePreviewList } from './file-preview';

export interface MultimodalInputProps {
  text: string;
  parts: PlaygroundPart[];
  isSending: boolean;
  /** Supported input modalities from the active model — controls which files are accepted. */
  inputModalities?: AiModalityInput[];
  onTextChange: (text: string) => void;
  onPartsChange: (parts: PlaygroundPart[]) => void;
  onSend: () => void;
  onCancel?: () => void;
  onError?: (message: string) => void;
  transcriber?: PlaygroundTranscriber;
  isDisabled?: boolean;
}

const MODALITY_ACCEPT_MAP: Record<AiModalityInput, string> = {
  text: '.txt,.md,.csv,.json,.xml,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.rb,.java,.c,.cpp,.h,.cs,.php,.sh',
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

/** Text input with drag-and-drop file attachment support and a send/cancel button. */
export const MultimodalInput: React.FC<MultimodalInputProps> = ({
  text,
  parts,
  isSending,
  inputModalities = ['text'],
  onTextChange,
  onPartsChange,
  onSend,
  onCancel,
  onError,
  transcriber,
  isDisabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const acceptAttr = inputModalities
    .map((m) => MODALITY_ACCEPT_MAP[m])
    .filter(Boolean)
    .join(',');

  const addFiles = async (files: FileList | File[]) => {
    const nextParts: PlaygroundPart[] = [];

    for (const file of Array.from(files)) {
      if (!isInlineable(file)) {
        onError?.(`${file.name} exceeds the 8 MB limit.`);
        continue;
      }

      try {
        let part = await createPartFromFile(file);

        if (part.type === 'audio' && transcriber && getFileKind(file) === 'audio') {
          try {
            const transcription = await transcriber(file, file);
            if (transcription.trim()) {
              part = {
                ...part,
                transcription: transcription.trim(),
              };
            }
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : `Could not transcribe ${file.name}.`;
            onError?.(message);
          }
        }

        nextParts.push(part);
      } catch {
        onError?.(`Could not read ${file.name}.`);
      }
    }

    if (nextParts.length > 0) onPartsChange([...parts, ...nextParts]);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length === 0) return;
    await addFiles(event.dataTransfer.files);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div
      className="rounded-md border bg-muted/20 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e)}
      aria-label="Message input area — drop files to attach"
    >
      <TextArea
        className="w-full"
        rows={4}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask something… (Ctrl+Enter to send)"
        disabled={isSending || isDisabled}
      />

      <FilePreviewList
        parts={parts}
        onRemove={(index) => onPartsChange(parts.filter((_, i) => i !== index))}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            onChange={(e) => void addFiles(e.target.files ?? [])}
          />
          {inputModalities.length > 1 || inputModalities.includes('image') || inputModalities.includes('audio') ? (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => fileInputRef.current?.click()}
              isDisabled={isSending || isDisabled}
            >
              <FilePlus className="mr-2 h-3.5 w-3.5" />
              Attach files
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => fileInputRef.current?.click()}
              isDisabled={isSending || isDisabled}
            >
              <FilePlus className="mr-2 h-3.5 w-3.5" />
              Add files
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isSending && onCancel && (
            <Button size="sm" variant="ghost" onPress={onCancel}>
              <X className="mr-2 h-3.5 w-3.5" />
              Cancel
            </Button>
          )}
          <Button onPress={onSend} isPending={isSending} isDisabled={isDisabled}>
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};
