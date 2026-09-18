'use client'

// ─── Trader store: socket.io bridge to the po-trader mini-service ──────────

import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'
import { toast } from 'sonner'

export interface Candle { time: number; open: number; high: number; low: number; close: number }
export interface AssetInfo {
  asset: string; name: string; category: string; payout: number; open: boolean; price?: number
}
export interface SignalComponents {
  ema: number; rsi: number; stoch: number; macd: number; bollinger: number; pattern: number; sr: number; momentum: number; mtf: number; htf: number
}
export interface Signal {
  id: string; asset: string; direction: 'call' | 'put'; confidence: number
  expirySeconds: number; createdAt: number; entryAt: number; expiresAt: number
  price: number; payout: number; components: SignalComponents
  regime: 'trending' | 'ranging'; reasons: string[]; acted: boolean
}
export interface TradeRecord {
  id: string; asset: string; direction: 'call' | 'put'; amount: number; payout: number
  expirySeconds: number; openPrice: number; closePrice?: number; openTime: number
  closeTime?: number; status: 'open' | 'win' | 'loss' | 'draw'; profit: number
  confidence: number; isDemo: boolean; requestId: string; source: 'bot' | 'manual'
  signal?: { components: SignalComponents; reasons: string[]; regime: 'trending' | 'ranging' }
}
export interface BotConfig {
  ssid: string | null; serverRegion: string; demoMode: boolean; autoTrade: boolean
  tradeAmount: number; minConfidence: number; expirySeconds: number; maxTrades: number
  maxConcurrent: number; martingale: boolean; mgFactor: number; mgMaxSteps: number
  stopLoss: number; takeProfit: number; selectedAssets: string[]; newsFilter: boolean
  dailyStopLoss: number; dailyProfitTarget: number; dynamicStake: boolean
  adaptiveThresholds: boolean
}
export interface MoverInfo {
  asset: string; name: string; changePct: number; price: number; payout: number
}
export interface NewsInfo {
  bias: Record<string, number>; highImpact: boolean
  headlines: { title: string; source: string; sentiment: string }[]
  summary: string; updatedAt: number; aiAvailable?: boolean
}
export interface AdaptiveInfo {
  asset: string; threshold: number; baseThreshold: number
  winRate: number; sampleSize: number; lastAdjustedAt: number
}
export interface CalendarEvent {
  name: string; ts: number; redWindowMin: number
  kind: 'event' | 'session-open'; currencies: string; recurring: string; inMin: number
}
export interface CalendarInfo {
  sessions: { name: string; openUtc: number; closeUtc: number; active: boolean; progress: number; nextInMin: number; color: string }[]
  events: CalendarEvent[]
  redZone: { name: string; endsInMin: number } | null
  utcTime: string
  weekendFx: boolean
}
export interface TelegramConfig {
  enabled: boolean; token: string; chatId: string
  notifySignals: boolean; notifyTrades: boolean; notifyStatus: boolean
  minConfidence: number
}
export interface TelegramStatus {
  configured: boolean; polling: boolean; botUsername: string | null
  lastError: string | null; lastMessageAt: number | null
  sentCount: number; commandCount: number; startedAt: number | null
  config: TelegramConfig
}

