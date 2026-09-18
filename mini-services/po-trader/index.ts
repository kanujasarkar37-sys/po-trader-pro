// ─── PO Trader Mini-Service (port 3030) ─────────────────────────────────────
// Orchestrates: Pocket Option live connection OR market simulation, candle
// management, signal engine, auto-trade bot, trade settlement, backtests,
// persistence to the Next.js API, and the socket.io bridge to the frontend.

import { createServer } from 'http'
import { Server } from 'socket.io'
import type { AssetInfo, BotConfig, Candle, ServiceStatus, Signal, TradeRecord } from './src/types'
import { DEFAULT_CONFIG } from './src/types'
import { PocketOptionClient } from './src/pocket-option'
import { MarketSimulator } from './src/simulator'
import { CandleManager } from './src/candle-manager'
import { analyze, nextCandleOpen } from './src/signal-engine'
import { backtest, type BacktestResult } from './src/backtest'
import { calendarSnapshot, redZone, type CalendarSnapshot } from './src/calendar'
import { TelegramBridge } from './src/telegram'
import {
  ASSET_UNIVERSE, assetName, assetCategory, assetDigits, DEFAULT_PAYOUT,
} from './src/assets'

const PORT = 3030
// Next.js API base for persistence — env-overridable so the consolidated
// production server (server.ts) can point the engine at the shared port
const NEXT_API = process.env.ENGINE_NEXT_API ?? 'http://localhost:3000/api'
const MAX_CANDLES = 2000
const SCAN_CANDLES = 500
const CODE_VERSION = 'v9-accuracy'
const COOLDOWN_LOSSES = 2 // consecutive losses that trigger a cooldown
const COOLDOWN_MS = 3 * 60 * 1000 // 3-minute per-asset cooldown
const MOVERS_LOOKBACK = 15 // candles (~15 min) for top-movers ranking
const ADAPTIVE_MIN_TRADES = 8 // minimum settled bot trades before tuning an asset
const ADAPTIVE_MIN_BIN = 4 // minimum trades inside a confidence bin to trust it
const ADAPTIVE_RECOMPUTE_MS = 30_000 // throttle between recomputes

// ═══════════════════════════ Trading Engine ═══════════════════════════════

class TradingEngine {
  io: Server | null = null
  mode: 'disconnected' | 'live' | 'simulation' = 'disconnected'
  config: BotConfig = { ...DEFAULT_CONFIG }
  candles = new CandleManager(MAX_CANDLES)
  assets = new Map<string, AssetInfo>()
  po = new PocketOptionClient()
  sim = new MarketSimulator()
  accountType: 'demo' | 'real' = 'demo'
  balances: { demo: number | null; real: number | null } = { demo: null, real: null }
  simBalance = { demo: 10000, real: 1000 }
  trades: TradeRecord[] = []
  signals: Signal[] = []
  botRunning = false
  botStats = { wins: 0, losses: 0, draws: 0, profit: 0, trades: 0, sessionStart: 0 }
  mgSteps = new Map<string, number>()
  consecLosses = new Map<string, number>()
  cooldownUntil = new Map<string, number>()
  cooldownLogged = new Set<string>()
  pendingSignals: Signal[] = []
  logs: { ts: number; msg: string }[] = []
  chartAsset = 'EURUSD_otc'
  newsBias: Record<string, number> | null = null
  newsUpdatedAt: number | null = null
  highImpactNews = false
  // v6: per-asset adaptive thresholds — learned from settled bot trades
  adaptive = new Map<string, { threshold: number; wr: number; trades: number; adjustedAt: number }>()
  private adaptiveDirty = true
  private lastAdaptiveAt = 0
  calendar: CalendarSnapshot | null = null
  private redZoneLogged = 0
  newsTimer: ReturnType<typeof setInterval> | null = null
  botTimer: ReturnType<typeof setInterval> | null = null
  moversTimer: ReturnType<typeof setInterval> | null = null
  // daily risk manager state (resets at local midnight)
  dayKey = ''
  dayProfit = 0
  dayLimitHit: 'loss' | 'target' | null = null
  private lastScanBoundary = 0
  private nextEntryAt = 0
  requestId = Math.floor(Math.random() * 100000)
  tradeIdCounter = 0
  // v8: Telegram bridge — remote commands + outbound alerts
  tg = new TelegramBridge()

  constructor() {
    this.initAssets()
    this.wireLive()
    this.wireSim()
    // host adapter: engine surface exposed to the Telegram bridge
    this.tg.boot({
      startBot: () => this.startBot(),
      stopBot: (reason?: string) => this.stopBot(reason),
      snapshot: () => this.snapshot(),
      balanceSnapshot: () => this.balanceSnapshot(),
      statsSnapshot: () => this.statsSnapshot(),
      latestSignals: () => this.signals,
      latestTrades: () => this.trades,
      log: (m: string) => this.log(m),
      broadcast: (e: string, p: unknown) => this.broadcast(e, p),
    })
  }

  // ─── Assets ────────────────────────────────────────────────────────────
  initAssets() {
    for (const a of ASSET_UNIVERSE) {
      this.assets.set(a.asset, {
        asset: a.asset, name: a.name, category: a.category,
        payout: a.payout, open: true, price: a.basePrice,
      })
    }
  }

  ingestUpdateAssets(payload: unknown) {
    // Handles multiple observed shapes: array of objects, {assets:[...]},
    // or object keyed by id → {asset, payout, ...}
    let list: any[] = []
    if (Array.isArray(payload)) list = payload
    else if (payload && typeof payload === 'object') {
      const p = payload as Record<string, any>
      if (Array.isArray(p.assets)) list = p.assets
      else if (Array.isArray(p.symbol)) list = p.symbol
      else {
        list = Object.values(p).filter(v => v && typeof v === 'object' && (v.asset || v.symbol))
      }
    }
    for (const item of list) {
      try {
        const sym: string | undefined = item.asset ?? item.symbol ?? item.name
        if (typeof sym !== 'string' || !sym) continue
        const info = this.assets.get(sym)
        const payout = typeof item.payout === 'number' ? item.payout : undefined
        const open = typeof item.isavailable === 'number' ? item.isavailable === 1
          : typeof item.open === 'boolean' ? item.open : undefined
        if (info) {
          if (payout) info.payout = payout
          if (open !== undefined) info.open = open
        } else if (assetCategory(sym) || payout) {
          this.assets.set(sym, {
            asset: sym, name: assetName(sym), category: (assetCategory(sym) as AssetInfo['category']) ?? 'otc',
            payout: payout ?? DEFAULT_PAYOUT, open: open ?? true,
          })
        }
      } catch { /* skip malformed entry */ }
    }
    this.broadcast('assets', this.assetList())
  }

  assetList(): AssetInfo[] {
    return Array.from(this.assets.values()).map(a => ({
      ...a,
      price: this.candles.lastPrice(a.asset) || a.price,
    }))
  }

  payoutOf(asset: string): number {
    return this.assets.get(asset)?.payout ?? DEFAULT_PAYOUT
  }

