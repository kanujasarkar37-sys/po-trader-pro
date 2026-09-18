// ─── Market sessions + recurring high-impact event calendar ──────────────────
// 100% local & deterministic — no external API needed. Provides:
//   * Trading sessions (Tokyo/London/NY) with active state & progress
//   * Reliably-recurring red-folder events (NFP first Friday, weekly jobless
//     claims, ISM on the 1st, monthly option expiry) with red-zone windows
// The engine consults inRedZone() to pause entries around scheduled shocks —
// classic binary-options risk management (whipsaw avoidance).

export interface SessionInfo {
  name: string
  openUtc: number // hours (UTC)
  closeUtc: number
  active: boolean
  progress: number // 0..100 through the session
  nextInMin: number // minutes until it opens (0 if active)
  color: string
}

export interface CalendarEvent {
  name: string
  ts: number // ms — next occurrence
  redWindowMin: number // total red window (± half around event time)
  kind: 'event' | 'session-open'
  currencies: string
  recurring: string
}

// Fixed UTC session hours (DST can shift ±1h — displayed as approximate)
const SESSION_DEFS: { name: string; open: number; close: number; color: string }[] = [
  { name: 'Sydney', open: 22, close: 7, color: 'sky' },
  { name: 'Tokyo', open: 0, close: 9, color: 'rose' },
  { name: 'London', open: 8, close: 16.5, color: 'emerald' },
  { name: 'New York', open: 13.5, close: 22, color: 'amber' },
]

export function sessions(now = new Date()): SessionInfo[] {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60
  return SESSION_DEFS.map(s => {
    const active = s.open < s.close
      ? utcH >= s.open && utcH < s.close
      : utcH >= s.open || utcH < s.close // wraps midnight
    let progress = 0
    if (active) {
      const len = s.open < s.close ? s.close - s.open : 24 - s.open + s.close
      const el = utcH >= s.open ? utcH - s.open : 24 - s.open + utcH
      progress = Math.min(100, Math.round((el / len) * 100))
    }
    const nextInMin = active ? 0 : Math.round(((s.open - utcH + 24) % 24) * 60)
    return { name: s.name, openUtc: s.open, closeUtc: s.close, active, progress, nextInMin, color: s.color }
  })
}

/** First Friday of the current/next month at 13:30 UTC */
function firstFriday(year: number, month: number): Date {
  const d = new Date(Date.UTC(year, month, 1, 13, 30, 0))
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Upcoming reliably-recurring high-impact events (times UTC, approximate —
 * DST can shift ±1h). Binary traders avoid the ±red-window around these.
 */
export function upcomingEvents(now = new Date(), count = 6): CalendarEvent[] {
  const out: CalendarEvent[] = []
  const y = now.getUTCFullYear()
  const mo = now.getUTCMonth()

  // ── NFP: first Friday of month, 13:30 UTC ──
  for (let k = -1; k <= 2; k++) {
    const mm = mo + k
    const d = firstFriday(y + Math.floor(mm / 12), ((mm % 12) + 12) % 12)
    if (d.getTime() > now.getTime() - 2 * 3600e3) {
      out.push({
        name: 'US Non-Farm Payrolls', ts: d.getTime(), redWindowMin: 30,
        kind: 'event', currencies: 'USD', recurring: '1st Friday · 13:30 UTC',
      })
    }
  }

  // ── Weekly Thursday jobless claims, 13:30 UTC ──
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(y, mo, now.getUTCDate() + i, 13, 30, 0))
    if (d.getUTCDay() === 4 && d.getTime() > now.getTime() - 3600e3) {
      out.push({
        name: 'US Initial Jobless Claims', ts: d.getTime(), redWindowMin: 15,
        kind: 'event', currencies: 'USD', recurring: 'Every Thursday · 13:30 UTC',
      })
    }
  }

  // ── ISM Manufacturing PMI: 1st of month 14:00 UTC (approx) ──
  for (const m of [mo, mo + 1]) {
    const d = new Date(Date.UTC(y, m, 1, 14, 0, 0))
    if (d.getTime() > now.getTime() - 3600e3) {
      out.push({
        name: 'ISM Manufacturing PMI', ts: d.getTime(), redWindowMin: 15,
        kind: 'event', currencies: 'USD', recurring: 'Monthly · 1st · 14:00 UTC',
      })
    }
  }

  // ── London open volatility window (08:00 UTC, next 3 occurrences) ──
  for (let i = 0; i < 2; i++) {
    const d = new Date(Date.UTC(y, mo, now.getUTCDate() + i, 8, 0, 0))
    if (d.getTime() > now.getTime()) {
      out.push({
        name: 'London open — liquidity surge', ts: d.getTime(), redWindowMin: 6,
        kind: 'session-open', currencies: 'GBP/EUR', recurring: 'Daily · 08:00 UTC',
      })
    }
  }
  // ── NY open volatility window (14:30 UTC) ──
  for (let i = 0; i < 2; i++) {
    const d = new Date(Date.UTC(y, mo, now.getUTCDate() + i, 14, 30, 0))
    if (d.getTime() > now.getTime()) {
      out.push({
        name: 'New York open — equity volatility', ts: d.getTime(), redWindowMin: 6,
        kind: 'session-open', currencies: 'USD', recurring: 'Daily · 14:30 UTC',
      })
    }
  }

  return out
    .filter((e, i, arr) => arr.findIndex(x => x.ts === e.ts && x.name === e.name) === i)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, count)
}

/** Is `now` inside any red window? Returns the event or null. */
export function redZone(now = new Date()): CalendarEvent | null {
  const list = upcomingEvents(now, 12)
  for (const e of list) {
    const half = e.redWindowMin / 2 * 60_000
    if (now.getTime() >= e.ts - half && now.getTime() <= e.ts + half) return e
  }
  return null
}

export interface CalendarSnapshot {
  sessions: SessionInfo[]
  events: Array<CalendarEvent & { inMin: number }>
  redZone: { name: string; endsInMin: number } | null
  utcTime: string
  weekendFx: boolean
}

export function calendarSnapshot(): CalendarSnapshot {
  const now = new Date()
  const rz = redZone(now)
  return {
    sessions: sessions(now),
    events: upcomingEvents(now, 6).map(e => ({ ...e, inMin: Math.max(0, Math.round((e.ts - now.getTime()) / 60000)) })),
    redZone: rz ? { name: rz.name, endsInMin: Math.max(0, Math.round((rz.ts + rz.redWindowMin / 2 * 60_000 - now.getTime()) / 60000)) } : null,
    utcTime: now.toISOString().slice(11, 19),
    weekendFx: now.getUTCDay() === 0 || (now.getUTCDay() === 6 && now.getUTCHours() >= 0),
  }
}
