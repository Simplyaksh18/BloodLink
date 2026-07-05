# BloodLink

A verified, mobile-first blood-donation coordination platform for donors, blood banks, hospitals, and administrators.

---

## Overview

BloodLink is a cross-platform mobile application built with React Native (Expo) and a Node.js/TypeScript backend. It replaces the ad-hoc coordination that happens today across phone chains, WhatsApp groups, and outdated public listings with a single, authenticated marketplace where every participant, document, and request has a state.

The platform enforces role-based flows (donors, blood-bank owners, admins, super-admins), a stateful donor-eligibility engine with cooldown and medical validity checks, presigned document upload with automated verification and admin review, geographic donor–request matching, blood-bank inventory management, real-time messaging, and push notifications. Nothing on the screen is a mock: every list, badge, and status number resolves to a database row.

BloodLink is under active development. The core donor, blood-bank, admin, request, and messaging flows are working end-to-end; further hardening around observability, offline support, and analytics is planned.

---

## Why BloodLink?

Blood coordination in most Indian cities still relies on informal channels. A few of the practical failures this creates:

- Emergency requesters have no way to verify a donor's blood group, ID, or medical fitness before contacting them.
- Donor eligibility (90-day cooldown, medical clearance, health screening) is tracked only in memory, not in a system.
- Blood-bank inventory is not publicly discoverable in real time.
- Requests, acceptances, fulfilments, and cancellations are not lifecycle-tracked, so nobody knows what's still open.
- There is no admin oversight, no audit trail, and no fraud check on uploaded proofs.
- Recipients often reach donors who donated recently and are not currently eligible.

BloodLink addresses these by requiring authenticated accounts, running a deterministic eligibility engine before every request, verifying documents through automated checks plus admin review, and exposing an authoritative `canRequestBlood` flag so the client never guesses eligibility.

---

## Social Impact

Blood shortages during emergencies are usually a coordination failure, not a supply failure. BloodLink aims to close that gap by ensuring every donor listed in a search result is real, currently eligible, and reachable, and every blood bank shown is verified with public inventory data. By tracking requests through a full lifecycle and enforcing eligibility server-side, the platform can shorten the time between an emergency call and a confirmed donor, reduce repeat outreach to ineligible donors, and give administrators a single place to review authenticity. Small improvements in coordination speed at emergency-blood scale translate directly into lives that would otherwise be lost.

## Key Features

### Donors

- Phone-OTP + password sign-up, stateful donor status (`NEVER_DONATED`, `PENDING_REVIEW`, `ACTIVE`, `DEFERRED`, `INELIGIBLE`).
- Document upload (ID proof, blood-group proof, medical screening) through presigned S3 URLs.
- Health screening questionnaire with permanent and temporary deferral rules.
- 90-day post-donation cooldown enforced server-side.
- Donation history, digital donor card, and next-eligible reminders.

### Blood Banks

- Owner registration with a licence number.
- Verification workflow: bank starts in `PENDING_REVIEW` and moves to `VERIFIED` or `REJECTED` via admin action.
- Per-blood-group inventory management with unit counts and expiry dates.
- Incoming request queue (`accept` / `reject` / `complete`).
- Public discovery only lists verified banks.

### Hospitals / Recipients

- Blood-request creation with hospital metadata and priority levels (`critical`, `moderate`, `stable`).
- Request lifecycle (`OPEN`, `ACTIVE`, `IN_PROGRESS`, `FULFILLED`, `CANCELLED`, `EXPIRED`).
- Optional targeting of a specific donor or a specific blood bank.
- Donor discovery with backend-authoritative availability labels.

### Administrators

- Super-admin dashboard for the blood-bank verification queue with approve / reject actions.
- Pending-donor and pending-request review under the same admin router.
- Role-based access via existing middleware (`ADMIN`, `SUPER_ADMIN`, `MODERATOR`).
- Every verification decision writes an `AuditLog` row with previous and new status.

### Safety & Verification

- Documents run through automated checks + confidence scoring + fraud detection before reaching human review.
- Fraud alerts are stored per verification and surfaced in the admin queue.
- Verified public directory: unverified blood banks are not exposed to anonymous callers.
- PII sanitiser applied to audit metadata and structured logs.

### Smart Matching

- Haversine distance filter for donor and blood-bank discovery.
- Blood-group compatibility check.
- Eligibility engine determines `canRequestBlood` per donor before returning discovery results, so the app cannot show "Request Blood" on ineligible or unclaimed donors.

### Real-Time Messaging & Notifications

- One-to-one chat between requester and donor over Socket.IO with a REST fallback.
- In-app + push notifications for verification outcomes, request lifecycle events, blood-bank actions, and new messages.
- Persistent notification history per user.

---

## Tech Stack

- **Frontend** — React Native, Expo (SDK), Expo Router, TypeScript, Zustand, TanStack Query
- **Backend** — Node.js, Express, TypeScript, Zod, Winston
- **Database** — PostgreSQL via Prisma ORM
- **Cache & queues** — Redis (OTP cache, JWT blacklist, rate-limit windows)
- **Authentication** — JWT (access + refresh), Firebase Phone Auth, bcrypt for passwords
- **Real-time** — Socket.IO
- **Storage** — AWS S3 (presigned upload/view URLs)
- **Notifications** — Firebase Admin (FCM) + Expo Push
- **Maps & location** — Expo Location, React Native Maps
- **Containerisation** — Docker + Docker Compose
- **Deployment** — Render (backend), EAS Build (mobile client)
- **Testing** — Jest, Supertest, ts-jest

---

## Project Architecture

```
Mobile App  (Expo, React Native, TypeScript)
      │
      ▼
REST API  (Express, Zod-validated, JWT-authenticated)
      │
      ▼
Business Layer  (services / eligibility, verification, matching, messaging)
      │
      ├── Prisma ORM  →  PostgreSQL
      ├── Redis        (OTP, rate limits, JWT blacklist)
      ├── S3           (documents, presigned URLs)
      ├── Socket.IO    (chat + push events)
      └── Firebase / Expo Push  (notifications)
```

Backend is layered as `routes → controllers → services → repositories → Prisma`. Cross-cutting middleware handles authentication, role-based access, request validation, rate limiting, and error normalisation.

---

## Current Status

Active development. The following modules are implemented and running end-to-end:

- Authentication (password + OTP), sessions, refresh tokens
- Donor onboarding, eligibility engine, health screening, cooldown
- Document upload, automated checks, admin review queue
- Blood-bank owner flow, inventory management, verification lifecycle
- Blood-request creation, matching, response, fulfilment
- Real-time chat, notifications, audit logging
- Super-admin dashboard for blood-bank verification

Planned enhancements include automated end-to-end test coverage, offline outbox for chat and requests, hospital-role dashboards, per-request analytics, and an ML-assisted document parser.

---

## Contributing

Issues and pull requests are welcome. Please open an issue first for anything larger than a small fix so the direction can be discussed. Follow the existing folder layout, keep changes scoped, and add a short description of the intent in the PR body.
