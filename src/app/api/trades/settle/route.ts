import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const status = ['win', 'loss', 'draw'].includes(b.status) ? b.status : 'open'
    await db.trade.update({
      where: { id: String(b.id) },
      data: {
        status,
        profit: Number(b.profit ?? 0),
        closePrice: b.closePrice != null ? Number(b.closePrice) : null,
        closeTime: b.closeTime ? new Date(b.closeTime) : new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }
}
