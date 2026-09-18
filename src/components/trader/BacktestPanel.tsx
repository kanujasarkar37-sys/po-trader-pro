'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTrader } from './store'
import { FlaskConical, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BacktestData {
  asset: string; candles: number; trades: number; wins: number; losses: number; draws: number
  winRate: number; totalProfit: number; maxDrawdown: number
  maxWinStreak: number; maxLossStreak: number
  profitCurve: number[]
  confidenceBins: { range: string; trades: number; wins: number; winRate: number }[]
}

export function BacktestPanel({ asset }: { asset: string }) {
  const { backtest, runBacktest, config } = useTrader()
  const data = backtest.result as unknown as BacktestData | null

  // mini sparkline of equity curve
  const spark = useMemo(() => {
    if (!data?.profitCurve?.length) return ''
    const curve = data.profitCurve
    const lo = Math.min(...curve, 0)
    const hi = Math.max(...curve, 0)
    const W = 220, H = 40
    const pts = curve.map((v, i) => {
      const x = (i / Math.max(1, curve.length - 1)) * W
      const y = H - ((v - lo) / (hi - lo || 1)) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const positive = (curve[curve.length - 1] ?? 0) >= 0
    return { path: `M ${pts.join(' L ')}`, zeroY: H - ((0 - lo) / (hi - lo || 1)) * H, positive }
  }, [data?.profitCurve])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
          Strategy Backtest
        </h2>
        <Button
          size="sm"
          onClick={() => runBacktest({ asset, minConfidence: config?.minConfidence ?? 70, expirySeconds: config?.expirySeconds ?? 60 })}
          disabled={backtest.running}
          className="h-6 gap-1 bg-emerald-700 px-2 text-[10px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {backtest.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
          {backtest.running ? 'Replaying…' : 'Run 2000-candle test'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {backtest.error && (
          <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-2 text-[11px] text-red-300">
            {backtest.error}
          </p>
        )}

        {!data && !backtest.running && !backtest.error && (
          <div className="flex h-full flex-col items-center justify-center py-4 text-center">
            <FlaskConical className="mb-2 h-8 w-8 text-zinc-800" />
            <p className="text-[11px] font-medium text-zinc-500">Validate the engine on history</p>
            <p className="mt-1 max-w-[250px] text-[10px] leading-relaxed text-zinc-600">
              Replays the last 2000 candles through the same confluence engine the bot uses,
              entering at candle open and settling at close — showing win-rate, profit curve
              and per-confidence accuracy.
            </p>
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-zinc-700 text-[11px] font-bold text-zinc-200">
                {data.asset}
              </Badge>
              <span className="text-[10px] text-zinc-600">{data.candles} candles · {data.trades} trades</span>
              <span className={cn(
                'ml-auto font-mono text-sm font-extrabold tabular-nums',
                data.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
              )}>
                {data.totalProfit >= 0 ? '+' : ''}{data.totalProfit}$
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <Stat label="Win rate" value={`${data.winRate}%`} tone={data.winRate >= 55 ? 'win' : data.winRate >= 52 ? 'neutral' : 'loss'} />
              <Stat label="W / L / D" value={`${data.wins}/${data.losses}/${data.draws}`} />
              <Stat label="Max DD" value={`${data.maxDrawdown}$`} tone="loss" />
              <Stat label="Streaks" value={`${data.maxWinStreak}▲ ${data.maxLossStreak}▼`} />
            </div>

            {spark && typeof spark === 'object' && (
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2">
                <div className="mb-1 text-[9px] font-bold uppercase text-zinc-600">Equity curve</div>
                <svg viewBox="0 0 220 40" className="h-12 w-full" preserveAspectRatio="none" aria-label="Backtest equity curve">
                  <line x1="0" y1={spark.zeroY} x2="220" y2={spark.zeroY} stroke="#52525b" strokeWidth="0.5" strokeDasharray="2,2" />
                  <path d={spark.path} fill="none" stroke={spark.positive ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
                </svg>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[9px] font-bold uppercase text-zinc-600">Accuracy by confidence</div>
              <div className="space-y-1">
                {data.confidenceBins.map((b) => (
                  <div key={b.range} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-right font-mono text-[10px] text-zinc-500">{b.range}%</span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded bg-zinc-900">
                      <div
                        className={cn('h-full rounded', b.winRate >= 55 ? 'bg-emerald-600' : b.winRate >= 52 ? 'bg-amber-600' : 'bg-red-700')}
                        style={{ width: `${Math.min(100, b.winRate)}%` }}
                      />
                      <div className="absolute inset-y-0 left-[52.1%] w-px bg-zinc-500" title="breakeven 52.1%" />
                    </div>
                    <span className={cn(
                      'w-14 shrink-0 font-mono text-[10px] font-bold tabular-nums',
                      b.winRate >= 55 ? 'text-emerald-400' : b.winRate >= 52 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      {b.trades ? `${b.winRate}%` : '—'}
                    </span>
                    <span className="w-8 shrink-0 text-[9px] text-zinc-600">{b.trades}t</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-zinc-600">
                Vertical marker = breakeven win-rate at 92% payout (52.1%).
                {data.maxLossStreak > 4 && ' ⚠ Consider martingale limits — loss streaks detected.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'win' | 'loss' | 'neutral' }) {
  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-900/50 px-1.5 py-1 text-center">
      <div className="text-[8px] font-bold uppercase text-zinc-600">{label}</div>
      <div className={cn(
        'font-mono text-[11px] font-bold tabular-nums',
        tone === 'win' ? 'text-emerald-400' : tone === 'loss' ? 'text-red-400' : 'text-zinc-200'
      )}>{value}</div>
    </div>
  )
}
