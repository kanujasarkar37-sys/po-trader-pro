// ─── Technical indicators (pure functions, no deps) ─────────────────────────
// All functions operate on arrays of numbers (closes unless stated otherwise).

export function sma(values: number[], period: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : NaN)
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const out: number[] = []
  const k = 2 / (period + 1)
  let prev = NaN
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += values[j]
      prev = sum / period
      out.push(prev)
    } else if (i < period - 1) {
      out.push(NaN)
    } else {
      prev = values[i] * k + prev * (1 - k)
      out.push(prev)
    }
  }
  return out
}

export function rma(values: number[], period: number): number[] {
  // Wilder's smoothing
  const out: number[] = []
  let prev = NaN
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += values[j]
      prev = sum / period
      out.push(prev)
    } else if (i < period - 1) {
      out.push(NaN)
    } else {
      prev = (prev * (period - 1) + values[i]) / period
      out.push(prev)
    }
  }
  return out
}

export function rsi(closes: number[], period = 14): number[] {
  const gains: number[] = [0]
  const losses: number[] = [0]
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gains.push(Math.max(0, d))
    losses.push(Math.max(0, -d))
  }
  const ag = rma(gains, period)
  const al = rma(losses, period)
  return closes.map((_, i) => {
    if (isNaN(ag[i]) || isNaN(al[i])) return NaN
    if (al[i] === 0) return 100
    const rs = ag[i] / al[i]
    return 100 - 100 / (1 + rs)
  })
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = closes.map((_, i) =>
    !isNaN(emaFast[i]) && !isNaN(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN
  )
  const valid = macdLine.filter(v => !isNaN(v))
  const signalValid = ema(valid, signal)
  const offset = macdLine.length - valid.length
  const signalLine = macdLine.map((_, i) => (i >= offset ? signalValid[i - offset] : NaN))
  const histogram = macdLine.map((v, i) =>
    !isNaN(v) && !isNaN(signalLine[i]) ? v - signalLine[i] : NaN
  )
  return { macdLine, signalLine, histogram }
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period)
  const upper: number[] = []
  const lower: number[] = []
  const bandwidth: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN); lower.push(NaN); bandwidth.push(NaN)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += Math.pow(closes[j] - mid[i], 2)
    const sd = Math.sqrt(sum / period)
    upper.push(mid[i] + mult * sd)
    lower.push(mid[i] - mult * sd)
    bandwidth.push(mid[i] !== 0 ? ((upper[i] - lower[i]) / mid[i]) * 100 : NaN)
  }
  return { mid, upper, lower, bandwidth }
}

export function stochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const rawK: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) { rawK.push(NaN); continue }
    let hh = -Infinity, ll = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, highs[j])
      ll = Math.min(ll, lows[j])
    }
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100)
  }
  const valid = rawK.filter(v => !isNaN(v))
  const kValid = sma(valid, kSmooth)
  const offset = rawK.length - valid.length
  const k = rawK.map((_, i) => (i >= offset ? kValid[i - offset] : NaN))
  const kv = k.filter(v => !isNaN(v))
  const dValid = sma(kv, dPeriod)
  const dOffset = k.length - kv.length
  const d = k.map((_, i) => (i >= dOffset ? dValid[i - dOffset] : NaN))
  return { k, d }
}

export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const out: number[] = [highs[0] - lows[0]]
  for (let i = 1; i < closes.length; i++) {
    out.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ))
  }
  return out
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  return rma(trueRange(highs, lows, closes), period)
}

