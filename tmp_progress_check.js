const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const [row] = await prisma.$queryRawUnsafe(`
      WITH per_stock AS (
        SELECT
          "stockId",
          MIN(timestamp) AS min_ts,
          MAX(timestamp) AS max_ts,
          COUNT(DISTINCT DATE(timestamp))::int AS trading_days
        FROM "StockPrice"
        GROUP BY "stockId"
      ), stats AS (
        SELECT
          COUNT(*)::bigint AS total_rows,
          COUNT(DISTINCT "stockId")::int AS stocks_with_data,
          COUNT(*) FILTER (WHERE timestamp >= date_trunc('day', NOW() AT TIME ZONE 'UTC'))::bigint AS rows_today,
          COUNT(DISTINCT "stockId") FILTER (WHERE timestamp >= date_trunc('day', NOW() AT TIME ZONE 'UTC'))::int AS stocks_today,
          MAX(timestamp) AS latest_ts_utc
        FROM "StockPrice"
      ), complete AS (
        SELECT COUNT(*)::int AS completed_1m_practical
        FROM per_stock
        WHERE min_ts <= (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'
          AND max_ts >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
          AND trading_days >= 18
      )
      SELECT
        s.total_rows,
        s.stocks_with_data,
        s.rows_today,
        s.stocks_today,
        s.latest_ts_utc,
        c.completed_1m_practical,
        ROUND((s.total_rows::numeric / 22000000::numeric) * 100, 3) AS progress_pct_to_22m,
        (22000000 - s.total_rows)::bigint AS remaining_to_22m
      FROM stats s CROSS JOIN complete c;
    `);

    const out = JSON.parse(JSON.stringify(row, (_, value) =>
      typeof value === 'bigint' ? Number(value) : value
    ));

    console.log(JSON.stringify(out));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
