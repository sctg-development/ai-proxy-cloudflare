// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import { openDB } from 'idb';
import type { PlaygroundConversation, PlaygroundMessage, PlaygroundPart } from '../../types/playground-types';
import {
  PLAYGROUND_CONVERSATION_STORE,
  PLAYGROUND_DATABASE_NAME,
} from './constants';

const getPlaygroundDb = () =>
  openDB(PLAYGROUND_DATABASE_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PLAYGROUND_CONVERSATION_STORE)) {
        db.createObjectStore(PLAYGROUND_CONVERSATION_STORE, { keyPath: 'id' });
      }
    },
  });

// ---------------------------------------------------------------------------
// Storage sanitisation — blob: Object URLs are session-only and must not
// be persisted. Strip thumbnailUrl before writing to IndexedDB.
// ---------------------------------------------------------------------------

const sanitizePart = (part: PlaygroundPart): PlaygroundPart => {
  if (part.type === 'image' || part.type === 'video') {
    const { thumbnailUrl: _thumbnailUrl, ...rest } = part as typeof part & { thumbnailUrl?: string };
    return rest as PlaygroundPart;
  }
  return part;
};

const sanitizeMessage = (msg: PlaygroundMessage): PlaygroundMessage => ({
  ...msg,
  parts: msg.parts.map(sanitizePart),
});

// ---------------------------------------------------------------------------
// Public CRUD helpers
// ---------------------------------------------------------------------------

export const getStoredConversation = async (
  conversationId: string,
): Promise<PlaygroundConversation | undefined> => {
  const db = await getPlaygroundDb();
  return db.get(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

export const getAllStoredConversations = async (): Promise<PlaygroundConversation[]> => {
  const db = await getPlaygroundDb();
  return db.getAll(PLAYGROUND_CONVERSATION_STORE);
};

export const saveStoredConversation = async (
  conversation: PlaygroundConversation,
): Promise<void> => {
  const db = await getPlaygroundDb();
  const sanitized: PlaygroundConversation = {
    ...conversation,
    messages: conversation.messages.map(sanitizeMessage),
  };
  await db.put(PLAYGROUND_CONVERSATION_STORE, sanitized);
};

export const deleteStoredConversation = async (
  conversationId: string,
): Promise<void> => {
  const db = await getPlaygroundDb();
  await db.delete(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

// ---------------------------------------------------------------------------
// Title helper — derived from the first user message text part
// ---------------------------------------------------------------------------

export const getConversationTitle = (messages: PlaygroundMessage[]): string => {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') return 'New conversation';
  const raw = text.text.trim();
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw || 'New conversation';
};
