// ─── Pocket Option live WebSocket client (unofficial reverse-engineered API) ─
// Protocol: Engine.IO v4 over WebSocket + socket.io v4 message framing.
// Auth: raw SSID string (from browser cookie) sent right after WS handshake.

import WebSocket from 'ws'
import { EventEmitter } from 'events'

export interface POEvents {
  auth: (account: 'demo' | 'real') => void
  authFail: (reason: string) => void
  balance: (balance: number, isDemo: boolean) => void
  tick: (asset: string, price: number) => void
  candles: (asset: string, candles: [number, number, number, number, number][]) => void
  assets: (assets: unknown) => void
  orderOpened: (data: Record<string, unknown>) => void
  orderFailed: (data: unknown) => void
  orderClosed: (data: Record<string, unknown>) => void
  closed: (reason: string) => void
  log: (msg: string) => void
}

export const PO_SERVERS: Record<string, string> = {
  'api-l': 'wss://api-l.po.market/socket.io/?EIO=4&transport=websocket',
  'api-eu': 'wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket',
  'api-us': 'wss://api-us.po.market/socket.io/?EIO=4&transport=websocket',
  'api-msl': 'wss://api-msl.po.market/socket.io/?EIO=4&transport=websocket',
}

export class PocketOptionClient extends EventEmitter {
  private ws: WebSocket | null = null
  private ssid = ''
  private region: keyof typeof PO_SERVERS = 'api-l'
  private authenticated = false
  private closedByUser = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastPingAt = 0
  connected = false

  get isAuthenticated() { return this.authenticated }

  /** Normalize a pasted SSID cookie value into the raw `42["auth",...]` message. */
  static normalizeSsid(raw: string): string {
    let s = raw.trim()
    // The cookie is URL-encoded; decode until stable
    for (let i = 0; i < 3; i++) {
      try {
        const d = decodeURIComponent(s.replace(/\+/g, ' '))
        if (d === s) break
        s = d
      } catch { break }
    }
    if (s.startsWith('42["auth"')) return s
    // User pasted only the inner session string — wrap it
    if (s.startsWith('a:4:')) {
      return `42["auth",{"session":"${s}","isDemo":1,"uid":"0"}]`
    }
    return s
  }

  static extractSsidInfo(ssid: string): { isDemo: boolean; uid: string } {
    try {
      const m = ssid.match(/"isDemo"\s*:\s*(\d)/)
      const u = ssid.match(/"uid"\s*:\s*"?(\d+)"?/)
      return { isDemo: m ? m[1] === '1' : true, uid: u ? u[1] : '0' }
    } catch {
      return { isDemo: true, uid: '0' }
    }
  }

  connect(ssidRaw: string, region: string) {
    this.close('reconnect')
    this.ssid = PocketOptionClient.normalizeSsid(ssidRaw)
    this.region = (region in PO_SERVERS ? region : 'api-l') as keyof typeof PO_SERVERS
    this.closedByUser = false
    this.open()
  }

  private open() {
    const url = PO_SERVERS[this.region]
    this.emit('log', `Connecting to Pocket Option (${this.region})…`)
    const ws = new WebSocket(url, {
      headers: {
        'Origin': 'https://pocketoption.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      handshakeTimeout: 15000,
    })
    this.ws = ws
    ws.on('open', () => {
      this.connected = true
      this.emit('log', 'WebSocket open — sending SSID auth…')
    })
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()))
    ws.on('error', (err: Error) => {
      this.emit('log', `WS error: ${err.message}`)
    })
    ws.on('close', (code: number, reason: Buffer) => {
      this.connected = false
      const msg = reason?.toString() || `code ${code}`
      this.authenticated = false
      this.emit('closed', msg)
      if (!this.closedByUser) {
        this.scheduleReconnect()
      }
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUser) {
        this.emit('log', 'Reconnecting to Pocket Option…')
        this.open()
      }
    }, 5000)
  }

  private handleMessage(msg: string) {
    // Engine.IO heartbeat: server pings with '2', we pong with '3'
    if (msg === '2') {
      this.send('3')
      this.lastPingAt = Date.now()
      return
    }
    if (msg === '3') return
    // Engine.IO open handshake: 0{"sid":...,"pingInterval":25000,...}
    if (msg.startsWith('0{')) {
      // socket.io v4: connect to namespace, then send SSID auth event
      this.send('40')
      this.send(this.ssid)
      return
    }
    // namespace connect ack from server ('40' or '40{"sid":...}') — nothing to do
    if (msg === '40' || msg.startsWith('40{')) return
    // socket.io event: 42["event",payload]
    if (msg.startsWith('42')) {
      this.handleSocketIOMessage(msg)
    }
  }

  private handleSocketIOMessage(msg: string) {
    // format: 42["event",payload]
    let parsed: [string, unknown]
    try {
      parsed = JSON.parse(msg.slice(2))
    } catch { return }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return
    const [event, payload] = parsed

    switch (event) {
      case 'successauth': {
        this.authenticated = true
        const account = payload === 'real' ? 'real' : 'demo'
        this.emit('log', `Authenticated (${account} account)`)
        this.emit('auth', account)
        // request all ticker streams
        this.send('42["subfor"]')
        break
      }
      case 'successupdateBalance':
      case 'updateBalance': {
        const p = payload as { balance?: number; isDemo?: number }
        if (p && typeof p.balance === 'number') {
          this.emit('balance', p.balance, !!p.isDemo)
        }
        break
      }
      case 'updateStream': {
        const p = payload as [string, number]
        if (Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number') {
          this.emit('tick', p[0], p[1])
        }
        break
      }
      case 'load_history_period': {
        const p = payload as { asset?: string; data?: [number, number, number, number, number][] }
        if (p && p.asset && Array.isArray(p.data)) {
          this.emit('candles', p.asset, p.data)
        }
        break
      }
      case 'updateAssets':
      case 'symbol': {
        this.emit('assets', payload)
        break
      }
      case 'successopenOrder': {
        this.emit('orderOpened', (payload ?? {}) as Record<string, unknown>)
        break
      }
      case 'failopenOrder': {
        this.emit('orderFailed', payload)
        break
      }
      case 'successcloseOrder': {
        this.emit('orderClosed', (payload ?? {}) as Record<string, unknown>)
        break
      }
      default:
        // unknown events ignored
        break
    }
  }

  // ─── Outgoing commands ─────────────────────────────────────────────────────

  send(raw: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw)
    }
  }

  changeSymbol(asset: string, period = 60) {
    this.send(`42["change_symbol",{"asset":"${asset}","period":${period}}]`)
  }

  loadHistory(asset: string, indexTs: number, offsetSec: number, period = 60) {
    this.send(`42["load_history_period",{"asset":"${asset}","time":${period},"index":${indexTs},"offset":${offsetSec}}]`)
  }

  changeBalance(account: 'demo' | 'real') {
    this.send(`42["change_balance",{"account":"${account}"}]`)
  }

  openOrder(opts: { asset: string; amount: number; action: 'call' | 'put'; isDemo: boolean; requestId: number; time: number; optionType?: number }) {
    const payload = {
      asset: opts.asset,
      amount: opts.amount,
      action: opts.action,
      isDemo: opts.isDemo ? 1 : 0,
      requestId: opts.requestId,
      optionType: opts.optionType ?? 100,
      time: opts.time,
    }
    this.send(`42["openOrder",${JSON.stringify(payload)}]`)
  }

  close(reason = 'user') {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try { this.ws.close(1000) } catch { /* ignore */ }
      this.ws = null
    }
    this.connected = false
    this.authenticated = false
    this.emit('closed', reason)
  }
}
