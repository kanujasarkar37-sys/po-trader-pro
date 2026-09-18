'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useTrader } from './store'
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown, Bot, Hand,
  Flame, Snowflake, Gauge, CalendarClock, ArrowUpRight, ArrowDownRight,
  Scale, Percent, Coins, Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface HourBucket { hour: number; trades: number; wins: number; losses: number; profit: number }
interface Split { trades: number; wins: number; profit: number }
interface AssetRow { asset: string; trades: number; wins: number; winRate: number; profit: number }
interface DayBucket { date: string; label: string; trades: number; wins: number; profit: number }
interface CalBin { label: string; lo: number; hi: number; trades: number; wins: number; wr: number }
interface Stats {
  totalTrades: number; wins: number; losses: number; winRate: number; profit: number
  curve: number[]; byAsset: AssetRow[]; volume: number
  hourly: HourBucket[]
  daily14: DayBucket[]
  direction: { call: Split; put: Split } | null
  source: { bot: Split; manual: Split } | null
  streaks: { maxWinStreak: number; maxLossStreak: number }
  confidence: { wins: number | null; losses: number | null }
  today: { trades: number; wins: number; losses: number; winRate: number; profit: number }
  calibration?: CalBin[]
  risk?: { maxDrawdown: number; profitFactor: number; roi: number }
}

