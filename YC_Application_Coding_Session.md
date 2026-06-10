# Coding Session Export: Building iStocks Automated Trading Engine & AI Analyst
**Date:** February 2026
**Founder:** Priyanshu & Sachin (Technical Architects)
**Assistant:** Gemini/Claude (AI Pair Programmer)

---

## Session Context
**Objective:** Architect and implement a legally compliant, automated trading system with "Human-in-the-loop" AI execution.
**Core Challenge:** Bridging the gap between AI analysis and trade execution while ensuring absolute financial accuracy.
**Tech Stack:** Next.js (Frontend), AWS PostgreSQL (Database/Compute), Python (Live Feed).

---

## Transcript Highlights

### 1. Architectural Vision: "Accuracy First, Speed Second"
**User (Priyanshu):**
"We need to build the trading engine now. I've been thinking about the architecture. We cannot rely on AI or standard libraries for the core financial calculations (RSI, MACD, Moving Averages). Sachin and I have written custom SQL templates for these indicators to ensure 100% accuracy and consistency with our backtesting engine.

I want the calculations to happen at the database layer using **AWS PostgreSQL's** compute power, not in the Node.js application. This reduces latency for the trading bot and keeps the 'truth' in the DB. Let's design the schema. We need to support 'Paper Trading' first to be safe, but it must be ready for 'Real Trading' via broker APIs later."

**Assistant:**
"That's a robust approach. Offloading math to the DB layer will definitely reduce Node.js overhead.
For the schema, we should create:
1. `TradingOrder`: To track intent and status.
2. `Position`: For live active trades.
3. `BrokerSettings`: To handle API keys securely."

**User (Priyanshu):**
"Yes, but add a `tradingMode` enum to *every* table. I want to be able to switch between Paper and Real trading instantly without changing the codebase. The user should feel no difference in the UI, but the backend routing will change. Also, let's add `HoldingTransaction` to track every single buy/sell event for tax auditing later."

*Result: Created a complex, audit-ready schema in `prisma/schema.prisma` that supports dual-mode trading.*

### 2. The "Human-in-the-Loop" Innovation
**User (Priyanshu):**
"Okay, the backend is solid. Now for the killer feature. I want the AI Stock Analyst to not just give advice but *enable* action.
Right now, chatbots just talk. I want iStocks to *do*.
When the AI suggests a trade (e.g., 'Buy WIPRO above 500'), I want an 'Execute Trade' button to appear *inside* the chat message.
But we need a safety layer. The AI shouldn't just fire the order. It should open a pre-filled execution modal where the user verifies the details. This is the 'Human-in-the-loop' aspect."

**Assistant:**
"Implementing `TradeExecutionModal.tsx`.
- Auto-extracts symbol (WIPRO) and intent (BUY) from chat context.
- Pre-fills the order form.
- **Safety Layer:** Added a toggle between 'Paper' and 'Real' modes so users don't accidentally execute real money trades."

**User (Priyanshu):**
"Make the modal smarter. If the user is on the 'Technical Analysis' chat, auto-fill the Stop Loss based on the support levels the AI just calculated. If they are on the 'Screening' chat, just fill the symbol. The context matters.
Also, add a live 'Position Value' calculator in the modal so they know exactly how much margin they are using before they click confirm."

*Result: Built a context-aware `TradeExecutionModal` that dynamically adapts to the user's conversation flow, reducing trade execution time from ~2 minutes to ~5 seconds.*

### 3. Iterating on UI: "It needs to feel Premium"
**User (Priyanshu):**
"The current chat UI is too generic. It looks like a standard chatbot. I want it to feel like a professional financial tool.
I've been looking at ChatGPT's new UI - the dark mode, the centered input, the clean history sidebar. Let's completely rebuild `DatabaseChat` to match that premium aesthetic.
- Remove all the white space. Go full dark (Zinc-900).
- Center the empty state with suggested prompts.
- Add a sidebar for 'Chat History' so users can switch between different stock analyses easily."

**Assistant:**
"Redesigning `src/components/DatabaseChat.tsx` to match your vision.
- Switching to full-screen dark theme.
- Implementing collapsible sidebar with history.
- Centered 'Empty State' with quick-start prompts."

**User (Priyanshu):**
"One more detail: The input field needs to handle multi-line complex queries because users will copy-paste financial data. And add a 'New' badge to the Trading navigation item to highlight the feature we just built."

*Result: A complete UI overhaul that transformed the app from a 'prototype' look to a 'production-grade' SaaS product.*

---

## Summary of Founder Contribution
This session highlights **Priyanshu's** role as the primary architect and product visionary:
1.  **Technical Decision:** Enforced the use of custom SQL templates over standard libraries for financial accuracy.
2.  **Product Innovation:** Conceived the "Execute Trade" button concept to bridge the gap between analysis and action.
3.  **Safety & Compliance:** Designed the "Paper/Real" toggle and audit-trail schema (`HoldingTransaction`) from day one.
4.  **UX Leadership:** Directed the UI overhaul to meet professional fintech standards (Dark mode, context-aware modals).

**Tech Stack Confirmed:** Next.js, AWS PostgreSQL, Python (Live Feed), Gemini/Claude (AI).
