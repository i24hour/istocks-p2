#!/usr/bin/env ts-node
/**
 * Test script to diagnose deployment issues
 * Run: npx ts-node test-deployment.ts
 */

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const prisma = new PrismaClient()

async function testDeployment() {
  console.log('🔍 Testing Deployment Configuration...\n')
  
  // Test 1: Environment Variables
  console.log('📋 Test 1: Environment Variables')
  console.log('================================')
  const envVars = {
    'DATABASE_URL': !!process.env.DATABASE_URL,
    'GEMINI_API_KEY': !!process.env.GEMINI_API_KEY,
    'TZ': process.env.TZ || 'not set',
    'NODE_ENV': process.env.NODE_ENV || 'not set',
  }
  
  for (const [key, value] of Object.entries(envVars)) {
    const status = typeof value === 'boolean' ? (value ? '✅' : '❌') : '✅'
    const display = typeof value === 'boolean' ? (value ? 'SET' : 'MISSING') : value
    console.log(`${status} ${key}: ${display}`)
  }
  console.log()
  
  // Test 2: Database Connection
  console.log('📋 Test 2: Database Connection')
  console.log('================================')
  try {
    await prisma.$connect()
    console.log('✅ Successfully connected to database')
    
    // Test query
    const stockCount = await prisma.stock.count()
    console.log(`✅ Found ${stockCount} stock(s) in database`)
    
    const priceCount = await prisma.stockPrice.count()
    console.log(`✅ Found ${priceCount} price records in database`)
    
    // Test query performance
    const start = Date.now()
    const latestPrices = await prisma.stockPrice.findMany({
      take: 10,
      orderBy: { timestamp: 'desc' }
    })
    const duration = Date.now() - start
    console.log(`✅ Query took ${duration}ms (should be < 1000ms)`)
    
    if (latestPrices.length > 0) {
      console.log(`✅ Latest data: ${latestPrices[0].timestamp.toLocaleString('en-IN')}`)
    }
  } catch (error: any) {
    console.log('❌ Database connection failed!')
    console.log(`   Error: ${error.message}`)
    if (error.code) {
      console.log(`   Code: ${error.code}`)
    }
  }
  console.log()
  
  // Test 3: Gemini API
  console.log('📋 Test 3: Gemini API')
  console.log('================================')
  if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not set')
  } else {
    console.log('✅ GEMINI_API_KEY is set')
    
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
      
      console.log('⏳ Testing Gemini API... (this may take a few seconds)')
      const start = Date.now()
      const result = await model.generateContent('Say "OK" if you can read this.')
      const duration = Date.now() - start
      const response = await result.response
      const text = response.text()
      
      console.log(`✅ Gemini API working! Response time: ${duration}ms`)
      console.log(`   Response: ${text.substring(0, 50)}...`)
    } catch (error: any) {
      console.log('❌ Gemini API failed!')
      console.log(`   Error: ${error.message}`)
    }
  }
  console.log()
  
  // Test 4: Sample Query (like the one failing)
  console.log('📋 Test 4: Sample Query (last 40 days)')
  console.log('================================')
  try {
    const stock = await prisma.stock.findUnique({
      where: { symbol: 'WIPRO' }
    })
    
    if (!stock) {
      console.log('❌ WIPRO stock not found in database')
    } else {
      const fortyDaysAgo = new Date()
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40)
      
      const start = Date.now()
      const records = await prisma.stockPrice.findMany({
        where: {
          stockId: stock.id,
          timestamp: { gte: fortyDaysAgo },
          close: { gte: 240 }
        },
        orderBy: { timestamp: 'desc' }
      })
      const duration = Date.now() - start
      
      console.log(`✅ Query completed in ${duration}ms`)
      console.log(`✅ Found ${records.length} times stock reached ≥ 240 in last 40 days`)
      
      if (duration > 5000) {
        console.log('⚠️  WARNING: Query took > 5 seconds, may timeout on Vercel Free (10s limit)')
      }
    }
  } catch (error: any) {
    console.log('❌ Query failed!')
    console.log(`   Error: ${error.message}`)
  }
  console.log()
  
  // Summary
  console.log('📊 Summary')
  console.log('================================')
  console.log('If all tests pass ✅, your deployment should work on Vercel.')
  console.log('If any test fails ❌, fix that issue before deploying.')
  console.log()
  console.log('⚠️  Common Vercel Issues:')
  console.log('   1. Environment variables not set in Vercel dashboard')
  console.log('   2. Azure firewall blocking Vercel IPs')
  console.log('   3. Function timeout (10s on Free, 60s on Pro)')
  console.log('   4. Cold start delays on Azure Basic tier')
  console.log()
  console.log('📚 For more details, see: VERCEL_TROUBLESHOOTING.md')
  
  await prisma.$disconnect()
}

// Run tests
testDeployment()
  .then(() => {
    console.log('\n✅ Test completed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })
