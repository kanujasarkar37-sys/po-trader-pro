// ─── Shared types for the PO Trader service ────────────────────────────────

export interface Candle {
  time: number // unix seconds (candle open time)
  open: number
  high: number
  low: number
  close: number
}

export interface AssetInfo {
  asset: string
  name: string
  category: 'otc' | 'forex' | 'crypto' | 'commodity' | 'stock' | 'index' | 'synthetic'
  payout: number // percent, e.g. 92
  open: boolean
  price?: number
  changePct?: number
  digits?: number
  /** why a market is closed (weekend etc.) — shown in the UI */
  closedReason?: string
}

export interface SignalComponents {
  ema: number
  rsi: number
  stoch: number
  macd: number
  bollinger: number
  pattern: number
  sr: number
  momentum: number
  mtf: number // multi-timeframe (M5 trend alignment)
  htf: number // higher-timeframe (M15 macro trend, v5)
}

export interface Signal {
  id: string
  asset: string
  direction: 'call' | 'put'
  confidence: number // 0-100
  expirySeconds: number
  createdAt: number // ms
  entryAt: number // ms — recommended entry (candle open)
  expiresAt: number // ms
  price: number
  payout: number
  components: SignalComponents
  regime: 'trending' | 'ranging'
  reasons: string[]
  acted: boolean
}

export interface TradeRecord {
  id: string
  asset: string
  direction: 'call' | 'put'
  amount: number
  payout: number
  expirySeconds: number
  openPrice: number
  closePrice?: number
  openTime: number // ms
  closeTime?: number // ms
  status: 'open' | 'win' | 'loss' | 'draw'
  profit: number
  confidence: number
  isDemo: boolean
  requestId: string
  source: 'bot' | 'manual'
  // v8: signal snapshot attached at open time (in-memory; powers the
  // trade-detail dialog's component/reasons breakdown)
  signal?: { components: SignalComponents; reasons: string[]; regime: 'trending' | 'ranging' }
}

export interface BotConfig {
  ssid: string | null
  derivToken?: string | null
  serverRegion: string
  demoMode: boolean
  autoTrade: boolean
  tradeAmount: number
  minConfidence: number
  expirySeconds: number
  maxTrades: number
  maxConcurrent: number
  martingale: boolean
  mgFactor: number
  mgMaxSteps: number
  stopLoss: number
  takeProfit: number
  selectedAssets: string[]
  newsFilter: boolean
  dailyStopLoss: number // 0 = disabled — realized day P/L floor that halts the bot
  dailyProfitTarget: number // 0 = disabled — realized day P/L ceiling that halts the bot
  dynamicStake: boolean // confidence/payout-aware stake sizing (Kelly-lite)
  adaptiveThresholds: boolean // v6: auto-tune per-asset confidence from live results
}

export const DEFAULT_CONFIG: BotConfig = {
  ssid: null,
  serverRegion: 'api-l',
  demoMode: true,
  autoTrade: false,
  tradeAmount: 1,
  minConfidence: 65,
  expirySeconds: 60,
  maxTrades: 30,
  maxConcurrent: 2,
  martingale: false,
  mgFactor: 2,
  mgMaxSteps: 3,
  stopLoss: 50,
  takeProfit: 100,
  selectedAssets: ['EURUSD_otc', 'GBPUSD_otc', 'USDJPY_otc', 'AUDCAD_otc', 'EURGBP_otc', 'BTCUSD'],
  newsFilter: true,
  dailyStopLoss: 0,
  dailyProfitTarget: 0,
  dynamicStake: false,
  adaptiveThresholds: false,
}

export interface AdaptiveInfo {
  asset: string
  threshold: number // effective per-asset threshold (v6)
  baseThreshold: number
  winRate: number // win-rate of trades taken on this asset at/above base
  sampleSize: number // settled bot trades on this asset
  lastAdjustedAt: number
}

export interface ServiceStatus {
  mode: 'disconnected' | 'live' | 'simulation' | 'deriv'
  authenticated: boolean
  accountType: 'demo' | 'real'
  balance: number
  currency: string
  botRunning: boolean
  connectedAt: number | null
  serverRegion: string
  newsBias: Record<string, number> | null
  newsUpdatedAt: number | null
  /** Deriv mode details (null when not in deriv mode) */
  deriv?: {
    connected: boolean
    authorized: boolean
    streaming: boolean
    loginid: string | null
    isVirtual: boolean
    currency: string
    appId: string
    symbolsAvailable: number
    symbolsTotal: number
  }
}