  // ─── Live mode wiring ──────────────────────────────────────────────────
  wireLive() {
    this.po.on('log', (msg: string) => this.log(`[LIVE] ${msg}`))
    this.po.on('auth', (account) => {
      this.mode = 'live'
      this.accountType = account
      this.log(`Authenticated — ${account.toUpperCase()} account`)
      this.po.changeBalance(this.config.demoMode ? 'demo' : 'real')
      this.broadcast('state', this.snapshot())
    })
    this.po.on('authFail', (reason) => {
      this.log(`Auth failed: ${reason}`)
      this.broadcast('state', this.snapshot())
    })
    this.po.on('balance', (balance: number, isDemo: boolean) => {
      if (isDemo) this.balances.demo = balance
      else this.balances.real = balance
      this.broadcast('balance', this.balanceSnapshot())
    })
    this.po.on('tick', (asset: string, price: number) => {
      const info = this.assets.get(asset)
      if (info) info.price = price
      this.candles.tick(asset, price)
      this.throttledPriceEmit(asset, price)
    })
    this.po.on('candles', (asset: string, data: [number, number, number, number, number][]) => {
      const before = this.candles.count(asset)
      this.candles.mergeHistory(asset, data)
      this.resolveBackfill(asset)
      if (this.candles.count(asset) !== before || before === 0) {
        if (this.chartAsset === asset) this.emitCandles(asset, 400)
      }
    })
    this.po.on('assets', (payload) => this.ingestUpdateAssets(payload))
    this.po.on('orderOpened', (data) => this.onOrderOpened(data))
    this.po.on('orderFailed', (data) => {
      this.log(`Order failed: ${JSON.stringify(data).slice(0, 200)}`)
      this.broadcast('trade:failed', data)
    })
    this.po.on('closed', (reason) => {
      if (this.mode === 'live') {
        this.mode = 'disconnected'
        this.log(`Live connection closed (${reason})`)
        if (this.botRunning) this.stopBot('Connection lost')
        this.broadcast('state', this.snapshot())
      }
    })
  }

  // ─── Simulation mode wiring ─────────────────────────────────────────────
  wireSim() {
    this.sim.onTick = (asset, price) => {
      const info = this.assets.get(asset)
      if (info) info.price = price
      this.candles.tick(asset, price)
      this.throttledPriceEmit(asset, price)
    }
    // v7: notify clients when a candle closes so the chart stays gap-free
    // (previously only the forming candle streamed — closed candles went stale
    //  client-side, which broke time→index mapping for trade markers)
    this.candles.onClose = (asset, candle) => {
      if (asset === this.chartAsset) this.broadcast('candle:closed', { asset, candle })
    }
  }

  startSimulation() {
    if (this.mode === 'simulation') return
    this.po.close('switching to simulation')
    this.mode = 'simulation'
    this.accountType = this.config.demoMode ? 'demo' : 'real'
    this.sim.start()
    // seed history for all assets
    for (const a of this.assets.keys()) {
      const hist = this.sim.history(a, a === this.chartAsset ? MAX_CANDLES : SCAN_CANDLES)
      this.candles.seed(a, hist)
    }
    this.log('Simulation started — synthetic market feed active')
    this.broadcast('state', this.snapshot())
    this.emitCandles(this.chartAsset, 400)
    this.broadcast('balance', this.balanceSnapshot())
  }

  /** Reset simulated account balances to the $10,000 demo / $1,000 real defaults. */
  resetSimBalance() {
    if (this.mode !== 'simulation') return
    this.simBalance = { demo: 10000, real: 1000 }
    this.log('Simulation balance reset — demo $10,000 / real $1,000')
    this.broadcast('balance', this.balanceSnapshot())
    this.broadcast('stats', this.statsSnapshot())
  }

  // ─── Connection control ─────────────────────────────────────────────────
  connectLive(ssid: string, region: string) {
    this.sim.stop()
    this.config.ssid = ssid
    this.config.serverRegion = region
    this.po.connect(ssid, region)
    this.broadcast('state', this.snapshot())
    this.saveConfig()
  }

  disconnect() {
    this.po.close('user disconnect')
    this.sim.stop()
    this.mode = 'disconnected'
    if (this.botRunning) this.stopBot('Disconnected')
    this.log('Disconnected')
    this.broadcast('state', this.snapshot())
  }

  setAccount(account: 'demo' | 'real') {
    this.accountType = account
    this.config.demoMode = account === 'demo'
    if (this.mode === 'live') this.po.changeBalance(account)
    this.log(`Switched to ${account.toUpperCase()} account`)
    this.broadcast('balance', this.balanceSnapshot())
    this.broadcast('state', this.snapshot())
    this.saveConfig()
  }

  // ─── Chart subscription ────────────────────────────────────────────────
  setChartAsset(asset: string) {
    if (!this.assets.has(asset)) return
    this.chartAsset = asset
    if (this.mode === 'live') {
      this.po.changeSymbol(asset, 60)
      this.backfill(asset, MAX_CANDLES)
    } else if (this.mode === 'simulation') {
      if (this.candles.count(asset) < SCAN_CANDLES) {
        this.candles.seed(asset, this.sim.history(asset, MAX_CANDLES))
      }
    }
    this.emitCandles(asset, 400)
  }

  // ─── Live candle backfill (chunked load_history_period) ────────────────
  private backfillRequests = new Map<string, { target: number; pending: boolean }>()

  backfill(asset: string, target: number) {
    if (this.mode !== 'live') return
    const current = this.candles.count(asset)
    if (current >= target) return
    const state = this.backfillRequests.get(asset) ?? { target, pending: false }
    state.target = Math.max(state.target, target)
    if (state.pending) { this.backfillRequests.set(asset, state); return }
    state.pending = true
    this.backfillRequests.set(asset, state)
    const nowTs = Math.floor(Date.now() / 1000)
    const oldest = this.candles.oldestTs(asset) ?? nowTs
    const offset = Math.min(7200, (oldest - (nowTs - target * 60)) * 60 + 720)
    this.po.loadHistory(asset, oldest, Math.max(600, offset), 60)
    this.log(`Backfilling ${asset}: ${current}/${target} candles…`)
  }

  private resolveBackfill(asset: string) {
    const state = this.backfillRequests.get(asset)
    if (!state) return
    const count = this.candles.count(asset)
    if (count >= Math.min(state.target, MAX_CANDLES)) {
      state.pending = false
      this.backfillRequests.delete(asset)
      this.log(`${asset}: ${count} candles loaded`)
      if (this.chartAsset === asset) this.emitCandles(asset, 400)
      return
    }
    // continue backfilling from the oldest candle
    const oldest = this.candles.oldestTs(asset)
    if (oldest) {
      this.po.loadHistory(asset, oldest, 7200, 60)
    }
  }

  // ─── Price emit throttling ──────────────────────────────────────────────
  private priceEmitAt = new Map<string, number>()
  private throttledPriceEmit(asset: string, price: number) {
    const now = Date.now()
    const last = this.priceEmitAt.get(asset) ?? 0
    if (now - last < 400) return
    if (asset === this.chartAsset || this.isScanAsset(asset)) {
      this.priceEmitAt.set(asset, now)
      this.broadcast('price', { asset, price })
    }
  }

  isScanAsset(asset: string): boolean {
    return this.config.selectedAssets.includes(asset)
  }

  // ─── Balance ────────────────────────────────────────────────────────────
  balanceSnapshot() {
    const balance = this.mode === 'simulation'
      ? this.simBalance[this.accountType]
      : this.balances[this.accountType] ?? 0
    return {
      balance, accountType: this.accountType, mode: this.mode,
      demoBalance: this.mode === 'simulation' ? this.simBalance.demo : this.balances.demo,
      realBalance: this.mode === 'simulation' ? this.simBalance.real : this.balances.real,
    }
  }

  adjustSimBalance(delta: number) {
    if (this.mode !== 'simulation') return
    this.simBalance[this.accountType] = Math.max(0, this.simBalance[this.accountType] + delta)
    this.broadcast('balance', this.balanceSnapshot())
  }

  currentBalance(): number {
    const snap = this.balanceSnapshot()
    return snap.balance ?? 0
  }

  // ─── Signals ────────────────────────────────────────────────────────────
  // v6 — per-asset adaptive threshold: the base config threshold is the floor;
  // assets whose live results underperform get a raised bar, overachievers get
  // a small discount. Recomputed from settled bot trades (DB-warmed at boot).
  effectiveThreshold(asset: string): number {
    if (!this.config.adaptiveThresholds) return this.config.minConfidence
    const a = this.adaptive.get(asset)
    return a ? a.threshold : this.config.minConfidence
  }

