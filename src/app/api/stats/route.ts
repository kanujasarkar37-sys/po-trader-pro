import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: { in: ['win', 'loss', 'draw'] } },
      orderBy: { openTime: 'desc' },
      take: 1000,
    })
    const wins = trades.filter(t => t.status === 'win').length
    const losses = trades.filter(t => t.status === 'loss').length
    const draws = trades.filter(t => t.status === 'draw').length
    const profit = Math.round(trades.reduce((a, t) => a + t.profit, 0) * 100) / 100

    // per-asset breakdown
    const byAsset = new Map<string, { asset: string; trades: number; wins: number; winRate: number; profit: number }>()
    for (const t of trades) {
      const cur = byAsset.get(t.asset) ?? { asset: t.asset, trades: 0, wins: 0, winRate: 0, profit: 0 }
      cur.trades++
      if (t.status === 'win') cur.wins++
      cur.profit = Math.round((cur.profit + t.profit) * 100) / 100
      byAsset.set(t.asset, cur)
    }
    for (const v of byAsset.values()) {
      v.winRate = v.trades > 0 ? Math.round((v.wins / v.trades) * 1000) / 10 : 0
    }

    // last 100 trade profits as sparkline
    const recent = trades.slice(0, 100).reverse()
    let cum = 0
    const curve = recent.map(t => (cum = Math.round((cum + t.profit) * 100) / 100))

    // ─── analytics: hour-of-day buckets (0-23) ───
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, trades: 0, wins: 0, losses: 0, profit: 0 }))
    for (const t of trades) {
      const h = new Date(t.openTime).getHours()
      hourly[h].trades++
      if (t.status === 'win') hourly[h].wins++
      if (t.status === 'loss') hourly[h].losses++
      hourly[h].profit = Math.round((hourly[h].profit + t.profit) * 100) / 100
    }

    // ─── analytics: CALL vs PUT split ───
    const direction = { call: { trades: 0, wins: 0, profit: 0 }, put: { trades: 0, wins: 0, profit: 0 } }
    for (const t of trades) {
      const d = t.direction === 'call' ? 'call' : 'put'
      direction[d].trades++
      if (t.status === 'win') direction[d].wins++
      direction[d].profit = Math.round((direction[d].profit + t.profit) * 100) / 100
    }

    // ─── analytics: bot vs manual split ───
    const source = { bot: { trades: 0, wins: 0, profit: 0 }, manual: { trades: 0, wins: 0, profit: 0 } }
    for (const t of trades) {
      const s = t.source === 'bot' ? 'bot' : 'manual'
      source[s].trades++
      if (t.status === 'win') source[s].wins++
      source[s].profit = Math.round((source[s].profit + t.profit) * 100) / 100
    }

    // ─── analytics: streaks (on chronological order) ───
    const chrono = [...trades].reverse()
    let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0
    for (const t of chrono) {
      if (t.status === 'win') { curWin++; curLoss = 0 }
      else if (t.status === 'loss') { curLoss++; curWin = 0 }
      else { curWin = 0; curLoss = 0 }
      maxWinStreak = Math.max(maxWinStreak, curWin)
      maxLossStreak = Math.max(maxLossStreak, curLoss)
    }

    // ─── analytics: avg confidence of wins vs losses ───
    const winConfs = trades.filter(t => t.status === 'win' && t.confidence > 0).map(t => t.confidence)
    const lossConfs = trades.filter(t => t.status === 'loss' && t.confidence > 0).map(t => t.confidence)
    const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null)

    // ─── analytics: today (since local midnight) ───
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const todays = trades.filter(t => t.openTime >= midnight.getTime())
    const tWins = todays.filter(t => t.status === 'win').length
    const tLosses = todays.filter(t => t.status === 'loss').length

    // ─── analytics: avg trade duration + volume ───
    const volume = Math.round(trades.reduce((a, t) => a + t.amount, 0) * 100) / 100

    // ─── analytics: last 14 calendar days P/L (incl. today) ───
    const daily14: { date: string; label: string; trades: number; wins: number; profit: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0)
      d0.setDate(d0.getDate() - i)
      const d1 = new Date(d0); d1.setDate(d1.getDate() + 1)
      const dayTrades = trades.filter(t => t.openTime >= d0.getTime() && t.openTime < d1.getTime())
      const dWins = dayTrades.filter(t => t.status === 'win').length
      daily14.push({
        date: d0.toISOString().slice(0, 10),
        label: d0.toLocaleDateString(undefined, { weekday: 'short' }),
        trades: dayTrades.length,
        wins: dWins,
        profit: Math.round(dayTrades.reduce((a, t) => a + t.profit, 0) * 100) / 100,
      })
    }

    // ─── analytics: confidence calibration (does 75% confidence win 75%?) ───
    // 5-point bins over observed confidence range; realized WR vs predicted
    const confTrades = trades.filter(t => t.confidence > 0 && (t.status === 'win' || t.status === 'loss'))
    const calBins: { label: string; lo: number; hi: number; trades: number; wins: number; wr: number }[] = []
    if (confTrades.length >= 4) {
      const minC = Math.floor(Math.min(...confTrades.map(t => t.confidence)) / 5) * 5
      const maxC = Math.ceil(Math.max(...confTrades.map(t => t.confidence)) / 5) * 5
      for (let lo = minC; lo < maxC; lo += 5) {
        const hi = lo + 5
        const bucket = confTrades.filter(t => t.confidence >= lo && t.confidence < hi)
        if (!bucket.length) continue
        const bWins = bucket.filter(t => t.status === 'win').length
        calBins.push({
          label: `${lo}–${hi}`, lo, hi,
          trades: bucket.length, wins: bWins,
          wr: Math.round((bWins / bucket.length) * 1000) / 10,
        })
      }
    }

    // ─── analytics: max drawdown on the full-history equity curve ───
    const chronoAll = [...trades].reverse()
    let cumAll = 0, peak = 0, maxDd = 0
    for (const t of chronoAll) {
      cumAll = Math.round((cumAll + t.profit) * 100) / 100
      if (cumAll > peak) peak = cumAll
      const dd = peak - cumAll
      if (dd > maxDd) maxDd = dd
    }
    maxDd = Math.round(maxDd * 100) / 100

    // ─── analytics: profit factor (gross win / gross loss) + ROI on volume ───
    const grossWin = trades.filter(t => t.profit > 0).reduce((a, t) => a + t.profit, 0)
    const grossLoss = Math.abs(trades.filter(t => t.profit < 0).reduce((a, t) => a + t.profit, 0))
    const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? Infinity : 0

    return NextResponse.json({
      totalTrades: trades.length, wins, losses, draws,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
      profit, byAsset: Array.from(byAsset.values()).sort((a, b) => b.trades - a.trades),
      curve,
      hourly, direction, source,
      streaks: { maxWinStreak, maxLossStreak },
      confidence: { wins: avg(winConfs), losses: avg(lossConfs) },
      today: {
        trades: todays.length, wins: tWins, losses: tLosses,
        winRate: tWins + tLosses > 0 ? Math.round((tWins / (tWins + tLosses)) * 1000) / 10 : 0,
        profit: Math.round(todays.reduce((a, t) => a + t.profit, 0) * 100) / 100,
      },
      volume,
      daily14,
      calibration: calBins,
      risk: { maxDrawdown: maxDd, profitFactor, roi: volume > 0 ? Math.round((profit / volume) * 10000) / 100 : 0 },
    })
  } catch {
    return NextResponse.json({
      totalTrades: 0, wins: 0, losses: 0, draws: 0, winRate: 0, profit: 0,
      byAsset: [], curve: [], hourly: [], direction: null, source: null,
      streaks: { maxWinStreak: 0, maxLossStreak: 0 }, confidence: { wins: null, losses: null },
      today: { trades: 0, wins: 0, losses: 0, winRate: 0, profit: 0 }, volume: 0,
      daily14: [], calibration: [], risk: { maxDrawdown: 0, profitFactor: 0, roi: 0 },
    })
  }
}
