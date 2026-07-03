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
 * @file Embedded @sctg/cline-chatbot panel — replaces the legacy playground.
 * The chatbot shares the vault session token (sessionStorage 'ai_vault_token')
 * with this dashboard, so an authenticated user lands directly in the chat.
 */

import React from 'react';
import { Chatbot } from '@sctg/cline-chatbot';
import '@sctg/cline-chatbot/style.css';

/** Base URL of the vault/usage Worker (same host for both roles). */
const WORKER_URL = import.meta.env.VAULT_URL as string;

export const ChatbotPanel: React.FC = () => {
  return (
    <div className="h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-default-200">
      <Chatbot vaultUrl={WORKER_URL} usageDbUrl={WORKER_URL} className="h-full" />
    </div>
  );
};
