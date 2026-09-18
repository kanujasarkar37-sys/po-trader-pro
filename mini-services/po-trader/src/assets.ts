// ─── Pocket Option asset universe (static fallback + display names) ────────
// The live connection enriches this with real payouts via updateAssets.

interface RawAsset {
  asset: string
  name: string
  category: 'otc' | 'forex' | 'crypto' | 'commodity' | 'stock' | 'index'
  payout: number
  basePrice: number
  vol: number // volatility factor for simulation
  digits: number
}

export const ASSET_UNIVERSE: RawAsset[] = [
  // ── OTC currency pairs (24/7) ──
  { asset: 'EURUSD_otc', name: 'EUR/USD OTC', category: 'otc', payout: 92, basePrice: 1.0856, vol: 0.00012, digits: 5 },
  { asset: 'GBPUSD_otc', name: 'GBP/USD OTC', category: 'otc', payout: 92, basePrice: 1.2712, vol: 0.00015, digits: 5 },
  { asset: 'USDJPY_otc', name: 'USD/JPY OTC', category: 'otc', payout: 92, basePrice: 148.32, vol: 0.018, digits: 3 },
  { asset: 'USDCHF_otc', name: 'USD/CHF OTC', category: 'otc', payout: 92, basePrice: 0.8792, vol: 0.0001, digits: 5 },
  { asset: 'USDCAD_otc', name: 'USD/CAD OTC', category: 'otc', payout: 92, basePrice: 1.3588, vol: 0.00014, digits: 5 },
  { asset: 'AUDUSD_otc', name: 'AUD/USD OTC', category: 'otc', payout: 92, basePrice: 0.6582, vol: 0.00012, digits: 5 },
  { asset: 'AUDCAD_otc', name: 'AUD/CAD OTC', category: 'otc', payout: 92, basePrice: 0.8941, vol: 0.0001, digits: 5 },
  { asset: 'AUDJPY_otc', name: 'AUD/JPY OTC', category: 'otc', payout: 92, basePrice: 97.58, vol: 0.015, digits: 3 },
  { asset: 'AUDNZD_otc', name: 'AUD/NZD OTC', category: 'otc', payout: 92, basePrice: 1.0821, vol: 0.0001, digits: 5 },
  { asset: 'CADJPY_otc', name: 'CAD/JPY OTC', category: 'otc', payout: 92, basePrice: 109.12, vol: 0.015, digits: 3 },
  { asset: 'CHFJPY_otc', name: 'CHF/JPY OTC', category: 'otc', payout: 92, basePrice: 168.61, vol: 0.02, digits: 3 },
  { asset: 'EURAUD_otc', name: 'EUR/AUD OTC', category: 'otc', payout: 92, basePrice: 1.6498, vol: 0.00018, digits: 5 },
  { asset: 'EURCAD_otc', name: 'EUR/CAD OTC', category: 'otc', payout: 92, basePrice: 1.4746, vol: 0.00015, digits: 5 },
  { asset: 'EURGBP_otc', name: 'EUR/GBP OTC', category: 'otc', payout: 92, basePrice: 0.8538, vol: 0.00008, digits: 5 },
  { asset: 'EURJPY_otc', name: 'EUR/JPY OTC', category: 'otc', payout: 92, basePrice: 160.94, vol: 0.02, digits: 3 },
  { asset: 'EURNZD_otc', name: 'EUR/NZD OTC', category: 'otc', payout: 92, basePrice: 1.7832, vol: 0.0002, digits: 5 },
  { asset: 'GBPAUD_otc', name: 'GBP/AUD OTC', category: 'otc', payout: 92, basePrice: 1.9315, vol: 0.00022, digits: 5 },
  { asset: 'GBPCAD_otc', name: 'GBP/CAD OTC', category: 'otc', payout: 92, basePrice: 1.7275, vol: 0.0002, digits: 5 },
  { asset: 'GBPCHF_otc', name: 'GBP/CHF OTC', category: 'otc', payout: 92, basePrice: 1.1172, vol: 0.00013, digits: 5 },
  { asset: 'GBPJPY_otc', name: 'GBP/JPY OTC', category: 'otc', payout: 92, basePrice: 188.42, vol: 0.025, digits: 3 },
  { asset: 'GBPNZD_otc', name: 'GBP/NZD OTC', category: 'otc', payout: 92, basePrice: 2.0905, vol: 0.00025, digits: 5 },
  { asset: 'NZDJPY_otc', name: 'NZD/JPY OTC', category: 'otc', payout: 92, basePrice: 90.18, vol: 0.014, digits: 3 },
  { asset: 'NZDUSD_otc', name: 'NZD/USD OTC', category: 'otc', payout: 92, basePrice: 0.6082, vol: 0.00011, digits: 5 },
  { asset: 'USDSGD_otc', name: 'USD/SGD OTC', category: 'otc', payout: 90, basePrice: 1.3452, vol: 0.00009, digits: 5 },
  // ── Live forex majors ──
  { asset: 'EURUSD', name: 'EUR/USD', category: 'forex', payout: 85, basePrice: 1.0862, vol: 0.00012, digits: 5 },
  { asset: 'GBPUSD', name: 'GBP/USD', category: 'forex', payout: 85, basePrice: 1.2705, vol: 0.00015, digits: 5 },
  { asset: 'USDJPY', name: 'USD/JPY', category: 'forex', payout: 85, basePrice: 148.45, vol: 0.018, digits: 3 },
  { asset: 'USDCHF', name: 'USD/CHF', category: 'forex', payout: 85, basePrice: 0.8788, vol: 0.0001, digits: 5 },
  { asset: 'AUDUSD', name: 'AUD/USD', category: 'forex', payout: 85, basePrice: 0.6578, vol: 0.00012, digits: 5 },
  { asset: 'USDCAD', name: 'USD/CAD', category: 'forex', payout: 85, basePrice: 1.3592, vol: 0.00014, digits: 5 },
  { asset: 'NZDUSD', name: 'NZD/USD', category: 'forex', payout: 85, basePrice: 0.6085, vol: 0.00011, digits: 5 },
  { asset: 'EURJPY', name: 'EUR/JPY', category: 'forex', payout: 85, basePrice: 161.02, vol: 0.02, digits: 3 },
  { asset: 'GBPJPY', name: 'GBP/JPY', category: 'forex', payout: 85, basePrice: 188.55, vol: 0.025, digits: 3 },
  // ── Crypto ──
  { asset: 'BTCUSD', name: 'Bitcoin', category: 'crypto', payout: 92, basePrice: 67450, vol: 45, digits: 2 },
  { asset: 'ETHUSD', name: 'Ethereum', category: 'crypto', payout: 92, basePrice: 3280, vol: 3.2, digits: 2 },
  { asset: 'LTCUSD', name: 'Litecoin', category: 'crypto', payout: 90, basePrice: 84.2, vol: 0.12, digits: 2 },
  { asset: 'XRPUSD', name: 'Ripple', category: 'crypto', payout: 90, basePrice: 0.5230, vol: 0.0009, digits: 4 },
  { asset: 'BNBUSD', name: 'BNB', category: 'crypto', payout: 88, basePrice: 592.4, vol: 0.8, digits: 2 },
  { asset: 'DOGEUSD', name: 'Dogecoin', category: 'crypto', payout: 88, basePrice: 0.1582, vol: 0.0004, digits: 5 },
  { asset: 'SOLUSD', name: 'Solana', category: 'crypto', payout: 88, basePrice: 148.6, vol: 0.35, digits: 2 },
  { asset: 'ADAUSD', name: 'Cardano', category: 'crypto', payout: 88, basePrice: 0.4520, vol: 0.0011, digits: 4 },
  // ── Commodities ──
  { asset: 'GOLD', name: 'Gold', category: 'commodity', payout: 87, basePrice: 2338.5, vol: 1.6, digits: 2 },
  { asset: 'SILVER', name: 'Silver', category: 'commodity', payout: 87, basePrice: 27.42, vol: 0.04, digits: 3 },
  { asset: 'OIL', name: 'Brent Oil', category: 'commodity', payout: 86, basePrice: 82.35, vol: 0.12, digits: 2 },
  { asset: 'PLATINUM', name: 'Platinum', category: 'commodity', payout: 85, basePrice: 968.2, vol: 1.4, digits: 2 },
  { asset: 'COPPER', name: 'Copper', category: 'commodity', payout: 85, basePrice: 4.284, vol: 0.008, digits: 3 },
  // ── Stocks ──
  { asset: 'AAPL', name: 'Apple', category: 'stock', payout: 82, basePrice: 214.2, vol: 0.25, digits: 2 },
  { asset: 'TSLA', name: 'Tesla', category: 'stock', payout: 82, basePrice: 248.5, vol: 0.5, digits: 2 },
  { asset: 'AMZN', name: 'Amazon', category: 'stock', payout: 82, basePrice: 183.6, vol: 0.35, digits: 2 },
  { asset: 'GOOGL', name: 'Alphabet', category: 'stock', payout: 82, basePrice: 176.4, vol: 0.35, digits: 2 },
  { asset: 'META', name: 'Meta', category: 'stock', payout: 82, basePrice: 478.2, vol: 1.1, digits: 2 },
  { asset: 'MSFT', name: 'Microsoft', category: 'stock', payout: 82, basePrice: 428.8, vol: 0.6, digits: 2 },
  { asset: 'NFLX', name: 'Netflix', category: 'stock', payout: 82, basePrice: 612.4, vol: 1.5, digits: 2 },
  { asset: 'INTC', name: 'Intel', category: 'stock', payout: 82, basePrice: 30.85, vol: 0.09, digits: 2 },
  // ── Indices ──
  { asset: 'SP500', name: 'S&P 500', category: 'index', payout: 84, basePrice: 5488.2, vol: 3.5, digits: 1 },
  { asset: 'NASDAQ', name: 'Nasdaq 100', category: 'index', payout: 84, basePrice: 19682.5, vol: 18, digits: 1 },
  { asset: 'DJI30', name: 'Dow Jones', category: 'index', payout: 84, basePrice: 39120.4, vol: 22, digits: 1 },
  { asset: 'DAX30', name: 'DAX', category: 'index', payout: 84, basePrice: 18342.6, vol: 15, digits: 1 },
]

export function assetName(a: string): string {
  const found = ASSET_UNIVERSE.find(x => x.asset === a)
  if (found) return found.name
  return a.replace('_otc', ' OTC').replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2')
}

export function assetCategory(a: string): string {
  const found = ASSET_UNIVERSE.find(x => x.asset === a)
  return found ? found.category : 'otc'
}

export function assetDigits(a: string): number {
  const found = ASSET_UNIVERSE.find(x => x.asset === a)
  return found ? found.digits : 5
}

export function assetBasePrice(a: string): number {
  const found = ASSET_UNIVERSE.find(x => x.asset === a)
  return found ? found.basePrice : 1
}

export function assetVol(a: string): number {
  const found = ASSET_UNIVERSE.find(x => x.asset === a)
  return found ? found.vol : 0.0001
}

export const DEFAULT_PAYOUT = 92
