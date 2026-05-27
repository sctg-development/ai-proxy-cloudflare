// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { PlaygroundPart } from '../../types/playground-types';
import { formatBytes, revokePartObjectUrls } from '../../lib/playground/multimodal-files';

interface FilePreviewItemProps {
  part: PlaygroundPart;
  index: number;
  onRemove: (index: number) => void;
}

const FilePreviewItem: React.FC<FilePreviewItemProps> = ({ part, index, onRemove }) => {
  // Revoke Object URLs when the part is removed from the DOM.
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

export interface FilePreviewListProps {
  parts: PlaygroundPart[];
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
