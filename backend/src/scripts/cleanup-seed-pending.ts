/**
 * One-shot dev script: deletes phantom PENDING_REVIEW verification rows created
 * by the seed's old 20%-bucket logic.
 *
 * Run:
 *   cd backend
 *   npx ts-node -r dotenv/config --transpile-only src/scripts/cleanup-seed-pending.ts
 */

import { PrismaClient, VerificationStatus, VerificationType } from '@prisma/client';

// ── 1. Validate env ──────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('[cleanup] ❌  DATABASE_URL is not set. Make sure you run with dotenv/config.');
  process.exit(1);
}
console.log('[cleanup] DATABASE_URL found:', dbUrl.replace(/:\/\/[^@]+@/, '://***@').slice(0, 60) + '...');

// ── 2. Prisma client ──────────────────────────────────────────────────────────

const prisma = new PrismaClient({ log: [] });

// ── 3. Fingerprint for fake rows ──────────────────────────────────────────────

const FAKE_ROW_FILTER = {
  verificationType: VerificationType.ID_PROOF,
  status:           VerificationStatus.PENDING_REVIEW,
  fileName:         'pending.jpg',
  reviewerId:       null,
  s3Key:            { endsWith: '/ID_PROOF/pending.jpg' },
} as const;

// ── 4. Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n[cleanup] Connecting to database...');
  await prisma.$connect();
  console.log('[cleanup] ✅ Database connected.\n');

  // ── Before: find candidates ─────────────────────────────────────────────────
  const before = await prisma.verification.findMany({
    where: FAKE_ROW_FILTER,
    select: {
      id:               true,
      userId:           true,
      s3Key:            true,
      status:           true,
      fileName:         true,
      uploadedAt:       true,
      createdAt:        true,
    },
  });

  console.log(`[cleanup] Fake PENDING_REVIEW rows found BEFORE delete: ${before.length}`);
  if (before.length > 0) {
    for (const row of before) {
      console.log(
        `  → id=${row.id}  userId=${row.userId}  fileName=${row.fileName}` +
        `  uploadedAt=${row.uploadedAt?.toISOString() ?? 'null'}  createdAt=${row.createdAt.toISOString()}`
      );
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  if (before.length === 0) {
    console.log('\n[cleanup] ✅ Nothing to delete.');
  } else {
    const { count } = await prisma.verification.deleteMany({
      where: { id: { in: before.map(r => r.id) } },
    });
    console.log(`\n[cleanup] Deleted: ${count} row(s).`);
  }

  // ── After: verify none remain ───────────────────────────────────────────────
  const after = await prisma.verification.findMany({
    where: FAKE_ROW_FILTER,
    select: { id: true, userId: true },
  });

  console.log(`\n[cleanup] Fake PENDING_REVIEW rows remaining AFTER delete: ${after.length}`);
  if (after.length === 0) {
    console.log('[cleanup] ✅ Clean — no phantom rows remain.');
  } else {
    console.error('[cleanup] ❌  Rows still present:');
    for (const row of after) {
      console.error(`  → id=${row.id}  userId=${row.userId}`);
    }
    process.exitCode = 1;
  }

  console.log('\n[cleanup] Done.');
}

main()
  .catch(err => {
    console.error('\n[cleanup] ❌  Fatal error:');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('[cleanup] Database disconnected.');
  });
