import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { parseStrategy, STRATEGY_DOCS, type Strategy } from '@/lib/strategy-schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface FeedCandle {
  time: number; open: number; high: number; low: number; close: number
}
interface GenerateBody {
  prompt?: string
  feed?: {
    asset?: string
    mode?: string
    recentCandles?: FeedCandle[]
    movers?: { asset: string; changePct: number }[]
    topSignal?: { asset: string; direction: string; confidence: number }
    winRate?: number
    trades?: number
  }
}

const fmtPrice = (n: number) =>
  n >= 1000 ? n.toFixed(1) : n >= 10 ? n.toFixed(3) : n.toFixed(5)

/** quick Wilder RSI over closes (proxy for the live regime) */
function quickRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let g = 0
  let l = 0
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1]
    if (ch > 0) g += ch
    else l -= ch
  }
  let ag = g / period
  let al = l / period
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1]
    ag = (ag * (period - 1) + Math.max(ch, 0)) / period
    al = (al * (period - 1) + Math.max(-ch, 0)) / period
  }
  if (al === 0) return ag === 0 ? 50 : 100
  return 100 - 100 / (1 + ag / al)
}

/** compact human-readable summary of the LIVE feed the AI strategizes against */
function summarizeFeed(feed: NonNullable<GenerateBody['feed']>): string {
  const parts: string[] = []
  parts.push(`- Asset: ${feed.asset || 'unknown'} (engine mode: ${feed.mode || 'unknown'})`)

  const cs = (feed.recentCandles ?? [])
    .filter((c) => c && [c.open, c.high, c.low, c.close].every((v) => typeof v === 'number' && Number.isFinite(v)) && c.open > 0)
    .slice(-120)

  if (cs.length >= 5) {
    const first = cs[0].close
    const lastC = cs[cs.length - 1].close
    const drift = ((lastC - first) / first) * 100
    let bull = 0
    let bear = 0
    for (const c of cs) {
      if (c.close > c.open) bull++
      else if (c.close < c.open) bear++
    }
    const hi = Math.max(...cs.map((c) => c.high))
    const lo = Math.min(...cs.map((c) => c.low))
    let trSum = 0
    for (let i = 1; i < cs.length; i++) {
      const pc = cs[i - 1].close
      const tr = Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - pc), Math.abs(cs[i].low - pc))
      trSum += tr / cs[i].close
    }
    const atrPct = (trSum / (cs.length - 1)) * 100
    const rsi = quickRsi(cs.map((c) => c.close))
    parts.push(
      `- Last ${cs.length} M1 candles: ${drift >= 0 ? '+' : ''}${drift.toFixed(3)}% drift, ` +
      `${bull} bullish / ${bear} bearish closes, range ${fmtPrice(lo)}–${fmtPrice(hi)}, last close ${fmtPrice(lastC)}`
    )
    parts.push(`- Volatility: avg true range ≈ ${atrPct.toFixed(4)}% of price per candle; RSI(14) ≈ ${rsi.toFixed(1)}`)
    parts.push(`- Recent closes: ${cs.slice(-12).map((c) => fmtPrice(c.close)).join(', ')}`)
    parts.push(`- Trend read: ${drift > 0.05 ? 'upward drift' : drift < -0.05 ? 'downward drift' : 'ranging'}; regime looks ${rsi > 60 ? 'overbought' : rsi < 40 ? 'oversold' : 'balanced'}`)
  } else {
    parts.push('- No live candles attached — design for general market conditions')
  }

  const movers = (feed.movers ?? []).slice(0, 5)
  if (movers.length) {
    parts.push(
      `- Top movers: ${movers.map((m) => `${m.asset} ${m.changePct >= 0 ? '+' : ''}${m.changePct?.toFixed?.(2) ?? '?'}%`).join(', ')}`
    )
  }

  if (feed.topSignal?.asset) {
    parts.push(
      `- Latest engine signal: ${feed.topSignal.asset} ${String(feed.topSignal.direction).toUpperCase()} @ ${feed.topSignal.confidence ?? '?'}% confidence`
    )
  }
  if (typeof feed.winRate === 'number' && Number.isFinite(feed.winRate) && typeof feed.trades === 'number') {
    parts.push(`- Bot performance right now: ${feed.winRate.toFixed(1)}% win rate over ${feed.trades} trades`)
  }
  return parts.join('\n')
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json|```/gi, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    /* fall through to brace extraction */
  }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
  return null
}

const SYSTEM_PROMPT = `You are an elite quantitative strategist who designs mechanical rule-based strategies for 60-second binary options (CALL/PUT) on 1-minute candles with a 92% payout — breakeven win rate 52.1%. Your strategies are executed by a strict backtest engine over REAL historical M1 candles: conditions are checked on a closed candle; if the CALL side matches, a trade opens at the OPEN of the next candle and settles at that candle's CLOSE. CALL wins iff close > open strictly, PUT wins iff close < open, equal prices = draw (stake returned). Design strategies that can realistically beat 52.1% win rate under these exact mechanics.

