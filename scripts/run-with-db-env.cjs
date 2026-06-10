/**
 * Loads .env then .env.local (override) so Prisma CLI sees DATABASE_URL during
 * `npm run build` / `postinstall` — Next.js already reads .env.local at runtime.
 * If still unset, sets a placeholder URL so `prisma generate` can validate the schema
 * (migrate deploy must use a real URL).
 */
const { config } = require('dotenv')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')

config({ path: path.join(root, '.env') })
config({ path: path.join(root, '.env.local'), override: true })

let usingPlaceholderDatabaseUrl = false
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL =
        'postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public'
    usingPlaceholderDatabaseUrl = true
}

const originalCmd = process.argv.slice(2).join(' ')
let cmd = originalCmd
if (!cmd) {
    console.error('Usage: node scripts/run-with-db-env.cjs "<command>"')
    process.exit(1)
}

if (usingPlaceholderDatabaseUrl) {
    const parts = cmd
        .split('&&')
        .map((part) => part.trim())
        .filter(Boolean)
    const filtered = parts.filter((part) => part !== 'prisma migrate deploy')
    if (filtered.length !== parts.length) {
        console.warn(
            '[build-env] DATABASE_URL is missing; skipping "prisma migrate deploy" for this build.'
        )
        cmd = filtered.join(' && ')
    }
}

execSync(cmd, { stdio: 'inherit', env: process.env, shell: true })
