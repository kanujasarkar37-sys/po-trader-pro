// ─── Telegram Bridge (v8) ───────────────────────────────────────────────────
// Two-way link between the trading engine and a Telegram bot:
//   · outbound: signal alerts, trade open/settle alerts, bot status changes
//   · inbound:  remote commands via long-polling getUpdates
//     /help /status /start /stop /balance /signals /trades /ping
// Config is persisted to tg-config.json (next to index.ts) — no DB involved.
// Rate-limit safe: queued sends with ≥1.2s spacing, single poll loop.

import type { Signal, TradeRecord } from './types'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CFG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'tg-config.json')
const API = 'https://api.telegram.org'
const POLL_TIMEOUT_S = 25
const SEND_GAP_MS = 1200

export interface TelegramConfig {
  enabled: boolean
  token: string
  chatId: string
  notifySignals: boolean
  notifyTrades: boolean
  notifyStatus: boolean
  minConfidence: number // alert bar for signal notifications
}

export interface TelegramStatus {
  configured: boolean
  polling: boolean
  botUsername: string | null
  lastError: string | null
  lastMessageAt: number | null
  sentCount: number
  commandCount: number
  startedAt: number | null
}

export const DEFAULT_TG_CONFIG: TelegramConfig = {
  enabled: false,
  token: '',
  chatId: '',
  notifySignals: true,
  notifyTrades: true,
  notifyStatus: true,
  minConfidence: 75,
}

/** Minimal engine surface the bridge needs (avoids circular imports). */
export interface TelegramHost {
  startBot(): boolean
  stopBot(reason?: string): void
  snapshot(): { mode: string; botRunning: boolean; accountType: string; balance: number }
  balanceSnapshot(): { balance: number | null; accountType: string; demoBalance: number | null; realBalance: number | null }
  statsSnapshot(): Record<string, unknown>
  latestSignals(): Signal[]
  latestTrades(): TradeRecord[]
  log(msg: string): void
  broadcast(event: string, payload: unknown): void
}

export class TelegramBridge {
  private cfg: TelegramConfig = { ...DEFAULT_TG_CONFIG }
  private status: TelegramStatus = {
    configured: false, polling: false, botUsername: null, lastError: null,
    lastMessageAt: null, sentCount: 0, commandCount: 0, startedAt: null,
  }
  private host: TelegramHost | null = null
  private pollAbort: AbortController | null = null
  private queue: string[] = []
  private flushing = false
  private offset = 0
  private booted = false

  /** Wire the engine host + load persisted config. Called once at boot. */
  boot(host: TelegramHost) {
    if (this.booted) return
    this.booted = true
    this.host = host
    try {
      const raw = readFileSync(CFG_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<TelegramConfig>
      this.cfg = { ...DEFAULT_TG_CONFIG, ...parsed }
    } catch { /* first run — defaults */ }
    this.status.configured = !!(this.cfg.token && this.cfg.chatId)
    if (this.cfg.enabled && this.status.configured) this.startPolling()
  }

  config(): TelegramConfig { return { ...this.cfg } }
  info(): TelegramStatus & { config: TelegramConfig } {
    return { ...this.status, config: this.config() }
  }

  /** Update config (partial), persist, and (re)start/stop polling as needed. */
  setConfig(patch: Partial<TelegramConfig>): { ok: boolean; error?: string } {
    const next = { ...this.cfg }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.token === 'string') next.token = patch.token.trim()
    if (typeof patch.chatId === 'string') next.chatId = patch.chatId.trim()
    if (typeof patch.notifySignals === 'boolean') next.notifySignals = patch.notifySignals
    if (typeof patch.notifyTrades === 'boolean') next.notifyTrades = patch.notifyTrades
    if (typeof patch.notifyStatus === 'boolean') next.notifyStatus = patch.notifyStatus
    if (typeof patch.minConfidence === 'number') next.minConfidence = Math.max(50, Math.min(95, Math.round(patch.minConfidence)))
    if (next.enabled && !(next.token && next.chatId)) {
      return { ok: false, error: 'Token and chat ID are required to enable the bridge' }
    }
    this.cfg = next
    this.status.configured = !!(next.token && next.chatId)
    try { writeFileSync(CFG_PATH, JSON.stringify(this.cfg, null, 2)) } catch { /* best-effort */ }

    const wantPolling = next.enabled && this.status.configured
    if (wantPolling && !this.status.polling) this.startPolling()
    else if (!wantPolling && this.status.polling) this.stopPolling()

    this.notifyStatusChanged()
    if (this.host) this.host.log(`✈️ Telegram bridge ${next.enabled ? 'ENABLED' : 'disabled'}${next.enabled ? ` — alerts ≥${next.minConfidence}%` : ''}`)
    return { ok: true }
  }

