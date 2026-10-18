import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // A lógica de jogo mora em shared/ e é usada pelo cliente E pelo servidor.
    alias: {
      '@helio/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Em desenvolvimento o cliente fala com o servidor de jogo (server/) na
      // mesma origem, igual ao que o Caddy faz em produção.
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
    fs: {
      // permite ler shared/ (fora da raiz do client/)
      allow: ['..'],
    },
  },
})
