/**
 * Seed Base Templates Script
 * Run with: npx tsx scripts/seed-templates.ts
 */

import { seedBaseTemplates } from '../src/lib/template-service'

async function main() {
    console.log('🌱 Seeding base SQL templates...\n')

    const results = await seedBaseTemplates()

    console.log('Results:')
    console.log('─'.repeat(50))

    let created = 0, exists = 0, errors = 0

    for (const result of results) {
        const icon = result.status === 'created' ? '✅' : result.status === 'exists' ? '⏭️' : '❌'
        console.log(`${icon} ${result.intentType}: ${result.status}`)
        if (result.status === 'created') created++
        else if (result.status === 'exists') exists++
        else errors++
    }

    console.log('─'.repeat(50))
    console.log(`\nSummary: ${created} created, ${exists} already exist, ${errors} errors`)

    process.exit(0)
}

main().catch(e => {
    console.error('Error:', e)
    process.exit(1)
})
