# Phase 2 Database Migration

Run these commands from the `backend/` directory:

```bash
# Generate and apply migration
npx prisma migrate dev --name phase2_sessions_firebase_tokenversion

# Re-generate Prisma client
npx prisma generate

# Re-seed (idempotent — uses upsert)
npm run seed
```

## What this migration adds

| Table / Column | Change |
|---|---|
| `User.firebaseUid` | New nullable unique column — links Firebase UID to user |
| `User.tokenVersion` | New Int column (default 0) — incremented on password reset to invalidate all JWTs |
| `User.emailVerified` | New Boolean column (default false) |
| `UserRole` enum | Added `MODERATOR` and `BLOOD_BANK` values |
| `Session` | **New table** — tracks refresh tokens and device info per login |

## Notes

- Existing `User` rows get `tokenVersion=0`, `emailVerified=false`, `firebaseUid=null` — no data loss.
- The `UserRole` enum extension is additive; existing `SUPER_ADMIN / ADMIN / USER` roles are unaffected.
- The `Session` table is separate from the JWT blacklist (which stays in Redis). Sessions power the "view/revoke active sessions" feature and store refresh tokens.
- Refresh tokens rotate on every use (old one is revoked, new one is issued). A compromised refresh token can only be used once.
