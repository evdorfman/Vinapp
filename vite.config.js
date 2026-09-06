import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { anthropicProxyPlugin } from './server/anthropic-proxy.js';
import { loadEnvFile } from './server/load-env.js';

// ANTHROPIC_API_KEY is read by the proxy middleware in this process only —
// Vite never exposes it to the client (no VITE_ prefix).
loadEnvFile();

export default defineConfig({
  plugins: [react(), tailwindcss(), anthropicProxyPlugin()],
  server: { host: true },
});
