// Verify simulator history sanity for high-priced assets after fix
import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('sim:start', {}, () => {
    setTimeout(() => {
      const assets = ['ETHUSD', 'PLATINUM', 'SP500', 'GOOGL', 'BTCUSD', 'EURUSD_otc']
      let done = 0
      for (const a of assets) {
        socket.emit('candles:get', { asset: a, count: 20 }, (r) => {
          const closes = r.candles.map(c => c.close)
          const bad = closes.filter(c => !isFinite(c) || c <= 0)
          const spread = Math.max(...closes) / Math.min(...closes)
          console.log(`${a}: total=${r.total} min=${Math.min(...closes).toPrecision(6)} max=${Math.max(...closes).toPrecision(6)} ratio=${spread.toFixed(3)} ${bad.length ? 'BAD:' + bad.length : 'OK'}`)
          if (++done === assets.length) process.exit(0)
        })
      }
    }, 3000)
  })
})
setTimeout(() => { console.log('timeout'); process.exit(1) }, 30000)
