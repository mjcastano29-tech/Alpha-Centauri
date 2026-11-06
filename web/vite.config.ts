import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Dos páginas: la aplicación (index.html) y la landing de presentación (landing/index.html, servida en /landing/).
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing/index.html', import.meta.url)),
      },
    },
  },
})