  adaptiveList() {
    return Array.from(this.adaptive.entries()).map(([asset, a]) => ({
      asset, threshold: a.threshold, baseThreshold: this.config.minConfidence,
      winRate: a.wr, sampleSize: a.trades, lastAdjustedAt: a.adjustedAt,
    }))
  }

  recomputeAdaptive(reason = 'update'): void {
    if (!this.config.adaptiveThresholds) {
      if (this.adaptive.size) { this.adaptive.clear(); this.broadcast('adaptive', { reason, list: [] }) }
      return
    }
    const base = this.config.minConfidence
    const breakeven = 100 / (100 + DEFAULT_PAYOUT) * 100 // ~52.1% at 92% payout
    const byAsset = new Map<string, TradeRecord[]>()
    for (const t of this.trades) {
      if (t.source !== 'bot' || t.status === 'open' || t.status === 'draw' || !t.confidence) continue
      const list = byAsset.get(t.asset) ?? []
      list.push(t); byAsset.set(t.asset, list)
    }
    for (const [asset, list] of byAsset) {
      const decided = list.length
      if (decided < ADAPTIVE_MIN_TRADES) { this.adaptive.delete(asset); continue }
      const winsOf = (subset: TradeRecord[]) => {
        const w = subset.filter(t => t.status === 'win').length
        const l = subset.filter(t => t.status === 'loss').length
        return { w, l, wr: w + l > 0 ? (w / (w + l)) * 100 : 0 }
      }
      const overall = winsOf(list)
      let chosen = base
      // walk up in +5 steps until the surviving subset clears breakeven + 2pp
      for (const thr of [base + 5, base + 10, base + 15]) {
        const subset = list.filter(t => t.confidence >= thr)
        const s = winsOf(subset)
        if (s.w + s.l >= ADAPTIVE_MIN_BIN && s.wr >= breakeven + 2) { chosen = thr; break }
      }
      // proven loser with no rescue bin → max caution (base + 15)
      if (chosen === base && overall.wr < breakeven && decided >= ADAPTIVE_MIN_TRADES) chosen = base + 15
      // overachiever discount: strong WR across a decent sample → trust it more
      if (chosen === base && overall.wr >= 62 && decided >= 10 && base > 55) {
        const lower = list.filter(t => t.confidence >= base - 5)
        const s = winsOf(lower)
        if (s.w + s.l >= ADAPTIVE_MIN_BIN && s.wr >= breakeven + 4) chosen = base - 5
      }
      chosen = Math.max(50, Math.min(90, Math.round(chosen)))
      const prev = this.adaptive.get(asset)
      if (!prev || prev.threshold !== chosen) {
        if (prev) {
          this.log(`🎯 ADAPTIVE ${asset}: threshold ${prev.threshold}% → ${chosen}% (WR ${Math.round(overall.wr)}% over ${decided} trades${chosen > base ? ' — underperforming, raising bar' : chosen < base ? ' — overachieving, easing bar' : ''})`)
        }
        this.adaptive.set(asset, { threshold: chosen, wr: Math.round(overall.wr), trades: decided, adjustedAt: Date.now() })
      } else {
        this.adaptive.set(asset, { ...prev, wr: Math.round(overall.wr), trades: decided })
      }
    }
    for (const asset of Array.from(this.adaptive.keys())) {
      if (!byAsset.has(asset)) this.adaptive.delete(asset)
    }
    this.adaptiveDirty = false
    this.lastAdaptiveAt = Date.now()
    this.broadcast('adaptive', { reason, list: this.adaptiveList() })
  }

  refreshCalendar(): void {
    this.calendar = calendarSnapshot()
    this.broadcast('calendar', this.calendar)
  }

  newsBiasForAsset(asset: string): number | null {
    if (!this.newsBias) return null
    const cur = asset.toUpperCase()
    const get = (c: string) => this.newsBias?.[c] ?? 0
    let bias = 0, parts = 0
    if (cur.includes('EUR')) { bias += get('EUR'); parts++ }
    if (cur.includes('USD')) { bias -= get('USD'); parts++ }
    if (cur.includes('GBP')) { bias += get('GBP'); parts++ }
    if (cur.includes('JPY')) { bias += get('JPY'); parts++ }
    if (cur.includes('AUD')) { bias += get('AUD'); parts++ }
    if (cur.includes('CAD')) { bias += get('CAD'); parts++ }
    if (cur.includes('CHF')) { bias += get('CHF'); parts++ }
    if (cur.includes('NZD')) { bias += get('NZD'); parts++ }
    if (cur.includes('BTC')) { bias += get('CRYPTO'); parts++ }
    if (cur.includes('ETH')) { bias += get('CRYPTO'); parts++ }
    if (cur.includes('XAU') || cur.includes('GOLD')) { bias += get('GOLD'); parts++ }
    if (cur.includes('OIL') || cur.includes('BRENT')) { bias += get('OIL'); parts++ }
    return parts ? Math.max(-1, Math.min(1, bias / Math.sqrt(parts))) : null
  }

  scanAsset(asset: string): Signal | null {
    const window = this.candles.analysisWindow(asset)
    if (window.length < 120) {
      if (this.mode === 'live') this.backfill(asset, SCAN_CANDLES)
      return null
    }
    const bias = this.newsBiasForAsset(asset)
    // v9: feed the asset's realised bot win-rate into the edge gate — the
    // engine stops trading pairs whose live results disprove the model
    const ad = this.adaptive.get(asset)
    const assetWinRate = ad && ad.trades >= 12 ? { wr: ad.wr, trades: ad.trades } : null
    const { signal } = analyze(window, asset, this.payoutOf(asset), {
      minConfidence: this.effectiveThreshold(asset),
      expirySeconds: this.config.expirySeconds,
      newsBias: bias,
      useNewsFilter: this.config.newsFilter,
      assetWinRate,
    })
    return signal
  }

  registerSignal(signal: Signal) {
    this.signals.push(signal)
    if (this.signals.length > 100) this.signals.shift()
    this.broadcast('signal', signal)
    this.tg.notifySignal(signal)
    // persist notable signals (indicators JSON carries the full v8 breakdown:
    // component scores + reasons + regime + price — used by the trade-detail dialog)
    if (signal.confidence >= 60) {
      this.postToNext('/signals', {
        asset: signal.asset, direction: signal.direction, confidence: signal.confidence,
        expirySeconds: signal.expirySeconds,
        indicators: JSON.stringify({
          ...signal.components,
          _reasons: signal.reasons,
          _regime: signal.regime,
          _price: signal.price,
          _payout: signal.payout,
        }),
        acted: signal.acted,
      }).catch(() => {})
    }
  }

  // ─── Daily risk manager ──────────────────────────────────────────────
  // Tracks realized P/L for the current local day across ALL trades (bot +
  // manual). When dailyStopLoss / dailyProfitTarget (config, $) is breached
  // the bot halts itself with a clear reason — protecting real accounts from
  // runaway sessions. 0 disables a limit.
  private ensureDayRolled() {
    const key = new Date().toISOString().slice(0, 10)
    if (key !== this.dayKey) {
      this.dayKey = key
      this.dayProfit = 0
      this.dayLimitHit = null
    }
  }

  dailyPnl(): number {
    this.ensureDayRolled()
    // recompute from settled trades opened today (robust across restarts)
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    let sum = 0
    for (const t of this.trades) {
      if (t.status !== 'open' && t.openTime >= startOfDay.getTime()) sum += t.profit
    }
    this.dayProfit = Math.round(sum * 100) / 100
    return this.dayProfit
  }

  private checkDailyLimits(): 'loss' | 'target' | null {
    const pnl = this.dailyPnl()
    if (this.config.dailyStopLoss > 0 && pnl <= -Math.abs(this.config.dailyStopLoss)) return 'loss'
    if (this.config.dailyProfitTarget > 0 && pnl >= Math.abs(this.config.dailyProfitTarget)) return 'target'
    return null
  }

