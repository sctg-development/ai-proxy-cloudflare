import React from 'react';
import { useAi } from '../hooks/use-ai';
import { LoginScreen } from './login-screen';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { isAuthenticated } = useAi();

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <nav className="w-64 border-r border-border bg-surface-secondary p-4">
        {/* Sidebar navigation */}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  );
};