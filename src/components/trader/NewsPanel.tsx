'use client'

import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTrader } from './store'
import { Newspaper, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export function NewsPanel() {
  const { news, refreshNews } = useTrader()

  useEffect(() => {
    refreshNews()
    const t = setInterval(() => refreshNews(), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [refreshNews])

  const biasEntries = Object.entries(news?.bias ?? {})
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))

  const aiOffline = news && (news.aiAvailable === false) && (!news.headlines || news.headlines.length === 0)
  const hasHeadlines = (news?.headlines?.length ?? 0) > 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Newspaper className="h-3.5 w-3.5 text-emerald-500" />
          Market News & AI Bias
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={refreshNews}
          className="h-6 w-6 p-0 text-zinc-500 hover:text-emerald-400"
          aria-label="Refresh news"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {news?.highImpact && (
        <div className="flex items-center gap-2 border-b border-amber-900/40 bg-amber-950/30 px-3 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="text-[10px] font-semibold text-amber-300">
            High-impact event detected — news filter raises the bot confidence bar (+5%)
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-2.5">
          {aiOffline && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-3 py-5 text-center">
              <CloudOff className="h-7 w-7 text-zinc-700" />
              <p className="text-[11px] font-semibold text-zinc-400">News feed offline</p>
              <p className="max-w-[230px] text-[10px] leading-relaxed text-zinc-600">
                The AI news backend is currently unavailable. The signal engine keeps running on
                pure technical confluence — no news bias is applied.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={refreshNews}
                className="h-6 gap-1 border-zinc-700 px-2 text-[10px] font-semibold text-zinc-400 hover:border-emerald-800 hover:text-emerald-400"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {biasEntries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {biasEntries.slice(0, 10).map(([cur, v]) => (
                <Badge
                  key={cur}
                  variant="outline"
                  className={cn(
                    'gap-1 border px-1.5 text-[10px] font-bold tabular-nums',
                    v > 0.15 ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400'
                      : v < -0.15 ? 'border-red-800/60 bg-red-950/40 text-red-400'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                  )}
                  title={`${cur} news bias: ${v > 0 ? 'bullish' : v < 0 ? 'bearish' : 'neutral'}`}
                >
                  {v > 0.15 ? <TrendingUp className="h-2.5 w-2.5" /> : v < -0.15 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                  {cur} {(v * 100).toFixed(0)}
                </Badge>
              ))}
            </div>
          )}

          {news?.summary && (
            <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5 text-[11px] leading-relaxed text-zinc-300">
              {news.summary}
            </p>
          )}

          <div className="space-y-1.5">
            {!hasHeadlines && !aiOffline && (
              <p className="py-4 text-center text-[11px] text-zinc-600">Loading news…</p>
            )}
            {news?.headlines?.map((h, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2">
                <span className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold',
                  h.sentiment === 'bullish' ? 'bg-emerald-950/70 text-emerald-400'
                    : h.sentiment === 'bearish' ? 'bg-red-950/70 text-red-400'
                    : 'bg-zinc-800 text-zinc-500'
                )}>
                  {h.sentiment === 'bullish' ? '▲' : h.sentiment === 'bearish' ? '▼' : '='}
                </span>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[11px] font-medium leading-snug text-zinc-300">{h.title}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-600">{h.source}</p>
                </div>
              </div>
            ))}
          </div>

          {news?.updatedAt && (
            <p className="text-right text-[9px] text-zinc-600">
              Updated {new Date(news.updatedAt).toLocaleTimeString([], { hour12: false })}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
