# BloodLink API Documentation

**Base URL:** `https://api.bloodlink.app/v1`  
**Local dev:** `http://localhost:3000/v1`

## Authentication

All protected endpoints require:
```
Authorization: Bearer <jwt_token>
```

## Standard Response Format

**Success:**
```json
{ "success": true, "data": <T>, "message": "optional" }
```
**Paginated:**
```json
{
  "success": true,
  "data": {
    "data": [],
    "total": 100,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
}
```
**Error:**
```json
{ "success": false, "message": "Error description", "errors": [] }
```

---

## Auth Flow

### Registration Flow (3 steps)
```
1. POST /auth/send-otp    → get verificationToken via OTP
2. POST /auth/verify-otp  → exchange OTP for verificationToken
3. POST /auth/register    → register with verificationToken + password
```

### Login Flow (1 step)
```
POST /auth/login  →  { token, user }
```

---

## Auth Endpoints

### POST /auth/send-otp
```json
// Request
{ "phone": "+919876543210" }
// Response
{
  "success": true,
  "data": {
    "message": "OTP sent successfully",
    "expiresIn": 600,
    "otp": "123456"   // only present when USE_DUMMY_DATA=true (dev mode)
  }
}
```
Rate limited: 3 requests per minute per IP.

### POST /auth/verify-otp
```json
// Request
{ "phone": "+919876543210", "otp": "123456" }
// Response
{
  "success": true,
  "data": {
    "verified": true,
    "verificationToken": "uuid-v4",   // expires in 15 minutes
    "isNewUser": true
  }
}
```

### POST /auth/register
Register new user after OTP verification.
```json
// Request
{
  "name": "Rahul Sharma",
  "phone": "+919876543210",
  "password": "Pass@123",             // min 8 characters, required
  "verificationToken": "uuid-v4",     // optional but recommended
  "email": "rahul@example.com",       // optional
  "gender": "male",                   // optional: male | female | other
  "bloodGroup": "O+",                 // optional
  "location": { "latitude": 28.6, "longitude": 77.2, "address": "...", "city": "Delhi", "state": "Delhi", "pincode": "110001" },
  "emergencyContact": { "name": "Priya", "phone": "9876543211", "relation": "spouse" }
}
// Response 201
{ "success": true, "data": { "token": "eyJ...", "user": { ...User } } }
```

### POST /auth/login
```json
// Request
{ "phone": "9876543210", "password": "Pass@123" }
// Response 200
{ "success": true, "data": { "token": "eyJ...", "user": { ...User } } }
```

### POST /auth/firebase *(Phase 2)*
```json
// Request
{ "firebaseToken": "<firebase-id-token>" }
// Response 200
{ "success": true, "data": { "token": "eyJ...", "refreshToken": "uuid-v4", "user": {...} } }
// Note: requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY env vars
```

### POST /auth/refresh *(Phase 2)*
Rotate access + refresh tokens. Old refresh token is invalidated immediately.
```json
// Request
{ "refreshToken": "uuid-v4" }
// Response 200
{ "success": true, "data": { "token": "eyJ...", "refreshToken": "new-uuid-v4" } }
```

### GET /auth/check-email *(Phase 2)*
```
?email=test@example.com
Response: { "success": true, "data": { "available": true } }
```

### POST /auth/verify-email *(auth required, Phase 2)*
Sends a verification link to the user's email. In dev mode, link is logged to console.
```json
// Response: { "success": true, "data": null, "message": "Verification email sent" }
```

### GET /auth/verify-email?token=... *(auth required, Phase 2)*
Confirms email address using the token from the verification link.

### POST /auth/forgot-password
```json
// Request
{ "phone": "+919876543210" }
// Response: { "success": true, "data": { "message": "OTP sent for password reset", "expiresIn": 600, "otp": "..." } }
// Note: user must already exist; returns 404 if not registered
```

### POST /auth/reset-password
```json
// Request
{ "phone": "+919876543210", "otp": "123456", "newPassword": "NewPass@789" }
// Response: { "success": true, "data": null, "message": "Password reset successful" }
```

### GET /auth/me *(auth required)*
Returns current user profile.

### PUT /auth/profile *(auth required)*
```json
// Partial update — all fields optional
{ "name": "Updated Name", "bloodGroup": "A+", "location": {...} }
```

### POST /auth/logout *(auth required)*
Invalidates current token (added to Redis blacklist until expiry).

---

## Test Credentials (after `npm run seed`)

| Role | Phone | Password | Email |
|------|-------|----------|-------|
| SUPER_ADMIN | +919000000001 | Test@123 | admin@bloodlink.app |
| ADMIN | +919000000002 | Test@123 | staff1@bloodlink.app |
| ADMIN | +919000000003 | Test@123 | staff2@bloodlink.app |
| MODERATOR | +919000000004 | Test@123 | moderator@bloodlink.app |
| BLOOD_BANK | +919000000005 | Test@123 | bloodbank@bloodlink.app |
| USER (Donor 1) | +918765400001 | Test@123 | donor1@bloodlink.test |
| USER (Donor 2) | +918765400002 | Test@123 | donor2@bloodlink.test |
| ... (50 donors) | +918765400001 to +918765400050 | Test@123 | donorN@bloodlink.test |

