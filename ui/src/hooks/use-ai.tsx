import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AiConfig } from '../types/ai-config';
import { ApiService } from '../lib/api';
import { encryptVault } from '../lib/crypto';

/**
 * Interface for the AI Context.
 */
interface AiContextType {
  config: AiConfig | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
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
    <AiContext.Provider value={{ config, loading, error, isAuthenticated, login, logout, refresh, updateConfig }}>
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
