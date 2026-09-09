/**
 * The shared AccountDirectory CONTRACT test.
 *
 * Same shape as classroom-provider.contract.test.ts: written against the PORT,
 * so both implementations are held to one behaviour rather than each being
 * tested against its own convenience. `Session.accountId` may name a row in
 * either table depending on provider mode, and this file is what says the two
 * lookups agree on what "no such account" and "an account summary" mean.
 */
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AccountDirectory } from '../src/services/account-directory.js'
import {
  GoogleAccountDirectory,
  MockAccountDirectory,
  createAccountDirectory,
} from '../src/services/account-directory.js'
import { encryptToken } from '../src/services/token-crypto.js'
import { SEED_ACCOUNTS } from '../src/fixtures/index.js'
import { createTestDb, type TestDb } from './helpers/db.js'

let db: TestDb
const KEY = crypto.randomBytes(32)

const GOOGLE_ACCOUNT_ID = '112233445566778899001'

beforeAll(async () => {
  db = await createTestDb()
  const token = encryptToken('ya29.contract-test-token', KEY)
  await db.prisma.googleAccount.create({
    data: {
      id: GOOGLE_ACCOUNT_ID,
      email: 'ms.pickett@example.edu',
      displayName: 'Alex Pickett',
      pictureUrl: 'https://lh3.example.com/a/photo',
      accessTokenCiphertext: token.ciphertext,
      accessTokenIv: token.iv,
      accessTokenTag: token.tag,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      scopesGranted: 'https://www.googleapis.com/auth/classroom.courses',
    },
  })
})
afterAll(async () => {
  await db.dispose()
})

const CASES: Array<{ name: string; make: () => AccountDirectory; presentId: string; expectedName: string }> = [
  {
    name: 'MockAccountDirectory',
    make: () => new MockAccountDirectory(db.prisma),
    presentId: SEED_ACCOUNTS[0]!.id,
    expectedName: SEED_ACCOUNTS[0]!.displayName,
  },
  {
    name: 'GoogleAccountDirectory',
    make: () => new GoogleAccountDirectory(db.prisma),
    presentId: GOOGLE_ACCOUNT_ID,
    expectedName: 'Alex Pickett',
  },
]

for (const testCase of CASES) {
  describe(`AccountDirectory contract — ${testCase.name}`, () => {
    it('returns a summary for an account it knows', async () => {
      const summary = await testCase.make().getAccountSummary(testCase.presentId)
      expect(summary).not.toBeNull()
      expect(summary!.id).toBe(testCase.presentId)
      expect(summary!.displayName).toBe(testCase.expectedName)
      expect(summary!.email).toContain('@')
      // Initials are what the avatar renders; every summary has them, whichever
      // table it came from. Google returns no such field, so it is derived.
      expect(summary!.initials).toMatch(/^[A-Z]{1,2}$/)
    })

    it('returns null — never throws — for an id it does not know', async () => {
      await expect(testCase.make().getAccountSummary('no-such-account-id')).resolves.toBeNull()
    })

    it('never returns credential material on the summary', async () => {
      const summary = await testCase.make().getAccountSummary(testCase.presentId)
      const keys = Object.keys(summary!)
      for (const forbidden of ['accessTokenCiphertext', 'accessTokenIv', 'accessTokenTag']) {
        expect(keys).not.toContain(forbidden)
      }
    })
  })
}

describe('createAccountDirectory', () => {
  it('selects the implementation from googleProviderMode — one discriminator, two ports', () => {
    expect(createAccountDirectory(db.prisma, 'mock')).toBeInstanceOf(MockAccountDirectory)
    expect(createAccountDirectory(db.prisma, 'google')).toBeInstanceOf(GoogleAccountDirectory)
  })
})
