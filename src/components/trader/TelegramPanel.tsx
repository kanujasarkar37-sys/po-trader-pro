'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTrader, type TelegramConfig } from './store'
import {
  Send, Eye, EyeOff, Zap, CheckCircle2, XCircle, Circle,
  Terminal, MessageSquareText, Bot, Coins, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function TelegramPanel({ inDialog = false }: { inDialog?: boolean }) {
  const { telegram, saveTelegram, testTelegram, socketConnected } = useTrader()
  const status = telegram.status
  const cfg = telegram.config

  // local editable copies (sent to the engine on Save)
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [minConf, setMinConf] = useState(75)
  const [notifySignals, setNotifySignals] = useState(true)
  const [notifyTrades, setNotifyTrades] = useState(true)
  const [notifyStatus, setNotifyStatus] = useState(true)
  const [saving, setSaving] = useState(false)

  // pull engine config into the local inputs once it arrives
  // — setState-during-render pattern (React docs: adjusting state when a value
  //   changes; same approach as the Header balance flash)
  const [syncedFrom, setSyncedFrom] = useState<TelegramConfig | null>(null)
  if (cfg && cfg !== syncedFrom) {
    setSyncedFrom(cfg)
    setToken(cfg.token ?? '')
    setChatId(cfg.chatId ?? '')
    setMinConf(cfg.minConfidence ?? 75)
    setNotifySignals(cfg.notifySignals ?? true)
    setNotifyTrades(cfg.notifyTrades ?? true)
    setNotifyStatus(cfg.notifyStatus ?? true)
  }

  const dirty =
    token.trim() !== (cfg?.token ?? '') ||
    chatId.trim() !== (cfg?.chatId ?? '') ||
    minConf !== (cfg?.minConfidence ?? 75) ||
    notifySignals !== (cfg?.notifySignals ?? true) ||
    notifyTrades !== (cfg?.notifyTrades ?? true) ||
    notifyStatus !== (cfg?.notifyStatus ?? true)

  const save = (patch: Record<string, unknown>) => {
    setSaving(true)
    saveTelegram(patch as never)
    setTimeout(() => setSaving(false), 600)
  }

  const saveAll = () => {
    save({
      token: token.trim(),
      chatId: chatId.trim(),
      minConfidence: minConf,
      notifySignals, notifyTrades, notifyStatus,
      enabled: cfg?.enabled ?? false,
    })
  }

  const polling = !!status?.polling
  const errored = !!status?.lastError
  const enabled = cfg?.enabled ?? false

  return (
    <div className={cn(
      'flex flex-col overflow-hidden rounded-xl bg-zinc-950/80',
      inDialog ? 'h-[440px] border-0' : 'border border-zinc-800'
    )}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <Send className="h-3.5 w-3.5 text-emerald-500" />
          Telegram Bridge
          <span
            className={cn(
              'rounded border px-1 py-0.5 text-[8px] font-bold',
              polling
                ? 'tg-pulse border-emerald-800/60 bg-emerald-950/40 text-emerald-400'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500'
            )}
            title={polling ? 'Long-polling Telegram for remote commands' : 'Bridge offline'}
          >
            {polling ? 'LIVE' : 'OFF'}
          </span>
        </h2>
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          {polling ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {status?.botUsername ? `@${status.botUsername}` : 'polling…'}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Circle className="h-2.5 w-2.5 text-zinc-700" />
              remote control off
            </span>
          )}
        </span>
      </div>

      <div className="scroll-thin max-h-[420px] space-y-3 overflow-y-auto px-3 py-3">
        {/* status row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
            <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">
              <MessageSquareText className="h-3 w-3" /> sent
            </div>
            <div className="font-mono text-sm font-bold tabular-nums text-zinc-200">{status?.sentCount ?? 0}</div>
          </div>
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
            <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">
              <Terminal className="h-3 w-3" /> commands
            </div>
            <div className="font-mono text-sm font-bold tabular-nums text-zinc-200">{status?.commandCount ?? 0}</div>
          </div>
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
            <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">
              <Coins className="h-3 w-3" /> last msg
            </div>
            <div className="font-mono text-sm font-bold tabular-nums text-zinc-200">
              {status?.lastMessageAt
                ? new Date(status.lastMessageAt).toLocaleTimeString([], { hour12: false })
                : '—'}
            </div>
          </div>
        </div>

        {errored && (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-900/50 bg-red-950/30 px-2.5 py-1.5 text-[10px] text-red-300">
            <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{status?.lastError}</span>
          </div>
        )}

        {/* credentials */}
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              Bot token <span className="text-zinc-600">(from @BotFather)</span>
            </span>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="123456:ABC-DEF…"
                spellCheck={false}
                autoComplete="off"
                className="h-8 border-zinc-800 bg-zinc-900/60 pr-8 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-700"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                aria-label={showToken ? 'Hide token' : 'Show token'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              Chat ID <span className="text-zinc-600">(leave empty → auto-detect on first message)</span>
            </span>
            <Input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value.replace(/[^0-9-]/g, ''))}
              placeholder="e.g. 123456789"
              spellCheck={false}
              className="h-8 border-zinc-800 bg-zinc-900/60 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-700"
            />
          </label>
        </div>

        {/* alert bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-400" /> signal alert bar</span>
            <span className="font-mono text-emerald-400">≥{minConf}%</span>
          </div>
          <input
            type="range" min={50} max={95} step={1}
            value={minConf}
            onChange={e => setMinConf(Number(e.target.value))}
            aria-label="Minimum confidence for Telegram signal alerts"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500"
          />
          <div className="mt-0.5 flex justify-between text-[8px] text-zinc-700">
            <span>50 · noisy</span><span>95 · rare</span>
          </div>
        </div>

        {/* notification toggles */}
        <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-2.5 py-2">
          <ToggleRow
            label="Signal alerts" hint={`confluence ≥ ${minConf}%`}
            checked={notifySignals} onChange={setNotifySignals}
          />
          <ToggleRow
            label="Trade alerts" hint="bot entries + settlements"
            checked={notifyTrades} onChange={setNotifyTrades}
          />
          <ToggleRow
            label="Status alerts" hint="bot start/stop & halts"
            checked={notifyStatus} onChange={setNotifyStatus}
          />
        </div>

        {/* commands cheatsheet */}
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            <Bot className="h-3 w-3" /> remote commands
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-400">
            <span><em className="not-italic text-emerald-400">/status</em> mode · bot · P/L</span>
            <span><em className="not-italic text-emerald-400">/balance</em> demo & real</span>
            <span><em className="not-italic text-emerald-400">/signals</em> last 5</span>
            <span><em className="not-italic text-emerald-400">/trades</em> last 5</span>
            <span><em className="not-italic text-emerald-400">/start</em> start bot</span>
            <span><em className="not-italic text-emerald-400">/stop</em> stop bot</span>
          </div>
        </div>

        {/* actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || !socketConnected || saving}
            onClick={saveAll}
            className="h-7 flex-1 border-zinc-700 bg-zinc-900 text-[11px] font-bold text-zinc-200 hover:border-emerald-700 hover:bg-emerald-950/40 hover:text-emerald-300 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Save config
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!(cfg?.token && cfg?.chatId) || !socketConnected}
            onClick={() => testTelegram()}
            className="h-7 border-zinc-700 bg-zinc-900 text-[11px] font-bold text-zinc-200 hover:border-amber-700 hover:bg-amber-950/40 hover:text-amber-300 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" /> Test
          </Button>
          <Button
            size="sm"
            disabled={!(cfg?.token && cfg?.chatId) || !socketConnected}
            onClick={() => save({ enabled: !enabled })}
            className={cn(
              'h-7 px-3 text-[11px] font-bold',
              enabled
                ? 'bg-red-900/80 text-red-100 hover:bg-red-800'
                : 'bg-emerald-700 text-white hover:bg-emerald-600'
            )}
          >
            {enabled ? 'Disable' : 'Enable'}
          </Button>
        </div>

        <p className="flex items-start gap-1 text-[9px] leading-relaxed text-zinc-600">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Create a bot with Telegram&apos;s @BotFather, paste its token here, then message the bot anything —
          the chat ID is detected automatically. The bridge long-polls Telegram from the trading engine
          (no webhook or public URL needed).
        </p>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-zinc-200">{label}</div>
        <div className="truncate text-[9px] text-zinc-600">{hint}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={`Toggle ${label}`}
        className="data-[state=checked]:bg-emerald-600"
      />
    </div>
  )
}
