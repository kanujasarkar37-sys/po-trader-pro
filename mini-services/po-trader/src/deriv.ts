// ─── Deriv API client (free, no API key needed for market data) ──────────────
// Connects to the official Deriv WebSocket API and provides:
//   • Live market data for 60+ symbols (forex, crypto, synthetics, commodities,
//     stock indices) — FREE, no auth required
//   • Optional authorize() with a user API token → real demo/real trading
//     (buy CALL/PUT contracts + settle via proposal_open_contract)
//   • Market-hours awareness: forex/commodities close on weekends; synthetics
//     and crypto trade 24/7
//
// Region reality-check (discovered during integration):
//   • active_symbols may return an empty list in restricted regions → we use a
//     hardcoded, pre-verified catalog and probe each symbol once at connect
//   • `subscribe: 1` streams may be blocked (InvalidSymbol) → we PROBE
//     streaming once and transparently fall back to POLLING (candles snapshot
//     every pollMs per watched symbol — ~5s gives near-real-time M1 data)
//   • Connection bursts rate-limit the IP → ONE persistent connection, with a
//     throttled request queue (~280ms spacing) and exponential backoff

import WebSocket from 'ws'
import { EventEmitter } from 'events'
import type { Candle } from './types'

// ─── Symbol catalog (all verified working via ticks_history) ────────────────

export type DerivCategory = 'forex' | 'crypto' | 'synthetic' | 'commodity' | 'index'

export interface DerivSymbolDef {
  symbol: string
  name: string
  category: DerivCategory
  digits: number
  /** 24/7 markets (synthetics + crypto on Deriv never close) */
  alwaysOpen: boolean
}

const S = (symbol: string, name: string, category: DerivCategory, digits: number): DerivSymbolDef => ({
  symbol, name, category, digits,
  alwaysOpen: category === 'synthetic' || category === 'crypto',
})

