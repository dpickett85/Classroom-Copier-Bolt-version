/**
 * `AccountDirectory` — "who is this session?", asked without knowing which world
 * the answer lives in.
 *
 * `Session.accountId` is polymorphic (§5.1): a MockAccount.id in mock mode, a
 * GoogleAccount.id in google mode. Routes should not care, so they ask this port
 * instead of a table. It is selected by `config.googleProviderMode` — the SAME
 * discriminator that already selects `ClassroomProvider`'s implementation, on
 * purpose: two independent mode checks are two things that can drift apart.
 */
import type { PrismaClient } from '@prisma/client'
import type { AccountSummary } from '@classroom-copier/shared'

export interface AccountDirectory {
  /** `null`, never a throw, for an id this directory does not know. */
  getAccountSummary(accountId: string): Promise<AccountSummary | null>
}

/**
 * Google's userinfo has no `initials` field, but every avatar in this UI renders
 * them, so they are derived once, here — not in each component that needs them.
 */
export function initialsFrom(displayName: string, email: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  const letters = words
    .map((word) => word.match(/\p{L}/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
  if (letters.length > 0) return letters.join('').toUpperCase()
  // A display name with no letters at all (rare, but Google does not promise
  // otherwise) falls back to the email rather than rendering an empty circle.
  return (email.match(/\p{L}/u)?.[0] ?? '?').toUpperCase()
}

export class MockAccountDirectory implements AccountDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async getAccountSummary(accountId: string): Promise<AccountSummary | null> {
    const account = await this.prisma.mockAccount.findUnique({ where: { id: accountId } })
    if (!account) return null
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      initials: account.initials,
    }
  }
}

export class GoogleAccountDirectory implements AccountDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async getAccountSummary(accountId: string): Promise<AccountSummary | null> {
    const account = await this.prisma.googleAccount.findUnique({
      where: { id: accountId },
      // An explicit select, not a whole row: the ciphertext/iv/tag columns have
      // no business travelling to a route handler that only needs a name.
      select: { id: true, displayName: true, email: true, pictureUrl: true },
    })
    if (!account) return null
    return {
      id: account.id,
      displayName: account.displayName,
      email: account.email,
      initials: initialsFrom(account.displayName, account.email),
      pictureUrl: account.pictureUrl,
    }
  }
}

export function createAccountDirectory(
  prisma: PrismaClient,
  mode: 'mock' | 'google',
): AccountDirectory {
  return mode === 'google' ? new GoogleAccountDirectory(prisma) : new MockAccountDirectory(prisma)
}
