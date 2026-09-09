/**
 * Google access tokens at rest — AES-256-GCM under a dedicated key.
 *
 * The key is `TOKEN_ENCRYPTION_KEY`, deliberately SEPARATE from
 * `SESSION_SECRET` (§5.1/Decision B): a compromise of the JWT-signing key must
 * not also hand over every teacher's Google token.
 *
 * GCM, not CBC, because the auth tag is what makes a corrupted or
 * wrong-key ciphertext detectable instead of decrypting to plausible garbage.
 * Every failure mode of `decrypt` is therefore the same operational fact — the
 * stored token is unusable — and it takes the same path an expired token takes:
 * `AuthExpiredError`, which pauses the job for a reconnect rather than 500ing
 * mid-transfer (§8.0/S4).
 *
 * §8.0/S6: nothing in this module ever logs the plaintext, the ciphertext, the
 * IV or the tag. The account id is the only identifier that travels.
 */
import crypto from 'node:crypto'
import { AuthExpiredError } from '../adapters/types.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

const ALGORITHM = 'aes-256-gcm'
/** 96 bits — the IV length GCM is specified and optimised for. */
const IV_BYTES = 12

/** The three columns `GoogleAccount` stores, all base64. */
export interface EncryptedToken {
  ciphertext: string
  iv: string
  tag: string
}

/**
 * Read the key lazily rather than at import: a mock-mode boot has no key at all
 * and must not fail merely because this module was imported.
 */
function requireKey(): Buffer {
  const key = config.tokenEncryptionKey
  if (key == null) {
    throw new Error(
      '[token-crypto] TOKEN_ENCRYPTION_KEY is not configured. Refusing to handle a Google token without one.',
    )
  }
  return key
}

export function encryptToken(plaintext: string, key: Buffer = requireKey()): EncryptedToken {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptToken(
  encrypted: EncryptedToken,
  key: Buffer = requireKey(),
  context: { accountId?: string } = {},
): string {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // The caught error is discarded on purpose: node's cipher errors carry no
    // useful detail beyond "it did not authenticate", and re-wrapping one risks
    // carrying key material into a log line.
    logger.warn('google token failed to decrypt — treating as an expired connection', {
      accountId: context.accountId ?? 'unknown',
      reason: 'cipher_auth_failed',
    })
    throw new AuthExpiredError()
  }
}
