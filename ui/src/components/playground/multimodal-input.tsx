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

/** Props for {@link MultimodalInput}. */
export interface MultimodalInputProps {
  /** Current text content of the textarea. */
  text: string;
  /** Attached file parts to display as preview chips. */
  parts: PlaygroundPart[];
  /** True while a chat request is streaming — disables inputs and shows the cancel button. */
  isSending: boolean;
  /** Supported input modalities from the active model — controls which files are accepted. */
  inputModalities?: AiModalityInput[];
  /** Called when the user types or pastes text into the textarea. */
  onTextChange: (text: string) => void;
  /** Called when files are attached or removed via the file preview list. */
  onPartsChange: (parts: PlaygroundPart[]) => void;
  /** Called when the user presses Send (or Ctrl+Enter). */
  onSend: () => void;
  /** Called when the user presses Cancel during a streaming response. */
  onCancel?: () => void;
  /** Called with an error message when file processing fails (e.g. oversized, unreadable). */
  onError?: (message: string) => void;
  /** Optional transcription provider for auto-converting audio uploads to text. */
  transcriber?: PlaygroundTranscriber;
  /** Disables all inputs when no provider or model is selected. */
  isDisabled?: boolean;
}

/** Maps each supported input modality to an HTML `accept` attribute value for the file input. */
const MODALITY_ACCEPT_MAP: Record<AiModalityInput, string> = {
  text: '.txt,.md,.csv,.json,.xml,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.rb,.java,.c,.cpp,.h,.cs,.php,.sh',
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

/**
 * Text input with drag-and-drop file attachment support and a send/cancel button.
 *
 * Accepts files based on the active model's input modalities, auto-transcribes
 * audio uploads (when a `transcriber` is provided), and renders file preview
 * chips below the textarea. Supports Ctrl+Enter to send.
 */
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

  /** Processes a FileList or File[]: filters oversized files, creates parts, and transcribes audio. */
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

  /** Handles file drop events on the input container area. */
  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length === 0) return;
    await addFiles(event.dataTransfer.files);
  };

  /** Sends the prompt when Ctrl+Enter (or Cmd+Enter on Mac) is pressed. */
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
