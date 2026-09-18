'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { useTrader } from './store'
import { TrendingUp, TrendingDown, Zap, Timer, ChevronDown, ChevronUp, Download } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function SignalFeed() {
  const { signals, config, lastScan, botRunning, takeSignal, mode } = useTrader()
  // SSR-safe clock: 0 until mounted (server/client Date.now() differ →
  // hydration mismatch risk); time-ago renders guard against it
  const [now, setNow] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const sorted = [...signals].sort((a, b) => b.createdAt - a.createdAt).slice(0, 40)
  const minConf = config?.minConfidence ?? 70

  const exportCsv = () => {
    if (!sorted.length) {
      toast.info('No signals to export yet')
      return
    }
    const header = 'asset,direction,confidence_pct,expiry_s,created_at,entry_at,expires_at,price,payout,regime,acted,ema,rsi,stoch,macd,bollinger,pattern,sr,momentum,mtf,htf,reasons'
    const rows = sorted.map(s => [
      s.asset, s.direction, s.confidence, s.expirySeconds,
      new Date(s.createdAt).toISOString(),
      new Date(s.entryAt).toISOString(),
      new Date(s.expiresAt).toISOString(),
      s.price, s.payout, s.regime, s.acted ? 1 : 0,
      s.components.ema, s.components.rsi, s.components.stoch, s.components.macd,
      s.components.bollinger, s.components.pattern, s.components.sr,
      s.components.momentum, s.components.mtf, s.components.htf,
      `"${(s.reasons ?? []).join('; ').replace(/"/g, "'")}"`,
    ].join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `po-trader-signals-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${sorted.length} signals to CSV`, {
      description: 'Full component breakdown + reasons included',
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          Live Signals
          <span
            className="rounded border border-emerald-800/60 bg-emerald-950/40 px-1 py-0.5 text-[8px] font-bold text-emerald-400"
            title="10-component confluence: 8 M1 indicators + M5 trend alignment + M15 macro veto — with per-asset adaptive thresholds"
          >
            v9 · ACCURATE
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-zinc-500">
            ≥{minConf}% · {signals.length}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={exportCsv}
            disabled={!sorted.length}
            className="h-6 w-6 p-0 text-zinc-500 hover:text-emerald-400"
            aria-label="Export signals as CSV"
            title="Export visible signals with full component breakdown to CSV"
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* scan telemetry strip — proves the engine is alive */}
      <div className="flex items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-[10px]">
        {botRunning ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {lastScan ? (
              <span className="truncate text-zinc-400">
                {lastScan.redZone ? (
                  <strong className="text-red-400">RED ZONE — {lastScan.redZone} · entries paused</strong>
                ) : (
                  <>
                    Last scan {new Date(lastScan.ts).toLocaleTimeString([], { hour12: false })} ·{' '}
                    {lastScan.scanned} pairs ·{' '}
                    {lastScan.best ? (
                      <strong className={lastScan.best.direction === 'call' ? 'text-emerald-400' : 'text-red-400'}>
                        {lastScan.best.asset} {lastScan.best.confidence}%
                      </strong>
                    ) : '—'}
                  </>
                )}
              </span>
            ) : (
              <span className="text-zinc-500">Scanning every candle close…</span>
            )}
          </>
        ) : (
          <span className="text-zinc-600">Bot idle — start it to generate signals</span>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-zinc-900">
          {sorted.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Zap className="mx-auto mb-2 h-8 w-8 text-zinc-800" />
              <p className="text-xs font-medium text-zinc-500">Waiting for signals…</p>
              <p className="mt-1 text-[10px] text-zinc-600">
                The engine scans every candle close on selected pairs
              </p>
            </div>
          )}
          {sorted.map((s) => {
            const isCall = s.direction === 'call'
            const strong = s.confidence >= minConf
            const secondsToEntry = Math.max(0, Math.round((s.entryAt - now) / 1000))
            const secondsToExpiry = Math.max(0, Math.round((s.expiresAt - now) / 1000))
            const isPending = now < s.entryAt
            const isActive = now >= s.entryAt && now < s.expiresAt
            const expired = now >= s.expiresAt
            const isOpen = expanded === s.id
            const isFresh = now - s.createdAt < 8000
            const canTake = !s.acted && now < s.expiresAt && mode !== 'disconnected'
            return (
              <div
                key={s.id}
                className={cn(
                  'fade-slide-in relative px-3 py-2.5 transition-colors',
                  isOpen && 'bg-zinc-900/50',
                  isFresh && strong && !expired && 'bg-gradient-to-r from-zinc-900/80 to-transparent'
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full cursor-pointer items-center gap-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-emerald-700/70 rounded"
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(isOpen ? null : s.id) } }}
                  aria-label={`Signal details for ${s.asset}`}
                >
                  <div className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    isCall ? 'bg-emerald-950/70 text-emerald-400' : 'bg-red-950/70 text-red-400'
                  )}>
                    {isCall ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-zinc-100">{s.asset}</span>
                      <span className={cn('text-[10px] font-extrabold', isCall ? 'text-emerald-400' : 'text-red-400')}>
                        {isCall ? 'CALL ▲' : 'PUT ▼'}
                      </span>
                      {s.acted && <Badge className="h-4 bg-emerald-900/60 px-1 text-[8px] font-bold text-emerald-300">TRADED</Badge>}
                      {(() => {
                        const aligned = (isCall && s.components.mtf >= 0.5) || (!isCall && s.components.mtf <= -0.5)
                        const against = (isCall && s.components.mtf <= -0.5) || (!isCall && s.components.mtf >= 0.5)
                        if (aligned) return <Badge variant="outline" className="h-4 border-emerald-800/60 bg-emerald-950/30 px-1 text-[8px] font-bold text-emerald-300" title="M5 higher-timeframe trend agrees with this signal">M5✓</Badge>
                        if (against) return <Badge variant="outline" className="h-4 border-amber-800/60 bg-amber-950/40 px-1 text-[8px] font-bold text-amber-300" title="Signal fights the M5 higher-timeframe trend">M5✗</Badge>
                        return null
                      })()}
                      {(() => {
                        const htf = s.components.htf ?? 0
                        const aligned = (isCall && htf >= 0.4) || (!isCall && htf <= -0.4)
                        const against = (isCall && htf <= -0.4) || (!isCall && htf >= 0.4)
                        if (aligned) return <Badge variant="outline" className="h-4 border-purple-800/60 bg-purple-950/40 px-1 text-[8px] font-bold text-purple-300" title="M15 macro trend agrees with this signal">M15✓</Badge>
                        if (against) return <Badge variant="outline" className="h-4 border-orange-800/60 bg-orange-950/40 px-1 text-[8px] font-bold text-orange-300" title="Signal fights the M15 macro trend — engine penalises counter-macro entries">M15✗</Badge>
                        return null
                      })()}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={cn('h-full rounded-full', isCall ? 'bg-emerald-500' : 'bg-red-500')}
                          style={{ width: `${s.confidence}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-zinc-400">{s.confidence}%</span>
                      <span className="text-[9px] text-zinc-600">
                        {new Date(s.createdAt).toLocaleTimeString([], { hour12: false })}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {canTake && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          takeSignal(s.id)
                        }}
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[9px] font-extrabold transition-transform active:scale-95',
                          isCall
                            ? 'take-glow-call bg-emerald-600/90 text-white hover:bg-emerald-500'
                            : 'take-glow-put bg-red-600/90 text-white hover:bg-red-500'
                        )}
                        title="Take this signal manually at your configured stake"
                      >
                        TAKE {isCall ? '▲' : '▼'}
                      </button>
                    )}
                    {isPending && (
                      <span className="flex items-center gap-1 rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-300">
                        <Timer className="h-3 w-3" />{secondsToEntry}s
                      </span>
                    )}
                    {isActive && (
                      <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-300">
                        ACTIVE · {secondsToExpiry}s left
                      </span>
                    )}
                    {expired && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">SETTLED</span>
                    )}
                    <span className="text-[9px] text-zinc-600">{s.expirySeconds}s · {s.payout}%</span>
                  </div>

                  <div className="shrink-0 text-zinc-600">
                    {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2.5">
                    <div className="flex flex-wrap gap-1">
                      {s.reasons.map((r, i) => (
                        <Badge key={i} variant="outline" className="border-zinc-700 bg-zinc-900 text-[9px] font-normal text-zinc-400">
                          {r}
                        </Badge>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {componentRows(s.components).map(({ key, value }) => (
                        <div key={key} className="rounded bg-zinc-950/70 px-1.5 py-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold uppercase text-zinc-600">{key}</span>
                            <span className={cn(
                              'text-[9px] font-bold tabular-nums',
                              value > 0.05 ? 'text-emerald-400' : value < -0.05 ? 'text-red-400' : 'text-zinc-500'
                            )}>
                              {value > 0 ? '+' : ''}{value.toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-0.5 h-0.5 w-full rounded bg-zinc-800">
                            <div
                              className={cn('h-full rounded', value > 0 ? 'bg-emerald-500' : 'bg-red-500')}
                              style={{ width: `${Math.min(100, Math.abs(value) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-zinc-500">
                      <span>Regime: <strong className="text-zinc-300">{s.regime}</strong></span>
                      <span>Entry price: <strong className="font-mono text-zinc-300">{s.price}</strong></span>
                      <span>Entry: <strong className="text-zinc-300">{new Date(s.entryAt).toLocaleTimeString([], { hour12: false })}</strong></span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

function componentRows(c: { ema: number; rsi: number; stoch: number; macd: number; bollinger: number; pattern: number; sr: number; momentum: number; mtf: number; htf: number }) {
  return [
    { key: 'ema', value: c.ema },
    { key: 'rsi', value: c.rsi },
    { key: 'stoch', value: c.stoch },
    { key: 'macd', value: c.macd },
    { key: 'boll', value: c.bollinger },
    { key: 'patt', value: c.pattern },
    { key: 's/r', value: c.sr },
    { key: 'mom', value: c.momentum },
    { key: 'mtf', value: c.mtf },
    { key: 'm15', value: c.htf },
  ]
}
