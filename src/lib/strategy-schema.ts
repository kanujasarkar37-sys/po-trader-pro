// ─── Strategy JSON schema: types + validation + docs ────────────────────────
// Shared by: AI generation route (server), upload validation (client),
// CRUD API routes and the backtest engine. Pure functions, no DOM deps —
// safe to import from both server and client code.

export type CompareOp = '>' | '<' | '>=' | '<='

export interface StrategyCondition {
  left: string              // value identifier (VALUE_IDS)
  op: CompareOp
  right: string | number    // identifier or literal number
}

export interface StrategyRuleSet {
  emaPeriods: number[]      // 1-4 periods, each 5..200 (ema0..ema3 index into this)
  rsiPeriod: number         // 5..30
  bollingerPeriod: number   // 10..50
  bollingerMult: number     // 1..4
  stochK: number
  stochD: number
  atrPeriod: number         // 7..30
  macdFast: number
  macdSlow: number
  macdSignal: number
}

export interface StrategySide {
  all: StrategyCondition[]        // AND — every condition must hold
  any: StrategyCondition[][]      // OR — at least one group must fully hold ([] = ignore)
}

export interface StrategyFilters {
  minAtrPct?: number   // skip flat markets: (atr/price*100) must exceed this
  maxAtrPct?: number   // skip wild markets
  trendAlign?: 'none' | 'ema50' // 'ema50': CALL only above EMA50, PUT only below
}

export interface StrategyRules {
  indicators: StrategyRuleSet
  call: StrategySide
  put: StrategySide
  filters: StrategyFilters
  expirySeconds: number  // 30 | 60 | 120 | 300
}

export interface StrategyStats {
  trades?: number
  winRate?: number
  profit?: number
  asset?: string
  testedAt?: number
}

export interface Strategy {
  id?: string
  name: string            // 3..60 chars
  description: string     // <= 500 chars
  author: 'ai' | 'user'
  rules: StrategyRules
  createdAt?: string
  stats?: StrategyStats
}

// Identifiers usable in conditions (left side, or right side as identifier)
export const VALUE_IDS = [
  'rsi', 'stochK', 'stochD', 'macdHist',
  'bbUpper', 'bbMid', 'bbLower',
  'close', 'open', 'high', 'low',
  'bodyPct', 'atrPct',
  'ema0', 'ema1', 'ema2', 'ema3',
] as const

const VALUE_ID_SET = new Set<string>(VALUE_IDS)
const OPS: CompareOp[] = ['>', '<', '>=', '<=']
const EXPIRY_ALLOWED = [30, 60, 120, 300]

// Hard caps (spec): all ≤ 8 conds · any ≤ 4 groups × 4 conds
const MAX_ALL = 8
const MAX_ANY_GROUPS = 4
const MAX_ANY_GROUP_CONDS = 4

export const STRATEGY_DOCS = `STRATEGY JSON SCHEMA — binary options CALL/PUT rule engine (M1 candles, 92% payout, breakeven win rate 52.1%):
{
  "name": string (3-60 chars),
  "description": string (<=500 chars, how it works),
  "author": "ai",
  "rules": {
    "indicators": {
      "emaPeriods": number[] (1-4 periods, each 5-200; ema0..ema3 in conditions reference these BY INDEX, shortest first),
      "rsiPeriod": number (5-30),
      "bollingerPeriod": number (10-50),
      "bollingerMult": number (1-4),
      "stochK": number (3-30, %K lookback),
      "stochD": number (3-30, %D smoothing of %K),
      "atrPeriod": number (7-30),
      "macdFast": number (2-30), "macdSlow": number (5-60, must exceed macdFast), "macdSignal": number (2-30)
    },
    "call": { "all": Cond[], "any": Cond[][] },
    "put":  { "all": Cond[], "any": Cond[][] },
    "filters": { "minAtrPct"?: number, "maxAtrPct"?: number, "trendAlign"?: "none"|"ema50" },
    "expirySeconds": 30|60|120|300
  }
}
Cond = { "left": IDENT, "op": ">"|"<"|">="|"<=", "right": IDENT | number }
- "all" = AND list (max 8). "any" = OR-groups (max 4 groups × 4 conds); at least one group must fully match; empty "any" = ignored.
- IDENT values: rsi (0-100), stochK (0-100), stochD (0-100) are oscillators; macdHist, bbUpper, bbMid, bbLower, close, open, high, low, ema0..ema3 are price-scale; bodyPct (|close-open|/open*100) and atrPct (ATR/price*100) are percent volatility measures.
- UNITS MATTER: only compare oscillator-vs-oscillator/constant (e.g. rsi < 30) or price-vs-price (e.g. close < bbLower, ema0 > ema1). Never mix price-scale with 0-100 oscillators.
- Backtest semantics: conditions are evaluated on CLOSED candle i; entry at open of candle i+1; settlement at close of candle i+1 (CALL wins iff close > open strictly; PUT wins iff close < open; equal = draw/stake returned).
- filters: minAtrPct skips flat markets (atrPct must exceed it), maxAtrPct skips wild markets, trendAlign "ema50" allows CALL only when close > EMA50 and PUT only when close < EMA50.
- expirySeconds is the recommended live expiry; the historical backtest always settles on the next 1-minute candle.`

