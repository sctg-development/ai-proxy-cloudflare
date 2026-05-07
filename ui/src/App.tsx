import React from 'react';
import { useAi } from './hooks/use-ai';
import { LoginScreen } from './components/login-screen';
import { Dashboard } from './components/dashboard';

/**
 * Main application component.
 * We use the isAuthenticated state from our custom hook 
 * to decide which screen to show.
 */
export const App: React.FC = () => {
  const { isAuthenticated } = useAi();

  return (
    <div className="min-h-screen text-foreground selection:bg-primary/20">
      {isAuthenticated ? <Dashboard /> : <LoginScreen />}
    </div>
  );
};
