'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTrader } from './store'
import { Brain, Sparkles, TrendingUp, TrendingDown, Minus, Loader2, CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export function AIAdvisor({ asset }: { asset: string }) {
  const { analysis, runAnalysis, candles, signals } = useTrader()
  const [lastAsset, setLastAsset] = useState('')

  const analyze = () => {
    setLastAsset(asset)
    const lastSignal = [...signals].reverse().find(s => s.asset === asset)
    const recent = candles.slice(-30)
    runAnalysis({
      asset,
      indicators: lastSignal ? undefined : undefined,
      candles: recent.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
      confidence: lastSignal?.confidence,
      direction: lastSignal?.direction,
    })
  }

  const data = analysis.data as {
    bias?: string; agreement?: string; entry?: string; reasoning?: string; riskNote?: string
    levels?: { support?: number; resistance?: number }
  } | null
  const isForThisAsset = !!data && lastAsset === asset

  const biasTone = data?.bias === 'bullish' ? 'emerald' : data?.bias === 'bearish' ? 'red' : 'zinc'
  const entryTone = data?.entry === 'call' ? 'emerald' : data?.entry === 'put' ? 'red' : 'zinc'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Brain className="h-3.5 w-3.5 text-emerald-500" />
          AI Advisor
        </h2>
        <Button
          size="sm"
          onClick={analyze}
          disabled={analysis.running || candles.length < 5}
          className="h-6 gap-1 bg-emerald-700 px-2 text-[10px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {analysis.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {analysis.running ? 'Analyzing…' : `Analyze ${asset}`}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {analysis.error && (
          <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
            <div>
              <p className="text-[11px] font-semibold text-zinc-400">{analysis.error}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
                The LLM backend is offline in this environment. All technical signals, the bot and
                backtests keep working normally.
              </p>
            </div>
          </div>
        )}

        {!isForThisAsset && (
          <div className="flex h-full flex-col items-center justify-center py-6 text-center">
            <Brain className="mb-2 h-8 w-8 text-zinc-800" />
            <p className="text-[11px] font-medium text-zinc-500">
              Get an LLM-powered second opinion
            </p>
            <p className="mt-1 max-w-[240px] text-[10px] leading-relaxed text-zinc-600">
              Combines the last 30 candles, indicator snapshot and latest web news into a structured
              CALL / PUT / WAIT recommendation
            </p>
          </div>
        )}

        {isForThisAsset && data && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn(
                'gap-1 font-bold',
                biasTone === 'emerald' ? 'bg-emerald-950/60 text-emerald-400' : biasTone === 'red' ? 'bg-red-950/60 text-red-400' : 'bg-zinc-800 text-zinc-300'
              )}>
                {data.bias === 'bullish' ? <TrendingUp className="h-3 w-3" /> : data.bias === 'bearish' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                {data.bias?.toUpperCase() ?? 'N/A'}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
                agreement: {data.agreement ?? '—'}
              </Badge>
              {data.entry && (
                <Badge className={cn(
                  'font-extrabold',
                  entryTone === 'emerald' ? 'bg-emerald-600 text-white' : entryTone === 'red' ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-200'
                )}>
                  {data.entry === 'wait' ? '⏸ WAIT' : data.entry === 'call' ? '▲ CALL' : '▼ PUT'}
                </Badge>
              )}
            </div>

            {data.reasoning && (
              <p className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2.5 text-[11px] leading-relaxed text-zinc-300">
                {data.reasoning}
              </p>
            )}

            {data.riskNote && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2 text-[10px] leading-relaxed text-amber-300/90">
                <span>⚠</span>
                {data.riskNote}
              </p>
            )}

            {data.levels && (data.levels.support != null || data.levels.resistance != null) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2 text-center">
                  <div className="text-[9px] font-bold uppercase text-emerald-600">Support</div>
                  <div className="font-mono text-xs font-bold text-emerald-400">{data.levels.support ?? '—'}</div>
                </div>
                <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-2 text-center">
                  <div className="text-[9px] font-bold uppercase text-red-600">Resistance</div>
                  <div className="font-mono text-xs font-bold text-red-400">{data.levels.resistance ?? '—'}</div>
                </div>
              </div>
            )}

            <p className="text-[9px] text-zinc-600">
              AI-generated analysis of {lastAsset} — educational tool, not financial advice.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