export function AnalyticsPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tradesVersion = useTrader(s => s.trades.length)
  const settledCount = useTrader(s => s.trades.filter(t => t.status !== 'open').length)
  const adaptive = useTrader(s => s.adaptive)
  const adaptiveOn = useTrader(s => s.config?.adaptiveThresholds)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/stats', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d) setStats(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let alive = true
    const run = () => {
      fetch('/api/stats', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => { if (alive && d) setStats(d) })
        .catch(() => {})
    }
    run()
    const t = setInterval(run, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [settledCount, tradesVersion])

  // ─── equity curve canvas ───
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !stats?.curve?.length) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(160, rect.width), h = Math.max(90, rect.height)
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const curve = stats.curve
    const min = Math.min(0, ...curve)
    const max = Math.max(0, ...curve)
    const range = (max - min) || 1
    const padY = 10, padX = 6
    const x = (i: number) => padX + (i / Math.max(1, curve.length - 1)) * (w - padX * 2)
    const y = (v: number) => padY + (1 - (v - min) / range) * (h - padY * 2)

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 3; i++) {
      const gy = padY + (i / 3) * (h - padY * 2)
      ctx.beginPath(); ctx.moveTo(padX, gy); ctx.lineTo(w - padX, gy); ctx.stroke()
    }

    // zero baseline (dashed)
    const zeroY = y(0)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(padX, zeroY); ctx.lineTo(w - padX, zeroY); ctx.stroke()
    ctx.setLineDash([])

    const positive = curve[curve.length - 1] >= 0
    const line = positive ? '#34d399' : '#f87171'
    const fillTo = positive ? 'rgba(52,211,153,0.16)' : 'rgba(248,113,113,0.14)'

    // area fill
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, fillTo)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(x(0), y(curve[0]))
    curve.forEach((v, i) => ctx.lineTo(x(i), y(v)))
    ctx.lineTo(x(curve.length - 1), h - padY)
    ctx.lineTo(x(0), h - padY)
    ctx.closePath()
    ctx.fill()

    // line
    ctx.strokeStyle = line
    ctx.lineWidth = 1.8
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x(0), y(curve[0]))
    curve.forEach((v, i) => ctx.lineTo(x(i), y(v)))
    ctx.stroke()

    // end dot
    ctx.fillStyle = line
    ctx.beginPath()
    ctx.arc(x(curve.length - 1), y(curve[curve.length - 1]), 3, 0, Math.PI * 2)
    ctx.fill()
  }, [stats])

  const hasData = (stats?.totalTrades ?? 0) > 0
  const maxHourTrades = Math.max(1, ...(stats?.hourly?.map(h => h.trades) ?? [1]))
  const topAssets = (stats?.byAsset ?? []).slice(0, 6)
  const days = stats?.daily14 ?? []
  const maxAbsDay = Math.max(0.01, ...days.map(d => Math.abs(d.profit)))
  const days14Pnl = Math.round(days.reduce((a, d) => a + d.profit, 0) * 100) / 100
  const greenDays = days.filter(d => d.profit > 0).length
  const redDays = days.filter(d => d.profit < 0).length

  const wrColor = (wr: number) =>
    wr >= 60 ? 'bg-emerald-500' : wr >= 52 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <BarChart3 className="h-3.5 w-3.5 text-emerald-500" />
          Performance Analytics
          {stats && (
            <span className="ml-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">
              {stats.totalTrades} trades
            </span>
          )}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          className="h-6 w-6 p-0 text-zinc-500 hover:text-emerald-400"
          aria-label="Refresh analytics"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>

      {!hasData ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
          <BarChart3 className="mb-2 h-8 w-8 text-zinc-800" />
          <p className="text-[11px] font-medium text-zinc-500">No settled trades yet</p>
          <p className="mt-1 max-w-[240px] text-[10px] leading-relaxed text-zinc-600">
            Analytics populate automatically as the bot settles trades — equity curve, hourly
            edge, per-asset accuracy and streaks.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
          {/* today summary + risk metrics */}
          <div className="grid grid-cols-4 gap-1.5">
            <MiniStat label="Today" value={`${stats.today.trades}t`} icon={CalendarClock} />
            <MiniStat label="Today WR" value={stats.today.trades ? `${stats.today.winRate}%` : '—'} icon={Gauge}
              tone={stats.today.winRate >= 60 ? 'emerald' : stats.today.winRate >= 52 ? 'amber' : 'zinc'} />
            <MiniStat label="Today P/L" value={`${stats.today.profit >= 0 ? '+' : ''}$${stats.today.profit.toFixed(2)}`}
              icon={stats.today.profit >= 0 ? ArrowUpRight : ArrowDownRight}
              tone={stats.today.profit > 0 ? 'emerald' : stats.today.profit < 0 ? 'red' : 'zinc'} />
            <MiniStat label="Volume" value={`$${(stats.volume ?? 0).toFixed(0)}`} icon={TrendingUp} />
            <MiniStat label="Max DD" value={`-$${(stats.risk?.maxDrawdown ?? 0).toFixed(2)}`}
              icon={ArrowDownRight} tone="red" title="Largest peak-to-trough drop of the equity curve" />
            <MiniStat
              label="Profit factor"
              value={stats.risk?.profitFactor === Infinity || (stats.risk?.profitFactor ?? 0) > 99 ? '∞' : `${(stats.risk?.profitFactor ?? 0).toFixed(2)}`}
              icon={Scale}
              tone={(stats.risk?.profitFactor ?? 0) >= 1 ? 'emerald' : 'red'}
              title="Gross wins ÷ gross losses — above 1.0 is profitable" />
            <MiniStat label="ROI on volume" value={`${(stats.risk?.roi ?? 0) >= 0 ? '+' : ''}${(stats.risk?.roi ?? 0).toFixed(1)}%`}
              icon={Percent}
              tone={(stats.risk?.roi ?? 0) >= 0 ? 'emerald' : 'red'} title="Total profit ÷ total staked volume" />
            <MiniStat label="Avg stake" value={`$${stats.totalTrades ? (stats.volume / stats.totalTrades).toFixed(2) : '0'}`}
              icon={Coins} title="Average stake per settled trade" />
          </div>

          {/* equity curve */}
          <div>
            <SectionTitle>Equity curve (last 100 settled)</SectionTitle>
            <div className="relative h-[90px] overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/30">
              <canvas ref={canvasRef} className="h-full w-full" aria-label="Cumulative profit curve" />
              <span className={cn(
                'absolute right-2 top-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums',
                (stats.profit ?? 0) >= 0 ? 'bg-emerald-950/80 text-emerald-400' : 'bg-red-950/80 text-red-400'
              )}>
                {(stats.profit ?? 0) >= 0 ? '+' : ''}${(stats.profit ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* daily P/L bars (14 days) */}
          {days.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <SectionTitle className="mb-0">P/L by day (14d)</SectionTitle>
                <span className={cn(
                  'font-mono text-[9px] font-bold tabular-nums',
                  days14Pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {days14Pnl >= 0 ? '+' : ''}${days14Pnl.toFixed(2)} · <span className="text-emerald-500/80">{greenDays}↑</span> <span className="text-red-500/80">{redDays}↓</span>
                </span>
              </div>
              <div className="flex h-14 items-stretch gap-[2px] rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-1.5 py-1">
                {days.map((d, i) => {
                  const h = Math.max(2, Math.abs(d.profit) / maxAbsDay * 42)
                  const isToday = i === days.length - 1
                  return (
                    <div key={d.date} className="relative flex min-w-0 flex-1 flex-col items-center justify-center" title={`${d.date} (${d.label}) — ${d.trades} trades · ${d.wins}W · ${d.profit >= 0 ? '+' : ''}$${d.profit.toFixed(2)}`}>
                      {d.profit >= 0 ? (
                        <div
                          className={cn('w-full max-w-[18px] rounded-sm', isToday ? 'bg-emerald-400 ring-1 ring-emerald-300/50' : 'bg-emerald-600/80')}
                          style={{ height: h }}
                        />
                      ) : (
                        <div
                          className={cn('w-full max-w-[18px] rounded-sm', isToday ? 'bg-red-400 ring-1 ring-red-300/50' : 'bg-red-600/80')}
                          style={{ height: h }}
                        />
                      )}
                      {d.trades === 0 && <span className="absolute inset-0 flex items-center justify-center text-[8px] text-zinc-700">·</span>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-0.5 flex justify-between text-[8px] text-zinc-600">
                <span>{days[0]?.date.slice(5)}</span>
                <span>today — ring highlight</span>
              </div>
            </div>
          )}

          {/* adaptive thresholds (v6) */}
          {adaptiveOn && (
            <div>
              <SectionTitle>Adaptive thresholds (learned)</SectionTitle>
              {adaptive.length === 0 ? (
                <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-2 py-1.5 text-[9px] leading-relaxed text-zinc-500">
                  Not enough data yet — the engine needs ≥8 settled bot trades on an asset before tuning
                  its confidence bar. Trade on and this fills up automatically.
                </p>
              ) : (
                <div className="space-y-1">
                  {adaptive.map(a => {
                    const delta = a.threshold - a.baseThreshold
                    return (
                      <div key={a.asset} className="flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-2 py-1">
                        <span className="w-[78px] shrink-0 truncate text-[10px] font-bold text-zinc-300" title={a.asset}>{a.asset.replace('_otc', '')}</span>
                        <span className="font-mono text-[10px] font-bold tabular-nums text-zinc-500">{a.baseThreshold}%</span>
                        <span className={cn(
                          'text-[10px] font-extrabold',
                          delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : 'text-zinc-600'
                        )}>
                          {delta > 0 ? '→↑' : delta < 0 ? '→↓' : '→'}
                        </span>
                        <span className={cn(
                          'font-mono text-[11px] font-extrabold tabular-nums',
                          delta > 0 ? 'text-red-300' : delta < 0 ? 'text-emerald-300' : 'text-zinc-300'
                        )}>
                          {a.threshold}%
                        </span>
                        <span className={cn(
                          'ml-auto shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-bold tabular-nums',
                          a.winRate >= 60 ? 'bg-emerald-950/50 text-emerald-400' : a.winRate >= 52 ? 'bg-amber-950/50 text-amber-400' : 'bg-red-950/50 text-red-400'
                        )} title="Win-rate of settled bot trades on this asset">
                          {a.winRate}% · {a.sampleSize}t
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* confidence calibration — predicted vs realized win-rate */}
          {(stats.calibration?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <SectionTitle className="mb-0">Calibration — confidence vs realized WR</SectionTitle>
                <Target className="h-3 w-3 text-zinc-600" />
              </div>
              <div className="space-y-1 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2">
                {stats.calibration!.map(b => {
                  const predicted = (b.lo + b.hi) / 2
                  const delta = Math.round((b.wr - predicted) * 10) / 10
                  return (
                    <div key={b.label} className="cal-row flex items-center gap-2 rounded-sm px-1 -mx-1" title={`${b.label}% confidence → ${b.wins}/${b.trades} wins (${b.wr}% realized vs ${predicted}% predicted)`}>
                      <span className="w-[42px] shrink-0 font-mono text-[9px] font-bold text-zinc-500">{b.label}</span>
                      <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-zinc-900/70">
                        {/* breakeven guide 52.1% */}
                        <div className="absolute inset-y-0" style={{ left: '52.1%' }}>
                          <div className="h-full w-px bg-zinc-600/50" />
                        </div>
                        {/* predicted marker (bin midpoint) */}
                        <div className="absolute inset-y-0" style={{ left: `${predicted}%` }}>
                          <div className="h-full w-[2px] bg-zinc-400/70" />
                        </div>
                        {/* realized bar */}
                        <div
                          className={cn(
                            'absolute inset-y-0 left-0 rounded-sm',
                            delta >= 0 ? 'bg-emerald-600/70' : 'bg-red-600/70'
                          )}
                          style={{ width: `${Math.min(100, b.wr)}%` }}
                        />
                      </div>
                      <span className={cn(
                        'w-[38px] shrink-0 text-right font-mono text-[10px] font-bold tabular-nums',
                        b.wr >= 60 ? 'text-emerald-400' : b.wr >= 52.1 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {b.wr}%
                      </span>
                      <span className={cn(
                        'w-[34px] shrink-0 text-right font-mono text-[9px] font-bold tabular-nums',
                        delta >= 0 ? 'text-emerald-500/90' : 'text-red-500/90'
                      )}>
                        {delta >= 0 ? '+' : ''}{delta}pp
                      </span>
                      <span className="w-[26px] shrink-0 text-right font-mono text-[9px] text-zinc-600">{b.trades}t</span>
                    </div>
                  )
                })}
                <p className="pt-0.5 text-[8px] leading-relaxed text-zinc-600">
                  Bar = realized WR · solid line = predicted (bin midpoint) · dashed = breakeven 52.1% · negative deltas mean the engine over-rates its confidence in that bucket
                </p>
              </div>
            </div>
          )}

          {/* hourly heatmap */}
          <div>
            <SectionTitle>Win-rate by hour</SectionTitle>
            <div className="grid grid-cols-12 gap-[3px]">
              {stats.hourly.map(h => {
                const wr = h.wins + h.losses > 0 ? (h.wins / (h.wins + h.losses)) * 100 : -1
                return (
                  <div
                    key={h.hour}
                    title={`${String(h.hour).padStart(2, '0')}:00 — ${h.trades} trades, ${wr >= 0 ? wr.toFixed(0) + '% WR' : 'no trades'}, ${h.profit >= 0 ? '+' : ''}$${h.profit.toFixed(2)}`}
                    className={cn(
                      'relative flex h-7 items-center justify-center rounded-sm border text-[8px] font-bold tabular-nums transition-transform hover:scale-110',
                      wr < 0
                        ? 'border-zinc-800/60 bg-zinc-900/40 text-zinc-700'
                        : wr >= 60
                          ? 'border-emerald-800/60 bg-emerald-950/70 text-emerald-400'
                          : wr >= 52
                            ? 'border-amber-800/50 bg-amber-950/50 text-amber-400'
                            : 'border-red-800/50 bg-red-950/50 text-red-400'
                    )}
                    style={wr >= 0 ? { opacity: 0.55 + 0.45 * (h.trades / maxHourTrades) } : undefined}
                  >
                    {String(h.hour).padStart(2, '0')}
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex items-center justify-between text-[8px] text-zinc-600">
              <span>darker = fewer trades</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-red-950/70" /> loss-heavy
                <span className="ml-1 inline-block h-2 w-2 rounded-sm bg-amber-950/60" /> marginal
                <span className="ml-1 inline-block h-2 w-2 rounded-sm bg-emerald-950/70" /> edge
              </span>
            </div>
          </div>

          {/* per-asset bars */}
          {topAssets.length > 0 && (
            <div>
              <SectionTitle>Per-asset accuracy</SectionTitle>
              <div className="space-y-1.5">
                {topAssets.map(a => (
                  <div key={a.asset} className="flex items-center gap-2">
                    <span className="w-[86px] shrink-0 truncate text-[10px] font-bold text-zinc-300" title={a.asset}>
                      {a.asset.replace('_otc', '')}
                    </span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-zinc-900/60">
                      <div
                        className={cn('absolute inset-y-0 left-0 rounded-sm opacity-80', wrColor(a.winRate))}
                        style={{ width: `${a.winRate}%` }}
                      />
                      <div className="absolute inset-y-0" style={{ left: '52.1%' }}>
                        <div className="h-full w-px bg-zinc-500/60" />
                      </div>
                    </div>
                    <span className={cn(
                      'w-9 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums',
                      a.winRate >= 60 ? 'text-emerald-400' : a.winRate >= 52 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      {a.winRate}%
                    </span>
                    <span className={cn(
                      'w-14 shrink-0 text-right font-mono text-[10px] tabular-nums',
                      a.profit >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'
                    )}>
                      {a.profit >= 0 ? '+' : ''}${a.profit.toFixed(1)}
                    </span>
                  </div>
                ))}
                <p className="text-[8px] text-zinc-600">White line = breakeven 52.1% (92% payout) · win-rate over {stats.totalTrades} trades</p>
              </div>
            </div>
          )}

          {/* splits + streaks */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2">
              <SectionTitle className="mb-1.5">Direction</SectionTitle>
              {stats.direction && (
                <div className="space-y-1">
                  <SplitRow
                    icon={TrendingUp} color="emerald" label="CALL"
                    data={stats.direction.call}
                  />
                  <SplitRow
                    icon={TrendingDown} color="red" label="PUT"
                    data={stats.direction.put}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2">
              <SectionTitle className="mb-1.5">Source</SectionTitle>
              {stats.source && (
                <div className="space-y-1">
                  <SplitRow icon={Bot} color="emerald" label="Bot" data={stats.source.bot} />
                  <SplitRow icon={Hand} color="zinc" label="Manual" data={stats.source.manual} />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <MiniStat
              label="Win streak" value={`${stats.streaks.maxWinStreak}▲`}
              icon={Flame} tone="emerald"
              title="Longest consecutive wins"
            />
            <MiniStat
              label="Loss streak" value={`${stats.streaks.maxLossStreak}▼`}
              icon={Snowflake} tone="red"
              title="Longest consecutive losses — size martingale accordingly"
            />
            <MiniStat
              label="Avg conf (W)" value={stats.confidence.wins != null ? `${stats.confidence.wins}%` : '—'}
              icon={Gauge} tone="emerald" title="Average signal confidence of winning trades"
            />
            <MiniStat
              label="Avg conf (L)" value={stats.confidence.losses != null ? `${stats.confidence.losses}%` : '—'}
              icon={Gauge} tone="red" title="Average signal confidence of losing trades"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500', className)}>
      {children}
    </p>
  )
}

function MiniStat({ label, value, icon: Icon, tone = 'zinc', title }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>
  tone?: 'emerald' | 'red' | 'amber' | 'zinc'; title?: string
}) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-2 py-1.5" title={title}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[8px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <Icon className={cn(
          'h-3 w-3 shrink-0',
          tone === 'emerald' ? 'text-emerald-500' : tone === 'red' ? 'text-red-500' : tone === 'amber' ? 'text-amber-500' : 'text-zinc-600'
        )} />
      </div>
      <div className={cn(
        'mt-0.5 truncate font-mono text-[12px] font-extrabold tabular-nums',
        tone === 'emerald' ? 'text-emerald-400' : tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-zinc-200'
      )}>
        {value}
      </div>
    </div>
  )
}

function SplitRow({ icon: Icon, color, label, data }: {
  icon: React.ComponentType<{ className?: string }>; color: 'emerald' | 'red' | 'zinc'
  label: string; data: Split
}) {
  const wr = data.trades > 0 ? Math.round((data.wins / data.trades) * 100) : 0
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn(
        'h-3 w-3 shrink-0',
        color === 'emerald' ? 'text-emerald-500' : color === 'red' ? 'text-red-500' : 'text-zinc-500'
      )} />
      <span className="w-11 shrink-0 text-[10px] font-bold text-zinc-300">{label}</span>
      <div className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-zinc-900/70">
        <div
          className={cn('absolute inset-y-0 left-0', color === 'emerald' ? 'bg-emerald-600/70' : color === 'red' ? 'bg-red-600/70' : 'bg-zinc-600/70')}
          style={{ width: `${data.trades > 0 ? wr : 0}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[9px] font-bold tabular-nums text-zinc-400">
        {wr}% · {data.trades}t
      </span>
    </div>
  )
}