  // ─── Bot loop ───────────────────────────────────────────────────────────
  startBot() {
    if (this.mode === 'disconnected') {
      this.log('Cannot start bot: not connected')
      return false
    }
    this.ensureDayRolled()
    const preHit = this.checkDailyLimits()
    if (preHit) {
      const pnl = this.dailyPnl()
      this.log(`⛔ Cannot start — daily ${preHit === 'loss' ? 'stop-loss' : 'profit target'} already ${preHit === 'loss' ? 'hit' : 'reached'} (${pnl >= 0 ? '+' : ''}${pnl}$ today). Adjust the limit to continue.`)
      return false
    }
    this.botRunning = true
    this.botStats = { wins: 0, losses: 0, draws: 0, profit: 0, trades: 0, sessionStart: Date.now() }
    this.pendingSignals = []
    this.log('🤖 Auto-trade bot STARTED')
    this.broadcast('bot:status', { running: true })
    this.tg.notifyBotStatus(true)
    if (!this.botTimer) {
      this.botTimer = setInterval(() => this.botTick(), 1000)
    }
    return true
  }

  stopBot(reason?: string) {
    this.botRunning = false
    this.pendingSignals = []
    this.log(`🛑 Auto-trade bot STOPPED${reason ? ` — ${reason}` : ''}`)
    this.broadcast('bot:status', { running: false, reason })
    this.tg.notifyBotStatus(false, reason)
    if (this.botTimer && this.mode === 'disconnected') {
      clearInterval(this.botTimer)
      this.botTimer = null
    }
  }

  private botTick() {
    if (!this.botRunning) return
    const nowMs = Date.now()
    const periodMs = this.config.expirySeconds * 1000
    const phaseMs = nowMs % periodMs

    // daily risk guard (cheap check every tick — catches manual trades too)
    this.ensureDayRolled()
    const hit = this.checkDailyLimits()
    if (hit) {
      const pnl = this.dailyPnl()
      this.dayLimitHit = hit
      this.stopBot(hit === 'loss'
        ? `DAILY STOP-LOSS HIT (${pnl}$ realized today)`
        : `DAILY PROFIT TARGET REACHED (+${pnl}$ today — bank it!)`)
      return
    }

    // scan phase — compute signals on the nearly-complete candle (3s window
    // before the boundary; epoch-time based so timer drift can't skip it)
    if (phaseMs >= periodMs - 3000) {
      // next candle open = start of current period + one period (no ceil fudge)
      const boundaryMs = Math.floor(nowMs / periodMs) * periodMs + periodMs
      if (this.lastScanBoundary !== boundaryMs) {
        this.lastScanBoundary = boundaryMs
        this.runScan(boundaryMs)
      }
    }
    // entry phase — execute pending signals once the boundary is reached
    if (this.nextEntryAt > 0 && nowMs >= this.nextEntryAt) {
      this.nextEntryAt = 0
      this.executePending()
    }
    // settle expired trades
    this.settleDueTrades()
    // v6: adaptive thresholds recompute (throttled, on-change after settlements)
    if (this.adaptiveDirty && nowMs - this.lastAdaptiveAt > ADAPTIVE_RECOMPUTE_MS) {
      this.recomputeAdaptive()
    }
  }

  private runScan(boundaryMs: number) {
    // red-zone guard: pause entries entirely around scheduled market shocks
    const rz = redZone()
    if (rz && this.config.newsFilter) {
      if (Date.now() - this.redZoneLogged > 60_000) {
        this.redZoneLogged = Date.now()
        this.log(`⛔ RED ZONE — ${rz.name} · skipping entries this cycle (whipsaw avoidance)`)
      }
      this.broadcast('scan', {
        ts: Date.now(), scanned: this.config.selectedAssets.length, signals: 0,
        threshold: this.config.minConfidence, redZone: rz.name, best: null,
      })
      this.pendingSignals = []
      return
    }
    // freshen data in live mode
    if (this.mode === 'live') {
      for (const a of this.config.selectedAssets) {
        const nowTs = Math.floor(Date.now() / 1000)
        if (this.candles.count(a) < SCAN_CANDLES) this.backfill(a, SCAN_CANDLES)
        else this.po.loadHistory(a, nowTs, 300, 60)
      }
    }
    const newsBlock = this.config.newsFilter && this.highImpactNews
    if (newsBlock) {
      this.log('⚠ High-impact news window — raising confidence bar by +5% this cycle')
    }
    const found: Signal[] = []
    let bestAsset = '', bestConf = 0, bestDir: 'call' | 'put' = 'call', scanned = 0
    for (const asset of this.config.selectedAssets) {
      scanned++
      // per-asset cooldown after consecutive losses (risk management)
      const cd = this.cooldownUntil.get(asset) ?? 0
      if (Date.now() < cd) {
        if (!this.cooldownLogged.has(asset)) {
          this.cooldownLogged.add(asset)
          this.log(`⏸ ${asset} in cooldown until ${new Date(cd).toLocaleTimeString([], { hour12: false })} — skipping scan`)
        }
        continue
      } else if (this.cooldownLogged.has(asset)) {
        this.cooldownLogged.delete(asset) // cooldown over — allow future logging
      }
      const signal = this.scanAsset(asset)
      if (signal) {
        if (newsBlock && signal.confidence < this.config.minConfidence + 5) continue
        signal.entryAt = boundaryMs
        signal.expiresAt = boundaryMs + this.config.expirySeconds * 1000
        this.registerSignal(signal)
        found.push(signal)
      }
      // track best confidence across scan for telemetry
      const win = this.candles.analysisWindow(asset)
      if (win.length >= 120) {
        const res = analyze(win, asset, this.payoutOf(asset), {
          minConfidence: 101, // never emit; we only read the score
          expirySeconds: this.config.expirySeconds,
        })
        const conf = Math.min(95, Math.round(Math.abs(res.score) * 1.18))
        if (conf > bestConf) { bestConf = conf; bestAsset = asset; bestDir = res.score > 0 ? 'call' : 'put' }
      }
    }
    this.broadcast('scan', {
      ts: Date.now(), scanned, signals: found.length, threshold: this.config.minConfidence,
      best: bestAsset ? { asset: bestAsset, confidence: bestConf, direction: bestDir } : null,
    })
    if (found.length) {
      this.pendingSignals = found
      this.nextEntryAt = boundaryMs
      this.log(`Scan complete: ${found.length} signal(s) — ${found.map(s => `${s.asset} ${s.direction.toUpperCase()} ${s.confidence}%`).join(' | ')} · entering at ${new Date(boundaryMs).toLocaleTimeString([], { hour12: false })}`)
    } else {
      this.pendingSignals = []
    }
  }

  private executePending() {
    if (!this.pendingSignals.length) return
    if (!this.botRunning) { this.pendingSignals = []; return }
    const openCount = this.trades.filter(t => t.status === 'open').length
    let slots = this.config.maxConcurrent - openCount
    if (slots <= 0) {
      this.log('Max concurrent trades reached — skipping entries')
      this.pendingSignals = []
      return
    }
    if (this.botStats.trades >= this.config.maxTrades) {
      this.stopBot('Max trades reached')
      return
    }
    for (const sig of this.pendingSignals) {
      if (slots <= 0) break
      if (Date.now() - sig.entryAt > 5000) continue // stale
      this.placeTrade(sig.asset, sig.direction, this.botAmount(sig.asset, sig.confidence), sig.expirySeconds, 'bot', sig.confidence, sig)
      sig.acted = true
      slots--
    }
    this.pendingSignals = []
  }

