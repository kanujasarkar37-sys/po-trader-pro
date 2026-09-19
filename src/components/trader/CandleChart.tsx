'use client'

// ─── Canvas candlestick chart — v6: full zoom / pan / crosshair ────────────
//
// Interactions
//  • Zoom: mouse wheel (cursor-anchored), trackpad pinch (ctrl+wheel),
//    two-finger pinch on touch, toolbar +/− buttons · range 15–500 bars
//  • Pan: click-drag / touch-drag horizontally through up to ~2000 buffered
//    candles; auto-follows the live candle while pinned to the right edge;
//    "● LIVE" pill + double-click jump back to the live edge
//  • Crosshair with OHLC readout + axis price/time chips
//  • Keyboard: ←/→ pan · +/− zoom · Home oldest · End live · 0 reset zoom
//
// Rendering: a single canvas, devicePixelRatio-scaled, rAF-throttled.
// Interactions mutate refs and schedule a frame — React re-renders only on
// store data changes. A tiny rAF loop runs ONLY while open trades need their
// pulsing marker. Indicators are computed once per data change over the full
// series (stable while panning), drawing slices the visible window.
//
// Overlays: EMA 9/21/50, Bollinger 20/2, pseudo-volume, RSI(14) + activity
// subpanels, signal entries and trade markers (open pulse / settled W-L-D).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTrader, type Candle, type Signal, type TradeRecord } from './store'
import { Activity, Gauge, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══ indicator math ══════════════════════════════════════════════════════ */

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

/* ══ small helpers ════════════════════════════════════════════════════════ */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

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

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Round a raw grid step to 1 / 2 / 2.5 / 5 × 10^n. */
function niceNum(x: number): number {
  if (!(x > 0) || !isFinite(x)) return 1
  const e = Math.floor(Math.log10(x))
  const m = x / Math.pow(10, e)
  const nm = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  return nm * Math.pow(10, e)
}

/** Round a raw candle-count to a "nice" number of bars per time label. */
function niceStepBars(raw: number): number {
  for (const s of [1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 240, 480]) if (s >= raw) return s
  return Math.ceil(raw / 480) * 480
}

/* ══ layout constants + palette (dark trading terminal) ═══════════════════ */

const PAD_RIGHT = 64    // price axis
const PAD_BOTTOM = 22   // time axis
const PAD_TOP = 10
const MIN_BARS = 15     // max zoom-in
const MAX_BARS = 500    // max zoom-out
const INIT_BARS = 130
const EDGE_PAD = 3      // bars of blank space past the live / oldest edge

const COL = {
  up: '#34d399', down: '#f87171',
  upSoft: 'rgba(52,211,153,0.55)', downSoft: 'rgba(248,113,113,0.55)',
  volUp: 'rgba(52,211,153,0.32)', volDown: 'rgba(248,113,113,0.32)',
  grid: 'rgba(255,255,255,0.04)',
  frame: 'rgba(255,255,255,0.06)',
  axis: '#71717a',
  e9: '#38bdf8', e21: '#fbbf24', e50: '#a78bfa',
  bbFill: 'rgba(167,139,250,0.06)',
  rsi: '#c084fc',
  cross: 'rgba(161,161,170,0.55)',
  chip: '#3f3f46', // zinc-700
}

type Panel = 'none' | 'rsi' | 'act'
interface ViewState { right: number; count: number } // right = float candle index at plot's right edge
interface DragState { startX: number; startRight: number; moved: boolean }
interface PinchState { d0: number; count0: number }
interface Series {
  e9: number[]; e21: number[]; e50: number[]
  bbU: number[]; bbL: number[]
  rsi: number[]; vol: number[]
}
interface Latest {
  data: Candle[]
  series: Series
  hasForming: boolean
  livePrice: number | undefined
  trades: TradeRecord[]
  signals: Signal[]
  panel: Panel
  asset: string
  timeframe: number
}

// client components are still server-prerendered — avoid the SSR layout-effect warning
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/* ══ component ════════════════════════════════════════════════════════════ */

export function CandleChart({ asset, timeframe = 1 }: { asset: string; timeframe?: 1 | 5 | 15 }) {
  // fine-grained store selectors → re-render only when these slices change
  const candles = useTrader(s => s.candles)
  const forming = useTrader(s => s.forming)
  const trades = useTrader(s => s.trades)
  const signals = useTrader(s => s.signals)
  const livePrice = useTrader(s => s.prices[asset])

  const [panel, setPanel] = useState<Panel>('rsi')
  const [atLive, setAtLive] = useState(true)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsLabelRef = useRef<HTMLSpanElement>(null)
  const viewRef = useRef<ViewState>({ right: INIT_BARS - 1 + EDGE_PAD, count: INIT_BARS })
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const layoutRef = useRef<{ plotW: number; cw: number }>({ plotW: 0, cw: 8 })
  const latestRef = useRef<Latest | null>(null)
  const rafRef = useRef<number | null>(null)
  const atLiveRef = useRef(true)
  const idxMapRef = useRef<{ src: Candle[] | null; map: Map<number, number> }>({ src: null, map: new Map() })

  /* ── data: full aggregated series (pannable), indicators over ALL of it ── */
  const data = useMemo(() => {
    let list = candles
    if (forming && forming.time > (candles.length ? candles[candles.length - 1].time : 0)) {
      list = candles.length ? [...candles, forming] : [forming]
    }
    return aggregate(list, timeframe)
  }, [candles, forming, timeframe])

  const series = useMemo(() => {
    const closes = data.map(c => c.close)
    const bb = bollinger(closes, 20, 2)
    return {
      e9: ema(closes, 9),
      e21: ema(closes, 21),
      e50: ema(closes, 50),
      bbU: bb.upper,
      bbL: bb.lower,
      rsi: rsiSeries(closes, 14),
      vol: data.map(c => Math.max(0, c.high - c.low)), // pseudo-volume (no feed)
    } satisfies Series
  }, [data])

  const openCount = useMemo(
    () => trades.filter(t => t.asset === asset && t.status === 'open').length,
    [trades, asset],
  )

  // trades of this asset inside the loaded history (legend chip)
  const tradeChip = useMemo(() => {
    if (!data.length) return 0
    const bucketSec = timeframe * 60
    const t0 = Math.floor(data[0].time / bucketSec) * bucketSec
    return trades.filter(t => t.asset === asset && Math.floor(t.openTime / 1000 / bucketSec) * bucketSec >= t0).length
  }, [trades, asset, data, timeframe])

  /* ── view clamping + live-edge tracking ──────────────────────────────── */
  const clampViewTo = useCallback((n: number) => {
    const v = viewRef.current
    v.count = clamp(v.count, MIN_BARS, MAX_BARS)
    const maxRight = n - 1 + EDGE_PAD
    const minRight = Math.min(maxRight, v.count - EDGE_PAD)
    v.right = clamp(v.right, minRight, maxRight)
    const live = v.right >= maxRight - 0.02
    if (live !== atLiveRef.current) {
      atLiveRef.current = live
      setAtLive(live)
    }
  }, [])

  /* ── the big draw (reads refs only → stable identity) ─────────────────── */
  const draw = useCallback(() => {
    rafRef.current = null
    const st = latestRef.current
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!st || !canvas || !wrap) return
    const W = wrap.clientWidth
    const H = wrap.clientHeight
    if (W < 60 || H < 80) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(W * dpr)
    const ph = Math.round(H * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    if (canvas.style.width !== `${W}px`) canvas.style.width = `${W}px`
    if (canvas.style.height !== `${H}px`) canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const { data, series, hasForming, livePrice, trades, signals, panel, asset, timeframe } = st
    const n = data.length
    const plotW = W - PAD_RIGHT
    const subH = panel === 'none' ? 0 : Math.min(92, Math.max(56, (H - PAD_BOTTOM - PAD_TOP) * 0.26))
    const subGap = panel === 'none' ? 0 : 8
    const mainTop = PAD_TOP
    const mainH = H - PAD_BOTTOM - PAD_TOP - subH - subGap
    const subTop = mainTop + mainH + subGap
    const subBot = subTop + subH

    const view = viewRef.current
    layoutRef.current = { plotW, cw: plotW / view.count }
    if (barsLabelRef.current) barsLabelRef.current.textContent = String(Math.round(view.count))

    if (n < 2 || plotW < 80 || mainH < 50) {
      ctx.fillStyle = COL.axis
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Waiting for candle data…', W / 2, H / 2)
      return
    }

    /* view mapping */
    const cw = plotW / view.count
    const iLeft = view.right - view.count
    const xOf = (i: number) => (i - iLeft + 0.5) * cw
    const i0 = Math.max(0, Math.floor(iLeft))
    const i1 = Math.min(n - 1, Math.ceil(view.right))

    /* price range over the visible window (candles + BB + EMA50 + live + opens) */
    let lo = Infinity, hi = -Infinity
    for (let i = i0; i <= i1; i++) {
      const c = data[i]
      if (c.low < lo) lo = c.low
      if (c.high > hi) hi = c.high
      const u = series.bbU[i], l = series.bbL[i], e = series.e50[i]
      if (isFinite(u) && u > hi) hi = u
      if (isFinite(l) && l < lo) lo = l
      if (isFinite(e)) { if (e > hi) hi = e; if (e < lo) lo = e }
    }
    if (livePrice != null && isFinite(livePrice)) {
      if (livePrice < lo) lo = livePrice
      if (livePrice > hi) hi = livePrice
    }
    for (const t of trades) {
      if (t.asset !== asset || t.status !== 'open') continue
      if (t.openPrice < lo) lo = t.openPrice
      if (t.openPrice > hi) hi = t.openPrice
    }
    let span = hi - lo
    if (!(span > 0)) span = Math.abs(hi) * 0.002 || 0.001
    lo -= span * 0.06
    hi += span * 0.06
    lo -= (hi - lo) * 0.1 // room for volume bars
    const yOf = (p: number) => mainTop + mainH - ((p - lo) / (hi - lo)) * mainH
    const digits = countDigits(data[n - 1].close)

    /* axis frame */
    ctx.lineWidth = 1
    ctx.strokeStyle = COL.frame
    ctx.beginPath(); ctx.moveTo(plotW + 0.5, mainTop); ctx.lineTo(plotW + 0.5, subBot); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, H - PAD_BOTTOM + 0.5); ctx.lineTo(W, H - PAD_BOTTOM + 0.5); ctx.stroke()

    /* horizontal grid + price labels */
    const targetLines = clamp(Math.floor(mainH / 44), 3, 7)
    const stepP = niceNum((hi - lo) / targetLines)
    ctx.font = `9px ${MONO}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (let p = Math.ceil(lo / stepP) * stepP; p <= hi; p += stepP) {
      const yy = Math.round(yOf(p)) + 0.5
      if (yy < mainTop || yy > mainTop + mainH) continue
      ctx.strokeStyle = COL.grid
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke()
      ctx.fillStyle = COL.axis
      ctx.fillText(p.toFixed(digits), plotW + 6, yy)
    }

    /* vertical grid + HH:MM labels on aligned clock times */
    const maxLabels = Math.max(2, Math.floor(plotW / 62))
    const stepBars = niceStepBars(Math.ceil(view.count / maxLabels))
    const labelSec = stepBars * timeframe * 60
    ctx.textAlign = 'center'
    for (let i = i0; i <= i1; i++) {
      if (data[i].time % labelSec !== 0) continue
      const xx = Math.round(xOf(i)) + 0.5
      if (xx < 16 || xx > plotW - 16) continue
      ctx.strokeStyle = COL.grid
      ctx.beginPath(); ctx.moveTo(xx, mainTop); ctx.lineTo(xx, subBot); ctx.stroke()
      ctx.fillStyle = COL.axis
      ctx.fillText(fmtTime(data[i].time), xx, H - PAD_BOTTOM / 2)
    }

    /* left-edge hint */
    if (iLeft <= -EDGE_PAD + 0.02) {
      ctx.fillStyle = '#52525b'
      ctx.font = `bold 9px ${MONO}`
      ctx.textAlign = 'center'
      ctx.fillText('◂ start of history', plotW / 2, mainTop + mainH - 10)
    }

    /* pseudo-volume bars (range × direction colour) */
    let maxVol = 0
    for (let i = i0; i <= i1; i++) if (series.vol[i] > maxVol) maxVol = series.vol[i]
    const volY = (v: number) => mainTop + mainH - (maxVol > 0 ? (v / maxVol) * mainH * 0.16 : 0)
    const barW = Math.max(1, cw * 0.7)
    for (let i = i0; i <= i1; i++) {
      const c = data[i]
      ctx.fillStyle = c.close >= c.open ? COL.volUp : COL.volDown
      const yy = volY(series.vol[i])
      ctx.fillRect(xOf(i) - barW / 2, yy, barW, mainTop + mainH - yy)
    }

    /* Bollinger fill */
    ctx.beginPath()
    let bbStarted = false
    for (let i = i0; i <= i1; i++) {
      if (!isFinite(series.bbU[i])) continue
      const xx = xOf(i), yy = yOf(series.bbU[i])
      if (!bbStarted) { ctx.moveTo(xx, yy); bbStarted = true } else ctx.lineTo(xx, yy)
    }
    for (let i = i1; i >= i0; i--) {
      if (!isFinite(series.bbL[i])) continue
      ctx.lineTo(xOf(i), yOf(series.bbL[i]))
    }
    ctx.closePath()
    ctx.fillStyle = COL.bbFill
    ctx.fill()

    /* candles (forming = translucent live candle) */
    for (let i = i0; i <= i1; i++) {
      const c = data[i]
      const up = c.close >= c.open
      const live = i === n - 1 && hasForming
      const xx = xOf(i)
      ctx.strokeStyle = up ? COL.up : COL.down
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(xx) + 0.5, yOf(c.high))
      ctx.lineTo(Math.round(xx) + 0.5, yOf(c.low))
      ctx.stroke()
      ctx.fillStyle = up ? (live ? COL.upSoft : COL.up) : (live ? COL.downSoft : COL.down)
      const yTop = yOf(Math.max(c.open, c.close))
      const hgt = Math.max(1, Math.abs(yOf(c.open) - yOf(c.close)))
      ctx.fillRect(xx - barW / 2, yTop, barW, hgt)
    }

    /* EMA overlays */
    const drawLine = (vals: number[], color: string, width: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      let started = false
      for (let i = i0; i <= i1; i++) {
        const v = vals[i]
        if (!isFinite(v)) continue
        const xx = xOf(i), yy = yOf(v)
        if (!started) { ctx.moveTo(xx, yy); started = true } else ctx.lineTo(xx, yy)
      }
      ctx.stroke()
    }
    drawLine(series.e50, COL.e50, 1.2)
    drawLine(series.e21, COL.e21, 1.4)
    drawLine(series.e9, COL.e9, 1.4)

    /* live price line + chip */
    const lp = livePrice != null && isFinite(livePrice) ? livePrice : data[n - 1].close
    const lpY = yOf(lp)
    if (lpY >= mainTop && lpY <= mainTop + mainH) {
      ctx.strokeStyle = COL.up
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, Math.round(lpY) + 0.5)
      ctx.lineTo(plotW, Math.round(lpY) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#059669'
      ctx.beginPath()
      ctx.roundRect(plotW + 2, lpY - 8, PAD_RIGHT - 5, 16, 3)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold 10px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lp.toFixed(digits), plotW + 2 + (PAD_RIGHT - 5) / 2, lpY + 0.5)
    }

    /* ── time → candle index lookup ── */
    const bucketSec = timeframe * 60
    if (idxMapRef.current.src !== data) {
      const m = new Map<number, number>()
      for (let i = 0; i < n; i++) m.set(data[i].time, i)
      idxMapRef.current = { src: data, map: m }
    }
    const timeIdx = (ms: number) => idxMapRef.current.map.get(Math.floor(ms / 1000 / bucketSec) * bucketSec)

    /* signal entry markers (subtle direction triangles) */
    for (const sig of signals) {
      if (sig.asset !== asset) continue
      const si = timeIdx(sig.entryAt)
      if (si == null || si < i0 || si > i1) continue
      const isCall = sig.direction === 'call'
      const c = data[si]
      ctx.fillStyle = isCall ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)'
      ctx.beginPath()
      if (isCall) {
        const yb = yOf(c.low) + 4
        ctx.moveTo(xOf(si), yb)
        ctx.lineTo(xOf(si) - 3.5, yb + 6)
        ctx.lineTo(xOf(si) + 3.5, yb + 6)
      } else {
        const yt = yOf(c.high) - 4
        ctx.moveTo(xOf(si), yt)
        ctx.lineTo(xOf(si) - 3.5, yt - 6)
        ctx.lineTo(xOf(si) + 3.5, yt - 6)
      }
      ctx.closePath()
      ctx.fill()
    }

    /* ── trade markers ── */
    const now = performance.now()
    const settled: { t: TradeRecord; ti: number }[] = []
    for (const t of trades) {
      if (t.asset !== asset) continue
      const ti = timeIdx(t.openTime)
      if (ti == null) continue
      const visible = ti >= i0 && ti <= i1
      if (t.status === 'open') {
        /* open: dashed entry-price line + pulsing dot */
        const yO = yOf(t.openPrice)
        const col = t.direction === 'call' ? COL.up : COL.down
        ctx.strokeStyle = t.direction === 'call' ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)'
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(visible ? xOf(ti) : 0, Math.round(yO) + 0.5)
        ctx.lineTo(plotW, Math.round(yO) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        if (visible) {
          const xx = xOf(ti)
          const ph = (now % 1500) / 1500
          ctx.globalAlpha = 0.6 * (1 - ph)
          ctx.strokeStyle = col
          ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(xx, yO, 4 + ph * 9, 0, Math.PI * 2); ctx.stroke()
          ctx.globalAlpha = 1
          ctx.fillStyle = col
          ctx.beginPath(); ctx.arc(xx, yO, 3.5, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = '#09090b'
          ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(xx, yO, 3.5, 0, Math.PI * 2); ctx.stroke()
        }
      } else if (visible) {
        settled.push({ t, ti })
      }
    }
    /* settled: entry arrow (shape = direction, colour = result) + connector + badge */
    if (settled.length > 80) settled.splice(0, settled.length - 80)
    const perCandle = new Map<number, number>()
    for (const s of settled) perCandle.set(s.ti, (perCandle.get(s.ti) ?? 0) + 1)
    const seen = new Map<number, number>()
    for (const { t, ti } of settled) {
      const k = seen.get(ti) ?? 0
      seen.set(ti, k + 1)
      const total = perCandle.get(ti) ?? 1
      const xx = xOf(ti) + (k - (total - 1) / 2) * 8
      const isWin = t.status === 'win'
      const isDraw = t.status === 'draw'
      const col = isDraw ? '#a1a1aa' : isWin ? COL.up : COL.down
      const c = data[ti]
      /* entry → close connector */
      const ci = t.closeTime != null ? timeIdx(t.closeTime) : undefined
      const hasConn = ci != null && t.closePrice != null && ci >= i0 && ci <= i1 && ci !== ti
      let badgeX = xx, badgeY: number
      if (hasConn && t.closePrice != null && ci != null) {
        ctx.strokeStyle = isWin ? 'rgba(52,211,153,0.5)' : isDraw ? 'rgba(161,161,170,0.45)' : 'rgba(248,113,113,0.5)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(xx, yOf(t.openPrice))
        ctx.lineTo(xOf(ci), yOf(t.closePrice))
        ctx.stroke()
        ctx.setLineDash([])
        badgeX = xOf(ci)
        badgeY = yOf(t.closePrice)
      } else {
        badgeY = t.direction === 'call' ? yOf(c.low) + 28 : yOf(c.high) - 28
      }
      /* entry arrow */
      ctx.fillStyle = col
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1
      ctx.beginPath()
      if (t.direction === 'call') {
        const tip = Math.min(yOf(c.low) + 7, mainTop + mainH - 9)
        const base = Math.min(yOf(c.low) + 16, mainTop + mainH - 1)
        ctx.moveTo(xx, tip)
        ctx.lineTo(xx - 4.5, base)
        ctx.lineTo(xx + 4.5, base)
      } else {
        const tip = Math.max(yOf(c.high) - 7, mainTop + 9)
        const base = Math.max(yOf(c.high) - 16, mainTop + 1)
        ctx.moveTo(xx, tip)
        ctx.lineTo(xx - 4.5, base)
        ctx.lineTo(xx + 4.5, base)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      /* W/L/D badge */
      const bx = clamp(badgeX, 10, plotW - 12)
      const by = clamp(badgeY, mainTop + 8, mainTop + mainH - 8)
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.roundRect(bx - 5.5, by - 7, 11, 13, 3)
      ctx.fill()
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#09090b'
      ctx.font = `bold 9px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(isDraw ? 'D' : isWin ? 'W' : 'L', bx, by - 0.5)
    }

    /* ── subpanels ── */
    if (panel !== 'none' && subH > 0) {
      ctx.strokeStyle = COL.frame
      ctx.beginPath()
      ctx.moveTo(0, Math.round(subTop - subGap / 2) + 0.5)
      ctx.lineTo(plotW, Math.round(subTop - subGap / 2) + 0.5)
      ctx.stroke()

      if (panel === 'rsi') {
        const yr = (v: number) => subTop + subH - (v / 100) * subH
        ctx.fillStyle = 'rgba(167,139,250,0.04)'
        ctx.fillRect(0, yr(70), plotW, yr(30) - yr(70))
        ctx.strokeStyle = COL.chip
        ctx.setLineDash([3, 4])
        for (const lvl of [30, 70]) {
          ctx.beginPath()
          ctx.moveTo(0, Math.round(yr(lvl)) + 0.5)
          ctx.lineTo(plotW, Math.round(yr(lvl)) + 0.5)
          ctx.stroke()
        }
        ctx.setLineDash([])
        ctx.fillStyle = COL.axis
        ctx.font = `9px ${MONO}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText('70', plotW + 6, yr(70))
        ctx.fillText('30', plotW + 6, yr(30))
        ctx.strokeStyle = COL.rsi
        ctx.lineWidth = 1.3
        ctx.beginPath()
        let rsiStarted = false
        for (let i = i0; i <= i1; i++) {
          const v = series.rsi[i]
          if (!isFinite(v)) continue
          const xx = xOf(i), yy = yr(v)
          if (!rsiStarted) { ctx.moveTo(xx, yy); rsiStarted = true } else ctx.lineTo(xx, yy)
        }
        ctx.stroke()
        const rv = series.rsi[i1]
        if (isFinite(rv)) {
          ctx.fillStyle = rv > 70 ? COL.down : rv < 30 ? COL.up : COL.rsi
          ctx.beginPath()
          ctx.roundRect(plotW + 2, yr(rv) - 7, PAD_RIGHT - 5, 14, 3)
          ctx.fill()
          ctx.fillStyle = '#09090b'
          ctx.font = `bold 10px ${MONO}`
          ctx.textAlign = 'center'
          ctx.fillText(rv.toFixed(0), plotW + 2 + (PAD_RIGHT - 5) / 2, yr(rv) + 0.5)
        }
        ctx.fillStyle = COL.axis
        ctx.font = `bold 9px system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.fillText('RSI 14', 6, subTop + 10)
      } else {
        /* activity = candle range proxy */
        const ya = (v: number) => subTop + subH - (maxVol > 0 ? (v / maxVol) * subH * 0.92 : 0)
        let sum = 0
        for (let i = i0; i <= i1; i++) sum += series.vol[i]
        const avg = i1 >= i0 ? sum / (i1 - i0 + 1) : 0
        ctx.strokeStyle = '#52525b'
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(ya(avg)) + 0.5)
        ctx.lineTo(plotW, Math.round(ya(avg)) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        for (let i = i0; i <= i1; i++) {
          const up = data[i].close >= data[i].open
          ctx.fillStyle = up ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)'
          const yy = ya(series.vol[i])
          ctx.fillRect(xOf(i) - barW / 2, yy, barW, subTop + subH - yy)
        }
        ctx.fillStyle = '#a1a1aa'
        ctx.beginPath()
        ctx.roundRect(plotW + 2, subTop + subH / 2 - 7, PAD_RIGHT - 5, 14, 3)
        ctx.fill()
        ctx.fillStyle = '#09090b'
        ctx.font = `bold 9px ${MONO}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(fmtCompact(series.vol[i1]), plotW + 2 + (PAD_RIGHT - 5) / 2, subTop + subH / 2 + 0.5)
        ctx.fillStyle = COL.axis
        ctx.font = `bold 9px system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.fillText('ACTIVITY (range)', 6, subTop + 10)
      }
    }

    /* ── crosshair + OHLC readout ── */
    const hv = hoverRef.current
    if (hv && hv.x >= 0 && hv.x <= plotW && hv.y >= 0 && hv.y <= subBot) {
      const idx = clamp(Math.floor(hv.x / cw + iLeft), 0, n - 1)
      const hc = data[idx]
      const cx = Math.round(xOf(idx)) + 0.5
      const inMain = hv.y >= mainTop && hv.y <= mainTop + mainH
      ctx.strokeStyle = COL.cross
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx, mainTop); ctx.lineTo(cx, subBot); ctx.stroke()
      if (inMain) {
        ctx.beginPath()
        ctx.moveTo(0, Math.round(hv.y) + 0.5)
        ctx.lineTo(plotW, Math.round(hv.y) + 0.5)
        ctx.stroke()
      }
      ctx.setLineDash([])
      /* price chip on the axis */
      if (inMain) {
        const price = lo + (1 - (hv.y - mainTop) / mainH) * (hi - lo)
        ctx.fillStyle = COL.chip
        ctx.beginPath()
        ctx.roundRect(plotW + 2, hv.y - 8, PAD_RIGHT - 5, 16, 3)
        ctx.fill()
        ctx.fillStyle = '#fafafa'
        ctx.font = `bold 10px ${MONO}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(price.toFixed(digits), plotW + 2 + (PAD_RIGHT - 5) / 2, hv.y + 0.5)
      }
      /* time chip on the bottom axis */
      const tl = fmtTime(hc.time)
      ctx.font = `bold 9px ${MONO}`
      const tw = ctx.measureText(tl).width + 10
      const tx = clamp(cx, tw / 2 + 2, plotW - tw / 2 - 2)
      ctx.fillStyle = COL.chip
      ctx.beginPath()
      ctx.roundRect(tx - tw / 2, H - PAD_BOTTOM + 3, tw, 14, 3)
      ctx.fill()
      ctx.fillStyle = '#fafafa'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tl, tx, H - PAD_BOTTOM + 10)
      /* OHLC box (top-left, below the legend row) */
      const up = hc.close >= hc.open
      const rows: [string, string][] = [
        ['O', hc.open.toFixed(digits)],
        ['H', hc.high.toFixed(digits)],
        ['L', hc.low.toFixed(digits)],
        ['C', hc.close.toFixed(digits)],
      ]
      ctx.font = `bold 10px ${MONO}`
      const valW = Math.max(...rows.map(r => ctx.measureText(r[1]).width))
      const boxW = valW + 30
      const boxH = rows.length * 13 + 8
      const bx = 6, by = 24
      ctx.fillStyle = 'rgba(24,24,27,0.92)'
      ctx.strokeStyle = COL.chip
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(bx, by, boxW, boxH, 5)
      ctx.fill()
      ctx.stroke()
      ctx.textBaseline = 'middle'
      rows.forEach(([lab, val], k) => {
        const yy = by + 10 + k * 13
        ctx.textAlign = 'left'
        ctx.fillStyle = COL.axis
        ctx.fillText(lab, bx + 8, yy)
        ctx.textAlign = 'right'
        ctx.fillStyle = k === 3 ? (up ? COL.up : COL.down) : '#e4e4e7'
        ctx.fillText(val, bx + boxW - 8, yy)
      })
    }
  }, [])

  /* rAF-throttled schedule */
  const scheduleDraw = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  /* ── zoom helpers ── */
  const zoomAtFraction = useCallback((f: number, newCount: number) => {
    const st = latestRef.current
    const n = st?.data.length ?? 0
    if (n === 0) return
    const v = viewRef.current
    const anchor = v.right - v.count + f * v.count
    v.count = clamp(newCount, MIN_BARS, MAX_BARS)
    if (atLiveRef.current) v.right = n - 1 + EDGE_PAD
    else v.right = anchor + (1 - f) * v.count
    clampViewTo(n)
    scheduleDraw()
  }, [clampViewTo, scheduleDraw])

  const zoomStep = useCallback((factor: number) => {
    zoomAtFraction(atLiveRef.current ? 1 : 0.5, viewRef.current.count * factor)
  }, [zoomAtFraction])

  const goLive = useCallback(() => {
    const n = latestRef.current?.data.length ?? 0
    if (n > 0) viewRef.current.right = n - 1 + EDGE_PAD
    clampViewTo(n)
    scheduleDraw()
  }, [clampViewTo, scheduleDraw])

  /* ── sync latest data into refs + draw (after every render) ── */
  useIsoLayoutEffect(() => {
    const bucketSec = timeframe * 60
    latestRef.current = {
      data, series, hasForming:
        forming != null && data.length > 0
        && data[data.length - 1].time === Math.floor(forming.time / bucketSec) * bucketSec,
      livePrice, trades, signals, panel, asset, timeframe,
    }
    const n = data.length
    if (n > 0) {
      const maxRight = n - 1 + EDGE_PAD
      // auto-follow the live edge unless the user is mid-gesture / panned away
      if (atLiveRef.current && !dragRef.current && !pinchRef.current) viewRef.current.right = maxRight
      clampViewTo(n)
    }
    scheduleDraw()
  })

  /* asset / timeframe switch → jump back to the live edge */
  useEffect(() => { goLive() }, [asset, timeframe, goLive])

  /* wheel: zoom (cursor-anchored) + horizontal wheel pan — needs non-passive */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const st = latestRef.current
      const n = st?.data.length ?? 0
      if (n === 0) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) + 2) {
        // trackpad two-finger horizontal scroll → pan
        const cw = layoutRef.current.cw || 8
        viewRef.current.right -= e.deltaX / cw
        clampViewTo(n)
        scheduleDraw()
        return
      }
      const rect = canvas.getBoundingClientRect()
      const plotW = layoutRef.current.plotW || Math.max(60, rect.width - PAD_RIGHT)
      const f = clamp((e.clientX - rect.left) / plotW, 0, 1)
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 15
      else if (e.deltaMode === 2) dy *= 60
      const factor = Math.exp(clamp(dy, -350, 350) * 0.0025)
      zoomAtFraction(f, viewRef.current.count * factor)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAtFraction, clampViewTo, scheduleDraw])

  /* container resize → redraw (draw picks up the new size) */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => scheduleDraw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [scheduleDraw])

  /* pulsing open-trade markers → lightweight rAF loop, only while needed */
  useEffect(() => {
    if (openCount === 0) return
    let alive = true
    let id = 0
    const tick = () => {
      if (!alive) return
      scheduleDraw()
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(id) }
  }, [openCount, scheduleDraw])

  /* ── pointer interactions (drag pan / pinch zoom / crosshair) ── */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const canvas = canvasRef.current
    if (canvas) {
      try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer gone */ }
    }
    // A fresh PRIMARY pointer means the previous gesture stack ended — if any
    // tracked pointer's up/cancel was missed (driver quirk, browser gesture
    // takeover…), reset now so the chart can never get wedged.
    if (e.isPrimary) {
      pointersRef.current.clear()
      pinchRef.current = null
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size >= 2) {
      const [p1, p2] = [...pointersRef.current.values()]
      pinchRef.current = { d0: Math.max(30, Math.hypot(p1.x - p2.x, p1.y - p2.y)), count0: viewRef.current.count }
      dragRef.current = null
    } else {
      dragRef.current = { startX: e.clientX, startRight: viewRef.current.right, moved: false }
    }
    hoverRef.current = null
    if (canvas) canvas.style.cursor = 'crosshair'
    scheduleDraw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const n = latestRef.current?.data.length ?? 0

    /* pinch: zoom anchored under the current midpoint */
    if (pinchRef.current && pointersRef.current.size >= 2 && rect) {
      const [p1, p2] = [...pointersRef.current.values()]
      const d = Math.max(30, Math.hypot(p1.x - p2.x, p1.y - p2.y))
      const midX = (p1.x + p2.x) / 2 - rect.left
      const plotW = layoutRef.current.plotW || Math.max(60, rect.width - PAD_RIGHT)
      zoomAtFraction(clamp(midX / plotW, 0, 1), pinchRef.current.count0 * (pinchRef.current.d0 / d))
      return
    }

    /* single-pointer drag → pan */
    const drag = dragRef.current
    if (drag && n > 0) {
      const dx = e.clientX - drag.startX
      if (Math.abs(dx) > 3) drag.moved = true
      if (drag.moved) {
        const cw = layoutRef.current.cw || 8
        viewRef.current.right = drag.startRight - dx / cw
        clampViewTo(n)
        if (canvas) canvas.style.cursor = 'grabbing'
        scheduleDraw()
      }
      return
    }

    /* plain hover → crosshair (mouse; taps handled on pointerup for touch) */
    if (e.pointerType === 'mouse' && rect) {
      hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      scheduleDraw()
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointersRef.current.delete(e.pointerId)
    const canvas = canvasRef.current
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) {
        pinchRef.current = null
        if (pointersRef.current.size === 1) {
          // one finger left after the pinch → resume panning from here
          const [p] = [...pointersRef.current.values()]
          dragRef.current = { startX: p.x, startRight: viewRef.current.right, moved: true }
        }
      }
    } else if (dragRef.current) {
      const wasTap = !dragRef.current.moved
      dragRef.current = null
      if (wasTap) {
        const rect = canvas?.getBoundingClientRect()
        if (rect) {
          // tap (touch or mouse click) → inspect that candle
          hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        }
      }
    }
    if (canvas) canvas.style.cursor = 'crosshair'
    scheduleDraw()
  }

  const onPointerLeave = () => {
    if (!dragRef.current && !pinchRef.current) {
      hoverRef.current = null
      scheduleDraw()
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    goLive()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const n = latestRef.current?.data.length ?? 0
    if (n === 0) return
    const v = viewRef.current
    const step = Math.max(1, Math.round(v.count * 0.15))
    switch (e.key) {
      case 'ArrowLeft': v.right -= step; break
      case 'ArrowRight': v.right += step; break
      case 'Home': v.right = v.count - EDGE_PAD; break
      case 'End': v.right = n - 1 + EDGE_PAD; break
      case '0': v.count = INIT_BARS; break
      case '+': case '=': zoomStep(1 / 1.3); return
      case '-': case '_': zoomStep(1.3); return
      default: return
    }
    e.preventDefault()
    clampViewTo(n)
    scheduleDraw()
  }

  /* ── markup ── */
  const toolBtn =
    'flex h-6 items-center gap-1 rounded border border-zinc-800 px-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100'

  return (
    <div ref={wrapRef} className="relative h-[340px] w-full select-none overflow-hidden sm:h-[420px]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        role="img"
        aria-label={`${asset} candlestick chart — scroll or pinch to zoom, drag to pan through history, double-click for the live edge`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={e => e.preventDefault()}
      />

      {/* legend */}
      <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-120px)] flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-zinc-500">
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 rounded bg-sky-400" />EMA 9</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 rounded bg-amber-400" />EMA 21</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 rounded bg-violet-400" />EMA 50</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-violet-400/20 ring-1 ring-violet-400/40" />BB 20/2</span>
        {panel === 'rsi' && <span className="flex items-center gap-1"><span className="h-[2px] w-3 rounded bg-purple-400" />RSI 14</span>}
        {timeframe > 1 && (
          <span className="rounded bg-emerald-950/70 px-1.5 font-bold text-emerald-400">M{timeframe} view · engine trades M1</span>
        )}
        {tradeChip > 0 && (
          <span className="rounded bg-zinc-800/80 px-1.5 font-bold text-zinc-300" title="Entry arrows + W/L badges drawn on-chart for this asset">
            ◆ {tradeChip} trade{tradeChip > 1 ? 's' : ''}
          </span>
        )}
        <span className="hidden text-zinc-600 sm:inline">scroll = zoom · drag = pan</span>
      </div>

      {/* toolbar: zoom + subpanel toggles */}
      <div
        className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950/80 p-0.5"
        role="toolbar"
        aria-label="Chart tools"
      >
        <button
          type="button"
          onClick={() => zoomStep(1 / 1.3)}
          title="Zoom in (or scroll up)"
          aria-label="Zoom in"
          className={cn(toolBtn, 'w-6 justify-center px-0')}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomStep(1.3)}
          title="Zoom out (or scroll down)"
          aria-label="Zoom out"
          className={cn(toolBtn, 'w-6 justify-center px-0')}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span
          ref={barsLabelRef}
          title="Visible candles — scroll to zoom, drag to pan"
          className="min-w-[28px] px-0.5 text-center font-mono text-[9px] leading-4 text-zinc-500"
        >
          {INIT_BARS}
        </span>
        <span className="mx-0.5 h-4 w-px bg-zinc-800" />
        <button
          type="button"
          onClick={() => setPanel(p => (p === 'rsi' ? 'none' : 'rsi'))}
          aria-pressed={panel === 'rsi'}
          title="RSI(14) subpanel"
          className={cn(toolBtn, panel === 'rsi' && 'border-zinc-600 bg-zinc-700 text-zinc-100 hover:bg-zinc-600')}
        >
          <Gauge className="h-3 w-3" />
          <span className="text-[9px] font-bold">RSI</span>
        </button>
        <button
          type="button"
          onClick={() => setPanel(p => (p === 'act' ? 'none' : 'act'))}
          aria-pressed={panel === 'act'}
          title="Activity (range) subpanel"
          className={cn(toolBtn, panel === 'act' && 'border-zinc-600 bg-zinc-700 text-zinc-100 hover:bg-zinc-600')}
        >
          <Activity className="h-3 w-3" />
          <span className="text-[9px] font-bold">ACT</span>
        </button>
      </div>

      {/* jump back to the live edge (only when panned away) */}
      {!atLive && (
        <button
          type="button"
          onClick={goLive}
          aria-label="Jump back to the live candle"
          title="Back to live (double-click the chart)"
          className="absolute bottom-[26px] right-[72px] flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-emerald-950/40 transition-colors hover:bg-emerald-500"
        >
          <span className="animate-pulse">●</span> LIVE
        </button>
      )}
    </div>
  )
}
