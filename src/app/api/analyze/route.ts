import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'

interface Body {
  asset: string
  direction?: string
  confidence?: number
  indicators?: {
    ema9?: number; ema21?: number; ema50?: number; rsi?: number; stochK?: number; stochD?: number
    macdHist?: number; bbUpper?: number; bbMid?: number; bbLower?: number; adx?: number; atr?: number
    pattern?: string; regime?: string
  }
  candles?: { time: number; open: number; high: number; low: number; close: number }[]
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    if (!body.asset) return NextResponse.json({ error: 'asset required' }, { status: 400 })

    const ind = body.indicators ?? {}
    const fmt = (v?: number) => (v != null && isFinite(v) ? v.toFixed(5) : 'n/a')

    // summarize recent price action from candles if provided
    let priceAction = ''
    if (body.candles?.length) {
      const cs = body.candles.slice(-30)
      const first = cs[0].close
      const last = cs[cs.length - 1].close
      const chgPct = ((last - first) / first) * 100
      let highs = 0, lows = 0
      for (const c of cs) {
        if (c.close > c.open) highs++
        else lows++
      }
      const hi = Math.max(...cs.map(c => c.high))
      const lo = Math.min(...cs.map(c => c.low))
      priceAction = `Last 30 M1 candles: ${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(3)}% move, ${highs} bullish / ${lows} bearish candles, range ${lo.toFixed(5)}–${hi.toFixed(5)}, last price ${last.toFixed(5)}.`
    }

    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: 'You are an expert binary options trading advisor analyzing 1-minute charts for Pocket Option. Be precise, honest about uncertainty, and never guarantee outcomes. Respond ONLY with valid JSON.',
        },
        {
          role: 'user',
          content: `Analyze ${body.asset} for a 1-minute binary options trade (CALL/PUT decision at candle open, 60s expiry, ~92% payout).

Technical snapshot:
- Regime: ${ind.regime ?? 'unknown'}
- EMA9 ${fmt(ind.ema9)}, EMA21 ${fmt(ind.ema21)}, EMA50 ${fmt(ind.ema50)}
- RSI(14) ${fmt(ind.rsi)}, Stoch K ${fmt(ind.stochK)} / D ${fmt(ind.stochD)}
- MACD histogram ${fmt(ind.macdHist)}
- Bollinger: upper ${fmt(ind.bbUpper)}, mid ${fmt(ind.bbMid)}, lower ${fmt(ind.bbLower)}
- ADX ${fmt(ind.adx)}, ATR ${fmt(ind.atr)}
- Last candle pattern: ${ind.pattern ?? 'n/a'}
${priceAction}
${body.confidence != null ? `Engine signal: ${body.direction?.toUpperCase()} with ${body.confidence}% confidence` : ''}

Return ONLY this JSON (no markdown):
{"bias":"bullish|bearish|neutral","agreement":"strong|moderate|weak","entry":"call|put|wait","reasoning":"3-4 short sentences citing the specific indicator readings","riskNote":"one sentence on key risk","levels":{"support":<number>,"resistance":<number>}}`,
        },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const cleaned = raw.replace(/```json|```/g, '').trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { bias: 'neutral', agreement: 'weak', entry: 'wait', reasoning: 'Analysis unavailable.', riskNote: '', levels: {} }
    }
    return NextResponse.json({ ok: true, analysis: parsed, asset: body.asset, generatedAt: Date.now() })
  } catch (e) {
    return NextResponse.json({ error: 'analysis failed' }, { status: 500 })
  }
}
