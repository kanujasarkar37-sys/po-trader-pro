'use client'

import { useEffect, useRef, useState } from 'react'
import { useTrader } from '@/components/trader/store'
import { Header } from '@/components/trader/Header'
import { TickerTape } from '@/components/trader/TickerTape'
import { StatsCards } from '@/components/trader/StatsCards'
import { TopMovers } from '@/components/trader/TopMovers'
import { MarketWatch } from '@/components/trader/MarketWatch'
import { SignalFeed } from '@/components/trader/SignalFeed'
import { BotPanel } from '@/components/trader/BotPanel'
import { TradePanel } from '@/components/trader/TradePanel'
import { TradesTable } from '@/components/trader/TradesTable'
import { NewsPanel } from '@/components/trader/NewsPanel'
import { CalendarPanel } from '@/components/trader/CalendarPanel'
import { AIAdvisor } from '@/components/trader/AIAdvisor'
import { BacktestPanel } from '@/components/trader/BacktestPanel'
import { AnalyticsPanel } from '@/components/trader/AnalyticsPanel'
import { ActivityLog } from '@/components/trader/ActivityLog'
import { CandleChart } from '@/components/trader/CandleChart'
import { TelegramPanel } from '@/components/trader/TelegramPanel'
import { Footer } from '@/components/trader/Footer'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CandlestickChart, Radio } from 'lucide-react'
import { beepSignal, beepWin, beepLoss, notify } from '@/components/trader/alerts'
import { cn } from '@/lib/utils'

