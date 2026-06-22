/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Build stamp (MM-DD HH:MM) shown in the UI so it's obvious which deploy is live.
const buildStamp = new Date().toISOString().slice(5, 16).replace('T', ' ')

// base: './' so the build works when served from a GitHub Pages project
// sub-path (https://<user>.github.io/sand-studio/) — all asset URLs stay relative.
export default defineConfig({
  base: './',
  define: {
    __APP_BUILD__: JSON.stringify(buildStamp)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '落ち砂サンドボックス',
        short_name: '落ち砂',
        description: '指先で砂・水・火・植物を撒いて、創発する世界を眺めて録画・共有する落ち砂サンドボックス。',
        lang: 'ja',
        theme_color: '#0a0a12',
        background_color: '#0a0a12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
