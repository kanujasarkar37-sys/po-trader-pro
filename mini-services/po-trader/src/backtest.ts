// ─── Backtester ──────────────────────────────────────────────────────────────
// Replays historical candles through the signal engine and simulates binary
// trades with the configured payout. Reports win-rate, profit curve, drawdown,
// streaks — used to validate strategy accuracy per asset.

import type { Candle } from './types'
import { analyze } from './signal-engine'

export interface BacktestTrade {
  index: number
  asset: string
  direction: 'call' | 'put'
  confidence: number
  openPrice: number
  closePrice: number
  result: 'win' | 'loss' | 'draw'
  profit: number
  time: number
}

export interface BacktestResult {
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
  bestConfidenceBin: { range: string; trades: number; winRate: number } | null
  confidenceBins: { range: string; trades: number; wins: number; winRate: number }[]
  tradeList: BacktestTrade[]
}

export function backtest(
  candles: Candle[],
  asset: string,
  payout: number,
  opts: { minConfidence: number; expirySeconds: number; warmup?: number; useHtf?: boolean }
): BacktestResult {
  const warmup = opts.warmup ?? 120
  const trades: BacktestTrade[] = []
  let equity = 0
  const curve: number[] = []
  let peak = 0
  let maxDD = 0
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0
  const amount = 1

  // iterate over closed candles; entry at candle i+1 open, settle at candle i+1 close
  for (let i = warmup; i < candles.length - 1; i++) {
    const window = candles.slice(0, i + 1)
    const { signal } = analyze(window, asset, payout, {
      minConfidence: opts.minConfidence,
      expirySeconds: opts.expirySeconds,
      useHtf: opts.useHtf,
    })
    if (!signal) continue
    const entryCandle = candles[i + 1]
    const openPrice = entryCandle.open
    const closePrice = entryCandle.close
    let result: 'win' | 'loss' | 'draw'
    if (closePrice === openPrice) result = 'draw'
    else if (signal.direction === 'call') result = closePrice > openPrice ? 'win' : 'loss'
    else result = closePrice < openPrice ? 'win' : 'loss'
    const profit = result === 'win' ? amount * payout / 100 : result === 'loss' ? -amount : 0
    equity += profit
    curve.push(equity)
    peak = Math.max(peak, equity)
    maxDD = Math.max(maxDD, peak - equity)
    if (result === 'win') { winStreak++; lossStreak = 0; maxWin = Math.max(maxWin, winStreak) }
    if (result === 'loss') { lossStreak++; winStreak = 0; maxLoss = Math.max(maxLoss, lossStreak) }
    trades.push({
      index: i + 1,
      asset,
      direction: signal.direction,
      confidence: signal.confidence,
      openPrice,
      closePrice,
      result,
      profit,
      time: entryCandle.time,
    })
  }

  const wins = trades.filter(t => t.result === 'win').length
  const losses = trades.filter(t => t.result === 'loss').length
  const draws = trades.filter(t => t.result === 'draw').length
  const decided = wins + losses
  const winRate = decided > 0 ? (wins / decided) * 100 : 0

  // confidence bins for accuracy analysis
  const bins = [
    { range: '70-74', lo: 70, hi: 74 }, { range: '75-79', lo: 75, hi: 79 },
    { range: '80-84', lo: 80, hi: 84 }, { range: '85-89', lo: 85, hi: 89 },
    { range: '90+', lo: 90, hi: 100 },
  ].map(b => {
    const t = trades.filter(x => x.confidence >= b.lo && x.confidence <= b.hi && x.result !== 'draw')
    const w = t.filter(x => x.result === 'win').length
    return { range: b.range, trades: t.length, wins: w, winRate: t.length ? Math.round((w / t.length) * 1000) / 10 : 0 }
  })

  const bestBin = bins.filter(b => b.trades >= 5).sort((a, b) => b.winRate - a.winRate)[0] || null

  return {
    asset,
    candles: candles.length,
    trades: trades.length,
    wins, losses, draws,
    winRate: Math.round(winRate * 10) / 10,
    totalProfit: Math.round(equity * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    profitCurve: curve,
    confidenceBins: bins,
    bestConfidenceBin: bestBin ? { range: bestBin.range, trades: bestBin.trades, winRate: Math.round(bestBin.winRate * 10) / 10 } : null,
    tradeList: trades.slice(-120),
  }
}
