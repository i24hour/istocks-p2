/**
 * Manual update: fetch all stocks up to 15:30 IST today (or a specific date).
 * Replicates the cron logic with IST-aware timestamp handling.
 * Usage: node scripts/manual-update-all.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const API_KEY = process.env.ANGEL_API_KEY ;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID ;
const SECRET_KEY = process.env.ANGEL_SECRET_KEY ;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET ;

const SCRIP_MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';

// ─── Helpers ────────────────────────────────────────────────────────────

function normalizeSymbolKey(s) {
  return String(s).toUpperCase().replace(/[-_\s]/g, '');
}

function formatDateForAngel(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
}

function parseAngelCandleTimestamp(raw) {
  const value = String(raw).trim();
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(`${normalized}+05:30`);
}

function normalizeLegacyLatestTimestamp(ts) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(ts);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const istHour = Number(m.hour);
  if (istHour >= 9 && istHour <= 15) return ts;
  return new Date(ts.getTime() - (5 * 60 + 30) * 60 * 1000);
}

// ─── TOTP ───────────────────────────────────────────────────────────────

function generateTOTP(secret) {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase()) {
    const v = base32chars.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));

  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBytes = new Uint8Array(8);
  let temp = counter;
  for (let i = 7; i >= 0; i--) { counterBytes[i] = temp & 0xff; temp = Math.floor(temp / 256); }

  const hmac = crypto.createHmac('sha1', Buffer.from(bytes));
  hmac.update(Buffer.from(counterBytes));
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const code = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

// ─── API calls ──────────────────────────────────────────────────────────

async function authenticateAngelOne() {
  const totp = generateTOTP(TOTP_SECRET);
  const res = await fetch('https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB',
      'X-ClientLocalIP': 'CLIENT_LOCAL_IP', 'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
      'X-MACAddress': 'MAC_ADDRESS', 'X-PrivateKey': API_KEY,
    },
    body: JSON.stringify({ clientcode: CLIENT_ID, password: SECRET_KEY, totp }),
  });
  const data = await res.json();
  if (data.status && data.data?.jwtToken) return data.data.jwtToken;
  console.error('Auth failed:', JSON.stringify(data));
  return null;
}

async function fetchCandleData(jwtHolder, token, exchange, from, to) {
  const call = async () => {
    const res = await fetch('https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-UserType': 'USER', 'X-SourceID': 'WEB',
        'X-ClientLocalIP': 'CLIENT_LOCAL_IP', 'X-ClientPublicIP': 'CLIENT_PUBLIC_IP',
        'X-MACAddress': 'MAC_ADDRESS', 'X-PrivateKey': API_KEY,
        'Authorization': `Bearer ${jwtHolder.jwt}`,
      },
      body: JSON.stringify({ exchange, symboltoken: token, interval: 'ONE_MINUTE', fromdate: from, todate: to }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      // Likely "Access denied" plain text — JWT expired
      console.log('   ⚠️  JWT expired, re-authenticating...');
      jwtHolder.jwt = await authenticateAngelOne();
      if (!jwtHolder.jwt) throw new Error('Re-auth failed');
      return call(); // retry once with new token
    }
    return data.data || [];
  };
  return call();
}

async function fetchCandleDataInChunks(jwtHolder, token, exchange, fromTime, toTime) {
  const all = [];
  let cursor = new Date(fromTime);
  while (cursor < toTime) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 24 * 60 * 60 * 1000, toTime.getTime()));
    const candles = await fetchCandleData(jwtHolder, token, exchange, formatDateForAngel(cursor), formatDateForAngel(chunkEnd));
    if (candles.length) all.push(...candles);
    cursor = chunkEnd;
    // small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

async function fetchDynamicTokenMap() {
  const tokenMap = new Map();
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(SCRIP_MASTER_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return tokenMap;
    const data = await res.json();
    if (!Array.isArray(data)) return tokenMap;
    for (const item of data) {
      if (!item?.token) continue;
      if (item.exch_seg !== 'NSE' && item.exch_seg !== 'NSE_IDX') continue;
      const exchange = 'NSE';
      if (item.name) tokenMap.set(normalizeSymbolKey(item.name), { token: item.token, exchange });
      if (item.symbol) {
        const key = normalizeSymbolKey(String(item.symbol).replace(/-EQ$/i, ''));
        tokenMap.set(key, { token: item.token, exchange });
      }
    }
  } catch (e) { console.error('Scrip master fetch failed:', e.message); }
  return tokenMap;
}

function resolveTokenInfo(stock, instrument, dynamicMap) {
  if (instrument?.angelToken) return { token: instrument.angelToken, exchange: instrument.exchange || 'NSE' };
  const keys = new Set([normalizeSymbolKey(stock.symbol), normalizeSymbolKey(stock.name)]);
  if (instrument?.symbol) keys.add(normalizeSymbolKey(instrument.symbol));
  for (const a of instrument?.aliases || []) keys.add(normalizeSymbolKey(a));
  for (const k of keys) { const f = dynamicMap.get(k); if (f) return f; }
  return null;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Manual bulk update started');

  // Target: today 15:30 IST = 10:00 UTC (dynamic)
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayStr = nowIST.toISOString().slice(0, 10); // YYYY-MM-DD in IST
  const toTime = new Date(`${todayStr}T10:00:00.000Z`); // 15:30 IST = 10:00 UTC
  console.log(`Target toTime: ${todayStr} 15:30 IST`);
  const maxCatchupDays = 10; // generous window

  const stocks = await prisma.stock.findMany();
  console.log(`Found ${stocks.length} stocks in DB`);

  console.log('Fetching scrip master (for stocks missing angelToken)...');
  const dynamicTokenMap = await fetchDynamicTokenMap();
  console.log(`Scrip master loaded: ${dynamicTokenMap.size} entries`);

  console.log('Authenticating with Angel One...');
  const jwt = await authenticateAngelOne();
  if (!jwt) { console.error('❌ Auth failed, aborting'); process.exit(1); }
  console.log('✅ Authenticated');
  const jwtHolder = { jwt }; // mutable so re-auth can update it mid-run

  const results = [];

  for (const stock of stocks) {
    // Use Stock.angelToken as source of truth; fall back to scrip master
    let tokenInfo = null;
    if (stock.angelToken) {
      tokenInfo = { token: stock.angelToken, exchange: stock.exchange || 'NSE' };
    } else {
      const keys = [normalizeSymbolKey(stock.symbol), normalizeSymbolKey(stock.name)];
      for (const k of keys) { const f = dynamicTokenMap.get(k); if (f) { tokenInfo = f; break; } }
    }
    if (!tokenInfo) {
      console.log(`⚠️  No token for ${stock.symbol}, skipping`);
      results.push({ symbol: stock.symbol, inserted: 0, reason: 'no-token' });
      continue;
    }

    // Find latest row
    const latestRow = await prisma.stockPrice.findFirst({
      where: { stockId: stock.id },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    const normalizedLatest = latestRow?.timestamp
      ? normalizeLegacyLatestTimestamp(latestRow.timestamp)
      : null;

    const uncappedFrom = normalizedLatest
      ? new Date(normalizedLatest.getTime() + 60_000)
      : new Date(toTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days back

    const catchupFloor = new Date(toTime.getTime() - maxCatchupDays * 24 * 60 * 60 * 1000);
    const fromTime = uncappedFrom < catchupFloor ? catchupFloor : uncappedFrom;

    if (fromTime >= toTime) {
      console.log(`✅ ${stock.symbol} already up-to-date`);
      results.push({ symbol: stock.symbol, inserted: 0, reason: 'up-to-date' });
      continue;
    }

    const fromStr = formatDateForAngel(fromTime);
    const toStr = formatDateForAngel(toTime);
    console.log(`📈 Fetching ${stock.symbol}: ${fromStr} → ${toStr} (token: ${tokenInfo.token})`);

    const candles = await fetchCandleDataInChunks(jwtHolder, tokenInfo.token, tokenInfo.exchange, fromTime, toTime);
    console.log(`   Received ${candles.length} candles`);

    let inserted = 0;
    for (const c of candles) {
      try {
        const timestamp = parseAngelCandleTimestamp(c[0]);
        await prisma.stockPrice.upsert({
          where: { stockId_timestamp: { stockId: stock.id, timestamp } },
          update: { open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] },
          create: { stockId: stock.id, timestamp, open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] },
        });
        inserted++;
      } catch (e) { /* skip dups */ }
    }

    console.log(`   ✅ Upserted ${inserted} rows for ${stock.symbol}`);
    results.push({ symbol: stock.symbol, inserted, from: fromStr, to: toStr });

    // delay between stocks to be nice to the API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n══════════════════════════════════════');
  console.log('            SUMMARY');
  console.log('══════════════════════════════════════');
  let totalInserted = 0;
  for (const r of results) {
    const status = r.inserted > 0 ? '✅' : (r.reason || '⚠️');
    console.log(`  ${r.symbol.padEnd(14)} ${String(r.inserted).padStart(5)} candles  ${r.reason || ''}`);
    totalInserted += r.inserted;
  }
  console.log(`\n  TOTAL: ${totalInserted} candles inserted/updated`);
  console.log('══════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
