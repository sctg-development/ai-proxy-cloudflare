// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import React from 'react';
import { Button } from '@heroui/react';
import { MessageSquare, PanelRight, Plus, Trash2 } from 'lucide-react';
import type { PlaygroundConversation } from '../../types/playground-types';

export interface ConversationHistorySidebarProps {
  conversations: PlaygroundConversation[];
  activeConversationId: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

const formatTime = (ts: number): string => {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString();
};

export const ConversationHistorySidebar: React.FC<ConversationHistorySidebarProps> = ({
  conversations,
  activeConversationId,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  onNew,
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-60 shrink-0 rounded-md border bg-background flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-semibold">History</span>
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" onPress={onNew} aria-label="New conversation">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onPress={onToggle} aria-label="Hide history">
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No saved conversations yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={[
                    'group flex items-start gap-2 rounded-sm px-2 py-1.5 text-xs cursor-pointer transition-colors select-none',
                    conv.id === activeConversationId
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'hover:bg-muted/60 text-foreground',
                  ].join(' ')}
                  onClick={() => onSelect(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect(conv.id);
                  }}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate leading-snug">{conv.title}</p>
                    <p className="text-muted-foreground mt-0.5">{formatTime(conv.updatedAt)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete "${conv.title}"`}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
