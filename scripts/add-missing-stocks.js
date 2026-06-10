#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

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
    console.log('🚀 Adding missing stocks to database...\n')

    for (const stock of STOCKS_TO_ADD) {
        try {
            // Check if stock already exists
            const existing = await prisma.stock.findUnique({
                where: { symbol: stock.symbol }
            })

            if (existing) {
                console.log(`✅ ${stock.symbol} (${stock.name}) already exists`)
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

    console.log('\n🏁 Done!')
    await prisma.$disconnect()
}

addStocks()
