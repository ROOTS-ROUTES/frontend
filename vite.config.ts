import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Point the /api proxy at your RAG server (FastAPI, LangChain server, LlamaIndex, etc.)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
