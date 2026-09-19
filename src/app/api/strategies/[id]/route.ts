import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseStrategy, type Strategy } from '@/lib/strategy-schema'

export const dynamic = 'force-dynamic'

// NOTE: route files may only export HTTP handlers — the row mapper is
// intentionally duplicated from ../route.ts (raw-SQL Strategy access).
interface StrategyRow {
  id: string
  name: string
  description: string | null
  author: string | null
  rules: string
  stats: string | null
  createdAt: Date | string
}

function rowToStrategy(row: StrategyRow): Strategy | null {
  try {
    const rules: unknown = JSON.parse(row.rules)
    let stats: Strategy['stats']
    try {
      const parsed: unknown = JSON.parse(row.stats || '{}')
      if (parsed && typeof parsed === 'object' && Object.keys(parsed as object).length) {
        stats = parsed as Strategy['stats']
      }
    } catch {
      stats = undefined
    }
    const strategy: Strategy = {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      author: row.author === 'ai' ? 'ai' : 'user',
      rules: rules as Strategy['rules'],
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    }
    if (stats) strategy.stats = stats
    return strategy
  } catch {
    return null
  }
}

// PUT /api/strategies/[id] — update an existing strategy
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { strategy?: unknown } | null
    const parsed = parseStrategy(body?.strategy)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 })
    }
    const s = parsed.strategy
    const now = new Date()
    const rules = JSON.stringify(s.rules)
    const stats = JSON.stringify(s.stats ?? {})
    const count = await db.$executeRaw`
      UPDATE Strategy SET
        name = ${s.name}, description = ${s.description}, author = ${s.author},
        rules = ${rules}, stats = ${stats}, updatedAt = ${now}
      WHERE id = ${id}`
    if (count === 0) {
      return NextResponse.json({ ok: false, errors: ['Strategy not found'] }, { status: 404 })
    }
    const rows = await db.$queryRaw<StrategyRow[]>`
      SELECT id, name, description, author, rules, stats, createdAt
      FROM Strategy WHERE id = ${id}`
    const strategy = rows.length ? rowToStrategy(rows[0]) : null
    if (!strategy) {
      return NextResponse.json({ ok: false, errors: ['Failed to persist strategy'] }, { status: 500 })
    }
    return NextResponse.json({ ok: true, strategy })
  } catch (e) {
    console.error('[api/strategies] update failed:', e)
    return NextResponse.json({ ok: false, errors: ['Could not update strategy'] }, { status: 500 })
  }
}

// DELETE /api/strategies/[id] — remove a strategy
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const count = await db.$executeRaw`DELETE FROM Strategy WHERE id = ${id}`
    if (count === 0) {
      return NextResponse.json({ ok: false, errors: ['Strategy not found'] }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/strategies] delete failed:', e)
    return NextResponse.json({ ok: false, errors: ['Could not delete strategy'] }, { status: 500 })
  }
}
