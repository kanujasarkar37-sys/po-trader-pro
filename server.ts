// ─────────────────────────────────────────────────────────────────────────────
// PO Trader Pro — consolidated production server (single process, single port)
//
// Runs the Next.js app AND the po-trader trading engine in ONE process:
//   • Next.js handles all HTTP (pages + /api/* routes)
//   • The engine's socket.io attaches to the SAME HTTP server at /engine
//     (browsers connect same-origin: io({ path: '/engine' }))
//   • /healthz — liveness + engine status (for Render / Docker health checks)
//
// The engine persists trades/config through the Next API routes, so
// ENGINE_NEXT_API is pointed at this very server before the engine boots.
//
// Usage (after `bun run build`):
//   PORT=3000 bun server.ts
// ─────────────────────────────────────────────────────────────────────────────

import next from 'next'
import { createServer } from 'http'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

// The engine talks to the Next API for persistence — point it at THIS server
// (must be set before the engine module is imported and reads it).
process.env.ENGINE_NEXT_API ??= `http://localhost:${PORT}/api`

async function main() {
  const app = next({ dev: false })
  const handle = app.getRequestHandler()
  await app.prepare()

  // Boot the trading engine (globalThis-singleton inside; safe to import once)
  const { bootEngine } = await import('./mini-services/po-trader/index')
  const boot = bootEngine('/engine')

  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    // Health endpoint for Render/Docker/K8s probes (NOT under /engine — the
    // socket.io path prefix would swallow it).
    if (url === '/healthz' || url === '/engine/healthz') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(JSON.stringify({
        ok: true,
        service: 'po-trader-pro',
        engine: {
          mode: boot.engine.mode,
          authenticated: boot.engine.mode !== 'disconnected',
          botRunning: boot.engine.botRunning,
          chartAsset: boot.engine.chartAsset,
        },
        uptimeSec: Math.floor(process.uptime()),
        time: new Date().toISOString(),
      }))
      return
    }
    handle(req, res)
  })

  // Engine websocket + polling endpoints live at /engine/* on this server
  boot.attach(server)

  server.listen(PORT, () => {
    console.log(`┌────────────────────────────────────────────────┐`)
    console.log(`│  PO Trader Pro — consolidated production       │`)
    console.log(`│  Web + engine listening on http://${HOST}:${PORT}   │`)
    console.log(`│  Engine websocket: ws://<host>/engine          │`)
    console.log(`│  Health: http://<host>/healthz                 │`)
    console.log(`└────────────────────────────────────────────────┘`)
  })

  const shutdown = (signal: string) => {
    console.log(`\n[shutdown] ${signal} received — closing server`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[fatal] failed to start consolidated server:', err)
  process.exit(1)
})
