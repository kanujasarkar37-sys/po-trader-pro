// ─── Client-side backtest engine: replays REAL M1 candles through a Strategy ─
// Pure functions — imported by StrategyLab (client). O(n) incremental indicators.

import type { Strategy, StrategyCondition, StrategySide } from './strategy-schema'

export interface Candle {
  time: number  // unix seconds (M1)
  open: number
  high: number
  low: number
  close: number
}

export interface BacktestTrade {
  time: number
  direction: 'call' | 'put'
  result: 'win' | 'loss' | 'draw'
  profit: number
  openPrice: number
  closePrice: number
}

export interface HourStat {
  hour: number
  trades: number
  winRate: number
}

export interface StrategyBacktestResult {
  strategyName: string
  asset: string
  candles: number
  trades: number
  wins: number
  losses: number
  draws: number
  winRate: number
  totalProfit: number
  maxDrawdown: number
  maxWinStreak: number
  maxLossStreak: number
  profitCurve: number[]
  tradeList: BacktestTrade[] // last 100
  byHour: HourStat[]
  payout: number
}

// ─── incremental indicators ─────────────────────────────────────────────────

/** EMA seeded with the SMA of the first `period` values; NaN until seeded. */
function makeEma(period: number) {
  const k = 2 / (period + 1)
  let sum = 0
  let count = 0
  let value = NaN
  return (x: number): number => {
    if (Number.isNaN(value)) {
      sum += x
      count++
      if (count >= period) value = sum / period
      return value
    }
    value = (x - value) * k + value
    return value
  }
}

/** Wilder RSI on closes; NaN until warmed. */
function makeRsi(period: number) {
  let avgGain = 0
  let avgLoss = 0
  let prev = NaN
  let count = 0
  let ready = false
  return (close: number): number => {
    if (Number.isNaN(prev)) {
      prev = close
      return NaN
    }
    const ch = close - prev
    prev = close
    const gain = ch > 0 ? ch : 0
    const loss = ch < 0 ? -ch : 0
    if (!ready) {
      count++
      avgGain += gain
      avgLoss += loss
      if (count >= period) {
        avgGain /= period
        avgLoss /= period
        ready = true
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    if (!ready) return NaN
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100
    return 100 - 100 / (1 + avgGain / avgLoss)
  }
}

/** Wilder ATR; NaN until warmed. */
function makeAtr(period: number) {
  let prevClose = NaN
  let sum = 0
  let atr = NaN
  let count = 0
  return (h: number, l: number, c: number): number => {
    const tr = Number.isNaN(prevClose)
      ? h - l
      : Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose))
    prevClose = c
    if (Number.isNaN(atr)) {
      count++
      sum += tr
      if (count >= period) atr = sum / period
      return atr
    }
    atr = (atr * (period - 1) + tr) / period
    return atr
  }
}

/** Fixed-window ring buffer with running sum / sum-of-squares (SMA + stdev). */
function makeWindow(period: number) {
  const buf = new Array<number>(period).fill(NaN)
  let sum = 0
  let sumSq = 0
  let idx = 0
  let count = 0
  return (x: number) => {
    const old = buf[idx]
    if (!Number.isNaN(old)) {
      sum -= old
      sumSq -= old * old
    }
    buf[idx] = x
    sum += x
    sumSq += x * x
    idx = (idx + 1) % period
    if (count < period) count++
    if (count < period) return { ok: false as const, mean: NaN, std: NaN }
    const mean = sum / period
    const variance = Math.max(0, sumSq / period - mean * mean)
    return { ok: true as const, mean, std: Math.sqrt(variance) }
  }
}

// ─── evaluation context ─────────────────────────────────────────────────────

interface EvalCtx {
  rsi: number
  stochK: number
  stochD: number
  macdHist: number
  bbUpper: number
  bbMid: number
  bbLower: number
  close: number
  open: number
  high: number
  low: number
  bodyPct: number
  atrPct: number
  emas: number[] // ema0..ema3
  ema50: number
}

function resolveValue(id: string, ctx: EvalCtx): number {
  switch (id) {
    case 'rsi': return ctx.rsi
    case 'stochK': return ctx.stochK
    case 'stochD': return ctx.stochD
    case 'macdHist': return ctx.macdHist
    case 'bbUpper': return ctx.bbUpper
    case 'bbMid': return ctx.bbMid
    case 'bbLower': return ctx.bbLower
    case 'close': return ctx.close
    case 'open': return ctx.open
    case 'high': return ctx.high
    case 'low': return ctx.low
    case 'bodyPct': return ctx.bodyPct
    case 'atrPct': return ctx.atrPct
    case 'ema0': return ctx.emas[0] ?? NaN
    case 'ema1': return ctx.emas[1] ?? NaN
    case 'ema2': return ctx.emas[2] ?? NaN
    case 'ema3': return ctx.emas[3] ?? NaN
    default: return NaN
  }
}

