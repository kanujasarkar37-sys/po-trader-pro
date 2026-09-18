import { io } from 'socket.io-client'
const socket = io('http://localhost:3030', { transports: ['websocket'] })
let scans = 0
socket.on('connect', () => {
  socket.on('scan', (s) => { scans++; if (scans <= 3) console.log('scan:', JSON.stringify(s).slice(0, 140)) })
  socket.on('log', (l) => console.log('LOG:', l.msg))
  socket.on('trade:opened', (t) => console.log('OPENED:', t.asset, t.direction, t.amount))
  socket.on('trade:settled', (t) => console.log('SETTLED:', t.asset, t.status, t.profit))
})
setTimeout(() => { console.log(`--- ${scans} scans in 80s`); process.exit(0) }, 80000)
