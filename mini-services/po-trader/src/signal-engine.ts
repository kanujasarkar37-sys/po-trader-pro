// ─── Signal Engine: multi-indicator confluence with regime detection ────────
// Research conclusion: single indicators fail on 1-min binary options.
// This engine combines 8 weighted components, adapts weights to market regime
// (trending vs ranging), applies volatility + news filters, and only emits a
// signal when confidence exceeds the threshold AND the payout-adjusted
// expected edge is positive.

import type { Candle, Signal, SignalComponents } from './types'
import {
  ema, rsi, macd, bollinger, stochastic, atr, adx, fractals, detectPattern, rsiDivergence,
} from './indicators'

export interface EngineOptions {
  minConfidence: number
  expirySeconds: number
  newsBias?: number | null // -1 (bearish news) .. +1 (bullish news) for this asset
  useNewsFilter?: boolean
  useHtf?: boolean // v5: include M15 higher-timeframe confluence (default true)
  // v9: per-asset empirical win-rate (from settled bot trades) — blended into
  // the payout-adjusted edge estimate so the engine stops trading assets whose
  // live results disprove the theoretical confidence
  assetWinRate?: { wr: number; trades: number } | null
}

export interface AnalysisResult {
  signal: Signal | null
  score: number // -100 .. +100
  regime: 'trending' | 'ranging'
  components: SignalComponents
  reasons: string[]
  indicatorSnapshot: {
    ema9: number; ema21: number; ema50: number
    rsi: number; stochK: number; stochD: number
    macdHist: number; macdLine: number; macdSignal: number
    bbUpper: number; bbMid: number; bbLower: number; bbPctB: number; bbBandwidth: number
    atr: number; atrAvg: number; adx: number
    pattern: string
  }
}

let signalCounter = 0

