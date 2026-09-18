import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    let config = await db.botConfig.findUnique({ where: { id: 'main' } })
    if (!config) {
      config = await db.botConfig.create({ data: { id: 'main' } })
    }
    const { id, createdAt, updatedAt, ...rest } = config
    return NextResponse.json({ ...rest, id: undefined, updatedAt: undefined })
  } catch (e) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const data: Record<string, unknown> = {}
    const fields = [
      'ssid', 'serverRegion', 'demoMode', 'autoTrade', 'tradeAmount', 'minConfidence',
      'expirySeconds', 'maxTrades', 'maxConcurrent', 'martingale', 'mgFactor', 'mgMaxSteps',
      'stopLoss', 'takeProfit', 'selectedAssets', 'newsFilter',
      'dailyStopLoss', 'dailyProfitTarget', 'dynamicStake', 'adaptiveThresholds',
    ]
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f]
    }
    const config = await db.botConfig.upsert({
      where: { id: 'main' },
      update: data,
      create: { id: 'main', ...data },
    })
    const { id, createdAt, updatedAt, ...rest } = config
    return NextResponse.json({ ok: true, ...rest })
  } catch (e) {
    return NextResponse.json({ error: 'db error' }, { status: 500 })
  }
}

// route-reload marker v6
