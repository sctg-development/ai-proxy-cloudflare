// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// /v1/groups — group and per-group user management.
// superadmin: all groups; admin: users of their own group.

import { Hono } from 'hono';

import { extractBearerToken, getUserContext, loadUserKeys, type UserContext } from '../lib/auth';
import {
  BYOK_KV_KEY,
  createGroupVaultTemplate,
  groupVaultKvKey,
  isValidGroupId,
  loadGroups,
  saveGroups,
  slugifyGroupId,
} from '../lib/groups';
import { invalidateVaultCache, saveGroupConfig } from '../lib/vaults';
import type { AiConfig, GroupRecord, UserRecord, UserRole } from '../types/ai-config';

type HonoEnv = { Bindings: Env; Variables: { userContext: UserContext } };

const groups = new Hono<HonoEnv>();

/** Generate a personal API key for a new user. */
function generateUserKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `kp_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function maskKey(key: string | undefined): string | null {
  return key ? `***${key.slice(-4)}` : null;
}

/**
 * Authentication middleware: resolves the caller context and requires
 * at least an admin role. Fine-grained scope checks happen per route.
 */
groups.use('*', async (c, next) => {
  const token = extractBearerToken(c.req.header('Authorization') || null);
  const ctx = await getUserContext(c.env.KV_AI_PROXY, token, c.env.AI_JSON_CRYPTOKEN);
  if (!ctx) {
    return c.json({ error: 'Unauthorized' }, { status: 401 });
  }
  c.set('userContext', ctx);
  await next();
});

/** Scope check: superadmin, or admin of the group in the URL. */
function canManageGroup(ctx: UserContext, groupId: string): boolean {
  if (ctx.role === 'superadmin') return true;
  return ctx.role === 'admin' && ctx.groupId === groupId;
}

/**
 * GET /v1/groups
 *
 * superadmin: every group (with member counts).
 * admin/user: only their own group.
 */
groups.get('/', async (c) => {
  const ctx = c.get('userContext');
  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  const users = await loadUserKeys(c.env.KV_AI_PROXY);

  const memberCounts: Record<string, number> = {};
  for (const record of Object.values(users)) {
    if (record.groupId) {
      memberCounts[record.groupId] = (memberCounts[record.groupId] ?? 0) + 1;
    }
  }

  const visible = Object.entries(allGroups)
    .filter(([groupId]) => ctx.role === 'superadmin' || ctx.groupId === groupId)
    .map(([groupId, group]) => ({
      id: groupId,
      name: group.name,
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      legacy: group.legacy ?? false,
      memberCount: memberCounts[groupId] ?? 0,
    }));

  return c.json({ object: 'list', data: visible });
});

/**
 * POST /v1/groups
 *
 * Create a group (superadmin only). Body: { id?, name }.
 * The group vault is seeded from the BYOK template (vault:byok) with all
 * key lists emptied, then encrypted with the group-derived secret.
 */
groups.post('/', async (c) => {
  const ctx = c.get('userContext');
  if (ctx.role !== 'superadmin') {
    return c.json({ error: 'superadmin role required' }, { status: 403 });
  }

  let body: { id?: string; name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) {
    return c.json({ error: "'name' is required" }, { status: 400 });
  }

  const groupId = body.id?.trim() || slugifyGroupId(name);
  if (!isValidGroupId(groupId)) {
    return c.json(
      { error: `Invalid group id '${groupId}': lowercase letters, digits, '-' and '_' only` },
      { status: 400 },
    );
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' already exists` }, { status: 409 });
  }

  const byokTemplate = (await c.env.KV_AI_PROXY.get(BYOK_KV_KEY, 'json')) as AiConfig | null;
  const vault = createGroupVaultTemplate(byokTemplate);

  const group: GroupRecord = {
    name,
    createdAt: Date.now(),
    createdBy: ctx.username,
  };

  try {
    await saveGroupConfig(c.env, groupId, group, vault);
    allGroups[groupId] = group;
    await saveGroups(c.env.KV_AI_PROXY, allGroups);
  } catch (err) {
    console.error('Failed to create group:', err);
    return c.json(
      { error: 'Failed to create group', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  return c.json({
    ok: true,
    id: groupId,
    name,
    seededFromByok: !!byokTemplate,
  });
});

/**
 * DELETE /v1/groups/:groupId
 *
 * Delete a group and its vault (superadmin only).
 * Refuses when members remain unless ?force=true (which also deletes them).
 * The legacy group cannot be deleted.
 */
groups.delete('/:groupId', async (c) => {
  const ctx = c.get('userContext');
  if (ctx.role !== 'superadmin') {
    return c.json({ error: 'superadmin role required' }, { status: 403 });
  }

  const groupId = c.req.param('groupId');
  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  const group = allGroups[groupId];
  if (!group) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }
  if (group.legacy) {
    return c.json({ error: 'The legacy group cannot be deleted' }, { status: 400 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const members = Object.entries(users).filter(([, record]) => record.groupId === groupId);
  const force = c.req.query('force') === 'true';

  if (members.length > 0 && !force) {
    return c.json(
      {
        error: `Group '${groupId}' still has ${members.length} member(s). Use ?force=true to delete them too.`,
        members: members.map(([username]) => username),
      },
      { status: 409 },
    );
  }

  for (const [username] of members) {
    delete users[username];
  }
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  await c.env.KV_AI_PROXY.delete(groupVaultKvKey(groupId, group));
  invalidateVaultCache(`group:${groupId}`);

  delete allGroups[groupId];
  await saveGroups(c.env.KV_AI_PROXY, allGroups);

  return c.json({ ok: true, deletedUsers: members.map(([username]) => username) });
});

/**
 * GET /v1/groups/:groupId/users
 *
 * List the members of a group (superadmin, or admin of that group).
 */
groups.get('/:groupId/users', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (!allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const members = Object.entries(users)
    .filter(([, record]) => record.groupId === groupId)
    .map(([username, record]) => ({
      username,
      owner: record.owner || username,
      role: record.role || 'user',
      keyHint: maskKey(record.key),
    }));

  return c.json({ object: 'list', data: members });
});

/**
 * POST /v1/groups/:groupId/users
 *
 * Create a user inside a group (superadmin, or admin of that group).
 * Body: { username, key?, role?, owner? }. When key is omitted a personal
 * API key is generated and returned once in the response.
 */
groups.post('/:groupId/users', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allGroups = await loadGroups(c.env.KV_AI_PROXY);
  if (!allGroups[groupId]) {
    return c.json({ error: `Group '${groupId}' not found` }, { status: 404 });
  }

  let body: { username?: string; key?: string; role?: UserRole; owner?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const username = body.username?.trim();
  if (!username) {
    return c.json({ error: "'username' is required" }, { status: 400 });
  }

  const role: UserRole = body.role ?? 'user';
  if (!['superadmin', 'admin', 'user'].includes(role)) {
    return c.json({ error: `Invalid role '${role}'` }, { status: 400 });
  }
  if (role === 'superadmin' && ctx.role !== 'superadmin') {
    return c.json({ error: 'Only a superadmin can grant the superadmin role' }, { status: 403 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  if (users[username]) {
    return c.json({ error: `User '${username}' already exists` }, { status: 409 });
  }

  const key = body.key?.trim() || generateUserKey();
  if (Object.values(users).some((record) => record.key === key)) {
    return c.json({ error: 'This key is already assigned to another user' }, { status: 409 });
  }

  const record: UserRecord = {
    key,
    owner: body.owner || username,
    role,
    groupId,
  };
  users[username] = record;
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  // The key is returned once; only the hint is exposed afterwards.
  return c.json({ ok: true, username, groupId, role, key });
});

/**
 * PUT /v1/groups/:groupId/users/:username
 *
 * Update a member's role, key or owner (superadmin, or admin of that group).
 */
groups.put('/:groupId/users/:username', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  const username = c.req.param('username');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const record = users[username];
  if (!record || record.groupId !== groupId) {
    return c.json({ error: `User '${username}' not found in group '${groupId}'` }, { status: 404 });
  }

  let body: { key?: string; role?: UserRole; owner?: string; regenerateKey?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (body.role !== undefined) {
    if (!['superadmin', 'admin', 'user'].includes(body.role)) {
      return c.json({ error: `Invalid role '${body.role}'` }, { status: 400 });
    }
    if ((body.role === 'superadmin' || record.role === 'superadmin') && ctx.role !== 'superadmin') {
      return c.json({ error: 'Only a superadmin can change superadmin roles' }, { status: 403 });
    }
    record.role = body.role;
  }

  let newKey: string | undefined;
  if (body.regenerateKey) {
    newKey = generateUserKey();
  } else if (body.key !== undefined) {
    newKey = body.key.trim();
    if (!newKey) {
      return c.json({ error: 'key cannot be empty' }, { status: 400 });
    }
  }
  if (newKey) {
    const conflict = Object.entries(users).some(
      ([otherName, other]) => otherName !== username && other.key === newKey,
    );
    if (conflict) {
      return c.json({ error: 'This key is already assigned to another user' }, { status: 409 });
    }
    record.key = newKey;
  }

  if (body.owner !== undefined) {
    record.owner = body.owner;
  }

  users[username] = record;
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  return c.json({
    ok: true,
    username,
    groupId,
    role: record.role || 'user',
    ...(newKey ? { key: newKey } : {}),
  });
});

/**
 * DELETE /v1/groups/:groupId/users/:username
 *
 * Remove a member from a group (superadmin, or admin of that group).
 * Callers cannot delete themselves.
 */
groups.delete('/:groupId/users/:username', async (c) => {
  const ctx = c.get('userContext');
  const groupId = c.req.param('groupId');
  const username = c.req.param('username');
  if (!canManageGroup(ctx, groupId)) {
    return c.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.username === username) {
    return c.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const users = await loadUserKeys(c.env.KV_AI_PROXY);
  const record = users[username];
  if (!record || record.groupId !== groupId) {
    return c.json({ error: `User '${username}' not found in group '${groupId}'` }, { status: 404 });
  }
  if (record.role === 'superadmin' && ctx.role !== 'superadmin') {
    return c.json({ error: 'Only a superadmin can delete a superadmin' }, { status: 403 });
  }

  delete users[username];
  await c.env.KV_AI_PROXY.put('users', JSON.stringify(users));

  return c.json({ ok: true, deleted: username });
});

export default groups;
