import { MarketSimulator } from '../mini-services/po-trader/src/simulator.ts'
import { backtest } from '../mini-services/po-trader/src/backtest.ts'
const assets = ['EURUSD_otc', 'GBPUSD_otc', 'USDJPY_otc', 'AUDCAD_otc', 'EURGBP_otc', 'BTCUSD', 'GOLD', 'ETHUSD']
console.log('Per-asset backtest @ threshold 70, 2 seeds each (fixed simulator):')
for (const asset of assets) {
  let trades = 0, wins = 0
  for (let seed = 0; seed < 2; seed++) {
    const sim = new MarketSimulator()
    const r = backtest(sim.history(asset, 2000), asset, 92, { minConfidence: 70, expirySeconds: 60 })
    trades += r.wins + r.losses; wins += r.wins
  }
  console.log(`  ${asset.padEnd(14)}: ${String(trades).padStart(4)} trades  WR ${trades ? (wins/trades*100).toFixed(1) : 'n/a'}%`)
}
