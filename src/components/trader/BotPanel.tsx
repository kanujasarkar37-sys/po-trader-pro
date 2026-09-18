'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTrader } from './store'
import { Play, Square, Bot, TrendingUp, TrendingDown, DollarSign, Target, ShieldAlert, Layers, Shield, Scale, Flame, Timer, CalendarClock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const EXPIRIES = [
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
]

// One-click strategy presets — tune the whole risk profile at once
const PRESETS = {
  safe: {
    label: 'SAFE', icon: Shield, tone: 'emerald',
    hint: 'High-purity signals only · tight stop-loss · no martingale',
    config: { minConfidence: 75, tradeAmount: 1, maxConcurrent: 1, martingale: false, stopLoss: 30, takeProfit: 60, maxTrades: 20 },
  },
  balanced: {
    label: 'BALANCED', icon: Scale, tone: 'amber',
    hint: 'Default profile — solid edge, controlled risk',
    config: { minConfidence: 65, tradeAmount: 1, maxConcurrent: 2, martingale: false, stopLoss: 50, takeProfit: 100, maxTrades: 30 },
  },
  aggressive: {
    label: 'AGGRESSIVE', icon: Flame, tone: 'red',
    hint: 'More entries, larger size, martingale recovery on',
    config: { minConfidence: 55, tradeAmount: 2, maxConcurrent: 3, martingale: true, mgMaxSteps: 2, stopLoss: 100, takeProfit: 200, maxTrades: 50 },
  },
} as const

export function BotPanel() {
  const { config, updateConfig, startBot, stopBot, botRunning, mode, stats, adaptive } = useTrader()

  // local state mirrors config to keep inputs responsive (adjust during render
  // when the store pushes a different value — React's derived-state pattern)
  const [amount, setAmount] = useState(String(config?.tradeAmount ?? '1'))
  const [maxTrades, setMaxTrades] = useState(String(config?.maxTrades ?? '30'))
  const [stopLoss, setStopLoss] = useState(String(config?.stopLoss ?? '50'))
  const [takeProfit, setTakeProfit] = useState(String(config?.takeProfit ?? '100'))
  const [dailyStopLoss, setDailyStopLoss] = useState(String(config?.dailyStopLoss ?? '0'))
  const [dailyTarget, setDailyTarget] = useState(String(config?.dailyProfitTarget ?? '0'))
  const [synced, setSynced] = useState<string | null>(null)
  // SSR-safe clock: 0 until mounted (server/client Date.now() differ →
  // hydration mismatch risk); all consumers guard against the pre-mount value
  const [now, setNow] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const syncKey = config ? `${config.tradeAmount}|${config.maxTrades}|${config.stopLoss}|${config.takeProfit}|${config.dailyStopLoss}|${config.dailyProfitTarget}` : null
  if (syncKey && syncKey !== synced) {
    setSynced(syncKey)
    setAmount(String(config!.tradeAmount))
    setMaxTrades(String(config!.maxTrades))
    setStopLoss(String(config!.stopLoss))
    setTakeProfit(String(config!.takeProfit))
    setDailyStopLoss(String(config!.dailyStopLoss))
    setDailyTarget(String(config!.dailyProfitTarget))
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/80 p-6">
        <p className="text-xs text-zinc-600">Loading bot configuration…</p>
      </div>
    )
  }

  const botStats = stats?.bot
  const canTrade = mode !== 'disconnected'

  // detect active preset (config fully matches a preset's values)
  const activePreset = (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).find(k => {
    const p = PRESETS[k].config as Record<string, number | boolean>
    return Object.entries(p).every(([key, val]) => (config as Record<string, unknown>)[key] === val)
  })

  const applyPreset = (key: keyof typeof PRESETS) => {
    const p = PRESETS[key]
    updateConfig({ ...p.config })
    toast.success(`${p.label} preset applied`, { description: p.hint })
  }

  const uptime = botStats?.sessionStart ? Math.max(0, now - botStats.sessionStart) : 0
  const uptimeStr = uptime > 0
    ? uptime >= 3600000
      ? `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`
      : uptime >= 60000
        ? `${Math.floor(uptime / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`
        : `${Math.floor(uptime / 1000)}s`
    : null

  const handleStart = () => {
    if (!canTrade) {
      toast.error('Connect first', { description: 'Start simulation or connect your Pocket Option SSID.' })
      return
    }
    startBot()
    toast.success('Auto-trade bot started', {
      description: `Scanning ${config.selectedAssets.length} pairs · ${config.expirySeconds}s expiry · min ${config.minConfidence}% confidence`,
    })
  }

  const handleStop = () => {
    stopBot()
    toast.info('Auto-trade bot stopped')
  }

  const commitAmount = () => updateConfig({ tradeAmount: Math.max(0.1, parseFloat(amount) || 1) })
  const commitMaxTrades = () => updateConfig({ maxTrades: Math.max(1, parseInt(maxTrades) || 30) })
  const commitStopLoss = () => updateConfig({ stopLoss: Math.max(0, parseFloat(stopLoss) || 0) })
  const commitTakeProfit = () => updateConfig({ takeProfit: Math.max(0, parseFloat(takeProfit) || 0) })
  const commitDailyStopLoss = () => updateConfig({ dailyStopLoss: Math.max(0, parseFloat(dailyStopLoss) || 0) })
  const commitDailyTarget = () => updateConfig({ dailyProfitTarget: Math.max(0, parseFloat(dailyTarget) || 0) })

  // daily risk guard state from engine stats
  const daily = stats?.daily
  const dayPnl = daily?.pnl ?? 0
  const daySl = config.dailyStopLoss
  const dayTp = config.dailyProfitTarget
  const dayPctToTarget = dayTp > 0 ? Math.min(100, Math.max(0, (dayPnl / dayTp) * 100)) : 0
  const dayPctToLoss = daySl > 0 ? Math.min(100, Math.max(0, (-dayPnl / daySl) * 100)) : 0

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Bot className="h-3.5 w-3.5 text-emerald-500" />
          Auto-Trade Bot
        </h2>
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-bold',
          botRunning ? 'bg-emerald-950/60 text-emerald-400' : 'bg-zinc-900 text-zinc-500'
        )}>
          {botRunning ? '● RUNNING' : '○ STOPPED'}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="space-y-4 pb-3">
          {/* ── Big START / STOP buttons ── */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleStart}
              disabled={botRunning}
              className={cn(
                'h-14 flex-col gap-0.5 text-sm font-extrabold tracking-wide',
                botRunning
                  ? 'bg-zinc-800 text-zinc-600'
                  : 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/50 hover:bg-emerald-500'
              )}
            >
              <Play className="h-5 w-5" />
              START BOT
            </Button>
            <Button
              onClick={handleStop}
              disabled={!botRunning}
              className={cn(
                'h-14 flex-col gap-0.5 text-sm font-extrabold tracking-wide',
                !botRunning
                  ? 'bg-zinc-800 text-zinc-600'
                  : 'bg-red-600 text-white shadow-lg shadow-red-900/50 hover:bg-red-500'
              )}
            >
              <Square className="h-5 w-5" />
              STOP BOT
            </Button>
          </div>

          {/* ── Strategy presets ── */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-600">Strategy presets</p>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => {
                const p = PRESETS[key]
                const active = activePreset === key
                const Icon = p.icon
                return (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    title={p.hint}
                    aria-pressed={active}
                    className={cn(
                      'group flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition-all active:scale-[0.97]',
                      active
                        ? p.tone === 'emerald' ? 'border-emerald-700 bg-emerald-950/50 shadow-md shadow-emerald-900/30'
                          : p.tone === 'amber' ? 'border-amber-700 bg-amber-950/50 shadow-md shadow-amber-900/30'
                            : 'border-red-700 bg-red-950/50 shadow-md shadow-red-900/30'
                        : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/70'
                    )}
                  >
                    <Icon className={cn(
                      'h-4 w-4 transition-transform group-hover:scale-110',
                      !active && 'text-zinc-600',
                      active && p.tone === 'emerald' && 'text-emerald-400',
                      active && p.tone === 'amber' && 'text-amber-400',
                      active && p.tone === 'red' && 'text-red-400',
                    )} />
                    <span className={cn(
                      'text-[9px] font-extrabold tracking-wide',
                      active ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-300'
                    )}>
                      {p.label}
                    </span>
                  </button>
                )
              })}
            </div>
            {activePreset && (
              <p className="text-[9px] leading-snug text-zinc-600">{PRESETS[activePreset].hint}</p>
            )}
          </div>

          {/* live session stats */}
          {(botStats && botStats.trades > 0) || uptimeStr ? (
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-2">
              {uptimeStr && (
                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-zinc-400">
                  <Timer className={cn('h-3 w-3', botRunning ? 'text-emerald-500' : 'text-zinc-600')} />
                  Session uptime <span className="font-mono font-bold tabular-nums text-zinc-200">{uptimeStr}</span>
                  <span className="ml-auto text-zinc-600">{botStats?.trades ?? 0} trades</span>
                </p>
              )}
              <div className="grid grid-cols-4 gap-1.5">
                <MiniStat label="BOT W" value={String(botStats?.wins ?? 0)} tone="win" />
                <MiniStat label="BOT L" value={String(botStats?.losses ?? 0)} tone="loss" />
                <MiniStat label="WR" value={`${(botStats?.wins ?? 0) + (botStats?.losses ?? 0) > 0 ? Math.round((botStats!.wins / (botStats!.wins + botStats!.losses)) * 100) : 0}%`} />
                <MiniStat label="P/L" value={`${(botStats?.profit ?? 0) >= 0 ? '+' : ''}${botStats?.profit ?? 0}`} tone={(botStats?.profit ?? 0) >= 0 ? 'win' : 'loss'} />
              </div>
            </div>
          ) : null}

          {/* ── Signal confidence ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                <Target className="h-3 w-3 text-amber-400" /> Min confidence
              </Label>
              <span className="font-mono text-xs font-bold text-amber-400">{config.minConfidence}%</span>
            </div>
            <Slider
              value={[config.minConfidence]}
              min={55}
              max={95}
              step={1}
              onValueChange={([v]) => updateConfig({ minConfidence: v })}
              className="py-1 [&_[role=slider]]:border-amber-700 [&_[role=slider]]:bg-zinc-800"
              aria-label="Minimum signal confidence"
            />
            <p className="text-[9px] leading-tight text-zinc-600">
              Higher = fewer but stronger signals. Breakeven win-rate at 92% payout is 52.1%.
            </p>
          </div>

          {/* ── Trade settings ── */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                <DollarSign className="h-3 w-3 text-emerald-500" /> Amount ($)
              </Label>
              <Input
                type="number"
                min="0.1"
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={commitAmount}
                onKeyDown={(e) => e.key === 'Enter' && commitAmount()}
                className="h-8 border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-zinc-400">Expiry</Label>
              <Select value={String(config.expirySeconds)} onValueChange={(v) => updateConfig({ expirySeconds: parseInt(v) })}>
                <SelectTrigger className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950 text-xs text-zinc-100">
                  {EXPIRIES.map((e) => (
                    <SelectItem key={e.value} value={e.value} className="focus:bg-zinc-800">{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                <Layers className="h-3 w-3 text-zinc-500" /> Max concurrent
              </Label>
              <Select value={String(config.maxConcurrent)} onValueChange={(v) => updateConfig({ maxConcurrent: parseInt(v) })}>
                <SelectTrigger className="h-8 border-zinc-800 bg-zinc-900 text-xs text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950 text-xs text-zinc-100">
                  {[1, 2, 3, 5].map((n) => (
                    <SelectItem key={n} value={String(n)} className="focus:bg-zinc-800">{n} trades</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-zinc-400">Max total trades</Label>
              <Input
                type="number"
                min="1"
                value={maxTrades}
                onChange={(e) => setMaxTrades(e.target.value)}
                onBlur={commitMaxTrades}
                onKeyDown={(e) => e.key === 'Enter' && commitMaxTrades()}
                className="h-8 border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100"
              />
            </div>
          </div>

          {/* ── Safety ── */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                <ShieldAlert className="h-3 w-3 text-red-400" /> Stop loss ($)
              </Label>
              <Input
                type="number"
                min="0"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                onBlur={commitStopLoss}
                onKeyDown={(e) => e.key === 'Enter' && commitStopLoss()}
                className="h-8 border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100"
              />
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                <TrendingUp className="h-3 w-3 text-emerald-400" /> Take profit ($)
              </Label>
              <Input
                type="number"
                min="0"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                onBlur={commitTakeProfit}
                onKeyDown={(e) => e.key === 'Enter' && commitTakeProfit()}
                className="h-8 border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100"
              />
            </div>
          </div>

          {/* ── Daily risk guard ── */}
          <div className="space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-[11px] font-bold text-zinc-300">
                <CalendarClock className="h-3 w-3 text-cyan-400" /> Daily risk guard
              </p>
              <span className={cn(
                'font-mono text-[11px] font-bold tabular-nums',
                dayPnl > 0 ? 'text-emerald-400' : dayPnl < 0 ? 'text-red-400' : 'text-zinc-400'
              )}>
                Today {dayPnl >= 0 ? '+' : ''}${dayPnl.toFixed(2)}
              </span>
            </div>
            {/* dual progress: distance to target (up) and stop (down) */}
            {(dayTp > 0 || daySl > 0) ? (
              <div className="space-y-1" aria-label="Daily limits progress">
                {dayTp > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-right text-[8px] font-bold uppercase text-emerald-600">TP</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-700 to-emerald-400 transition-all duration-500" style={{ width: `${dayPctToTarget}%` }} />
                    </div>
                    <span className="w-10 font-mono text-[9px] text-zinc-500">${dayTp}</span>
                  </div>
                )}
                {daySl > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-right text-[8px] font-bold uppercase text-red-600">SL</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-red-700 to-red-400 transition-all duration-500" style={{ width: `${dayPctToLoss}%` }} />
                    </div>
                    <span className="w-10 font-mono text-[9px] text-zinc-500">${daySl}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[9px] leading-snug text-zinc-600">Set a daily loss floor and/or profit target — the bot auto-stops for the rest of the day once either is breached.</p>
            )}
            {daily?.limitHit && (
              <div className={cn(
                'rounded-md border px-2 py-1.5 text-[10px] font-bold',
                daily.limitHit === 'loss'
                  ? 'border-red-800/60 bg-red-950/40 text-red-300'
                  : 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
              )}>
                {daily.limitHit === 'loss'
                  ? '⛔ Daily stop-loss hit — bot halted for today'
                  : '🎯 Daily profit target reached — profits banked'}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-zinc-500">Daily stop-loss ($)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0 = off"
                  value={dailyStopLoss}
                  onChange={(e) => setDailyStopLoss(e.target.value)}
                  onBlur={commitDailyStopLoss}
                  onKeyDown={(e) => e.key === 'Enter' && commitDailyStopLoss()}
                  className="h-7 border-zinc-800 bg-zinc-900 font-mono text-[11px] text-zinc-100"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-zinc-500">Daily target ($)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0 = off"
                  value={dailyTarget}
                  onChange={(e) => setDailyTarget(e.target.value)}
                  onBlur={commitDailyTarget}
                  onKeyDown={(e) => e.key === 'Enter' && commitDailyTarget()}
                  className="h-7 border-zinc-800 bg-zinc-900 font-mono text-[11px] text-zinc-100"
                />
              </div>
            </div>
          </div>

          {/* ── Toggles ── */}
          <div className="space-y-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2.5">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[11px] font-semibold text-zinc-300">Martingale recovery</Label>
                <p className="text-[9px] text-zinc-600">×{config.mgFactor} on loss, max {config.mgMaxSteps} steps</p>
              </div>
              <Switch
                checked={config.martingale}
                onCheckedChange={(v) => {
                  updateConfig({ martingale: v })
                  if (v) toast.warning('Martingale enabled', { description: 'Losses will multiply the stake. Use with caution!' })
                }}
                className="data-[state=checked]:bg-amber-600"
                aria-label="Toggle martingale"
              />
            </div>
            {config.martingale && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Factor</Label>
                  <Select value={String(config.mgFactor)} onValueChange={(v) => updateConfig({ mgFactor: parseFloat(v) })}>
                    <SelectTrigger className="h-7 border-zinc-800 bg-zinc-900 text-[11px] text-zinc-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-800 bg-zinc-950 text-[11px] text-zinc-100">
                      {[1.5, 2, 2.5, 3].map((f) => (
                        <SelectItem key={f} value={String(f)} className="focus:bg-zinc-800">×{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500">Max steps</Label>
                  <Select value={String(config.mgMaxSteps)} onValueChange={(v) => updateConfig({ mgMaxSteps: parseInt(v) })}>
                    <SelectTrigger className="h-7 border-zinc-800 bg-zinc-900 text-[11px] text-zinc-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-800 bg-zinc-950 text-[11px] text-zinc-100">
                      {[1, 2, 3, 5, 8].map((n) => (
                        <SelectItem key={n} value={String(n)} className="focus:bg-zinc-800">{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2">
              <div>
                <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300">
                  <Zap className="h-3 w-3 text-yellow-500" /> Dynamic stake sizing
                </Label>
                <p className="text-[9px] text-zinc-600">Scale stake with confidence edge × payout (max ×2.5)</p>
              </div>
              <Switch
                checked={config.dynamicStake}
                onCheckedChange={(v) => {
                  updateConfig({ dynamicStake: v, martingale: v ? false : undefined })
                  if (v) toast.info('Dynamic sizing on', { description: 'Strong signals stake more (Kelly-lite). Martingale disabled — pick one.' })
                }}
                className="data-[state=checked]:bg-yellow-600"
                aria-label="Toggle dynamic stake sizing"
              />
            </div>
            <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2">
              <div>
                <Label className="text-[11px] font-semibold text-zinc-300">News filter</Label>
                <p className="text-[9px] text-zinc-600">Extra caution during high-impact events</p>
              </div>
              <Switch
                checked={config.newsFilter}
                onCheckedChange={(v) => updateConfig({ newsFilter: v })}
                className="data-[state=checked]:bg-emerald-600"
                aria-label="Toggle news filter"
              />
            </div>
            <div className="flex items-center justify-between border-t border-zinc-800/80 pt-2">
              <div>
                <Label className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300">
                  <Target className="h-3 w-3 text-purple-400" /> Adaptive thresholds
                  {adaptive.length > 0 && config.adaptiveThresholds && (
                    <span className="rounded border border-purple-800/60 bg-purple-950/40 px-1 text-[8px] font-bold text-purple-300">
                      {adaptive.length} tuned
                    </span>
                  )}
                </Label>
                <p className="text-[9px] text-zinc-600">
                  Auto-tune per-asset confidence from live results (needs ≥8 trades/asset)
                </p>
              </div>
              <Switch
                checked={config.adaptiveThresholds}
                onCheckedChange={(v) => {
                  updateConfig({ adaptiveThresholds: v })
                  if (v) toast.info('Adaptive thresholds on', { description: 'Underperforming assets get a raised bar, overachievers get eased — learned from your live trade history.' })
                }}
                className="data-[state=checked]:bg-purple-600"
                aria-label="Toggle adaptive thresholds"
              />
            </div>
            {config.adaptiveThresholds && adaptive.length > 0 && (
              <div className="grid grid-cols-2 gap-1">
                {adaptive.slice(0, 6).map(a => (
                  <div key={a.asset} className="flex items-center justify-between rounded border border-zinc-800/70 bg-zinc-950/70 px-1.5 py-0.5" title={`${a.asset}: WR ${a.winRate}% over ${a.sampleSize} settled bot trades`}>
                    <span className="truncate text-[8px] font-bold text-zinc-400">{a.asset.replace('_otc', '')}</span>
                    <span className={cn(
                      'ml-1 shrink-0 font-mono text-[9px] font-extrabold tabular-nums',
                      a.threshold > a.baseThreshold ? 'text-red-400' : a.threshold < a.baseThreshold ? 'text-emerald-400' : 'text-zinc-400'
                    )}>
                      {a.threshold > a.baseThreshold ? '↑' : a.threshold < a.baseThreshold ? '↓' : '·'}{a.threshold}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[9px] leading-relaxed text-zinc-600">
            Bot scans selected pairs each candle, enters at candle open when confluence ≥ threshold,
            settles at expiry, and enforces stop-loss / take-profit / max-trades / daily limits automatically.
          </p>
        </div>
      </ScrollArea>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'win' | 'loss' }) {
  return (
    <div className="rounded-md border border-zinc-800/80 bg-zinc-900/60 px-1.5 py-1 text-center">
      <div className="text-[8px] font-bold uppercase text-zinc-600">{label}</div>
      <div className={cn(
        'font-mono text-[11px] font-bold tabular-nums',
        tone === 'win' ? 'text-emerald-400' : tone === 'loss' ? 'text-red-400' : 'text-zinc-200'
      )}>{value}</div>
    </div>
  )
}
