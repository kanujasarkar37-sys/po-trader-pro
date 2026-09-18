'use client'

// ─── Canvas candlestick chart with EMA + Bollinger overlays ─────────────────
// v5: RSI(14) and activity (range) subpanels + crosshair with OHLC readout.

import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { useTrader, type Candle } from './store'
import { Activity, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'

function ema(values: number[], period: number): number[] {
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

function bollinger(closes: number[], period = 20, mult = 2) {
  const mid: number[] = [], upper: number[] = [], lower: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(NaN); upper.push(NaN); lower.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    const m = sum / period
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += Math.pow(closes[j] - m, 2)
    const sd = Math.sqrt(sq / period)
    mid.push(m); upper.push(m + mult * sd); lower.push(m - mult * sd)
  }
  return { mid, upper, lower }
}

function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN)
  if (closes.length <= period) return out
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d; else loss -= d
  }
  let avgG = gain / period, avgL = loss / period
  out[period] = 100 - 100 / (1 + avgG / (avgL || 1e-9))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgG = (avgG * (period - 1) + Math.max(0, d)) / period
    avgL = (avgL * (period - 1) + Math.max(0, -d)) / period
    out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9))
  }
  return out
}

const VIEW = 130 // visible candles
type Panel = 'none' | 'rsi' | 'act'

