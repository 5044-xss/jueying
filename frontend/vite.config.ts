import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 桌面端用 file:// 加载 dist，需相对路径；开发时 /api 走 proxy 到本地后端。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8642',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