export default function Home() {
  const {
    init, chartAsset, mode, socketConnected, candleTotal,
    trades, balance, accountType, signals, config, botRunning,
    manualTrade, startBot, stopBot, prefs,
  } = useTrader()
  // v9: chart timeframe persisted across sessions. IMPORTANT: the persisted
  // value is loaded in a POST-HYDRATION effect — reading localStorage inside a
  // useState initializer renders different HTML on the server vs the client
  // and caused a fatal hydration mismatch (React "Recoverable Error" overlay
  // on mobile). SSR-safe: always start at 1, swap to the saved value after mount.
  const [chartTf, setChartTf] = useState<1 | 5 | 15>(1)

  useEffect(() => { init() }, [init])

  // hydrate persisted chart timeframe after mount (no hydration mismatch).
  // setState-in-effect is intentional here: the value MUST arrive after the
  // server HTML is hydrated — deriving it during render would re-introduce the
  // server≠client mismatch this effect exists to fix.
  const setChartTfFromStorage = () => {
    try {
      const v = parseInt(window.localStorage.getItem('po-chart-tf') ?? '1', 10)
      if (v === 5 || v === 15) setChartTf(v)
    } catch { /* private mode */ }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChartTfFromStorage()
  }, [])

  const changeTf = (tf: 1 | 5 | 15) => {
    setChartTf(tf)
    try { localStorage.setItem('po-chart-tf', String(tf)) } catch { /* ignore */ }
  }

  // ─── alerts: toast + sound + browser notification on settlement ────────
  const lastSettledId = useRef<string | null>(null)
  useEffect(() => {
    const settled = trades.filter(t => t.status === 'win' || t.status === 'loss' || t.status === 'draw')
    if (!settled.length) return
    const last = settled[settled.length - 1]
    if (last.id === lastSettledId.current) return
    lastSettledId.current = last.id
    if (Date.now() - (last.closeTime ?? 0) > 4000) return // stale on load
    if (last.status === 'win') {
      toast.success(`WIN · ${last.asset} ${last.direction.toUpperCase()}`, {
        description: `+$${last.profit.toFixed(2)} (payout ${last.payout}%)`,
      })
      if (prefs.sound) beepWin()
      if (prefs.notifications) notify('Trade won 🟢', `${last.asset} ${last.direction.toUpperCase()} +$${last.profit.toFixed(2)}`)
    } else if (last.status === 'loss') {
      toast.error(`LOSS · ${last.asset} ${last.direction.toUpperCase()}`, {
        description: `-$${Math.abs(last.profit).toFixed(2)}`,
      })
      if (prefs.sound) beepLoss()
      if (prefs.notifications) notify('Trade lost 🔴', `${last.asset} ${last.direction.toUpperCase()} -$${Math.abs(last.profit).toFixed(2)}`)
    }
  }, [trades, prefs.sound, prefs.notifications])

  // ─── alerts: sound + notification on fresh strong signal ────────────────
  const lastSignalId = useRef<string | null>(null)
  useEffect(() => {
    if (!signals.length) return
    const last = signals[signals.length - 1]
    if (last.id === lastSignalId.current) return
    lastSignalId.current = last.id
    if (Date.now() - last.createdAt > 4000) return // stale on load
    const threshold = config?.minConfidence ?? 70
    if (last.confidence < threshold) return
    if (prefs.sound) beepSignal()
    if (prefs.notifications) {
      notify(
        `${last.direction === 'call' ? 'CALL ▲' : 'PUT ▼'} signal · ${last.asset}`,
        `${last.confidence}% confluence · expiry ${last.expirySeconds}s${last.acted ? ' · bot entering' : ''}`
      )
    }
  }, [signals, config?.minConfidence, prefs.sound, prefs.notifications])

  // ─── keyboard shortcuts ──────────────────────────────────────────────────
  const tradeRef = useRef({ chartAsset, mode, manualTrade })
  const botRef = useRef({ botRunning, startBot, stopBot })
  useEffect(() => {
    tradeRef.current = { chartAsset, mode, manualTrade }
    botRef.current = { botRunning, startBot, stopBot }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'c' || k === 'p') {
        const { mode: m, manualTrade: mt } = tradeRef.current
        if (m === 'disconnected') {
          toast.warning('Connect first (or start simulation) to trade')
          return
        }
        const dir = k === 'c' ? 'call' : 'put'
        mt(dir, 1, 60)
        toast.info(`${dir.toUpperCase()} placed via keyboard`, { description: tradeRef.current.chartAsset })
      } else if (k === 'b') {
        const { botRunning: running, startBot: sb, stopBot: st } = botRef.current
        if (running) { st(); toast.info('Bot stopped (B)') }
        else { sb(); toast.success('Bot started (B)') }
      } else if (k === '/') {
        e.preventDefault()
        const search = document.getElementById('pair-search') as HTMLInputElement | null
        search?.focus()
        search?.select()
      } else if (k === '?') {
        const helpBtn = document.querySelector<HTMLButtonElement>('[aria-label="Open help and shortcuts"]')
        helpBtn?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const assetInfo = useTrader(s => s.assets.find(a => a.asset === s.chartAsset))
  const livePrice = useTrader(s => s.prices[s.chartAsset])

  return (
    <div className="app-shell terminal-grid flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Header />
      <TickerTape />

      {!socketConnected && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-1.5 text-center">
          <p className="text-[11px] font-semibold text-red-300">
            Trading engine offline — reconnecting… (the bot service runs on port 3030)
          </p>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-3 px-3 py-3 sm:px-5">
        {/* KPI row */}
        <div className="panel-in" style={{ animationDelay: '0ms' }}>
          <StatsCards />
        </div>

        {/* Top movers strip */}
        <div className="panel-in" style={{ animationDelay: '60ms' }}>
          <TopMovers />
        </div>

        {/* Chart + Bot */}
        <div className="panel-in grid gap-3 lg:grid-cols-3" style={{ animationDelay: '120ms' }}>
          <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
              <CandlestickChart className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                {assetInfo?.name ?? chartAsset}
              </span>
              <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-[10px] font-bold text-zinc-300">
                {chartAsset}
              </Badge>
              {livePrice != null && (
                <span className="font-mono text-sm font-bold tabular-nums text-zinc-100">
                  {livePrice >= (assetInfo?.price ?? livePrice) ? '▲' : '▼'} {livePrice}
                </span>
              )}
              <span className="ml-auto flex items-center gap-2 text-[10px] text-zinc-500">
                <div className="flex overflow-hidden rounded-md border border-zinc-800" role="group" aria-label="Chart timeframe">
                  {([1, 5, 15] as const).map(tf => (
                    <button
                      key={tf}
                      onClick={() => changeTf(tf)}
                      aria-pressed={chartTf === tf}
                      className={cn(
                        'px-2 py-0.5 text-[10px] font-bold transition-colors',
                        chartTf === tf
                          ? 'bg-emerald-700 text-white'
                          : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                      )}
                    >
                      M{tf}
                    </button>
                  ))}
                </div>
                <span className="flex items-center gap-1.5">
                  <Radio className={mode !== 'disconnected' ? 'h-3 w-3 animate-pulse text-emerald-500' : 'h-3 w-3 text-zinc-700'} />
                  M1 · {candleTotal} candles buffered
                </span>
              </span>
            </div>
            <CandleChart asset={chartAsset} timeframe={chartTf} />
            <TradePanel asset={chartAsset} />
          </div>

          <div className="flex min-h-[420px] min-w-0 flex-col gap-3">
            <div className="min-h-0 flex-1">
              <BotPanel />
            </div>
            <TelegramPanel />
          </div>
        </div>

        {/* Market watch + Signals + Trades */}
        <div className="panel-in grid gap-3 lg:grid-cols-12" style={{ animationDelay: '180ms' }}>
          <div className="h-[420px] min-w-0 lg:col-span-3">
            <MarketWatch />
          </div>
          <div className="h-[420px] min-w-0 lg:col-span-4">
            <SignalFeed />
          </div>
          <div className="h-[420px] min-w-0 lg:col-span-5">
            <TradesTable />
          </div>
        </div>

        {/* Analytics + Calendar + News */}
        <div className="panel-in grid gap-3 lg:grid-cols-12" style={{ animationDelay: '240ms' }}>
          <div className="h-[440px] min-w-0 lg:col-span-5">
            <AnalyticsPanel />
          </div>
          <div className="h-[440px] min-w-0 lg:col-span-3">
            <CalendarPanel />
          </div>
          <div className="h-[440px] min-w-0 lg:col-span-4">
            <NewsPanel />
          </div>
        </div>

        {/* Backtest + AI + Activity */}
        <div className="panel-in grid gap-3 lg:grid-cols-12" style={{ animationDelay: '300ms' }}>
          <div className="h-[380px] min-w-0 lg:col-span-4">
            <BacktestPanel asset={chartAsset} />
          </div>
          <div className="h-[380px] min-w-0 lg:col-span-4">
            <AIAdvisor asset={chartAsset} />
          </div>
          <div className="h-[380px] min-w-0 lg:col-span-4">
            <ActivityLog />
          </div>
        </div>

        {/* Account balances strip */}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-4 py-2 text-[11px] text-zinc-500">
          <span>
            Active account:{' '}
            <strong className={accountType === 'real' ? 'text-red-400' : 'text-emerald-400'}>
              {accountType.toUpperCase()} (${balance.toFixed(2)})
            </strong>
          </span>
          <span className="text-zinc-700">|</span>
          <span>
            Mode:{' '}
            <strong className="text-zinc-300">
              {mode === 'live' ? 'LIVE Pocket Option' : mode === 'simulation' ? 'SIMULATION' : 'DISCONNECTED'}
            </strong>
          </span>
          <span className="text-zinc-700">|</span>
          <span>
            Engine:{' '}
            <strong className={socketConnected ? 'text-emerald-400' : 'text-red-400'}>
              {socketConnected ? 'connected' : 'offline'}
            </strong>
          </span>
          <span className="hidden text-zinc-700 sm:inline">|</span>
          <span className="hidden items-center gap-1.5 sm:flex">
            Shortcuts:
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400">C</kbd>
            CALL
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-red-400">P</kbd>
            PUT
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-300">B</kbd>
            {botRunning ? 'stop bot' : 'start bot'}
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-300">/</kbd>
            search
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-300">?</kbd>
            help
          </span>
        </div>
      </main>

      <Footer />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  )
}
