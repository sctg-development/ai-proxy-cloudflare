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
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AiConfig } from '../types/ai-config';
import { ApiService } from '../lib/api';
import { encryptVault } from '../lib/crypto';

/**
 * User context returned by the /v1/auth/me endpoint.
 */
interface UserContext {
  username: string;
  vaultId: string;
  role: 'admin' | 'user';
  isLegacy: boolean;
}

/**
 * Interface for the AI Context.
 */
interface AiContextType {
  config: AiConfig | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  userContext: UserContext | null;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateConfig: (newConfig: AiConfig) => Promise<void>;
}

const AiContext = createContext<AiContextType | undefined>(undefined);

/**
 * Provider component for AI configuration state.
 */
export const AiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(!!ApiService.getToken());

  /**
   * Refreshes the configuration from the Worker.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ApiService.fetchConfig();
      setConfig(data);

      // Fetch user context (new)
      try {
        const ctx = await ApiService.fetchUserContext();
        setUserContext(ctx);
      } catch (userContextError) {
        // Legacy mode: assume admin for backwards compatibility
        setUserContext({ username: 'legacy', vaultId: 'legacy', role: 'admin', isLegacy: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      if (err instanceof Error && err.message.includes('authorized')) {
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Logs in with a token.
   */
  const login = async (token: string) => {
    ApiService.setToken(token);
    setIsAuthenticated(true);
    await refresh();
  };

  /**
   * Logs out.
   */
  const logout = () => {
    ApiService.clearToken();
    setIsAuthenticated(false);
    setConfig(null);
  };

  /**
   * Updates the configuration on the Worker.
   * Encrypts the JSON before sending.
   */
  const updateConfig = async (newConfig: AiConfig) => {
    const token = ApiService.getToken();
    if (!token) throw new Error('Not authenticated');

    setLoading(true);
    try {
      const json = JSON.stringify(newConfig);
      const encrypted = await encryptVault(json, token);
      await ApiService.updateVault(encrypted);
      setConfig(newConfig); // Optimistic update or just sync after refresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    }
  }, [isAuthenticated, refresh]);

  return (
    <AiContext.Provider value={{ config, loading, error, isAuthenticated, userContext, login, logout, refresh, updateConfig }}>
      {children}
    </AiContext.Provider>
  );
};

/**
 * Hook to use the AI context.
 */
export const useAi = () => {
  const context = useContext(AiContext);
  if (!context) throw new Error('useAi must be used within an AiProvider');
  return context;
};