  /** Send a test message (from the UI "Test" button). */
  async test(): Promise<{ ok: boolean; error?: string }> {
    if (!(this.cfg.token && this.cfg.chatId)) return { ok: false, error: 'Set token and chat ID first' }
    const ok = await this.rawSend(
      '✈️ <b>PO Trader Pro</b> — bridge test OK\n'
      + `Engine reachable · alerts ≥${this.cfg.minConfidence}% confidence\n`
      + `Commands: /help /status /start /stop /balance /signals /trades`
    )
    return ok ? { ok: true } : { ok: false, error: this.status.lastError ?? 'send failed' }
  }

  // ─── Outbound notifications (engine hooks) ────────────────────────────────

  notifySignal(sig: Signal) {
    if (!this.ready() || !this.cfg.notifySignals) return
    if (sig.confidence < this.cfg.minConfidence) return
    const arrow = sig.direction === 'call' ? '🟢 CALL ▲' : '🔴 PUT ▼'
    this.send(
      `${arrow} <b>${sig.asset}</b> — ${sig.confidence}% confluence\n`
      + `Entry ${fmtTime(sig.entryAt)} · expiry ${sig.expirySeconds}s @ ${sig.price}\n`
      + `Payout ${sig.payout}% · ${sig.regime} regime${sig.acted ? ' · 🤖 bot entering' : ''}`
    )
  }

  notifyTradeOpened(trade: TradeRecord) {
    if (!this.ready() || !this.cfg.notifyTrades) return
    if (trade.source !== 'bot') return // manual trades are visible in the UI
    const arrow = trade.direction === 'call' ? '🟢 CALL' : '🔴 PUT'
    this.send(
      `🤖 <b>${arrow} ${trade.asset}</b> $${trade.amount.toFixed(2)} · ${trade.expirySeconds}s\n`
      + `@ ${trade.openPrice} · conf ${trade.confidence}% · ${trade.isDemo ? 'demo' : '<b>REAL</b>'}`
    )
  }

  notifyTradeSettled(trade: TradeRecord) {
    if (!this.ready() || !this.cfg.notifyTrades) return
    const icon = trade.status === 'win' ? '✅ WIN' : trade.status === 'loss' ? '❌ LOSS' : '➖ DRAW'
    const pl = `${trade.profit >= 0 ? '+' : ''}$${trade.profit.toFixed(2)}`
    const move = trade.closePrice != null
      ? `${trade.openPrice} → ${trade.closePrice}`
      : ''
    this.send(
      `${icon} <b>${trade.asset}</b> ${trade.direction.toUpperCase()} · ${pl}\n`
      + (move ? `${move}${trade.confidence ? ` · conf ${trade.confidence}%` : ''} · ${trade.isDemo ? 'demo' : '<b>REAL</b>'}` : '')
    )
  }

  notifyBotStatus(running: boolean, reason?: string) {
    if (!this.ready() || !this.cfg.notifyStatus) return
    if (running) {
      this.send('🤖 <b>Auto-trade bot STARTED</b> — entries live')
    } else {
      this.send(`🛑 <b>Auto-trade bot STOPPED</b>${reason ? `\n${reason}` : ''}`)
    }
  }

