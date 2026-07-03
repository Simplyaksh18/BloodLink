#!/bin/bash
# BloodLink Auth Flow Test Script
# Usage: ./scripts/test-auth.sh [BASE_URL]
# Default BASE_URL: http://localhost:3000/v1

BASE_URL="${1:-http://localhost:3000/v1}"
PHONE="+918765400099"  # Fresh test number unlikely to exist
PASSWORD="Test@1234"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC} — $1"; }
fail() { echo -e "${RED}❌ FAIL${NC} — $1"; }
info() { echo -e "${YELLOW}ℹ️  $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════"
echo "  BloodLink Auth Flow Test"
echo "  Base URL: $BASE_URL"
echo "═══════════════════════════════════════════"
echo ""

# ─── Health check ─────────────────────────────
info "Health check..."
HEALTH=$(curl -sf "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "Server is healthy"
else
  fail "Server not reachable at $BASE_URL"
  echo "  Hint: start the server with: npm run dev"
  exit 1
fi

echo ""
echo "── 1. SEND OTP (Registration) ─────────────"
OTP_RES=$(curl -sf -X POST "$BASE_URL/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\"}")

if echo "$OTP_RES" | grep -q '"success":true'; then
  pass "OTP sent"
  OTP=$(echo "$OTP_RES" | grep -o '"otp":"[0-9]*"' | grep -o '[0-9]*')
  if [ -n "$OTP" ]; then
    info "Dev mode OTP returned in response: $OTP"
  else
    info "OTP logged to server console (production mode)"
    read -rp "  Enter OTP from console: " OTP
  fi
else
  fail "Send OTP failed: $OTP_RES"
  exit 1
fi

echo ""
echo "── 2. VERIFY OTP ───────────────────────────"
VERIFY_RES=$(curl -sf -X POST "$BASE_URL/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"otp\":\"$OTP\"}")

if echo "$VERIFY_RES" | grep -q '"verified":true'; then
  pass "OTP verified"
  VT=$(echo "$VERIFY_RES" | grep -o '"verificationToken":"[^"]*"' | grep -o '"verificationToken":"[^"]*"' | sed 's/"verificationToken":"//;s/"//')
  info "verificationToken obtained"
else
  fail "OTP verify failed: $VERIFY_RES"
  exit 1
fi

echo ""
echo "── 3. REGISTER ─────────────────────────────"
REG_RES=$(curl -sf -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"phone\":\"$PHONE\",\"password\":\"$PASSWORD\",\"verificationToken\":\"$VT\"}")

if echo "$REG_RES" | grep -q '"token"'; then
  pass "Registration successful"
  JWT=$(echo "$REG_RES" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
  info "JWT token obtained"
else
  fail "Registration failed: $REG_RES"
  exit 1
fi

echo ""
echo "── 4. LOGIN (Password) ─────────────────────"
LOGIN_RES=$(curl -sf -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSWORD\"}")

if echo "$LOGIN_RES" | grep -q '"token"'; then
  pass "Login with password successful"
  JWT=$(echo "$LOGIN_RES" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
else
  fail "Login failed: $LOGIN_RES"
  exit 1
fi

echo ""
echo "── 5. GET PROFILE (/auth/me) ───────────────"
ME_RES=$(curl -sf -X GET "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $JWT")

if echo "$ME_RES" | grep -q '"phone"'; then
  pass "GET /auth/me returned user profile"
else
  fail "GET /auth/me failed: $ME_RES"
fi

echo ""
echo "── 6. WRONG PASSWORD ───────────────────────"
WRONG_RES=$(curl -sf -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"password\":\"WrongPass999\"}" || true)
if echo "$WRONG_RES" | grep -q '"success":false'; then
  pass "Correct 401 on wrong password"
else
  fail "Should have rejected wrong password: $WRONG_RES"
fi

echo ""
echo "── 7. SEEDED USER LOGIN ────────────────────"
SEEDED_RES=$(curl -sf -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+918765400001","password":"Test@123"}')

if echo "$SEEDED_RES" | grep -q '"token"'; then
  pass "Seeded donor login successful (phone: +918765400001 / Test@123)"
else
  fail "Seeded user login failed — did you run npm run seed? Response: $SEEDED_RES"
fi

echo ""
echo "── 8. FORGOT PASSWORD ──────────────────────"
FP_RES=$(curl -sf -X POST "$BASE_URL/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\"}")

if echo "$FP_RES" | grep -q '"success":true'; then
  pass "Forgot password OTP sent"
  RESET_OTP=$(echo "$FP_RES" | grep -o '"otp":"[0-9]*"' | grep -o '[0-9]*')
  if [ -z "$RESET_OTP" ]; then
    read -rp "  Enter reset OTP from console: " RESET_OTP
  else
    info "Reset OTP (dev mode): $RESET_OTP"
  fi
else
  fail "Forgot password failed: $FP_RES"
  RESET_OTP=""
fi

echo ""
echo "── 9. RESET PASSWORD ───────────────────────"
if [ -n "$RESET_OTP" ]; then
  NEW_PASSWORD="NewPass@456"
  RP_RES=$(curl -sf -X POST "$BASE_URL/auth/reset-password" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$PHONE\",\"otp\":\"$RESET_OTP\",\"newPassword\":\"$NEW_PASSWORD\"}")

  if echo "$RP_RES" | grep -q '"success":true'; then
    pass "Password reset successful"

    NEW_LOGIN=$(curl -sf -X POST "$BASE_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"phone\":\"$PHONE\",\"password\":\"$NEW_PASSWORD\"}")
    if echo "$NEW_LOGIN" | grep -q '"token"'; then
      pass "Login with new password works"
    else
      fail "Login with new password failed"
    fi
  else
    fail "Reset password failed: $RP_RES"
  fi
else
  info "Skipping reset password test (no OTP available)"
fi

echo ""
echo "── 10. LOGOUT ──────────────────────────────"
LOGOUT_RES=$(curl -sf -X POST "$BASE_URL/auth/logout" \
  -H "Authorization: Bearer $JWT")
if echo "$LOGOUT_RES" | grep -q '"success":true'; then
  pass "Logout successful"
else
  fail "Logout failed: $LOGOUT_RES"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Auth test complete!"
echo "═══════════════════════════════════════════"
echo ""