/** Aggregate M1 candles into N-minute candles (client-side timeframe switch). */
function aggregate(list: Candle[], factor: number): Candle[] {
  if (factor <= 1) return list
  const bucketSec = factor * 60
  const out: Candle[] = []
  let cur: Candle | null = null
  for (const c of list) {
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

export function CandleChart({ asset, timeframe = 1 }: { asset: string; timeframe?: 1 | 5 | 15 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { candles, forming, prices, signals, trades } = useTrader()
  const [panel, setPanel] = useState<Panel>('rsi')
  // layout memo for mouse ↔ candle index mapping (updated each draw)
  const layoutRef = useRef<{ plotW: number; cw: number; n: number } | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const data = useMemo(() => {
    const list = [...candles]
    if (forming && forming.time > (candles.length ? candles[candles.length - 1].time : 0)) {
      list.push(forming)
    }
    const agg = aggregate(list, timeframe)
    return agg.slice(-VIEW)
  }, [candles, forming, timeframe])

  // trades of this asset within the visible window (for the legend chip)
  const chartTradeCount = useMemo(() => {
    if (!data.length) return 0
    const t0 = data[0].time - timeframe * 60
    return trades.filter(t => t.asset === asset && t.openTime / 1000 >= t0).length
  }, [trades, asset, data, timeframe])

  const livePrice = prices[asset]

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const L = layoutRef.current
    if (!L || x > L.plotW) { setHoverIdx(null); return }
    const idx = Math.min(L.n - 1, Math.max(0, Math.floor(x / L.cw)))
    setHoverIdx(idx)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const dpr = window.devicePixelRatio || 1
    const W = parent.clientWidth
    const H = parent.clientHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const padRight = 64
    const padBottom = 22
    const padTop = 10
    const plotW = W - padRight
    // subpanel occupies the bottom slice of the plot area
    const subH = panel === 'none' ? 0 : Math.min(92, Math.max(64, (H - padBottom - padTop) * 0.28))
    const subGap = panel === 'none' ? 0 : 8
    const mainH = H - padBottom - padTop - subH - subGap
    if (data.length < 2 || plotW < 50 || mainH < 50) {
      ctx.fillStyle = '#71717a'
      ctx.font = '13px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for candle data…', W / 2, H / 2)
      return
    }

    const closes = data.map(c => c.close)
    const e9 = ema(closes, 9)
    const e21 = ema(closes, 21)
    const e50 = ema(closes, 50)
    const bb = bollinger(closes, 20, 2)
    const rsiV = panel === 'rsi' ? rsiSeries(closes, 14) : null

    // price range (main pane only)
    let lo = Infinity, hi = -Infinity
    for (const c of data) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high) }
    for (const v of [...bb.upper, ...bb.lower, e50[e50.length - 1]]) {
      if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    }
    if (livePrice != null && isFinite(livePrice)) { lo = Math.min(lo, livePrice); hi = Math.max(hi, livePrice) }
    const pad = (hi - lo) * 0.08 || hi * 0.0001
    lo -= pad; hi += pad
    const y = (p: number) => padTop + mainH - ((p - lo) / (hi - lo)) * mainH
    const cw = plotW / data.length
    const x = (i: number) => i * cw + cw / 2
    layoutRef.current = { plotW, cw, n: data.length }

    // grid + price axis
    ctx.strokeStyle = '#18181b'
    ctx.fillStyle = '#52525b'
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'left'
    const digits = countDigits(data[data.length - 1].close)
    const steps = 6
    for (let s = 0; s <= steps; s++) {
      const p = lo + ((hi - lo) * s) / steps
      const yy = Math.round(y(p)) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, yy)
      ctx.lineTo(plotW, yy)
      ctx.stroke()
      ctx.fillText(p.toFixed(digits), plotW + 6, yy + 3)
    }
    // time axis (every 15 candles)
    ctx.textAlign = 'center'
    for (let i = data.length - 1; i >= 0; i -= 15) {
      const d = new Date(data[i].time * 1000)
      const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      ctx.fillStyle = '#52525b'
      ctx.fillText(label, x(i), H - 8)
    }

    // Bollinger fill
    ctx.beginPath()
    let started = false
    for (let i = 0; i < data.length; i++) {
      if (!isFinite(bb.upper[i])) continue
      if (!started) { ctx.moveTo(x(i), y(bb.upper[i])); started = true }
      else ctx.lineTo(x(i), y(bb.upper[i]))
    }
    for (let i = data.length - 1; i >= 0; i--) {
      if (!isFinite(bb.lower[i])) continue
      ctx.lineTo(x(i), y(bb.lower[i]))
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(113,113,122,0.07)'
    ctx.fill()

    // candles
    const bucketSec = timeframe * 60
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      const up = c.close >= c.open
      const isForming = forming && Math.floor(forming.time / bucketSec) * bucketSec === c.time
      ctx.strokeStyle = up ? '#10b981' : '#ef4444'
      ctx.fillStyle = up ? (isForming ? 'rgba(16,185,129,0.5)' : '#10b981') : (isForming ? 'rgba(239,68,68,0.5)' : '#ef4444')
      // wick
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x(i), y(c.high))
      ctx.lineTo(x(i), y(c.low))
      ctx.stroke()
      // body
      const bw = Math.max(1.5, cw * 0.62)
      const by = y(Math.max(c.open, c.close))
      const bh = Math.max(1, Math.abs(y(c.open) - y(c.close)))
      ctx.fillRect(x(i) - bw / 2, by, bw, bh)
    }

    // EMA lines
    const drawLine = (vals: number[], color: string, width = 1.4, yFn: (p: number) => number = y) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      let started = false
      for (let i = 0; i < data.length; i++) {
        if (!isFinite(vals[i])) continue
        if (!started) { ctx.moveTo(x(i), yFn(vals[i])); started = true }
        else ctx.lineTo(x(i), yFn(vals[i]))
      }
      ctx.stroke()
    }
    drawLine(e9, '#f59e0b')
    drawLine(e21, '#f43f5e')
    drawLine(e50, '#a3a3a3', 1.2)

    // signal markers (last 30 min for this asset)
    for (const sig of signals) {
      if (sig.asset !== asset) continue
      const sigTs = timeframe > 1 ? Math.floor(sig.entryAt / 1000 / bucketSec) * bucketSec : Math.floor(sig.entryAt / 1000)
      const idx = data.findIndex(c => c.time === sigTs || c.time === Math.floor(sig.createdAt / 1000 / bucketSec) * bucketSec)
      if (idx < 0) continue
      const isCall = sig.direction === 'call'
      ctx.fillStyle = isCall ? '#10b981' : '#ef4444'
      ctx.beginPath()
      const yy = isCall ? y(data[idx].low) + 14 : y(data[idx].high) - 14
      const size = 5
      ctx.moveTo(x(idx), yy + (isCall ? -size : size))
      ctx.lineTo(x(idx) - size, yy + (isCall ? size : -size) * 1.4)
      ctx.lineTo(x(idx) + size, yy + (isCall ? size : -size) * 1.4)
      ctx.closePath()
      ctx.fill()
    }

    // open trade entry lines
    for (const t of trades) {
      if (t.asset !== asset || t.status !== 'open') continue
      const idx = data.findIndex(c => c.time === Math.floor(t.openTime / 1000 / 60 / timeframe) * 60 * timeframe)
      if (idx < 0) continue
      ctx.strokeStyle = t.direction === 'call' ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x(idx), y(t.openPrice))
      ctx.lineTo(plotW, y(t.openPrice))
      ctx.stroke()
      ctx.setLineDash([])
      // open trade dot at entry
      ctx.fillStyle = t.direction === 'call' ? '#10b981' : '#ef4444'
      ctx.beginPath()
      ctx.arc(x(idx), y(t.openPrice), 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // settled trade outcome markers (entry dot + entry→close connector + W/L badge)
    const t0 = data[0].time
    const visibleTrades = trades
      .filter(t => t.asset === asset && t.status !== 'open' && t.openTime / 1000 >= t0 - bucketSec)
      .slice(-24)
    for (const t of visibleTrades) {
      const openTs = Math.floor(t.openTime / 1000 / bucketSec) * bucketSec
      const idx = data.findIndex(c => c.time === openTs)
      if (idx < 0) continue
      const isWin = t.status === 'win'
      const isDraw = t.status === 'draw'
      const col = isDraw ? '#a1a1aa' : isWin ? '#10b981' : '#ef4444'
      // entry→close connector if both candles visible
      const closeTs = t.closeTime ? Math.floor(t.closeTime / 1000 / bucketSec) * bucketSec : -1
      const cIdx = closeTs >= 0 ? data.findIndex(c => c.time === closeTs) : -1
      if (cIdx >= 0 && t.closePrice != null) {
        ctx.strokeStyle = isWin ? 'rgba(16,185,129,0.55)' : isDraw ? 'rgba(161,161,170,0.5)' : 'rgba(239,68,68,0.55)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x(idx), y(t.openPrice))
        ctx.lineTo(x(cIdx), y(t.closePrice))
        ctx.stroke()
      }
      // entry marker (diamond by direction)
      const yy = y(t.openPrice)
      const dR = 4
      ctx.fillStyle = t.direction === 'call' ? '#34d399' : '#f87171'
      ctx.beginPath()
      ctx.moveTo(x(idx), yy - dR)
      ctx.lineTo(x(idx) + dR, yy)
      ctx.lineTo(x(idx), yy + dR)
      ctx.lineTo(x(idx) - dR, yy)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1
      ctx.stroke()
      // W/L badge at connector end (or above entry if close off-view)
      const bx = cIdx >= 0 ? x(cIdx) : Math.min(x(idx) + 14, plotW - 12)
      const byy = cIdx >= 0 && t.closePrice != null ? y(t.closePrice) : yy - 12
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.roundRect(bx - 5.5, byy - 7, 11, 13, 3)
      ctx.fill()
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#09090b'
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(isDraw ? 'D' : isWin ? 'W' : 'L', bx, byy + 3)
    }

    // live price line + label
    const lastC = data[data.length - 1].close
    const p = livePrice != null && isFinite(livePrice) ? livePrice : lastC
    ctx.strokeStyle = '#e4e4e7'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y(p))
    ctx.lineTo(plotW, y(p))
    ctx.stroke()
    ctx.setLineDash([])
    const upP = p >= (data.length > 1 ? data[data.length - 2].close : p)
    ctx.fillStyle = upP ? '#10b981' : '#ef4444'
    ctx.fillRect(plotW + 2, y(p) - 8, padRight - 4, 16)
    ctx.fillStyle = '#09090b'
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(p.toFixed(digits), plotW + padRight / 2, y(p) + 3)

    // ─── Subpanels ─────────────────────────────────────────────────────────
    const subTop = padTop + mainH + subGap
    if (panel !== 'none' && subH > 0) {
      // separator
      ctx.strokeStyle = '#27272a'
      ctx.beginPath()
      ctx.moveTo(0, Math.round(subTop - subGap / 2) + 0.5)
      ctx.lineTo(plotW, Math.round(subTop - subGap / 2) + 0.5)
      ctx.stroke()

      if (panel === 'rsi' && rsiV) {
        const yr = (v: number) => subTop + subH - (v / 100) * subH
        // 30/70 zone shading
        ctx.fillStyle = 'rgba(113,113,122,0.06)'
        ctx.fillRect(0, yr(70), plotW, yr(30) - yr(70))
        // 30/50/70 guides
        ctx.strokeStyle = '#27272a'
        ctx.setLineDash([3, 4])
        for (const lvl of [30, 50, 70]) {
          ctx.beginPath()
          ctx.moveTo(0, Math.round(yr(lvl)) + 0.5)
          ctx.lineTo(plotW, Math.round(yr(lvl)) + 0.5)
          ctx.stroke()
        }
        ctx.setLineDash([])
        // RSI line with gradient fill
        ctx.beginPath()
        let st2 = false
        for (let i = 0; i < data.length; i++) {
          if (!isFinite(rsiV[i])) continue
          if (!st2) { ctx.moveTo(x(i), yr(rsiV[i])); st2 = true } else ctx.lineTo(x(i), yr(rsiV[i]))
        }
        ctx.strokeStyle = '#c084fc'
        ctx.lineWidth = 1.3
        ctx.stroke()
        // current value chip
        const lastR = rsiV[data.length - 1]
        if (isFinite(lastR)) {
          ctx.fillStyle = lastR > 70 ? '#ef4444' : lastR < 30 ? '#10b981' : '#c084fc'
          ctx.fillRect(plotW + 2, yr(lastR) - 7, padRight - 4, 14)
          ctx.fillStyle = '#09090b'
          ctx.font = 'bold 10px ui-monospace, monospace'
          ctx.textAlign = 'center'
          ctx.fillText(lastR.toFixed(0), plotW + padRight / 2, yr(lastR) + 3)
        }
        // labels
        ctx.fillStyle = '#52525b'
        ctx.font = '9px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillText('70', plotW + 6, yr(70) + 3)
        ctx.fillText('30', plotW + 6, yr(30) + 3)
        ctx.fillStyle = '#71717a'
        ctx.font = 'bold 9px system-ui'
        ctx.fillText('RSI 14', 6, subTop + 11)
      }

      if (panel === 'act') {
        // activity = candle range proxy (PO has no volume feed)
        const ranges = data.map(c => c.high - c.low)
        const maxR = Math.max(...ranges, 1e-9)
        const ya = (v: number) => subTop + subH - (v / maxR) * subH * 0.92
        // average line
        const avgR = ranges.reduce((a, b) => a + b, 0) / ranges.length
        ctx.strokeStyle = '#3f3f46'
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(ya(avgR)) + 0.5)
        ctx.lineTo(plotW, Math.round(ya(avgR)) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        // bars
        for (let i = 0; i < data.length; i++) {
          const up = data[i].close >= data[i].open
          ctx.fillStyle = up ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.55)'
          const bw = Math.max(1.5, cw * 0.62)
          const h = Math.max(1, subTop + subH - ya(ranges[i]))
          ctx.fillRect(x(i) - bw / 2, ya(ranges[i]), bw, h)
        }
        ctx.fillStyle = '#71717a'
        ctx.font = 'bold 9px system-ui'
        ctx.textAlign = 'left'
        ctx.fillText('ACTIVITY (range)', 6, subTop + 11)
        // current chip
        ctx.fillStyle = '#a1a1aa'
        ctx.fillRect(plotW + 2, subTop + subH / 2 - 7, padRight - 4, 14)
        ctx.fillStyle = '#09090b'
        ctx.font = 'bold 9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(fmtCompact(ranges[ranges.length - 1]), plotW + padRight / 2, subTop + subH / 2 + 3)
      }
    }

    // ─── Crosshair + OHLC readout ─────────────────────────────────────────
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < data.length) {
      const hc = data[hoverIdx]
      ctx.strokeStyle = 'rgba(161,161,170,0.35)'
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(x(hoverIdx)) + 0.5, padTop)
      ctx.lineTo(Math.round(x(hoverIdx)) + 0.5, H - padBottom)
      ctx.stroke()
      ctx.setLineDash([])
      // hover candle time tag
      const d = new Date(hc.time * 1000)
      const tLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      ctx.font = 'bold 9px ui-monospace, monospace'
      const tw = ctx.measureText(tLabel).width + 8
      ctx.fillStyle = '#27272a'
      ctx.fillRect(Math.min(plotW - tw, Math.max(0, x(hoverIdx) - tw / 2)), H - padBottom + 2, tw, 13)
      ctx.fillStyle = '#d4d4d8'
      ctx.textAlign = 'center'
      ctx.fillText(tLabel, Math.min(plotW - tw / 2, Math.max(tw / 2, x(hoverIdx))), H - padBottom + 12)
      // OHLC box (top-right of main pane)
      const up = hc.close >= hc.open
      const lines = [
        `O ${hc.open.toFixed(digits)}`,
        `H ${hc.high.toFixed(digits)}`,
        `L ${hc.low.toFixed(digits)}`,
        `C ${hc.close.toFixed(digits)}`,
      ]
      ctx.font = 'bold 10px ui-monospace, monospace'
      const bw2 = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12
      const bh2 = lines.length * 13 + 8
      const bx = plotW - bw2 - 8
      const by2 = padTop + 4
      ctx.fillStyle = 'rgba(9,9,11,0.88)'
      ctx.strokeStyle = '#3f3f46'
      ctx.beginPath()
      ctx.roundRect(bx, by2, bw2, bh2, 4)
      ctx.fill()
      ctx.stroke()
      ctx.textAlign = 'left'
      lines.forEach((l, li) => {
        ctx.fillStyle = li === 3 ? (up ? '#10b981' : '#ef4444') : '#d4d4d8'
        ctx.fillText(l, bx + 6, by2 + 14 + li * 13)
      })
    }
  }, [data, livePrice, asset, signals, trades, timeframe, panel, hoverIdx])

  return (
    <div className="relative h-[340px] w-full sm:h-[400px]">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-crosshair"
        aria-label={`${asset} candlestick chart`}
        role="img"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      />
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-2 pr-24 text-[10px] font-medium">
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-amber-500" />EMA 9</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-rose-500" />EMA 21</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-neutral-400" />EMA 50</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-zinc-500" />Bollinger 20/2</span>
        {panel === 'rsi' && <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-purple-400" />RSI 14</span>}
        {timeframe > 1 && (
          <span className="rounded bg-emerald-950/70 px-1.5 font-bold text-emerald-400">M{timeframe} view · engine trades M1</span>
        )}
        {chartTradeCount > 0 && (
          <span className="rounded bg-zinc-800/80 px-1.5 font-bold text-zinc-300" title="Entry ◆ + W/L badges drawn on-chart for this asset">
            ◆ {chartTradeCount} trade{chartTradeCount > 1 ? 's' : ''} on view
          </span>
        )}
      </div>
      {/* subpanel toggle */}
      <div className="absolute right-2 top-2 flex overflow-hidden rounded-md border border-zinc-700/80 bg-zinc-950/80" role="group" aria-label="Chart subpanel">
        {([
          { key: 'rsi', icon: Gauge, label: 'RSI' },
          { key: 'act', icon: Activity, label: 'ACT' },
        ] as const).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setPanel(p => (p === key ? 'none' : key))}
            aria-pressed={panel === key}
            title={`${label} subpanel — click to toggle`}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold transition-colors',
              panel === key
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function countDigits(price: number): number {
  if (price >= 1000) return 1
  if (price >= 100) return 2
  if (price >= 10) return 3
  if (price >= 1) return 4
  return 5
}

function fmtCompact(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(4)
  return v.toExponential(1)
}
