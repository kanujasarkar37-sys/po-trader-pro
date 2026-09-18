import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50, 200)
    const signals = await db.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return NextResponse.json({ signals })
  } catch (e) {
    return NextResponse.json({ signals: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    const signal = await db.signal.create({
      data: {
        asset: String(b.asset ?? ''),
        direction: b.direction === 'put' ? 'put' : 'call',
        confidence: Number(b.confidence ?? 0),
        expirySeconds: Number(b.expirySeconds ?? 60),
        indicators: String(b.indicators ?? '{}'),
        acted: !!b.acted,
      },
    })
    return NextResponse.json({ ok: true, id: signal.id })
  } catch (e) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }
}
