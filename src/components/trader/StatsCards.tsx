'use client'

import { useTrader } from './store'
import { DollarSign, Target, TrendingUp, ListOrdered, Zap, Bot, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatsCards() {
  const { stats, balance, signals, botRunning, mode, trades } = useTrader()

  const winRate = stats?.winRate ?? 0
  const profit = stats?.profit ?? 0
  const totalTrades = stats?.totalTrades ?? 0
  const openTrades = stats?.openTrades ?? 0
  const strongSignals = signals.filter(s => s.confidence >= 70).length
  const exposure = trades.filter(t => t.status === 'open').reduce((a, t) => a + t.amount, 0)
  const exposurePct = (balance ?? 0) > 0 ? Math.min(100, (exposure / (balance ?? 1)) * 100) : 0

  const cards = [
    {
      label: 'Balance',
      value: `$${(balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      tone: mode === 'simulation' ? 'amber' : 'emerald',
      sub: mode === 'simulation' ? 'simulated funds' : 'live account',
      chip: mode === 'simulation' ? 'from-amber-500/20 to-amber-700/10 text-amber-500' : 'from-emerald-500/20 to-emerald-700/10 text-emerald-500',
    },
    {
      label: 'Win Rate',
      value: totalTrades > 0 ? `${winRate}%` : '—',
      icon: Target,
      tone: winRate >= 60 ? 'emerald' : winRate >= 52 ? 'amber' : totalTrades === 0 ? 'zinc' : 'red',
      sub: `${totalTrades} settled trades`,
      chip: winRate >= 60 ? 'from-emerald-500/20 to-emerald-700/10 text-emerald-500' : winRate >= 52 ? 'from-amber-500/20 to-amber-700/10 text-amber-500' : totalTrades === 0 ? 'from-zinc-500/15 to-zinc-700/10 text-zinc-500' : 'from-red-500/20 to-red-700/10 text-red-500',
    },
    {
      label: 'Total P/L',
      value: totalTrades > 0 ? `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}` : '—',
      icon: TrendingUp,
      tone: profit > 0 ? 'emerald' : profit < 0 ? 'red' : 'zinc',
      sub: 'all settled trades',
      chip: profit > 0 ? 'from-emerald-500/20 to-emerald-700/10 text-emerald-500' : profit < 0 ? 'from-red-500/20 to-red-700/10 text-red-500' : 'from-zinc-500/15 to-zinc-700/10 text-zinc-500',
    },
    {
      label: 'Open Trades',
      value: String(openTrades),
      icon: ListOrdered,
      tone: openTrades > 0 ? 'amber' : 'zinc',
      sub: openTrades > 0 ? 'in progress' : 'none active',
      chip: openTrades > 0 ? 'from-amber-500/20 to-amber-700/10 text-amber-500' : 'from-zinc-500/15 to-zinc-700/10 text-zinc-500',
    },
    {
      label: 'Exposure',
      value: `$${exposure.toFixed(2)}`,
      icon: Crosshair,
      tone: exposure > 0 ? (exposurePct > 40 ? 'red' : 'amber') : 'zinc',
      sub: exposure > 0 ? `${exposurePct.toFixed(1)}% of balance at risk` : 'nothing staked',
      chip: exposure > 0 ? (exposurePct > 40 ? 'from-red-500/20 to-red-700/10 text-red-500' : 'from-amber-500/20 to-amber-700/10 text-amber-500') : 'from-zinc-500/15 to-zinc-700/10 text-zinc-500',
    },
    {
      label: 'Signals (≥70%)',
      value: String(strongSignals),
      icon: Zap,
      tone: 'amber',
      sub: 'this session',
      chip: 'from-amber-500/20 to-amber-700/10 text-amber-500',
    },
    {
      label: 'Bot Status',
      value: botRunning ? 'RUNNING' : 'IDLE',
      icon: Bot,
      tone: botRunning ? 'emerald' : 'zinc',
      sub: botRunning ? 'auto-trading active' : 'press START to begin',
      chip: botRunning ? 'from-emerald-500/20 to-emerald-700/10 text-emerald-500' : 'from-zinc-500/15 to-zinc-700/10 text-zinc-500',
      live: botRunning,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            'card-lift relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 hover:border-zinc-700',
            c.live && 'border-emerald-900/60'
          )}
        >
          {/* subtle corner glow */}
          <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-emerald-500/[0.06] blur-xl" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{c.label}</span>
            <span className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br',
              c.chip
            )}>
              <c.icon className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className={cn(
            'mt-1.5 font-mono text-lg font-extrabold tabular-nums tracking-tight sm:text-xl',
            c.tone === 'emerald' ? 'text-emerald-400' : c.tone === 'red' ? 'text-red-400' : c.tone === 'amber' ? 'text-amber-400' : 'text-zinc-100'
          )}>
            {c.value}
            {c.live && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle price-glow" />}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-600">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}
