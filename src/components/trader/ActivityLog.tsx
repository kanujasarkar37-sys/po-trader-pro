'use client'

import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTrader } from './store'
import { Terminal } from 'lucide-react'

export function ActivityLog() {
  const { logs } = useTrader()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Terminal className="h-3.5 w-3.5 text-emerald-500" />
          Engine Activity
        </h2>
        <span className="text-[10px] text-zinc-600">{logs.length} events</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 px-3 py-2 font-mono">
          {logs.length === 0 && (
            <p className="py-6 text-center text-[11px] text-zinc-600">No activity yet</p>
          )}
          {logs.slice(-80).map((l, i) => (
            <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
              <span className="shrink-0 text-zinc-700">
                {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={logColor(l.msg)}>{l.msg}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  )
}

function logColor(msg: string): string {
  if (msg.includes('🟢') || msg.includes('WIN') || msg.includes('✅')) return 'text-emerald-400'
  if (msg.includes('🔴') || msg.includes('LOSS') || msg.includes('❌') || msg.includes('failed')) return 'text-red-400'
  if (msg.includes('⚠') || msg.includes('🛑') || msg.includes('⚠️')) return 'text-amber-400'
  if (msg.includes('🤖')) return 'text-emerald-300'
  if (msg.includes('📤')) return 'text-zinc-200'
  if (msg.includes('📊') || msg.includes('📰')) return 'text-sky-300'
  return 'text-zinc-500'
}
