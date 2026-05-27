// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Download, RefreshCcw, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  PlaygroundMessage,
  PlaygroundPart,
  PlaygroundTtsProvider,
} from '../../types/playground-types';
import { renderMarkdown } from '../../lib/utils/markdown-utils';
import { createMarkedRenderer } from '../../lib/utils/markdown-utils';
import { extractGeneratedFiles, getMarkdownFilename } from '../../lib/utils/file-utils';
import { formatBytes } from '../../lib/playground/multimodal-files';
import { CodeBlock } from './code-block';
import { ImageModal } from './image-modal';
import { TextToSpeechButton } from './text-to-speech-button';

interface MessageBubbleProps {
  message: PlaygroundMessage;
  index: number;
  onResume: () => void;
  ttsProvider?: PlaygroundTtsProvider;
  onError?: (message: string) => void;
  /** When provided, a Retry button appears on assistant error messages. */
  onRetry?: () => void;
  /** When provided, a Rotate & retry button appears on assistant error messages. */
  onRotateAndRetry?: () => void;
}

const downloadRemoteImage = async (url: string, name: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = name;
    link.click();
    URL.revokeObjectURL(blobUrl);
  } catch { /* silently ignore if URL has expired */ }
};

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

/** Renders a single chat message with all its parts and action buttons. */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  index,
  onResume,
  ttsProvider,
  onError,
  onRetry,
  onRotateAndRetry,
}) => {
  const marked = useMemo(() => createMarkedRenderer(), []);
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  const assistantText = message.role === 'assistant'
    ? message.parts
        .filter((p): p is Extract<PlaygroundPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n\n')
    : null;

  const generatedFiles = assistantText ? extractGeneratedFiles(assistantText) : [];
  const isError = assistantText?.startsWith('Error:') ?? false;
  const getLanguageFromFilename = (filename: string): string =>
    filename.split('.').pop()?.toLowerCase() ?? 'text';

  return (
    <div
      className={[
        'rounded-md px-3 py-2 text-sm',
        message.role === 'user' ? 'bg-primary/10' : 'bg-background',
      ].join(' ')}
    >
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {message.role === 'user' ? 'user' : 'assistant'}
      </p>

      {message.parts.map((part, partIndex) => {
        if (part.type === 'text') {
          return message.role === 'assistant' ? (
            <div
              key={partIndex}
              className="playground-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text, marked) }}
            />
          ) : (
            <p key={partIndex} className="whitespace-pre-wrap">{part.text}</p>
          );
        }

        if (part.type === 'image') {
          const inlineDataUrl = part.inlineData
            ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
            : null;
          const displaySrc = part.thumbnailUrl ?? inlineDataUrl ?? part.remoteUrl;
          if (!displaySrc) return null;
          return (
            <div key={partIndex} className="mt-2 space-y-1">
              <button
                type="button"
                className="rounded-md"
                onClick={() => setPreviewImage({ url: inlineDataUrl ?? part.remoteUrl ?? displaySrc, name: part.name })}
              >
                <img
                  src={displaySrc}
                  alt={part.name ?? 'Attached image'}
                  className="max-h-64 rounded-md border object-contain"
                />
              </button>
              {part.remoteUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void downloadRemoteImage(part.remoteUrl!, part.name ?? 'generated_image.png')}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  {part.name ?? 'Download image'}
                </Button>
              )}
            </div>
          );
        }

        if (part.type === 'audio') {
          return (
            <div key={partIndex} className="mt-2">
              <audio controls src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}>
                <track kind="captions" />
              </audio>
              {part.transcription && (
                <p className="mt-1 text-xs text-muted-foreground italic">{part.transcription}</p>
              )}
            </div>
          );
        }

        if (part.type === 'video' && part.thumbnailUrl) {
          return (
            <video
              key={partIndex}
              controls
              src={part.thumbnailUrl}
              className="mt-2 max-h-48 rounded-md border"
              aria-label={part.name ?? 'Attached video'}
            >
              <track kind="captions" />
            </video>
          );
        }

        if (part.type === 'file') {
          return (
            <span
              key={partIndex}
              className="mt-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
            >
              {part.name}
              {part.size !== undefined && <span>({formatBytes(part.size)})</span>}
            </span>
          );
        }

        return null;
      })}

      {message.role === 'assistant' && generatedFiles.length > 0 && (
        <div className="mt-3 space-y-3">
          {generatedFiles.map((file) => (
            <CodeBlock
              key={file.name}
              code={file.content}
              language={getLanguageFromFilename(file.name)}
              filename={file.name}
            />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {message.role === 'assistant' && assistantText && !isError && (
          <>
            <TextToSpeechButton text={assistantText} ttsProvider={ttsProvider} onError={onError} />
            <Button
              size="sm"
              variant="ghost"
              onPress={() => downloadTextFile(getMarkdownFilename(assistantText, index), assistantText)}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Markdown
            </Button>
          </>
        )}
        {!isError && generatedFiles.map((file) => (
          <Button
            key={file.name}
            size="sm"
            variant="ghost"
            onPress={() => downloadTextFile(file.name, file.content)}
          >
            <Download className="mr-2 h-3.5 w-3.5" />
            {file.name}
          </Button>
        ))}
        {isError && onRetry && (
          <Button size="sm" variant="ghost" onPress={onRetry}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        )}
        {isError && onRotateAndRetry && (
          <Button size="sm" variant="ghost" onPress={onRotateAndRetry}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" />
            Rotate & retry
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={onResume}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Resume from here
        </Button>
      </div>

      <ImageModal
        imageUrl={previewImage?.url ?? null}
        filename={previewImage?.name}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
};
