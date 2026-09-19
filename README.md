# PO Trader Pro

**A full-stack auto-trading bot + signal terminal for Deriv AND Pocket Option.**

One Next.js app ships the entire stack: a real-time trading terminal, a
10-component confluence signal engine, a bot that trades automatically
(paper, simulated **or** live on two platforms), an **AI Strategy Lab** that
generates and backtests custom strategies, interactive zoom/pan charts, market
news/AI analysis, a Telegram remote-control bridge — all deployable to Render
with one click.

> [!WARNING]
> Trading involves substantial risk. Binary options are high-risk instruments —
> **you can lose money quickly**. Use paper mode or the simulator first, start
> with a demo account, and never risk money you cannot afford to lose. The
> Pocket Option integration is **unofficial** (reverse-engineered endpoints) and
> provided **as-is, without any warranty** (see LICENSE).

---

## Features

| Area | What you get |
|---|---|
| **Two live platforms** | **Deriv — live market** (free, no API key: 60+ symbols — forex majors, crypto, commodities, stock indices, plus **synthetic indices trading 24/7**; optional API token trades your real Deriv demo/real account) · **Pocket Option** via SSID cookie (demo + real, **forex OTC pairs open on weekends**) |
| **Paper trading** | Deriv mode without a token = real live market data with simulated funds — full bot, signals and settlement on real prices |
| **Market hours aware** | Forex/commodities close on weekends (clearly flagged in the UI); synthetics & crypto trade 24/7; closed markets are excluded from bot scans automatically |
| **Signal engine (v9)** | 10 weighted components — EMA stack, RSI (+divergence), Stochastic, MACD, Bollinger, candlestick patterns, fractal S/R (+wick-rejection quality), momentum, M5 multi-timeframe, M15 macro veto — with trending/ranging **regime detection** that re-weights every component |
| **Accuracy guardrails** | Bollinger-squeeze block, dead-market filter, DI directional confirmation, ATR overextension (chase-risk) fade, payout-adjusted edge gate, **per-asset adaptive thresholds** learned from live results, empirical win-rate blending into the edge estimate |
| **Precise settlement** | Paper/sim trades settle against the last price **at the expiry moment**; authorized Deriv trades settle with the **real contract result** from Deriv's servers |
| **AI Strategy Lab** | **AI generates complete strategies** from a prompt (fed with the live market feed — trend, volatility, movers, bot stats), **upload your own strategies** as JSON, and **real backtests** over up to 2000 real candles with equity curve, drawdown, streaks and hourly breakdown |
| **Interactive chart** | Zoom (wheel/pinch/buttons), pan through 2000 candles of history (drag), crosshair + OHLC readout, EMA/Bollinger overlays, volume, RSI/activity subpanels, trade markers, double-click back to live |
| **Top movers** | Real-time ranking by absolute price change across the whole symbol universe (real Deriv data in deriv mode) |
| **Auto-trade bot** | Confidence threshold, stake sizing, Kelly-lite dynamic staking, martingale (optional), per-asset cooldowns, max trades/concurrent, stop-loss / take-profit, **daily loss limits**, red-zone (news) pause |
| **Terminal UI** | Market watch with sparklines + market-hours badges, live signals feed, trades table with per-trade signal breakdown, analytics + calibration charts, backtesting, news, economic calendar, AI advisor, settings hub (Telegram/alerts/engine), activity log, keyboard shortcuts |
| **Telegram bridge** | Remote `/start /stop /status /balance /signals /trades /ping` commands + instant trade/signal alerts — configured in **Settings** |
| **Persistence** | SQLite via Prisma — config, trades, signals, strategies survive restarts; auto-reconnects to your last platform; adaptive memory warm-loads from history |

## Architecture

```
┌────────────────────────────────────────────────────┐
│              One process, one port                 │
│                                                    │
│  Next.js (React UI + /api routes + Prisma)         │
│        │                                           │
│        ├── /            → dashboard                │
│        ├── /api/*       → config/trades/signals/…  │
│        ├── /engine/*    → trading engine (socket.io)│
│        └── /healthz     → health check             │
│                                                    │
│  Trading engine: PO websocket / simulator →        │
│  candles (2000/asset) → signal engine → bot →      │
│  settlement → Prisma persistence                   │
└────────────────────────────────────────────────────┘
```

