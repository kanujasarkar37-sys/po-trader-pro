// ─── Candle Manager ──────────────────────────────────────────────────────────
// Maintains per-asset M1 candle buffers (up to maxCount, default 2000) built
// from live ticks (updateStream / simulator) and historical backfills
// (load_history_period). Handles candle rollover at minute boundaries.

import type { Candle } from './types'

export class CandleManager {
  private closed = new Map<string, Candle[]>() // closed candles only, oldest→newest
  private forming = new Map<string, Candle>()
  private maxCount: number
  /** Optional hook: fired once per candle that transitions forming→closed. */
  onClose: ((asset: string, candle: Candle) => void) | null = null

  constructor(maxCount = 2000) {
    this.maxCount = maxCount
  }

  /** Feed a live price tick; builds the forming candle and rolls it over. */
  tick(asset: string, price: number, tsMs = Date.now()) {
    const ts = Math.floor(tsMs / 1000)
    const bucket = Math.floor(ts / 60) * 60
    let f = this.forming.get(asset)
    if (!f) {
      f = { time: bucket, open: price, high: price, low: price, close: price }
      this.forming.set(asset, f)
      return
    }
    if (bucket > f.time) {
      // rollover: close previous candle
      this.pushClosed(asset, f)
      f = { time: bucket, open: price, high: price, low: price, close: price }
      this.forming.set(asset, f)
      return
    }
    f.high = Math.max(f.high, price)
    f.low = Math.min(f.low, price)
    f.close = price
  }

  /** Merge historical candles [ts, open, close, high, low] (PO order!). */
  mergeHistory(asset: string, data: [number, number, number, number, number][]) {
    const incoming: Candle[] = data.map(d => ({
      time: d[0],
      open: d[1],
      high: d[3],
      low: d[4],
      close: d[2],
    }))
    if (!incoming.length) return
    const list = this.closed.get(asset) ?? []
    const byTime = new Map<number, Candle>()
    for (const c of list) byTime.set(c.time, c)
    for (const c of incoming) byTime.set(c.time, c)
    const merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time)
    this.closed.set(asset, merged.slice(-this.maxCount))
    // drop closed candles that are in the past vs forming
    const f = this.forming.get(asset)
    if (f) {
      this.closed.set(asset, (this.closed.get(asset) ?? []).filter(c => c.time < f.time))
    }
  }

  /** Seed candles directly (simulator history). */
  seed(asset: string, candles: Candle[]) {
    const sorted = [...candles].sort((a, b) => a.time - b.time)
    const nowBucket = Math.floor(Date.now() / 60000) * 60
    const closedOnly = sorted.filter(c => c.time < nowBucket)
    const formingCandle = sorted.find(c => c.time === nowBucket)
    this.closed.set(asset, closedOnly.slice(-this.maxCount))
    if (formingCandle) this.forming.set(asset, { ...formingCandle })
  }

  /** Closed candles + the forming candle (nearly complete) for signal analysis. */
  analysisWindow(asset: string): Candle[] {
    const list = this.closed.get(asset) ?? []
    const f = this.forming.get(asset)
    if (f && (Date.now() / 1000) - f.time > 5) {
      return [...list, f] // include forming candle once it has data
    }
    return list
  }

  closedCandles(asset: string): Candle[] {
    return this.closed.get(asset) ?? []
  }

  /** Candle covering a given unix-second timestamp (for trade settlement). */
  candleAt(asset: string, tsSec: number): Candle | undefined {
    const bucket = Math.floor(tsSec / 60) * 60
    const f = this.forming.get(asset)
    if (f && f.time === bucket) return f
    return (this.closed.get(asset) ?? []).find(c => c.time === bucket)
  }

  lastPrice(asset: string): number {
    const f = this.forming.get(asset)
    if (f) return f.close
    const list = this.closed.get(asset)
    if (list && list.length) return list[list.length - 1].close
    return NaN
  }

  private pushClosed(asset: string, candle: Candle) {
    const list = this.closed.get(asset) ?? []
    const last = list.length ? list[list.length - 1] : null
    if (last && candle.time <= last.time) {
      // update in place (late rollover)
      if (candle.time === last.time) {
        list[list.length - 1] = candle
        this.closed.set(asset, list)
      }
      return
    }
    list.push(candle)
    if (list.length > this.maxCount) list.splice(0, list.length - this.maxCount)
    this.closed.set(asset, list)
    this.onClose?.(asset, candle)
  }

  /** Oldest closed candle timestamp (for backfill navigation). */
  oldestTs(asset: string): number | null {
    const list = this.closed.get(asset)
    return list && list.length ? list[0].time : null
  }

  count(asset: string): number {
    return (this.closed.get(asset) ?? []).length
  }

  formingCandle(asset: string): Candle | undefined {
    return this.forming.get(asset)
  }

  drop(asset: string) {
    this.closed.delete(asset)
    this.forming.delete(asset)
  }
}
