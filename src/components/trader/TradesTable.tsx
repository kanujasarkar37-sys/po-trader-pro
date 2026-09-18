'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useTrader, type TradeRecord } from './store'
import { TradeDetailDialog } from './TradeDetailDialog'
import { History, ListOrdered, TrendingUp, TrendingDown, Bot, Hand, Download, MousePointerClick } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function TradesTable() {
  const { trades } = useTrader()
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState<TradeRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const sorted = useMemo(() => [...trades].sort((a, b) => b.openTime - a.openTime), [trades])
  const open = sorted.filter(t => t.status === 'open')
  const closed = sorted.filter(t => t.status !== 'open')
  const list = tab === 'open' ? open : tab === 'closed' ? closed : sorted

  const exportCsv = () => {
    if (!sorted.length) {
      toast.info('No trades to export yet')
      return
    }
    const header = 'id,asset,direction,amount,payout,expiry_s,open_price,close_price,open_time,close_time,status,profit,confidence,is_demo,source'
    const rows = sorted.map(t => [
      t.id, t.asset, t.direction, t.amount, t.payout, t.expirySeconds,
      t.openPrice ?? '', t.closePrice ?? '',
      new Date(t.openTime).toISOString(), t.closeTime ? new Date(t.closeTime).toISOString() : '',
      t.status, t.profit, t.confidence, t.isDemo ? 1 : 0, t.source,
    ].join(','))
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `po-trader-trades-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${sorted.length} trades to CSV`)
  }

  const openDetail = (t: TradeRecord) => {
    setSelected(t)
    setDetailOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
          <ListOrdered className="h-3.5 w-3.5 text-emerald-500" />
          Trades
          <span
            className="hidden items-center gap-1 text-[9px] font-medium text-zinc-600 md:flex"
            title="Open the full breakdown — price path, signal components and reasons"
          >
            <MousePointerClick className="h-3 w-3" /> click a row
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-6 bg-zinc-900 p-0.5">
              <TabsTrigger value="all" className="h-5 px-2 text-[10px] font-semibold text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-200">
                All {sorted.length}
              </TabsTrigger>
              <TabsTrigger value="open" className="h-5 px-2 text-[10px] font-semibold text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-300">
                Open {open.length}
              </TabsTrigger>
              <TabsTrigger value="closed" className="h-5 px-2 text-[10px] font-semibold text-zinc-500 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-200">
                Settled {closed.length}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            variant="ghost"
            onClick={exportCsv}
            disabled={!sorted.length}
            className="h-6 w-6 p-0 text-zinc-500 hover:text-emerald-400"
            aria-label="Export trades as CSV"
            title="Export all trades to CSV"
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-zinc-950">
            <TableRow className="border-zinc-800/80 hover:bg-transparent">
              <TableHead className="h-7 text-[10px] font-bold uppercase text-zinc-500">Asset</TableHead>
              <TableHead className="h-7 text-[10px] font-bold uppercase text-zinc-500">Dir</TableHead>
              <TableHead className="h-7 text-right text-[10px] font-bold uppercase text-zinc-500">Amount</TableHead>
              <TableHead className="h-7 text-right text-[10px] font-bold uppercase text-zinc-500">Open @</TableHead>
              <TableHead className="h-7 text-right text-[10px] font-bold uppercase text-zinc-500">Close @</TableHead>
              <TableHead className="h-7 text-center text-[10px] font-bold uppercase text-zinc-500">Source</TableHead>
              <TableHead className="h-7 text-right text-[10px] font-bold uppercase text-zinc-500">P/L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-xs text-zinc-600">
                  <History className="mx-auto mb-1 h-6 w-6 text-zinc-800" />
                  No trades yet — manual trades or the bot will appear here
                </TableCell>
              </TableRow>
            )}
            {list.slice(0, 100).map((t) => (
              <TableRow
                key={t.id}
                role="button"
                tabIndex={0}
                aria-label={`Trade details: ${t.asset} ${t.direction} ${t.status}`}
                onClick={() => openDetail(t)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(t) } }}
                className="cursor-pointer border-zinc-900 outline-none focus-visible:bg-zinc-800/60 hover:bg-zinc-900/50"
              >
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-zinc-200">{t.asset}</span>
                    {t.isDemo ? (
                      <span className="rounded bg-emerald-950/50 px-1 text-[8px] font-bold text-emerald-500">DEMO</span>
                    ) : (
                      <span className="rounded bg-red-950/50 px-1 text-[8px] font-bold text-red-400">REAL</span>
                    )}
                  </div>
                  <span className="text-[9px] text-zinc-600">
                    {new Date(t.openTime).toLocaleTimeString([], { hour12: false })} · {t.expirySeconds}s
                  </span>
                </TableCell>
                <TableCell className="py-1.5">
                  <span className={cn(
                    'flex items-center gap-0.5 text-[11px] font-extrabold',
                    t.direction === 'call' ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {t.direction === 'call' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {t.direction.toUpperCase()}
                  </span>
                  {t.confidence > 0 && <span className="text-[9px] text-zinc-600">{t.confidence}%</span>}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-300">
                  ${t.amount.toFixed(2)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                  {t.openPrice?.toFixed(priceDigits(t.openPrice))}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                  {t.closePrice != null ? t.closePrice.toFixed(priceDigits(t.closePrice)) : '—'}
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="flex justify-center">
                    {t.source === 'bot'
                      ? <Bot className="h-3.5 w-3.5 text-emerald-500" title="Bot trade" />
                      : <Hand className="h-3.5 w-3.5 text-zinc-500" title="Manual trade" />}
                  </span>
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  {t.status === 'open' ? (
                    <Badge variant="outline" className="animate-pulse border-amber-800/60 bg-amber-950/40 px-1.5 text-[9px] font-bold text-amber-300">
                      OPEN
                    </Badge>
                  ) : (
                    <span className={cn(
                      'font-mono text-[11px] font-bold tabular-nums',
                      t.status === 'win' ? 'text-emerald-400' : t.status === 'loss' ? 'text-red-400' : 'text-zinc-400'
                    )}>
                      {t.profit > 0 ? '+' : ''}{t.profit.toFixed(2)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <TradeDetailDialog trade={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  )
}

function priceDigits(p: number): number {
  if (p >= 1000) return 1
  if (p >= 100) return 2
  if (p >= 2) return 3
  if (p >= 0.01) return 4
  return 5
}
