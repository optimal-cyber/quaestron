import 'dotenv/config'
import { prisma } from '../lib/db'

/**
 * Grant ADMIN to a user by email, creating the row if they haven't signed in yet.
 * Creating up-front matters: it means the first admin can be established before
 * any auth provider is configured, so /admin is never unreachable.
 *
 *   npm run admin:promote -- you@example.com
 *   npm run admin:promote -- you@example.com --demote
 *
 * Targets whatever TURSO_DATABASE_URL points at — clear it to hit local dev.db.
 */
async function main() {
  const args = process.argv.slice(2)
  const email = args.find((a) => !a.startsWith('--'))?.toLowerCase().trim()
  const demote = args.includes('--demote')

  if (!email || !email.includes('@')) {
    console.error('Usage: npm run admin:promote -- <email> [--demote]')
    process.exit(1)
  }

  const role = demote ? 'USER' : 'ADMIN'
  const target = process.env.TURSO_DATABASE_URL || 'file:dev.db'
  console.log(`Target database: ${target}`)

  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    await prisma.user.update({ where: { email }, data: { role } })
    console.log(`✓ ${email} → role=${role}`)
  } else if (demote) {
    console.error(`✗ No user with email ${email}`)
    process.exit(1)
  } else {
    await prisma.user.create({ data: { email, role, tier: 'TEAM' } })
    console.log(`✓ Created ${email} with role=ADMIN, tier=TEAM`)
    console.log('  Sign in with this exact address to claim the account.')
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
