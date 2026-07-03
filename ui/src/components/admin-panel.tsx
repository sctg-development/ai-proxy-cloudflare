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
/**
 * @file Administration panel: group management (superadmin) and per-group
 * user management (group admin or superadmin).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, Form, Input, Label, TextField } from '@heroui/react';
import { Copy, Plus, RefreshCw, Shield, Trash2, UserPlus, Users } from 'lucide-react';

import { useAi } from '../hooks/use-ai';
import { ApiService, type GroupMember, type GroupSummary } from '../lib/api';

/** A freshly created/regenerated API key, shown exactly once. */
interface RevealedKey {
  username: string;
  key: string;
}

export const AdminPanel: React.FC = () => {
  const { userContext } = useAi();
  const isSuperadmin = userContext?.role === 'superadmin';

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(userContext?.groupId ?? null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const reloadGroups = useCallback(async () => {
    try {
      const list = await ApiService.listGroups();
      setGroups(list);
      // Preselect: own group for admins, first group for superadmins
      setSelectedGroupId((current) => {
        if (current && list.some((g) => g.id === current)) return current;
        return userContext?.groupId ?? list[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    }
  }, [userContext?.groupId]);

  const reloadMembers = useCallback(async (groupId: string) => {
    try {
      setMembers(await ApiService.listGroupUsers(groupId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
  }, [reloadGroups]);

  useEffect(() => {
    if (selectedGroupId) {
      void reloadMembers(selectedGroupId);
    } else {
      setMembers([]);
    }
  }, [selectedGroupId, reloadMembers]);

  /** Wraps an admin action with busy/error handling. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateGroup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    void run(async () => {
      await ApiService.createGroup(name);
      setNewGroupName('');
      await reloadGroups();
    });
  };

  const handleDeleteGroup = (group: GroupSummary) => {
    if (group.memberCount > 0) {
      if (!confirm(`Group "${group.name}" still has ${group.memberCount} member(s). Delete the group AND its members?`)) {
        return;
      }
    } else if (!confirm(`Delete group "${group.name}" and its vault?`)) {
      return;
    }
    void run(async () => {
      await ApiService.deleteGroup(group.id, group.memberCount > 0);
      if (selectedGroupId === group.id) setSelectedGroupId(null);
      await reloadGroups();
    });
  };

  const handleCreateUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const username = newUsername.trim();
    if (!username || !selectedGroupId) return;
    void run(async () => {
      const created = await ApiService.createGroupUser(selectedGroupId, username, newUserRole);
      setRevealedKey({ username: created.username, key: created.key });
      setNewUsername('');
      setNewUserRole('user');
      await reloadMembers(selectedGroupId);
      await reloadGroups();
    });
  };

  const handleToggleRole = (member: GroupMember) => {
    if (!selectedGroupId) return;
    const nextRole = member.role === 'admin' ? 'user' : 'admin';
    void run(async () => {
      await ApiService.updateGroupUser(selectedGroupId, member.username, { role: nextRole });
      await reloadMembers(selectedGroupId);
    });
  };

  const handleRegenerateKey = (member: GroupMember) => {
    if (!selectedGroupId) return;
    if (!confirm(`Regenerate the API key of "${member.username}"? The current key stops working immediately.`)) return;
    void run(async () => {
      const updated = await ApiService.updateGroupUser(selectedGroupId, member.username, { regenerateKey: true });
      if (updated.key) setRevealedKey({ username: member.username, key: updated.key });
      await reloadMembers(selectedGroupId);
    });
  };

  const handleDeleteUser = (member: GroupMember) => {
    if (!selectedGroupId) return;
    if (!confirm(`Remove "${member.username}" from the group?`)) return;
    void run(async () => {
      await ApiService.deleteGroupUser(selectedGroupId, member.username);
      await reloadMembers(selectedGroupId);
      await reloadGroups();
    });
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  return (
    <div className="space-y-6">
      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* One-time reveal of a freshly created/regenerated API key */}
      {revealedKey && (
        <Alert status="success">
          <Alert.Content>
            <Alert.Description>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  API key for <strong>{revealedKey.username}</strong> (copy it now, it will not be shown again):
                </span>
                <code className="rounded bg-black/10 px-2 py-1 font-mono text-sm">{revealedKey.key}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    void navigator.clipboard.writeText(revealedKey.key);
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setRevealedKey(null)}>
                  Dismiss
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* ── Groups (superadmin only) ─────────────────────────────── */}
      {isSuperadmin && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5" />
              Groups
            </h2>
            <Form onSubmit={handleCreateGroup} className="flex items-end gap-2">
              <TextField
                value={newGroupName}
                onChange={setNewGroupName}
                name="groupName"
                isRequired
              >
                <Label className="sr-only">New group name</Label>
                <Input placeholder="New group name" className="w-48" />
              </TextField>
              <Button size="sm" type="submit" isPending={busy}>
                <Plus className="mr-2 h-4 w-4" />
                Add Group
              </Button>
            </Form>
          </div>

          <div className="grid gap-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                  selectedGroupId === group.id ? 'border-primary bg-primary/5' : 'border-default-200 hover:bg-default-50'
                }`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{group.name}</span>
                  <code className="text-xs text-default-500">{group.id}</code>
                  {group.legacy && <Chip size="sm">legacy</Chip>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-sm text-default-500">
                    <Users className="h-4 w-4" />
                    {group.memberCount}
                  </span>
                  {!group.legacy && (
                    <Button
                      size="sm"
                      variant="danger-soft"
                      onPress={() => handleDeleteGroup(group)}
                      isPending={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-default-500">No groups yet. Create the first one above.</p>
            )}
          </div>
        </section>
      )}

      {/* ── Members of the selected group ────────────────────────── */}
      {selectedGroup && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5" />
              Members of {selectedGroup.name}
            </h2>
            <Form onSubmit={handleCreateUser} className="flex items-end gap-2">
              <TextField value={newUsername} onChange={setNewUsername} name="username" isRequired>
                <Label className="sr-only">Username</Label>
                <Input placeholder="Username" className="w-40" />
              </TextField>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'user')}
                className="h-9 rounded-md border border-default-200 bg-transparent px-2 text-sm"
                aria-label="Role"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <Button size="sm" type="submit" isPending={busy}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </Form>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <div
                key={member.username}
                className="flex items-center justify-between rounded-lg border border-default-200 p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{member.username}</span>
                  <Chip size="sm" color={member.role === 'user' ? 'default' : 'accent'}>
                    {member.role}
                  </Chip>
                  {member.keyHint && (
                    <code className="text-xs text-default-500">{member.keyHint}</code>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {member.role !== 'superadmin' && (
                    <Button size="sm" variant="ghost" onPress={() => handleToggleRole(member)} isPending={busy}>
                      {member.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onPress={() => handleRegenerateKey(member)} isPending={busy}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    New key
                  </Button>
                  {member.username !== userContext?.username && (
                    <Button size="sm" variant="danger-soft" onPress={() => handleDeleteUser(member)} isPending={busy}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-sm text-default-500">No members in this group yet.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
