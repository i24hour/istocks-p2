#!/usr/bin/env node
/**
 * This script adds missing stocks (Adanipower and Ved anta) to the Vercel production database
 * Run this with: DATABASE_URL=<vercel-database-url> node scripts/add-stocks-to-vercel.js
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const STOCKS_TO_ADD = [
    {
        symbol: 'ADANIPOWER',
        name: 'Adani Power',
        exchange: 'NSE'
    },
    {
        symbol: 'VEDL',
        name: 'Vedanta',
        exchange: 'NSE'
    }
]

async function addStocks() {
    console.log('🚀 Adding missing stocks to database...')
    console.log(`📊 Database: ${process.env.DATABASE_URL?.substring(0, 50)}...\n`)

    for (const stock of STOCKS_TO_ADD) {
        try {
            // Check if stock already exists
            const existing = await prisma.stock.findUnique({
                where: { symbol: stock.symbol }
            })

            if (existing) {
                console.log(`✅ ${stock.symbol} (${stock.name}) already exists - ID: ${existing.id}`)
                continue
            }

            // Create stock record
            const newStock = await prisma.stock.create({
                data: {
                    symbol: stock.symbol,
                    name: stock.name,
                    exchange: stock.exchange
                }
            })

            console.log(`✅ Added ${stock.symbol} (${stock.name}) - ID: ${newStock.id}`)
        } catch (error) {
            console.error(`❌ Error adding ${stock.symbol}:`, error.message)
        }
    }

    console.log('\n🏁 Done! Verifying all stocks...\n')

    // List all stocks in the database
    const allStocks = await prisma.stock.findMany({
        orderBy: { symbol: 'asc' }
    })

    console.log(`📈 Total stocks in database: ${allStocks.length}`)
    allStocks.forEach(stock => {
        console.log(`   - ${stock.symbol} (${stock.name})`)
    })

    await prisma.$disconnect()
}

addStocks().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})