  // ─── Polling / command handling ───────────────────────────────────────────

  private startPolling() {
    if (this.status.polling) return
    this.status.polling = true
    this.status.startedAt = Date.now()
    this.status.lastError = null
    this.notifyStatusChanged()
    void this.pollLoop()
    void this.fetchMe()
    this.host?.log(`✈️ Telegram bridge connected — remote commands active`)
  }

  private stopPolling() {
    this.status.polling = false
    this.pollAbort?.abort()
    this.pollAbort = null
    this.notifyStatusChanged()
  }

  private ready(): boolean {
    return this.cfg.enabled && !!(this.cfg.token && this.cfg.chatId) && this.status.polling
  }

  private async fetchMe() {
    try {
      const res = await this.tgCall('getMe', {})
      if (res?.ok && res.result?.username) {
        this.status.botUsername = String(res.result.username)
        this.notifyStatusChanged()
      }
    } catch { /* username is cosmetic */ }
  }

  private async pollLoop() {
    while (this.status.polling) {
      try {
        this.pollAbort = new AbortController()
        const res = await this.tgCall('getUpdates', {
          timeout: POLL_TIMEOUT_S,
          offset: this.offset,
          allowed_updates: JSON.stringify(['message']),
        }, this.pollAbort.signal)
        if (res?.ok && Array.isArray(res.result)) {
          for (const upd of res.result as any[]) {
            const id = Number(upd.update_id)
            if (Number.isFinite(id)) this.offset = Math.max(this.offset, id + 1)
            if (upd.message) this.onMessage(upd.message)
          }
        } else if (res && !res.ok) {
          throw new Error(String(res.description ?? 'getUpdates failed'))
        }
        if (this.status.lastError) { this.status.lastError = null; this.notifyStatusChanged() }
      } catch (e: unknown) {
        if (!this.status.polling) break // aborted by stopPolling
        this.status.lastError = String((e as Error)?.message ?? e).slice(0, 140)
        this.notifyStatusChanged()
        await sleep(5000)
      }
    }
  }

  private onMessage(msg: any) {
    const chatId = String(msg?.chat?.id ?? '')
    if (!chatId) return
    // auto-adopt chat ID: first message to a configured bot fills it in
    if (!this.cfg.chatId && this.cfg.token) {
      this.cfg.chatId = chatId
      this.status.configured = true
      try { writeFileSync(CFG_PATH, JSON.stringify(this.cfg, null, 2)) } catch { /* best-effort */ }
      this.notifyStatusChanged()
      this.host?.log(`✈️ Telegram chat ID auto-detected (${chatId}) — bridge armed`)
      this.send('✈️ <b>PO Trader Pro</b> — chat linked. Send /help for commands.')
      return
    }
    if (chatId !== this.cfg.chatId) return // ignore strangers

    const text = String(msg.text ?? '').trim()
    if (!text.startsWith('/')) return
    this.status.commandCount++
    const cmd = text.split(/\s+/)[0].toLowerCase().split('@')[0]
    const reply = this.handleCommand(cmd)
    if (reply) this.send(reply)
    this.notifyStatusChanged()
  }

