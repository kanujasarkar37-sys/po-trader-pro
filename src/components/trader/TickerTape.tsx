'use client'

import { useMemo } from 'react'
import { useTrader } from './store'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TickerTape() {
  const assets = useTrader(s => s.assets)
  const prices = useTrader(s => s.prices)
  const priceDirs = useTrader(s => s.priceDirs)
  const mode = useTrader(s => s.mode)
  const setChartAsset = useTrader(s => s.setChartAsset)

  const items = useMemo(() => {
    const withPrice = assets.filter(a => prices[a.asset] != null)
    // show top-payout open assets first, cap for perf
    const sorted = [...withPrice].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0))
    return sorted.slice(0, 18)
  }, [assets, prices])

  if (!items.length) return null

  const renderItem = (a: typeof items[number], key: string) => {
    const price = prices[a.asset]
    const dir = priceDirs[a.asset] ?? 1
    const up = dir === 1
    return (
      <button
        key={key}
        onClick={() => setChartAsset(a.asset)}
        className="group flex shrink-0 items-center gap-1.5 border-r border-zinc-800/60 px-4 py-1 transition-colors hover:bg-zinc-900/60"
        title={`View ${a.name} chart`}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 group-hover:text-zinc-200">
          {a.name.replace(/\s+/g, '')}
        </span>
        <span
          className={cn(
            'font-mono text-[11px] font-bold tabular-nums',
            up ? 'text-emerald-400' : 'text-red-400'
          )}
        >
          {price >= 1000 ? price.toFixed(1) : price >= 100 ? price.toFixed(2) : price >= 2 ? price.toFixed(3) : price.toFixed(4)}
        </span>
        <span className={cn('flex items-center', up ? 'text-emerald-500' : 'text-red-500')}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        </span>
        <span className="rounded bg-zinc-900 px-1 text-[8px] font-bold text-amber-500/80">{a.payout}%</span>
      </button>
    )
  }

  return (
    <div
      className="relative overflow-hidden border-b border-zinc-800/80 bg-zinc-950"
      role="marquee"
      aria-label="Live market prices ticker"
    >
      {/* left mode badge */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 flex h-full items-center gap-1.5 border-r border-zinc-800/60 bg-zinc-950 px-3 pr-4">
        <span className={cn(
          'h-1.5 w-1.5 rounded-full',
          mode === 'live' ? 'bg-emerald-500 price-glow' : mode === 'simulation' ? 'bg-amber-500 price-glow' : 'bg-zinc-700'
        )} />
        <span className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-zinc-500">
          {mode === 'live' ? 'Live' : mode === 'simulation' ? 'Sim' : 'Offline'}
        </span>
      </div>
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-14 z-10 w-8 bg-gradient-to-r from-zinc-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-zinc-950 to-transparent" />

      <div className="ticker-track flex w-max pl-16">
        {items.map(a => renderItem(a, `a-${a.asset}`))}
        {items.map(a => renderItem(a, `b-${a.asset}`))}
      </div>
    </div>
  )
}
