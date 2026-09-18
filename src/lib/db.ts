import { PrismaClient } from '@prisma/client'

// Versioned singleton: schema upgrades (new columns) require a fresh client
// instance — the old one would reject the new fields. Bump the key on any
// `prisma db push` that adds columns.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaV2?: PrismaClient
  prismaV3?: PrismaClient
}

export const db =
  globalForPrisma.prismaV3 ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaV3 = db