export function analyze(candles: Candle[], asset: string, payout: number, opts: EngineOptions): AnalysisResult {
  const n = candles.length
  const emptySnap = {
    ema9: NaN, ema21: NaN, ema50: NaN, rsi: NaN, stochK: NaN, stochD: NaN,
    macdHist: NaN, macdLine: NaN, macdSignal: NaN, bbUpper: NaN, bbMid: NaN,
    bbLower: NaN, bbPctB: NaN, bbBandwidth: NaN, atr: NaN, atrAvg: NaN, adx: NaN,
    pattern: 'n/a',
  }
  if (n < 60) {
    return { signal: null, score: 0, regime: 'ranging', components: zeroComponents(), reasons: ['Not enough candle history'], indicatorSnapshot: emptySnap }
  }

  const closes = candles.map(c => c.close)
  const highs = candles.map(c => c.high)
  const lows = candles.map(c => c.low)

  const e9 = ema(closes, 9)
  const e21 = ema(closes, 21)
  const e50 = ema(closes, 50)
  const r = rsi(closes, 14)
  const st = stochastic(highs, lows, closes, 14, 3, 3)
  const md = macd(closes)
  const bb = bollinger(closes, 20, 2)
  const at = atr(highs, lows, closes, 14)
  const ad = adx(highs, lows, closes, 14)

  const i = n - 1 // last CLOSED candle
  const price = closes[i]

  const snap = {
    ema9: e9[i], ema21: e21[i], ema50: e50[i],
    rsi: r[i], stochK: st.k[i], stochD: st.d[i],
    macdHist: md.histogram[i], macdLine: md.macdLine[i], macdSignal: md.signalLine[i],
    bbUpper: bb.upper[i], bbMid: bb.mid[i], bbLower: bb.lower[i],
    bbPctB: (price - bb.lower[i]) / ((bb.upper[i] - bb.lower[i]) || 1e-9),
    bbBandwidth: bb.bandwidth[i],
    atr: at[i],
    atrAvg: avg(at.slice(Math.max(0, i - 50), i + 1).filter(v => !isNaN(v))),
    adx: ad.adx[i],
    pattern: 'n/a',
  }

  // ── Volatility filter: dead market ──
  const reasons: string[] = []
  let blocked = false // v9: hard blocks (dead market, squeeze) — no signal regardless of score
  if (snap.atr < snap.atrAvg * 0.35) {
    reasons.push('Volatility too low (dead market)')
    blocked = true
  }

  // ── v9: Bollinger squeeze block ──
  // Inside a volatility squeeze (bandwidth in the bottom decile of the last
  // 100 candles) breakouts are directionally unreliable — the first expansion
  // candle frequently fakes both ways. Wait for bandwidth to leave the squeeze
  // before committing a 60s position.
  {
    const bwWin = bb.bandwidth.slice(-100).filter(v => !isNaN(v))
    if (bwWin.length >= 50) {
      const sorted = [...bwWin].sort((a, b) => a - b)
      const p12 = sorted[Math.floor(sorted.length * 0.12)]
      if (snap.bbBandwidth < p12) {
        reasons.push('Bollinger squeeze — waiting for expansion')
        blocked = true
      }
    }
  }

  // ── Regime detection ──
  const adxVal = !isNaN(snap.adx) ? snap.adx : 15
  const emaSpread = Math.abs(snap.ema9 - snap.ema21) / (snap.atr || 1e-9)
  const trending = adxVal > 23 || emaSpread > 2.2
  const regime: 'trending' | 'ranging' = trending ? 'trending' : 'ranging'

  // ═══ Component scores in [-1, +1] ═══

  // 9. Multi-timeframe (M5) trend alignment — aggregated from the M1 window.
  // A 1-min signal that agrees with the 5-min trend has materially higher
  // expectancy; an M1 signal fighting a strong M5 trend is faded.
  let mtfScore = 0
  const m5 = aggregateCandles(candles, 5)
  const m5n = m5.length
  if (m5n >= 30) {
    const m5closes = m5.map(c => c.close)
    const me9 = ema(m5closes, 9)
    const me21 = ema(m5closes, 21)
    const me50 = ema(m5closes, 50)
    const m5r = rsi(m5closes, 14)
    const j5 = m5n - 1
    let trend = 0
    if (me9[j5] > me21[j5] && me21[j5] > me50[j5]) trend = 1
    else if (me9[j5] < me21[j5] && me21[j5] < me50[j5]) trend = -1
    else trend = me9[j5] > me21[j5] ? 0.4 : -0.4
    // slope of the M5 EMA9 over the last 3 M5 candles (normalised by ATR)
    const slope = (me9[j5] - me9[Math.max(0, j5 - 3)]) / (snap.atr * 3 || 1e-9)
    const slopeC = clamp(slope, -1, 1) * 0.5
    // RSI zone confirmation on M5
    const m5rsi = m5r[j5]
    let rsiC = 0
    if (!isNaN(m5rsi)) {
      if (m5rsi > 55) rsiC = 0.25
      else if (m5rsi < 45) rsiC = -0.25
    }
    mtfScore = clamp(trend * 0.6 + slopeC * Math.sign(trend === 0 ? 1 : trend) + rsiC, -1, 1)
    if (Math.abs(mtfScore) >= 0.7) {
      reasons.push(mtfScore > 0 ? 'M5 trend aligned (bullish)' : 'M5 trend aligned (bearish)')
    } else if (mtfScore >= 0.5) {
      reasons.push('M5 bias bullish')
    } else if (mtfScore <= -0.5) {
      reasons.push('M5 bias bearish')
    }
  }

  // 10. Higher-timeframe (M15) macro trend — the v5 upgrade. M1 entries in
  // the direction of the 15-minute macro flow avoid counter-trend traps:
  // EMA9/21 alignment + slope + RSI zone on the M15 chart. Deliberately
  // slightly softer-weighted than M5 (a 15-min trend turns slower and lags
  // fast reversals), but it vetoes strong counter-macro M1 setups.
  let htfScore = 0
  const useHtf = opts.useHtf !== false
  const m15 = aggregateCandles(candles, 15)
  const m15n = m15.length
  if (useHtf && m15n >= 26) {
    const m15closes = m15.map(c => c.close)
    const h9 = ema(m15closes, 9)
    const h21 = ema(m15closes, 21)
    const h5r = rsi(m15closes, 14)
    const j15 = m15n - 1
    let macro = 0
    if (h9[j15] > h21[j15]) macro = 1
    else if (h9[j15] < h21[j15]) macro = -1
    // slope of M15 EMA9 across the last 2 M15 candles (≈30 min), ATR-normalised
    const hSlope = (h9[j15] - h9[Math.max(0, j15 - 2)]) / (snap.atr * 4 || 1e-9)
    const slopeC15 = clamp(hSlope, -1, 1) * 0.4
    // RSI macro zone: strong trends live above/below 50
    const hRsi = h5r[j15]
    let rsiC15 = 0
    if (!isNaN(hRsi)) {
      if (hRsi > 56) rsiC15 = 0.3
      else if (hRsi < 44) rsiC15 = -0.3
    }
    htfScore = clamp(macro * 0.55 + slopeC15 * Math.sign(macro === 0 ? 1 : macro) + rsiC15, -1, 1)
    if (Math.abs(htfScore) >= 0.65) {
      reasons.push(htfScore > 0 ? 'M15 macro trend bullish' : 'M15 macro trend bearish')
    }
  }

  // 1. EMA trend alignment
  let emaScore = 0
  if (snap.ema9 > snap.ema21 && snap.ema21 > snap.ema50) emaScore = 1
  else if (snap.ema9 < snap.ema21 && snap.ema21 < snap.ema50) emaScore = -1
  else {
    // partial alignment: use 9 vs 21
    emaScore = snap.ema9 > snap.ema21 ? 0.4 : -0.4
  }

  // 2. RSI — regime-dependent interpretation
  let rsiScore = 0
  const rsiVal = snap.rsi
  if (regime === 'ranging') {
    if (rsiVal <= 28) rsiScore = 1
    else if (rsiVal <= 35) rsiScore = 0.6
    else if (rsiVal >= 72) rsiScore = -1
    else if (rsiVal >= 65) rsiScore = -0.6
    else rsiScore = (50 - rsiVal) / 50 * 0.2
  } else {
    // trending: momentum confirmation (RSI 50-70 bullish zone, 30-50 bearish)
    if (rsiVal > 52 && rsiVal < 72) rsiScore = 0.55
    else if (rsiVal < 48 && rsiVal > 28) rsiScore = -0.55
    else if (rsiVal >= 72) rsiScore = -0.35 // overextended → fade risk
    else if (rsiVal <= 28) rsiScore = 0.35
  }
  // RSI divergence (strong reversal signal)
  const div = rsiDivergence(closes.slice(0, i + 1), r.slice(0, i + 1))
  if (div === 1) { rsiScore += 0.5; reasons.push('Bullish RSI divergence') }
  if (div === -1) { rsiScore -= 0.5; reasons.push('Bearish RSI divergence') }
  rsiScore = clamp(rsiScore, -1, 1)

  // 3. Stochastic cross in zones
  let stochScore = 0
  const kPrev = st.k[i - 1], dPrev = st.d[i - 1]
  if (!isNaN(kPrev) && !isNaN(dPrev)) {
    const kUp = snap.stochK > snap.stochD && kPrev <= dPrev
    const kDown = snap.stochK < snap.stochD && kPrev >= dPrev
    if (kUp && snap.stochK < 35) stochScore = 1
    else if (kUp && snap.stochK < 50) stochScore = 0.5
    else if (kDown && snap.stochK > 65) stochScore = -1
    else if (kDown && snap.stochK > 50) stochScore = -0.5
    else stochScore = (snap.stochK - 50) / 50 * 0.15
  }

  // 4. MACD
  let macdScore = 0
  const histPrev = md.histogram[i - 1]
  if (!isNaN(histPrev)) {
    const flipped = snap.macdHist > 0 && histPrev <= 0
    const flippedDown = snap.macdHist < 0 && histPrev >= 0
    if (flipped) macdScore = 0.9
    else if (flippedDown) macdScore = -0.9
    else macdScore = clamp(snap.macdHist / (snap.atr * 0.25 || 1e-9), -0.6, 0.6)
    // zero-line boost
    if (snap.macdLine > 0 && snap.macdSignal > 0) macdScore += 0.2
    if (snap.macdLine < 0 && snap.macdSignal < 0) macdScore -= 0.2
    macdScore = clamp(macdScore, -1, 1)
  }

  // 5. Bollinger position
  let bbScore = 0
  if (regime === 'ranging') {
    if (price <= snap.bbLower) bbScore = 1
    else if (price <= snap.bbLower + (snap.bbUpper - snap.bbLower) * 0.15) bbScore = 0.7
    else if (price >= snap.bbUpper) bbScore = -1
    else if (price >= snap.bbUpper - (snap.bbUpper - snap.bbLower) * 0.15) bbScore = -0.7
    else bbScore = (snap.bbMid - price) / ((snap.bbUpper - snap.bbLower) / 2 || 1e-9) * 0.4
  } else {
    // band walk in trend = continuation
    if (price > snap.bbUpper * 0.999) bbScore = emaScore > 0 ? 0.5 : -0.3
    else if (price < snap.bbLower * 1.001) bbScore = emaScore < 0 ? -0.5 : 0.3
    else bbScore = clamp((price - snap.bbMid) / (snap.atr || 1e-9) * 0.25, -0.5, 0.5)
  }

  // 6. Candlestick pattern
  const pat = detectPattern(
    candles[i].open, candles[i].high, candles[i].low, candles[i].close,
    candles[i - 1].open, candles[i - 1].high, candles[i - 1].low, candles[i - 1].close,
  )
  snap.pattern = pat.name
  let patternScore = pat.score
  // In ranging markets, a momentum candle INTO a Bollinger extreme is
  // capitulation — the mean-reversion components already capture it, so the
  // pattern's continuation bias must be neutralized to avoid contradiction.
  if (regime === 'ranging') {
    const bandRange = snap.bbUpper - snap.bbLower
    const atLower = price <= snap.bbLower + bandRange * 0.12
    const atUpper = price >= snap.bbUpper - bandRange * 0.12
    if (atLower && patternScore < 0) patternScore = patternScore * 0.25
    if (atUpper && patternScore > 0) patternScore = patternScore * 0.25
  }

  // 7. Support/Resistance proximity (fractal-based)
  let srScore = 0
  {
    const lookback = candles.slice(Math.max(0, n - 80))
    const { resistance, support } = fractals(
      lookback.map(c => c.high), lookback.map(c => c.low)
    )
    const nearSup = support.filter(s => Math.abs(s.price - price) < snap.atr * 0.5).length
    const nearRes = resistance.filter(s => Math.abs(s.price - price) < snap.atr * 0.5).length
    if (nearSup > 0 && nearRes === 0) srScore = 0.8
    else if (nearRes > 0 && nearSup === 0) srScore = -0.8
    else if (nearSup > nearRes) srScore = 0.4
    else if (nearRes > nearSup) srScore = -0.4
    // v9: wick-rejection quality — a support bounce backed by a visible lower
    // wick (buyers defending the level) is a materially better CALL than a bare
    // proximity read; mirror-image for resistance rejections.
    const lastC = candles[i]
    const lBody = Math.abs(lastC.close - lastC.open)
    const lLowerWick = Math.min(lastC.open, lastC.close) - lastC.low
    const lUpperWick = lastC.high - Math.max(lastC.open, lastC.close)
    if (srScore > 0 && lLowerWick > lBody * 0.8) {
      srScore = Math.min(1, srScore + 0.15)
      reasons.push('Support wick rejection')
    }
    if (srScore < 0 && lUpperWick > lBody * 0.8) {
      srScore = Math.max(-1, srScore - 0.15)
      reasons.push('Resistance wick rejection')
    }
    if (srScore > 0) reasons.push('Near fractal support')
    if (srScore < 0) reasons.push('Near fractal resistance')
  }

  // 8. Momentum: last-3-candle body direction + volume proxy (range expansion)
  let momentumScore = 0
  {
    let bull = 0, bear = 0
    for (let j = Math.max(1, i - 2); j <= i; j++) {
      if (candles[j].close > candles[j].open) bull++
      else bear++
    }
    const avgRange = avg(candles.slice(Math.max(0, i - 20), i).map(c => c.high - c.low))
    const lastRange = candles[i].high - candles[i].low
    const expansion = clamp(lastRange / (avgRange || 1e-9), 0, 2)
    momentumScore = ((bull - bear) / 3) * 0.7 + (bull > bear ? 1 : -1) * (expansion - 1) * 0.3
    momentumScore = clamp(momentumScore, -1, 1)
    if (regime === 'ranging') {
      // same capitulation neutralization for momentum at band extremes
      const bandRange = snap.bbUpper - snap.bbLower
      const atLower = price <= snap.bbLower + bandRange * 0.12
      const atUpper = price >= snap.bbUpper - bandRange * 0.12
      if (atLower && momentumScore < 0) momentumScore = momentumScore * 0.3
      if (atUpper && momentumScore > 0) momentumScore = momentumScore * 0.3
    }
  }

  // ═══ Weighted confluence ═══
  // Weights shift with regime (research: trend-following in trends, mean-reversion in ranges)
  // MTF (M5 trend) matters in both regimes — higher-timeframe alignment is the
  // single strongest confirmation for 1-min binary entries. The M15 macro trend
  // is NOT flat-weighted: calibration showed it hurts mid-band entries, so it
  // is applied below as a one-sided veto/bonus instead (see "M15 macro veto").
  const W = regime === 'trending'
    ? { ema: 0.24, rsi: 0.09, stoch: 0.07, macd: 0.17, bb: 0.09, pattern: 0.09, sr: 0.05, momentum: 0.09, mtf: 0.11, htf: 0 }
    : { ema: 0.05, rsi: 0.21, stoch: 0.14, macd: 0.09, bb: 0.19, pattern: 0.09, sr: 0.06, momentum: 0.05, mtf: 0.12, htf: 0 }

  const components: SignalComponents = {
    ema: emaScore, rsi: rsiScore, stoch: stochScore, macd: macdScore,
    bollinger: bbScore, pattern: patternScore, sr: srScore, momentum: momentumScore, mtf: mtfScore, htf: htfScore,
  }

  let score = W.ema * emaScore + W.rsi * rsiScore + W.stoch * stochScore + W.macd * macdScore +
    W.bb * bbScore + W.pattern * patternScore + W.sr * srScore + W.momentum * momentumScore +
    W.mtf * mtfScore + W.htf * htfScore

  // ── M15 macro veto (calibrated) ──
  // A/B studies (24 × 2000-candle datasets, identical data per arm) showed a
  // flat M15 weight HURTS mid-band mean-reversion entries (-5pp at thr 65/70)
  // while dramatically improving the ≥75% band. Final design: one-sided veto —
  // counter-macro signals are penalised (0.06 × htf magnitude), aligned ones
  // pass unchanged. Confirmed: thr 65/70 neutral (±0.4pp), thr 75 = +5.6pp
  // win-rate with 54% more trades.
  if (useHtf && htfScore !== 0 && score !== 0) {
    const aligned = Math.sign(htfScore) === Math.sign(score)
    if (!aligned) {
      score -= htfScore * Math.sign(score) * 0.06 // counter-macro penalty only
    }
  }

  // ── v9: DI directional confirmation ──
  // ADX is already computed for regime detection — but +DI/−DI carry the
  // DIRECTION of the trend. In a confirmed trend (ADX > 23), a signal aligned
  // with the dominant DI gets a small boost; one fighting a wide DI spread is
  // faded (binary options entries against a strong directional flow lose
  // disproportionately often within 60s).
  {
    const diPlus = ad.plusDI[i], diMinus = ad.minusDI[i]
    if (!isNaN(diPlus) && !isNaN(diMinus) && adxVal > 23 && score !== 0) {
      const diNet = clamp((diPlus - diMinus) / 100, -1, 1) // -1..+1
      const aligned = Math.sign(diNet) === Math.sign(score)
      if (aligned && Math.abs(diNet) > 0.1) {
        score += Math.min(0.06, Math.abs(diNet) * 0.08)
        reasons.push('DI flow aligned')
      } else if (!aligned && Math.abs(diNet) > 0.15) {
        score -= Math.min(0.08, Math.abs(diNet) * 0.1)
        reasons.push('DI flow opposed — faded')
      }
    }
  }

  // ── v9: overextension guard (trending regime) ──
  // Chasing a trend that has already stretched > 2.5 ATR from EMA21 is the
  // classic 60s-loss trap: mean-reversion snap-backs hit exactly there. The
  // penalty scales with the stretch and points AGAINST the stretch direction
  // (i.e. it trims chase signals, not reversal signals).
  {
    const stretch = (price - snap.ema21) / (snap.atr || 1e-9)
    if (regime === 'trending' && Math.abs(stretch) > 2.5) {
      score -= Math.sign(stretch) * Math.min(0.1, (Math.abs(stretch) - 2.5) * 0.05)
      reasons.push(`Overextended ${Math.abs(stretch).toFixed(1)} ATR from EMA21 — chase risk`) 
    }
  }

  // ── News bias adjustment ──
  if (opts.useNewsFilter && opts.newsBias != null && opts.newsBias !== 0) {
    score += opts.newsBias * 0.08
    if (opts.newsBias > 0.5) reasons.push('Positive news bias')
    if (opts.newsBias < -0.5) reasons.push('Negative news bias')
  }

  const scorePct = clamp(score, -1, 1) * 100

  // ── Signal generation ──
  const confidence = Math.min(95, Math.round(Math.abs(scorePct) * 1.18))
  const direction: 'call' | 'put' = scorePct > 0 ? 'call' : 'put'

  // payout-aware edge check: estimated win probability must beat breakeven.
  // v9: the estimate is BLENDED with the asset's realised bot win-rate once a
  // meaningful sample exists (≥12 trades, weight capped at 0.5 scaling with
  // sample size) — theoretical confluence that live results disprove stops
  // passing the edge gate.
  let estWinProb = 50 + confidence * 0.32 // calibrated estimate (0.32 scaling is conservative)
  if (opts.assetWinRate && opts.assetWinRate.trades >= 12) {
    const w = Math.min(0.5, 0.3 + opts.assetWinRate.trades / 200) // 0.36..0.5
    estWinProb = estWinProb * (1 - w) + opts.assetWinRate.wr * w
  }
  const breakeven = 100 / (100 + payout) * 100
  const edge = estWinProb - breakeven

  let signal: Signal | null = null
  if (confidence >= opts.minConfidence && edge > 0 && !blocked) {
    const now = Date.now()
    const period = opts.expirySeconds
    const nextBoundary = nextCandleOpen(now, period)
    signal = {
      id: `sig-${Date.now()}-${++signalCounter}`,
      asset,
      direction,
      confidence,
      expirySeconds: period,
      createdAt: now,
      entryAt: nextBoundary,
      expiresAt: nextBoundary + period * 1000,
      price,
      payout,
      components,
      regime,
      reasons: buildReasons(reasons, components, pat.name, regime),
      acted: false,
    }
  }

  return { signal, score: scorePct, regime, components, reasons, indicatorSnapshot: snap }
}