interface TraderState {
  socket: Socket | null
  socketConnected: boolean
  mode: 'disconnected' | 'live' | 'simulation'
  authenticated: boolean
  accountType: 'demo' | 'real'
  balance: number
  demoBalance: number | null
  realBalance: number | null
  botRunning: boolean
  config: BotConfig | null
  assets: AssetInfo[]
  chartAsset: string
  candles: Candle[]
  forming: Candle | null
  candleTotal: number
  prices: Record<string, number>
  priceDirs: Record<string, 1 | -1>
  movers: MoverInfo[]
  signals: Signal[]
  trades: TradeRecord[]
  stats: {
    totalTrades: number; wins: number; losses: number; winRate: number; profit: number
    openTrades: number; bot: { wins: number; losses: number; draws: number; profit: number; trades: number }
    daily?: { pnl: number; stopLoss: number; profitTarget: number; limitHit: 'loss' | 'target' | null }
  } | null
  logs: { ts: number; msg: string }[]
  news: NewsInfo | null
  adaptive: AdaptiveInfo[]
  calendar: CalendarInfo | null
  lastScan: { ts: number; scanned: number; signals: number; threshold: number; redZone?: string; best: { asset: string; confidence: number; direction: string } | null } | null
  backtest: { running: boolean; result: Record<string, unknown> | null; error: string | null }
  analysis: { running: boolean; data: Record<string, unknown> | null; error: string | null }
  connectError: string | null
  telegram: { config: TelegramConfig | null; status: TelegramStatus | null }
  prefs: { sound: boolean; notifications: boolean }
  // actions
  init: () => void
  connectLive: (ssid: string, region: string) => void
  startSim: () => void
  resetSim: () => void
  disconnectPo: () => void
  setAccount: (a: 'demo' | 'real') => void
  setChartAsset: (a: string) => void
  updateConfig: (p: Partial<BotConfig>) => void
  startBot: () => void
  stopBot: () => void
  manualTrade: (direction: 'call' | 'put', amount: number, expiry: number) => void
  runBacktest: (p: { asset?: string; minConfidence?: number; expirySeconds?: number }) => void
  runAnalysis: (payload: Record<string, unknown>) => void
  refreshNews: () => void
  takeSignal: (id: string) => void
  saveTelegram: (p: Partial<TelegramConfig>) => void
  testTelegram: () => void
  setPrefs: (p: Partial<{ sound: boolean; notifications: boolean }>) => void
}

let priceBuffer: Record<string, number> = {}
let priceDirsBuffer: Record<string, 1 | -1> = {}
let lastPrices: Record<string, number> = {}
let priceFlusher: ReturnType<typeof setInterval> | null = null

