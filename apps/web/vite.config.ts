import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  build: {
    rollupOptions: {
      output: {
        // The canvas dependencies were bundled into the same multi-megabyte
        // chunk as the app shell, so every route paid for tldraw and TipTap and
        // any app change invalidated them in cache. Rolldown's `advancedChunks`
        // replaces Rollup's `manualChunks`.
        advancedChunks: {
          groups: [
            {
              name: 'tldraw',
              test: /[\\/]node_modules[\\/](tldraw|@tldraw)[\\/]/,
            },
            {
              name: 'tiptap',
              test: /[\\/]node_modules[\\/](@tiptap|prosemirror-[^\\/]+)[\\/]/,
            },
          ],
        },
      },
    },
  },
  // Keep tldraw's `?url` asset imports out of Rolldown's Windows dependency
  // optimizer; Vite's normal transform handles them correctly.
  optimizeDeps: { exclude: ['@tldraw/assets'] },
  ssr: { optimizeDeps: { exclude: ['@tldraw/assets'] } },
  server: {host:true}
})

export default config
