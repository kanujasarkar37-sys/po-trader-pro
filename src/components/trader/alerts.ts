'use client'

// ─── Alert utilities: WebAudio beeps + browser notifications ──────────────

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function tone(freq: number, startAt: number, duration: number, gain = 0.08, type: OscillatorType = 'sine') {
  const ctx = getCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, ctx.currentTime + startAt)
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + startAt + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + duration)
  osc.connect(g).connect(ctx.destination)
  osc.start(ctx.currentTime + startAt)
  osc.stop(ctx.currentTime + startAt + duration + 0.05)
}

/** short two-note "signal ping" */
export function beepSignal() {
  tone(880, 0, 0.12)
  tone(1174.7, 0.13, 0.18)
}

/** rising arpeggio — trade won */
export function beepWin() {
  tone(523.3, 0, 0.1)
  tone(659.3, 0.1, 0.1)
  tone(784, 0.2, 0.22)
}

/** falling sad tone — trade lost */
export function beepLoss() {
  tone(392, 0, 0.14, 0.07, 'triangle')
  tone(277.2, 0.16, 0.26, 0.07, 'triangle')
}

/** single soft click for UI actions */
export function beepClick() {
  tone(1318.5, 0, 0.05, 0.04)
}

export function notify(title: string, body: string) {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, silent: true, tag: 'po-trader' })
  } catch { /* notification constructor can throw in some contexts */ }
}

export function requestNotifPermission() {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}
