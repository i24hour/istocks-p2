const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
    console.log('Fetching all stocks...')

    const stocks = await prisma.stock.findMany({
        orderBy: {
            symbol: 'asc'
        }
    })

    console.log(`Found ${stocks.length} stocks:`)
    stocks.forEach(stock => {
        console.log(`- ${stock.symbol}: ${stock.name} (ID: ${stock.id})`)
    })
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e)
        prisma.$disconnect()
    })
