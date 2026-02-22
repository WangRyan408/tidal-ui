import { existsSync } from 'node:fs'
import path from 'node:path'
import server from './dist/server/server.js'

const clientRoot = path.join(import.meta.dir, 'dist', 'client')
const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || '5000')

function resolveStaticFile(pathname) {
  const decodedPath = decodeURIComponent(pathname)
  const relativePath = decodedPath.replace(/^\/+/, '')
  const candidate = path.join(clientRoot, relativePath)
  const normalizedClientRoot = path.normalize(clientRoot + path.sep)
  const normalizedCandidate = path.normalize(candidate)

  if (!normalizedCandidate.startsWith(normalizedClientRoot)) {
    return null
  }

  if (!existsSync(normalizedCandidate)) {
    return null
  }

  return normalizedCandidate
}

const app = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname !== '/') {
      const staticFile = resolveStaticFile(url.pathname)

      if (staticFile) {
        return new Response(Bun.file(staticFile))
      }
    }

    return server.fetch(request)
  },
})

console.log(`tidal-ui running on http://${app.hostname}:${app.port}`)