**In development mode** (`USE_DUMMY_DATA=true`): OTP endpoints return the OTP in the response body under `data.otp` for easy testing without SMS.

---

## Blood Request Endpoints

### GET /requests/feed *(auth required)*
```
?page=1&limit=20
```
Returns paginated list of open requests, ordered by emergency level (RED first).

### GET /requests/nearby *(auth required)*
```
?lat=28.6&lng=77.2&radius=20&bloodGroup=O+
```

### POST /requests *(auth required)*
```json
{
  "bloodGroup": "O+",
  "units": 2,
  "hospitalName": "AIIMS Delhi",
  "address": "Ansari Nagar",
  "city": "Delhi",
  "emergencyLevel": "critical",
  "patientName": "John Doe",
  "patientAge": 45,
  "hospitalLatitude": 28.567,
  "hospitalLongitude": 77.209,
  "hospitalContact": "+911234567890"
}
```
Emergency levels: `critical` | `moderate` | `stable`

### GET /requests/mine *(auth required)*
Returns authenticated user's requests.

### GET /requests/:id *(auth required)*

### DELETE /requests/:id *(auth required)*
Cancels request (must be owner).

---

## Donor Endpoints

### GET /donors/profile *(auth required)*
Returns current user's donor profile.

### PUT /donors/profile *(auth required)*
```json
{
  "bloodGroup": "O+",
  "willingToDonate": true,
  "lastDonationDate": "2024-01-15T00:00:00.000Z"
}
```

### GET /donors/nearby *(auth required)*
```
?lat=28.6&lng=77.2&bloodGroup=O+
```

### GET /donors/history *(auth required)*
Returns donation history array.

---

## Blood Bank Endpoints

### GET /blood-banks *(auth required)*
Returns all active blood banks.

### GET /blood-banks/nearby *(auth required)*
```
?lat=28.6&lng=77.2&radius=20
```

### GET /blood-banks/:id *(auth required)*

---

## Map Endpoint

### GET /map *(auth required)*
```
?lat=28.6&lng=77.2&showDonors=true&showBloodBanks=true&showRequests=true&bloodGroup=O+&radius=20
```
Returns:
```json
{ "donors": [...DonorCard], "bloodBanks": [...BloodBank], "requests": [...BloodRequest] }
```

---

## Upload Endpoint

### POST /upload *(auth required)*
Multipart form upload.
```
Content-Type: multipart/form-data
file: <binary>
documentType: prescription | lab_report | blood_requirement_slip | medical_report | donation_certificate
```
Returns:
```json
{ "url": "https://...", "documentId": "uuid" }
```

---

## Notification Endpoints *(all auth required)*

### GET /notifications?page=1
### GET /notifications/unread-count
### PUT /notifications/:id/read
### PUT /notifications/read-all
### DELETE /notifications/:id

---

## Session Endpoints *(Phase 2 — all auth required)*

### GET /sessions
Returns all active sessions for the authenticated user.
```json
// Response
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "deviceInfo": { "platform": "android", "version": "1.0.0" },
      "ipAddress": "192.168.1.1",
      "lastActiveAt": "2025-06-21T10:00:00.000Z",
      "createdAt": "2025-06-20T08:00:00.000Z",
      "expiresAt": "2025-07-20T08:00:00.000Z"
    }
  ]
}
```

### DELETE /sessions/:id
Terminate a specific session by ID.

### DELETE /sessions
Terminate all other active sessions (logout everywhere except current).
Include `X-Session-Id` header to preserve the current session.

---

## Admin Endpoints *(ADMIN/SUPER_ADMIN role required)*

### GET /admin/verifications
Returns pending donor and request verifications.

### PUT /admin/verifications/:id
```json
{ "action": "approve", "reason": "optional rejection reason" }
```

### POST /admin/donors
### DELETE /admin/donors/:id
### POST /admin/blood-banks
### DELETE /admin/blood-banks/:id

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request — invalid input |
| 401 | Unauthorized — missing/invalid token |
| 403 | Forbidden — insufficient permissions |
| 404 | Not Found |
| 409 | Conflict — duplicate (phone/email) |
| 422 | Validation Error — field-level errors in `errors[]` |
| 429 | Too Many Requests — rate limited |
| 500 | Internal Server Error |

---

## Data Models

### BloodGroup
`'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'`

### EmergencyLevel
`'critical' | 'moderate' | 'stable'` → mapped to `RED | YELLOW | GREEN` internally

### User
```typescript
{
  id: string;
  name: string;
  phone: string;
  gender?: 'male' | 'female' | 'other';
  email?: string;
  avatar?: string;
  medicalCertificate?: string;
  bloodGroup?: BloodGroup;
  location?: Location;
  emergencyContact?: EmergencyContact;
  donorProfile?: DonorProfile;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```
