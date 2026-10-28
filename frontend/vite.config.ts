import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFile } from 'node:fs/promises'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-markdown-docs',
      configureServer(server) {
        server.middlewares.use('/docs-md/', async (request, response) => {
          const filename = request.url?.split('?')[0] ?? ''
          if (!/^\/[a-zA-Z0-9-]+\.md$/.test(filename)) {
            response.statusCode = 404
            response.end('Document not found')
            return
          }
          try {
            const content = await readFile(path.resolve(__dirname, '../docs', filename.slice(1)), 'utf8')
            response.setHeader('Content-Type', 'text/markdown; charset=utf-8')
            response.end(content)
          } catch {
            response.statusCode = 404
            response.end('Document not found')
          }
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  assetsInclude: [],
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'reactflow': ['reactflow'],
        },
      },
    },
  },
})
