import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status')
    const source = sp.get('source')
    const limit = Math.min(parseInt(sp.get('limit') ?? '100', 10) || 100, 500)
    const where: Record<string, unknown> = {}
    if (status === 'settled') where.status = { in: ['win', 'loss', 'draw'] }
    else if (status) where.status = status
    if (source) where.source = source
    const trades = await db.trade.findMany({
      where,
      orderBy: { openTime: 'desc' },
      take: limit,
    })
    return NextResponse.json({ trades })
  } catch (e) {
    return NextResponse.json({ trades: [] }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const trade = await db.trade.create({
      data: {
        id: b.id ?? undefined,
        asset: String(b.asset ?? ''),
        direction: b.direction === 'put' ? 'put' : 'call',
        amount: Number(b.amount ?? 1),
        payout: Number(b.payout ?? 92),
        expirySeconds: Number(b.expirySeconds ?? 60),
        openPrice: b.openPrice != null ? Number(b.openPrice) : null,
        openTime: b.openTime ? new Date(b.openTime) : new Date(),
        status: 'open',
        confidence: Number(b.confidence ?? 0),
        isDemo: !!b.isDemo,
        requestId: b.requestId ? String(b.requestId) : null,
        source: b.source === 'manual' ? 'manual' : b.source === 'backtest' ? 'backtest' : 'bot',
      },
    })
    return NextResponse.json({ ok: true, id: trade.id })
  } catch (e) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }
}
