import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [vue()],
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || env.VITE_AI_API_BASE_URL || 'http://localhost:8000',
          changeOrigin: true,
          secure: false, // 如果是 https 但证书自签，设为 false
          // rewrite: (path) => path.replace(/^\/api/, '') // 如果后端不需要 /api 前缀，取消注释
        }
      }
    }
  }
})
