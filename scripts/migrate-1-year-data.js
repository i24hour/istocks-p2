#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');

const LOCALHOST_URL = process.env.LOCAL_DATABASE_URL || "postgresql://user:password@localhost:5432/stock_analysis";
const VERCEL_URL = process.env.DATABASE_URL;

async function migrate() {
    console.log('🚀 Starting 1-year data migration to Vercel\n');

    // Connect to databases
    const localClient = new Client({ connectionString: LOCALHOST_URL });
    const vercelClient = new Client({ connectionString: VERCEL_URL });

    await localClient.connect();
    await vercelClient.connect();

    try {
        // Step 1: Migrate Stock records
        console.log('📊 Step 1: Migrating Stock records...');
        const stocks = await localClient.query('SELECT * FROM "Stock"');

        for (const stock of stocks.rows) {
            await vercelClient.query(`
        INSERT INTO "Stock" (id, symbol, name, exchange, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (symbol) DO UPDATE SET
          name = EXCLUDED.name,
          exchange = EXCLUDED.exchange,
          "updatedAt" = EXCLUDED."updatedAt"
      `, [stock.id, stock.symbol, stock.name, stock.exchange, stock.createdAt, stock.updatedAt]);
        }
        console.log(`✅ Migrated ${stocks.rows.length} stocks\n`);

        // Step 2: Get stock IDs mapping
        const stockIds = {};
        for (const stock of stocks.rows) {
            stockIds[stock.symbol] = stock.id;
        }

        // Step 3: Migrate 1 year of price data
        console.log('📈 Step 2: Migrating 1 year of price data...');
        console.log('⏳ This may take a few minutes...\n');

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        // Fetch price data from last year in batches
        const batchSize = 10000;
        let offset = 0;
        let totalMigrated = 0;

        while (true) {
            const prices = await localClient.query(`
        SELECT * FROM "StockPrice"
        WHERE timestamp >= $1
        ORDER BY timestamp
        LIMIT $2 OFFSET $3
      `, [oneYearAgo, batchSize, offset]);

            if (prices.rows.length === 0) break;

            // Insert batch
            for (const price of prices.rows) {
                try {
                    await vercelClient.query(`
            INSERT INTO "StockPrice" (
              id, "stockId", timestamp, open, high, low, close, volume,
              sma20, sma50, sma200, ema12, ema26, macd, "macdSignal", "macdHistogram",
              adx, "plusDI", "minusDI", rsi, "stochK", "stochD", cci, "williamsR", roc,
              "bbUpper", "bbMiddle", "bbLower", atr, obv, vwap, "forceIndex", "adLine", "createdAt"
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
            )
            ON CONFLICT (id) DO NOTHING
          `, [
                        price.id, price.stockId, price.timestamp, price.open, price.high, price.low, price.close, price.volume,
                        price.sma20, price.sma50, price.sma200, price.ema12, price.ema26, price.macd, price.macdSignal, price.macdHistogram,
                        price.adx, price.plusDI, price.minusDI, price.rsi, price.stochK, price.stochD, price.cci, price.williamsR, price.roc,
                        price.bbUpper, price.bbMiddle, price.bbLower, price.atr, price.obv, price.vwap, price.forceIndex, price.adLine, price.createdAt
                    ]);
                } catch (err) {
                    // Skip duplicates
                    if (!err.message.includes('duplicate')) {
                        throw err;
                    }
                }
            }

            totalMigrated += prices.rows.length;
            offset += batchSize;

            console.log(`  📦 Migrated ${totalMigrated} price records...`);
        }

        console.log(`\n✅ Migration complete! Total: ${totalMigrated} price records\n`);

        // Verify
        console.log('🔍 Verifying migration...');
        const vercelStocks = await vercelClient.query('SELECT COUNT(*) FROM "Stock"');
        const vercelPrices = await vercelClient.query('SELECT COUNT(*) FROM "StockPrice"');

        console.log(`📊 Stocks: ${vercelStocks.rows[0].count}`);
        console.log(`📈 Prices: ${vercelPrices.rows[0].count}`);
        console.log('\n🎉 Migration successful!');

    } finally {
        await localClient.end();
        await vercelClient.end();
    }
}

migrate().catch(console.error);