  private handleCommand(cmd: string): string | null {
    const host = this.host
    if (!host) return null
    switch (cmd) {
      case '/start': {
        const ok = host.startBot()
        return ok
          ? '🤖 <b>Bot STARTED</b> — scanning selected pairs every candle close'
          : '⚠️ Could not start — engine not connected or a daily limit is already hit. See /status.'
      }
      case '/stop': {
        host.stopBot('Telegram /stop command')
        return '🛑 <b>Bot STOPPED</b>'
      }
      case '/status': {
        const s = host.snapshot() as any
        const st = host.statsSnapshot() as any
        const mode = s.mode === 'live' ? '🔴 LIVE Pocket Option' : s.mode === 'simulation' ? '🧪 SIMULATION' : '⚫ DISCONNECTED'
        const daily = st?.daily ? `\nDay P/L: ${fmtSigned(st.daily.pnl)}$` : ''
        return [
          `<b>PO Trader Pro</b>`,
          `Mode: ${mode} (${s.accountType})`,
          `Bot: ${s.botRunning ? '🟢 RUNNING' : '⚪ idle'}`,
          `Balance: $${Number(s.balance ?? 0).toFixed(2)}`,
          `Session: ${st?.bot?.trades ?? 0} trades · ${st?.bot?.wins ?? 0}W/${st?.bot?.losses ?? 0}L · ${fmtSigned(st?.bot?.profit ?? 0)}$`,
        ].join('\n') + daily
      }
      case '/balance': {
        const b = host.balanceSnapshot()
        return [
          `<b>Balances</b>`,
          `Active (${b.accountType}): $${Number(b.balance ?? 0).toFixed(2)}`,
          b.demoBalance != null ? `Demo: $${b.demoBalance.toFixed(2)}` : '',
          b.realBalance != null ? `Real: $${b.realBalance.toFixed(2)}` : '',
        ].filter(Boolean).join('\n')
      }
      case '/signals': {
        const sigs = host.latestSignals().slice(-5).reverse()
        if (!sigs.length) return 'No signals yet — the engine scans every candle close.'
        return '<b>Latest signals</b>\n' + sigs.map(s =>
          `${s.direction === 'call' ? '🟢▲' : '🔴▼'} <code>${s.asset}</code> ${s.confidence}% · ${fmtTime(s.createdAt)}${s.acted ? ' · taken' : ''}`
        ).join('\n')
      }
      case '/trades': {
        const trades = host.latestTrades().filter(t => t.status !== 'open').slice(-5).reverse()
        if (!trades.length) return 'No settled trades yet.'
        return '<b>Latest trades</b>\n' + trades.map(t =>
          `${t.status === 'win' ? '✅' : t.status === 'loss' ? '❌' : '➖'} <code>${t.asset}</code> ${t.direction.toUpperCase()} ${fmtSigned(t.profit)}$`
        ).join('\n')
      }
      case '/ping':
        return '🏓 pong — bridge alive'
      case '/help':
        return [
          '<b>PO Trader Pro — commands</b>',
          '/status — mode, bot state, balance, session stats',
          '/balance — demo & real balances',
          '/signals — last 5 signals',
          '/trades — last 5 settled trades',
          '/start — start the auto-trade bot',
          '/stop — stop the auto-trade bot',
          '/ping — bridge health check',
        ].join('\n')
      default:
        return `Unknown command ${cmd} — try /help`
    }
  }

  // ─── Send plumbing (queued, rate-limited) ─────────────────────────────────

  private send(text: string) {
    this.queue.push(text)
    if (this.queue.length > 30) this.queue.shift() // never spiral
    void this.flush()
  }

  private async flush() {
    if (this.flushing) return
    this.flushing = true
    while (this.queue.length) {
      const text = this.queue.shift()!
      await this.rawSend(text)
      await sleep(SEND_GAP_MS)
    }
    this.flushing = false
  }

  private async rawSend(text: string): Promise<boolean> {
    if (!(this.cfg.token && this.cfg.chatId)) return false
    const res = await this.tgCall('sendMessage', {
      chat_id: this.cfg.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
    if (res?.ok) {
      this.status.sentCount++
      this.status.lastMessageAt = Date.now()
      this.notifyStatusChanged()
      return true
    }
    this.status.lastError = String(res?.description ?? 'sendMessage failed').slice(0, 140)
    this.notifyStatusChanged()
    return false
  }

  private async tgCall(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    if (!this.cfg.token) return { ok: false, description: 'no token' }
    const res = await fetch(`${API}/bot${this.cfg.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    })
    return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
  }

  private notifyStatusChanged() {
    this.host?.broadcast('tg:status', this.info())
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
