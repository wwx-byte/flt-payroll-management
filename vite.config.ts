import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [
    tanstackStart({ router: { generatedRouteTree: 'route-tree.gen.ts' } }),
    stylex.vite({ useCSSLayers: true }),
    react(),
    nitro({ preset: 'node-server' }),
  ],
  build: { outDir: 'build' },
  server: {
    fs: {
      deny: [
        '**/payroll-data/**',
        '**/*.sqlite3*',
        '**/initial-login.txt',
        '**/.env*',
        '**/.git/**',
        '**/*.{pem,crt}',
      ],
    },
  },
})
