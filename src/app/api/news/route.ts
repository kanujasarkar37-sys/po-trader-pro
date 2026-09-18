import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'

// In-memory cache (15 min) — shared across requests in this process
let cache: {
  bias: Record<string, number>
  highImpact: boolean
  headlines: { title: string; source: string; sentiment: string }[]
  summary: string
  updatedAt: number
  aiAvailable: boolean
} | null = null

const QUERIES = [
  'forex market news today USD EUR GBP JPY',
  'crypto market news today bitcoin ethereum',
  'gold oil commodity market news today',
]

export async function GET() {
  if (cache && Date.now() - cache.updatedAt < 15 * 60 * 1000) {
    return NextResponse.json({ ...cache, cached: true })
  }
  try {
    const zai = await ZAI.create()
    // gather headlines from multiple searches
    let searchFailures = 0
    const allResults: { name: string; host_name: string; snippet: string }[] = []
    for (const q of QUERIES) {
      try {
        const results = (await zai.functions.invoke('web_search', {
          query: q, num: 6, recency_days: 1,
        })) as { name: string; host_name: string; snippet: string }[]
        allResults.push(...(results ?? []))
      } catch { searchFailures++ /* one search failing shouldn't kill the route */ }
    }
    const aiAvailable = searchFailures < QUERIES.length
    if (!allResults.length) {
      if (cache) return NextResponse.json({ ...cache, cached: true, aiAvailable })
      return NextResponse.json({
        bias: {}, highImpact: false, headlines: [],
        summary: aiAvailable ? 'No news available right now.' : '',
        updatedAt: Date.now(), cached: false, aiAvailable,
      })
    }
    const headlinesText = allResults.slice(0, 18).map((r, i) => `${i + 1}. ${r.name} (${r.host_name}): ${r.snippet}`).join('\n')

    // LLM extracts structured trading bias
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: 'You are a professional forex/binary-options market analyst. Analyze the headlines and output ONLY valid JSON.',
        },
        {
          role: 'user',
          content: `Analyze these today's market headlines for binary options trading bias:\n\n${headlinesText}\n\nReturn ONLY this JSON shape (no markdown, no extra text):\n{"bias":{"USD":-1..1,"EUR":-1..1,"GBP":-1..1,"JPY":-1..1,"AUD":-1..1,"CAD":-1..1,"CHF":-1..1,"NZD":-1..1,"CRYPTO":-1..1,"GOLD":-1..1,"OIL":-1..1},"highImpact":set-true-ONLY-if-a-major-scheduled-event-is-happening-TODAY-FOMC-NFP-CPI-ECB-BOE-decision-or-major-geopolitical-shock-ordinary-market-commentary-is-NOT-high-impact,"summary":"2-3 sentence market overview","headlineSentiments":[{"title":"...","sentiment":"bullish|bearish|neutral"}]}\nBias: positive = currency strengthening (buy calls on strength), negative = weakening.`,
        },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const cleaned = raw.replace(/```json|```/g, '').trim()
    let parsed: {
      bias?: Record<string, number>
      highImpact?: boolean
      summary?: string
      headlineSentiments?: { title: string; sentiment: string }[]
    }
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = {}
    }
    // clamp bias values
    const bias: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed.bias ?? {})) {
      bias[k] = Math.max(-1, Math.min(1, Number(v) || 0))
    }
    const sentiments = parsed.headlineSentiments ?? []
    const headlines = allResults.slice(0, 12).map((r, i) => ({
      title: r.name,
      source: r.host_name,
      sentiment: sentiments[i]?.sentiment ?? 'neutral',
    }))
    cache = {
      bias,
      highImpact: !!parsed.highImpact,
      headlines,
      summary: parsed.summary ?? 'Market news analyzed.',
      updatedAt: Date.now(),
      aiAvailable,
    }
    return NextResponse.json({ ...cache, cached: false, aiAvailable })
  } catch {
    if (cache) return NextResponse.json({ ...cache, cached: true, aiAvailable: false })
    return NextResponse.json({
      bias: {}, highImpact: false, headlines: [], summary: '',
      updatedAt: Date.now(), cached: false, aiAvailable: false,
    })
  }
}
