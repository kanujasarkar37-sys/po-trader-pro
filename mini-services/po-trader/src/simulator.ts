// ─── Market Simulator ────────────────────────────────────────────────────────
// Generates realistic price streams + candle history for ALL assets so the
// entire bot (signals, trades, balance, stats) works end-to-end without a
// live Pocket Option SSID. Uses a regime-switching random walk with trends,
// mean-reversion and volatility clustering — similar to real OTC feeds.

import type { Candle } from './types'
import { ASSET_UNIVERSE, assetVol, assetBasePrice, assetDigits } from './assets'

interface SimState {
  price: number
  drift: number
  regime: 'trend' | 'range' | 'volatile'
  regimeTicksLeft: number
  vol: number
}

export class MarketSimulator {
  private states = new Map<string, SimState>()
  private lastTickAt = new Map<string, number>()
  onTick: (asset: string, price: number) => void = () => {}
  running = false
  private timer: ReturnType<typeof setInterval> | null = null

  start() {
    if (this.running) return
    this.running = true
    for (const a of ASSET_UNIVERSE) {
      this.states.set(a.asset, {
        price: a.basePrice * (1 + (Math.random() - 0.5) * 0.004),
        drift: 0,
        regime: 'range',
        regimeTicksLeft: 200 + Math.floor(Math.random() * 400),
        vol: a.vol,
      })
    }
    this.timer = setInterval(() => this.tickAll(), 500) // 2 ticks/sec per asset
  }

  stop() {
    this.running = false
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private tickAll() {
    const now = Date.now()
    for (const [asset, st] of this.states) {
      // NB: default 0 (not now) — defaulting to `now` would skip the first
      // tick forever because now-last would always be < 450ms
      const last = this.lastTickAt.get(asset) ?? 0
      if (now - last < 450) continue
      this.lastTickAt.set(asset, now)
      this.step(asset, st)
      this.onTick(asset, round(st.price, assetDigits(asset)))
    }
  }

  private step(asset: string, st: SimState) {
    // regime switching
    st.regimeTicksLeft--
    if (st.regimeTicksLeft <= 0) {
      const roll = Math.random()
      st.regime = roll < 0.4 ? 'range' : roll < 0.85 ? 'trend' : 'volatile'
      st.regimeTicksLeft = 150 + Math.floor(Math.random() * 500)
      if (st.regime === 'trend') st.drift = (Math.random() - 0.5) * 2 * 0.35 // -0.35..0.35 sigma per step
      else st.drift = 0
      if (st.regime === 'volatile') st.vol = assetVol(asset) * (2 + Math.random() * 2)
      else st.vol = assetVol(asset) * (0.8 + Math.random() * 0.5)
    }
    // per-tick scaling: 120 ticks/min must match history() per-minute dynamics
    // (history: 12 substeps → drift 1.8·σ, pull 0.036, noise 1.12σ per minute)
    // NB: drift is multiplicative and must use vol NORMALISED BY PRICE — asset
    // vols are absolute dollars (ETHUSD $3.2/min vs EURUSD $0.0004/min), so a
    // raw drift×vol multiplier explodes for high-priced assets.
    const TICKS_PER_MIN = 120
    const base = assetBasePrice(asset)
    const pull = (base - st.price) / base * (st.regime === 'range' ? 0.036 / TICKS_PER_MIN : 0.0096 / TICKS_PER_MIN)
    const noise = (gauss() + gauss() * 0.5) * st.vol / Math.sqrt(TICKS_PER_MIN)
    const driftTerm = st.drift * (st.vol / base) * (1.8 / TICKS_PER_MIN)
    st.price = st.price * (1 + driftTerm + pull) + noise
    if (st.price <= base * 0.7) st.price = base * 0.7
    if (st.price >= base * 1.3) st.price = base * 1.3
  }

  /** Generate synthetic M1 history (count candles ending at current minute). */
  history(asset: string, count: number): Candle[] {
    const st = this.states.get(asset)
    const base = assetBasePrice(asset)
    const vol = assetVol(asset)
    const digits = assetDigits(asset)
    const nowSec = Math.floor(Date.now() / 1000)
    const endTs = Math.floor(nowSec / 60) * 60 // current candle open
    const candles: Candle[] = []
    let price = base * (1 + (Math.random() - 0.5) * 0.01)
    let drift = 0
    for (let i = count - 1; i >= 0; i--) {
      const ts = endTs - i * 60
      if (Math.random() < 0.02) drift = (Math.random() - 0.5) * 0.8
      if (Math.random() < 0.03) drift = 0
      const open = price
      let hi = open, lo = open
      // 12 sub-steps per candle — drift normalised by price (see step()):
      // asset vols are absolute dollars, so drift must scale by vol/base.
      // (The old raw drift×vol multiplier corrupted high-priced assets —
      // ETHUSD/SP500 history degenerated to ±1e+300 closes.)
      for (let s = 0; s < 12; s++) {
        const pull = (base - price) / base * 0.003
        const noise = (gauss() + gauss() * 0.5) * vol / Math.sqrt(12)
        price = price * (1 + drift * (vol / base) * 0.15 + pull) + noise
        hi = Math.max(hi, price)
        lo = Math.min(lo, price)
      }
      if (price <= base * 0.7) price = base * 0.7
      if (price >= base * 1.3) price = base * 1.3
      candles.push({ time: ts, open: round(open, digits), high: round(hi, digits), low: round(lo, digits), close: round(price, digits) })
    }
    // sync simulator state with the tail of generated history
    if (st) st.price = price
    return candles
  }

  currentPrice(asset: string): number {
    const st = this.states.get(asset)
    return st ? round(st.price, assetDigits(asset)) : assetBasePrice(asset)
  }
}

function gauss(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}