function evalCond(c: StrategyCondition, ctx: EvalCtx): boolean {
  const l = resolveValue(c.left, ctx)
  const r = typeof c.right === 'number' ? c.right : resolveValue(c.right, ctx)
  if (!Number.isFinite(l) || !Number.isFinite(r)) return false
  switch (c.op) {
    case '>': return l > r
    case '<': return l < r
    case '>=': return l >= r
    case '<=': return l <= r
    default: return false
  }
}

function sideMatch(side: StrategySide, ctx: EvalCtx): boolean {
  if (!side.all.every((c) => evalCond(c, ctx))) return false
  if (side.any.length && !side.any.some((g) => g.every((c) => evalCond(c, ctx)))) return false
  return true
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── main engine ────────────────────────────────────────────────────────────

/**
 * Replays real M1 candles through the strategy:
 * conditions on closed candle i → entry at OPEN of i+1 → settlement at CLOSE of i+1.
 * CALL wins iff close > open strictly, PUT mirrored, equal close/open = draw (stake back).
 * stake = 1. Win → +payout/100, loss → -1, draw → 0.
 */
export function backtestStrategy(
  candles: Candle[],
  strategy: Strategy,
  payout = 92,
  asset = '—'
): StrategyBacktestResult {
  const clean = candles.filter(
    (c) =>
      c && Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close) && c.open > 0
  )

  const ind = strategy.rules.indicators
  const needEma50 = strategy.rules.filters.trendAlign === 'ema50'
  const maxIndicatorPeriod = Math.max(
    needEma50 ? 50 : 0,
    ...ind.emaPeriods,
    ind.rsiPeriod,
    ind.bollingerPeriod,
    ind.stochK + ind.stochD,
    ind.atrPeriod,
    ind.macdSlow + ind.macdSignal
  )

  // warmup ~200 candles (or less if history is short, but always ≥ longest indicator)
  let warmup = Math.max(200, maxIndicatorPeriod + 5)
  if (clean.length < warmup + 20) {
    warmup = Math.max(Math.min(maxIndicatorPeriod + 5, Math.floor(clean.length * 0.5)), 5)
  }

  // indicator instances
  const emas = ind.emaPeriods.map((p) => makeEma(p))
  const ema50 = makeEma(50)
  const rsi = makeRsi(ind.rsiPeriod)
  const atr = makeAtr(ind.atrPeriod)
  const bbWin = makeWindow(ind.bollingerPeriod)
  // Stochastic state: ring of {high,low} for %K, ring of %K values for %D (SMA)
  const kHlBuf: { h: number; l: number }[] = []
  const kValBuf: number[] = []
  const macdFastEma = makeEma(ind.macdFast)
  const macdSlowEma = makeEma(ind.macdSlow)
  const macdSignalEma = makeEma(ind.macdSignal)

  const trades: BacktestTrade[] = []
  let wins = 0
  let losses = 0
  let draws = 0
  let totalProfit = 0
  let peak = 0
  let maxDrawdown = 0
  let curWinStreak = 0
  let curLossStreak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  const profitCurve: number[] = [0]
  const hours = new Map<number, { trades: number; wins: number }>()

  const filters = strategy.rules.filters
  const minAtrPct = filters.minAtrPct
  const maxAtrPct = filters.maxAtrPct

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    const ctx: EvalCtx = {
      rsi: rsi(c.close),
      stochK: NaN,
      stochD: NaN,
      macdHist: NaN,
      bbUpper: NaN,
      bbMid: NaN,
      bbLower: NaN,
      close: c.close,
      open: c.open,
      high: c.high,
      low: c.low,
      bodyPct: c.open > 0 ? (Math.abs(c.close - c.open) / c.open) * 100 : NaN,
      atrPct: NaN,
      emas: emas.map((fn) => fn(c.close)),
      ema50: ema50(c.close),
    }

    const atrNow = atr(c.high, c.low, c.close)
    if (Number.isFinite(atrNow) && c.close > 0) {
      ctx.atrPct = (atrNow / c.close) * 100
    }

    // Stochastic: %K = (close - LL(n)) / (HH(n) - LL(n)) * 100, %D = SMA(%K, stochD)
    kHlBuf.push({ h: c.high, l: c.low })
    if (kHlBuf.length > ind.stochK) kHlBuf.shift()
    if (kHlBuf.length === ind.stochK) {
      let hi = -Infinity
      let lo = Infinity
      for (const b of kHlBuf) {
        if (b.h > hi) hi = b.h
        if (b.l < lo) lo = b.l
      }
      if (hi > lo) {
        const k = ((c.close - lo) / (hi - lo)) * 100
        ctx.stochK = k
        kValBuf.push(k)
        if (kValBuf.length > ind.stochD) kValBuf.shift()
        if (kValBuf.length === ind.stochD) {
          ctx.stochD = kValBuf.reduce((a, b) => a + b, 0) / kValBuf.length
        }
      }
    }

    // Bollinger
    const bWin = bbWin(c.close)
    if (bWin.ok) {
      ctx.bbMid = bWin.mean
      ctx.bbUpper = bWin.mean + ind.bollingerMult * bWin.std
      ctx.bbLower = bWin.mean - ind.bollingerMult * bWin.std
    }

    // MACD histogram
    const mf = macdFastEma(c.close)
    const ms = macdSlowEma(c.close)
    if (Number.isFinite(mf) && Number.isFinite(ms)) {
      const macd = mf - ms
      const sig = macdSignalEma(macd)
      if (Number.isFinite(sig)) ctx.macdHist = macd - sig
    }

    // signal evaluation only after warmup, and only if a next candle exists
    if (i < warmup || i + 1 >= clean.length) continue

    // filters — skip flat / wild markets before considering entries
    if (minAtrPct != null && !(ctx.atrPct > minAtrPct)) continue
    if (maxAtrPct != null && !(ctx.atrPct < maxAtrPct)) continue

    let callMatch = sideMatch(strategy.rules.call, ctx)
    let putMatch = sideMatch(strategy.rules.put, ctx)
    if (callMatch && putMatch) continue // conflict — stand aside
    if (!callMatch && !putMatch) continue

    // trend alignment filter
    if (filters.trendAlign === 'ema50') {
      if (callMatch && !(ctx.close > ctx.ema50)) callMatch = false
      if (putMatch && !(ctx.close < ctx.ema50)) putMatch = false
      if (!callMatch && !putMatch) continue
    }

    const direction: 'call' | 'put' = callMatch ? 'call' : 'put'
    const entry = clean[i + 1]
    const openPrice = entry.open
    const closePrice = entry.close
    let result: 'win' | 'loss' | 'draw'
    if (closePrice === openPrice) result = 'draw'
    else if (direction === 'call') result = closePrice > openPrice ? 'win' : 'loss'
    else result = closePrice < openPrice ? 'win' : 'loss'

    const profit = result === 'win' ? payout / 100 : result === 'loss' ? -1 : 0
    trades.push({
      time: entry.time,
      direction,
      result,
      profit: round2(profit),
      openPrice,
      closePrice,
    })

    if (result === 'win') {
      wins++
      curWinStreak++
      curLossStreak = 0
    } else if (result === 'loss') {
      losses++
      curLossStreak++
      curWinStreak = 0
    } else {
      draws++
    }
    maxWinStreak = Math.max(maxWinStreak, curWinStreak)
    maxLossStreak = Math.max(maxLossStreak, curLossStreak)

    totalProfit += profit
    profitCurve.push(round2(totalProfit))
    peak = Math.max(peak, totalProfit)
    maxDrawdown = Math.max(maxDrawdown, peak - totalProfit)

    const hr = new Date(entry.time * 1000).getUTCHours()
    const h = hours.get(hr) ?? { trades: 0, wins: 0 }
    h.trades++
    if (result === 'win') h.wins++
    hours.set(hr, h)
  }

  const n = trades.length
  const byHour: HourStat[] = [...hours.entries()]
    .map(([hour, h]) => ({ hour, trades: h.trades, winRate: Math.round((h.wins / h.trades) * 1000) / 10 }))
    .sort((a, b) => a.hour - b.hour)

  return {
    strategyName: strategy.name,
    asset,
    candles: clean.length,
    trades: n,
    wins,
    losses,
    draws,
    winRate: n > 0 ? Math.round((wins / n) * 1000) / 10 : 0,
    totalProfit: round2(totalProfit),
    maxDrawdown: round2(maxDrawdown),
    maxWinStreak,
    maxLossStreak,
    profitCurve,
    tradeList: trades.slice(-100),
    byHour,
    payout,
  }
}
