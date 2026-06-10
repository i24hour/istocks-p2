const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TARGET_ROWS = Number(process.env.TARGET_ROWS || 22000000);
const CRON_URL = process.env.CRON_URL || 'https://www.istocks.codes/api/cron/update-stocks';
const MIN_INTERVAL_MS = Number(process.env.MIN_INTERVAL_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 290000);
const LOG_PATH = process.env.MONITOR_LOG_PATH || '/tmp/istocks_until_22m.log';
const DB_RETRY_ATTEMPTS = Number(process.env.DB_RETRY_ATTEMPTS || 4);
const DB_RETRY_BASE_DELAY_MS = Number(process.env.DB_RETRY_BASE_DELAY_MS || 4000);

function toNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function appendLog(line) {
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDbSnapshot() {
  const [row] = await prisma.$queryRawUnsafe(`
    WITH per_stock AS (
      SELECT
        "stockId",
        MIN(timestamp) AS min_ts,
        MAX(timestamp) AS max_ts,
        COUNT(DISTINCT DATE(timestamp))::int AS trading_days
      FROM "StockPrice"
      GROUP BY "stockId"
    )
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(DISTINCT "stockId")::int AS stocks_with_any_data,
      COUNT(*) FILTER (WHERE timestamp >= date_trunc('day', NOW() AT TIME ZONE 'UTC'))::bigint AS rows_today,
      COUNT(DISTINCT "stockId") FILTER (WHERE timestamp >= date_trunc('day', NOW() AT TIME ZONE 'UTC'))::int AS stocks_today,
      MAX(timestamp) AS latest_ts_utc,
      (
        SELECT COUNT(*)::int
        FROM per_stock
        WHERE min_ts <= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'
          AND max_ts >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
          AND trading_days >= 18
      ) AS completed_1m_practical
    FROM "StockPrice";
  `);

  return {
    totalRows: toNumber(row.total_rows),
    stocksWithAnyData: toNumber(row.stocks_with_any_data),
    rowsToday: toNumber(row.rows_today),
    stocksToday: toNumber(row.stocks_today),
    latestTsUtc: row.latest_ts_utc,
    completed1mPractical: toNumber(row.completed_1m_practical),
  };
}

async function getDbSnapshotWithRetry() {
  let lastError = null;

  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const snapshot = await getDbSnapshot();
      return { snapshot, error: null, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < DB_RETRY_ATTEMPTS) {
        await sleep(DB_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  return {
    snapshot: null,
    error: String(lastError),
    attempts: DB_RETRY_ATTEMPTS,
  };
}

async function callCron() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CRON_URL, { signal: controller.signal });
    const bodyText = await response.text();

    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      message: parsed && parsed.message ? parsed.message : null,
      totalInserted: parsed && typeof parsed.totalInserted !== 'undefined' ? toNumber(parsed.totalInserted) : null,
      cursor: parsed && parsed.cursor ? parsed.cursor : null,
      rawSnippet: parsed ? null : bodyText.slice(0, 300),
    };
  } catch (error) {
    return {
      status: null,
      ok: false,
      message: null,
      totalInserted: null,
      cursor: null,
      rawSnippet: String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const header = {
    startedAtUtc: new Date().toISOString(),
    targetRows: TARGET_ROWS,
    cronUrl: CRON_URL,
    minIntervalMs: MIN_INTERVAL_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  };

  appendLog('=== monitor-until-22m START ===');
  appendLog(JSON.stringify(header));
  console.log(JSON.stringify(header));

  let run = 0;
  let previousTotalRows = 0;
  let lastSnapshot = null;

  while (true) {
    run += 1;
    const runStartedMs = Date.now();
    const runStartedAt = new Date(runStartedMs).toISOString();

    const cronResult = await callCron();

    // Give API-side work a moment to release DB connections before local snapshot query.
    await sleep(5000);

    const snapshotResult = await getDbSnapshotWithRetry();
    const snapshot = snapshotResult.snapshot || lastSnapshot;

    if (!snapshot) {
      const noSnapshotLine = {
        run,
        atUtc: runStartedAt,
        cronStatus: cronResult.status,
        cronOk: cronResult.ok,
        cronMessage: cronResult.message,
        totalInsertedFromRun: cronResult.totalInserted,
        cursor: cronResult.cursor,
        snapshotUnavailable: true,
        snapshotError: snapshotResult.error,
        dbRetryAttempts: snapshotResult.attempts,
        rawSnippet: cronResult.rawSnippet,
      };
      appendLog(JSON.stringify(noSnapshotLine));
      console.log(JSON.stringify(noSnapshotLine));

      const elapsedMs = Date.now() - runStartedMs;
      if (elapsedMs < MIN_INTERVAL_MS) {
        await sleep(MIN_INTERVAL_MS - elapsedMs);
      }
      continue;
    }

    lastSnapshot = snapshot;

    const deltaRows = snapshot.totalRows - previousTotalRows;
    previousTotalRows = snapshot.totalRows;

    const progressPct = Number(((snapshot.totalRows / TARGET_ROWS) * 100).toFixed(4));
    const remaining = Math.max(TARGET_ROWS - snapshot.totalRows, 0);

    const line = {
      run,
      atUtc: runStartedAt,
      cronStatus: cronResult.status,
      cronOk: cronResult.ok,
      cronMessage: cronResult.message,
      totalInsertedFromRun: cronResult.totalInserted,
      cursor: cronResult.cursor,
      totalRows: snapshot.totalRows,
      deltaRows,
      rowsToday: snapshot.rowsToday,
      stocksToday: snapshot.stocksToday,
      stocksWithAnyData: snapshot.stocksWithAnyData,
      completed1mPractical: snapshot.completed1mPractical,
      latestTsUtc: snapshot.latestTsUtc,
      dbRetryAttempts: snapshotResult.attempts,
      snapshotError: snapshotResult.error,
      progressPct,
      remainingRowsToTarget: remaining,
      rawSnippet: cronResult.rawSnippet,
    };

    appendLog(JSON.stringify(line));
    console.log(JSON.stringify(line));

    if (snapshot.totalRows >= TARGET_ROWS) {
      const done = {
        finishedAtUtc: new Date().toISOString(),
        run,
        totalRows: snapshot.totalRows,
        targetRows: TARGET_ROWS,
      };
      appendLog('=== monitor-until-22m COMPLETE ===');
      appendLog(JSON.stringify(done));
      console.log(JSON.stringify(done));
      break;
    }

    const elapsedMs = Date.now() - runStartedMs;
    if (elapsedMs < MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsedMs));
    }
  }

  await prisma.$disconnect();
})().catch(async (error) => {
  const failure = {
    failedAtUtc: new Date().toISOString(),
    error: String(error),
  };
  appendLog('=== monitor-until-22m ERROR ===');
  appendLog(JSON.stringify(failure));
  console.error(JSON.stringify(failure));

  await prisma.$disconnect();
  process.exit(1);
});