  private botAmount(asset: string, confidence = 0): number {
    let amount = this.config.tradeAmount
    if (this.config.martingale) {
      const step = this.mgSteps.get(asset) ?? 0
      if (step > 0) amount = this.config.tradeAmount * Math.pow(this.config.mgFactor, Math.min(step, this.config.mgMaxSteps))
    } else if (this.config.dynamicStake && confidence > 0) {
      // Kelly-lite confidence boost: scale the base stake with the edge above
      // the entry threshold, modulated by payout. Conservative: at most ×2.5
      // the base stake even for 95% confidence at 92% payout.
      const payout = this.payoutOf(asset)
      const edge = Math.max(0, confidence - this.config.minConfidence) // 0..30
      const boost = 1 + (edge / 100) * (payout / 40) // e.g. conf 85 / thr 65 / payout 92 → ×1.46
      amount = this.config.tradeAmount * Math.min(2.5, Math.max(1, boost))
    }
    return Math.round(amount * 100) / 100
  }

  // ─── Trades ─────────────────────────────────────────────────────────────
  placeTrade(asset: string, direction: 'call' | 'put', amount: number, expirySeconds: number, source: 'bot' | 'manual', confidence = 0, signal?: Signal): TradeRecord | null {
    if (this.mode === 'disconnected') {
      this.log('Cannot trade: not connected')
      return null
    }
    const price = this.candles.lastPrice(asset)
    if (!isFinite(price)) {
      this.log(`Cannot trade ${asset}: no price data`)
      return null
    }
    if (this.currentBalance() < amount) {
      this.log(`Insufficient balance for ${amount} trade`)
      if (this.botRunning) this.stopBot('Insufficient balance')
      return null
    }
    const requestId = ++this.requestId
    const trade: TradeRecord = {
      id: `t-${Date.now()}-${++this.tradeIdCounter}`,
      asset, direction, amount,
      payout: this.payoutOf(asset),
      expirySeconds,
      openPrice: price,
      openTime: Date.now(),
      status: 'open',
      profit: 0,
      confidence,
      isDemo: this.accountType === 'demo',
      requestId: String(requestId),
      source,
      // v8: signal snapshot so the trade-detail dialog can show the full breakdown
      signal: signal ? { components: signal.components, reasons: signal.reasons, regime: signal.regime } : undefined,
    }
    this.trades.push(trade)
    if (this.trades.length > 300) this.trades.shift()
    this.broadcast('trade:opened', trade)
    this.tg.notifyTradeOpened(trade)
    this.postToNext('/trades', {
      id: trade.id, asset, direction, amount, payout: trade.payout,
      expirySeconds, openPrice: price, openTime: new Date(trade.openTime).toISOString(),
      status: 'open', confidence, isDemo: trade.isDemo, requestId: trade.requestId, source,
    }).catch(() => {})

    if (this.mode === 'live') {
      this.po.openOrder({
        asset, amount, action: direction,
        isDemo: this.accountType === 'demo',
        requestId, time: expirySeconds,
      })
      this.log(`📤 ${source === 'bot' ? 'BOT' : 'MANUAL'} ${direction.toUpperCase()} ${asset} $${amount} ${expirySeconds}s @ ${price}`)
    } else {
      this.log(`📤 ${source === 'bot' ? 'BOT' : 'MANUAL'} ${direction.toUpperCase()} ${asset} $${amount} ${expirySeconds}s @ ${price} (sim)`)
      this.adjustSimBalance(-0) // stake deducted at settle for simplicity
    }
    return trade
  }

  private onOrderOpened(data: Record<string, unknown>) {
    // reconcile openPrice from server if provided
    const requestId = data.requestId != null ? String(data.requestId) : null
    const trade = requestId ? this.trades.find(t => t.requestId === requestId && t.status === 'open') : null
    if (trade) {
      const serverPrice = data.openPrice ?? data.price
      if (typeof serverPrice === 'number' && serverPrice > 0) trade.openPrice = serverPrice
      const serverId = data.id ?? data.openOrderId
      if (serverId != null) trade.requestId = String(serverId)
      this.broadcast('trade:opened', trade)
      this.log(`✅ Order confirmed by server: ${trade.asset} ${trade.direction.toUpperCase()} @ ${trade.openPrice}`)
    } else {
      this.log(`Order opened (unknown): ${JSON.stringify(data).slice(0, 150)}`)
    }
  }

  settleDueTrades() {
    const now = Date.now()
    for (const trade of this.trades) {
      if (trade.status !== 'open') continue
      const due = trade.openTime + trade.expirySeconds * 1000 + 1500
      if (now < due) continue
      const settleTs = Math.floor((trade.openTime + trade.expirySeconds * 1000) / 1000)
      // ── v9 ACCURATE SETTLEMENT PRICE ──
      // The settle price must be the last tick AT/BEFORE the expiry moment:
      // • Expiry on a minute boundary → the close of the candle that ENDED at
      //   expiry, i.e. candleAt(settleTs - 1). (The pre-v9 code read
      //   candleAt(settleTs).close — the candle that OPENS at expiry — settling
      //   every trade against the price a full minute AFTER expiry.)
      // • Mid-minute expiry (manual entries, 30s expiries) → the live price at
      //   settlement time (≈ the expiry tick); late grace-settles fall back to
      //   the containing candle's close.
      let closePrice: number | undefined
      if (settleTs % 60 === 0) {
        closePrice = this.candles.candleAt(trade.asset, settleTs - 1)?.close
        if (!isFinite(closePrice ?? NaN)) {
          // boundary candle not rolled yet → forming candle close IS that price
          closePrice = this.candles.lastPrice(trade.asset)
        }
      } else if (now - due < 4000) {
        closePrice = this.candles.lastPrice(trade.asset)
      } else {
        closePrice = this.candles.candleAt(trade.asset, settleTs)?.close
        if (!isFinite(closePrice ?? NaN)) closePrice = this.candles.lastPrice(trade.asset)
      }
      if (!isFinite(closePrice ?? NaN)) {
        // no data yet — retry next tick (up to 60s grace)
        if (now - due < 60000) continue
        closePrice = trade.openPrice
      }
      this.settleTrade(trade, closePrice!)
    }
  }

  settleTrade(trade: TradeRecord, closePrice: number) {
    if (trade.direction === 'call') {
      trade.status = closePrice > trade.openPrice ? 'win' : closePrice < trade.openPrice ? 'loss' : 'draw'
    } else {
      trade.status = closePrice < trade.openPrice ? 'win' : closePrice > trade.openPrice ? 'loss' : 'draw'
    }
    trade.closePrice = closePrice
    trade.closeTime = Date.now()
    trade.profit = trade.status === 'win'
      ? Math.round(trade.amount * trade.payout / 100 * 100) / 100
      : trade.status === 'loss' ? -trade.amount : 0

    if (this.mode === 'simulation') {
      // stake was not deducted upfront; net effect: -amount on loss, +payout on win
      this.adjustSimBalance(trade.status === 'win' ? trade.profit : trade.status === 'loss' ? -trade.amount : 0)
    }

    // update stats & martingale
    if (trade.source === 'bot') {
      this.botStats.trades++
      this.botStats.wins += trade.status === 'win' ? 1 : 0
      this.botStats.losses += trade.status === 'loss' ? 1 : 0
      this.botStats.draws += trade.status === 'draw' ? 1 : 0
      this.botStats.profit = Math.round((this.botStats.profit + trade.profit) * 100) / 100
      this.adaptiveDirty = true // v6: settlement may move learned thresholds
      if (this.config.martingale) {
        const step = this.mgSteps.get(trade.asset) ?? 0
        this.mgSteps.set(trade.asset, trade.status === 'loss' ? step + 1 : 0)
      }
      // per-asset cooldown: after N consecutive losses pause that asset
      if (trade.status === 'loss') {
        const c = (this.consecLosses.get(trade.asset) ?? 0) + 1
        this.consecLosses.set(trade.asset, c)
        if (c >= COOLDOWN_LOSSES) {
          this.cooldownUntil.set(trade.asset, Date.now() + COOLDOWN_MS)
          this.consecLosses.set(trade.asset, 0)
          this.log(`⏸ ${trade.asset} lost ${c} in a row — cooling down ${COOLDOWN_MS / 60000}min`)
        }
      } else if (trade.status === 'win') {
        this.consecLosses.set(trade.asset, 0)
      }
    }
    this.broadcast('trade:settled', trade)
    this.tg.notifyTradeSettled(trade)
    const emoji = trade.status === 'win' ? '🟢' : trade.status === 'loss' ? '🔴' : '⚪'
    this.log(`${emoji} ${trade.asset} ${trade.direction.toUpperCase()} ${trade.status.toUpperCase()} ${trade.profit >= 0 ? '+' : ''}${trade.profit}$`)
    this.postToNext('/trades/settle', {
      id: trade.id, status: trade.status, profit: trade.profit,
      closePrice, closeTime: new Date(trade.closeTime).toISOString(),
    }).catch(() => {})

    // bot safety checks
    if (this.botRunning) {
      if (this.botStats.profit <= -Math.abs(this.config.stopLoss)) {
        this.stopBot(`Stop-loss hit (${this.botStats.profit}$)`)
      } else if (this.botStats.profit >= Math.abs(this.config.takeProfit)) {
        this.stopBot(`Take-profit reached (+${this.botStats.profit}$)`)
      } else if (this.botStats.trades >= this.config.maxTrades) {
        this.stopBot('Max trades reached')
      }
    }
  }

