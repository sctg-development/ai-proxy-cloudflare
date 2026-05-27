// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import type {
  PlaygroundMessage,
  PlaygroundTtsProvider,
} from '../../types/playground-types';
import { MessageBubble } from './message-bubble';

export interface MessageListProps {
  messages: PlaygroundMessage[];
  resumeFromIndex: number | null;
  onResumeFromIndex: (index: number) => void;
  ttsProvider?: PlaygroundTtsProvider;
  onError?: (message: string) => void;
  onRetry?: () => void;
  onRotateAndRetry?: () => void;
}

const isAssistantError = (msg: PlaygroundMessage): boolean =>
  msg.role === 'assistant' &&
  msg.parts.some((p) => p.type === 'text' && p.text.startsWith('Error:'));

/** Renders the full conversation history or an empty-state prompt. */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  resumeFromIndex,
  onResumeFromIndex,
  ttsProvider,
  onError,
  onRetry,
  onRotateAndRetry,
}) => {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Start the conversation by sending your first message.
      </p>
    );
  }

  const lastIndex = messages.length - 1;
  const lastIsError = isAssistantError(messages[lastIndex]);

  return (
    <div className="space-y-2">
      {resumeFromIndex !== null && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Resume is active from message {resumeFromIndex + 1}.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => onResumeFromIndex(-1)}
          >
            Cancel
          </button>
        </div>
      )}
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          index={index}
          onResume={() => onResumeFromIndex(index)}
          ttsProvider={ttsProvider}
          onError={onError}
          onRetry={index === lastIndex && lastIsError ? onRetry : undefined}
          onRotateAndRetry={index === lastIndex && lastIsError ? onRotateAndRetry : undefined}
        />
      ))}
    </div>
  );
};