function buildReasons(base: string[], c: SignalComponents, pattern: string, regime: string): string[] {
  const out = [...base]
  out.unshift(`${regime === 'trending' ? 'Trending' : 'Ranging'} market`)
  out.push(`Pattern: ${pattern}`)
  const strong = (Object.entries(c) as [string, number][])
    .filter(([, v]) => Math.abs(v) >= 0.7)
    .map(([k]) => k.toUpperCase())
  if (strong.length) out.push(`Strong: ${strong.join(', ')}`)
  return out
}

export function nextCandleOpen(nowMs: number, periodSeconds: number): number {
  const p = periodSeconds * 1000
  return Math.ceil((nowMs + 1500) / p) * p
}

function avg(arr: number[]): number {
  const v = arr.filter(x => !isNaN(x))
  if (!v.length) return NaN
  return v.reduce((a, b) => a + b, 0) / v.length
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function zeroComponents(): SignalComponents {
  return { ema: 0, rsi: 0, stoch: 0, macd: 0, bollinger: 0, pattern: 0, sr: 0, momentum: 0, mtf: 0, htf: 0 }
}

/** Aggregate M1 candles into higher-timeframe candles (factor minutes). */
export function aggregateCandles(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles
  const bucketSec = factor * 60
  const out: Candle[] = []
  let cur: Candle | null = null
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur)
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close }
    } else {
      if (c.high > cur.high) cur.high = c.high
      if (c.low < cur.low) cur.low = c.low
      cur.close = c.close
    }
  }
  if (cur) out.push(cur)
  return out
}
