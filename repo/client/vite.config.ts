import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev is deliberately SAME-ORIGIN. In production the frontend and API are
    // split-origin Render services and the session cookie is
    // `SameSite=None; Secure` — which a browser will not send over plain http.
    // Proxying `/api` in dev means the local run exercises the real auth flow
    // instead of looking like a broken-cookie bug. Set VITE_API_BASE_URL to the
    // deployed API origin for the production build.
    proxy: {
      '/api': {
        target: process.env.DEV_API_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@classroom-copier/shared'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
  },
})
