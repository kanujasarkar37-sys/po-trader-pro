import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
socket.on('connect', () => {
  setTimeout(() => {
    socket.emit('signal:scan', {}, (r) => {
      socket.emit('candles:get', { asset: 'EURUSD_otc', count: 1 }, (c) => {
        // fetch stats via a fresh connection state
        process.exit(0)
      })
    })
  }, 1500)
})
socket.on('stats', (s) => {
  console.log('stats.daily:', JSON.stringify(s.daily))
  console.log('totalTrades:', s.totalTrades, 'profit:', s.profit)
  process.exit(0)
})
setTimeout(() => { console.log('timeout'); process.exit(1) }, 10000)
