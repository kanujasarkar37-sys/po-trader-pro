// A/B calibration: v4 (M5 only) vs v5 (M5 + M15 macro trend) on identical data
// Run: bun run ab-test-v5.ts (from project root — outside the service dir so
// editing it never triggers the service's hot reload)
import { MarketSimulator } from '../mini-services/po-trader/src/simulator'
import { backtest } from './mini-services/po-trader/src/backtest'

const assets = ['EURUSD_otc', 'GBPUSD_otc', 'USDJPY_otc', 'BTCUSD', 'GOLD', 'AUDCAD_otc', 'EURJPY_otc', 'USDCHF_otc']
const SEEDS = 3

// Pre-generate identical market data per (asset, seed) so both arms see the
// exact same candles
const datasets: { asset: string; candles: any[] }[] = []
for (const asset of assets) {
  for (let seed = 0; seed < SEEDS; seed++) {
    const sim = new MarketSimulator()
    datasets.push({ asset, candles: sim.history(asset, 2000) })
  }
}

console.log(`A/B on ${datasets.length} × 2000-candle datasets (payout 92%, breakeven 52.1%):\n`)
console.log('THRESHOLD 65:')
for (const arm of [{ label: 'v4 (M5)   ', useHtf: false }, { label: 'v5 (M5+M15)', useHtf: true }] as const) {
  let trades = 0, wins = 0
  for (const d of datasets) {
    const r = backtest(d.candles, d.asset, 92, { minConfidence: 65, expirySeconds: 60, useHtf: arm.useHtf })
    trades += r.wins + r.losses; wins += r.wins
  }
  console.log(`  ${arm.label}: ${trades} trades, win-rate ${trades ? (wins / trades * 100).toFixed(1) : 'n/a'}%`)
}
console.log('THRESHOLD 70:')
for (const arm of [{ label: 'v4 (M5)   ', useHtf: false }, { label: 'v5 (M5+M15)', useHtf: true }] as const) {
  let trades = 0, wins = 0
  for (const d of datasets) {
    const r = backtest(d.candles, d.asset, 92, { minConfidence: 70, expirySeconds: 60, useHtf: arm.useHtf })
    trades += r.wins + r.losses; wins += r.wins
  }
  console.log(`  ${arm.label}: ${trades} trades, win-rate ${trades ? (wins / trades * 100).toFixed(1) : 'n/a'}%`)
}
console.log('THRESHOLD 75:')
for (const arm of [{ label: 'v4 (M5)   ', useHtf: false }, { label: 'v5 (M5+M15)', useHtf: true }] as const) {
  let trades = 0, wins = 0
  for (const d of datasets) {
    const r = backtest(d.candles, d.asset, 92, { minConfidence: 75, expirySeconds: 60, useHtf: arm.useHtf })
    trades += r.wins + r.losses; wins += r.wins
  }
  console.log(`  ${arm.label}: ${trades} trades, win-rate ${trades ? (wins / trades * 100).toFixed(1) : 'n/a'}%`)
}
