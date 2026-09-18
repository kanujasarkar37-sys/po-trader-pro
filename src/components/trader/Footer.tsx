'use client'

import { Bot, ShieldAlert, Github, Zap } from 'lucide-react'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-emerald-800">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="text-[11px] leading-tight">
            <p className="font-bold text-zinc-300">PO Trader Pro</p>
            <p className="text-zinc-600">Unofficial Pocket Option automation · use at your own risk</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-amber-500" />
            Binary options involve substantial risk of loss
          </span>
          <span className="hidden items-center gap-1 md:flex">
            <Zap className="h-3 w-3 text-emerald-500" />
            v9 accuracy engine · settlement fix · adaptive thresholds · telegram bridge
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Github className="h-3 w-3" />
            Engine v9.0 · Simulation &amp; Live modes
          </span>
        </div>
      </div>
    </footer>
  )
}