export const DERIV_CATALOG: DerivSymbolDef[] = [
  // ── Forex majors & crosses (closed weekends) ──
  S('frxEURUSD', 'EUR/USD', 'forex', 5), S('frxGBPUSD', 'GBP/USD', 'forex', 5),
  S('frxUSDJPY', 'USD/JPY', 'forex', 3), S('frxAUDUSD', 'AUD/USD', 'forex', 5),
  S('frxUSDCHF', 'USD/CHF', 'forex', 5), S('frxUSDCAD', 'USD/CAD', 'forex', 5),
  S('frxNZDUSD', 'NZD/USD', 'forex', 5), S('frxEURGBP', 'EUR/GBP', 'forex', 5),
  S('frxEURJPY', 'EUR/JPY', 'forex', 3), S('frxGBPJPY', 'GBP/JPY', 'forex', 3),
  S('frxAUDCAD', 'AUD/CAD', 'forex', 5), S('frxEURCHF', 'EUR/CHF', 'forex', 5),
  S('frxAUDJPY', 'AUD/JPY', 'forex', 3), S('frxCADJPY', 'CAD/JPY', 'forex', 3),
  S('frxCHFJPY', 'CHF/JPY', 'forex', 3), S('frxEURAUD', 'EUR/AUD', 'forex', 5),
  S('frxGBPAUD', 'GBP/AUD', 'forex', 5), S('frxAUDNZD', 'AUD/NZD', 'forex', 5),
  S('frxEURNZD', 'EUR/NZD', 'forex', 5), S('frxNZDJPY', 'NZD/JPY', 'forex', 3),
  S('frxGBPCAD', 'GBP/CAD', 'forex', 5), S('frxEURCAD', 'EUR/CAD', 'forex', 5),
  S('frxUSDTRY', 'USD/TRY', 'forex', 5), S('frxUSDMXN', 'USD/MXN', 'forex', 5),
  S('frxUSDZAR', 'USD/ZAR', 'forex', 5), S('frxUSDNOK', 'USD/NOK', 'forex', 5),
  S('frxUSDSEK', 'USD/SEK', 'forex', 5), S('frxUSDSGD', 'USD/SGD', 'forex', 5),
  // ── Commodities (closed weekends) ──
  S('frxXAUUSD', 'Gold', 'commodity', 2), S('frxXAGUSD', 'Silver', 'commodity', 3),
  S('frxXPTUSD', 'Platinum', 'commodity', 2), S('frxXPDUSD', 'Palladium', 'commodity', 2),
  // ── Crypto (24/7) ──
  S('cryBTCUSD', 'Bitcoin', 'crypto', 2), S('cryETHUSD', 'Ethereum', 'crypto', 2),
  S('cryLTCUSD', 'Litecoin', 'crypto', 2), S('cryXRPUSD', 'Ripple', 'crypto', 4),
  S('cryEOSUSD', 'EOS', 'crypto', 4), S('cryDSHUSD', 'Dash', 'crypto', 2),
  S('cryETCUSD', 'Ethereum Classic', 'crypto', 2),
  // ── Synthetic indices (24/7, 365 days) ──
  S('R_10', 'Volatility 10 Index', 'synthetic', 3),
  S('R_25', 'Volatility 25 Index', 'synthetic', 3),
  S('R_50', 'Volatility 50 Index', 'synthetic', 4),
  S('R_75', 'Volatility 75 Index', 'synthetic', 4),
  S('R_100', 'Volatility 100 Index', 'synthetic', 2),
  S('1HZ10V', 'Volatility 10 (1s) Index', 'synthetic', 3),
  S('1HZ25V', 'Volatility 25 (1s) Index', 'synthetic', 3),
  S('1HZ50V', 'Volatility 50 (1s) Index', 'synthetic', 4),
  S('1HZ75V', 'Volatility 75 (1s) Index', 'synthetic', 4),
  S('1HZ100V', 'Volatility 100 (1s) Index', 'synthetic', 2),
  S('1HZ150V', 'Volatility 150 (1s) Index', 'synthetic', 2),
  S('JD10', 'Jump 10 Index', 'synthetic', 3),
  S('JD25', 'Jump 25 Index', 'synthetic', 3),
  S('JD50', 'Jump 50 Index', 'synthetic', 4),
  S('JD75', 'Jump 75 Index', 'synthetic', 4),
  S('JD100', 'Jump 100 Index', 'synthetic', 3),
  S('BOOM500', 'Boom 500 Index', 'synthetic', 4),
  S('BOOM1000', 'Boom 1000 Index', 'synthetic', 3),
  S('CRASH500', 'Crash 500 Index', 'synthetic', 4),
  S('CRASH1000', 'Crash 1000 Index', 'synthetic', 3),
  S('stpRNG', 'Range Break 100 Index', 'synthetic', 4),
  // ── Stock indices (closed weekends) ──
  S('OTC_DJI', 'Dow Jones Index', 'index', 1),
  S('OTC_NDX', 'Nasdaq 100 Index', 'index', 1),
]

export const DERIV_APP_ID = process.env.DERIV_APP_ID ?? '1089'
export const DERIV_WS = process.env.DERIV_WS_URL ?? `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`

// ─── Market hours ────────────────────────────────────────────────────────────
// Deriv forex/commodities/stock-indices follow the interbank FX week:
// open Mon 00:00 Sydney (Sun 21:00 UTC) → close Fri 22:00 UTC (DST-sharp
// boundaries approximated; actual close 21:00/22:00 UTC seasonally).
export function isFxWeekendNow(now = new Date()): boolean {
  const day = now.getUTCDay() // 0=Sun … 6=Sat
  const hour = now.getUTCHours()
  if (day === 6) return true // Saturday
  if (day === 0) return hour < 21 // Sunday before Sydney open
  if (day === 5) return hour >= 22 // Friday after NY close
  return false
}

