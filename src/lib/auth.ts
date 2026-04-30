// User authentication and key validation

interface UserKey {
  key: string;
  owner?: string;
  type?: 'expired' | 'free' | 'paid' | 'premium' | 'unlimited';
}

interface UserRecord {
  [username: string]: UserKey;
}

/**
 * Load user keys from KV or fallback to embedded data.
 */
export async function loadUserKeys(kv: KVNamespace): Promise<UserRecord> {
  try {
    const stored = await kv.get('users', 'json');
    if (stored) return stored as UserRecord;
  } catch (err) {
    console.error('Failed to load users from KV:', err);
  }
  // Fallback: return empty record
  return {};
}

/**
 * Validate user API key against stored records.
 * Returns the username if valid, null otherwise.
 */
export async function validateUserKey(
  kv: KVNamespace,
  bearerToken: string,
): Promise<string | null> {
  const users = await loadUserKeys(kv);

  for (const [username, record] of Object.entries(users)) {
    if (record.key === bearerToken) {
      return username;
    }
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header.
 * Returns the token value or null if missing/invalid.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