- **Web + engine in one deployable** (`server.ts` consolidates both; the
  engine's socket.io attaches at `/engine`).
- The engine can also run **standalone on :3030** for two-process development.

## Deploy to Render (easiest)

1. Push this repo to GitHub (or fork it).
2. On [Render](https://render.com) → **New → Blueprint** → select the repo.
   The included [`render.yaml`](./render.yaml) configures everything (Docker
   image, `/healthz` health check, env vars).
3. Open the deployed URL → **Start Simulation** to explore, or connect your
   Pocket Option SSID for live trading.

> **Two Render tips**
> - Free instances sleep after 15 min idle — pick a **Starter** plan (or ping
>   `/healthz` on a schedule) so the bot stays alive.
> - SQLite lives inside the container by default. To keep trades/config across
>   deploys, add a Render **disk** and point `DATABASE_URL` at it (see the
>   comments in `render.yaml`).

### Deploy with Docker (any host)

```bash
docker build -t po-trader-pro .
docker run -d -p 3000:3000 -v po-data:/app/db --name trader po-trader-pro
# open http://localhost:3000
```

### Deploy anywhere else (Node/Bun host)

```bash
bun install
bun run db:generate
bun run db:push
bun run build
PORT=3000 bun server.ts
```

## Local development (two processes)

```bash
cp .env.example .env       # defaults work out of the box
bun install
bun run db:generate
bun run db:push            # creates db/custom.db (SQLite)

bun run engine &           # trading engine → http://localhost:3030
bun run dev                # Next.js       → http://localhost:3000
```

Open http://localhost:3000 — on `localhost` the browser connects to the
engine directly. If you run the web on another host, set
`NEXT_PUBLIC_ENGINE_URL` (see `.env.example`).

## Connecting Deriv — live market mode (FREE, no account needed)

1. Header → **Connect** → **Deriv · Live Market** → **Connect Deriv Live Market**.
2. That's it — you get **real-time data for 60+ symbols** and the full bot
   runs in **paper mode** (live prices, simulated funds, PAPER badge in the
   header).
3. To trade your real Deriv account instead: create an **API token** at
   [app.deriv.com](https://app.deriv.com) → Account Settings → **API token**
   (enable *Read* + *Trade* scopes) and paste it in the connect dialog.
   A token from your **virtual (demo)** account trades demo funds; one from
   your **real** account trades real money (auto-detected, shown in the header).

> **Weekends:** forex, commodities and stock indices close (Fri 22:00 UTC →
> Sun 21:00 UTC) and are flagged `CLOSED` in Market Watch — the bot skips them
> automatically. **Synthetic indices (Volatility/Jump/Boom/Crash/Range) and
> crypto trade 24/7**, so the bot always has live markets to work with.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DERIV_APP_ID` | `1089` | Deriv app id — the public docs default works out of the box; register your own at api.deriv.com for production |
| `DERIV_WS_URL` | `wss://ws.derivws.com/...` | Override the Deriv websocket endpoint |

## Connecting your Pocket Option account (live mode)

1. Log in to [pocketoption.com](https://pocketoption.com) in your browser.
2. Open DevTools → **Application → Cookies** → copy the full value of the
   **`ssid`** cookie (it is long and URL-encoded — copy all of it).
3. In the app header → **Connect** → paste the SSID, pick your server region
   (`api-l`, `api-eu`, …), connect.
4. Switch **Demo / Real** from the header. The bot respects the account
   selection — double-check before enabling real trading.

The SSID is stored locally in your own database and is only sent to Pocket
Option's own servers. Sessions expire — reconnect with a fresh cookie when
needed.

## Using the bot safely

1. **Start Simulation** and let the bot run — verify behaviour with fake money.
2. Tune: threshold (65–75 recommended), stake, expiry (60s default), assets
   (OTC pairs trade 24/7), stop-loss / take-profit / **daily loss limit**.
3. Check **Analytics → Calibration** (does realized win-rate match predicted
   confidence?) and **Backtest** per asset before trusting a pair.
4. Only then connect live — and start with the **demo account** at your broker.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `C` / `P` | Manual CALL / PUT on the chart asset |
| `B` | Start / stop the bot |
| `/` | Focus the pair search |
| `?` | Help + engine explainer |

## Tech stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Zustand · socket.io (engine ↔ browser) · ws (Pocket Option + Deriv websockets) ·
Prisma + SQLite · Bun (runtime & package manager)

## Project layout

```
server.ts                        consolidated production server (web + engine)
mini-services/po-trader/
  index.ts                       engine orchestration + socket handlers
  src/signal-engine.ts           10-component confluence engine (v9)
  src/indicators.ts              pure TS technical indicators
  src/pocket-option.ts           live PO websocket client (SSID auth)
  src/deriv.ts                   Deriv API client — 62-symbol catalog, market
                                 hours, polling/streaming data, contracts
  src/simulator.ts               synthetic market feed
  src/backtest.ts                backtester with confidence-bin analysis
  src/telegram.ts                Telegram bridge (commands + alerts)
  src/{candle-manager,assets,calendar,types}.ts
src/app/                         Next.js pages + API routes
src/components/trader/           terminal UI components
prisma/schema.prisma             BotConfig / Trade / Signal models
```

## License

[MIT](./LICENSE) — free to use, modify and deploy. Trading risk is yours.
