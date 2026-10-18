import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Blocks requests to anywhere except Google's sign-in, Drive and Sheets endpoints.
// Added to production builds only: the dev server injects inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
  "connect-src 'self' https://sheets.googleapis.com https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com",
  'frame-src https://accounts.google.com',
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data:",
  "worker-src 'self' blob:",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  plugins: [react(), csp()],
  server: { host: '127.0.0.1', port: 8000 },
  preview: { host: '127.0.0.1', port: 8000 },
});
