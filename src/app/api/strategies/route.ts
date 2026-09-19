import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseStrategy, type Strategy } from '@/lib/strategy-schema'

export const dynamic = 'force-dynamic'

// Raw-SQL persistence: the long-lived dev-server Prisma client may predate the
// Strategy model — $queryRaw/$executeRaw work across client generations (SQLite),
// so the API stays available without a server restart.
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

// GET /api/strategies — list saved strategies, newest first (max 100)
export async function GET() {
  try {
    const rows = await db.$queryRaw<StrategyRow[]>`
      SELECT id, name, description, author, rules, stats, createdAt
      FROM Strategy ORDER BY createdAt DESC LIMIT 100`
    const strategies = rows
      .map(rowToStrategy)
      .filter((s): s is Strategy => s !== null)
    return NextResponse.json({ ok: true, strategies })
  } catch (e) {
    console.error('[api/strategies] list failed:', e)
    return NextResponse.json({ ok: false, errors: ['Database unavailable'] }, { status: 500 })
  }
}

// POST /api/strategies — save (create, or upsert-by-id when strategy.id present)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { strategy?: unknown } | null
    const parsed = parseStrategy(body?.strategy)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 })
    }
    const s = parsed.strategy
    const id = s.id ?? crypto.randomUUID()
    const now = new Date()
    const rules = JSON.stringify(s.rules)
    const stats = JSON.stringify(s.stats ?? {})

    await db.$executeRaw`
      INSERT INTO Strategy (id, name, description, author, rules, stats, createdAt, updatedAt)
      VALUES (${id}, ${s.name}, ${s.description}, ${s.author}, ${rules}, ${stats}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET
        name = ${s.name}, description = ${s.description}, author = ${s.author},
        rules = ${rules}, stats = ${stats}, updatedAt = ${now}`

    const rows = await db.$queryRaw<StrategyRow[]>`
      SELECT id, name, description, author, rules, stats, createdAt
      FROM Strategy WHERE id = ${id}`
    const strategy = rows.length ? rowToStrategy(rows[0]) : null
    if (!strategy) {
      return NextResponse.json({ ok: false, errors: ['Failed to persist strategy'] }, { status: 500 })
    }
    return NextResponse.json({ ok: true, strategy })
  } catch (e) {
    console.error('[api/strategies] save failed:', e)
    return NextResponse.json({ ok: false, errors: ['Could not save strategy'] }, { status: 500 })
  }
}
