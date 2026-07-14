import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Resolve the frontend workspace's copy so the assets always match the
// pdfjs-dist version bundled by react-pdf, regardless of npm hoisting.
const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const pdfjsAssetGroups = [
  { urlPrefix: '/pdfjs/wasm/', sourceDir: path.join(pdfjsRoot, 'wasm'), outputDir: 'pdfjs/wasm' },
  { urlPrefix: '/pdfjs/standard_fonts/', sourceDir: path.join(pdfjsRoot, 'standard_fonts'), outputDir: 'pdfjs/standard_fonts' },
] as const

function contentType(fileName: string): string {
  switch (path.extname(fileName)) {
    case '.js': return 'text/javascript'
    case '.pfb': return 'application/x-font-type1'
    case '.ttf': return 'font/ttf'
    case '.wasm': return 'application/wasm'
    default: return 'application/octet-stream'
  }
}

function pdfjsAssets(): Plugin {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = (request.url ?? '').split('?', 1)[0] ?? ''
        const group = pdfjsAssetGroups.find(asset => requestPath.startsWith(asset.urlPrefix))
        if (!group) return next()
        const relative = decodeURIComponent(requestPath.slice(group.urlPrefix.length))
        if (!relative || relative.split('/').includes('..')) return next()
        const root = path.resolve(group.sourceDir)
        const filePath = path.resolve(root, relative)
        if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next()
        response.statusCode = 200
        response.setHeader('Content-Type', contentType(filePath))
        response.end(fs.readFileSync(filePath))
      })
    },
    generateBundle() {
      for (const group of pdfjsAssetGroups) {
        for (const fileName of fs.readdirSync(group.sourceDir)) {
          const filePath = path.join(group.sourceDir, fileName)
          if (fs.statSync(filePath).isFile()) this.emitFile({
            type: 'asset',
            fileName: `${group.outputDir}/${fileName}`,
            source: fs.readFileSync(filePath),
          })
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [pdfjsAssets(), react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8200',
      },
    },
  },
})