// ─── helpers ────────────────────────────────────────────────────────────────

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clampInt = (v: number, lo: number, hi: number) => Math.round(clampNum(v, lo, hi))

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toFinite(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** "rsi < 30" / "ema0 > ema1" — display helper shared by UI surfaces */
export function formatCondition(c: StrategyCondition): string {
  return `${c.left} ${c.op} ${typeof c.right === 'number' ? trimNum(c.right) : c.right}`
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)))
}

/** identifier valid AND ema index in range of configured periods */
function validIdentifier(id: unknown, emaCount: number): boolean {
  if (typeof id !== 'string') return false
  if (!VALUE_ID_SET.has(id)) return false
  if (id.startsWith('ema')) {
    const idx = Number(id.slice(3))
    if (!Number.isInteger(idx) || idx < 0 || idx >= emaCount) return false
  }
  return true
}

// ─── condition sanitizer ────────────────────────────────────────────────────

function parseCondition(
  raw: unknown,
  emaCount: number,
  errors: string[],
  path: string
): StrategyCondition | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: condition must be an object`)
    return null
  }
  const left = typeof raw.left === 'string' ? raw.left.trim() : ''
  if (!validIdentifier(left, emaCount)) {
    const emaMatch = /^ema(\d)$/.exec(left)
    const hint = emaMatch
      ? ` (${left} needs emaPeriods with at least ${Number(emaMatch[1]) + 1} entries)`
      : ''
    errors.push(
      `${path}: unknown identifier "${String(raw.left)}"${hint} — allowed: ${VALUE_IDS.join(', ')}`
    )
    return null
  }
  if (raw.op !== undefined && !OPS.includes(raw.op as CompareOp)) {
    errors.push(`${path}: op must be one of > < >= <= (got "${String(raw.op)}")`)
    return null
  }
  const op = (raw.op ?? '>') as CompareOp
  // right: identifier | number | numeric string
  let right: string | number
  if (typeof raw.right === 'number' && Number.isFinite(raw.right)) {
    right = raw.right
  } else if (typeof raw.right === 'string' && raw.right.trim() !== '') {
    const rstr = raw.right.trim()
    if (VALUE_ID_SET.has(rstr)) {
      if (!validIdentifier(rstr, emaCount)) {
        errors.push(`${path}: right identifier "${rstr}" is an emaN without a matching emaPeriod`)
        return null
      }
      right = rstr
    } else {
      const n = Number(rstr)
      if (!Number.isFinite(n)) {
        errors.push(`${path}: right must be an identifier or number (got "${rstr}")`)
        return null
      }
      right = n
    }
  } else {
    errors.push(`${path}: right must be an identifier or number`)
    return null
  }
  return { left, op, right }
}

function parseSide(
  raw: unknown,
  emaCount: number,
  errors: string[],
  path: string
): StrategySide {
  const side: StrategySide = { all: [], any: [] }
  if (raw == null) return side
  if (!isRecord(raw)) {
    errors.push(`${path}: must be an object { all, any }`)
    return side
  }
  if (Array.isArray(raw.all)) {
    for (const c of raw.all.slice(0, MAX_ALL)) {
      const cond = parseCondition(c, emaCount, errors, `${path}.all`)
      if (cond) side.all.push(cond)
    }
  } else if (raw.all != null) {
    errors.push(`${path}.all must be an array`)
  }
  if (Array.isArray(raw.any)) {
    for (const g of raw.any.slice(0, MAX_ANY_GROUPS)) {
      if (!Array.isArray(g)) {
        errors.push(`${path}.any group must be an array`)
        continue
      }
      const group: StrategyCondition[] = []
      for (const c of g.slice(0, MAX_ANY_GROUP_CONDS)) {
        const cond = parseCondition(c, emaCount, errors, `${path}.any[]`)
        if (cond) group.push(cond)
      }
      if (group.length) side.any.push(group)
    }
  } else if (raw.any != null) {
    errors.push(`${path}.any must be an array of arrays`)
  }
  return side
}

// ─── indicator set sanitizer ────────────────────────────────────────────────

function parseIndicators(raw: unknown, errors: string[]): StrategyRuleSet {
  const src = isRecord(raw) ? raw : {}
  let emaPeriods: number[] = []
  if (Array.isArray(src.emaPeriods)) {
    emaPeriods = src.emaPeriods
      .map((p) => toFinite(p))
      .filter((p): p is number => p != null)
      .map((p) => clampInt(p, 5, 200))
      .filter((p, i, arr) => arr.indexOf(p) === i) // dedupe
      .slice(0, 4)
      .sort((a, b) => a - b)
  }
  if (!emaPeriods.length) emaPeriods = [9, 21, 50] // sane default

  let macdFast = clampInt(toFinite(src.macdFast) ?? 12, 2, 30)
  let macdSlow = clampInt(toFinite(src.macdSlow) ?? 26, 5, 60)
  if (macdSlow <= macdFast) {
    // sanitize: slow must exceed fast — swap rather than reject
    const f = macdFast
    macdFast = Math.min(macdSlow, 30)
    macdSlow = Math.max(f + 1, 5)
  }
  return {
    emaPeriods,
    rsiPeriod: clampInt(toFinite(src.rsiPeriod) ?? 14, 5, 30),
    bollingerPeriod: clampInt(toFinite(src.bollingerPeriod) ?? 20, 10, 50),
    bollingerMult: Math.round(clampNum(toFinite(src.bollingerMult) ?? 2, 1, 4) * 10) / 10,
    stochK: clampInt(toFinite(src.stochK) ?? 14, 3, 30),
    stochD: clampInt(toFinite(src.stochD) ?? 3, 3, 30),
    atrPeriod: clampInt(toFinite(src.atrPeriod) ?? 14, 7, 30),
    macdFast,
    macdSlow,
    macdSignal: clampInt(toFinite(src.macdSignal) ?? 9, 2, 30),
  }
}

function parseFilters(raw: unknown, errors: string[]): StrategyFilters {
  const src = isRecord(raw) ? raw : {}
  const filters: StrategyFilters = {}
  const min = toFinite(src.minAtrPct)
  const max = toFinite(src.maxAtrPct)
  if (min != null) filters.minAtrPct = Math.round(clampNum(min, 0, 10) * 100) / 100
  if (max != null) filters.maxAtrPct = Math.round(clampNum(max, 0, 10) * 100) / 100
  if (filters.minAtrPct != null && filters.maxAtrPct != null && filters.minAtrPct > filters.maxAtrPct) {
    errors.push('rules.filters: minAtrPct cannot exceed maxAtrPct')
  }
  if (src.trendAlign != null && src.trendAlign !== 'none' && src.trendAlign !== 'ema50') {
    errors.push('rules.filters.trendAlign must be "none" or "ema50"')
  } else if (src.trendAlign === 'ema50') {
    filters.trendAlign = 'ema50'
  }
  return filters
}

function parseStats(raw: unknown): StrategyStats | undefined {
  if (!isRecord(raw)) return undefined
  const s: StrategyStats = {}
  const trades = toFinite(raw.trades)
  if (trades != null) s.trades = Math.max(0, Math.round(trades))
  const wr = toFinite(raw.winRate)
  if (wr != null) s.winRate = Math.round(clampNum(wr, 0, 100) * 10) / 10
  const profit = toFinite(raw.profit)
  if (profit != null) s.profit = Math.round(profit * 100) / 100
  if (typeof raw.asset === 'string' && raw.asset.trim()) s.asset = raw.asset.trim().slice(0, 30)
  const testedAt = toFinite(raw.testedAt)
  if (testedAt != null) s.testedAt = Math.round(testedAt)
  return Object.keys(s).length ? s : undefined
}

// ─── main validator ─────────────────────────────────────────────────────────

/**
 * Validate + sanitize any unknown payload into a Strategy.
 * - structural problems (bad identifiers, bad op, bad types) → { ok: false, errors }
 * - out-of-range numbers are CLAMPED silently; arrays are capped at schema limits
 */
export function parseStrategy(input: unknown): { ok: true; strategy: Strategy } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['Strategy must be a JSON object'] }
  }

  // name (required, 3..60)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 3 || name.length > 60) {
    errors.push(`name must be 3-60 characters (got ${name.length ? `"${name}"` : 'empty'})`)
  }

  // description (optional, truncate at 500)
  const description =
    typeof input.description === 'string' ? input.description.trim().slice(0, 500) : ''

  // author
  const author: 'ai' | 'user' = input.author === 'ai' ? 'ai' : 'user'

  const rawRules = isRecord(input.rules) ? input.rules : null
  if (!rawRules) {
    return { ok: false, errors: [...errors, 'rules object is required'] }
  }

  const indicators = parseIndicators(rawRules.indicators, errors)
  const call = parseSide(rawRules.call, indicators.emaPeriods.length, errors, 'rules.call')
  const put = parseSide(rawRules.put, indicators.emaPeriods.length, errors, 'rules.put')
  const filters = parseFilters(rawRules.filters, errors)

  if (!call.all.length && !call.any.length && !put.all.length && !put.any.length) {
    errors.push('strategy needs at least one CALL or PUT condition')
  }

  // expiry
  const expiryRaw = toFinite(rawRules.expirySeconds) ?? 60
  const expirySeconds = EXPIRY_ALLOWED.includes(Math.round(expiryRaw)) ? Math.round(expiryRaw) : 60

  if (errors.length) return { ok: false, errors }

  const strategy: Strategy = {
    id: typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(input.id) ? input.id : undefined,
    name,
    description,
    author,
    rules: { indicators, call, put, filters, expirySeconds },
  }
  if (typeof input.createdAt === 'string') strategy.createdAt = input.createdAt
  const stats = parseStats(input.stats)
  if (stats) strategy.stats = stats
  return { ok: true, strategy }
}
