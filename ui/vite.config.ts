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

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// @sctg/cline-chatbot bundles its agent Web Worker as a standalone file with a
// hardcoded absolute URL (e.g. `/assets/agent.worker-<hash>.js`) that it expects
// the host app to serve as-is. This plugin copies that file from the package's
// dist-lib/assets into this app's dev server and build output so the hash always
// matches whatever version of the package is installed.
function clineChatbotWorkerAssets(): Plugin {
  const assetsDir = path.resolve(dirname, 'node_modules/@sctg/cline-chatbot/dist-lib/assets');
  let outDir = 'dist';
  return {
    name: 'cline-chatbot-worker-assets',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url.startsWith('/assets/')) {
          const filePath = path.join(assetsDir, path.basename(url));
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/javascript');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      if (!fs.existsSync(assetsDir)) return;
      const destDir = path.resolve(outDir, 'assets');
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(assetsDir)) {
        fs.copyFileSync(path.join(assetsDir, file), path.join(destDir, file));
      }
    },
  };
}

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
    // Serves/copies @sctg/cline-chatbot's standalone agent Web Worker asset
    clineChatbotWorkerAssets(),
  ],
  optimizeDeps: {
     include: ['react', 'react-dom'],
  },
  server: {
    port: 3000,
  },
});