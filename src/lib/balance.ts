// Balance integration with Fufuni merchant backend.
// All functions are no-ops when FUFUNI_MERCHANT_URL is unset, ensuring the
// proxy works in standalone mode without any Fufuni dependency.

interface BalanceEnv {
  FUFUNI_MERCHANT_URL?: string;
  AI_BALANCE_SHARED_SECRET?: string;
}

/**
 * Check the remaining AI token balance for the given API key.
 *
 * @returns Token units remaining, or null when the balance feature is not
 *          configured (proxy operates without balance enforcement).
 */
export async function checkBalance(apiKey: string, env: BalanceEnv): Promise<number | null> {
  if (!env.FUFUNI_MERCHANT_URL || !env.AI_BALANCE_SHARED_SECRET) return null;

  try {
    const url = `${env.FUFUNI_MERCHANT_URL}/v1/ai-tokens/proxy/balance/${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.AI_BALANCE_SHARED_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`Balance check failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json<{ balance: number }>();
    return typeof data.balance === 'number' ? data.balance : null;
  } catch (err) {
    console.warn('Balance check error (allowing request):', err);
    return null;
  }
}

/**
 * Deduct token units from the account after a successful AI request.
 * This is fire-and-forget — failures are logged but never thrown.
 *
 * @param apiKey  - The API key that consumed the tokens
 * @param units   - Number of token units to deduct (typically 1 per request)
 * @param env     - Worker environment bindings
 */
export async function deductBalance(apiKey: string, units: number, env: BalanceEnv): Promise<void> {
  if (!env.FUFUNI_MERCHANT_URL || !env.AI_BALANCE_SHARED_SECRET) return;

  try {
    const url = `${env.FUFUNI_MERCHANT_URL}/v1/ai-tokens/proxy/deduct`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_BALANCE_SHARED_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey, units }),
    });

    if (!res.ok) {
      console.warn(`Balance deduction failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('Balance deduction error (non-fatal):', err);
  }
}
