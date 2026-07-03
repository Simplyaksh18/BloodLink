# BloodLink Backend

Production-grade REST API for the BloodLink blood donation platform.

## Tech Stack

- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript 5.4+ (strict mode)
- **Framework:** Express.js 4.18+
- **ORM:** Prisma 5.14+ (PostgreSQL 16)
- **Auth:** JWT (jsonwebtoken)
- **Cache:** Redis (ioredis)
- **Storage:** AWS S3
- **Notifications:** Firebase Cloud Messaging
- **Validation:** Zod

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### 1. Start Infrastructure

```bash
cd docker
docker-compose up postgres redis -d
```

### 2. Install & Setup

```bash
cd bloodlink-backend
npm install
cp .env.example .env.development
# Edit .env.development with your values
npx prisma generate
npx prisma migrate dev --name init
npm run seed
```

### 3. Start Dev Server

```bash
npm run dev
# API running at http://localhost:3000/v1
# Health check: http://localhost:3000/v1/health
```

### 4. Full Docker Stack

```bash
cd docker
docker-compose up -d
# API: http://localhost:3000
# pgAdmin: http://localhost:5050
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled JS |
| `npm test` | Run test suite |
| `npm run seed` | Seed database |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## Environment Variables

See `.env.example` for all required variables.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret key (min 32 chars)
- `USE_DUMMY_DATA=true` — Skip S3 uploads in development

## API Documentation

See [API_DOCS.md](./API_DOCS.md) for full endpoint documentation.

## Architecture

```
src/
├── config/       — External service clients
├── controllers/  — HTTP handlers (thin layer)
├── services/     — Business logic
├── repositories/ — Database access
├── middleware/   — Express middleware
├── routes/       — Route definitions
├── types/        — TypeScript types matching frontend
└── utils/        — Shared utilities
```

## Test Credentials (after seeding)

| Role | Phone | Password |
|------|-------|----------|
| Super Admin | +919000000001 | Admin@123 |
| Admin | +919000000002 | Admin@123 |
| Donor | +919800000000 | Donor@123 |

## OTP in Development

With `SMS_PROVIDER=console`, OTPs are logged to the server console instead of sending SMS.
