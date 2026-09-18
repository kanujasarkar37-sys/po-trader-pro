'use client'

import { useTrader } from './store'
import { CalendarClock, Globe2, TriangleAlert, Clock3 } from 'lucide-react'
import { cn } from '@/lib/utils'

function fmtHours(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function fmtCountdown(min: number): string {
  if (min < 60) return `${min}m`
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${min % 60}m`
  return `${Math.floor(min / (60 * 24))}d ${Math.floor((min % (60 * 24)) / 60)}h`
}

const SESSION_COLORS: Record<string, string> = {
  sky: 'text-sky-400 border-sky-800/60 bg-sky-950/40',
  rose: 'text-rose-400 border-rose-800/60 bg-rose-950/40',
  emerald: 'text-emerald-400 border-emerald-800/60 bg-emerald-950/40',
  amber: 'text-amber-400 border-amber-800/60 bg-amber-950/40',
}
const SESSION_BARS: Record<string, string> = {
  sky: 'bg-sky-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
}

export function CalendarPanel() {
  const calendar = useTrader(s => s.calendar)
  const newsFilter = useTrader(s => s.config?.newsFilter)

  const rz = calendar?.redZone
  const nextEvent = calendar?.events.find(e => e.inMin > 0)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <CalendarClock className="h-3.5 w-3.5 text-amber-400" />
          Market Clock &amp; Events
        </h2>
        <span className="flex items-center gap-1 font-mono text-[10px] font-bold tabular-nums text-zinc-500">
          <Globe2 className="h-3 w-3" />
          {calendar?.utcTime ?? '--:--:--'} UTC
        </span>
      </div>

      {/* red-zone banner */}
      {rz ? (
        <div className="red-zone-pulse flex items-center gap-2 border-b border-red-900/60 bg-red-950/40 px-3 py-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 animate-pulse text-red-400" />
          <span className="truncate text-[10px] font-bold text-red-300">
            RED ZONE · {rz.name} · ends in {rz.endsInMin}m — entries paused
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5">
          <Clock3 className="h-3 w-3 shrink-0 text-emerald-500" />
          <span className="truncate text-[10px] text-zinc-500">
            {newsFilter === false
              ? 'Red-zone guard is OFF (enable news filter to pause around events)'
              : nextEvent
                ? <>Next: <strong className="text-zinc-300">{nextEvent.name}</strong> in <strong className="font-mono text-zinc-300">{fmtCountdown(nextEvent.inMin)}</strong></>
                : 'Scanning schedule…'}
          </span>
        </div>
      )}

      {/* sessions strip */}
      <div className="grid grid-cols-2 gap-1.5 border-b border-zinc-800/60 p-2 sm:grid-cols-4">
        {calendar?.sessions.map(s => (
          <div
            key={s.name}
            className={cn(
              'relative overflow-hidden rounded-lg border px-2 py-1.5 transition-colors',
              s.active
                ? SESSION_COLORS[s.color] ?? 'border-zinc-700 bg-zinc-900'
                : 'border-zinc-800/70 bg-zinc-900/40'
            )}
            title={`${s.name}: ${fmtHours(s.openUtc)}–${fmtHours(s.closeUtc)} UTC`}
          >
            <div className="flex items-center justify-between">
              <span className={cn('text-[10px] font-bold', s.active ? '' : 'text-zinc-500')}>
                {s.name}
              </span>
              {s.active ? (
                <span className="flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: 'currentColor' }} />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
                  </span>
                  <span className="text-[9px] font-bold">LIVE</span>
                </span>
              ) : (
                <span className="font-mono text-[9px] tabular-nums text-zinc-600">in {fmtCountdown(s.nextInMin)}</span>
              )}
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className={cn('h-full rounded-full transition-all duration-1000', s.active ? SESSION_BARS[s.color] ?? 'bg-zinc-500' : 'bg-zinc-700')}
                style={{ width: `${s.active ? s.progress : 0}%` }}
              />
            </div>
            <div className="mt-0.5 font-mono text-[8px] tabular-nums text-zinc-600">
              {fmtHours(s.openUtc)}–{fmtHours(s.closeUtc)} UTC
            </div>
          </div>
        ))}
      </div>

      {/* upcoming events */}
      <div className="min-h-0 flex-1 overflow-y-auto pretty-scroll">
        <div className="divide-y divide-zinc-900">
          {calendar?.events.map((e, i) => {
            const imminent = e.inMin <= 30
            const within = e.inMin <= e.redWindowMin / 2
            return (
              <div key={`${e.name}-${e.ts}-${i}`} className={cn('px-3 py-2', imminent && 'bg-amber-950/10')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-extrabold',
                        e.kind === 'event'
                          ? within ? 'bg-red-950/70 text-red-400' : 'bg-amber-950/60 text-amber-400'
                          : 'bg-zinc-900 text-zinc-400'
                      )}
                      title={e.kind === 'event' ? 'Scheduled economic release' : 'Market open volatility window'}
                    >
                      {e.kind === 'event' ? 'USD' : '⏱'}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-zinc-200">{e.name}</div>
                      <div className="truncate text-[9px] text-zinc-600">
                        {e.recurring} · affects {e.currencies} · red ±{Math.round(e.redWindowMin / 2)}m
                      </div>
                    </div>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums',
                    within ? 'bg-red-950/60 text-red-300' : imminent ? 'bg-amber-950/50 text-amber-300' : 'bg-zinc-900 text-zinc-500'
                  )}>
                    {within ? 'NOW' : e.inMin === 0 ? 'soon' : fmtCountdown(e.inMin)}
                  </span>
                </div>
              </div>
            )
          })}
          {!calendar?.events.length && (
            <div className="px-4 py-8 text-center">
              <CalendarClock className="mx-auto mb-2 h-7 w-7 text-zinc-800" />
              <p className="text-[11px] text-zinc-600">Waiting for calendar data…</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800/60 px-3 py-1.5 text-[9px] leading-relaxed text-zinc-600">
        Session hours &amp; event times are UTC approximations (DST can shift ±1h). During red zones the engine
        {newsFilter === false ? ' would pause entries — enable the news filter to activate.' : ' pauses bot entries to avoid whipsaw.'}
        {calendar?.weekendFx && <span className="ml-1 font-bold text-amber-500/80">Weekend: FX closed — OTC pairs keep running.</span>}
      </div>
    </div>
  )
}
