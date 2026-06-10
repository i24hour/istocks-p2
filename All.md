# iStocks — Complete Architecture & Feature Documentation

**Last Updated**: 2026-05-08
**Status**: Production
**Domain**: istocks.codes

---

## Table of Contents

1. [Infrastructure Architecture](#1-infrastructure-architecture)
2. [Tech Stack](#2-tech-stack)
3. [Broker Integration & Static IP Proxy](#3-broker-integration--static-ip-proxy)
4. [AI Features — Database Chat & Experts](#4-ai-features--database-chat--experts)
5. [Usage Limits & Plans](#5-usage-limits--plans)
6. [Trading System](#6-trading-system)
7. [Data Fetching Pipeline](#7-data-fetching-pipeline)
8. [Share Links](#8-share-links)
9. [Stock Screening & Discovery](#9-stock-screening--discovery)
10. [Environment Variables](#10-environment-variables)
11. [Key File Map](#11-key-file-map)

---

## 1. Infrastructure Architecture

### Deployment Overview

```
User Browser
    ↓
Vercel (frontend + most API routes)
    ├─ Next.js 14 App Router
    ├─ All /api/* routes EXCEPT broker calls
    └─ Connects to ↓

Azure Container Apps — broker-proxy (NEW)
    ├─ Central India region
    ├─ Static egress IP: 4.224.60.60 (Pune, Microsoft AS8075)
    ├─ 0.25 vCPU / 0.5 GB, 1-3 replicas auto-scale
    ├─ HMAC-signed request validation
    └─ Forwards broker API calls from whitelisted IP

Azure NAT Gateway → 4.224.60.60 (static)
Azure VNet 10.0.0.0/16 → subnet 10.0.0.0/23
Azure Container Registry: istocksacr.azurecr.io
Azure Log Analytics: istocks-logs

EC2 (AWS, 13.203.192.234)
    ├─ Angel One WebSocket → live price feed
    └─ Pushes LTP updates to DB every ~2.5 seconds

Database (Azure — separate account)
    └─ PostgreSQL via Prisma ORM

Amazon Bedrock (ap-south-1 Mumbai)
    └─ claude-sonnet-4-6 for AI analysis
```

### Request Flow — Broker Call

```
Frontend
  → Vercel /api/trading/execute
  → GrowwAdapter.placeOrder()
  → brokerFetch() [HMAC-signs request]
  → broker-proxy Container App (Azure, Central India)
  → NAT Gateway (egress as 4.224.60.60)
  → api.groww.in ✅ (whitelisted IP)
```

### Azure Resource Group: istocks-prod

| Resource | Type | Details |
|----------|------|---------|
| `istocks-broker-ip` | Static Public IP | 4.224.60.60 (Standard SKU) |
| `istocks-vnet` | VNet | 10.0.0.0/16 |
| `containerapps-subnet` | Subnet | 10.0.0.0/23, delegated to Microsoft.App |
| `istocks-nat` | NAT Gateway | Bound to static IP + subnet |
| `istocksacr` | Container Registry | Basic, Central India |
| `istocks-logs` | Log Analytics | 30-day retention |
| `istocks-env` | Container Apps Env | Central India, VNet-integrated |
| `broker-proxy` | Container App | 0.25 vCPU/0.5 GB, image: broker-proxy:v1 |

**Monthly cost: ~$46 (paid from $10k Azure credits — ~216 months runway)**

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS + Framer Motion |
| Auth | NextAuth.js |
| Database | PostgreSQL + Prisma ORM (Azure) |
| AI — Experts | Anthropic Claude (direct API, via Bedrock) |
| AI — DB Chat | Amazon Bedrock (`global.anthropic.claude-sonnet-4-6`) |
| Broker Proxy | Express + TypeScript on Azure Container Apps |
| Price Feed | EC2 WebSocket (Angel One) + Yahoo Finance |
| Payments | Razorpay |
| Search | Serper API + Google Custom Search fallback |
| Deployment | Vercel (frontend) + Azure Container Apps (broker) |

---

## 3. Broker Integration & Static IP Proxy

### Why Static IP

SEBI mandated (April 2, 2026) that all broker API access must originate from a whitelisted static IP. Vercel serverless functions have dynamic IPs and cannot be whitelisted.

**Solution**: Thin proxy service running on Azure Container Apps with static NAT egress.

### Proxy Architecture

**`broker-proxy/src/server.ts`** — Express server on port 3000

```
POST /proxy
  ← Vercel sends: { method, url, headers, body }
  ← Headers: x-proxy-signature (HMAC-SHA256), x-proxy-timestamp
  → Validates signature + timestamp (max 60s drift)
  → Validates target URL against allowlist
  → Forwards HTTP call from static IP 4.224.60.60
  → Returns: { status, headers, body }

GET /health
  → { ok: true, service: "broker-proxy", allowedHosts: [...] }
```

**Allowed broker hosts:**
- `api.groww.in`
- `api.kite.trade` / `kite.zerodha.com`
- `api.dhan.co` / `auth.dhan.co`
- `api.upstox.com`

### Vercel-Side Helper

**`src/lib/brokers/proxy-fetch.ts`** — Drop-in `fetch` replacement

```typescript
// Env vars required on Vercel:
BROKER_PROXY_URL=https://broker-proxy.ashyplant-21fb8cce.centralindia.azurecontainerapps.io
BROKER_PROXY_SECRET=<32-byte-hex-secret>

// Falls back to direct fetch if env vars not set (local dev)
export async function brokerFetch(url: string, init?: RequestInit): Promise<Response>
```

All 3 broker adapters import and use `brokerFetch` instead of native `fetch`:
- `src/lib/brokers/groww.adapter.ts`
- `src/lib/brokers/zerodha.adapter.ts`
- `src/lib/brokers/dhan.adapter.ts`

### Broker Adapters

| Broker | Auth Flow | Token Refresh |
|--------|-----------|---------------|
| **Groww** | API Key + Secret → access token via `/v1/token/api/access` | Daily at 6 AM IST (auto) |
| **Zerodha** | OAuth (Kite) → request_token → access_token | Manual re-login required |
| **Dhan** | OAuth consent flow → tokenId → accessToken | Expires per Dhan policy |

### User Setup Flow (Groww example)

1. User opens `groww.in/trade-api/api-keys`
2. Clicks **"Update static IP"** → enters `4.224.60.60`
3. Clicks **"Generate API key"** (NOT "Generate Access Token")
4. Copies API Key + API Secret
5. Opens iStocks → `/trading/settings` → Groww card
6. Pastes credentials → **Save** → **Connect**
7. Backend calls Groww API via proxy → stores access token
8. Daily 6 AM reset handled automatically via `refreshIfNeeded()`

**Important**: "Generate Access Token" (TOTP/Direct) is for manual use only. Our platform needs the long-lived API Key + Secret pair.

### Credentials Encryption

Credentials stored AES-256-GCM encrypted in DB via `src/lib/crypto.ts`.

Required env var: `BROKER_CREDS_ENCRYPTION_KEY` (64-char hex or 32-byte base64)

---

## 4. AI Features — Database Chat & Experts

### Database Chat (`/database-chat`)

AI chat interface for natural language stock queries.

**Request flow:**
```
User Message
  → Intent Classifier (Bedrock) → ec2_live | web_search | yahoo_agent
  → Path Handler
  → Response (streaming SSE)
```

**Rate limits**: 10 prompts/day (free), unlimited (pro)

**Usage limits enforced in**: `src/lib/prompt-limit.ts` + `/api/chat` route

### Experts Analysis (`/experts`)

Three-agent probability system (Krishna / Chanakya / Aryabhata).

**Request flow:**
```
POST /api/experts/analyze
  → checkAndIncrementExpertLimit(userId)   ← returns 429 if exceeded
  → runExperts() [streaming SSE]
  → 2 discussion rounds between agents
  → final_probability event
```

**Rate limits**: 10 analyses/month (free), 50/month (pro). Resets on 1st of each month IST.

**Key files:**
- `src/lib/probability-agents/` — agent logic
- `src/lib/expert-limit.ts` — monthly limit check/increment
- `src/app/api/experts/analyze/route.ts` — enforces limit before streaming

### AI Models

| Feature | Model | Provider |
|---------|-------|---------|
| Database Chat | `global.anthropic.claude-sonnet-4-6` | Amazon Bedrock (ap-south-1) |
| Experts Analysis | Claude (direct Anthropic API) | Anthropic |
| Query Routing | Bedrock (0-temp) | Amazon Bedrock |
| Screener Intent | Bedrock + regex fallback | Amazon Bedrock |

---

## 5. Usage Limits & Plans

### Plans

| Feature | Free | Pro |
|---------|------|-----|
| AI Chat prompts | 10/day | Unlimited |
| Experts analyses | 10/month | 50/month |
| Reset schedule | Daily (midnight IST) | Monthly (1st of month IST) |

### Database Schema (User model)

```prisma
dailyPromptCount     Int       @default(0)
dailyPromptResetAt   DateTime?
monthlyExpertCount   Int       @default(0)
monthlyExpertResetAt DateTime?
plan                 String    @default("free")  // "free" | "pro"
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/expert-limit.ts` | `checkAndIncrementExpertLimit()`, `getExpertUsage()` |
| `src/lib/prompt-limit.ts` | Daily prompt check/increment |
| `src/app/api/user/usage/route.ts` | GET — returns full usage stats |
| `src/app/account/usage/page.tsx` | UI — usage dashboard with progress bars |

### Usage API Response

```json
{
  "plan": "free",
  "prompts": { "used": 3, "limit": 10, "remaining": 7, "period": "daily" },
  "experts": { "used": 2, "limit": 10, "remaining": 8, "resetsOn": "2026-06-01", "model": "Angle 3.1" }
}
```

---

## 6. Trading System

### Architecture

```
/trading/settings   ← User connects broker (save creds → connect)
/trading            ← Trade execution UI
/api/trading/*      ← Vercel routes (DB logic)
broker-proxy        ← Azure (outbound broker API calls)
```

### Key Routes

| Route | Purpose |
|-------|---------|
| `/api/trading/brokers/[broker]/credentials` | Save encrypted API Key + Secret |
| `/api/trading/brokers/[broker]/connect/start` | Initiate OAuth / token exchange |
| `/api/trading/brokers/[broker]/callback` | Complete auth, store access token |
| `/api/trading/brokers/[broker]/disconnect` | Clear token, set isConnected=false |
| `/api/trading/execute` | Place order via executor |
| `/api/trading/holdings` | Fetch holdings from broker |
| `/api/trading/positions` | Fetch intraday positions |
| `/api/trading/orders` | Fetch order book |

### Paper vs Live Mode

Users toggle between PAPER (simulated) and LIVE (real broker) in `/trading/settings`.

Paper trades stored in DB, processed by:
- `src/app/api/paper-trade/` — paper trade endpoints
- `src/app/api/cron/process-pending-trades/` — executes pending paper orders

### Trading Settings UX

- Connect button **disabled** until credentials are saved (prevents confusing errors)
- Per-card inline error display (errors don't get lost off-screen)
- Groww card includes step-by-step setup guide with copyable static IP `4.224.60.60`

---

## 7. Data Fetching Pipeline

### Real-Time Price Sources

```
EC2 (13.203.192.234) — Angel One WebSocket
  ├─ NSE live prices (LTP, OHLC, volume)
  ├─ Index data (NIFTY 50, SENSEX, etc.)
  └─ Updates DB every ~2.5 seconds (market hours)

Yahoo Finance
  ├─ Historical OHLCV (daily/weekly/monthly)
  ├─ Quote (latest price, change%)
  └─ Available 24/7

PostgreSQL (StockPrice table)
  └─ Last known prices from cron/EC2 feed
```

### Cascading Price Fetch

```typescript
fetchCascadingPrice(symbol)
  ├─ Level 1: EC2 snapshot (realtime, 🟢)
  ├─ Level 2: Yahoo batchQuote (latest, 🟡)
  ├─ Level 3: OHLCV daily close (historical, 🔵)
  └─ null → fallback to yahoo_agent path
```

### Stock Search

- Returns all stocks including indices (NIFTY50, SENSEX) — no longer filtered by `latestPrice !== null`
- Stale prices (>24h old) shown with amber "old" badge in `StockSearchModal`

---

## 8. Share Links

Public read-only shareable links for chat conversations.

### Flow

```
User → clicks Share in chat sidebar
  → POST /api/chat/sessions/[sessionId]/share
  → generates 16-char hex shareId, saved to ChatSession
  → Returns { shareId, url: /share/[shareId] }

Anyone with link → /share/[shareId]
  → GET /api/share/[shareId]
  → Public page (no auth required)
  → Shows messages (user + assistant only)
  → Cannot continue conversation
```

### Database

```prisma
ChatSession {
  shareId String? @unique   // null = not shared
}
```

### Markdown Rendering

`src/components/MarkdownMessage.tsx` — shared component used in both DatabaseChat and share page for consistent rendering (tables, code blocks, etc.).

---

## 9. Stock Screening & Discovery

### Screening Flow

```
User: "best undervalued pharma stocks"
  → Intent Classifier → yahoo_agent
  → enhancePrompt(query) → { intent: "undervalued", sector: "pharma", topN: 5 }
  → runDynamicScreener(criteria)
    ├─ Phase 1: Run SQL scanners in parallel
    ├─ Phase 2: Compute indicators for all candidates
    ├─ Phase 3: Score + rank by intent-specific weights
    └─ Phase 4: Refresh live prices via cascading fetch
  → LLM formats answer
```

### Scoring Weights

| Intent | RSI | Momentum | SMA Trend | Volume | MACD |
|--------|-----|----------|-----------|--------|------|
| Oversold/Undervalued | 0.35 (inverted) | 0.25 (inverted) | 0.20 | 0.15 | 0.05 |
| Momentum | 0.25 | 0.35 | 0.25 | 0.10 | 0.05 |

### Trading Levels Formula

```
Entry    = currentPrice
StopLoss = currentPrice - (ATR14 × 1.5)
Target   = nextSMAAbovePrice (SMA50 or SMA200)
           OR currentPrice + (ATR14 × 3)
R:R      = (Target - Entry) / (Entry - StopLoss)
```

---

## 10. Environment Variables

### Vercel (Production)

```bash
# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://istocks.codes

# Database
DATABASE_URL=postgresql://...

# Amazon Bedrock (AI)
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6

# Anthropic (Experts)
ANTHROPIC_API_KEY=

# Azure Broker Proxy (NEW — SEBI static IP)
BROKER_PROXY_URL=https://broker-proxy.ashyplant-21fb8cce.centralindia.azurecontainerapps.io
BROKER_PROXY_SECRET=<32-byte-hex>

# Broker credential encryption
BROKER_CREDS_ENCRYPTION_KEY=<64-char-hex>

# Groww API
GROWW_API_BASE_URL=https://api.groww.in
GROWW_API_VERSION=1.0
GROWW_TOKEN_KEY_TYPE=approval

# Payments
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=

# Search
SERPER_API_KEY=
GOOGLE_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=

# Static IP (shown in UI for broker whitelist)
NEXT_PUBLIC_BROKER_STATIC_IP=4.224.60.60

# EC2 price feed
EC2_BASE_URL=http://13.203.192.234:3000
```

### Azure Container Apps — broker-proxy

```bash
PROXY_SHARED_SECRET=<same as BROKER_PROXY_SECRET>
ALLOWED_HOSTS=api.groww.in,api.kite.trade,api.dhan.co,kite.zerodha.com,api.upstox.com,auth.dhan.co
PORT=3000
```

---

## 11. Key File Map

### New Files (2026-05)

| File | Purpose |
|------|---------|
| `broker-proxy/src/server.ts` | Express proxy server (HMAC-validated, IP-allowlisted) |
| `broker-proxy/Dockerfile` | Multi-stage Node 20 Alpine image |
| `broker-proxy/package.json` | Standalone package (not part of Next.js build) |
| `src/lib/brokers/proxy-fetch.ts` | Drop-in `fetch` → Azure proxy for broker calls |
| `src/lib/expert-limit.ts` | Monthly expert analysis limit check/increment |
| `src/lib/prompt-limit.ts` | Daily chat prompt limit check/increment |
| `src/app/api/user/usage/route.ts` | Usage stats endpoint |
| `src/app/account/usage/page.tsx` | Usage dashboard UI |
| `src/app/api/experts/analyze/route.ts` | Experts streaming with limit enforcement |
| `src/app/share/[shareId]/page.tsx` | Public read-only shared conversation |
| `src/app/api/share/[shareId]/route.ts` | Public share API |
| `src/app/api/chat/sessions/[sessionId]/share/route.ts` | Create/revoke share links |
| `src/components/MarkdownMessage.tsx` | Shared markdown renderer (chat + share page) |

### Modified Files (2026-05)

| File | Change |
|------|--------|
| `src/lib/brokers/groww.adapter.ts` | Uses `brokerFetch` (routes via Azure proxy) |
| `src/lib/brokers/zerodha.adapter.ts` | Uses `brokerFetch` |
| `src/lib/brokers/dhan.adapter.ts` | Uses `brokerFetch` |
| `src/app/trading/settings/page.tsx` | Groww setup guide, per-card errors, disabled Connect until saved |
| `src/app/pricing/page.tsx` | Expert limits in FREE/PRO features, Angle 3.1 branding |
| `src/components/ExpertsChat.tsx` | Usage display, 429 limit error UI, Usage sidebar link |
| `src/components/DatabaseChat.tsx` | Usage sidebar link |
| `src/app/api/stocks/route.ts` | Removed `latestPrice !== null` filter (fixes index stocks) |
| `prisma/schema.prisma` | Added `dailyPromptCount`, `monthlyExpertCount`, `shareId` fields |
| `tsconfig.json` | Excluded `broker-proxy/` from Next.js TypeScript project |

### Core Existing Files

| File | Purpose |
|------|---------|
| `src/lib/ai-engine.ts` | Main DB Chat pipeline (routing + LLM + data) |
| `src/lib/probability-agents/` | Experts 3-agent system |
| `src/lib/dynamic-screener.ts` | Multi-phase stock screening |
| `src/lib/cascading-price-fetch.ts` | 3-level price fallback |
| `src/lib/market-scanners.ts` | SQL-based stock discovery |
| `src/lib/trading/executor.ts` | Order execution logic |
| `src/lib/crypto.ts` | AES-256-GCM credential encryption |
| `src/lib/razorpay.ts` | Payment gateway integration |
| `src/components/ExpertsChat.tsx` | Experts UI with streaming + usage |
| `src/components/DatabaseChat.tsx` | DB Chat UI with sharing |

---

## Migrations Applied (2026-05)

```
20260504000000_add_user_daily_prompt_fields
  → User: dailyPromptCount, dailyPromptResetAt

20260504010000_add_chat_session_share_id
  → ChatSession: shareId (unique, nullable)

20260507000000_add_user_monthly_expert_fields
  → User: monthlyExpertCount, monthlyExpertResetAt
```

---

## Branding Notes

- AI analysis features branded as **"Angle 3.1"** throughout the UI
- Used in: Experts chat, usage page, pricing page, DB chat sidebar
- NOT the underlying model name — it's the product name for our AI layer

---

**Version**: 2.0
**Last Modified**: 2026-05-08
**Maintainer**: i24hour
