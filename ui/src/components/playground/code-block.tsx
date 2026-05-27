// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Button } from '@heroui/react';
import { Download } from 'lucide-react';

export interface CodeBlockProps {
  code: string;
  language: string;
  filename: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  filename,
}) => {
  const downloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {language}
        </span>
        <Button size="sm" variant="ghost" onPress={downloadCode}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {filename}
        </Button>
      </div>
      <pre className="overflow-auto rounded-md bg-background p-3 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
};