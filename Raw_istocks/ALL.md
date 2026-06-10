# iStocks — Complete Codebase Reference (`ALL.md`)

> One‑file, new‑developer onboarding guide for the `istocks-p` monorepo.
> Last refreshed: 2026‑05‑18.

iStocks is an **AI‑native stock‑market platform for Indian equities** built around a
natural‑language chat interface. Instead of the usual buy/sell form a user types
("kya aaj WIPRO buy karu?", "top gainers today", "probability Reliance closes above
3000 in 1 year") — and the platform combines a PostgreSQL historical database, a
live Angel One WebSocket feed, a Yahoo Finance fallback, and Google Web Search to
produce an answer, and can even place a paper or live trade through Zerodha / Dhan /
Groww.

This document describes every major feature, subsystem, directory, file group and
deployment target in the repository so that a new engineer can navigate without
opening another README.

---

## 1. High‑Level Architecture

```
┌──────────────────────┐       ┌───────────────────────┐
│  Web  (Next.js 14)   │       │  Android (Capacitor)  │
│  /database-chat,     │       │  wraps the Vercel URL │
│  /stocks, /stock/:s, │       └───────────┬───────────┘
│  /trading, /sangraha │                   │
│  /experts            │                   │
└──────────┬───────────┘                   │
           │  SSE + REST (JWT session)     │
           ▼                               ▼
┌──────────────────────────────────────────────────────┐
│   Next.js API Routes  (src/app/api/**)              │
│   • /api/chat, /api/chat/stream   ← main AI chat    │
│   • /api/stocks/[symbol]/analyze  ← per‑stock AI    │
│   • /api/trading/**               ← broker + orders │
│   • /api/sangraha/**              ← strategy hub    │
│   • /api/experts/**               ← probability panel│
│   • /api/cron/**                  ← Vercel cron     │
│   • /api/telegram/webhook         ← Telegram bot    │
└─────┬──────────────┬─────────────┬───────────────┬──┘
      │              │             │               │
      ▼              ▼             ▼               ▼
 Postgres      EC2 FastAPI     Yahoo Finance   Google / Serper
 (Prisma)      (live WS)       (fallback)      Web Search
```

The AI pipeline is a two‑stage routing system (Option B architecture):

1. **Category classifier** (`classifyQueryCategory` in `intent-classifier.ts`) — DeepSeek classifies every query into one of 10 categories: `screener | single_stock | mutual_fund | pms | web_news | trade | portfolio | market | greeting | other`. This runs before the agent so Claude receives only the tools relevant to the category.
2. **Claude agent** (Amazon Bedrock Sonnet 4.6, branded "Compute 1.0") — receives a filtered tool subset and decides which tool to call with full conversational context.

Four data sources are used, chosen by the routing pipeline:

| Source        | Used for                                                 | Implementation                    |
| ------------- | -------------------------------------------------------- | --------------------------------- |
| `database`    | Historical analytics, probabilities, indicator scans     | Prisma SQL on Postgres            |
| `ec2_live`    | Today's price, live indicators, trade execution          | EC2 FastAPI at port 8080          |
| `web_search`  | "Why did it fall?", news, earnings, sentiment            | Serper API → Google CSE fallback  |
| `morningstar` | Mutual fund analyst reports, ratings, NAV, fund manager  | Firecrawl → morningstar.in        |

---

## 2. Tech Stack

**Frontend / App**
- Next.js **14.2** (App Router) + React 18 + TypeScript 5
- Tailwind CSS 3.4 with three custom themes (`light-tritanopia`, `dark`, `claude-code`)
- Radix UI primitives (`@radix-ui/react-dialog`, `-label`, `-slot`)
- Framer Motion 12 for chat/trade‑card animations
- Lucide icons, Recharts, TradingView `lightweight-charts`
- `react-markdown` + `remark-gfm` for rendered **assistant** answers in `/database-chat` (bold, lists, links); user bubbles stay plain text

**Auth**
- `next-auth` v4 with the Prisma adapter
- Google OAuth + email/password (bcryptjs)
- 30‑day JWT sessions, custom pages at `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`
- `nodemailer` for verification / reset emails

**AI**
- Vercel **AI SDK** (`ai@^5`) + provider packages: `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/amazon-bedrock`
- System default: **Gemini 2.0 Flash** (`@google/generative-ai`)
- **Intent classifier router** (`src/lib/intent-classifier.ts`): two functions power routing. (1) **`classifyQueryCategory(message)`** — DeepSeek classifies every query into one of 10 categories (`screener | single_stock | mutual_fund | pms | web_news | trade | portfolio | market | greeting | other`); result drives `filterToolsForCategory()` in `ai-engine.ts`. (2) **`classifyTradeIntent(message)`** — confirms intent for ambiguous trade commands. Both fall back to AWS Bedrock (Claude Sonnet 4.6) if DeepSeek fails.
- **Date context injection** (`src/lib/date-context.ts`): every LLM prompt (router, system, screener, rewrite, experts) is prefixed with `[TODAY'S DATE: <day>, <date> IST]` to prevent models from hallucinating stale years (2024/2025) when users ask for "latest", "today", or "recent" data.
- User‑configurable LLM (Gemini / OpenAI / OpenRouter / Groq / Anthropic / custom OpenAI‑compatible) stored encrypted on the `User` row
- **Compute model selector** (in `/database-chat` Trading Agent): the chat bar exposes a dropdown of public "Compute" model labels. The underlying provider/model is never shown to the user — it's resolved server‑side in `src/lib/compute-models.ts`.
  - `Compute 1.0` → Azure OpenAI (GPT‑5.4 deployment; `AZURE_OPENAI_*` env vars)
  - `Compute 0.5` → Google Gemini (`gemini-3.1-flash-lite-preview`)
  - `Compute 0.2`, `Compute 0.1` → deprecated, hidden in the UI; requests that reference them fall back to the default Compute.
  - Client‑side list of visible Computes lives in `src/lib/compute-models.client.ts` (labels only); server‑side mapping, provider factories, and the Azure‑missing fallback to Gemini live in `src/lib/compute-models.ts`.
  - The selected Compute is persisted in `localStorage` (`istocks.computeModel`) and sent on every `/api/chat`, `/api/chat/stream`, and `/api/stocks/[symbol]/analyze/stream` request as the `computeModel` field. `runAIEngine` reads it via `options.computeModel` and uses it for all user‑facing completion calls (live snapshot analysis, multi‑stock quote synthesis, web‑search summarization, and the Yahoo tool‑calling agent). Intent classification and language‑rewrite passes stay on DeepSeek/Bedrock for determinism.
  - **Web search path** (`intentSource === 'web_search'`): broader keyword routing (finance terms like earnings, revenue, macro, RBI, sector, etc.); richer Serper query when the user asks a vague follow‑up (stock name/symbol from conversation memory is prepended); two‑pass fetch (wider 7‑day window, then unrestricted if empty); synthesiser prompt asks for multi‑source synthesis, inline citations, and a clear bottom line (Grok‑style thoroughness). Does not change classifier prompts or non‑web paths.
  - **Market scanners** (`src/lib/market-scanners.ts`): before the generic "best stocks" daily‑selection path, `detectMarketScanner(message)` can short‑circuit to deterministic SQL over `StockPrice` for phrases like "stocks at their lowest / 52‑week low", "biggest runners in last N days", oversold/overbought, Bollinger proximity, golden/death cross, MACD cross, SMA filters, unusual volume. Default return window when N is omitted: **20 trading sessions**. Shared liquidity floor: `close ≥ ₹20`, 20‑day avg traded value ≥ ₹2 Cr, ≥15 candles in last 20 rows. If a scanner returns no rows, routing falls through to the normal LLM pipeline. Skipped when the message already names a specific stock (explicit mention).
  - **Portfolio intent detection** (`classifyPortfolioIntent` in `intent-classifier.ts`): DeepSeek‑powered classifier that detects when the user is asking about their **personal portfolio** ("my holdings", "my Zerodha portfolio", "mera portfolio", "compare with my portfolio") versus generic market queries. Used by `DatabaseChat.tsx` to decide whether to fetch the user's live broker + paper holdings before sending the message to the AI engine.

**Markets / Data**
- `yahoo-finance2` — OHLCV, quotes, symbol search
- `technicalindicators` (+ in‑house helpers) for 50+ indicators
- Angel One SmartAPI — historical 1‑min candles and WebSocket ticks
- Serper.dev (primary) / Google Custom Search (fallback) for news
- **Morningstar India** (`src/lib/morningstar.ts`) — mutual fund analyst reports, star ratings, People/Process/Parent pillar ratings, fund manager info, performance vs benchmark, risk analysis, expense ratio. Powered by **Firecrawl** (`FIRECRAWL_API_KEY`) searching `site:morningstar.in`.
- **PMS Bazaar** (`src/lib/pms-bazaar.ts`) — Portfolio Management Services & AIF fund data: AUM, strategy description, returns, minimum investment, fund manager details. Also powered by Firecrawl.

**Database**
- PostgreSQL 14+ (Azure PostgreSQL in prod) with Prisma 5
- Optional TimescaleDB extension for the `StockPrice` hypertable

**Brokers**
- Zerodha Kite Connect (OAuth) — supports holdings fetch (`/portfolio/holdings`)
- Dhan OAuth — supports holdings fetch
- Groww (API key + access token) — supports holdings fetch (`/v1/holdings/user`)
- **Broker Portfolio Sync** — `/api/trading/broker-portfolio` aggregates live holdings from the user's connected broker, fetches live prices via cascading price feed, computes unrealized P&L, and injects the portfolio context into AI answers when the user asks portfolio‑related questions.

**Messaging / Integrations**
- Telegram Bot (webhook to `/api/telegram/webhook`)
- `node-cron` + Vercel Cron (see `vercel.json`)

**Mobile**
- Capacitor 8 wrapper — the Android app loads `https://www.istocks.codes` inside a WebView (`capacitor.config.ts`)

**Deployment**
- Primary: **Vercel** (`vercel.json`, `.vercel/`)
- Also shipped: Azure App Service (`Dockerfile`, `deploy-azure.sh`, `AZURE_DEPLOYMENT.md`)
- Live price microservice: **EC2 (Ubuntu)** running FastAPI (`ec2-live-server/`)

---

## 3. Repository Layout

```
istocks-p/
├── src/
│   ├── app/                 # Next.js App Router pages + API routes
│   ├── components/          # React UI components
│   ├── lib/                 # Business / data / AI libraries (server)
│   ├── services/            # Domain services (indicators, Angel One, backtest, email)
│   ├── config/stocks.ts     # Hardcoded seed stocks (WIPRO, VEDL, ADANIPOWER)
│   └── types/               # Ambient TypeScript declarations
├── prisma/schema.prisma     # Full database schema (see §4)
├── scripts/                 # Python + TS data / ops scripts (see §9)
├── ec2-live-server/         # FastAPI server on AWS EC2 (see §8)
├── android/                 # Capacitor Android project
├── presentation/            # HTML pitch deck (`index.html`)
├── public/                  # Static assets
├── .github/                 # CI/CD workflows
├── .cursor/                 # Cursor IDE rules + context
├── .claude/                 # Claude Code context / instructions
├── AGENTS.md                # Agent onboarding guide (build steps, conventions)
├── capacitor.config.ts      # Mobile WebView config
├── vercel.json              # Vercel crons + rewrites
├── next.config.js, tailwind.config.js, postcss.config.js
└── package.json             # Scripts, deps (see §2 and §10)
```

---

## 4. Database Schema (`prisma/schema.prisma`)

All persistence is Postgres via Prisma. Provider‑specific notes inline.

### 4.1 Market data

- **`Stock`** — master list. Fields: `symbol` (unique), `name`, `exchange` (default `NSE`), broker‑specific IDs: `angelToken`, `dhanSecurityId`, `zerodhaTradingSymbol`, `zerodhaExchange`. Indexed on `symbol` and `angelToken`.
- **`StockPrice`** — per‑stock OHLCV candle with **50+ precomputed indicator columns** (see §5). Unique on `(stockId, timestamp)`. Retention cleanup runs inside `cron/update-stocks` (default rolling window: 1 month of 1‑minute candles).
- **`StockInsight`** — AI‑generated summary per `(stockId, timeframe)` (trend, momentum, volatility, support/resistance, text summary).

### 4.2 Daily stock recommendation

- **`DailyStockSelectionRun`** — one row per trading day (`selectionDate` unique); stores counts + weight configuration.
- **`DailyStockSelectionResult`** — ranked candidates with `technicalScore`, `webScore`, `finalScore`, sentiment label/summary, and top headlines (JSON). Indexed by `finalScore DESC`.

### 4.3 AI chat persistence

- **`ChatSession`** — linked to a `Stock` (+ optional `User`). Auto‑generated title from first message.
- **`ChatMessage`** — `role` (`user | assistant`), `content`, optional `sql` used for the answer. Indexed on `(sessionId, createdAt)`.

### 4.4 Authentication (NextAuth)

- **`User`** — id, email, hashed password, image, email verification.
  - **Prompt quota**: `promptCount` (default 10/month), `lastResetDate` — enforced by `src/lib/user-limit.ts`.
  - **User LLM settings**: `llmProvider`, `llmApiKey`, `llmModel`, `llmBaseUrl` — server‑only, never sent to the client.
  - **Telegram link**: `telegramId` (unique BigInt), `telegramLinkedAt`.
- **`Account`, `Session`, `VerificationToken`** — standard NextAuth tables.

### 4.5 Experts (Probability Panel)

- **`ExpertsSession`** — one row per probability question asked. Fields: `userId` (optional), `title` (first 80 chars of query), `query` (full text). Indexed on `(userId, createdAt DESC)`.
- **`ExpertsAnalysis`** — full result of one analysis run. Stores `krishnaReport`, `chanakyaReport`, `aryabhataReport` (JSON — each is an `AgentReport` with probability, confidence, keyReasons, articles, sqlDataPoints, reasoning), `discussionLog` (JSON — array of `DiscussionTurn`s from 2–3 rounds), `finalProbability` (float), `finalConfidence` (`low | medium | high`), `finalReasoning` (text). Linked to `ExpertsSession` via cascade delete.

### 4.6 Sangraha (Strategy Repository)

- **`Strategy`** — user‑authored trading strategy. Stores `naturalInput`, `strategyCode` (structured DSL JSON), `sqlQuery`, markdown `readme`, `strategyType` (`probability | entry_exit | pattern | indicator`), `tags`, `visibility` (`public | private`), `stars`, `forks`, fork lineage via self‑relation `forkedFromId`.
- **`StrategyStar`** — join table for stars (unique per user/strategy).
- **`Backtest`** — run record: params (`stockSymbol`, `startDate`, `endDate`), metrics (`winRate`, `totalPnL`, `maxDrawdown`, `sharpeRatio`, etc.), detailed `tradeLog` + `equityCurve` JSON, status.

### 4.7 Trading

- **`TradingOrder`** — unified paper/live order log. `tradingMode` `PAPER | LIVE`, `brokerName`, `idempotencyKey` (unique), stop loss/take‑profit, trailing %, option legs, `entryCondition` JSON (conditions + sessionId for conditional watch orders).
- **`BrokerConnection`** — encrypted credentials per `(userId, brokerName)`. All secret fields are encrypted via `src/lib/crypto.ts` (AES). Tracks `tokenExpiresAt`, `isConnected`, `lastValidatedAt`.
- **`UserTradingPreference`** — single row per user: `tradingMode` default, `preferredLiveBroker`.
- **`BrokerAuthState`** — temporary OAuth state/nonce + PKCE `codeVerifier` bound to `userId + broker`.

### 4.8 Telegram Bot

- **`TelegramLinkToken`** — one‑time magic link (`token` unique, `chatId`, `expiresAt`, `usedAt`) used by `/start` to bind a Telegram chat to an iStocks account.
- **`TelegramSession`** — persists the last conversation turns per `chatId` (JSON array) — necessary because Vercel serverless functions do not share memory.

### 4.9 Observability

- **`SqlErrorLog`** — stores SQL failures so the LLM can learn to avoid repeating them. `fingerprint` de‑duplicates by error code + snippet.

---

## 5. Technical Indicators (50+)

Defined in `src/services/technical-indicators.service.ts` (and the parallel Python
script `scripts/calculate-indicators.py`). All land in `StockPrice` columns and are
also re‑computed on the fly from minute bars in `src/lib/ec2-helpers.ts`.

- **Moving averages** — `sma20 / sma50 / sma200`, `ema12 / ema26`, `wma20`, `dema20`, `tema20`, `hma20`, `vwma20`.
- **MACD** — `macd`, `macdSignal`, `macdHistogram`.
- **Momentum / Oscillators** — `rsi`, `stochK/D`, `williamsR`, `roc`, `ao`, `uo` (Ultimate Oscillator, manual), `cmo`, `tsi`, `ppo`, `dpo`.
- **Trend** — `cci`, `adx / plusDI / minusDI`, `trix`, `kst / kstSignal`, `aroonUp / aroonDown / aroonOsc`, `psar + psarSignal`, Ichimoku (`conv/base/leadA/leadB/lagging`), `supertrend + supertrendDirection`.
- **Volatility / Channels** — Bollinger Bands (`bbUpper/Middle/Lower`), `atr`, Keltner (`kcUpper/Middle/Lower`), Donchian (`dcUpper/Middle/Lower`), `stdDev20`.
- **Volume** — `obv` (BigInt), `vwap`, `forceIndex`, `adLine`, `mfi`, `cmf`, `pvt`, `eom`.

The live variant `src/services/live-indicator-engine.ts` rolls these on a
per‑minute rolling window for `/api/live-indicators`.

---

## 6. Pages / Routes (`src/app/`)

### 6.1 User‑facing pages

- **`/`** → redirects to `/database-chat` (`src/app/page.tsx`).
- **`/database-chat`** — main **AI trading chat** (full screen, history sidebar, trade plan cards, streaming thinking/tool events, Compute model dropdown, markdown assistant replies). Backed by `components/DatabaseChat.tsx` (~2.5k lines, the flagship UI).
- **`/stocks`** — searchable stock grid with live EC2 price overlay (`src/app/stocks/page.tsx`).
- **`/stock/[symbol]`** — per‑stock detail view: Recharts + lightweight‑charts candle chart, `AIChat` panel (now streaming via `/api/stocks/[symbol]/analyze/stream`), indicators table, insights panel.
- **`/trading`** — orders / positions / holdings dashboard for paper + live trades, with `TradeExecutionModal`, `HoldingsView`, `PnLDashboard`.
- **`/trading/settings`** — connect/disconnect brokers (Zerodha, Dhan, Groww), choose trading mode + preferred live broker.
- **`/holdings`** — aggregated positions view.
- **`/pnl`** — PnL analytics dashboard.
- **`/sangraha`** and **`/sangraha/[id]`** — "Sangraha" strategy marketplace: browse, star, fork, backtest. Filters: mine / starred / all; by `strategyType` / `stockSymbol` / tag / search.
- **`/experts`** — **Experts Probability Panel** (full‑screen, sidebar with session history, three‑agent streaming cards, panel discussion, final probability gauge). Backed by `components/ExpertsChat.tsx`. Ask any probability question (stock or general); Krishna, Chanakya, and Aryabhata analyse in parallel then hold 2–3 discussion rounds before issuing a weighted verdict.
- **`/iteration`** — internal iteration‑review tool. Replays a curated set of past prompts through the current AI engine, scores pass / warning / fail (`src/lib/iteration-review.ts`).
- **`/about`** — static about page.
- **`/link-telegram`** — web page that issues a magic link + deep‑links to Telegram to bind a chat.
- **Auth pages** — `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`.

### 6.2 API routes (`src/app/api/**`)

All routes use `runtime = 'nodejs'` where applicable and declare `maxDuration = 120–300` so long AI calls and cron runs fit within Vercel limits.

**Auth (`/api/auth/*`)**
- `[...nextauth]/route.ts` — NextAuth (Google + Credentials), JWT sessions, Prisma adapter.
- `signin`, `signup`, `forgot-password`, `reset-password`, `verify-email` — custom flows that wrap bcryptjs + email service.

**Chat**
- `POST /api/chat` — non‑streaming chat (returns JSON, used by Telegram + legacy clients). Body may include `computeModel` (`compute-1.0` | `compute-0.5`) for user‑facing completions in `runAIEngine`.
- `POST /api/chat/stream` — **SSE streaming** chat. Emits real‑time `thinking`, `routing_options`, `tool_start`, `tool_end`, `memory_update`, `answer`, `trade_intent`, `error` events. Same optional `computeModel` in the JSON body.
- `/api/chat/sessions` (list/create), `/api/chat/sessions/[sessionId]` (update/delete + messages) — persistent chat history for the current stock.

**Stock analytics**
- `GET /api/stocks` — full stock list with latest price + change.
- `GET /api/stocks/resolve?q=...` — fuzzy symbol resolver.
- `GET /api/stocks/[symbol]/data` — chart‑ready OHLCV + indicators.
- `POST /api/stocks/[symbol]/analyze` — legacy non‑stream analyze.
- `POST /api/stocks/[symbol]/analyze/stream` — per‑stock AI analysis, SSE. Optional `computeModel` in body. **Note**: on 2026‑04‑16 the stock‑page AI thinking steps were fixed by moving the Analyze‑Market‑Data flow to this SSE endpoint, so `AIChat` now renders the real `thinking / tool / routing` events (fixed "0 steps" issue).

**Live data (proxy to EC2)**
- `GET /api/live-price?symbol=...` — current LTP (EC2 if present, else Yahoo).
- `GET /api/live-price` — **full feed** for the stocks grid poll: EC2 `data` map when healthy; if EC2 errors or returns an **empty** `data` object, responds **200** with Yahoo batch quotes for symbols loaded from the `Stock` table (bounded by `LIVE_PRICE_BATCH_LIMIT`). Previously returned **503** when EC2 failed, which made `/stocks` look static except for per-symbol NIFTY refresh.
- `GET /api/live-ohlcv?symbol=...` — 1‑min candles.
- `GET /api/live-indicators?symbol=...` — rolling indicators.
- `GET /api/yahoo-price?symbol=...` — Yahoo fallback quote.
- `GET /api/stream/nifty` — SSE NIFTY ticker.

**Trading**
- `/api/paper-trade` — place paper trade; `process-pending` processes queued paper trades when market opens.
- `/api/trading/brokers/[broker]/connect/start` — begin OAuth (Zerodha / Dhan) or API‑key save (Groww).
- `/api/trading/brokers/<broker>/callback` — handle broker OAuth callback.
- `/api/trading/brokers/[broker]/credentials` — GET/POST/DELETE user credentials (encrypted).
- `/api/trading/brokers/[broker]/disconnect`.
- `/api/trading/execute` — core endpoint invoked by the chat when a trade is confirmed (routes to `executeTradeForUser`).
- `/api/trading/orders`, `/api/trading/positions`, `/api/trading/holdings`, `/api/trading/settings`.
- `/api/trading/broker-portfolio` — **aggregates live holdings from the user's connected broker** (Zerodha/Dhan/Groww), fetches live prices via cascading price feed, computes unrealized P&L, and returns a unified portfolio view. Used by `DatabaseChat` when `classifyPortfolioIntent` detects a portfolio query.

**Sangraha**
- `GET/POST /api/sangraha` — list / create strategies.
- `GET/PATCH/DELETE /api/sangraha/[id]`.
- `POST /api/sangraha/[id]/fork`, `/star`, `/backtest`.

**Experts (Probability Panel)**
- `POST /api/experts/analyze` — **SSE streaming** endpoint. Runs the three probability agents in parallel and emits `agent_start`, `agent_searching`, `agent_article`, `agent_sql`, `agent_conclusion`, `discussion_start`, `discussion_point`, `final_probability`, `analysis_saved` events. `maxDuration = 300`.
- `GET /api/experts/sessions` — list `ExpertsSession` rows for the current user (last 50, newest first, includes latest analysis summary).
- `POST /api/experts/sessions` — create a session record (called automatically by the analyze endpoint if no `sessionId` is supplied).
- `GET /api/experts/sessions/[sessionId]` — fetch a session with all `ExpertsAnalysis` rows for replay.
- `DELETE /api/experts/sessions/[sessionId]` — delete a session (cascade-deletes analyses).

**User**
- `GET/POST /api/user/llm-settings` — manage the user's custom LLM provider / key / model.

**Telegram**
- `POST /api/telegram/webhook` — main bot handler.
- `POST /api/telegram/set-webhook` — admin utility.
- `POST /api/telegram/link` — issues a link token consumed by `/link-telegram`.

**Portfolio / Chat**
- `POST /api/chat/classify-portfolio` — lightweight endpoint that runs `classifyPortfolioIntent(message)` via DeepSeek to detect if the user's message is asking about their personal portfolio. Called by `DatabaseChat.tsx` before the main chat request.

**Cron (Vercel)**
- `GET /api/cron/update-stocks` — **Mon–Fri 10:05 UTC** (`5 10 * * 1-5`). Pulls incremental 1‑min candles from Angel One, inserts, re‑computes indicators, cleans up rows older than retention. Uses a `CronCursorState` table to rotate through the full stock universe across runs respecting the 5‑minute Vercel time budget.
- `GET /api/cron/generate-daily-stock-selection` — **Mon–Fri 10:30 UTC** (`30 10 * * 1-5`). Runs `selectBestStocks` + web sentiment and persists `DailyStockSelectionRun/Result`.
- `GET /api/cron/process-pending-trades` — auto‑executes conditional watch orders when their indicator or price condition fires, or when the market opens (for queued paper trades).
- `GET /api/cron/ping-db` — keep‑alive ping.

**Iteration / ops**
- `GET /api/iteration/cases`, `POST /api/iteration/replay`.
- `POST /api/backfill-stocks` — one‑off backfill utility.
- `GET /api/holdings` — aggregated holdings for the current user.
- `PATCH /api/holdings` — exit a **paper** holding (`tradingMode: PAPER`). Body: `{ holdingId, exitPrice? }`. When `exitPrice` is a positive number (the price already shown in Holdings UI), the server uses it immediately as `exitPriceSource: client-display` to avoid slow sequential EC2+Yahoo fetches. Otherwise it runs `getFreshEC2Quote` and `fetchLiveMarketQuote` **in parallel** and picks EC2 first, then Yahoo. Records `exitPriceSource: ec2-live | yahoo-live-fallback | client-display` in `rawBrokerResponse`. Response includes `exitPrice` and `returns`. LIVE orders are unaffected.

---

## 7. Core Libraries (`src/lib/`)

Every file is server‑only. Lines-of-code in parentheses give a quick sense of scope.

- **`ai-engine.ts` (~3.3k lines)** — the heart of the app.
  - Exports `runAIEngine(message, history, onEvent, referer, { conversationMemory, computeModel, shouldStop })`.
  - Pipeline (Option B): **optional market scanner (SQL)** → **`classifyQueryCategory` (DeepSeek → 10 categories)** → **`filterToolsForCategory`** → **Claude agent (Bedrock Sonnet 4.6) with filtered tool subset** → answer.
  - **`filterToolsForCategory(allTools, category, webSearchEnabled)`** — returns a pruned tool map per category: screener gets `[dynamicScreener, screenByPriceRange, queryMarketDatabase, getMarketMovers]`; single_stock gets `[findStock, analyzeStock, queryMarketDatabase]`; pms gets `[queryPMSBazaar, webSearch]`; trade gets `[findStock, analyzeStock, getMarketMovers]`; etc. `greeting` / `other` receive the full tool set.
  - **`dynamicScreener(query)`** agent tool — wraps `enhancePrompt()` + `runDynamicScreener()` so Claude can call the multi‑criteria screener directly with the full user query; replaces the old hard‑coded regex screener intercepts.
  - Removed all 8 pre‑agent regex intercepts that previously short‑circuited routing: `earlyScanner`, `priceRangeHint`, `bestStockRankingRequest`, `isIntradayIndicatorRequest`, `isConversationalCorrection`, second scanner block, `priceRangeScreenRequest`, `benchmarkComparisonRequest`, `routeQueryWithLLM`.
  - Emits strongly typed `AIEvent`s consumed by the SSE endpoints and by the Telegram bot.
  - Integrates `tradeCommandResolver`, `bestStockSelector`, `dailyStockSelection`, `market-scanners` (`detectMarketScanner` / `runMarketScanner` / `formatScannerAnswer`), `ec2Helpers`, `googleSearch`, `yahooFinance`, Prisma.
- **`compute-models.ts`** — server registry mapping Compute ids (`compute-1.0`, …) to Azure OpenAI or Gemini via the AI SDK; `getComputeAiSdkModel` / `getComputeLegacyModel`; accepts Azure env aliases (`AZURE_RESOURCE_NAME`, `AZURE_API_KEY`, `AZURE_OPENAI_ENDPOINT`); if Azure is not fully configured (key + resource or base URL), Compute 1.0 falls back to Gemini so chat keeps working.
- **`compute-models.client.ts`** — client‑only list of visible Compute labels (no provider names exposed).
- **`market-scanners.ts`** — phrase → deterministic `StockPrice` SQL scans (52‑week extremes, window returns, RSI, Bollinger, MA crosses, volume spike); see **AI → Market scanners** in §2.
- **`ai-providers.ts`** — minimal factory for Gemini 2.0 Flash / Claude 3.5 / GPT‑4o (system side).
- **`llm-client.ts`** — **user‑provided LLM** abstraction. Supports `gemini | openai | openrouter | groq | anthropic | custom (OpenAI‑compatible)`; falls back to system Gemini on failure so chats never break. `extractUserConfig(user)` is how the rest of the codebase reads a user's LLM preference.
- **`intent-classifier.ts`** — three exported classifiers, all using DeepSeek with AWS Bedrock fallback. (1) **`classifyQueryCategory(message)`** — 10‑category router (`screener | single_stock | mutual_fund | pms | web_news | trade | portfolio | market | greeting | other`); result passed to `filterToolsForCategory` in `ai-engine.ts`. (2) **`classifyTradeIntent(message)`** — binary trade‑intent check for ambiguous commands. (3) **`classifyPortfolioIntent(message)`** — detects personal portfolio queries ("my portfolio", "mera portfolio", "compare with my holdings") so `DatabaseChat.tsx` can pre‑fetch live broker data before calling the AI engine. Also exports the `QueryCategory` type.
- **`ec2-helpers.ts`** — fetches live snapshots from `EC2_LIVE_SERVER_URL` (default `http://13.203.192.234:8080`). Reconstructs rolling indicators from 1‑minute candles using `technicalIndicatorsService`. Has a Yahoo‑1m fallback layer.
- **`yahoo-finance.ts`** — wrapper around `yahoo-finance2` with helpers: `yahooSymbol` (e.g., `WIPRO` → `WIPRO.NS`, `NIFTY` → `^NSEI`), `fetchOHLCV`, `computeIndicators`, `batchQuote`, `fetchLiveMarketQuote`, index alias map (NIFTY, BANKNIFTY, SP500, NIKKEI …).
- **`yahoo-agent.ts`** — tool‑calling agent (AI SDK) with 8 tools (see below), hard system prompt that bans "I'm an AI" disclaimers and always returns Entry/Stop/Target/RR. The active tool set is pruned per query category by `filterToolsForCategory` before the agent runs.

  | Tool | Purpose |
  | ---- | ------- |
  | `dynamicScreener(query)` | Multi‑criteria stock screener — calls `enhancePrompt` + `runDynamicScreener`; use for any discovery with criteria beyond a pure price range |
  | `screenByPriceRange(min, max, limit)` | Price‑range‑only screen via `price-range-screener.ts`; use when price range is the SOLE filter |
  | `findStock(symbol)` | Fetches live EC2 snapshot + trading levels for one stock |
  | `analyzeStock(symbol)` | Deep technical + fundamental analysis for one stock |
  | `queryMarketDatabase(query)` | SQL‑powered historical queries on `StockPrice` |
  | `getMarketMovers` | Top gainers / losers / volume leaders from EC2 |
  | `queryPMSBazaar(query)` | PMS / AIF fund data via Firecrawl on `pmsbazaar.com` |
  | `webSearch(query)` | News / macro / earnings via Serper → Google CSE; only injected when web search is enabled |
- **`googleSearch.ts`** — Serper.dev primary + Google CSE fallback, recency/date filtering, snippet formatter for prompt insertion.
- **`pms-bazaar.ts`** — PMS Bazaar India integration (powered by Firecrawl). Searches `pmsbazaar.com` for portfolio management services data: fund AUM, client count, strategy description, returns, minimum investment, blog analysis. Tool available to the Yahoo agent for PMS/AIF queries.
- **`morningstar.ts`** — Morningstar India integration (powered by Firecrawl). Searches `morningstar.in` for mutual fund data: analyst reports, star ratings, People/Process/Parent pillar ratings, fund manager info, performance vs benchmark, risk analysis, expense ratio, portfolio holdings. Tool available to the Yahoo agent for MF/ETF/SIP queries.
- **`price-range-screener.ts`** — screens ALL NSE stocks by live share price range [min, max], filters by volume ≥50k/day, then computes OHLCV + trading levels + sentiment for the liquid subset. Returns ranked stocks with Entry/SL/Target/R:R. Used by the `screenByPriceRange` tool in the Yahoo agent.
- **`deepseek-provider.ts`** — creates an OpenAI‑compatible provider pointing to DeepSeek's API (`https://api.deepseek.com/v1` by default, override via `DEEPSEEK_BASE_URL` for LiteLLM proxies). Used by the intent classifier and any future DeepSeek‑powered features.
- **`date-context.ts`** — `getDateContext()` returns `[TODAY'S DATE: <day>, <date> IST]` + a critical instruction forcing the LLM to treat that date as "today". Prepended to every LLM prompt in the system (router, system prompt, screener, rewrite, final synthesis, experts) to prevent stale‑year hallucinations.
- **`best-stock-selector.ts` + `daily-stock-selection.ts`** — scores the universe by trend gap, RSI band, liquidity (20d avg traded value), and web sentiment. Output is persisted daily.
- **`stock-scanner.ts`** — simpler SQL scanner for "best stocks right now": price > SMA50, SMA50 > SMA200, RSI 55–72, ≥ ₹2 cr avg 20‑day traded value.
- **`stock-resolver.ts` + `instrumentRegistry.ts`** — fuzzy symbol normalization, alias handling (e.g., `ZOMATO` → `ETERNAL`), Angel One token lookup/update.
- **`market-session.ts`** — `isNSEMarketSessionLive()` (Mon–Fri 09:15–15:30 IST), plus `getFreshEC2Quote` guard that rejects stale / future‑drifted quotes before executing an order.
- **`template-service.ts`** — library of SQL "probability templates" (e.g., `prob_close_above`) that the database‑intent pipeline can fill and run for deterministic answers.
- **`sqlSanitizer.ts`** — patches common LLM‑SQL bugs (missing `::numeric` casts, malformed `round()`, bad timezone conversions) before execution on Azure PG 17.
- **`sqlErrorStore.ts` + `query-logger.ts`** — write/read helpers for `SqlErrorLog` + a debug query log.
- **`iteration-review.ts`** — re‑runs curated prompts through `runAIEngine` and grades quality — powers `/iteration`.
- **`trading-levels.ts` (~420 lines)** — **deterministic Entry/Stop/Target/Support/Resistance + Holding Period calculator** for any stock.
  - Core price-level functions: `calculateResistance()`, `calculateSupport()`, `calculateATR()`, `calculateEntry()`, `calculateStopLoss()`, `calculateTarget()`.
  - Two level modes: (1) `calculateTradingLevels(symbol, timeframe, ohlcData)` from raw candles, (2) `calculateTradingLevelsFromSnapshot(snapshot, holding?)` from live EC2 indicators.
  - **Holding period** — `calculateHoldingPeriod(entry, target, last30Closes)`: O(n) pure function; computes average daily price move over last 30 closes, divides distance-to-target by that move, clamps to 1–90 days, maps to label (`Intraday` / `1–3 days` / `3–10 days` / `2–4 weeks` / `1–3 months`).
  - **Data fetch** — `fetchLast30Closes(symbol)`: queries `StockPrice` via Prisma (primary); falls back to Yahoo Finance 3‑month daily candles if stock is missing from DB.
  - EC2 live path fetches closes in parallel with the live snapshot (`Promise.all`), computes holding, attaches to levels object — zero added latency.
  - Confidence scoring (0–100): ADX strength, Supertrend alignment, RSI positioning, MACD histogram, MFI/CMF volume, Donchian validity.
  - Final answer always includes: `📌 Entry: ₹X | 🎯 Target: ₹X | 🛑 Stop-Loss: ₹X | R/R: X.XX | Support: ₹X | Resistance: ₹X | ⏱️ Hold: 3–10 days`.
- **`tradeCommandResolver.ts`** — parses trade commands out of free‑form text, considering prior conversation (so "sell 5 of it" resolves to the last mentioned symbol).
- **`pending-paper-trades.ts`** — the worker that monitors conditional paper trades and auto‑fires when the condition is met or the market opens. Used by `/api/paper-trade/process-pending` and the cron.
- **`user-limit.ts`** — 10 prompts/month per user, monthly auto‑reset.
- **`crypto.ts`** — AES‑256 encrypt / decrypt for broker secrets using `BROKER_CREDS_ENC_KEY`.
- **`auth.ts`** — the `authOptions` used by both `getAuthSession()` (server) and the NextAuth route.
- **`prisma.ts`** — singleton PrismaClient (dev‑safe).
- **`telegram.ts`** — Telegram Bot API helpers: `sendMessage` (auto‑chunks 4096‑char limit), `sendChatAction`, `editMessage`, `setWebhook`, `parseCommand`.
- **`trading/`**
  - `types.ts` — `BrokerName` (`ZERODHA | DHAN | GROWW`), `OrderSide`, `OrderType`, `ProductType`, `TradeExecutionRequest/Result`, normalizers.
  - `executor.ts` — **single source of truth for order placement**. Handles:
    - Idempotency (returns past order if `idempotencyKey` matches).
    - PAPER vs LIVE gating.
    - Queueing when market is closed / EC2 feed is down (`entryCondition.autoExecuteOnMarketOpen = true`).
    - LIVE safety checks: feature flag `LIVE_TRADING_ENABLED`, value cap `LIVE_MAX_ORDER_VALUE`, preferred broker, explicit `confirmed` flag, token refresh via adapter.
    - Paper‑trade Yahoo fallback price when EC2 is unavailable but the market is live.
  - `broker-connect.ts` — shared OAuth state helpers (stores `BrokerAuthState`, verifies + consumes).
  - `auth.ts` — tiny helper to read the current trading preference.
- **`brokers/`**
  - `types.ts` — `BrokerAdapter` interface (`connectStart`, `connectCallback`, optional `refreshIfNeeded`, `placeOrder`).
  - `factory.ts` — returns the adapter for a given broker name.
  - `zerodha.adapter.ts` — Kite Connect OAuth + `/orders/regular`.
  - `dhan.adapter.ts` — Dhan OAuth + orders API, uses `dhanSecurityId` from the `Stock` row.
  - `groww.adapter.ts` — Groww REST with API‑key + access token.

## 7.1 Probability Agents (`src/lib/probability-agents/`)

The three‑agent probability‑analysis system that powers `/experts`.

- **`types.ts`** — all shared interfaces (`ScoredArticle`, `SqlDataPoint`, `AgentReport`, `DiscussionTurn`, `FinalProbabilityResult`) and the `ExpertsEvent` SSE union type consumed by `ExpertsChat.tsx`.
- **`expert-llm.ts`** — per-agent LLM router. Defaults: **Krishna → Azure OpenAI GPT‑5.4**, **Chanakya → Gemini**, **Aryabhata → Qwen**, **Synthesizer → Azure OpenAI GPT‑5.4**. Supports `azure | gemini | qwen | openai-compatible` via `EXPERT_<AGENT>_PROVIDER`, falls back to Gemini if a non-Gemini provider fails.
- **`article-scorer.ts`** — `scoreArticle(query, article, agent)` uses the calling agent's configured model to assign **relevance** (0–1), **probabilitySignal** (−1 to +1), and **confidence** (0–1). `scoreArticlesBatch` runs all articles in parallel with `Promise.allSettled`, filters out irrelevant ones (relevance < 0.1), and sorts by `relevance × confidence`. `computeWeightedProbability` converts the scored list into a single 0–100 probability estimate.
- **`krishna.ts`** — **Historical Correlation Agent**. Uses its configured model to build 3 search layers (general → similar past events → closest historical match), fetches ~10 articles per layer via `searchGoogle`, scores them, and synthesises key reasons + reasoning paragraph. Emits `agent_start`, `agent_searching`, `agent_article`, `agent_conclusion`.
- **`chanakya.ts`** — **Current Intelligence Agent**. Searches three recency windows (7 / 30 / 60 days with `sortByDate: true`). Applies a recency bonus (×1.3 for articles < 7 days old, ×1.1 for < 30 days) to confidence before scoring. Same event sequence as Krishna.
- **`aryabhata.ts`** — **Numerical Evidence Agent**. (1) Detects whether the query is stock‑related and extracts the symbol; (2) runs 4 raw SQL queries against `StockPrice` (RSI distribution, next‑candle direction base rate, latest indicator snapshot, ATR / price range); (3) searches 3 statistical‑article queries; (4) blends SQL data (60 % weight) with article data (40 %) when both are available. Also accepts optional **user‑provided data** passed through the API. Emits extra `agent_sql` events for each DB data point.
- **`synthesizer.ts`** — **Discussion Engine + Final Calculator**. Runs 2–3 rounds; in each round every agent sees the other agents' reports and all prior turns and responds through that agent's configured model (2–3 sentences, optional `probabilityAdjustment`). Final synthesis uses the `synthesizer` runtime and produces `consensusPoints`, `conflictPoints`, and `finalReasoning`. Final probability = confidence‑weighted average of agents' last stated positions (Krishna 30 %, Chanakya 35 %, Aryabhata 35 %).
- **`index.ts`** — `runExperts(query, emit, options)` runs the three agents with `Promise.all`, feeds reports into `runSynthesizer`, persists to `ExpertsAnalysis`, and emits `analysis_saved`. `createExpertsSession` creates the session row.

## 7.3 Services (`src/services/`)

- **`technical-indicators.service.ts`** — class that consumes an array of OHLCV bars and returns all indicators listed in §5. Handles edge cases (short series, zero volume, null volume for VWAP).
- **`live-indicator-engine.ts`** — rolls those indicators on streaming 1‑minute candles for the `/api/live-indicators` endpoint.
- **`angel-one.service.ts`** — TypeScript client for Angel One SmartAPI: TOTP generation (hi‑base32), `loginByPassword`, historical candle fetching, quote helpers.
- **`backtest.service.ts`** — runs a Sangraha `Strategy` over historical `StockPrice` rows; computes win rate, PnL, max drawdown, Sharpe, equity curve, trade log.
- **`email.service.ts`** — Nodemailer wrapper (SMTP) for password reset + email verification.

---

## 8. EC2 Live Server (`ec2-live-server/`)

A standalone Python service, **not** part of the Next.js app, that provides real‑time
Indian equity ticks.

- `main.py` — FastAPI + Angel One **SmartWebSocketV2** streaming.
  - Authenticates daily with `SmartConnect` + `pyotp` TOTP.
  - Loads a dynamic universe of tickers/tokens from the Postgres `Stock` table (no hardcoded universe) and subscribes in batches of 50.
  - Enforces NSE market hours (9:00–15:30 IST, Mon–Fri); outside hours it falls through.
  - Holds live ticks in an in‑memory `dict` (`live_prices`) that `/prices` returns.
  - Watchdog thread (every 2 min) reconnects on silence; 10‑attempt reconnect loop with 15s backoff.
  - Endpoints: `GET /health`, `GET /prices`, `GET /prices/{symbol}`, `GET /stream` (SSE).
- `trade_watcher.py` — optional background worker that auto‑monitors and reports.
- `deploy.sh` — idempotent setup script: system deps, systemd unit `istocks-live`, venv install.
- `requirements.txt` — FastAPI, SmartApi, pyotp, psycopg2, pytz, logzero.

Default URL in this repo: `http://13.203.192.234:8080` (override with `EC2_LIVE_SERVER_URL`).

---

## 9. Scripts (`scripts/`)

Operations tooling (Python + TS). A non‑exhaustive map:

- **Data ingest**
  - `fetch-and-import-historical.py`, `fetch-historical-2023.py`, `fetch-historical-data.py`, `fetch-multi-stock-data.py`, `fetch-wipro-python.py`, `fetch-and-insert-nifty.py`, `fetch-nifty-to-neon.py` — Angel One historical pulls.
  - `auto-fetch-stock-data.py` — market‑hours fetcher that upserts 1‑min candles.
  - `import-nifty-csv.py`, `import-wipro-json.ts`, `populate-wipro-data.ts` — bulk seeders.
  - `sync-dhan-security-ids.ts` — populate `Stock.dhanSecurityId` from Dhan's master.
  - `seed-angel-tokens.py`, `find-token.py`, `copy-tokens-to-stock.js` — Angel One token management.
- **Indicators**
  - `calculate-indicators.py` — full Python recompute (51 indicators, `ta` + custom).
  - `calculate-supertrend.py`, `add-indicator-columns.py`, `recalculate_indicators.py`.
- **Maintenance / ops**
  - `daily_maintenance.py` — runs the full fetch + prunes rows > 5 years old.
  - `cleanup-old-data.py`, `backfill-stale-stocks.py`, `manual-update-all.js`, `check_db_size.py`, `verify_db_values.py`.
  - `setup-auto-fetch.sh`, `setup-cron-autofetch.sh`, `run-auto-fetch.sh`, `manual-fetch.sh` — local cron wiring.
  - `migrate-to-azure.py`, `migrate-to-vercel.sh` — environment migration.
- **Stock onboarding** — `add-eternal.py`, `add-hdfcbank.py`, `add-sbin.py`, `add_bajfinance.py`, `add-swiggy.py`, `add-missing-stocks.js`, `add-stocks-to-vercel.js`, etc.
- **Diagnostics** — `debug-stocks-query.ts`, `debug_db_data.py`, `test-historical-data-availability.py`, `test-sql-validity.py`, `test-search.js`.
- **AI ops**
  - `run-iteration-review.ts` — CLI for the iteration engine (`npm run iteration:all`).
  - `seed-templates.ts` — seeds SQL probability templates (`BASE_TEMPLATES` in `template-service.ts`).
- **Utilities**
  - `export-database-to-csv.ts`, `export-to-csv.js`, `export-wipro-chunked.js`, `export_chat_messages.py`.

---

## 10. Package Scripts (`package.json`)

```
dev                  next dev -p 3002
build                prisma generate && next build
start                next start -p 8080
lint                 next lint
postinstall          prisma generate
db:push              prisma db push
db:seed              tsx scripts/populate-wipro-data.ts
db:import            tsx scripts/import-wipro-json.ts
db:export            tsx scripts/export-database-to-csv.ts
iteration:all        tsx scripts/run-iteration-review.ts
fetch:python         python3 scripts/fetch-wipro-python.py
sync:dhan-security   tsx scripts/sync-dhan-security-ids.ts
mobile:sync          npx cap sync android
mobile:open          npx cap open android
mobile:build:debug   cd android && ./gradlew assembleDebug
mobile:build:release cd android && ./gradlew assembleRelease
```

---

## 11. Frontend Components (`src/components/`)

- **`ExpertsChat.tsx`** *(~2k LOC)* — the probability‑panel UI at `/experts`. Same theme and sidebar pattern as `DatabaseChat`. Features: collapsible agent cards (each shows live search queries, scored articles with colour‑coded probability signals, DB data points, key reasons, and full reasoning); a panel‑discussion section with per‑round per‑agent turns; and a final‑verdict card with an SVG probability gauge, per‑agent weighted breakdown, consensus / conflict points, and overall reasoning. Connects to `/api/experts/analyze` via SSE and `/api/experts/sessions/**` for history.
- **`DatabaseChat.tsx`** *(flagship ~2.5k LOC)* — the main chat UI at `/database-chat`. Features: sidebar with chat sessions, SSE event consumer (shows "thinking"/"routing"/"tool" cards with progress), trade‑plan review card, animated trade card, quick prompts, keyboard shortcuts, theme‑aware styling; **assistant** message bodies render through `react-markdown` + `remark-gfm` so `**bold**` and lists display correctly; Compute model id persisted in `localStorage` (`istocks.computeModel`) and sent as `computeModel` on chat requests.
- **`ui/ai-prompt-box.tsx`** — `PromptInputBox`: third `AnimatedDropdown` for Compute model (`Compute 1.0` / `Compute 0.5`) beside PAPER/LIVE and broker.
- **`AIChat.tsx`** *(~2.1k LOC)* — per‑stock AI chat used on `/stock/[symbol]`. Streams events from `/api/stocks/[symbol]/analyze/stream`, renders markdown answers, inline web sources, live indicator references.
- **`StockDashboard.tsx` + `StockDetailView.tsx`** — layout shells for the stock pages.
- **`StockChart.tsx`** — Recharts + lightweight‑charts dual renderer with interval switcher.
- **`TechnicalIndicatorsList.tsx`** — grid of indicator chips (RSI, MACD, BB, ATR, …).
- **`InsightsPanel.tsx`** — quick insights summary (reads `StockInsight`).
- **`Header.tsx` + `ui/floating-header.tsx` + `ui/tubelight-navbar.tsx`** — app chrome, theme switcher modal (Light Tritanopia / Dark / Claude Code), LLM‑settings modal trigger.
- **`LLMSettingsModal.tsx`** — UI for saving a per‑user LLM provider + key + model + baseUrl (POSTs to `/api/user/llm-settings`).
- **`TradeExecutionModal.tsx`** — "Confirm this order" dialog for live trades (shows broker, qty, price, estimated value).
- **`HoldingsView.tsx`** — portfolio / PnL UIs. Now includes a **Broker Portfolio** tab that fetches live holdings from the user's connected broker via `/api/trading/broker-portfolio`, shows unrealized P&L with live prices, and mixes broker + paper holdings in a single view.
- **`PnLDashboard.tsx`** — PnL analytics dashboard.
- **`PriceRangeScreenerMessage.tsx`** — custom markdown renderer for price‑range screener results. Parses the AI's markdown output and renders styled screener cards with stock tables, Entry/SL/Target/R:R, and confidence scores.
- **`StockLogo.tsx`** — deterministic stock logo component (letter + color hash).
- **`SessionProvider.tsx`, `ThemeProvider.tsx`, `Loader.tsx`** — client‑side providers + a full‑screen loader.
- **`ui/`** — reusable primitives: `ai-prompt-box`, `animated-holding-card`, `animated-thinking`, `animated-trade-card`, `button`, `dropdown-01`, `floating-header`, `liquid-glass-button`, `sheet`, `tubelight-navbar`.

---

## 12. Telegram Bot

The bot is a first‑class client that shares the AI engine with the web UI.

- **Webhook** — `POST /api/telegram/webhook` is registered via `POST /api/telegram/set-webhook`. Updates contain `/commands` or callback queries.
- **Binding flow** — user taps "Connect Telegram" on `/link-telegram`, which calls `/api/telegram/link` to mint a `TelegramLinkToken`; the bot consumes it on first `/start` and writes the chat ID into `User.telegramId`.
- **Conversation state** — `TelegramSession.history` persists the last turns per chat (serverless functions are stateless).
- **AI parity** — the webhook calls `runAIEngine(...)` with a Telegram‑shaped `onEvent` callback that edits the "Thinking…" message into the final answer via `editMessage` and respects Telegram's 4096‑char chunking.

---

## 13. Scheduled Jobs

Two layers:

1. **Vercel Crons** (`vercel.json`)
   - `5 10 * * 1-5` → `/api/cron/update-stocks` — fetch new 1‑minute candles for the rotated symbol batch, recompute indicators, retention cleanup.
   - `30 10 * * 1-5` → `/api/cron/generate-daily-stock-selection` — run the scorer and persist the day's ranked picks.
2. **EC2 cron / systemd** — via `scripts/setup-cron-autofetch.sh` + `scripts/daily_maintenance.py`; used when running outside Vercel (e.g., Azure App Service).

`/api/cron/process-pending-trades` is invoked from the web at key times (app load, after `/api/trading/execute`, and on a polling interval) and also by the worker in `src/lib/pending-paper-trades.ts`.

---

## 14. Environment Variables

Collected from routes, services, README and `.env*` files. Required for full functionality:

**Core**
- `DATABASE_URL` — Postgres URL (Azure or local).
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth.

**AI**
- `GEMINI_API_KEY` — default system LLM (required for Compute 0.5 fallback).
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — optional extras for `ai-providers.ts`.
- `DEEPSEEK_API_KEY` — DeepSeek API key for the intent classifier router.
- `DEEPSEEK_BASE_URL` — optional override (default `https://api.deepseek.com/v1`). Set to your LiteLLM proxy if needed.
- `DEEPSEEK_MODEL` — optional model override (default `deepseek-chat`).
- `AZURE_OPENAI_API_KEY` (or `AZURE_OPENAI_KEY` or `AZURE_API_KEY`) — Azure OpenAI key that powers `Compute 1.0`.
- `AZURE_OPENAI_RESOURCE_NAME` (or `AZURE_RESOURCE_NAME`) — Azure resource name used to build the endpoint URL. Alternatively set `AZURE_OPENAI_BASE_URL` or `AZURE_OPENAI_ENDPOINT` for a fully custom endpoint. **Both** a key **and** (resource name **or** base URL) are required for Azure; key‑only is not enough and triggers Gemini fallback for Compute 1.0.
- `AZURE_OPENAI_DEPLOYMENT_COMPUTE_10` — override the Azure deployment name that serves `Compute 1.0` (default `gpt-5.4`).
- `AZURE_OPENAI_API_VERSION` — optional override (defaults to the AI SDK's preview version).
- `GEMINI_MODEL_COMPUTE_05` — override the Gemini model served behind `Compute 0.5` (default `gemini-3.1-flash-lite-preview`).

**Angel One**
- `ANGELONE_API_KEY` (aka `ANGEL_API_KEY`).
- `ANGELONE_CLIENT_ID`.
- `ANGELONE_SECRET_KEY`.
- `ANGELONE_TOTP_TOKEN` — base32 TOTP secret.

**Web search / Scraping**
- `SERPER_API_KEY` (primary).
- `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_ID` (fallback).
- `FIRECRAWL_API_KEY` — powers Morningstar India and PMS Bazaar integrations via Firecrawl search + scrape.

**EC2 / live**
- `EC2_LIVE_SERVER_URL` — default `http://13.203.192.234:8080`.
- `MAX_EC2_QUOTE_AGE_SECONDS` (default 180), `MAX_EC2_QUOTE_FUTURE_DRIFT_SECONDS` (default 90).
- `LIVE_PRICE_BATCH_LIMIT` (default 120) — bounds per-request Yahoo fallback symbols loaded from `Stock`.
- `LIVE_PRICE_YAHOO_CACHE_TTL_MS` (default 15000), `LIVE_PRICE_DB_SYMBOL_CACHE_TTL_MS` (default 60000).

**Trading**
- `LIVE_TRADING_ENABLED` (`true`/`false`, default `false`).
- `LIVE_MAX_ORDER_VALUE` (default 500000).
- `BROKER_CREDS_ENC_KEY` — AES key for `crypto.ts`.

**Telegram**
- `TELEGRAM_BOT_TOKEN`.

**Cron**
- `CRON_SECRET` — header `Authorization: Bearer <secret>` guards Vercel crons.
- `CRON_CANDLE_CHUNK_DAYS` (default 30), `CRON_SYMBOL_BATCH_SIZE` (default 80), `CRON_PARALLEL_STOCK_BATCH_SIZE` (default 2), `CRON_PROCESSING_BUDGET_MS` (default 240000), `CRON_SYMBOL_CURSOR_KEY`, `CRON_MAX_CATCHUP_DAYS` (default 35), `CRON_RETENTION_MONTHS` (default 1).

**Mail (Nodemailer / `email.service.ts`)**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

**Razorpay Subscriptions (Pro autopay at `/pricing`)**
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID` (server — subscription create + verify).
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` — public key for checkout.js.
- `RAZORPAY_WEBHOOK_SECRET` — Razorpay Dashboard webhook signing secret for renewals.
- Flow: `POST /api/create-order` creates a Razorpay subscription; checkout opens with `subscription_id`; `POST /api/verify-payment` verifies auth payment; `POST /api/payments/razorpay-webhook` extends Pro on `subscription.charged`.

See `.env.example` / `.env.production` / `.env.development.local` for templates.

---

## 15. Deployment Targets

- **Vercel** *(primary)* — `vercel.json` sets the build/install commands, crons and a rewrite `/auth/signin → /login`. Use `@prisma/client` with `prisma generate` during `postinstall` and `build`.
- **Azure App Service** — supported via `Dockerfile`, `startup.sh`, `deploy-azure.sh`, `deploy-appservice.sh`, `azure-publish-profile.xml`, `AZURE_DEPLOYMENT.md`.
- **EC2 (Ubuntu)** — for `ec2-live-server/` only. Runs behind systemd unit `istocks-live` on port 8080.
- **Android** — Capacitor wraps `https://www.istocks.codes`. Build via `npm run mobile:build:release` (see `capacitor.config.ts`). OAuth domains are whitelisted in `allowNavigation` so Google login stays inside the WebView.

---

## 16. Authentication & Authorization

- `src/lib/auth.ts` defines `authOptions` and the typed `getAuthSession()` helper.
- Sessions are JWT (30‑day max). `session.user.id` is populated from the JWT.
- Google OAuth is handled by the Prisma adapter; `CredentialsProvider` uses bcryptjs with a single generic error message ("Invalid email or password") to avoid user enumeration.
- Custom flows (signup / forgot / reset / verify) live under `/app/api/auth/*` and send email via `email.service.ts`.
- Authorization is always checked per route (e.g., `/api/sangraha`, `/api/trading/**`, `/api/chat`, `/api/user/llm-settings`).

---

## 17. Quotas, Safety, and Observability

- **Prompt quota** — 10 AI messages/month per user (`user-limit.ts`). The `POST /api/chat` and `POST /api/chat/stream` endpoints return `429` + `limitReached: true` when exceeded.
- **Live‑trading safety**
  - Global feature flag `LIVE_TRADING_ENABLED`.
  - Per‑order value cap `LIVE_MAX_ORDER_VALUE`.
  - `confirmed` flag required on the request (UI shows `TradeExecutionModal`).
  - Quote freshness (`getFreshEC2Quote`) and market session (`isNSEMarketSessionLive`) must pass.
  - Idempotency key enforced (unique on `TradingOrder.idempotencyKey`).
- **SQL resiliency** — AI‑generated SQL passes through `sqlSanitizer.ts`; failures are fingerprinted in `SqlErrorLog` (via `sqlErrorStore.ts`) so the model can be told to avoid repeat mistakes.
- **Query logging** — `query-logger.ts` records each run for the iteration‑review tool.
- **Iteration review** — `/iteration` + `scripts/run-iteration-review.ts` replays curated prompts through `runAIEngine` and grades each case `pass | warning | fail` with a score — the baseline regression suite for the AI.

---

## 18. Typical Data / Request Flows

### 18.1 User asks "Should I buy Reliance today?" in `/database-chat`
1. `DatabaseChat.tsx` POSTs to `/api/chat/stream`.
2. `auth.ts` authenticates the user; `user-limit.ts` increments the prompt counter.
3. `runAIEngine` is called with the prior memory and streams events over SSE.
4. `intent-classifier.ts` keyword‑routes "today" → `ec2_live`.
5. `ec2-helpers.ts` fetches the live snapshot from the EC2 server and re‑derives indicators from 1‑minute candles.
6. The LLM (system Gemini or user's configured one via `llm-client.ts`) drafts an answer with Entry / Target / Stop / RR. If a trade is requested, `tradeCommandResolver.ts` extracts a draft.
7. Trade draft → `trade_intent` event → UI renders a confirmation card → user clicks confirm → `/api/trading/execute` → `executor.ts` persists a `TradingOrder`.

### 18.2 Nightly data update
1. Vercel invokes `/api/cron/update-stocks` (Bearer `CRON_SECRET`).
2. `CronCursorState` tells the route where it left off; the next 80 symbols are processed in batches of 2 parallel.
3. Angel One SmartAPI provides 1‑min candles; `stockPrice.createMany({ skipDuplicates: true })` inserts them.
4. `technicalIndicatorsService.calculateAllIndicators` re‑runs for the most recent 500 rows and backfills the indicator columns.
5. Rows older than 1 month are deleted (retention).
6. The cursor advances; response summarizes inserted/deleted counts.

### 18.3 Daily "best stocks" generation
1. `/api/cron/generate-daily-stock-selection` runs at 10:30 UTC.
2. `best-stock-selector.selectBestStocks()` scans the DB for eligibility (price, SMA alignment, RSI band, liquidity), scores technical + web sentiment, ranks top N.
3. Results are persisted as `DailyStockSelectionRun` + `DailyStockSelectionResult`.
4. The chatbot can now answer "suggest a stock" instantly from the stored ranking via `getLatestDailyStockSelection()`.

---

## 19. Getting Started (for a new developer)

```bash
# 1. install
npm install

# 2. set env
cp .env.example .env.local
# fill DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET,
#      GEMINI_API_KEY, GOOGLE_CLIENT_ID/SECRET,
#      ANGELONE_*, SERPER_API_KEY, EC2_LIVE_SERVER_URL,
#      BROKER_CREDS_ENC_KEY, TELEGRAM_BOT_TOKEN, CRON_SECRET

# 3. database
npx prisma generate
npx prisma db push
npm run db:seed          # optional — imports WIPRO sample data

# 4. dev
npm run dev              # Next.js on http://localhost:3002

# 5. (optional) live price server
cd ec2-live-server
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py           # http://localhost:8080

# 6. (optional) mobile
npm run mobile:sync
npm run mobile:open
```

Key entry points to read first:

1. `src/lib/ai-engine.ts` — how the chat works end‑to‑end.
2. `src/lib/trading/executor.ts` — how orders are placed.
3. `prisma/schema.prisma` — every persisted field.
4. `src/components/DatabaseChat.tsx` — the main UI.
5. `src/app/api/cron/update-stocks/route.ts` — how data stays fresh.

---

## 20. Changelog

- 2026-05-18: **Option B architecture — category routing + filtered tools** — replaced all 8 brittle regex pre‑agent intercepts (`earlyScanner`, `priceRangeHint`, `bestStockRankingRequest`, `isIntradayIndicatorRequest`, `isConversationalCorrection`, second scanner block, `priceRangeScreenRequest`, `benchmarkComparisonRequest`, `routeQueryWithLLM`) with a clean two‑stage pipeline. DeepSeek now classifies every query into one of 10 categories via `classifyQueryCategory()` (new export in `intent-classifier.ts`); `filterToolsForCategory()` in `ai-engine.ts` then hands Claude only the tools relevant to that category, eliminating false positives (e.g. "PSU stocks under ₹500 with bounce potential" previously matched price‑range regex and ignored PSU/bounce criteria; now category=`screener` → Claude calls `dynamicScreener` with full criteria). Added `dynamicScreener(query)` agent tool that wraps `enhancePrompt` + `runDynamicScreener` for multi‑criteria screening. Tool subsets: `screener` → `[dynamicScreener, screenByPriceRange, queryMarketDatabase, getMarketMovers]`; `single_stock` → `[findStock, analyzeStock, queryMarketDatabase]`; `pms` → `[queryPMSBazaar, webSearch]`; `trade` → `[findStock, analyzeStock, getMarketMovers]`; `greeting`/`other` → all tools.
- 2026-05-16: **DeepSeek intent classifier** — replaced Bedrock/Gemini classifier with DeepSeek (`deepseek-chat` via OpenAI‑compatible API) as the primary LLM router. Falls back to AWS Bedrock (Claude Sonnet 4.6) on failure. Added `src/lib/deepseek-provider.ts`, `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` env vars.
- 2026-05-16: **Date context injection** — added `src/lib/date-context.ts` (`getDateContext()`) that prepends `[TODAY'S DATE: <day>, <date> IST]` to every LLM prompt (router, system, screener, rewrite, final synthesis, experts). Prevents models from hallucinating stale years (2024/2025) when users ask for "latest", "today", "recent" data.
- 2026-05-10: **Morningstar India integration** — added `src/lib/morningstar.ts` and `queryMorningstar` tool to the Yahoo agent. Searches `morningstar.in` via Firecrawl for mutual fund analyst reports, star ratings, pillar ratings, fund manager info, performance vs benchmark, risk analysis, expense ratio. Requires `FIRECRAWL_API_KEY`.
- 2026-05-10: **Multi‑source synthesis for MF/PMS** — SYSTEM_PROMPT now requires the agent to call **both** `queryPMSBazaar` and `queryMorningstar` (when relevant) and synthesize a single answer from multiple sources rather than answering from one tool in isolation.
- 2026-05-08: **Portfolio intent classification** — added `classifyPortfolioIntent(message)` in `intent-classifier.ts` (DeepSeek‑powered) and `POST /api/chat/classify-portfolio` route. Detects when the user asks about their personal portfolio ("my holdings", "mera portfolio", "compare with my portfolio"). `DatabaseChat.tsx` fetches live broker + paper holdings via `/api/trading/broker-portfolio` and injects the portfolio context into the AI prompt before answering.
- 2026-05-05: **Broker portfolio sync** — added `/api/trading/broker-portfolio` route. Aggregates live holdings from Zerodha (`/portfolio/holdings`), Dhan, and Groww (`/v1/holdings/user`), fetches live prices via cascading price feed, computes unrealized P&L, and returns a unified portfolio view. `HoldingsView.tsx` now has a "Broker Portfolio" tab.
- 2026-05-01: **Price range screener** — added `screenByPriceRange(min, max, limit)` tool to the Yahoo agent and `src/lib/price-range-screener.ts`. Screens all NSE stocks by share price range, filters liquid names (volume ≥50k/day), computes trading levels + sentiment, and returns ranked picks. `PriceRangeScreenerMessage.tsx` renders custom markdown cards for these results.
- 2026-04-27: **Live price API — batch + timeouts** — Vercel uses `POST /api/live-price` + EC2 `POST /prices/batch` to avoid full multi‑thousand‑symbol JSON and 5s proxy timeouts; longer timeouts for full feed; GZip on EC2. **Live price grid when EC2 is down** — `GET /api/live-price` (no query) returns Yahoo quotes for a batch of symbols from the `Stock` table when EC2 is unreachable or empty.
- 2026-04-27: **Holdings exit — instant UI + faster PATCH** — `HoldingsView` marks the row **CLOSED** and removes it from the Live tab immediately (optimistic update); rolls back if the API errors. `PATCH /api/holdings` accepts the displayed `exitPrice` and skips redundant quotes (`client-display`); when no client price, EC2 and Yahoo are fetched in parallel.
- 2026-04-27: **Holdings paper exit Yahoo fallback (wired)** — `PATCH /api/holdings` previously blocked exits whenever `getFreshEC2Quote` failed, even though `GET` already displayed Yahoo prices. Exit now uses `fetchLiveMarketQuote` when EC2 is unavailable during live session (aligned with `trading/executor.ts`); response includes `exitPriceSource` (`ec2-live` | `yahoo-live-fallback`).
- 2026-04-28: **Holding Period Calculation** — `calculateHoldingPeriod(entry, target, last30Closes)` added to `trading-levels.ts`. O(n) pure function: average daily move → days-to-target → safety clamp (1–90d) → label. `fetchLast30Closes(symbol)` queries `StockPrice` via Prisma, falls back to Yahoo Finance 3mo daily. EC2 live path fetches closes in parallel with snapshot (zero latency). Holding label shown in every stock answer: `⏱️ Hold: 3–10 days`.
- 2026-04-27: **Deterministic Trading Levels Engine** — added `src/lib/trading-levels.ts` module. Auto‑calculates Entry/Stop-Loss/Target/Support/Resistance for every stock response. Core: `calculateTradingLevels()` from OHLCV, `calculateTradingLevelsFromSnapshot()` from live indicators. Integrated into EC2 live path: levels injected into prompt + appended to final answer. Confidence scoring (0–100) uses ADX strength, Supertrend alignment, RSI zone, MACD histogram, volume.
- 2026-04-27: **Live price grid when EC2 is down (detail)** — Fixed `/stocks` card showing a stray **0** when `volume` was `0` (falsy `&&` rendered the number).
- 2026-05-24: **Razorpay Subscriptions (autopay)** — `/pricing` creates a Razorpay subscription per checkout (`RAZORPAY_PLAN_ID`), opens checkout with `subscription_id`, verifies `payment_id|subscription_id` signature, and handles renewals via `POST /api/payments/razorpay-webhook` (`subscription.charged`, etc.). Env: `RAZORPAY_WEBHOOK_SECRET`.
- 2026-05-19: **Razorpay restored / Cashfree removed** — `/pricing` uses Razorpay Standard Checkout (`checkout.js`), `POST /api/create-order`, and `POST /api/verify-payment`. Cashfree SDK, `src/lib/cashfree.ts`, and `/api/payments/*` routes are disabled. Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
- 2026-04-26: **Cashfree restored / Razorpay paused (superseded)** — `/pricing` was on Cashfree SDK v3; reverted to Razorpay on 2026-05-19.
- 2026-04-23: **Market scanners** — added `src/lib/market-scanners.ts` and wired it into `runAIEngine` before the generic daily "best stocks" path. Deterministic SQL over `StockPrice` for universe questions: near 52‑week low/high, deepest drawdown from peak, biggest gainers/losers over N **trading** sessions (default **20** when N omitted), RSI oversold/overbought, Bollinger proximity, golden/death cross, MACD bullish/bearish cross, above SMA200 / below SMA50, unusual volume (>3× 20‑day avg). Hinglish phrase support; shared liquidity floor (₹2 Cr 20‑d avg traded value, etc.). Empty scanner result falls back to normal routing. Skips when the user message explicitly names a stock.
- 2026-04-23: **Experts Probability Panel** — added `/experts` page with three‑agent (Krishna / Chanakya / Aryabhata) parallel probability analysis, 2–3 round panel discussion, and weighted final verdict. New files: `src/lib/probability-agents/**` (7 files), `src/app/api/experts/**` (3 routes), `src/components/ExpertsChat.tsx`, `src/app/experts/page.tsx`. DB: `ExpertsSession` + `ExpertsAnalysis` tables. Navbar updated with Experts link.
- 2026-04-23: **Holdings paper exit** — `PATCH /api/holdings` uses Yahoo live quote as fallback when EC2 quote is unavailable during market hours (same idea as paper entry in `executor.ts`); stores `exitPriceSource` on the order. LIVE exits unchanged.
- 2026-04-23: **Trading Agent markdown** — assistant replies in `DatabaseChat.tsx` render via `react-markdown` + `remark-gfm` so markdown from the model (e.g. `**bold**`, bullets) displays correctly.
- 2026-04-23: **Web search path** — broader `fastRouteOverride` finance keywords; richer Serper query for short follow‑ups (memory‑injected stock context); two‑pass search (7‑day relaxed window then unrestricted); richer summarisation instructions (multi‑source, citations, bottom line).
- 2026-04-23: **Azure env aliases** — `compute-models.ts` accepts `AZURE_RESOURCE_NAME`, `AZURE_API_KEY`, `AZURE_OPENAI_ENDPOINT` in addition to `AZURE_OPENAI_*`.
- 2026-04-22: Added the **Compute model selector** to the Trading Agent (`/database-chat`). The prompt bar now has a third dropdown (next to PAPER/LIVE and broker) showing `Compute 1.0` (Azure OpenAI / GPT‑5.4) and `Compute 0.5` (Gemini `gemini-3.1-flash-lite-preview`); `Compute 0.2` and `Compute 0.1` are deprecated and hidden. Added `src/lib/compute-models.ts` (server registry + AI‑SDK factories with an Azure→Gemini fallback) and `src/lib/compute-models.client.ts` (client‑safe label list); selection is persisted in `localStorage` under `istocks.computeModel` and threaded through `/api/chat`, `/api/chat/stream`, and `/api/stocks/[symbol]/analyze/stream` as the `computeModel` field. `runAIEngine` now uses the resolved Compute for all user‑facing completion calls while keeping intent classification and language‑rewrite passes on system Gemini. Added `@ai-sdk/azure` and new `AZURE_OPENAI_*` / `GEMINI_MODEL_COMPUTE_05` env vars.
- 2026-04-22: Rewrote `ALL.md` as a full onboarding reference covering features, stack, schema, routes, libraries, services, EC2 server, scripts, crons, env vars, deployment, auth, quotas, and typical data flows.
- 2026-04-16: Restored stock-page AI thinking steps by moving `/api/stocks/[symbol]/analyze` UI flow to SSE (`/stream`) and rendering real backend `thinking/tool/routing` events in `AIChat`; fixes `0 steps` issue during Analyze Market Data.
