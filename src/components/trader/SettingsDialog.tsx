'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTrader } from './store'
import { TelegramPanel } from './TelegramPanel'
import { Settings, Send, BellRing, Cpu, RefreshCw, Volume2, Bell, Power, Globe, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Settings — central hub for Telegram bridge, alerts and engine info.
 * (v10: moved the Telegram configuration here from the dashboard column.)
 */
export function SettingsDialog() {
  const {
    mode, deriv, socketConnected, botRunning, prefs, setPrefs,
    refreshNews, disconnectPo, resetSim, accountType, config,
  } = useTrader()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('telegram')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Open settings"
          title="Settings — Telegram, alerts, engine"
          className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-300"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Settings className="h-5 w-5 text-emerald-500" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Telegram bridge, alert preferences and engine status.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 w-full justify-start gap-1 bg-zinc-900 p-1">
            <TabsTrigger value="telegram" className="gap-1.5 text-xs data-[state=active]:bg-emerald-900/50 data-[state=active]:text-emerald-300">
              <Send className="h-3.5 w-3.5" />
              Telegram
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5 text-xs data-[state=active]:bg-emerald-900/50 data-[state=active]:text-emerald-300">
              <BellRing className="h-3.5 w-3.5" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="engine" className="gap-1.5 text-xs data-[state=active]:bg-emerald-900/50 data-[state=active]:text-emerald-300">
              <Cpu className="h-3.5 w-3.5" />
              Engine
            </TabsTrigger>
          </TabsList>

          {/* ── Telegram bridge ── */}
          <TabsContent value="telegram" className="mt-3">
            <div className="max-h-[60vh] overflow-hidden">
              <TelegramPanel inDialog />
            </div>
          </TabsContent>

          {/* ── Alerts & preferences ── */}
          <TabsContent value="alerts" className="mt-3 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-start gap-3">
                <Volume2 className={cn('mt-0.5 h-4 w-4', prefs.sound ? 'text-emerald-400' : 'text-zinc-600')} />
                <div>
                  <p className="text-xs font-bold text-zinc-200">Alert sounds</p>
                  <p className="text-[11px] text-zinc-500">Beep on strong signals, wins and losses</p>
                </div>
              </div>
              <Switch
                checked={prefs.sound}
                onCheckedChange={(v) => setPrefs({ sound: v })}
                aria-label="Toggle alert sounds"
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-start gap-3">
                <Bell className={cn('mt-0.5 h-4 w-4', prefs.notifications ? 'text-emerald-400' : 'text-zinc-600')} />
                <div>
                  <p className="text-xs font-bold text-zinc-200">Browser notifications</p>
                  <p className="text-[11px] text-zinc-500">Desktop notifications for signals and trade results</p>
                </div>
              </div>
              <Switch
                checked={prefs.notifications}
                onCheckedChange={(v) => setPrefs({ notifications: v })}
                aria-label="Toggle browser notifications"
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <p className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-2.5 text-[11px] leading-relaxed text-zinc-500">
              Tip: keyboard shortcuts work everywhere — <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono">C</kbd> CALL ·{' '}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono">P</kbd> PUT ·{' '}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono">B</kbd> bot ·{' '}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono">/</kbd> search ·{' '}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 font-mono">?</kbd> help
            </p>
          </TabsContent>

          {/* ── Engine status ── */}
          <TabsContent value="engine" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatusChip icon={Wifi} label="Engine" value={socketConnected ? 'connected' : 'offline'} good={socketConnected} />
              <StatusChip icon={Globe} label="Mode" value={
                mode === 'deriv' ? 'Deriv Live' : mode === 'live' ? 'Pocket Option' : mode === 'simulation' ? 'Simulation' : 'Disconnected'
              } good={mode !== 'disconnected'} />
              <StatusChip icon={Power} label="Bot" value={botRunning ? 'running' : 'idle'} good={botRunning} />
              {mode === 'deriv' && (
                <>
                  <StatusChip icon={Globe} label="Deriv link" value={deriv.connected ? 'connected' : 'offline'} good={deriv.connected} />
                  <StatusChip icon={Cpu} label="Symbols live" value={`${deriv.symbolsAvailable}/${deriv.symbolsTotal}`} good={deriv.symbolsAvailable > 0} />
                  <StatusChip icon={Send} label="Data mode" value={deriv.streaming ? 'streaming' : 'polling ~5s'} good />
                </>
              )}
            </div>

            {mode === 'deriv' && (
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3 text-[11px] leading-relaxed text-emerald-200/80">
                <p><strong>Deriv live market</strong> — free real-time data ({deriv.symbolsTotal} symbols: forex, crypto,
                commodities, indices + synthetics 24/7). {deriv.authorized
                  ? <>Authorized as <strong>{deriv.loginid}</strong> ({deriv.isVirtual ? 'demo' : 'real'} · {deriv.currency}).</>
                  : <>Paper trading mode — connect an API token in the Connect dialog to trade a real account.</>}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { refreshNews(); toast.success('News refresh requested') }}
                className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh news
              </Button>
              {(mode === 'simulation' || (mode === 'deriv' && !deriv.authorized)) && (
                <Button size="sm" variant="outline" onClick={resetSim}
                  className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
                  Reset paper balance
                </Button>
              )}
              {mode !== 'disconnected' && (
                <Button size="sm" variant="outline" onClick={() => { disconnectPo(); toast.info('Disconnected') }}
                  className="border-red-900/60 bg-red-950/30 text-red-300 hover:bg-red-900/40">
                  <Power className="mr-1.5 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              )}
            </div>

            <p className="text-[10px] leading-relaxed text-zinc-600">
              Engine v10 · account {accountType.toUpperCase()} · scan {config?.selectedAssets.length ?? 0} pairs ·
              threshold {config?.minConfidence ?? 65}% · expiry {config?.expirySeconds ?? 60}s.
              Bot engine: 10-factor confluence (EMA/RSI/Stoch/MACD/Bollinger/patterns/S-R/momentum/MTF/HTF)
              with adaptive per-asset thresholds, news filter and daily risk guard.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function StatusChip({ icon: Icon, label, value, good }: { icon: React.ElementType; label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', good ? 'text-emerald-400' : 'text-zinc-600')} />
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className={cn('truncate text-[11px] font-semibold', good ? 'text-zinc-200' : 'text-zinc-500')}>{value}</p>
      </div>
    </div>
  )
}
