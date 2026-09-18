// Live-path edge test at tick granularity (optimized)
import { analyze } from '../mini-services/po-trader/src/signal-engine.ts'
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

const base = 1.0856, vol0 = 0.00012
const RUNS = 4, TOTAL_MIN = 300
for (const thr of [65, 70]) {
  let t = 0, w = 0, sigCount = 0
  for (let run = 0; run < RUNS; run++) {
    let st = { price: base * (1 + (Math.random() - 0.5) * 0.004), drift: 0, regime: 'range', regimeTicksLeft: 250, vol: vol0 }
    const closed = []
    let forming = null
    const tick = (price, ts) => {
      const bucket = Math.floor(ts / 60) * 60
      if (!forming) { forming = { time: bucket, open: price, high: price, low: price, close: price }; return }
      if (bucket > forming.time) { closed.push(forming); if (closed.length > 320) closed.shift(); forming = { time: bucket, open: price, high: price, low: price, close: price }; return }
      if (price > forming.high) forming.high = price
      if (price < forming.low) forming.low = price
      forming.close = price
    }
    const startTs = Math.floor(Date.now() / 1000) - TOTAL_MIN * 60
    let entryDir = null, entryOpen = 0, entryMinute = -1, sigCount = 0
    for (let min = 0; min < TOTAL_MIN; min++) {
      const minuteStart = startTs + min * 60
      for (let s = 0; s < 60; s++) {
        const ts = minuteStart + s
        for (let k = 0; k < 2; k++) {
          // step
          st.regimeTicksLeft--
          if (st.regimeTicksLeft <= 0) {
            const roll = Math.random()
            st.regime = roll < 0.4 ? 'range' : roll < 0.85 ? 'trend' : 'volatile'
            st.regimeTicksLeft = 150 + Math.floor(Math.random() * 500)
            st.drift = st.regime === 'trend' ? (Math.random() - 0.5) * 2 * 0.35 : 0
            st.vol = st.regime === 'volatile' ? vol0 * (2 + Math.random() * 2) : vol0 * (0.8 + Math.random() * 0.5)
          }
          const pull = (base - st.price) / base * (st.regime === 'range' ? 0.036 / 120 : 0.0096 / 120)
          const noise = (gauss() + gauss() * 0.5) * st.vol / Math.sqrt(120)
          st.price = st.price * (1 + st.drift * (st.vol / base) * (1.8 / 120) + pull) + noise
          if (st.price <= base * 0.7) st.price = base * 0.7
          if (st.price >= base * 1.3) st.price = base * 1.3
          tick(st.price, ts)
        }
        // settle due trade at :01.5 of the candle after expiry
        if (entryDir && ts === startTs + entryMinute * 60 + 61) {
          // close price = current forming candle's close (~1.5s in)
          const close = forming ? forming.close : st.price
          t++
          if (entryDir === 'call' ? close > entryOpen : close < entryOpen) w++
          entryDir = null
        }
      }
      // scan at :57 of this minute (forming candle 57s old)
      if (forming && closed.length >= 120) {
        const { signal } = analyze([...closed, forming], 'EURUSD_otc', 92, { minConfidence: thr, expirySeconds: 60 })
        if (signal) {
          sigCount++
          entryDir = signal.direction
          entryOpen = st.price // entry at next boundary ≈ current price at :59.5
          entryMinute = min + 1 // trade opens at next minute boundary
        }
      }
    }
  }
  console.log(`thr ${thr}: ${sigCount} signals → ${t} settled  WR ${t ? (w / t * 100).toFixed(1) : 'n/a'}%`)
}
