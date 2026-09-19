'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTrader } from './store'
import { Plug, Play, Info, Globe, Wallet, KeyRound, Sparkles, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'

const REGIONS = [
  { id: 'api-l', label: 'Global (api-l)' },
  { id: 'api-eu', label: 'Europe (api-eu)' },
  { id: 'api-us', label: 'America (api-us)' },
  { id: 'api-msl', label: 'Asia (api-msl)' },
]

type Platform = 'deriv' | 'pocket' | 'sim'

export function ConnectDialog({ children }: { children: React.ReactNode }) {
  const { connectLive, connectDeriv, startSim, mode, deriv } = useTrader()
  const [platform, setPlatform] = useState<Platform>('deriv')
  const [ssid, setSsid] = useState('')
  const [region, setRegion] = useState('api-l')
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)

  const handleConnectPo = () => {
    if (!ssid.trim()) return
    connectLive(ssid.trim(), region)
    setOpen(false)
  }

  const handleConnectDeriv = () => {
    connectDeriv(token.trim() || undefined)
    setOpen(false)
  }

  const platforms: { id: Platform; label: string; icon: React.ElementType; badge?: string; accent: string }[] = [
    { id: 'deriv', label: 'Deriv · Live Market', icon: Globe, badge: 'FREE · NO KEY', accent: 'emerald' },
    { id: 'pocket', label: 'Pocket Option', icon: Wallet, badge: 'SSID', accent: 'amber' },
    { id: 'sim', label: 'Simulation', icon: Play, accent: 'zinc' },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Plug className="h-5 w-5 text-emerald-500" />
            Connect a Trading Platform
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Choose a data source and account. You can switch platforms any time.
          </DialogDescription>
        </DialogHeader>

        {/* Platform selector */}
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Platform">
          {platforms.map((p) => {
            const Icon = p.icon
            const active = platform === p.id
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={active}
                onClick={() => setPlatform(p.id)}
                className={cn(
                  'group flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all',
                  active
                    ? p.accent === 'emerald'
                      ? 'border-emerald-600 bg-emerald-950/40 shadow-lg shadow-emerald-950/50'
                      : p.accent === 'amber'
                        ? 'border-amber-600 bg-amber-950/30 shadow-lg shadow-amber-950/40'
                        : 'border-zinc-600 bg-zinc-900'
                    : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900',
                )}
              >
                <Icon className={cn('h-5 w-5', active ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-300')} />
                <span className={cn('text-[11px] font-bold leading-tight', active ? 'text-zinc-100' : 'text-zinc-400')}>
                  {p.label}
                </span>
                {p.badge && (
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[8px] font-black tracking-wider text-zinc-400">
                    {p.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {platform === 'deriv' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-200/90">
              <p className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Real live market data from Deriv — free, no account or API key needed.</strong>{' '}
                  60+ symbols: forex majors, crypto, commodities, stock indices +{' '}
                  <strong>synthetic indices that trade 24/7 (even weekends!)</strong> Forex closes on
                  weekends — synthetics &amp; crypto keep moving. Without a token you get live data
                  with <strong>paper trading</strong>; with a token you trade your real Deriv demo or
                  real account.
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="deriv-token" className="text-zinc-300">
                  Deriv API Token <span className="text-zinc-600">(optional)</span>
                </Label>
                <Badge variant="outline" className="border-zinc-700 bg-zinc-900 text-[9px] font-bold text-zinc-400">
                  demo OR real — auto-detected
                </Badge>
              </div>
              <Input
                id="deriv-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token to trade your Deriv account (leave empty for live data + paper trading)"
                className="border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <p className="flex items-start gap-2 text-[11px] text-zinc-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Get a token: <strong>app.deriv.com</strong> → Account Settings → <strong>API token</strong> →
                  enable <em>Read</em> + <em>Trade</em> scopes. A token created on your{' '}
                  <strong>virtual (demo)</strong> account trades demo funds; one from your{' '}
                  <strong>real</strong> account trades real money. Tokens stay on your server.
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleConnectDeriv}
                className="flex-1 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
              >
                <Globe className="mr-2 h-4 w-4" />
                Connect Deriv Live Market
              </Button>
              <Button
                onClick={() => { startSim(); setOpen(false) }}
                variant="outline"
                className="border-zinc-700 bg-zinc-900 font-semibold text-zinc-300 hover:bg-zinc-800 sm:w-40"
              >
                <Play className="mr-2 h-4 w-4" />
                Simulation
              </Button>
            </div>
            {mode === 'deriv' && (
              <p className="text-center text-[11px] text-emerald-400/80">
                Deriv mode active · {deriv.symbolsAvailable}/{deriv.symbolsTotal} symbols live
                {deriv.authorized ? ' · API account connected' : ' · paper trading'}
              </p>
            )}
          </div>
        )}

        {platform === 'pocket' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200/90">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Pocket Option has <strong>Forex OTC pairs that stay open on weekends</strong> plus live
                  forex, crypto &amp; commodities on weekdays. Connect with your session cookie to trade
                  your <strong>demo</strong> or <strong>real</strong> PO account.
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ssid" className="text-zinc-300">SSID Cookie</Label>
              <Input
                id="ssid"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder='42%5B%22auth%22%2C%7B%22session%22%3A%22a%3A4%3A...'
                className="border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <p className="text-[11px] text-zinc-500">
                Log into pocketoption.com → DevTools (F12) → Application → Cookies → copy the{' '}
                <code className="rounded bg-zinc-800 px-1">ssid</code> value.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-zinc-300">Server Region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-900 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                    {REGIONS.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="focus:bg-zinc-800">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Account</Label>
                <RadioGroup defaultValue="demo" className="flex h-10 items-center gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="demo" id="po-demo" className="border-emerald-700 text-emerald-500" />
                    <Label htmlFor="po-demo" className="text-zinc-300">Demo</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="real" id="po-real" className="border-red-700 text-red-500" />
                    <Label htmlFor="po-real" className="text-zinc-300">Real</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleConnectPo}
                disabled={!ssid.trim()}
                className="flex-1 bg-amber-600 font-bold text-white hover:bg-amber-500"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                Connect Pocket Option
              </Button>
              <Button
                onClick={() => { startSim(); setOpen(false) }}
                variant="outline"
                className="border-zinc-700 bg-zinc-900 font-semibold text-zinc-300 hover:bg-zinc-800 sm:w-40"
              >
                <Play className="mr-2 h-4 w-4" />
                Simulation
              </Button>
            </div>
            {mode === 'live' && <Badge className="w-fit bg-emerald-950/40 text-emerald-300 border border-emerald-800/60">Pocket Option connected</Badge>}
          </div>
        )}

        {platform === 'sim' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300">
              <p className="flex items-start gap-2">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <span>
                  Synthetic market engine with realistic price action — perfect for testing the bot,
                  signals, martingale and risk settings without any external account. Demo $10,000 /
                  real $1,000 simulated balances.
                </span>
              </p>
            </div>
            <Button
              onClick={() => { startSim(); setOpen(false) }}
              className="w-full bg-zinc-200 font-bold text-zinc-900 hover:bg-white"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Simulation
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
