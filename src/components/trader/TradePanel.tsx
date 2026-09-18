'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTrader } from './store'
import { TrendingUp, TrendingDown, Zap, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const AMOUNT_CHIPS = [1, 2, 5, 10]
const EXPIRY_CHIPS: { v: number; label: string }[] = [
  { v: 30, label: '30s' },
  { v: 60, label: '1m' },
  { v: 120, label: '2m' },
  { v: 300, label: '5m' },
]

export function TradePanel({ asset }: { asset: string }) {
  const { manualTrade, mode, config, prices, balance, assets } = useTrader()
  const [amount, setAmount] = useState(String(config?.tradeAmount ?? '1'))
  const [expiry, setExpiry] = useState(String(config?.expirySeconds ?? '60'))
  const [synced, setSynced] = useState<string | null>(null)

  // adjust local state during render when the store config changes externally
  const syncKey = config ? `${config.tradeAmount}|${config.expirySeconds}` : null
  if (syncKey && syncKey !== synced) {
    setSynced(syncKey)
    setAmount(String(config!.tradeAmount))
    setExpiry(String(config!.expirySeconds))
  }

  const price = prices[asset]
  const disabled = mode === 'disconnected'
  const payout = assets.find(a => a.asset === asset)?.payout ?? 92
  const amt = Math.max(0.1, parseFloat(amount) || 1)
  const potentialWin = +(amt * payout / 100).toFixed(2)
  const lossIfWrong = -amt

  const trade = (direction: 'call' | 'put') => {
    if (balance > 0 && amt > balance) {
      toast.error('Amount exceeds balance')
      return
    }
    manualTrade(direction, amt, parseInt(expiry))
    toast.success(`${direction === 'call' ? 'CALL ▲' : 'PUT ▼'} order placed`, {
      description: `${asset} · $${amt} · ${expiry}s expiry${price ? ` @ ${price}` : ''} · +$${potentialWin} if right`,
    })
  }

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-950/60 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="space-y-1.5">
          {/* amount + expiry inputs */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="trade-amount" className="text-[10px] font-bold uppercase text-zinc-500">Amount $</Label>
              <Input
                id="trade-amount"
                type="number"
                min="0.1"
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 w-24 border-zinc-800 bg-zinc-900 font-mono text-sm font-bold text-zinc-100"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase text-zinc-500">Expiry</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="h-10 w-24 border-zinc-800 bg-zinc-900 text-xs font-semibold text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950 text-xs text-zinc-100">
                  {[30, 60, 120, 300].map((s) => (
                    <SelectItem key={s} value={String(s)} className="focus:bg-zinc-800">
                      {s < 60 ? `${s}s` : `${s / 60}m`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* quick chips */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">$</span>
            {AMOUNT_CHIPS.map(v => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className={cn(
                  'chip-press h-5 rounded px-1.5 font-mono text-[10px] font-bold tabular-nums',
                  amt === v
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                )}
                aria-pressed={amt === v}
                aria-label={`Set amount ${v} dollars`}
              >
                {v}
              </button>
            ))}
            <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600">T</span>
            {EXPIRY_CHIPS.map(({ v, label }) => (
              <button
                key={v}
                onClick={() => setExpiry(String(v))}
                className={cn(
                  'chip-press h-5 rounded px-1.5 font-mono text-[10px] font-bold',
                  expiry === String(v)
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                )}
                aria-pressed={expiry === String(v)}
                aria-label={`Set expiry ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* payout preview */}
        <div className="hidden select-none flex-col justify-center rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-1.5 lg:flex" title={`Payout ${payout}% on ${asset}`}>
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
            <Coins className="h-3 w-3" /> Payout {payout}%
          </span>
          <span className="mt-0.5 flex items-baseline gap-2 font-mono text-xs font-bold tabular-nums">
            <span className="text-emerald-400">+${potentialWin.toFixed(2)}</span>
            <span className="text-zinc-700">/</span>
            <span className="text-red-400">${lossIfWrong.toFixed(2)}</span>
          </span>
          <span className="text-[8px] text-zinc-600">if right / if wrong</span>
        </div>

        <button
          onClick={() => trade('call')}
          disabled={disabled}
          className={cn(
            'group relative h-12 gap-1.5 rounded-md px-6 text-sm font-extrabold tracking-wide transition-all',
            'bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-900/50',
            'hover:from-emerald-400 hover:to-emerald-600 hover:shadow-emerald-700/40 active:scale-[0.98]',
            'disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 disabled:shadow-none disabled:active:scale-100'
          )}
          aria-label={`Place CALL trade on ${asset}`}
        >
          <TrendingUp className="h-5 w-5 transition-transform group-hover:-translate-y-0.5" />
          CALL ▲
          <kbd className="absolute -top-1.5 -right-1.5 hidden rounded border border-emerald-300/40 bg-zinc-950 px-1 font-mono text-[8px] font-bold text-emerald-300 sm:block">C</kbd>
        </button>
        <button
          onClick={() => trade('put')}
          disabled={disabled}
          className={cn(
            'group relative h-12 gap-1.5 rounded-md px-6 text-sm font-extrabold tracking-wide transition-all',
            'bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg shadow-red-900/50',
            'hover:from-red-400 hover:to-red-600 hover:shadow-red-700/40 active:scale-[0.98]',
            'disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 disabled:shadow-none disabled:active:scale-100'
          )}
          aria-label={`Place PUT trade on ${asset}`}
        >
          <TrendingDown className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
          PUT ▼
          <kbd className="absolute -top-1.5 -right-1.5 hidden rounded border border-red-300/40 bg-zinc-950 px-1 font-mono text-[8px] font-bold text-red-300 sm:block">P</kbd>
        </button>
      </div>
      {disabled && (
        <p className="flex items-center gap-1 text-[10px] text-zinc-600">
          <Zap className="h-3 w-3" /> Connect (or start simulation) to trade manually
        </p>
      )}
    </div>
  )
}
