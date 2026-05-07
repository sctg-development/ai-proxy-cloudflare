/**
 * @file Application entry point.
 * Junior Dev Note: This is the first file executed when the app starts.
 * It mounts the React app into the <div id="root"> in index.html.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AiProvider } from './hooks/use-ai';
import './styles/index.css';

// Mount the React application into the DOM root element.
// React.StrictMode double-invokes renders in development to catch side effects.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* AiProvider wraps the whole app so every component can access vault state */}
    <AiProvider>
      <App />
    </AiProvider>
  </React.StrictMode>
);
