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
// Quota-exhaustion helpers for AiKey.quotaResetAt / quotaExhaustedAt.
// Mistral (currently the only provider this applies to) resets free-tier
// monthly quotas on the 1st of the calendar month at 00:00 UTC.

import type { AiKey } from '../types/ai-config';

/** ISO 8601 timestamp of the 1st of next UTC calendar month at 00:00Z. */
export function computeNextMistralReset(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString();
}

/** True if this key is known to be quota-exhausted right now (resetAt in the future). */
export function isQuotaExhausted(key: Pick<AiKey, 'quotaResetAt'>, now: Date = new Date()): boolean {
  return !!key.quotaResetAt && now.getTime() < Date.parse(key.quotaResetAt);
}

/**
 * Start of the quota period a newly-detected exhaustion belongs to: the
 * key's previous `quotaResetAt` (the boundary of the cycle now ending), or
 * the start of the current UTC month if the key had never been flagged
 * before. Used to sum usage-until-exhaustion for `quota_observations`.
 */
export function currentQuotaPeriodStart(previousQuotaResetAt: string | undefined, now: Date = new Date()): string {
  if (previousQuotaResetAt) return previousQuotaResetAt;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}
