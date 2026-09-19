'use client'

// ─── AI Strategy Lab ─────────────────────────────────────────────────────────
// AI strategy generation (live-feed aware), strategy upload (JSON) and REAL
// backtesting over historical M1 candles fetched from the trading engine.

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTrader } from './store'
import { backtestStrategy, type Candle, type StrategyBacktestResult } from '@/lib/strategy-backtest'
import {
  parseStrategy, formatCondition, STRATEGY_DOCS,
  type Strategy, type StrategySide,
} from '@/lib/strategy-schema'
import { toast } from 'sonner'
import {
  Sparkles, Brain, Upload, FlaskConical, Play, Trash2, Save, Loader2,
  TrendingUp, TrendingDown, ArrowLeft, AlertTriangle, CheckCircle2, FileJson, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const EXAMPLE_STRATEGY_JSON = `{
  "name": "RSI Extreme Reversal",
  "description": "Mean reversion from oversold/overbought extremes with Bollinger band confirmation. Best in ranging, liquid sessions.",
  "author": "user",
  "rules": {
    "indicators": {
      "emaPeriods": [9, 21, 50],
      "rsiPeriod": 14,
      "bollingerPeriod": 20,
      "bollingerMult": 2,
      "stochK": 14,
      "stochD": 3,
      "atrPeriod": 14,
      "macdFast": 12,
      "macdSlow": 26,
      "macdSignal": 9
    },
    "call": {
      "all": [
        { "left": "rsi", "op": "<", "right": 32 },
        { "left": "close", "op": "<", "right": "bbLower" }
      ],
      "any": []
    },
    "put": {
      "all": [
        { "left": "rsi", "op": ">", "right": 68 },
        { "left": "close", "op": ">", "right": "bbUpper" }
      ],
      "any": []
    },
    "filters": { "minAtrPct": 0.01, "maxAtrPct": 0.3 },
    "expirySeconds": 60
  }
}`

const fmtPrice = (n: number) =>
  n >= 1000 ? n.toFixed(1) : n >= 10 ? n.toFixed(3) : n.toFixed(5)

// ─── main panel ─────────────────────────────────────────────────────────────

export function StrategyLab({ asset }: { asset: string }) {
  const socket = useTrader(s => s.socket)
  const candles = useTrader(s => s.candles)
  const movers = useTrader(s => s.movers)
  const stats = useTrader(s => s.stats)
  const signals = useTrader(s => s.signals)
  const mode = useTrader(s => s.mode)

  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<Strategy | null>(null)

  const [library, setLibrary] = useState<Strategy[]>([])
  const [loadingLib, setLoadingLib] = useState(true)
  const [selected, setSelected] = useState<Strategy | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [uploadJson, setUploadJson] = useState('')
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploadValid, setUploadValid] = useState<Strategy | null>(null)
  const [fileName, setFileName] = useState('')
  const [savingUpload, setSavingUpload] = useState(false)

  const [btRunning, setBtRunning] = useState(false)
  const [btFor, setBtFor] = useState<'generated' | 'library' | null>(null)
  const [btStrategy, setBtStrategy] = useState<Strategy | null>(null)
  const [btResult, setBtResult] = useState<StrategyBacktestResult | null>(null)
  const [btError, setBtError] = useState<string | null>(null)
  const [savingStats, setSavingStats] = useState(false)
  const btToken = useRef(0)

  // ── library load (on mount) ──
  const loadLibrary = useCallback(async () => {
    setLoadingLib(true)
    try {
      const r = await fetch('/api/strategies')
      const d = (await r.json()) as { ok: boolean; strategies?: Strategy[] }
      if (d.ok && Array.isArray(d.strategies)) setLibrary(d.strategies)
    } catch {
      /* library stays empty — surfaced by the empty state */
    } finally {
      setLoadingLib(false)
    }
  }, [])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  // ── AI generation ──
  const generate = async () => {
    if (generating || prompt.trim().length < 3) return
    setGenerating(true)
    setGenerated(null)
    try {
      const last = signals.length ? signals[signals.length - 1] : null
      const feed = {
        asset,
        mode,
        recentCandles: candles.slice(-120).map(c => ({
          time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
        })),
        movers: movers.slice(0, 8).map(m => ({ asset: m.asset, changePct: m.changePct })),
        topSignal: last ? { asset: last.asset, direction: last.direction, confidence: last.confidence } : undefined,
        winRate: stats?.winRate,
        trades: stats?.totalTrades,
      }
      const r = await fetch('/api/strategy/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), feed }),
      })
      const d = (await r.json()) as { ok: boolean; strategy?: Strategy; errors?: string[] }
      if (d.ok && d.strategy) {
        setGenerated(d.strategy)
        toast.success('Strategy generated', { description: d.strategy.name })
      } else {
        toast.error('Generation failed', {
          description: (d.errors ?? []).join(' · ') || 'Try rephrasing your prompt',
        })
      }
    } catch {
      toast.error('AI backend unreachable', { description: 'The generation service did not respond' })
    } finally {
      setGenerating(false)
    }
  }

  // ── save (create or upsert by id) ──
  const saveStrategy = async (s: Strategy): Promise<Strategy | null> => {
    try {
      const r = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: s }),
      })
      const d = (await r.json()) as { ok: boolean; strategy?: Strategy; errors?: string[] }
      if (d.ok && d.strategy) {
        const saved = d.strategy
        setLibrary(prev => {
          const i = prev.findIndex(x => x.id === saved.id)
          if (i >= 0) {
            const next = [...prev]
            next[i] = saved
            return next
          }
          return [saved, ...prev]
        })
        return saved
      }
      toast.error('Save failed', { description: (d.errors ?? []).join(' · ') })
      return null
    } catch {
      toast.error('Save failed', { description: 'Strategy API unreachable' })
      return null
    }
  }

  const removeStrategy = async (id: string) => {
    setDeleting(id)
    try {
      const r = await fetch(`/api/strategies/${id}`, { method: 'DELETE' })
      const d = (await r.json()) as { ok: boolean; errors?: string[] }
      if (d.ok) {
        setLibrary(prev => prev.filter(x => x.id !== id))
        if (selected?.id === id) {
          setSelected(null)
          if (btFor === 'library') { setBtResult(null); setBtError(null); setBtFor(null) }
        }
        toast.success('Strategy deleted')
      } else {
        toast.error(d.errors?.[0] ?? 'Delete failed')
      }
    } catch {
      toast.error('Delete failed', { description: 'Strategy API unreachable' })
    } finally {
      setDeleting(null)
    }
  }

  // ── REAL backtest over engine candle history ──
  const runBacktest = (s: Strategy, source: 'generated' | 'library') => {
    if (btRunning) return
    if (!socket || !socket.connected) {
      toast.error('Trading engine not connected', { description: 'Connect the engine so candle history can be fetched' })
      return
    }
    const token = ++btToken.current
    setBtRunning(true)
    setBtError(null)
    setBtResult(null)
    setBtFor(source)
    setBtStrategy(s)
    let settled = false
    const guard = setTimeout(() => {
      if (settled || token !== btToken.current) return
      settled = true
      setBtRunning(false)
      setBtError('Candle fetch timed out — is the trading engine still connected?')
    }, 20000)
    socket.emit(
      'candles:fetch',
      { asset, count: 1500 },
      (r: { ok?: boolean; candles?: Candle[]; total?: number; error?: string | null }) => {
        if (settled || token !== btToken.current) return
        settled = true
        clearTimeout(guard)
        setBtRunning(false)
        if (r?.ok && r.candles?.length) {
          try {
            const result = backtestStrategy(r.candles, s, 92, asset)
            setBtResult(result)
            if (result.trades === 0) {
              toast.info('Backtest complete — 0 trades', {
                description: 'Conditions never matched this history. Try looser conditions or filters.',
              })
            } else {
              toast.success('Backtest complete', {
                description: `${result.trades} trades · ${result.winRate}% WR · ${result.totalProfit >= 0 ? '+' : ''}${result.totalProfit}$ on ${result.asset}`,
              })
            }
          } catch {
            setBtError('Backtest engine error — malformed strategy')
          }
        } else {
          setBtError(r?.error ?? `No candle history for ${asset}`)
          toast.error('No candle history', {
            description: 'Open the asset in Market Watch first, or try the chart asset.',
          })
        }
      }
    )
  }

  const saveStats = async () => {
    if (!btResult) return
    setSavingStats(true)
    // prefer the live object from the launching view — it may have gained an
    // id via "Save to Library" after the backtest was launched
    const live = btFor === 'generated' ? generated : btFor === 'library' ? selected : null
    const base = live ?? btStrategy
    if (!base) { setSavingStats(false); return }
    const updated: Strategy = {
      ...base,
      stats: {
        trades: btResult.trades,
        winRate: btResult.winRate,
        profit: btResult.totalProfit,
        asset: btResult.asset,
        testedAt: Date.now(),
      },
    }
    const saved = await saveStrategy(updated)
    if (saved) {
      setBtStrategy(saved)
      if (btFor === 'generated') setGenerated(g => (g ? saved : g))
      if (btFor === 'library') setSelected(sel => (sel ? saved : sel))
      toast.success('Stats saved', {
        description: `${btResult.winRate}% WR · ${btResult.trades} trades on ${btResult.asset}`,
      })
    }
    setSavingStats(false)
  }

  // ── upload validation ──
  const validateUpload = useCallback((text: string): Strategy | null => {
    if (!text.trim()) {
      setUploadErrors([])
      setUploadValid(null)
      return null
    }
    try {
      const obj: unknown = JSON.parse(text)
      const v = parseStrategy(obj)
      if (v.ok) {
        setUploadErrors([])
        setUploadValid(v.strategy)
        return v.strategy
      }
      setUploadErrors(v.errors)
      setUploadValid(null)
      return null
    } catch (e) {
      setUploadErrors([`Invalid JSON: ${(e as Error).message}`])
      setUploadValid(null)
      return null
    }
  }, [])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      setFileName(f.name)
      setUploadJson(text)
      validateUpload(text)
    } catch {
      toast.error('Could not read file')
    }
    e.target.value = '' // allow re-selecting the same file
  }

  const saveUpload = async () => {
    const s = uploadValid ?? validateUpload(uploadJson)
    if (!s) {
      toast.error('Fix validation errors first', { description: 'The JSON does not match the strategy schema' })
      return
    }
    setSavingUpload(true)
    const saved = await saveStrategy(s)
    if (saved) {
      toast.success('Strategy uploaded to library', { description: saved.name })
      setUploadJson('')
      setUploadValid(null)
      setFileName('')
    }
    setSavingUpload(false)
  }

  const feedCount = Math.min(candles.length, 120)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
          AI Strategy Lab
        </h2>
        <Badge variant="outline" className="border-zinc-800 px-1.5 text-[9px] font-bold text-zinc-500">
          <Brain className="mr-1 h-2.5 w-2.5" /> REAL BACKTEST
        </Badge>
      </div>

      <Tabs defaultValue="ai" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b border-zinc-800/80 bg-zinc-950 px-2.5 py-2">
          <TabsList className="h-7 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5">
            <TabsTrigger
              value="ai"
              className="h-6 gap-1 rounded-md px-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 data-[state=active]:border-emerald-900/60 data-[state=active]:bg-emerald-950/50 data-[state=active]:text-emerald-400"
            >
              <Sparkles className="h-3 w-3" /> AI Studio
            </TabsTrigger>
            <TabsTrigger
              value="library"
              className="h-6 gap-1 rounded-md px-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 data-[state=active]:border-emerald-900/60 data-[state=active]:bg-emerald-950/50 data-[state=active]:text-emerald-400"
            >
              <FileJson className="h-3 w-3" /> Library
              {library.length > 0 && (
                <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{library.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="upload"
              className="h-6 gap-1 rounded-md px-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 data-[state=active]:border-emerald-900/60 data-[state=active]:bg-emerald-950/50 data-[state=active]:text-emerald-400"
            >
              <Upload className="h-3 w-3" /> Upload
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── AI STUDIO ─────────────────────────────────────────── */}
        <TabsContent value="ai" className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-2 py-1.5">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
            <p className="text-[10px] leading-tight text-emerald-300/90">
              live feed attached: <span className="font-mono font-bold">{feedCount}</span> M1 candles ·{' '}
              <span className="font-mono font-bold">{movers.length}</span> movers ·{' '}
              {stats ? <>bot <span className="font-mono font-bold">{stats.winRate}%</span> WR</> : 'bot idle'}
              {feedCount < 30 && <span className="text-amber-400/80"> — open an asset in Market Watch for a richer feed</span>}
            </p>
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. create a mean-reversion strategy for ranging markets using RSI extremes and Bollinger bands, avoid trending hours…"
            rows={3}
            className="resize-none border-zinc-800 bg-zinc-900/50 text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-900/50"
          />

          <Button
            onClick={generate}
            disabled={generating || prompt.trim().length < 3}
            className="mt-2 h-7 w-full gap-1.5 bg-emerald-700 text-[11px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generating ? 'Designing strategy…' : 'Generate strategy'}
          </Button>

          {generated && (
            <div className="mt-3 space-y-2.5">
              <StrategyCard strategy={generated} />
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  onClick={async () => { const saved = await saveStrategy(generated); if (saved) { setGenerated(saved); toast.success('Saved to library', { description: saved.name }) } }}
                  className="h-7 gap-1 bg-zinc-800 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700"
                >
                  <Save className="h-3 w-3" /> Save to Library
                </Button>
                <Button
                  onClick={() => runBacktest(generated, 'generated')}
                  disabled={btRunning}
                  className="h-7 gap-1 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
                >
                  {btRunning && btFor === 'generated' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Backtest on {asset}
                </Button>
                <Button
                  onClick={generate}
                  disabled={generating}
                  className="h-7 gap-1 bg-zinc-800 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700 disabled:text-zinc-600"
                >
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Regenerate
                </Button>
              </div>
              {btFor === 'generated' && (
                <BacktestResults
                  running={btRunning}
                  result={btResult}
                  error={btError}
                  onSaveStats={saveStats}
                  savingStats={savingStats}
                  statsSaved={!!generated.stats?.testedAt}
                />
              )}
            </div>
          )}

          {!generated && !generating && (
            <div className="mt-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800/80 py-4 text-center">
              <Brain className="mb-1.5 h-7 w-7 text-zinc-800" />
              <p className="text-[11px] font-medium text-zinc-500">Describe a trading idea — the AI builds it</p>
              <p className="mt-1 max-w-[260px] text-[10px] leading-relaxed text-zinc-600">
                The prompt is combined with the live market feed (120 M1 candles, volatility, movers, bot stats)
                and validated against the strategy schema. Then backtest it on real candle history.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── LIBRARY ────────────────────────────────────────────── */}
        <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {selected ? (
            <div className="space-y-2.5">
              <button
                onClick={() => { setSelected(null); if (btFor === 'library') { setBtResult(null); setBtError(null); setBtFor(null) } }}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 hover:text-emerald-400"
              >
                <ArrowLeft className="h-3 w-3" /> All strategies
              </button>
              <StrategyCard strategy={selected} />
              <Button
                onClick={() => runBacktest(selected, 'library')}
                disabled={btRunning}
                className="h-7 w-full gap-1.5 bg-emerald-700 text-[11px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {btRunning && btFor === 'library' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Backtest on {asset}
              </Button>
              {btFor === 'library' && (
                <BacktestResults
                  running={btRunning}
                  result={btResult}
                  error={btError}
                  onSaveStats={saveStats}
                  savingStats={savingStats}
                  statsSaved={!!selected.stats?.testedAt}
                />
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {loadingLib && (
                <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading library…
                </div>
              )}
              {!loadingLib && library.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800/80 py-5 text-center">
                  <FileJson className="mb-1.5 h-7 w-7 text-zinc-800" />
                  <p className="text-[11px] font-medium text-zinc-500">No saved strategies yet</p>
                  <p className="mt-1 max-w-[240px] text-[10px] leading-relaxed text-zinc-600">
                    Generate one in AI Studio or upload a JSON strategy — then backtest it on real candles.
                  </p>
                </div>
              )}
              {!loadingLib && library.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-stretch gap-1"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => { setSelected(s); setBtResult(null); setBtError(null); setBtFor(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(s); setBtResult(null); setBtError(null); setBtFor(null) } }}
                    className="min-w-0 flex-1 cursor-pointer rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2 transition-colors hover:border-emerald-900/60 hover:bg-zinc-900/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-bold text-zinc-200">{s.name}</span>
                      <Badge className={cn(
                        'h-4 shrink-0 px-1 text-[8px] font-extrabold',
                        s.author === 'ai' ? 'bg-emerald-950/70 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                      )}>
                        {s.author === 'ai' ? 'AI' : 'USER'}
                      </Badge>
                    </div>
                    {s.description && (
                      <p className="mt-0.5 truncate text-[10px] text-zinc-500">{s.description}</p>
                    )}
                    {s.stats && (s.stats.trades ?? 0) > 0 ? (
                      <p className={cn(
                        'mt-1 font-mono text-[10px] font-bold tabular-nums',
                        (s.stats.winRate ?? 0) > 55 ? 'text-emerald-400' : (s.stats.winRate ?? 0) < 50 ? 'text-red-400' : 'text-amber-400'
                      )}>
                        {s.stats.winRate}% WR · {s.stats.trades}t · {s.stats.profit != null ? `${s.stats.profit >= 0 ? '+' : ''}${s.stats.profit}$` : ''} · {s.stats.asset}
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] italic text-zinc-600">not tested yet</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => s.id && removeStrategy(s.id)}
                    disabled={!s.id || deleting === s.id}
                    aria-label={`Delete ${s.name}`}
                    className="h-auto w-7 shrink-0 justify-center rounded-lg border-zinc-800 bg-zinc-900/40 p-0 text-zinc-600 hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-400"
                  >
                    {deleting === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── UPLOAD ─────────────────────────────────────────────── */}
        <TabsContent value="upload" className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-3 text-[11px] font-medium text-zinc-400 transition-colors hover:border-emerald-800 hover:text-emerald-400">
            <Upload className="h-3.5 w-3.5" />
            {fileName || 'Choose a .json strategy file'}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={onFile}
            />
          </label>

          <Textarea
            value={uploadJson}
            onChange={(e) => { setUploadJson(e.target.value); validateUpload(e.target.value) }}
            placeholder='…or paste strategy JSON here — see "Schema help" below'
            rows={6}
            spellCheck={false}
            className="mt-2 resize-none border-zinc-800 bg-zinc-900/50 font-mono text-[10px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-900/50"
          />

          {uploadErrors.length > 0 && (
            <div className="mt-2 rounded-lg border border-red-900/50 bg-red-950/20 p-2">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-red-400">
                <AlertTriangle className="h-3 w-3" /> {uploadErrors.length} validation error{uploadErrors.length > 1 ? 's' : ''}
              </p>
              <ul className="mt-1 space-y-0.5">
                {uploadErrors.slice(0, 8).map((err, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-red-300/90">• {err}</li>
                ))}
              </ul>
            </div>
          )}

          {uploadValid && (
            <div className="mt-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-2">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Valid strategy: {uploadValid.name}
              </p>
              <div className="mt-1.5">
                <StrategyCard strategy={uploadValid} />
              </div>
            </div>
          )}

          <Button
            onClick={saveUpload}
            disabled={!uploadValid || savingUpload}
            className="mt-2 h-7 w-full gap-1.5 bg-emerald-700 text-[11px] font-bold text-white hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {savingUpload ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Validate & Save to Library
          </Button>

          <Accordion type="single" collapsible className="mt-3">
            <AccordionItem value="schema" className="border-zinc-800/80">
              <AccordionTrigger className="py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 hover:text-emerald-400 hover:no-underline">
                Schema help & identifiers
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2 font-mono text-[9px] leading-relaxed text-zinc-400">
{STRATEGY_DOCS}
                </pre>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[9px] text-zinc-600">Working example — press load, then Save.</p>
                  <Button
                    onClick={() => { setUploadJson(EXAMPLE_STRATEGY_JSON); validateUpload(EXAMPLE_STRATEGY_JSON) }}
                    className="h-6 gap-1 bg-zinc-800 px-2 text-[10px] font-bold text-zinc-200 hover:bg-zinc-700"
                  >
                    <FileJson className="h-3 w-3" /> Load example
                  </Button>
                </div>
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-2 font-mono text-[9px] leading-relaxed text-zinc-500">
{EXAMPLE_STRATEGY_JSON}
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── strategy card (shared) ─────────────────────────────────────────────────

function StrategyCard({ strategy }: { strategy: Strategy }) {
  const ind = strategy.rules.indicators
  const filters = strategy.rules.filters
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold text-zinc-100">{strategy.name}</p>
          {strategy.description && (
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{strategy.description}</p>
          )}
        </div>
        <Badge className={cn(
          'h-4 shrink-0 px-1 text-[8px] font-extrabold',
          strategy.author === 'ai' ? 'bg-emerald-950/70 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
        )}>
          {strategy.author === 'ai' ? 'AI' : 'USER'}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {ind.emaPeriods.length > 0 && (
          <Chip>EMA {ind.emaPeriods.join('/')}</Chip>
        )}
        <Chip>RSI {ind.rsiPeriod}</Chip>
        <Chip>BB {ind.bollingerPeriod}×{ind.bollingerMult}</Chip>
        <Chip>Stoch {ind.stochK}/{ind.stochD}</Chip>
        <Chip>ATR {ind.atrPeriod}</Chip>
        <Chip>MACD {ind.macdFast}/{ind.macdSlow}/{ind.macdSignal}</Chip>
        <Chip>{strategy.rules.expirySeconds}s expiry</Chip>
        {filters.minAtrPct != null && <Chip tone="amber">min ATR {filters.minAtrPct}%</Chip>}
        {filters.maxAtrPct != null && <Chip tone="amber">max ATR {filters.maxAtrPct}%</Chip>}
        {filters.trendAlign === 'ema50' && <Chip tone="amber">trend: EMA50</Chip>}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <SideBox side={strategy.rules.call} tone="call" />
        <SideBox side={strategy.rules.put} tone="put" />
      </div>
    </div>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'amber' }) {
  return (
    <span className={cn(
      'rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold',
      tone === 'amber'
        ? 'border-amber-900/50 bg-amber-950/20 text-amber-400/90'
        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
    )}>
      {children}
    </span>
  )
}

function SideBox({ side, tone }: { side: StrategySide; tone: 'call' | 'put' }) {
  const isCall = tone === 'call'
  const empty = side.all.length === 0 && side.any.length === 0
  return (
    <div className={cn(
      'rounded-lg border p-2',
      isCall ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-red-900/50 bg-red-950/20'
    )}>
      <p className={cn(
        'flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide',
        isCall ? 'text-emerald-400' : 'text-red-400'
      )}>
        {isCall ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isCall ? 'Call' : 'Put'} conditions
      </p>
      {empty ? (
        <p className="mt-1 text-[10px] italic text-zinc-600">side disabled — no conditions</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {side.all.map((c, i) => (
            <li key={`a${i}`} className="font-mono text-[10px] font-bold text-zinc-200">
              <span className="mr-1 text-zinc-600">•</span>{formatCondition(c)}
            </li>
          ))}
          {side.any.length > 0 && (
            <li className="pt-0.5 text-[9px] font-bold uppercase text-zinc-500">at least one of:</li>
          )}
          {side.any.map((g, i) => (
            <li key={`o${i}`} className="font-mono text-[10px] font-bold text-zinc-300">
              <span className="mr-1 text-zinc-600">{i === 0 ? '•' : 'or'}</span>
              {g.map(formatCondition).join(' and ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── backtest results (shared) ──────────────────────────────────────────────

function BacktestResults({
  running, result, error, onSaveStats, savingStats, statsSaved,
}: {
  running: boolean
  result: StrategyBacktestResult | null
  error: string | null
  onSaveStats: () => void
  savingStats: boolean
  statsSaved: boolean
}) {
  const spark = useMemo(() => {
    if (!result?.profitCurve?.length) return null
    const curve = result.profitCurve
    const lo = Math.min(...curve, 0)
    const hi = Math.max(...curve, 0)
    const W = 220
    const H = 44
    const pts = curve.map((v, i) => {
      const x = (i / Math.max(1, curve.length - 1)) * W
      const y = H - ((v - lo) / (hi - lo || 1)) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return {
      path: `M ${pts.join(' L ')}`,
      zeroY: H - ((0 - lo) / (hi - lo || 1)) * H,
      positive: (curve[curve.length - 1] ?? 0) >= 0,
    }
  }, [result?.profitCurve])

  if (running) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 text-[11px] text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
        Fetching 1500 real candles &amp; replaying…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-2.5">
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-red-400/70">
          Open the asset in Market Watch first, or try the chart asset.
        </p>
      </div>
    )
  }

  if (!result) return null

  const wrTone = result.winRate > 55 ? 'text-emerald-400' : result.winRate < 50 ? 'text-red-400' : 'text-amber-400'
  const bestHours = [...result.byHour].filter(h => h.trades >= 3).sort((a, b) => b.winRate - a.winRate).slice(0, 4)

  return (
    <div className="space-y-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
      <div className="flex items-center gap-3">
        <div>
          <div className={cn('font-mono text-2xl font-extrabold leading-none tabular-nums', wrTone)}>
            {result.winRate.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-600">win rate</div>
        </div>
        <div className="ml-auto text-right">
          <div className={cn(
            'font-mono text-base font-extrabold leading-none tabular-nums',
            result.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
          )}>
            {result.totalProfit >= 0 ? '+' : ''}{result.totalProfit}$
          </div>
          <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-600">
            profit · $1 stake · {result.payout}% payout
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <MiniStat label="Trades" value={String(result.trades)} sub={`${result.candles} candles`} />
        <MiniStat label="W / L / D" value={`${result.wins}/${result.losses}/${result.draws}`} />
        <MiniStat label="Max DD" value={`${result.maxDrawdown}$`} tone="loss" />
        <MiniStat label="Streaks" value={`${result.maxWinStreak}▲ ${result.maxLossStreak}▼`} />
      </div>

      {spark && (
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase text-zinc-600">Equity curve — {result.asset}</div>
          <svg viewBox="0 0 220 44" className="h-12 w-full" preserveAspectRatio="none" aria-label="Strategy backtest equity curve">
            <line x1="0" y1={spark.zeroY} x2="220" y2={spark.zeroY} stroke="#52525b" strokeWidth="0.5" strokeDasharray="2,2" />
            <path d={spark.path} fill="none" stroke={spark.positive ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
          </svg>
        </div>
      )}

      {result.tradeList.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase text-zinc-600">Last trades</div>
          <div className="overflow-hidden rounded-md border border-zinc-800/80">
            <table className="w-full border-collapse font-mono text-[9px] tabular-nums">
              <tbody>
                {result.tradeList.slice(-10).reverse().map((t, i) => (
                  <tr key={`${t.time}-${i}`} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-1.5 py-0.5 text-zinc-500">
                      <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                      {new Date(t.time * 1000).toLocaleTimeString([], { hour12: false })}
                    </td>
                    <td className={cn('px-1 py-0.5 font-bold', t.direction === 'call' ? 'text-emerald-400' : 'text-red-400')}>
                      {t.direction === 'call' ? '▲ CALL' : '▼ PUT'}
                    </td>
                    <td className="px-1 py-0.5 text-zinc-400">{fmtPrice(t.openPrice)} → {fmtPrice(t.closePrice)}</td>
                    <td className={cn(
                      'px-1.5 py-0.5 text-right font-bold',
                      t.result === 'win' ? 'text-emerald-400' : t.result === 'loss' ? 'text-red-400' : 'text-zinc-400'
                    )}>
                      {t.result === 'win' ? 'WIN' : t.result === 'loss' ? 'LOSS' : 'DRAW'}
                    </td>
                    <td className={cn(
                      'px-1.5 py-0.5 text-right font-bold',
                      t.profit > 0 ? 'text-emerald-400' : t.profit < 0 ? 'text-red-400' : 'text-zinc-500'
                    )}>
                      {t.profit > 0 ? '+' : ''}{t.profit.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bestHours.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[9px] font-bold uppercase text-zinc-600">best hours (UTC):</span>
          {bestHours.map(h => (
            <span key={h.hour} className={cn(
              'rounded border px-1 py-0.5 font-mono text-[9px] font-bold',
              h.winRate > 55 ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400' : 'text-zinc-400'
            )}>
              {String(h.hour).padStart(2, '0')}:00 · {h.winRate}% · {h.trades}t
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] leading-tight text-zinc-600">
          Breakeven at {result.payout}% payout = 52.1% WR.
          {result.trades < 30 && ' ⚠ Low sample — treat with caution.'}
        </p>
        <Button
          onClick={onSaveStats}
          disabled={savingStats || result.trades === 0}
          className={cn(
            'h-6 shrink-0 gap-1 px-2 text-[10px] font-bold',
            statsSaved
              ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              : 'bg-emerald-700 text-white hover:bg-emerald-600'
          )}
        >
          {savingStats ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {statsSaved ? 'Update stats' : 'Save stats'}
        </Button>
      </div>
    </div>
  )
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'loss' }) {
  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-900/50 px-1.5 py-1 text-center">
      <div className="text-[8px] font-bold uppercase text-zinc-600">{label}</div>
      <div className={cn(
        'font-mono text-[11px] font-bold tabular-nums',
        tone === 'loss' ? 'text-red-400' : 'text-zinc-200'
      )}>{value}</div>
      {sub && <div className="text-[8px] text-zinc-600">{sub}</div>}
    </div>
  )
}
