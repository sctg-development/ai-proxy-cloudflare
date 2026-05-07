import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VAULT_URL': JSON.stringify(process.env.VAULT_URL || 'https://ai-proxy.inet.pp.ua'),
  },
  plugins: [
    // React plugin enables JSX transform and Fast Refresh in development
    react(),
    // Tailwind CSS v4 Vite plugin — processes @import "tailwindcss" at build time
    tailwindcss(),
  ],
  server: {
    port: 3000,
  },
});