'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useTrader, type TradeRecord, type SignalComponents } from './store'
import {
  TrendingUp, TrendingDown, Bot, Hand, Clock, Timer, Activity,
  FlaskConical, Waves, Sparkles, ArrowRight, CircleDot,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ApiSignal {
  id: string; asset: string; direction: string; confidence: number
  expirySeconds: number; indicators: string; acted: boolean; createdAt: string
}

interface ResolvedSignal {
  confidence: number
  regime: string
  components: Partial<Record<keyof SignalComponents, number>>
  reasons: string[]
  price?: number
  payout?: number
  source: 'live' | 'db' | 'none'
}

// module-level cache for /api/signals (refreshed per dialog open)
let signalCache: { at: number; rows: ApiSignal[] } | null = null

export function TradeDetailDialog({ trade, open, onOpenChange }: {
  trade: TradeRecord | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [dbSignal, setDbSignal] = useState<ApiSignal | null>(null)
  const [now, setNow] = useState(Date.now())
  const [loadingSig, setLoadingSig] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  // fetch persisted signals when a dialog opens for a trade without an
  // in-memory snapshot (e.g. trades resumed/loaded from the database)
  useEffect(() => {
    if (!open || !trade) return
    if (trade.signal || trade.source === 'manual' || trade.confidence <= 0) { setDbSignal(null); return }
    setLoadingSig(true)
    const fresh = !signalCache || Date.now() - signalCache.at > 60_000
    const load = fresh
      ? fetch('/api/signals?limit=200').then(r => r.json()).then(d => {
          signalCache = { at: Date.now(), rows: (d?.signals ?? []) as ApiSignal[] }
          return signalCache.rows
        })
      : Promise.resolve(signalCache.rows)
    load.then(rows => {
      let best: ApiSignal | null = null
      let bestGap = Number.POSITIVE_INFINITY
      for (const s of rows) {
        if (s.asset !== trade.asset || s.direction !== trade.direction) continue
        const gap = Math.abs(new Date(s.createdAt).getTime() - trade.openTime)
        if (gap < bestGap) { bestGap = gap; best = s }
      }
      setDbSignal(bestGap <= 180_000 ? best : null)
    }).catch(() => setDbSignal(null)).finally(() => setLoadingSig(false))
  }, [open, trade])

  const resolved = useMemo<ResolvedSignal>(() => {
    if (trade?.signal) {
      return {
        confidence: trade.confidence,
        regime: trade.signal.regime,
        components: trade.signal.components,
        reasons: trade.signal.reasons ?? [],
        source: 'live',
      }
    }
    if (dbSignal) {
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(dbSignal.indicators || '{}') } catch { /* empty */ }
      const { _reasons, _regime, _price, _payout, ...comps } = parsed as Record<string, unknown>
      return {
        confidence: dbSignal.confidence,
        regime: typeof _regime === 'string' ? _regime : '—',
        components: comps as Partial<Record<keyof SignalComponents, number>>,
        reasons: Array.isArray(_reasons) ? (_reasons as string[]) : [],
        price: typeof _price === 'number' ? _price : undefined,
        payout: typeof _payout === 'number' ? _payout : undefined,
        source: 'db',
      }
    }
    return { confidence: trade?.confidence ?? 0, regime: '', components: {}, reasons: [], source: 'none' }
  }, [trade, dbSignal])

  if (!trade) return null

  const digits = priceDigits(trade.openPrice)
  const delta = trade.closePrice != null ? trade.closePrice - trade.openPrice : null
  const deltaPct = delta != null && trade.openPrice > 0 ? (delta / trade.openPrice) * 100 : null
  const expiryAt = trade.openTime + trade.expirySeconds * 1000
  const remaining = Math.max(0, expiryAt - now)
  const progress = trade.status === 'open'
    ? Math.min(100, Math.max(0, ((now - trade.openTime) / (trade.expirySeconds * 1000)) * 100))
    : 100
  const win = trade.status === 'win'
  const loss = trade.status === 'loss'
  const isCall = trade.direction === 'call'
  const movedRight = delta != null ? (isCall ? delta > 0 : delta < 0) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-in max-h-[90vh] gap-0 overflow-y-auto border-zinc-800 bg-zinc-950 p-0 sm:max-w-lg">
        {/* ── header ── */}
        <DialogHeader className="space-y-0 border-b border-zinc-800/80 px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 font-mono text-sm font-bold text-zinc-100">
              {trade.asset}
              <span className={cn(
                'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold',
                isCall ? 'bg-emerald-950/60 text-emerald-400' : 'bg-red-950/60 text-red-400'
              )}>
                {isCall ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {trade.direction.toUpperCase()}
              </span>
            </DialogTitle>
            <span className="ml-auto flex items-center gap-1.5">
              {trade.isDemo ? (
                <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-500">DEMO</span>
              ) : (
                <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-[9px] font-bold text-red-400">REAL</span>
              )}
              <span className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">
                {trade.source === 'bot' ? <Bot className="h-3 w-3 text-emerald-500" /> : <Hand className="h-3 w-3" />}
                {trade.source.toUpperCase()}
              </span>
            </span>
          </div>
          <DialogDescription className="text-[10px] text-zinc-600">
            opened {new Date(trade.openTime).toLocaleTimeString([], { hour12: false })}
            {trade.closeTime ? ` · closed ${new Date(trade.closeTime).toLocaleTimeString([], { hour12: false })}` : ' · settling at expiry'}
            {' · '}{trade.expirySeconds}s expiry
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin space-y-4 px-4 py-4">
          {/* ── outcome ── */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">outcome</div>
              <div className={cn(
                'text-xl font-extrabold tabular-nums',
                win ? 'text-emerald-400' : loss ? 'text-red-400' : 'text-amber-300'
              )}>
                {trade.status === 'open' ? 'IN FLIGHT' : trade.status.toUpperCase()}
              </div>
              {trade.status !== 'open' && (
                <div className="text-[10px] text-zinc-600">
                  stake ${trade.amount.toFixed(2)} · payout {trade.payout}%
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">profit / loss</div>
              <div className={cn(
                'font-mono text-2xl font-extrabold tabular-nums',
                trade.profit > 0 ? 'text-emerald-400' : trade.profit < 0 ? 'text-red-400' : 'text-zinc-400'
              )}>
                {trade.status === 'open' ? '—' : `${trade.profit >= 0 ? '+' : '−'}$${Math.abs(trade.profit).toFixed(2)}`}
              </div>
              {trade.confidence > 0 && (
                <div className="text-[10px] text-zinc-600">{trade.confidence}% confidence at entry</div>
              )}
            </div>
          </div>

          {/* ── open trade countdown ── */}
          {trade.status === 'open' && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> time to expiry</span>
                <span className="font-mono tabular-nums">{(remaining / 1000).toFixed(1)}s</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-200', movedRight == null ? 'bg-amber-500' : movedRight ? 'bg-emerald-500' : 'bg-red-500')}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-[9px] text-amber-200/60">
                bar colour tracks live direction — settles {new Date(expiryAt).toLocaleTimeString([], { hour12: false })}
              </div>
            </div>
          )}

          {/* ── price path ── */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <Activity className="h-3 w-3" /> price path
            </div>
            <div className="flex items-center justify-between gap-2 font-mono">
              <div className="text-center">
                <div className="text-[9px] uppercase text-zinc-600">entry</div>
                <div className="text-sm font-bold tabular-nums text-zinc-200">{trade.openPrice.toFixed(digits)}</div>
              </div>
              <div className="flex flex-1 items-center gap-1 px-2">
                <div className={cn(
                  'h-0.5 flex-1 rounded-full',
                  delta == null ? 'bg-zinc-700' : movedRight ? 'bg-emerald-500' : 'bg-red-500'
                )} />
                {delta != null ? (
                  <ArrowRight className={cn('h-3.5 w-3.5 shrink-0', movedRight ? 'text-emerald-400' : 'text-red-400')} />
                ) : (
                  <CircleDot className="h-3.5 w-3.5 shrink-0 animate-pulse text-amber-400" />
                )}
                <div className={cn(
                  'h-0.5 flex-1 rounded-full',
                  delta == null ? 'bg-zinc-700' : movedRight ? 'bg-emerald-500/40' : 'bg-red-500/40'
                )} />
              </div>
              <div className="text-center">
                <div className="text-[9px] uppercase text-zinc-600">{trade.status === 'open' ? 'now →' : 'exit'}</div>
                <div className="text-sm font-bold tabular-nums text-zinc-200">
                  {trade.closePrice != null ? trade.closePrice.toFixed(digits) : '—'}
                </div>
              </div>
            </div>
            {delta != null && (
              <div className="mt-2 flex justify-center gap-3 text-[10px]">
                <span className="text-zinc-600">Δ</span>
                <span className={cn('font-mono font-bold tabular-nums', movedRight ? 'text-emerald-400' : 'text-red-400')}>
                  {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(digits)}
                </span>
                {deltaPct != null && (
                  <span className="font-mono tabular-nums text-zinc-500">
                    ({deltaPct >= 0 ? '+' : '−'}{Math.abs(deltaPct).toFixed(3)}%)
                  </span>
                )}
                <span className={cn('font-semibold', movedRight ? 'text-emerald-400' : 'text-red-400')}>
                  {movedRight ? 'in the money' : 'out of the money'}
                </span>
              </div>
            )}
          </div>

          {/* ── signal breakdown ── */}
          {trade.confidence > 0 && (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <Sparkles className="h-3 w-3 text-amber-400" /> signal breakdown
                </div>
                <div className="flex items-center gap-1.5">
                  {resolved.regime && (
                    <span className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">
                      {resolved.regime === 'trending' ? <Waves className="h-3 w-3 text-emerald-500" /> : <FlaskConical className="h-3 w-3 text-amber-500" />}
                      {resolved.regime}
                    </span>
                  )}
                  {resolved.source === 'db' && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-600" title="Matched from the persisted signal journal">
                      from journal
                    </span>
                  )}
                </div>
              </div>

              {loadingSig ? (
                <div className="py-3 text-center text-[10px] text-zinc-600">matching signal journal…</div>
              ) : resolved.source === 'none' ? (
                <div className="py-2 text-center text-[10px] text-zinc-600">
                  No signal snapshot retained for this trade
                  {trade.source === 'bot' ? ' (pre-v8 history)' : ' (manual entry)'}
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={cn('h-full rounded-full', isCall ? 'bg-emerald-500' : 'bg-red-500')}
                        style={{ width: `${Math.min(100, resolved.confidence)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-zinc-300">{resolved.confidence}%</span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                    {COMPONENT_META.map(c => {
                      const v = resolved.components[c.key]
                      if (typeof v !== 'number' || !isFinite(v)) return null
                      const pct = Math.max(-100, Math.min(100, v * 100))
                      return (
                        <div key={c.key} className="flex items-center gap-2">
                          <span className="w-20 shrink-0 text-[9px] font-bold uppercase tracking-wide text-zinc-500">{c.label}</span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
                            <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-600" />
                            <div
                              className={cn(
                                'comp-bar absolute top-0 h-full rounded-full',
                                v >= 0 ? 'bg-emerald-500/90' : 'bg-red-500/90'
                              )}
                              style={
                                v >= 0
                                  ? { left: '50%', width: `${pct / 2}%` }
                                  : { right: '50%', width: `${-pct / 2}%` }
                              }
                            />
                          </div>
                          <span className={cn(
                            'w-10 shrink-0 text-right font-mono text-[9px] font-bold tabular-nums',
                            v >= 0 ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            {v >= 0 ? '+' : ''}{v.toFixed(2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {resolved.reasons.length > 0 && (
                    <ul className="mt-3 space-y-0.5 border-t border-zinc-800/60 pt-2">
                      {resolved.reasons.slice(0, 12).map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[10px] text-zinc-400">
                          <span className="mt-0.5 text-emerald-600">✓</span>{r}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── timing meta ── */}
          <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
            <Meta icon={<Clock className="h-3 w-3" />} label="opened" value={new Date(trade.openTime).toLocaleTimeString([], { hour12: false })} />
            <Meta icon={<Clock className="h-3 w-3" />} label="closed" value={trade.closeTime ? new Date(trade.closeTime).toLocaleTimeString([], { hour12: false }) : '—'} />
            <Meta icon={<Timer className="h-3 w-3" />} label="duration" value={trade.closeTime ? `${Math.round((trade.closeTime - trade.openTime) / 1000)}s` : `${trade.expirySeconds}s`} />
            <Meta icon={<Hand className="h-3 w-3" />} label="stake" value={`$${trade.amount.toFixed(2)}`} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const COMPONENT_META: { key: keyof SignalComponents; label: string }[] = [
  { key: 'ema', label: 'EMA stack' },
  { key: 'rsi', label: 'RSI' },
  { key: 'stoch', label: 'stoch' },
  { key: 'macd', label: 'MACD' },
  { key: 'bollinger', label: 'bollinger' },
  { key: 'pattern', label: 'pattern' },
  { key: 'sr', label: 'S/R' },
  { key: 'momentum', label: 'momentum' },
  { key: 'mtf', label: 'M5 align' },
  { key: 'htf', label: 'M15 macro' },
]

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-zinc-600">{icon}{label}</div>
      <div className="font-mono text-[11px] font-bold tabular-nums text-zinc-300">{value}</div>
    </div>
  )
}

function priceDigits(p: number): number {
  if (p >= 1000) return 1
  if (p >= 100) return 2
  if (p >= 2) return 3
  if (p >= 0.01) return 4
  return 5
}
