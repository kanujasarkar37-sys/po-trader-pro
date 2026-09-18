'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTrader } from './store'
import { TrendingUp, TrendingDown, Radar, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const CATEGORY_LABEL: Record<string, string> = {
  all: 'All', otc: 'OTC Pairs', forex: 'Forex', crypto: 'Crypto',
  commodity: 'Commodities', stock: 'Stocks', index: 'Indices',
}

// ─── rolling price history for sparklines (module-level: survives re-renders) ───
const SPARK_N = 28
const sparkBuffers = new Map<string, number[]>()

function pushSpark(prices: Record<string, number>) {
  for (const [asset, p] of Object.entries(prices)) {
    if (!isFinite(p) || p <= 0) continue
    const buf = sparkBuffers.get(asset) ?? []
    if (buf.length === 0 || buf[buf.length - 1] !== p) {
      buf.push(p)
      if (buf.length > SPARK_N) buf.shift()
      sparkBuffers.set(asset, buf)
    }
  }
}

function Sparkline({ asset, className }: { asset: string; className?: string }) {
  const buf = sparkBuffers.get(asset)
  if (!buf || buf.length < 4) {
    return <div className={cn('h-4 w-[54px] rounded bg-zinc-900/60', className)} aria-hidden />
  }
  const min = Math.min(...buf), max = Math.max(...buf)
  const range = max - min || min * 0.0001 || 1
  const W = 54, H = 16, pad = 1.5
  const pts = buf.map((v, i) => {
    const px = pad + (i / (buf.length - 1)) * (W - pad * 2)
    const py = pad + (1 - (v - min) / range) * (H - pad * 2)
    return `${px.toFixed(1)},${py.toFixed(1)}`
  })
  const up = buf[buf.length - 1] >= buf[0]
  const stroke = up ? '#34d399' : '#f87171'
  const fill = up ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)'
  const chg = min > 0 ? ((buf[buf.length - 1] - buf[0]) / buf[0]) * 100 : 0
  return (
    <svg
      width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      className={cn('shrink-0', className)}
      aria-label={`Recent price trend ${up ? 'up' : 'down'} ${chg.toFixed(2)}%`}
      role="img"
    >
      <polygon points={`${pad},${H - pad} ${pts.join(' ')} ${W - pad},${H - pad}`} fill={fill} />
      <polyline
        points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.3"
        strokeLinejoin="round" strokeLinecap="round"
        className="spark-line"
        style={{ ['--spark-len' as string]: `${W + 8}` }}
      />
      <circle cx={W - pad} cy={pts[pts.length - 1].split(',')[1]} r="1.5" fill={stroke} />
    </svg>
  )
}

export function MarketWatch() {
  const { assets, prices, chartAsset, setChartAsset, config, updateConfig, signals } = useTrader()
  const [category, setCategory] = useState('otc')
  const [query, setQuery] = useState('')

  const selected = config?.selectedAssets ?? []

  // feed the sparkline buffers on every price flush (250ms batch)
  useEffect(() => {
    pushSpark(prices)
  }, [prices])
  const [, forceRender] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceRender(v => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    let list = assets
    if (category !== 'all') list = list.filter(a => a.category === category)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(a => a.asset.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    }
    return list
  }, [assets, category, query])

  // last price direction per asset (compare against previous tick)
  const priceMap = prices
  const recentSignals = useMemo(() => {
    const m = new Map<string, 'call' | 'put' | null>()
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i]
      if (!m.has(s.asset)) m.set(s.asset, s.confidence >= (config?.minConfidence ?? 70) ? s.direction : null)
    }
    return m
  }, [signals, config?.minConfidence])

  const toggleScan = (asset: string) => {
    const next = selected.includes(asset)
      ? selected.filter(a => a !== asset)
      : [...selected, asset].slice(0, 25)
    updateConfig({ selectedAssets: next })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Radar className="h-3.5 w-3.5 text-emerald-500" />
          Market Watch
        </h2>
        <Badge variant="outline" className="border-emerald-800/60 bg-emerald-950/40 text-[10px] text-emerald-400">
          {selected.length} scanning
        </Badge>
      </div>

      <div className="space-y-2 border-b border-zinc-800/80 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            id="pair-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pair…  ( / )"
            className="h-7 border-zinc-800 bg-zinc-900 pl-7 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="h-7 w-full justify-start gap-0.5 bg-zinc-900 p-0.5">
            {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-6 px-1.5 text-[10px] font-semibold text-zinc-500 data-[state=active]:bg-emerald-900/50 data-[state=active]:text-emerald-300"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-zinc-900">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">No pairs found</p>
          )}
          {filtered.map((a) => {
            const price = priceMap[a.asset] ?? a.price ?? 0
            const sig = recentSignals.get(a.asset)
            const isChart = chartAsset === a.asset
            const isScan = selected.includes(a.asset)
            return (
              <div
                key={a.asset}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-zinc-900/70',
                  isChart && 'bg-emerald-950/20'
                )}
                onClick={() => setChartAsset(a.asset)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setChartAsset(a.asset) }}
                aria-label={`Select ${a.name} chart`}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleScan(a.asset) }}
                  aria-label={isScan ? `Remove ${a.asset} from bot scan` : `Add ${a.asset} to bot scan`}
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    isScan
                      ? 'border-emerald-500 bg-emerald-600 text-white'
                      : 'border-zinc-700 bg-zinc-900 text-transparent hover:border-emerald-700'
                  )}
                >
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-current stroke-[2.5]">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-zinc-200">{a.asset}</span>
                    {!a.open && <span className="text-[9px] font-bold text-red-500">CLOSED</span>}
                  </div>
                  <span className="text-[10px] text-zinc-500">{a.name}</span>
                </div>

                <Sparkline asset={a.asset} className="hidden sm:block" />

                <div className="flex flex-col items-end">
                  <span className="font-mono text-xs font-medium tabular-nums text-zinc-100">
                    {formatPrice(price, a.asset)}
                  </span>
                  <span className={cn(
                    'text-[9px] font-bold tabular-nums',
                    a.payout >= 90 ? 'text-emerald-400' : a.payout >= 85 ? 'text-amber-400' : 'text-zinc-500'
                  )}>
                    {a.payout}%
                  </span>
                </div>

                {sig && (
                  <div className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full',
                    sig === 'call' ? 'bg-emerald-950/60 text-emerald-400' : 'bg-red-950/60 text-red-400'
                  )} title={`Recent ${sig.toUpperCase()} signal`}>
                    {sig === 'call' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-zinc-800/80 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-6 w-full border-zinc-800 bg-zinc-900 text-[10px] font-semibold text-zinc-400 hover:border-emerald-800 hover:text-emerald-300"
          onClick={() => updateConfig({ selectedAssets: filtered.filter(a => a.open).slice(0, 25).map(a => a.asset) })}
        >
          Scan all {filtered.length} in view
        </Button>
      </div>
    </div>
  )
}

function formatPrice(price: number, asset: string): string {
  if (!price || !isFinite(price)) return '—'
  if (price >= 1000) return price.toFixed(1)
  if (price >= 100) return price.toFixed(2)
  if (price >= 2) return price.toFixed(3)
  if (price >= 0.01) return price.toFixed(4)
  return price.toFixed(5)
}
