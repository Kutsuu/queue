import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\', '/')
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react-vendor'
          if (path.includes('/node_modules/lucide-react/')) return 'icons'
          const firebaseService = path.match(/\/node_modules\/@firebase\/([^/]+)/)?.[1]
          if (firebaseService && ['auth', 'firestore', 'database', 'app-check'].includes(firebaseService)) return `firebase-${firebaseService}`
          if (path.includes('/node_modules/firebase/')) return 'firebase-entrypoints'
          if (path.includes('/node_modules/@firebase/')) return 'firebase-core'
        },
      },
    },
  },
})
