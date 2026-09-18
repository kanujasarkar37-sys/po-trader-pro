import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
socket.on('connect', () => {
  socket.emit('config:update', {}, (r) => { // empty update returns current config
    console.log('engine config dailyStopLoss:', r.config?.dailyStopLoss, '· dailyProfitTarget:', r.config?.dailyProfitTarget, '· dynamicStake:', r.config?.dynamicStake)
    process.exit(0)
  })
})
socket.on('config', (c) => console.log('config event: dailyStopLoss =', c.dailyStopLoss))
setTimeout(() => { console.log('timeout'); process.exit(1) }, 8000)