  statsSnapshot() {
    const settled = this.trades.filter(t => t.status !== 'open')
    const wins = settled.filter(t => t.status === 'win').length
    const losses = settled.filter(t => t.status === 'loss').length
    const profit = Math.round(settled.reduce((a, t) => a + t.profit, 0) * 100) / 100
    const botOnly = this.botStats
    return {
      totalTrades: settled.length, wins, losses,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
      profit, bot: botOnly,
      openTrades: this.trades.filter(t => t.status === 'open').length,
      daily: {
        pnl: this.dailyPnl(),
        stopLoss: this.config.dailyStopLoss,
        profitTarget: this.config.dailyProfitTarget,
        limitHit: this.dayLimitHit,
      },
    }
  }

  // ─── Top movers ────────────────────────────────────────────────────────
  // Ranks assets by absolute % change over the last MOVERS_LOOKBACK candles
  // (needs candle history — available for all assets in simulation, and for
  // subscribed/backfilled assets in live mode). Broadcast every 30s.
  computeMovers() {
    const movers: { asset: string; name: string; changePct: number; price: number; payout: number }[] = []
    for (const [asset, info] of this.assets) {
      const closed = this.candles.closedCandles(asset)
      if (closed.length < MOVERS_LOOKBACK + 2) continue
      const now = closed[closed.length - 1].close
      const then = closed[closed.length - 1 - MOVERS_LOOKBACK].close
      if (!isFinite(now) || !isFinite(then) || then === 0) continue
      const changePct = Math.round(((now - then) / then) * 10000) / 100
      movers.push({ asset, name: info.name, changePct, price: now, payout: info.payout })
    }
    movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    const top = movers.slice(0, 10)
    // also refresh changePct on asset list for market watch
    for (const m of movers) {
      const info = this.assets.get(m.asset)
      if (info) info.changePct = m.changePct
    }
    this.broadcast('movers', top)
  }

