import crypto from 'crypto'

const CIPHER = 'aes-256-gcm'
let missingKeyWarned = false

function decodeKey(raw: string): Buffer {
  // Try hex (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  // Try base64/base64url
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
    const asB64 = Buffer.from(normalized, 'base64')
    if (asB64.length === 32) return asB64
  } catch {
    // no-op
  }

  // Try raw utf8 32 bytes
  const utf8 = Buffer.from(raw, 'utf8')
  if (utf8.length === 32) return utf8

  // Fallback deterministic hash to 32 bytes
  return crypto.createHash('sha256').update(raw).digest()
}

function resolveEncryptionKey(): Buffer {
  const fromEnv = process.env.BROKER_CREDS_ENCRYPTION_KEY
  if (fromEnv) return decodeKey(fromEnv)

  if (process.env.NODE_ENV === 'production') {
    throw new Error('BROKER_CREDS_ENCRYPTION_KEY is required in production')
  }

  if (!missingKeyWarned) {
    missingKeyWarned = true
    console.warn('BROKER_CREDS_ENCRYPTION_KEY not set. Using development fallback key.')
  }

  const fallbackSeed = process.env.NEXTAUTH_SECRET || 'istocks-dev-broker-key'
  return crypto.createHash('sha256').update(fallbackSeed).digest()
}

export function encryptSecret(value?: string | null): string | null {
  if (!value) return null

  const key = resolveEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(CIPHER, key, iv)

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptSecret(value?: string | null): string | null {
  if (!value) return null

  // Backward compatibility: plaintext values from older rows.
  if (!value.startsWith('v1:')) return value

  const parts = value.split(':')
  if (parts.length !== 4) throw new Error('Invalid encrypted secret format')

  const [, ivB64, tagB64, encB64] = parts
  const key = resolveEncryptionKey()

  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const encrypted = Buffer.from(encB64, 'base64url')

  const decipher = crypto.createDecipheriv(CIPHER, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

export function maskSecret(value?: string | null): string {
  if (!value) return ''
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`
}