${STRATEGY_DOCS}

DESIGN SANITY RULES (your JSON is machine-validated — violations are rejected):
1. Conditions must be simultaneously achievable and coherent: e.g. CALL reversal: rsi < 32 AND stochK < 25; trend CALL: ema0 > ema1 AND macdHist > 0 AND rsi > 50. Never combine contradictory conditions (e.g. rsi < 30 with rsi > 70).
2. UNITS: rsi, stochK, stochD are 0-100 oscillators; close/open/high/low, bbUpper/bbMid/bbLower, ema0..ema3, macdHist are price-scale; bodyPct and atrPct are percentages. Only compare like with like (oscillator vs oscillator/constant, price vs price). Never compare a price against an oscillator value.
3. Mirror the PUT side where sensible (CALL: rsi < 32 ↔ PUT: rsi > 68; CALL: close < bbLower ↔ PUT: close > bbUpper).
4. Choose filters from the live feed volatility (atrPct): minAtrPct slightly BELOW current atrPct (skip dead/flat hours), maxAtrPct ~2-3× current atrPct (skip news spikes). Use trendAlign "ema50" for trend-following designs; omit it for mean-reversion.
5. Keep it tight: 2-4 conditions in "all" per side, optionally 1-2 small "any" groups as alternative triggers. More conditions = fewer but cleaner trades.
6. emaPeriods must be ordered shortest-first (ema0 = fastest). If conditions reference emaN, emaPeriods needs at least N+1 entries.
7. expirySeconds: 60 unless the user explicitly wants another value (30|120|300).
8. name: punchy, 3-60 chars. description: 1-3 sentences explaining the logic and ideal market conditions.
Respond with ONLY one valid JSON object matching the schema — no markdown fences, no commentary, no trailing text.`

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as GenerateBody | null
    const prompt = (body?.prompt ?? '').toString().trim().slice(0, 2000)
    if (prompt.length < 3) {
      return NextResponse.json({ ok: false, errors: ['prompt required (min 3 chars)'] }, { status: 400 })
    }
    const feed = body?.feed ?? {}

    const userMessage =
      `LIVE MARKET FEED (right now):\n${summarizeFeed(feed)}\n\n` +
      `USER REQUEST: "${prompt}"\n\n` +
      `Design the best strategy for this request, tuned to the live feed above. Return ONLY the JSON object.`

    const zai = await ZAI.create()
    const messages = [
      { role: 'assistant' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: userMessage },
    ]

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    let parsed = extractJson(raw)
    let validated = parsed ? parseStrategy(parsed) : ({ ok: false, errors: ['Model returned no parseable JSON'] } as const)

    // ONE retry with validation errors fed back to the model
    if (!validated.ok) {
      const retry = await zai.chat.completions.create({
        messages: [
          ...messages,
          { role: 'assistant' as const, content: raw || '(empty response)' },
          {
            role: 'user' as const,
            content:
              `Your previous output was rejected by the strategy validator:\n` +
              validated.errors.map((e) => `- ${e}`).join('\n') +
              `\n\nFix EVERY error and return ONLY a corrected, valid JSON strategy object (no markdown, no commentary).`,
          },
        ],
        thinking: { type: 'disabled' },
      })
      const raw2 = retry.choices[0]?.message?.content ?? ''
      parsed = extractJson(raw2)
      validated = parsed
        ? parseStrategy(parsed)
        : ({ ok: false, errors: ['Model returned no parseable JSON'] } as const)
    }

    if (!validated.ok) {
      return NextResponse.json({ ok: false, errors: validated.errors }, { status: 400 })
    }

    const strategy: Strategy = { ...validated.strategy, author: 'ai' }
    return NextResponse.json({ ok: true, strategy })
  } catch {
    return NextResponse.json(
      { ok: false, errors: ['AI generation failed — the model backend is unavailable right now'] },
      { status: 500 }
    )
  }
}
