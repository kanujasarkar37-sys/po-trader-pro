'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { useTrader } from './store'
import {
  Keyboard, Gauge, ShieldAlert, Lightbulb, ArrowUpRight, ArrowDownRight, Bot, Radar,
} from 'lucide-react'

const ENGINE_COMPONENTS = [
  { name: 'EMA 9/21/50 stack', desc: 'trend alignment + slope on M1' },
  { name: 'RSI zone', desc: 'momentum extremes, divergence-aware' },
  { name: 'Stochastic cross', desc: 'overbought/oversold timing' },
  { name: 'MACD histogram', desc: 'momentum shift confirmation' },
  { name: 'Bollinger position', desc: 'volatility band location' },
  { name: 'Candle patterns', desc: 'pin bar / engulfing detection' },
  { name: 'S/R proximity', desc: 'support-resistance distance' },
  { name: 'Momentum burst', desc: 'rate-of-change acceleration' },
  { name: 'M5 multi-timeframe', desc: 'intermediate trend agreement' },
  { name: 'M15 macro veto', desc: 'higher-tf regime filter (v5)' },
]

export function HelpDialog() {
  const [open, setOpen] = useState(false)
  const config = useTrader(s => s.config)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Open help and shortcuts"
          title="Help · shortcuts · how the engine works"
          className="h-7 w-7 p-0 text-zinc-500 hover:text-emerald-300"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-200 pretty-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-zinc-100">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            PO Trader Pro — Quick Guide
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            How the signal engine works, keyboard shortcuts and safety rails.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* How it works */}
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
              <Gauge className="h-3.5 w-3.5 text-emerald-500" /> The confluence engine (v9 · adaptive + calibrated edges)
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Each candle the engine scans every selected pair on ~2000 buffered candles and scores
              10 independent components. A signal fires when the weighted confluence crosses your
              confidence threshold (currently{' '}
              <strong className="text-zinc-200">{config?.minConfidence ?? 65}%</strong>):
            </p>
            <ul className="grid grid-cols-1 gap-1 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2 sm:grid-cols-2">
              {ENGINE_COMPONENTS.map((c, i) => (
                <li key={c.name} className="flex items-baseline gap-1.5 text-[10px] leading-snug">
                  <span className="font-mono font-bold text-emerald-500/80">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-semibold text-zinc-300">{c.name}</span>
                  <span className="text-zinc-600">— {c.desc}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Per-asset adaptive thresholds then tune each pair&apos;s bar from its own live results,
              and the market-calendar red zone pauses entries around high-impact events (session
              opens, NFP, jobless claims…). The <strong className="text-zinc-300">Telegram bridge</strong> mirrors
              alerts to your phone and accepts remote commands — and every trade row opens a
              full breakdown dialog (price path + the signal&apos;s component scores).
            </p>
          </section>

          {/* Shortcuts */}
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
              <Keyboard className="h-3.5 w-3.5 text-emerald-500" /> Keyboard shortcuts
            </h3>
            <div className="grid grid-cols-1 gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5 sm:grid-cols-2">
              <ShortcutRow keys={['C']} label={<span className="flex items-center gap-1">Place <span className="font-bold text-emerald-400">CALL</span> on chart asset <ArrowUpRight className="h-3 w-3 text-emerald-400" /></span>} />
              <ShortcutRow keys={['P']} label={<span className="flex items-center gap-1">Place <span className="font-bold text-red-400">PUT</span> on chart asset <ArrowDownRight className="h-3 w-3 text-red-400" /></span>} />
              <ShortcutRow keys={['B']} label={<span className="flex items-center gap-1"><Bot className="h-3 w-3 text-zinc-400" /> Start / stop the auto-trade bot</span>} />
              <ShortcutRow keys={['/']} label={<span className="flex items-center gap-1"><Radar className="h-3 w-3 text-zinc-400" /> Focus the pair search box</span>} />
            </div>
          </section>

          {/* Safety */}
          <section className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" /> Safety rails
            </h3>
            <ul className="space-y-1 text-[10px] leading-relaxed text-zinc-400">
              <li>• <strong className="text-zinc-300">Stop-loss / take-profit</strong> auto-stop the bot when breached.</li>
              <li>• <strong className="text-zinc-300">Daily guard</strong> halts trading for the rest of the day on your daily loss floor or profit target.</li>
              <li>• <strong className="text-zinc-300">Max concurrent + max total trades</strong> cap exposure and overtrading.</li>
              <li>• <strong className="text-zinc-300">Adaptive thresholds</strong> raise the bar on pairs that keep losing.</li>
            </ul>
          </section>

          {/* Disclaimer */}
          <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-2.5">
            <p className="text-[10px] leading-relaxed text-amber-200/80">
              <strong className="text-amber-300">Disclaimer.</strong> Binary options trading carries
              substantial risk. The simulation feed is a synthetic random walk that demonstrates
              mechanics — it cannot prove an edge. Validate any strategy with the backtest panel on
              real Pocket Option data before risking funds, and never trade money you cannot afford
              to lose.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutRow({ keys, label }: { keys: string[]; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex gap-1">
        {keys.map(k => (
          <kbd key={k} className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400 shadow-[0_1px_0_rgba(0,0,0,0.6)]">
            {k}
          </kbd>
        ))}
      </span>
      <span className="text-[10px] text-zinc-400">{label}</span>
    </div>
  )
}
