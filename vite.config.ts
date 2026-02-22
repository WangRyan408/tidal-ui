import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn(warning, warn) {
        const message = typeof warning.message === 'string' ? warning.message : ''

        if (
          warning.code === 'UNUSED_EXTERNAL_IMPORT' &&
          typeof warning.id === 'string' &&
          warning.id.includes('node_modules/@tanstack/')
        ) {
          return
        }

        if (
          message.includes('are imported from external module') &&
          message.includes('but never used in') &&
          message.includes('node_modules/@tanstack/')
        ) {
          return
        }

        if (
          message.includes('"RawStream" is imported from external module "@tanstack/router-core"') &&
          message.includes('node_modules/@tanstack/start-client-core/')
        ) {
          return
        }

        warn(warning)
      },
    },
  },
  server: {
    host: true,
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})

export default config
