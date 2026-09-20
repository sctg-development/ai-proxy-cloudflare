// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import type { PlaygroundMessage } from '../../types/playground-types';
import { MessageBubble } from './message-bubble';

/** Props for {@link MessageList}. */
export interface MessageListProps {
  /** All messages in the conversation, oldest first. */
  messages: PlaygroundMessage[];
  /** Index of the message to resume from, or null if not resuming. */
  resumeFromIndex: number | null;
  /** Sets which message to resume the conversation from (pass -1 to cancel). */
  onResumeFromIndex: (index: number) => void;
  /** Retries the last assistant error message without key rotation. */
  onRetry?: () => void;
  /** Retries the last assistant error message with key rotation. */
  onRotateAndRetry?: () => void;
}

/** Returns true when the last message is an assistant error (text starting with "Error:"). */
const isAssistantError = (msg: PlaygroundMessage): boolean =>
  msg.role === 'assistant' &&
  msg.parts.some((p) => p.type === 'text' && p.text.startsWith('Error:'));

/** Renders the full conversation history or an empty-state prompt. */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  resumeFromIndex,
  onResumeFromIndex,
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
          onRetry={index === lastIndex && lastIsError ? onRetry : undefined}
          onRotateAndRetry={index === lastIndex && lastIsError ? onRotateAndRetry : undefined}
        />
      ))}
    </div>
  );
};
