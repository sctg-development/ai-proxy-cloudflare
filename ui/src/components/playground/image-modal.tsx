// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React, { useEffect } from 'react';
import { Button } from '@heroui/react';
import { Download, X } from 'lucide-react';

/** Props for {@link ImageModal}. */
export interface ImageModalProps {
  /** Data-URL or blob URL of the image to display. */
  imageUrl: string | null;
  /** Suggested filename when downloading the image. */
  filename?: string;
  /** Closes the modal (e.g. via the backdrop or ESC key). */
  onClose: () => void;
}

/**
 * Full-screen image preview modal.
 *
 * Renders an `<img>` inside a centered dialog overlay. Supports closing via
 * backdrop click or the Escape key (registered on `imageUrl` change). A
 * download button triggers a client-side save of the image.
 */
export const ImageModal: React.FC<ImageModalProps> = ({
  imageUrl,
  filename = 'image.png',
  onClose,
}) => {
  /** Registers an Escape-key listener to close the modal while an image is displayed. */
  useEffect(() => {
    if (!imageUrl) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  /** Triggers a client-side download of the displayed image using the resolved filename. */
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-6xl rounded-lg bg-background p-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onPress={handleDownload}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Download
          </Button>
          <Button size="sm" variant="ghost" onPress={onClose} aria-label="Close image preview">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <img
          src={imageUrl}
          alt={filename}
          className="max-h-[80vh] max-w-[90vw] rounded-md object-contain"
        />
      </div>
    </div>
  );
};