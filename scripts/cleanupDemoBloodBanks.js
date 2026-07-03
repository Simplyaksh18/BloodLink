#!/usr/bin/env node
/**
 * Safe cleanup for seeded/demo BloodBank rows.
 *
 * Dry-run by default: prints matching rows and exits without changes.
 * Pass --confirm to actually delete.
 *
 *   node scripts/cleanupDemoBloodBanks.js            # preview only
 *   node scripts/cleanupDemoBloodBanks.js --confirm  # delete
 *
 * A row is considered demo/seed IF AND ONLY IF it matches at least one of:
 *   - ownerId IS NULL                            (real registrations always set ownerId)
 *   - registrationNumber matches /^BB-\d+/       (seed marker)
 *   - email ends with '@bloodlink.test'          (seed marker)
 * AND its name appears in the DEMO_NAMES allowlist below (belt + braces).
 *
 * Real user-registered banks (e.g. "Lions Club West Mambalam") will never
 * match because they have an ownerId set AND their name is not in the list.
 */

const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@prisma', 'client'));

const DEMO_NAMES = [
  'National Blood Services - Mumbai',
  'Apollo Blood Bank Bengaluru',
  'Lifeblood Centre Mumbai',
  'RotaryTTK Blood Bank Bengaluru',
  'Civil Hospital Blood Bank',
  'Ruby Hall Blood Bank',
  'Kolkata Blood Bank',
];

const prisma = new PrismaClient();

async function main() {
  const confirm = process.argv.includes('--confirm');

  // Candidate rows: match ANY seed marker AND name is in the demo allowlist.
  const candidates = await prisma.bloodBank.findMany({
    where: {
      AND: [
        { name: { in: DEMO_NAMES } },
        {
          OR: [
            { ownerId: null },
            { registrationNumber: { startsWith: 'BB-' } },
            { email: { endsWith: '@bloodlink.test' } },
          ],
        },
      ],
    },
    select: {
      id: true, name: true, city: true, ownerId: true,
      registrationNumber: true, email: true, verificationStatus: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n[cleanupDemoBloodBanks] matched ${candidates.length} row(s):`);
  for (const b of candidates) {
    console.log(
      ` - ${b.id}  |  ${b.name}  |  ${b.city}  |  ownerId=${b.ownerId ?? 'null'}` +
      `  |  regNo=${b.registrationNumber ?? 'null'}  |  email=${b.email ?? 'null'}  |  status=${b.verificationStatus}`,
    );
  }

  // Explicit safety: never touch a row without at least one seed marker.
  const guarded = candidates.filter((b) =>
    b.ownerId === null ||
    (b.registrationNumber && b.registrationNumber.startsWith('BB-')) ||
    (b.email && b.email.endsWith('@bloodlink.test')),
  );
  if (guarded.length !== candidates.length) {
    console.log('\n[cleanupDemoBloodBanks] refusing to delete rows without a seed marker.');
    process.exit(1);
  }

  if (!confirm) {
    console.log('\n[cleanupDemoBloodBanks] dry-run only. Re-run with --confirm to delete.');
    await prisma.$disconnect();
    return;
  }

  if (guarded.length === 0) {
    console.log('\n[cleanupDemoBloodBanks] nothing to delete.');
    await prisma.$disconnect();
    return;
  }

  const ids = guarded.map((b) => b.id);
  const result = await prisma.bloodBank.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n[cleanupDemoBloodBanks] deleted ${result.count} row(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[cleanupDemoBloodBanks] failed:', err);
  process.exit(1);
});