export function adx(highs: number[], lows: number[], closes: number[], period = 14) {
  const plusDM: number[] = [0]
  const minusDM: number[] = [0]
  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1]
    const down = lows[i - 1] - lows[i]
    plusDM.push(up > down && up > 0 ? up : 0)
    minusDM.push(down > up && down > 0 ? down : 0)
  }
  const tr = rma(trueRange(highs, lows, closes), period)
  const pdm = rma(plusDM, period)
  const mdm = rma(minusDM, period)
  const plusDI = closes.map((_, i) => (tr[i] > 0 && !isNaN(tr[i]) ? (pdm[i] / tr[i]) * 100 : NaN))
  const minusDI = closes.map((_, i) => (tr[i] > 0 && !isNaN(tr[i]) ? (mdm[i] / tr[i]) * 100 : NaN))
  const dx = closes.map((_, i) => {
    if (isNaN(plusDI[i]) || isNaN(minusDI[i])) return NaN
    const sum = plusDI[i] + minusDI[i]
    return sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100
  })
  const valid = dx.filter(v => !isNaN(v))
  const adxValid = rma(valid, period)
  const offset = dx.length - valid.length
  const adxLine = dx.map((_, i) => (i >= offset ? adxValid[i - offset] : NaN))
  return { adx: adxLine, plusDI, minusDI }
}

// ─── Fractal swing points (support / resistance) ─────────────────────────────
export function fractals(highs: number[], lows: number[], left = 2, right = 2) {
  const resistance: { index: number; price: number }[] = []
  const support: { index: number; price: number }[] = []
  for (let i = left; i < highs.length - right; i++) {
    let isRes = true, isSup = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      if (highs[j] >= highs[i]) isRes = false
      if (lows[j] <= lows[i]) isSup = false
    }
    if (isRes) resistance.push({ index: i, price: highs[i] })
    if (isSup) support.push({ index: i, price: lows[i] })
  }
  return { resistance, support }
}

// ─── Candlestick pattern detection (last closed candle) ─────────────────────
export interface PatternResult {
  score: number // -1 (bearish) .. +1 (bullish)
  name: string
}

export function detectPattern(o: number, h: number, l: number, c: number, prevO: number, prevH: number, prevL: number, prevC: number): PatternResult {
  const body = Math.abs(c - o)
  const range = h - l || 1e-9
  const upperWick = h - Math.max(o, c)
  const lowerWick = Math.min(o, c) - l
  const prevBody = Math.abs(prevC - prevO)

  // Bullish engulfing
  if (prevC < prevO && c > o && c >= prevO && o <= prevC && body > prevBody * 1.05)
    return { score: 0.9, name: 'Bullish Engulfing' }
  // Bearish engulfing
  if (prevC > prevO && c < o && o >= prevC && c <= prevO && body > prevBody * 1.05)
    return { score: -0.9, name: 'Bearish Engulfing' }
  // Hammer
  if (lowerWick > body * 2 && upperWick < body * 0.6 && body / range < 0.4)
    return { score: 0.7, name: 'Hammer / Pin Bar' }
  // Shooting star
  if (upperWick > body * 2 && lowerWick < body * 0.6 && body / range < 0.4)
    return { score: -0.7, name: 'Shooting Star' }
  // Doji (indecision)
  if (body / range < 0.08)
    return { score: 0, name: 'Doji' }
  // Momentum candles
  if (body / range > 0.75) {
    if (c > o) return { score: 0.5, name: 'Bullish Momentum' }
    return { score: -0.5, name: 'Bearish Momentum' }
  }
  if (c > o) return { score: 0.15, name: 'Bullish Candle' }
  return { score: -0.15, name: 'Bearish Candle' }
}

// ─── RSI divergence detection over recent window ────────────────────────────
export function rsiDivergence(closes: number[], rsiVals: number[], lookback = 30): number {
  // returns +1 bullish divergence, -1 bearish divergence, 0 none
  const n = closes.length
  if (n < lookback + 5) return 0
  const win: number[] = []
  for (let i = n - lookback; i < n; i++) win.push(i)
  // find local extremes of price in window
  let minI = win[0], maxI = win[0]
  for (const i of win) {
    if (closes[i] < closes[minI]) minI = i
    if (closes[i] > closes[maxI]) maxI = i
  }
  const last = n - 1
  // Bullish: price makes lower low, RSI makes higher low
  if (minI < last - 3 && closes[last] <= closes[minI] * 1.0005 && rsiVals[last] > rsiVals[minI] + 2)
    return 1
  // Bearish: price makes higher high, RSI makes lower high
  if (maxI < last - 3 && closes[last] >= closes[maxI] * 0.9995 && rsiVals[last] < rsiVals[maxI] - 2)
    return -1
  return 0
}
