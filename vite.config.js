import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      },
      '/erp-api': {
        target: 'https://api.erp.lms.rolaface.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/erp-api/, '')
      }
    }
  }
})
