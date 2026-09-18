import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
socket.on('connect', () => console.log('connected', socket.id))
socket.on('state', (s) => console.log('state:', s.mode, 'bot:', s.botRunning))
socket.on('movers', (m) => {
  console.log('MOVERS EVENT:', m.length, 'items →', m.slice(0, 4).map((x) => `${x.asset} ${x.changePct}%`).join(', '))
  process.exit(0)
})
setTimeout(() => { console.log('TIMEOUT — no movers event in 40s'); process.exit(1) }, 40000)
