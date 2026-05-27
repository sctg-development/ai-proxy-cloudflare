// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaygroundConversation, PlaygroundMessage } from '../types/playground-types';
import {
  deleteStoredConversation,
  getAllStoredConversations,
  getConversationTitle,
  getStoredConversation,
  saveStoredConversation,
} from '../lib/playground/indexed-db';

export interface UsePlaygroundIndexedDbOptions {
  conversationId: string;
  messages: PlaygroundMessage[];
  initialHistory?: PlaygroundMessage[];
  onMessagesLoaded: (messages: PlaygroundMessage[]) => void;
}

export interface PlaygroundIndexedDbState {
  /** All stored conversations, sorted by updatedAt descending. */
  conversations: PlaygroundConversation[];
  deleteConversation: (id: string) => Promise<void>;
}

/**
 * Persists the active conversation to IndexedDB with a 500 ms debounce.
 * Also maintains a sorted list of all conversations for the history sidebar.
 */
export const usePlaygroundIndexedDb = ({
  conversationId,
  messages,
  initialHistory,
  onMessagesLoaded,
}: UsePlaygroundIndexedDbOptions): PlaygroundIndexedDbState => {
  const [conversations, setConversations] = useState<PlaygroundConversation[]>([]);
  // true while the initial load for the current conversationId is in flight
  const loadingRef = useRef(true);

  const refreshConversations = useCallback(async () => {
    try {
      const all = await getAllStoredConversations();
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(all);
    } catch {
      // IndexedDB unavailable (private browsing, storage quota exceeded, …)
    }
  }, []);

  // Load the conversation whenever conversationId changes
  useEffect(() => {
    loadingRef.current = true;
    let isMounted = true;

    const load = async () => {
      try {
        const stored = await getStoredConversation(conversationId);
        if (!isMounted) return;
        if (stored && stored.messages.length > 0) {
          onMessagesLoaded(stored.messages);
          return;
        }
        if (initialHistory && initialHistory.length > 0) {
          onMessagesLoaded(initialHistory);
        }
      } catch {
        // Silently degrade — the playground still works without persistence
      } finally {
        if (isMounted) loadingRef.current = false;
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [conversationId, initialHistory, onMessagesLoaded]);

  // Populate sidebar on mount
  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Debounced save whenever messages change (skip while loading)
  useEffect(() => {
    if (loadingRef.current) return;
    if (messages.length === 0) return;

    const id = conversationId;
    const snapshot = messages;

    const timeout = window.setTimeout(() => {
      const now = Date.now();
      void (async () => {
        try {
          const existing = await getStoredConversation(id);
          await saveStoredConversation({
            id,
            title: getConversationTitle(snapshot),
            messages: snapshot,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          });
          await refreshConversations();
        } catch {
          // Silently degrade
        }
      })();
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [conversationId, messages, refreshConversations]);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await deleteStoredConversation(id);
        await refreshConversations();
      } catch {
        // Silently degrade
      }
    },
    [refreshConversations],
  );

  return { conversations, deleteConversation };
};
