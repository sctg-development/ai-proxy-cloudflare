// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { PlaygroundPart } from '../../types/playground-types';
import { formatBytes, revokePartObjectUrls } from '../../lib/playground/multimodal-files';

/** Props for {@link FilePreviewItem}. */
interface FilePreviewItemProps {
  /** The attachment part to render. */
  part: PlaygroundPart;
  /** Array index of the part, used as the key and passed to `onRemove`. */
  index: number;
  /** Removes the part at `index` from the message draft. */
  onRemove: (index: number) => void;
}

/** Renders a single attachment chip with a type-specific preview icon. */
const FilePreviewItem: React.FC<FilePreviewItemProps> = ({ part, index, onRemove }) => {
  /** Cleanup effect: revokes Object URLs when the part is removed from the DOM. */
  useEffect(
    () => () => { revokePartObjectUrls(part); },
    [part],
  );

  const name = 'name' in part ? (part.name ?? part.type) : part.type;
  const size = 'size' in part ? part.size : undefined;

  const preview = (() => {
    if (part.type === 'image' && part.thumbnailUrl) {
      return (
        <img
          src={part.thumbnailUrl}
          alt={name}
          className="h-8 w-8 rounded object-cover"
        />
      );
    }
    if (part.type === 'audio') {
      return <span className="text-xs text-muted-foreground">🎵</span>;
    }
    if (part.type === 'video' && part.thumbnailUrl) {
      return (
        <video
          src={part.thumbnailUrl}
          className="h-8 w-8 rounded object-cover"
          aria-label={name}
        />
      );
    }
    return null;
  })();

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
      {preview}
      <span className="max-w-[120px] truncate" title={name}>{name}</span>
      {size !== undefined && <span>({formatBytes(size)})</span>}
      <button
        type="button"
        className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
};

/** Props for {@link FilePreviewList}. */
export interface FilePreviewListProps {
  /** Attachment parts to display as preview chips. */
  parts: PlaygroundPart[];
  /** Removes the part at the given index. */
  onRemove: (index: number) => void;
}

/** Renders a row of file attachment chips with remove buttons. */
export const FilePreviewList: React.FC<FilePreviewListProps> = ({ parts, onRemove }) => {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {parts.map((part, i) => (
        <FilePreviewItem
          key={`${part.type}-${i}`}
          part={part}
          index={i}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
};
