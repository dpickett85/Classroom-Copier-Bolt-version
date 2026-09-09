import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthExpiredError } from '../adapters/types.js'
import { decryptToken, encryptToken } from './token-crypto.js'

const KEY_A = crypto.randomBytes(32)
const KEY_B = crypto.randomBytes(32)

describe('token-crypto', () => {
  it('round-trips a token', () => {
    const plaintext = 'ya29.a0AfB_byC-not-a-real-token'
    expect(decryptToken(encryptToken(plaintext, KEY_A), KEY_A)).toBe(plaintext)
  })

  it('never produces the same ciphertext twice — the IV is random per call', () => {
    const plaintext = 'ya29.same-plaintext-both-times'
    const first = encryptToken(plaintext, KEY_A)
    const second = encryptToken(plaintext, KEY_A)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.tag).not.toBe(second.tag)
  })

  it('emits base64 fields of the sizes AES-256-GCM defines', () => {
    const { iv, tag } = encryptToken('x', KEY_A)
    expect(Buffer.from(iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(tag, 'base64')).toHaveLength(16)
  })

  // §8.0/S4 — a rotated or corrupted key is operationally an expired credential:
  // the stored token is unusable and the fix is for the teacher to sign in again.
  it('raises AuthExpiredError when decrypting under a different key', () => {
    const encrypted = encryptToken('ya29.encrypted-under-A', KEY_A)
    expect(() => decryptToken(encrypted, KEY_B)).toThrow(AuthExpiredError)
  })

  it('raises AuthExpiredError on a tampered auth tag', () => {
    const encrypted = encryptToken('ya29.tampered', KEY_A)
    const tag = Buffer.from(encrypted.tag, 'base64')
    tag[0] = (tag[0] ?? 0) ^ 0xff
    expect(() => decryptToken({ ...encrypted, tag: tag.toString('base64') }, KEY_A)).toThrow(
      AuthExpiredError,
    )
  })

  it('raises AuthExpiredError on garbage ciphertext rather than a raw cipher error', () => {
    const encrypted = encryptToken('ya29.garbage', KEY_A)
    expect(() => decryptToken({ ...encrypted, ciphertext: 'bm90LWEtY2lwaGVydGV4dA==' }, KEY_A)).toThrow(
      AuthExpiredError,
    )
  })

  // §8.0/S6 — never log ciphertext, iv, tag or plaintext.
  it('logs the failure at WARN with the account id and no credential material', async () => {
    const { logger } = await import('../logger.js')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const encrypted = encryptToken('ya29.super-secret-value', KEY_A)
    expect(() => decryptToken(encrypted, KEY_B, { accountId: 'goog-123' })).toThrow(AuthExpiredError)

    expect(warn).toHaveBeenCalledTimes(1)
    const [message, fields] = warn.mock.calls[0]!
    const serialized = `${message} ${JSON.stringify(fields)}`
    expect(serialized).toContain('goog-123')
    for (const secret of [encrypted.ciphertext, encrypted.iv, encrypted.tag, 'ya29.super-secret-value']) {
      expect(serialized).not.toContain(secret)
    }
    warn.mockRestore()
  })
})

describe('config — TOKEN_ENCRYPTION_KEY fail-fast (§8.0/S3)', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL }
  })

  /** config.ts resolves once at import; a boot is a fresh module graph. */
  async function boot(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    return (await import('../config.js')).config
  }

  const PRODUCTION_GOOGLE = {
    NODE_ENV: 'production',
    VITEST: undefined,
    GOOGLE_PROVIDER_MODE: 'google',
    SESSION_SECRET: 'a-session-secret',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'https://api.example.com/api/auth/callback',
  }

  it('refuses to boot when TOKEN_ENCRYPTION_KEY is unset in production google mode', async () => {
    await expect(boot({ ...PRODUCTION_GOOGLE, TOKEN_ENCRYPTION_KEY: undefined })).rejects.toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    )
  })

  it('refuses to boot on a key that does not base64-decode to exactly 32 bytes', async () => {
    await expect(
      boot({ ...PRODUCTION_GOOGLE, TOKEN_ENCRYPTION_KEY: crypto.randomBytes(16).toString('base64') }),
    ).rejects.toThrow(/32 bytes/)
  })

  it('boots on a well-formed 32-byte base64 key', async () => {
    const key = crypto.randomBytes(32).toString('base64')
    const cfg = await boot({ ...PRODUCTION_GOOGLE, TOKEN_ENCRYPTION_KEY: key })
    expect(cfg.tokenEncryptionKey).toEqual(Buffer.from(key, 'base64'))
    expect(cfg.googleProviderMode).toBe('google')
  })

  it('boots without a key in mock mode — the mock has no token to encrypt', async () => {
    const cfg = await boot({ NODE_ENV: 'test', GOOGLE_PROVIDER_MODE: 'mock', TOKEN_ENCRYPTION_KEY: undefined })
    expect(cfg.tokenEncryptionKey).toBeNull()
  })
})
