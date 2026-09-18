import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('candles:get', { asset: 'ETHUSD', count: 20 }, (r) => {
    console.log('ETHUSD total:', r.total)
    console.log('last 20:', JSON.stringify(r.candles.map(c => [c.time, c.close]), null, 0).slice(0, 800))
    socket.emit('candles:get', { asset: 'PLATINUM', count: 20 }, (r2) => {
      console.log('PLATINUM total:', r2.total)
      console.log('PLATINUM closes:', r2.candles.map(c => c.close).join(', '))
      process.exit(0)
    })
  })
})
setTimeout(() => { console.log('timeout'); process.exit(1) }, 10000)
