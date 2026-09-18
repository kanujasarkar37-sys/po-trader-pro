'use client'

// ─── Top Movers strip: assets ranked by |% change| over the last 15 min ────
// Broadcast by the engine every 30s from real candle history. Clicking a
// mover chip switches the chart + trade panel to that asset.

import { useTrader } from './store'
import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TopMovers() {
  const movers = useTrader(s => s.movers)
  const chartAsset = useTrader(s => s.chartAsset)
  const setChartAsset = useTrader(s => s.setChartAsset)

  if (!movers.length) return null

  // normalise bar width: biggest |changePct| maps to 100%
  const maxAbs = Math.max(...movers.map(m => Math.abs(m.changePct)), 0.01)

  return (
    <section
      aria-label="Top movers"
      className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-1.5">
        <Flame className="h-3.5 w-3.5 text-orange-500" />
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          Top Movers
        </h2>
        <span className="text-[9px] text-zinc-600">15 min · click to chart</span>
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          <span className="text-[9px] text-zinc-600">engine ranks by absolute move — volatility hunts</span>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto p-2 [scrollbar-width:thin]">
        {movers.map(m => {
          const up = m.changePct >= 0
          const active = m.asset === chartAsset
          const width = Math.round((Math.abs(m.changePct) / maxAbs) * 100)
          return (
            <button
              key={m.asset}
              onClick={() => setChartAsset(m.asset)}
              aria-pressed={active}
              title={`${m.name} — ${m.changePct >= 0 ? '+' : ''}${m.changePct}% over 15 min · payout ${m.payout}%`}
              className={cn(
                'group relative flex w-[104px] shrink-0 flex-col gap-1 overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-all active:scale-[0.97]',
                active
                  ? 'border-emerald-600/80 bg-emerald-950/40 shadow-md shadow-emerald-900/30'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/80'
              )}
            >
              {/* magnitude bar backdrop */}
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-all',
                  up ? 'bg-emerald-500/10' : 'bg-red-500/10'
                )}
                style={{ width: `${width}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-1">
                <span className="truncate text-[10px] font-bold text-zinc-200 group-hover:text-white">
                  {m.name.replace(' OTC', '')}
                </span>
                <span className={cn(
                  'font-mono text-[10px] font-bold tabular-nums',
                  up ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {up ? '▲' : '▼'}
                </span>
              </div>
              <div className="relative flex items-baseline justify-between">
                <span className={cn(
                  'font-mono text-[11px] font-extrabold tabular-nums',
                  up ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {up ? '+' : ''}{m.changePct.toFixed(2)}%
                </span>
                <span className="font-mono text-[9px] text-zinc-500">{m.payout}%</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