  // ─── News ───────────────────────────────────────────────────────────────
  async refreshNews(force = false): Promise<void> {
    if (!force && this.newsUpdatedAt && Date.now() - this.newsUpdatedAt < 15 * 60 * 1000) return
    try {
      const res = await fetch(`${NEXT_API}/news`, { method: 'GET' })
      if (!res.ok) return
      const data = await res.json() as { bias?: Record<string, number>; highImpact?: boolean }
      if (data.bias) this.newsBias = data.bias
      this.highImpactNews = !!data.highImpact
      this.newsUpdatedAt = Date.now()
      this.log(`📰 News bias updated (high impact: ${this.highImpactNews ? 'YES' : 'no'})`)
      this.broadcast('news', { bias: this.newsBias, highImpact: this.highImpactNews, updatedAt: this.newsUpdatedAt })
    } catch { /* next retry */ }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────
  async loadState() {
    // config
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`${NEXT_API}/config`)
        if (res.ok) {
          const data = await res.json() as Partial<BotConfig>
          if (data && typeof data === 'object' && Object.keys(data).length) {
            this.config = { ...DEFAULT_CONFIG, ...data }
            if (typeof this.config.selectedAssets === 'string') {
              try { this.config.selectedAssets = JSON.parse(this.config.selectedAssets) } catch { this.config.selectedAssets = [] }
            }
          }
          break
        }
      } catch {
        await sleep(3000)
      }
    }
    // open trades from DB (resume settlement)
    try {
      const res = await fetch(`${NEXT_API}/trades?status=open&limit=50`)
      if (res.ok) {
        const data = await res.json() as { trades?: any[] }
        for (const t of data.trades ?? []) {
          this.trades.push({
            id: t.id, asset: t.asset, direction: t.direction, amount: t.amount,
            payout: t.payout, expirySeconds: t.expirySeconds, openPrice: t.openPrice ?? 0,
            openTime: new Date(t.openTime).getTime(), status: 'open', profit: 0,
            confidence: t.confidence ?? 0, isDemo: t.isDemo, requestId: t.requestId ?? '',
            source: t.source === 'manual' ? 'manual' : 'bot',
          })
        }
        if (this.trades.length) this.log(`Resumed ${this.trades.length} open trade(s) from database`)
      }
    } catch { /* ignore */ }
    // v6: warm the adaptive thresholds from settled bot-trade history
    try {
      const res = await fetch(`${NEXT_API}/trades?status=settled&source=bot&limit=500`)
      if (res.ok) {
        const data = await res.json() as { trades?: any[] }
        const seen = new Set(this.trades.map(t => t.id))
        let loaded = 0
        for (const t of (data.trades ?? []).slice().reverse()) {
          if ((t.status !== 'win' && t.status !== 'loss') || seen.has(t.id)) continue
          seen.add(t.id)
          this.trades.push({
            id: t.id, asset: t.asset, direction: t.direction === 'put' ? 'put' : 'call',
            amount: t.amount ?? 1, payout: t.payout ?? 92, expirySeconds: t.expirySeconds ?? 60,
            openPrice: t.openPrice ?? 0, closePrice: t.closePrice ?? 0,
            openTime: new Date(t.openTime).getTime(), closeTime: t.closeTime ? new Date(t.closeTime).getTime() : undefined,
            status: t.status, profit: t.profit ?? 0, confidence: t.confidence ?? 0,
            isDemo: t.isDemo, requestId: t.requestId ?? '', source: 'bot',
          })
          loaded++
        }
        this.trades.sort((a, b) => a.openTime - b.openTime)
        if (this.trades.length > 300) this.trades = this.trades.slice(-300)
        if (loaded) this.log(`Adaptive memory: ${loaded} settled bot trades loaded from history`)
        this.recomputeAdaptive('boot')
      }
    } catch { /* ignore */ }
    // auto-reconnect with stored SSID
    if (this.config.ssid) {
      this.log('Found stored SSID — reconnecting to Pocket Option…')
      this.connectLive(this.config.ssid, this.config.serverRegion)
    }
    // news
    this.refreshNews(true).catch(() => {})
    if (!this.newsTimer) {
      this.newsTimer = setInterval(() => this.refreshNews().catch(() => {}), 5 * 60 * 1000)
    }
  }

  async saveConfig() {
    const payload: Record<string, unknown> = { ...this.config }
    payload.selectedAssets = JSON.stringify(this.config.selectedAssets)
    await this.postToNext('/config', payload).catch(() => {})
  }

  private postQueue: Array<{ url: string; body: unknown; tries: number }> = []
  private posting = false

  async postToNext(path: string, body: unknown) {
    this.postQueue.push({ url: `${NEXT_API}${path}`, body, tries: 0 })
    this.drainQueue()
  }

  private async drainQueue() {
    if (this.posting) return
    this.posting = true
    while (this.postQueue.length) {
      const item = this.postQueue.shift()!
      try {
        const res = await fetch(item.url, {
          method: item.url.endsWith('/config') ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        item.tries++
        if (item.tries < 3) {
          this.postQueue.push(item)
          await sleep(2000 * item.tries)
        }
      }
    }
    this.posting = false
  }

  // ─── Snapshot / broadcast ───────────────────────────────────────────────
  log(msg: string) {
    this.logs.push({ ts: Date.now(), msg })
    if (this.logs.length > 120) this.logs.shift()
    this.broadcast('log', { ts: Date.now(), msg })
    console.log(`[engine] ${msg}`)
  }

  emitCandles(asset: string, count = 400) {
    const closed = this.candles.closedCandles(asset)
    const forming = this.candles.formingCandle(asset)
    const slice = closed.slice(-count)
    this.broadcast('candles', { asset, candles: slice, forming: forming ?? null, total: closed.length })
  }

  broadcast(event: string, payload: unknown) {
    if (this.io) this.io.emit(event, payload)
  }

  snapshot(): ServiceStatus & { config: BotConfig; stats: unknown; adaptive: unknown[]; calendar: CalendarSnapshot | null; telegram: unknown } {
    return {
      mode: this.mode,
      authenticated: this.mode === 'live' ? this.po.isAuthenticated : this.mode === 'simulation',
      accountType: this.accountType,
      balance: this.balanceSnapshot().balance ?? 0,
      currency: 'USD',
      botRunning: this.botRunning,
      connectedAt: null,
      serverRegion: this.config.serverRegion,
      newsBias: this.newsBias,
      newsUpdatedAt: this.newsUpdatedAt,
      config: this.config,
      stats: this.statsSnapshot(),
      adaptive: this.adaptiveList(),
      calendar: this.calendar ?? calendarSnapshot(),
      telegram: this.tg.info(),
    }
  }
}

// ═══════════════════════════ HTTP + Socket.IO setup ═══════════════════════
// Guarded by a global singleton so `bun --hot` reloads don't spawn duplicate
// engines/intervals — the running instance is reused instead. bootEngine() is
// EXPORTED so the consolidated production server (root server.ts) can boot the
// SAME engine and attach its socket.io to the main Next.js HTTP server at
// /engine — one process, one port, no gateway needed.

const g = globalThis as typeof globalThis & {
  __PO_ENGINE__?: TradingEngine
  __PO_IO__?: Server
  __PO_BOOTED__?: boolean
  __PO_MOVERS__?: boolean
  __PO_CAL__?: boolean
}

export interface EngineBoot {
  engine: TradingEngine
  io: Server
  /** Attach the engine's socket.io to an HTTP server (consolidated prod server). */
  attach(server: ReturnType<typeof createServer>): void
}

export function bootEngine(path = '/'): EngineBoot {
  if (g.__PO_ENGINE__ && g.__PO_IO__) {
    // hot reload / re-boot: reuse the live engine (its handlers keep working)
    console.log('[re-boot] PO Trader engine reused — state preserved')
    return {
      engine: g.__PO_ENGINE__,
      io: g.__PO_IO__,
      attach: (s) => { g.__PO_IO__!.attach(s) },
    }
  }
  const engine = new TradingEngine()
  const io = new Server({
    // DO NOT change the default path '/', it is used by Caddy to forward the
    // request. The consolidated production server passes '/engine' instead.
    path,
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5e6,
  })
  engine.io = io
  g.__PO_ENGINE__ = engine
  g.__PO_IO__ = io

  io.on('connection', (socket) => {
    // initial state
    socket.emit('state', engine.snapshot())
    socket.emit('assets', engine.assetList())
    socket.emit('balance', engine.balanceSnapshot())
    socket.emit('trades:list', engine.trades.slice(-100))
    socket.emit('signals:list', engine.signals.slice(-50))
    socket.emit('adaptive', { reason: 'connect', list: engine.adaptiveList() })
    socket.emit('calendar', engine.calendar ?? calendarSnapshot())
    for (const l of engine.logs.slice(-40)) socket.emit('log', l)
    engine.emitCandles(engine.chartAsset, 400)

    // ── connection control ──
    socket.on('connect:live', (data: { ssid: string; region?: string }, ack?: (r: unknown) => void) => {
      const ssid = String(data?.ssid ?? '').trim()
      if (!ssid) { ack?.({ ok: false, error: 'SSID is empty' }); return }
      engine.connectLive(ssid, data.region ?? engine.config.serverRegion)
      ack?.({ ok: true })
    })

    socket.on('sim:start', (_data: unknown, ack?: (r: unknown) => void) => {
      engine.startSimulation()
      ack?.({ ok: true })
    })

    socket.on('sim:reset', (_data: unknown, ack?: (r: unknown) => void) => {
      if (engine.mode !== 'simulation') {
        ack?.({ ok: false, error: 'Not in simulation mode' })
        return
      }
      engine.resetSimBalance()
      ack?.({ ok: true })
    })

    socket.on('disconnect:po', () => engine.disconnect())

    socket.on('set:account', (data: { account: 'demo' | 'real' }) => {
      if (data?.account) engine.setAccount(data.account)
    })

    // ── chart / market ──
    socket.on('subscribe', (data: { asset: string }) => {
      if (data?.asset) engine.setChartAsset(data.asset)
    })

    socket.on('assets:refresh', () => {
      if (engine.mode === 'live') engine.po.send('42["subfor"]')
    })

    // ── config ──
    socket.on('config:update', (data: Partial<BotConfig>, ack?: (r: unknown) => void) => {
      if (!data || typeof data !== 'object') { ack?.({ ok: false }); return }
      const c = engine.config
      const d = data as Record<string, unknown>
      if (typeof d.tradeAmount === 'number') c.tradeAmount = Math.max(0.1, Math.min(1000, d.tradeAmount))
      if (typeof d.minConfidence === 'number') c.minConfidence = Math.max(50, Math.min(95, Math.round(d.minConfidence)))
      if (typeof d.expirySeconds === 'number') c.expirySeconds = [30, 60, 120, 300].includes(d.expirySeconds) ? d.expirySeconds : 60
      if (typeof d.maxTrades === 'number') c.maxTrades = Math.max(1, Math.min(500, Math.round(d.maxTrades)))
      if (typeof d.maxConcurrent === 'number') c.maxConcurrent = Math.max(1, Math.min(10, Math.round(d.maxConcurrent)))
      if (typeof d.martingale === 'boolean') c.martingale = d.martingale
      if (typeof d.mgFactor === 'number') c.mgFactor = Math.max(1, Math.min(4, d.mgFactor))
      if (typeof d.mgMaxSteps === 'number') c.mgMaxSteps = Math.max(1, Math.min(8, Math.round(d.mgMaxSteps)))
      if (typeof d.stopLoss === 'number') c.stopLoss = Math.max(0, d.stopLoss)
      if (typeof d.takeProfit === 'number') c.takeProfit = Math.max(0, d.takeProfit)
      if (typeof d.newsFilter === 'boolean') c.newsFilter = d.newsFilter
      if (typeof d.dailyStopLoss === 'number') c.dailyStopLoss = Math.max(0, d.dailyStopLoss)
      if (typeof d.dailyProfitTarget === 'number') c.dailyProfitTarget = Math.max(0, d.dailyProfitTarget)
      if (typeof d.dynamicStake === 'boolean') c.dynamicStake = d.dynamicStake
      if (typeof d.adaptiveThresholds === 'boolean') {
        if (d.adaptiveThresholds !== c.adaptiveThresholds) {
          c.adaptiveThresholds = d.adaptiveThresholds
          engine.recomputeAdaptive('config')
          engine.log(`🎯 Adaptive thresholds ${d.adaptiveThresholds ? 'ENABLED — per-asset bars auto-tune from live results' : 'disabled — using global threshold'}`)
        }
      }
      // adjusting limits re-arms the daily guard
      if (typeof d.dailyStopLoss === 'number' || typeof d.dailyProfitTarget === 'number') {
        engine.dayLimitHit = null
      }
      if (Array.isArray(d.selectedAssets)) c.selectedAssets = (d.selectedAssets as string[]).filter(a => typeof a === 'string').slice(0, 25)
      if (typeof d.demoMode === 'boolean' && d.demoMode !== (engine.accountType === 'demo')) {
        engine.setAccount(d.demoMode ? 'demo' : 'real')
      }
      engine.saveConfig()
      engine.broadcast('config', engine.config)
      ack?.({ ok: true, config: engine.config })
    })

    // ── bot ──
    socket.on('bot:start', (_d: unknown, ack?: (r: unknown) => void) => {
      const ok = engine.startBot()
      ack?.({ ok })
    })

    socket.on('bot:stop', () => engine.stopBot('Manual stop'))

    // ── manual trade ──
    socket.on('trade:manual', (data: { asset: string; direction: 'call' | 'put'; amount?: number; expiry?: number }, ack?: (r: unknown) => void) => {
      if (!data?.asset || !data?.direction) { ack?.({ ok: false, error: 'invalid params' }); return }
      const trade = engine.placeTrade(
        data.asset, data.direction,
        data.amount ?? engine.config.tradeAmount,
        data.expiry ?? engine.config.expirySeconds,
        'manual', 0,
      )
      ack?.({ ok: !!trade, trade })
    })

    // ── backtest ──
    socket.on('backtest:run', (data: { asset?: string; minConfidence?: number; expirySeconds?: number; count?: number }, ack?: (r: unknown) => void) => {
      const asset = data?.asset ?? engine.chartAsset
      const minConfidence = data?.minConfidence ?? engine.config.minConfidence
      const expirySeconds = data?.expirySeconds ?? engine.config.expirySeconds
      let candles = engine.candles.closedCandles(asset)
      if (candles.length < 300) {
        if (engine.mode === 'simulation') {
          engine.candles.seed(asset, engine.sim.history(asset, MAX_CANDLES))
          candles = engine.candles.closedCandles(asset)
        } else if (engine.mode === 'live') {
          engine.backfill(asset, MAX_CANDLES)
        }
      }
      if (candles.length < 300) {
        ack?.({ ok: false, error: `Not enough candles for ${asset} (${candles.length}/300). Try again in a moment.` })
        return
      }
      const result: BacktestResult = backtest(candles, asset, engine.payoutOf(asset), { minConfidence, expirySeconds })
      engine.log(`📊 Backtest ${asset}: ${result.trades} trades, ${result.winRate}% win-rate, ${result.totalProfit > 0 ? '+' : ''}${result.totalProfit}$ profit`)
      ack?.({ ok: true, result })
    })

    // ── signals scan on demand ──
    socket.on('signal:scan', (data: { asset?: string }, ack?: (r: unknown) => void) => {
      const asset = data?.asset ?? engine.chartAsset
      const sig = engine.scanAsset(asset)
      ack?.({ ok: true, signal: sig })
    })

    // ── v6: take a signal manually (one-click from the feed) ──
    socket.on('signal:take', (data: { id: string }, ack?: (r: unknown) => void) => {
      const sig = engine.signals.find(s => s.id === data?.id)
      if (!sig) { ack?.({ ok: false, error: 'signal not found' }); return }
      if (sig.acted) { ack?.({ ok: false, error: 'already taken' }); return }
      const trade = engine.placeTrade(sig.asset, sig.direction, engine.config.tradeAmount, sig.expirySeconds, 'manual', sig.confidence, sig)
      if (trade) {
        sig.acted = true
        engine.broadcast('signal:updated', sig)
        ack?.({ ok: true, trade })
      } else {
        ack?.({ ok: false, error: 'trade rejected — see engine log' })
      }
    })

    // ── v6: adaptive thresholds state ──
    socket.on('adaptive:refresh', (_d: unknown, ack?: (r: unknown) => void) => {
      engine.recomputeAdaptive('manual')
      ack?.({ ok: true, list: engine.adaptiveList() })
    })

    socket.on('news:refresh', (_d: unknown, ack?: (r: unknown) => void) => {
      engine.refreshNews(true).then(() => {
        ack?.({ ok: true, bias: engine.newsBias, highImpact: engine.highImpactNews })
      }).catch(() => ack?.({ ok: false }))
    })

    // ── v8: Telegram bridge control ──
    socket.on('tg:config', (data: Record<string, unknown> | null, ack?: (r: unknown) => void) => {
      if (data && typeof data === 'object' && Object.keys(data).length) {
        const r = engine.tg.setConfig(data as never)
        ack?.(r)
      } else {
        ack?.({ ok: true, config: engine.tg.config(), status: engine.tg.info() })
      }
    })

    socket.on('tg:test', (_d: unknown, ack?: (r: unknown) => void) => {
      engine.tg.test().then(r => ack?.(r)).catch(e => ack?.({ ok: false, error: String(e) }))
    })

    socket.on('candles:get', (data: { asset?: string; count?: number }, ack?: (r: unknown) => void) => {
      const asset = data?.asset ?? engine.chartAsset
      const closed = engine.candles.closedCandles(asset)
      const forming = engine.candles.formingCandle(asset)
      ack?.({ asset, candles: closed.slice(-(data?.count ?? 400)), forming: forming ?? null, total: closed.length })
    })
  })

  // settle loop also runs independent of bot (manual trades need settlement)
  setInterval(() => {
    if (engine.mode !== 'disconnected') engine.settleDueTrades()
  }, 2000)

  // top movers refresh (needs candle history — starts once connected)
  if (!g.__PO_MOVERS__) {
    g.__PO_MOVERS__ = true
    engine.moversTimer = setInterval(() => {
      if (engine.mode !== 'disconnected') engine.computeMovers()
    }, 30000)
  }

  // v6: market calendar broadcast (sessions + events + red zone)
  if (!g.__PO_CAL__) {
    g.__PO_CAL__ = true
    engine.refreshCalendar()
    setInterval(() => engine.refreshCalendar(), 30000)
  }

  // periodic candle emit for the chart (keeps forming candle fresh)
  setInterval(() => {
    if (engine.mode === 'disconnected') return
    const forming = engine.candles.formingCandle(engine.chartAsset)
    if (forming) engine.broadcast('candle:forming', { asset: engine.chartAsset, candle: forming })
    engine.broadcast('stats', engine.statsSnapshot())
  }, 1000)

  engine.log(`Engine booted [${CODE_VERSION}]`)
  engine.loadState().catch((e) => console.error('loadState failed:', e))
  return {
    engine,
    io,
    attach: (s) => { io.attach(s) },
  }
}

// ── Standalone mode (this file executed directly: sandbox / local dev) ──────
// Boots the engine on its own port (3030) with /health + /state endpoints.
// The consolidated production server (root server.ts) imports bootEngine()
// instead and attaches it to the main Next.js HTTP server — no port 3030.
if (import.meta.main) {
  if (g.__PO_BOOTED__ && g.__PO_ENGINE__) {
    // hot reload: reuse the live engine + listener (state preserved)
    console.log('[hot-reload] PO Trader engine reused — state preserved')
  } else {
    g.__PO_BOOTED__ = true
    const boot = bootEngine('/')

    const httpServer = createServer((req, res) => {
      // CORS + JSON for direct health checks
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/health') {
        res.end(JSON.stringify({
          ok: true, mode: boot.engine.mode, authenticated: boot.engine.mode !== 'disconnected',
          botRunning: boot.engine.botRunning, chartAsset: boot.engine.chartAsset,
        }))
        return
      }
      if (req.url === '/state') {
        res.end(JSON.stringify(boot.engine.snapshot()))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    })

    boot.attach(httpServer)
    httpServer.listen(PORT, () => {
      console.log(`PO Trader service listening on port ${PORT} [${CODE_VERSION}]`)
    })

    process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
    process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
