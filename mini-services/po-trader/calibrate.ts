// Calibration study: test signal engine accuracy across confidence thresholds
import { MarketSimulator } from './src/simulator'
import { backtest } from './src/backtest'

const sim = new MarketSimulator()
const assets = ['EURUSD_otc', 'GBPUSD_otc', 'USDJPY_otc', 'BTCUSD', 'GOLD', 'AUDCAD_otc']

// Run 3 independent market seeds per asset, 2000 candles each
const results = new Map<number, { trades: number; wins: number; losses: number }>()
for (const threshold of [65, 70, 75, 80, 85]) results.set(threshold, { trades: 0, wins: 0, losses: 0 })

let totalTrades = 0
for (const asset of assets) {
  for (let seed = 0; seed < 2; seed++) {
    const candles = sim.history(asset, 2000)
    for (const threshold of results.keys()) {
      const r = backtest(candles, asset, 92, { minConfidence: threshold, expirySeconds: 60 })
      const agg = results.get(threshold)!
      agg.trades += r.wins + r.losses
      agg.wins += r.wins
      agg.losses += r.losses
      totalTrades += r.trades
    }
  }
}

console.log('Calibration results (payout 92%, breakeven = 52.1%):')
for (const [threshold, agg] of results) {
  const wr = agg.trades ? (agg.wins / agg.trades * 100).toFixed(1) : 'n/a'
  console.log(`  ≥${threshold}% confidence: ${agg.trades} trades, win-rate ${wr}%`)
}
console.log('total trades generated:', totalTrades)
