# BloodLink — Backend Deployment Checklist

## Pre-Deploy

- [ ] All env vars set in production environment (see `.env.example`)
- [ ] `JWT_SECRET` is ≥ 32 random bytes — never reuse dev secret
- [ ] `POSTGRES_PASSWORD` / `REDIS_PASSWORD` are strong and not defaults
- [ ] AWS S3 bucket exists, IAM credentials have least-privilege (`s3:PutObject`, `s3:GetObject` only)
- [ ] Firebase service account JSON is loaded (for push notifications)
- [ ] `CORS_ORIGIN` is set to the exact mobile app origin or `*` only in dev
- [ ] `NODE_ENV=production`

## Database

```bash
# Run migrations (never prisma migrate dev in production)
npx prisma migrate deploy --schema src/prisma/schema.prisma

# Verify all tables exist
npx prisma db pull --schema src/prisma/schema.prisma
```

- [ ] Migrations applied cleanly (zero errors)
- [ ] Seed data loaded if first deploy: `npm run seed`
- [ ] DB connection pooling set (PgBouncer or DATABASE_URL pool params: `?pool_timeout=10&connection_limit=10`)

## Docker — Local Prod-like Stack

```bash
# Build production image
cd backend
docker build -f docker/Dockerfile -t bloodlink-api:latest .

# Start prod stack (requires .env.production)
docker compose -f docker/docker-compose.prod.yml up -d

# Check health
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/health/security
```

## Smoke Tests After Deploy

```bash
# Health
curl https://api.bloodlink.app/v1/health

# Security headers present
curl -I https://api.bloodlink.app/v1/health | grep -E "x-frame|x-content|strict-transport"

# Auth guard active
curl -s https://api.bloodlink.app/v1/donor/status | jq .success  # → false (401)

# Body limit enforced
curl -s -X POST https://api.bloodlink.app/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"$(python3 -c "print('x'*1100000)")\"}" | jq .  # → 413

# Compression active
curl -I -H "Accept-Encoding: gzip" https://api.bloodlink.app/v1/health | grep -i "content-encoding"
```

## Monitoring

- [ ] Winston logs shipping to CloudWatch / Datadog / Loggly
- [ ] `/v1/health` polled by uptime monitor (UptimeRobot / BetterUptime) every 1 min
- [ ] DB disk usage alert set at 80%
- [ ] Redis memory alert set at 80%

## Rollback

```bash
# Revert to previous image tag
docker pull bloodlink-api:<previous-tag>
docker compose -f docker/docker-compose.prod.yml up -d --no-build

# Revert migration (only if migration is reversible)
npx prisma migrate resolve --rolled-back <migration-name>
```

## Post-Launch

- [ ] Rate limit thresholds validated under load (adjust `rateLimiter.middleware.ts` if needed)
- [ ] Firebase push delivery confirmed (send test notification)
- [ ] S3 presigned URL expiry verified (default 300 s — check `aws.service.ts`)
- [ ] Socket.IO connections stable under concurrent load
- [ ] `eligibilityUpdateJob` (hourly) and `requestExpiryJob` (5 min) verified running in logs
