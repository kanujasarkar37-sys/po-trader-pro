// Compare: backtest on history()-generated candles vs step()-generated candles
// (the live pipeline builds candles from step() ticks — if WRs differ, the two
// generators are different markets and backtests on history() are misleading)
import { MarketSimulator } from '../mini-services/po-trader/src/simulator.ts'
import { backtest } from '../mini-services/po-trader/src/backtest.ts'

// Access private step via a subclass shim
class Stepper extends MarketSimulator {
  genCandles(asset, count) {
    // replicate tickAll: 120 ticks per minute, one step each
    const base = 3280 // placeholder, use asset base
    const st = { price: 1.0856 * (1 + (Math.random() - 0.5) * 0.004), drift: 0, regime: 'range', regimeTicksLeft: 250, vol: 0.00012 }
    const candles = []
    const nowSec = Math.floor(Date.now() / 1000)
    const endTs = Math.floor(nowSec / 60) * 60
    for (let i = count - 1; i >= 0; i--) {
      const ts = endTs - i * 60
      const open = st.price; let hi = open, lo = open
      for (let t = 0; t < 120; t++) {
        this.stepOnce(asset, st)
        hi = Math.max(hi, st.price); lo = Math.min(lo, st.price)
      }
      candles.push({ time: ts, open: round5(open), high: round5(hi), low: round5(lo), close: round5(st.price) })
    }
    return candles
  }
  stepOnce(asset, st) {
    st.regimeTicksLeft--
    if (st.regimeTicksLeft <= 0) {
      const roll = Math.random()
      st.regime = roll < 0.4 ? 'range' : roll < 0.85 ? 'trend' : 'volatile'
      st.regimeTicksLeft = 150 + Math.floor(Math.random() * 500)
      if (st.regime === 'trend') st.drift = (Math.random() - 0.5) * 2 * 0.35
      else st.drift = 0
      const av = asset === 'EURUSD_otc' ? 0.00012 : 0.00015
      if (st.regime === 'volatile') st.vol = av * (2 + Math.random() * 2)
      else st.vol = av * (0.8 + Math.random() * 0.5)
    }
    const base = asset === 'EURUSD_otc' ? 1.0856 : 1.2712
    const pull = (base - st.price) / base * (st.regime === 'range' ? 0.036 / 120 : 0.0096 / 120)
    const noise = (gauss() + gauss() * 0.5) * st.vol / Math.sqrt(120)
    const driftTerm = st.drift * (st.vol / base) * (1.8 / 120)
    st.price = st.price * (1 + driftTerm + pull) + noise
    if (st.price <= base * 0.7) st.price = base * 0.7
    if (st.price >= base * 1.3) st.price = base * 1.3
  }
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
function round5(v) { return Math.round(v * 1e5) / 1e5 }

const stepper = new Stepper()
const sim = new MarketSimulator()
const assets = ['EURUSD_otc', 'GBPUSD_otc']
for (const thr of [65, 70]) {
  for (const path of ['history', 'step']) {
    let trades = 0, wins = 0
    for (const asset of assets) {
      for (let seed = 0; seed < 4; seed++) {
        const candles = path === 'history' ? sim.history(asset, 2000) : stepper.genCandles(asset, 2000)
        const r = backtest(candles, asset, 92, { minConfidence: thr, expirySeconds: 60 })
        trades += r.wins + r.losses; wins += r.wins
      }
    }
    console.log(`thr ${thr} · ${path.padEnd(8)}: ${String(trades).padStart(4)} trades  WR ${trades ? (wins / trades * 100).toFixed(1) : 'n/a'}%`)
  }
}
