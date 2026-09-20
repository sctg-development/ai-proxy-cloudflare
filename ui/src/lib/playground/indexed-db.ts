// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development

import { openDB } from 'idb';
import type { PlaygroundConversation, PlaygroundMessage, PlaygroundPart } from '../../types/playground-types';
import {
  PLAYGROUND_CONVERSATION_STORE,
  PLAYGROUND_DATABASE_NAME,
} from './constants';

/** Opens or creates the IndexedDB database used by the playground. */
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

/**
 * Removes `thumbnailUrl` from an image or video part before persistence.
 * Object URLs are session-only and cannot be restored after page reload.
 *
 * @param part - The playground part to sanitize.
 * @returns A copy of the part with `thumbnailUrl` removed (if applicable).
 */
const sanitizePart = (part: PlaygroundPart): PlaygroundPart => {
  if (part.type === 'image' || part.type === 'video') {
    const { thumbnailUrl: _, ...rest } = part as typeof part & { thumbnailUrl?: string };
    return rest as PlaygroundPart;
  }
  return part;
};

/**
 * Sanitizes all parts within a message before persistence.
 *
 * @param msg - The message to sanitize.
 * @returns A new message object with sanitized parts.
 */
const sanitizeMessage = (msg: PlaygroundMessage): PlaygroundMessage => ({
  ...msg,
  parts: msg.parts.map(sanitizePart),
});

// ---------------------------------------------------------------------------
// Public CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Loads a single conversation from IndexedDB by its ID.
 *
 * @param conversationId - The UUID of the conversation to retrieve.
 * @returns The stored conversation, or `undefined` if not found.
 */
export const getStoredConversation = async (
  conversationId: string,
): Promise<PlaygroundConversation | undefined> => {
  const db = await getPlaygroundDb();
  return db.get(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

/**
 * Retrieves all stored conversations from IndexedDB (unsorted).
 *
 * @returns An array of all stored conversations.
 */
export const getAllStoredConversations = async (): Promise<PlaygroundConversation[]> => {
  const db = await getPlaygroundDb();
  return db.getAll(PLAYGROUND_CONVERSATION_STORE);
};

/**
 * Saves or updates a conversation in IndexedDB.
 * Sanitizes all parts by stripping session-only `thumbnailUrl` values before persistence.
 *
 * @param conversation - The conversation to store.
 */
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

/**
 * Deletes a conversation from IndexedDB by its ID.
 *
 * @param conversationId - The UUID of the conversation to delete.
 */
export const deleteStoredConversation = async (
  conversationId: string,
): Promise<void> => {
  const db = await getPlaygroundDb();
  await db.delete(PLAYGROUND_CONVERSATION_STORE, conversationId);
};

// ---------------------------------------------------------------------------
// Title helper — derived from the first user message text part
// ---------------------------------------------------------------------------

/**
 * Derives a conversation title from the first user message's text part.
 * Truncates to 60 characters with an ellipsis if too long.
 *
 * @param messages - The conversation messages.
 * @returns The derived title, or `"New conversation"` if no user message is found.
 */
export const getConversationTitle = (messages: PlaygroundMessage[]): string => {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const text = firstUser.parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') return 'New conversation';
  const raw = text.text.trim();
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw || 'New conversation';
};