export const useTrader = create<TraderState>((set, get) => ({
  socket: null,
  socketConnected: false,
  mode: 'disconnected',
  authenticated: false,
  accountType: 'demo',
  balance: 0,
  demoBalance: null,
  realBalance: null,
  botRunning: false,
  config: null,
  assets: [],
  chartAsset: 'EURUSD_otc',
  candles: [],
  forming: null,
  candleTotal: 0,
  prices: {},
  priceDirs: {},
  movers: [],
  signals: [],
  trades: [],
  stats: null,
  logs: [],
  news: null,
  adaptive: [],
  calendar: null,
  lastScan: null,
  backtest: { running: false, result: null, error: null },
  analysis: { running: false, data: null, error: null },
  connectError: null,
  telegram: { config: null, status: null },
  prefs: {
    // SSR-safe static defaults. The persisted values are hydrated inside
    // init() (client-only, post-hydration) — reading localStorage here at
    // store-creation time produced server≠client HTML (hydration mismatch).
    sound: true,
    notifications: false,
  },

  init: () => {
    // hydrate persisted alert prefs AFTER mount (SSR-safe — no mismatch)
    try {
      const sound = localStorage.getItem('po-sound') !== 'off' // default: on
      const notifications = localStorage.getItem('po-notif') === 'on' // default: off
      const cur = get().prefs
      if (cur.sound !== sound || cur.notifications !== notifications) {
        set({ prefs: { sound, notifications } })
      }
    } catch { /* private mode */ }
    if (get().socket) return
    // Engine connection — three supported modes:
    // 1. NEXT_PUBLIC_ENGINE_URL  → explicit full URL (e.g. http://localhost:3030
    //    for local two-process dev without a reverse proxy)
    // 2. NEXT_PUBLIC_ENGINE_PATH → same-origin path (production single-server
    //    deploy: custom server attaches the engine at /engine)
    // 3. fallback → sandbox gateway mode (XTransformPort query)
    const baseOpts: Parameters<typeof io>[1] = {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1500,
      timeout: 12000,
    }
    const engineUrl = process.env.NEXT_PUBLIC_ENGINE_URL
    const enginePath = process.env.NEXT_PUBLIC_ENGINE_PATH
    // Gateway rule: never use a port in the URL — XTransformPort query only
    let socket: Socket
    if (engineUrl) {
      socket = io(engineUrl, baseOpts)
    } else if (enginePath) {
      socket = io({ path: enginePath, ...baseOpts })
    } else if (typeof window !== 'undefined'
      && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      // plain local dev (bun run dev + bun run engine) — talk to :3030 directly
      socket = io('http://localhost:3030/', baseOpts)
    } else {
      socket = io('/?XTransformPort=3030', baseOpts)
    }
    set({ socket })

    socket.on('connect', () => set({ socketConnected: true, connectError: null }))
    socket.on('disconnect', () => set({ socketConnected: false }))
    socket.on('connect_error', () => {
      set({ socketConnected: false, connectError: 'Trading engine unreachable — retrying…' })
    })

    socket.on('state', (s: any) => set({
      mode: s.mode, authenticated: s.authenticated, accountType: s.accountType,
      botRunning: s.botRunning, config: s.config ?? get().config,
      telegram: s.telegram ? { config: s.telegram.config ?? null, status: s.telegram } : get().telegram,
    }))
    socket.on('assets', (list: AssetInfo[]) => {
      set({ assets: list })
      const cfg = get().config
      if ((!cfg?.selectedAssets || !cfg.selectedAssets.length) && list.length) {
        const pre = list.filter(a => a.category === 'otc' && a.open).slice(0, 6).map(a => a.asset)
        if (pre.length) socket.emit('config:update', { selectedAssets: pre })
      }
    })
    socket.on('balance', (b: any) => set({
      balance: b.balance ?? 0, accountType: b.accountType ?? 'demo',
      demoBalance: b.demoBalance ?? null, realBalance: b.realBalance ?? null,
    }))
    socket.on('candles', (c: any) => {
      if (c.asset === get().chartAsset) {
        set({ candles: c.candles ?? [], forming: c.forming ?? null, candleTotal: c.total ?? 0 })
      }
    })
    socket.on('candle:forming', (c: any) => {
      if (c.asset === get().chartAsset) set({ forming: c.candle })
    })
    // v7: append freshly closed candles so the chart has no time gaps
    // (the full candle list only arrives on subscribe/asset-change)
    socket.on('candle:closed', (c: { asset: string; candle: Candle }) => {
      if (c?.asset !== get().chartAsset || !c.candle) return
      set(st => {
        const list = st.candles
        const last = list.length ? list[list.length - 1] : null
        if (last && c.candle.time <= last.time) return {} // dedupe / late rollover
        return { candles: [...list.slice(-1900), c.candle] }
      })
    })
    socket.on('price', (p: { asset: string; price: number }) => {
      const prev = lastPrices[p.asset]
      if (prev != null && prev !== p.price) {
        priceDirsBuffer[p.asset] = p.price > prev ? 1 : -1
      }
      lastPrices[p.asset] = p.price
      priceBuffer[p.asset] = p.price
    })
    if (!priceFlusher) {
      priceFlusher = setInterval(() => {
        if (Object.keys(priceBuffer).length) {
          set({ prices: { ...get().prices, ...priceBuffer }, priceDirs: { ...get().priceDirs, ...priceDirsBuffer } })
          priceBuffer = {}
          priceDirsBuffer = {}
        }
      }, 250)
    }
    socket.on('signal', (s: Signal) => set(st => ({ signals: [...st.signals.slice(-80), s] })))
    socket.on('signals:list', (list: Signal[]) => set({ signals: list }))
    socket.on('trade:opened', (t: TradeRecord) => set(st => {
      const idx = st.trades.findIndex(x => x.id === t.id)
      const trades = [...st.trades]
      if (idx >= 0) trades[idx] = t; else trades.push(t)
      return { trades }
    }))
    socket.on('trade:settled', (t: TradeRecord) => set(st => {
      const idx = st.trades.findIndex(x => x.id === t.id)
      const trades = [...st.trades]
      if (idx >= 0) trades[idx] = t; else trades.push(t)
      return { trades }
    }))
    socket.on('trades:list', (list: TradeRecord[]) => set({ trades: list }))
    socket.on('stats', (stats: any) => set({ stats }))
    socket.on('movers', (movers: MoverInfo[]) => set({ movers }))
    socket.on('log', (l: { ts: number; msg: string }) => set(st => ({ logs: [...st.logs.slice(-100), l] })))
    socket.on('bot:status', (b: { running: boolean }) => set({ botRunning: b.running }))
    socket.on('config', (c: BotConfig) => set({ config: c }))
    socket.on('news', (n: any) => set({ news: n }))
    socket.on('scan', (s: any) => set({ lastScan: s }))
    socket.on('adaptive', (a: { list: AdaptiveInfo[] }) => set({ adaptive: a?.list ?? [] }))
    socket.on('calendar', (c: CalendarInfo) => set({ calendar: c }))
    socket.on('signal:updated', (s: Signal) => set(st => ({
      signals: st.signals.map(x => x.id === s.id ? s : x),
    })))
    // v8: telegram bridge status (config + live polling state)
    socket.on('tg:status', (tg: TelegramStatus) => set({ telegram: { config: tg.config ?? null, status: tg } }))
  },

  connectLive: (ssid, region) => {
    const { socket } = get()
    socket?.emit('connect:live', { ssid, region }, (r: any) => {
      if (r && !r.ok) set({ connectError: r.error ?? 'Connection failed' })
    })
  },

  startSim: () => { get().socket?.emit('sim:start', {}) },
  resetSim: () => {
    get().socket?.emit('sim:reset', {}, (r: any) => {
      if (r?.ok) toast.success('Simulated balance reset', { description: 'Demo $10,000 / real $1,000' })
      else toast.error(r?.error ?? 'Reset failed — start simulation first')
    })
  },
  disconnectPo: () => { get().socket?.emit('disconnect:po', {}) },

  setAccount: (a) => { get().socket?.emit('set:account', { account: a }) },

  setChartAsset: (a) => {
    set({ chartAsset: a, candles: [], forming: null })
    get().socket?.emit('subscribe', { asset: a })
  },

  updateConfig: (p) => {
    get().socket?.emit('config:update', p)
  },

  startBot: () => { get().socket?.emit('bot:start', {}) },
  stopBot: () => { get().socket?.emit('bot:stop', {}) },

  manualTrade: (direction, amount, expiry) => {
    get().socket?.emit('trade:manual', {
      asset: get().chartAsset, direction, amount, expiry,
    }, () => { /* result arrives via trade:opened / logs */ })
  },

  runBacktest: (p) => {
    set({ backtest: { running: true, result: null, error: null } })
    get().socket?.emit('backtest:run', p, (r: any) => {
      if (r?.ok) set({ backtest: { running: false, result: r.result, error: null } })
      else set({ backtest: { running: false, result: null, error: r?.error ?? 'Backtest failed' } })
    })
  },

  runAnalysis: (payload) => {
    set({ analysis: { running: true, data: null, error: null } })
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(d => {
        if (d?.error) set({ analysis: { running: false, data: null, error: 'AI backend unavailable — analysis failed' } })
        else set({ analysis: { running: false, data: d.analysis ?? d, error: null } })
      })
      .catch(() => set({ analysis: { running: false, data: null, error: 'AI backend unreachable' } }))
  },

  refreshNews: () => {
    fetch('/api/news').then(r => r.json()).then((n: any) => set({ news: n })).catch(() => {})
  },

  takeSignal: (id) => {
    const { socket } = get()
    socket?.emit('signal:take', { id }, (r: any) => {
      if (r?.ok) {
        const t = r.trade as TradeRecord
        toast.success(`Signal taken · ${t.asset} ${t.direction.toUpperCase()}`, {
          description: `$${t.amount} · ${t.expirySeconds}s @ ${t.openPrice} · settles at expiry`,
        })
      } else {
        toast.error(r?.error ?? 'Could not take signal')
      }
    })
  },

  saveTelegram: (p) => {
    get().socket?.emit('tg:config', p, (r: any) => {
      if (r?.ok) {
        toast.success('Telegram bridge saved', {
          description: p.enabled != null
            ? p.enabled ? 'Remote commands + alerts active' : 'Bridge disabled'
            : 'Configuration updated',
        })
      } else {
        toast.error(r?.error ?? 'Could not save Telegram config')
      }
    })
  },

  testTelegram: () => {
    get().socket?.emit('tg:test', {}, (r: any) => {
      if (r?.ok) toast.success('Test message sent', { description: 'Check your Telegram chat' })
      else toast.error(r?.error ?? 'Test failed — check token / chat ID')
    })
  },

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p }
    set({ prefs })
    if (typeof window !== 'undefined') {
      localStorage.setItem('po-sound', prefs.sound ? 'on' : 'off')
      localStorage.setItem('po-notif', prefs.notifications ? 'on' : 'off')
    }
    if (p.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  },
}))
