'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useTrader } from './store'
import { ConnectDialog } from './ConnectDialog'
import { HelpDialog } from './HelpDialog'
import { Bot, Plug, Activity, Power, Volume2, VolumeX, Bell, BellOff, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function Header() {
  const {
    socketConnected, mode, authenticated, accountType, balance,
    demoBalance, realBalance, setAccount, disconnectPo, botRunning,
    prefs, setPrefs, resetSim,
  } = useTrader()

  // flash the balance emerald/red on change (trade settlement, reset)
  // — setState-during-render pattern (React docs: adjusting state when a value changes)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const [prevBalance, setPrevBalance] = useState(balance)
  if (balance !== prevBalance) {
    if (prevBalance > 0) setFlash(balance > prevBalance ? 'up' : 'down')
    setPrevBalance(balance)
  }
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 950)
    return () => clearTimeout(t)
  }, [flash])

  const statusColor = !socketConnected
    ? 'bg-red-500'
    : mode === 'live' && authenticated
      ? 'bg-emerald-500'
      : mode === 'simulation'
        ? 'bg-amber-500'
        : 'bg-zinc-500'

  const statusText = !socketConnected
    ? 'Engine offline'
    : mode === 'live' && authenticated
      ? 'Live · Pocket Option'
      : mode === 'simulation'
        ? 'Simulation'
        : mode === 'live'
          ? 'Authenticating…'
          : 'Not connected'

  const handleAccountSwitch = (real: boolean) => {
    const next = real ? 'real' : 'demo'
    if (real && accountType !== 'real') {
      toast.warning('Switching to REAL money account', {
        description: 'Auto-trades will use real funds. Trade responsibly!',
      })
    }
    setAccount(next)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/70">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-extrabold tracking-tight text-zinc-50 sm:text-base">
              PO TRADER <span className="text-emerald-400">PRO</span>
            </h1>
            <p className="hidden text-[10px] text-zinc-500 sm:block">Pocket Option Auto-Trading Bot</p>
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          <span className={`relative flex h-2.5 w-2.5`}>
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${statusColor} opacity-60`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${statusColor}`} />
          </span>
          <span className="text-xs font-semibold text-zinc-300">{statusText}</span>
        </div>

        {/* Bot status */}
        <Badge
          variant="outline"
          className={`hidden items-center gap-1 border sm:inline-flex ${
            botRunning
              ? 'border-emerald-700 bg-emerald-950/50 text-emerald-400'
              : 'border-zinc-800 bg-zinc-900 text-zinc-500'
          }`}
        >
          {botRunning ? <Activity className="h-3 w-3 animate-pulse" /> : <Bot className="h-3 w-3" />}
          {botRunning ? 'BOT RUNNING' : 'BOT IDLE'}
        </Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Alerts: sound + browser notifications + help */}
          <div className="hidden items-center gap-1 md:flex" title="Signal & trade alerts">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPrefs({ sound: !prefs.sound })}
              aria-label={prefs.sound ? 'Mute alert sounds' : 'Enable alert sounds'}
              aria-pressed={prefs.sound}
              className={cn(
                'h-7 w-7 p-0',
                prefs.sound ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              {prefs.sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPrefs({ notifications: !prefs.notifications })
                if (!prefs.notifications) {
                  toast.success('Browser notifications enabled', {
                    description: 'You will be notified of new signals and settled trades',
                  })
                }
              }}
              aria-label={prefs.notifications ? 'Disable browser notifications' : 'Enable browser notifications'}
              aria-pressed={prefs.notifications}
              className={cn(
                'h-7 w-7 p-0',
                prefs.notifications ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-600 hover:text-zinc-400'
              )}
            >
              {prefs.notifications ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            </Button>
            <HelpDialog />
          </div>

          {/* Balance display (+ sim reset in simulation mode) */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
            <span className={`text-[10px] font-bold uppercase ${accountType === 'real' ? 'text-red-400' : 'text-emerald-400'}`}>
              {accountType === 'real' ? 'REAL' : 'DEMO'}
            </span>
            <span className={cn(
              'font-mono text-sm font-bold tabular-nums text-zinc-50',
              flash === 'up' && 'flash-up',
              flash === 'down' && 'flash-down'
            )}>
              ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {mode === 'simulation' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={resetSim}
                aria-label="Reset simulated balance to $10,000"
                title="Reset simulated balance to $10,000 demo / $1,000 real"
                className="h-5 w-5 p-0 text-zinc-500 hover:text-amber-300"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Demo/Real switch */}
          <div className="hidden items-center gap-2 sm:flex">
            <span className={`text-[10px] font-semibold ${accountType === 'demo' ? 'text-emerald-400' : 'text-zinc-600'}`}>DEMO</span>
            <Switch
              checked={accountType === 'real'}
              onCheckedChange={handleAccountSwitch}
              aria-label="Toggle demo/real account"
              className="data-[state=checked]:bg-red-600 data-[state=unchecked]:bg-emerald-700"
            />
            <span className={`text-[10px] font-semibold ${accountType === 'real' ? 'text-red-400' : 'text-zinc-600'}`}>REAL</span>
          </div>

          {/* Connect / disconnect */}
          {mode === 'disconnected' ? (
            <ConnectDialog>
              <Button size="sm" className="bg-emerald-600 font-bold text-white hover:bg-emerald-500">
                <Plug className="mr-1.5 h-4 w-4" />
                Connect
              </Button>
            </ConnectDialog>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { disconnectPo(); toast.info('Disconnected from trading engine') }}
              className="border-red-900/60 bg-red-950/30 font-semibold text-red-300 hover:bg-red-900/40 hover:text-red-200"
            >
              <Power className="mr-1.5 h-4 w-4" />
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