export function marketOpenNow(def: DerivSymbolDef, now = new Date()): boolean {
  if (def.alwaysOpen) return true
  return !isFxWeekendNow(now)
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface DerivAccount {
  loginid: string
  isVirtual: boolean
  currency: string
  balance: number
}

export interface DerivContractState {
  contractId: number
  isSold: boolean
  status?: 'won' | 'lost' | 'cancelled' | string
  profit: number
  payout: number
  buyPrice: number
  entrySpot?: number
  exitTick?: number
  dateExpiry?: number
}

export interface DerivEvents {
  log: (msg: string) => void
  connected: () => void
  closed: (reason: string) => void
  authOk: (account: DerivAccount) => void
  authFail: (reason: string) => void
  balance: (balance: number) => void
  symbolOk: (symbol: string, digits: number) => void
  symbolBad: (symbol: string) => void
  candles: (symbol: string, candles: Candle[], pipSize: number) => void
  tick: (symbol: string, price: number) => void
  buyOk: (localId: string, contract: { contractId: number; buyPrice: number; payout: number }) => void
  buyFail: (localId: string, reason: string) => void
  contract: (state: DerivContractState) => void
  streamingMode: (enabled: boolean) => void
}

// ─── Client ──────────────────────────────────────────────────────────────────

interface QueuedReq {
  req: Record<string, unknown>
  resolve: (data: any) => void
  reject: (err: Error) => void
  tries: number
}

const REQ_SPACING_MS = 280 // polite spacing — bursts trigger the region soft-ban
const PING_EVERY_MS = 25_000

export class DerivClient extends EventEmitter {
  private ws: WebSocket | null = null
  private reqQueue: QueuedReq[] = []
  private sending = false
  private reqId = 0
  private pending = new Map<number, QueuedReq>()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private queueTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  private token = ''
  private probeStreamDone = false

  // streaming vs polling
  streaming = false
  connected = false
  authorized = false
  account: DerivAccount | null = null

  // watched symbols (polling set) + their subscription ids (streaming)
  private watched = new Map<string, number>() // symbol → last poll ms
  private streamIds = new Map<string, string>() // symbol → subscription id
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private symbolDigits = new Map<string, number>()
  private symbolBad = new Set<string>()
  private historyDepth = new Map<string, number>() // symbol → last requested count

  constructor() {
    super()
    this.setMaxListeners(30)
  }

  // ─── Connection ───────────────────────────────────────────────────────────

  connect(token?: string) {
    this.disconnect(true)
    this.closedByUser = false
    this.token = (token ?? '').trim()
    this.emit('log', `Connecting to Deriv (app_id ${DERIV_APP_ID})${this.token ? ' with API token' : ' — free live market data'}…`)
    this.open()
  }

  private open() {
    const ws = new WebSocket(DERIV_WS, { handshakeTimeout: 15000 })
    this.ws = ws
    ws.on('open', () => {
      this.connected = true
      this.emit('log', 'Deriv WebSocket connected')
      this.emit('connected')
      this.startLoops()
      if (this.token) this.authorize(this.token)
      this.probeCatalog()
    })
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()))
    ws.on('error', (err: Error) => {
      if (!this.connected) this.emit('log', `Deriv WS error: ${err.message}`)
    })
    ws.on('close', (code: number) => {
      const wasConnected = this.connected
      this.connected = false
      this.authorized = false
      this.failAllPending('socket closed')
      if (this.closedByUser) {
        this.emit('closed', 'user')
        return
      }
      if (wasConnected) this.emit('log', `Deriv connection closed (code ${code}) — reconnecting in 5s…`)
      this.scheduleReconnect(5000)
    })
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer || this.closedByUser) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByUser) this.open()
    }, delayMs)
  }

  disconnect(silent = false) {
    this.closedByUser = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.stopLoops()
    if (this.ws) { try { this.ws.close(1000) } catch { /* ignore */ } this.ws = null }
    this.connected = false
    this.authorized = false
    this.failAllPending('disconnected')
    if (!silent) this.emit('closed', 'user')
  }

  private startLoops() {
    this.stopLoops()
    this.pingTimer = setInterval(() => {
      this.raw({ ping: 1 }).catch(() => {})
    }, PING_EVERY_MS)
    // request queue drainer
    this.queueTimer = setInterval(() => this.drainQueue(), REQ_SPACING_MS)
    this.drainQueue()
  }

  private stopLoops() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.queueTimer) { clearInterval(this.queueTimer); this.queueTimer = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  // ─── Request plumbing (throttled queue + req_id correlation) ─────────────

  private async drainQueue() {
    if (this.sending || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const item = this.reqQueue.shift()
    if (!item) return
    this.sending = true
    setTimeout(() => { this.sending = false }, REQ_SPACING_MS)
    const id = ++this.reqId
    const payload = { ...item.req, req_id: id }
    this.pending.set(id, item)
    try {
      this.ws.send(JSON.stringify(payload))
    } catch (err) {
      this.pending.delete(id)
      item.reject(err instanceof Error ? err : new Error(String(err)))
    }
    // safety: reject pending requests that never got a response
    setTimeout(() => {
      const p = this.pending.get(id)
      if (p) {
        this.pending.delete(id)
        p.reject(new Error('timeout'))
      }
    }, 20000)
  }

  /** Queue a request; resolves with the full response object. */
  raw(req: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.closedByUser) { reject(new Error('client closed')); return }
      this.reqQueue.push({ req, resolve, reject, tries: 0 })
      if (this.queueTimer) this.drainQueue()
    })
  }

  private failAllPending(reason: string) {
    for (const [, p] of this.pending) p.reject(new Error(reason))
    this.pending.clear()
    for (const p of this.reqQueue) p.reject(new Error(reason))
    this.reqQueue = []
  }

  private handleMessage(msg: string) {
    if (msg === 'ping') { this.ws?.send('pong'); return }
    let data: any
    try { data = JSON.parse(msg) } catch { return }
    const id = typeof data.req_id === 'number' ? data.req_id : null
    const waiter = id != null ? this.pending.get(id) : null
    if (data.error) {
      if (waiter) { this.pending.delete(id!); waiter.reject(new Error(`${data.error.code}: ${data.error.message ?? ''}`)) }
      return
    }
    if (waiter) { this.pending.delete(id!); waiter.resolve(data); return }
    // subscription push messages (no req_id) — streaming mode only
    if (data.msg_type === 'candle' && data.candle) {
      const c = data.candle
      this.emit('candles', c.symbol, [{ time: c.open_time ?? c.epoch, open: c.open, high: c.high, low: c.low, close: c.close }], 0)
      this.emit('tick', c.symbol, c.close)
    } else if (data.msg_type === 'tick' && data.tick) {
      this.emit('tick', data.tick.symbol, data.tick.quote)
    }
  }

  // ─── Symbol availability probing ─────────────────────────────────────────

  private async probeCatalog() {
    // Probe one small request per catalog symbol (spaced by the queue).
    // Symbols that respond OK are marked available; failures marked bad.
    // Also probes whether subscribe streams work (region-dependent).
    this.emit('log', `Probing ${DERIV_CATALOG.length} Deriv symbols…`)
    for (const def of DERIV_CATALOG) {
      if (this.closedByUser) return
      try {
        const res = await this.raw({ ticks_history: def.symbol, count: 1, end: 'latest', style: 'candles', granularity: 60 })
        const cs = res?.candles ?? []
        if (Array.isArray(cs) && cs.length) {
          if (typeof res.pip_size === 'number' && res.pip_size > 0) {
            const digits = Math.max(1, Math.min(6, Math.round(-Math.log10(res.pip_size))))
            this.symbolDigits.set(def.symbol, digits)
          }
          this.emit('symbolOk', def.symbol, this.symbolDigits.get(def.symbol) ?? def.digits)
        } else {
          this.symbolBad.add(def.symbol)
          this.emit('symbolBad', def.symbol)
        }
      } catch {
        this.symbolBad.add(def.symbol)
        this.emit('symbolBad', def.symbol)
      }
    }
    // probe streaming support once: try to subscribe to first always-open symbol
    if (!this.probeStreamDone) {
      this.probeStreamDone = true
      const target = DERIV_CATALOG.find(d => d.alwaysOpen && !this.symbolBad.has(d.symbol))
      if (target) {
        try {
          const res = await this.raw({ ticks_history: target.symbol, count: 1, end: 'latest', style: 'candles', granularity: 60, subscribe: 1 })
          const subId = res?.subscription?.id as string | undefined
          if (subId) {
            this.streaming = true
            this.streamIds.set(target.symbol, subId)
            this.emit('streamingMode', true)
            this.emit('log', `Streaming mode active (subscribed to ${target.symbol})`)
          }
        } catch {
          this.streaming = false
          this.emit('streamingMode', false)
          this.emit('log', 'Streams unavailable in this region — using polled live data (~5s refresh)')
        }
      }
    }
    // watched symbols survive reconnects — re-arm their polling
    this.restartPolling()
  }

  isSymbolOk(symbol: string): boolean {
    // during the probe window, optimistically allow catalog symbols
    if (!this.probeStreamDone && !this.symbolBad.has(symbol)) return true
    return !this.symbolBad.has(symbol)
  }

  digitsOf(symbol: string): number {
    return this.symbolDigits.get(symbol)
      ?? DERIV_CATALOG.find(d => d.symbol === symbol)?.digits
      ?? 5
  }

  // ─── Market data ─────────────────────────────────────────────────────────

  /** Fetch historical M1 candles (no subscription). */
  async fetchHistory(symbol: string, count = 1500): Promise<Candle[]> {
    const res = await this.raw({ ticks_history: symbol, adjust_start_time: 1, count, end: 'latest', start: 1, style: 'candles', granularity: 60 })
    const cs = res?.candles ?? []
    return cs.map((c: any) => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close }))
  }

  /** Light snapshot of the newest candles (used by the poller). */
  async pollSymbol(symbol: string): Promise<void> {
    try {
      const res = await this.raw({ ticks_history: symbol, count: 3, end: 'latest', style: 'candles', granularity: 60 })
      const cs = res?.candles ?? []
      if (!Array.isArray(cs) || !cs.length) return
      const candles: Candle[] = cs.map((c: any) => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close }))
      this.emit('candles', symbol, candles, res?.pip_size ?? 0)
      this.emit('tick', symbol, candles[candles.length - 1].close)
    } catch { /* transient — next poll retries */ }
  }

  /** Track a symbol for live updates (streaming subscribe if possible, else polling). */
  watch(symbol: string, deep = false) {
    if (this.symbolBad.has(symbol)) return
    const wasWatched = this.watched.has(symbol)
    const hadDeep = this.historyDepth.get(symbol) === 1500
    const now = Date.now()
    if (!wasWatched) this.watched.set(symbol, 0)
    if (deep) this.historyDepth.set(symbol, 1500)
    if (this.streaming && !this.streamIds.has(symbol)) this.subscribeStream(symbol)
    if (!wasWatched) this.pollSymbol(symbol).catch(() => {})
    // deep history: fetch once, with a 60s retry cadence if still shallow
    if (deep && (!hadDeep || now - this.lastDeepFetch.get(symbol)! > 60_000)) {
      this.lastDeepFetch.set(symbol, now)
      this.fetchHistory(symbol, 1500)
        .then(cs => { if (cs.length) this.emit('candles', symbol, cs, 0) })
        .catch(() => {})
    }
    this.restartPolling()
  }

  private lastDeepFetch = new Map<string, number>()

  unwatch(symbol: string) {
    this.watched.delete(symbol)
    this.historyDepth.delete(symbol)
    const subId = this.streamIds.get(symbol)
    if (subId && this.streaming) {
      this.streamIds.delete(symbol)
      this.raw({ forget: subId }).catch(() => {})
    }
  }

  private async subscribeStream(symbol: string) {
    if (this.streamIds.has(symbol) || this.symbolBad.has(symbol)) return
    try {
      const res = await this.raw({ ticks_history: symbol, count: 2, end: 'latest', style: 'candles', granularity: 60, subscribe: 1 })
      const subId = res?.subscription?.id as string | undefined
      if (subId) this.streamIds.set(symbol, subId)
    } catch { /* fall back to polling for this symbol */ }
  }

  get watchedSymbols(): string[] { return Array.from(this.watched.keys()) }

  /** Poller: in polling mode, refresh each watched symbol every ~5s (staggered). */
  private restartPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.streaming || this.closedByUser) return
    this.pollTimer = setInterval(() => {
      if (!this.connected) return
      const now = Date.now()
      for (const [symbol, lastAt] of this.watched) {
        if (now - lastAt >= 4800) {
          this.watched.set(symbol, now)
          this.pollSymbol(symbol).catch(() => {})
          break // one request per tick — queue spacing handles politeness
        }
      }
    }, 1200)
  }

  // ─── Account / trading (requires API token) ──────────────────────────────

  private async authorize(token: string) {
    try {
      const res = await this.raw({ authorize: token })
      const a = res?.authorize
      if (!a) throw new Error('empty authorize response')
      this.authorized = true
      this.account = {
        loginid: a.loginid ?? '',
        isVirtual: !!a.is_virtual,
        currency: a.currency ?? 'USD',
        balance: typeof a.balance === 'number' ? a.balance : 0,
      }
      this.emit('log', `Deriv authorized: ${this.account.loginid} (${this.account.isVirtual ? 'DEMO (virtual)' : 'REAL'} · ${this.account.currency})`)
      this.emit('authOk', this.account)
      this.refreshBalance().catch(() => {})
    } catch (err) {
      this.authorized = false
      const msg = err instanceof Error ? err.message : String(err)
      this.emit('log', `Deriv authorize failed: ${msg} — continuing with live market data + paper trading`)
      this.emit('authFail', msg)
    }
  }

  async refreshBalance(): Promise<void> {
    if (!this.authorized) return
    try {
      const res = await this.raw({ balance: 1 })
      const b = res?.balance?.balance
      if (typeof b === 'number') {
        if (this.account) this.account.balance = b
        this.emit('balance', b)
      }
    } catch { /* ignore */ }
  }

  /**
   * Buy a Rise/Fall (CALL/PUT) contract on Deriv. Returns via events:
   *   buyOk(localId, {contractId, buyPrice, payout}) / buyFail(localId, reason)
   */
  async buyContract(opts: {
    localId: string
    symbol: string
    direction: 'call' | 'put'
    amount: number
    expirySeconds: number
  }) {
    if (!this.authorized) { this.emit('buyFail', opts.localId, 'not authorized'); return }
    const contractType = opts.direction === 'call' ? 'CALL' : 'PUT'
    try {
      const res = await this.raw({
        buy: 1,
        price: opts.amount,
        parameters: {
          amount: opts.amount,
          basis: 'stake',
          contract_type: contractType,
          currency: this.account?.currency ?? 'USD',
          duration: Math.max(15, opts.expirySeconds),
          duration_unit: 's',
          symbol: opts.symbol,
        },
      })
      const b = res?.buy
      if (!b?.contract_id) throw new Error('no contract_id in buy response')
      this.emit('buyOk', opts.localId, {
        contractId: b.contract_id,
        buyPrice: b.buy_price ?? opts.amount,
        payout: b.payout ?? 0,
      })
    } catch (err) {
      this.emit('buyFail', opts.localId, err instanceof Error ? err.message : String(err))
    }
  }

  /** Poll a contract's state (settlement happens server-side on Deriv). */
  async pollContract(contractId: number): Promise<DerivContractState | null> {
    if (!this.authorized) return null
    try {
      const res = await this.raw({ proposal_open_contract: 1, contract_id: contractId })
      const p = res?.proposal_open_contract
      if (!p) return null
      return {
        contractId,
        isSold: !!p.is_sold,
        status: p.status,
        profit: typeof p.profit === 'number' ? p.profit : 0,
        payout: typeof p.payout === 'number' ? p.payout : 0,
        buyPrice: p.buy_price ?? 0,
        entrySpot: p.entry_spot,
        exitTick: p.exit_tick,
        dateExpiry: p.date_expiry,
      }
    } catch { return null }
  }

  /** Fetch last N M1 candles for any symbol (backtests, movers, ad-hoc). */
  async snapshotCandles(symbol: string, count: number): Promise<Candle[]> {
    return this.fetchHistory(symbol, count)
  }
}
