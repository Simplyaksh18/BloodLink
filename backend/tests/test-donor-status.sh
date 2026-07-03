#!/usr/bin/env bash
# Phase 5 — Donor Status Endpoint Tests
# Usage: ./tests/test-donor-status.sh
# Requires: curl, jq (optional for pretty output)
# Backend must be running: http://localhost:3000

BASE="http://localhost:3000/v1"
PASS=0; FAIL=0

c() { printf "\033[36m$1\033[0m\n"; }
ok() { printf "\033[32m  ✅ PASS: $1\033[0m\n"; ((PASS++)); }
fail() { printf "\033[31m  ❌ FAIL: $1\033[0m\n"; ((FAIL++)); }

login() {
  curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"password\":\"Test@123\"}" | grep -o '"token":"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"'
}

# ─── Test 1: ACTIVE donor status ─────────────────────────────────────────────
c "Test 1: ACTIVE donor (+919876543240)"
TOKEN=$(login "+919876543240")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "ACTIVE" ] && ok "donorStatus=ACTIVE" || fail "Expected ACTIVE, got: $STATUS"

IS_ELIG=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['isEligible'])" 2>/dev/null)
[ "$IS_ELIG" = "True" ] && ok "isEligible=true" || fail "Expected isEligible=true, got: $IS_ELIG"

# ─── Test 2: DEFERRED donor (45 days left) ────────────────────────────────────
c "Test 2: DEFERRED donor (+919876543241)"
TOKEN=$(login "+919876543241")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "DEFERRED" ] && ok "donorStatus=DEFERRED" || fail "Expected DEFERRED, got: $STATUS"

DAYS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['daysRemaining'])" 2>/dev/null)
[ "$DAYS" -gt 0 ] 2>/dev/null && ok "daysRemaining=$DAYS (>0)" || fail "Expected daysRemaining>0, got: $DAYS"

# ─── Test 3: DEFERRED donor (2 days left) ─────────────────────────────────────
c "Test 3: DEFERRED 2 days (+919876543242)"
TOKEN=$(login "+919876543242")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "DEFERRED" ] && ok "donorStatus=DEFERRED" || fail "Expected DEFERRED, got: $STATUS"

DAYS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['daysRemaining'])" 2>/dev/null)
[ "$DAYS" -le 3 ] 2>/dev/null && ok "daysRemaining=$DAYS (<=3)" || fail "Expected daysRemaining<=3, got: $DAYS"

# ─── Test 4: INELIGIBLE donor ─────────────────────────────────────────────────
c "Test 4: INELIGIBLE donor (+919876543243)"
TOKEN=$(login "+919876543243")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "INELIGIBLE" ] && ok "donorStatus=INELIGIBLE" || fail "Expected INELIGIBLE, got: $STATUS"

REASON=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['deferralReason'])" 2>/dev/null)
[[ "$REASON" == *"HIV"* ]] && ok "deferralReason contains HIV" || fail "Expected HIV in reason, got: $REASON"

# ─── Test 5: NEVER_DONATED user ───────────────────────────────────────────────
c "Test 5: NEVER_DONATED user (+919876543244)"
TOKEN=$(login "+919876543244")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "NEVER_DONATED" ] && ok "donorStatus=NEVER_DONATED" || fail "Expected NEVER_DONATED, got: $STATUS"

# ─── Test 6: PENDING_REVIEW user ──────────────────────────────────────────────
c "Test 6: PENDING_REVIEW user (+919876543245)"
TOKEN=$(login "+919876543245")
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "PENDING_REVIEW" ] && ok "donorStatus=PENDING_REVIEW" || fail "Expected PENDING_REVIEW, got: $STATUS"

CAN=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['canBecomeDonor'])" 2>/dev/null)
[ "$CAN" = "True" ] && ok "canBecomeDonor=true" || fail "Expected canBecomeDonor=true, got: $CAN"

# ─── Test 7: Register as donor (PENDING_REVIEW → ACTIVE) ──────────────────────
c "Test 7: POST /donor/register (+919876543245)"
TOKEN=$(login "+919876543245")
RESP=$(curl -s -X POST "$BASE/donor/register" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
SUCCESS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['success'])" 2>/dev/null)
[ "$SUCCESS" = "True" ] && ok "register succeeded" || fail "Register failed: $RESP"

NEW_STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$NEW_STATUS" = "ACTIVE" ] && ok "donorStatus updated to ACTIVE" || fail "Expected ACTIVE after register, got: $NEW_STATUS"

# ─── Test 8: Set reminder ─────────────────────────────────────────────────────
c "Test 8: POST /donor/set-reminder (DEFERRED user)"
TOKEN=$(login "+919876543241")
RESP=$(curl -s -X POST "$BASE/donor/set-reminder" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
REM=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['reminderSet'])" 2>/dev/null)
[ "$REM" = "True" ] && ok "reminderSet=true" || fail "Expected reminderSet=true, got: $REM"

# ─── Test 9: Cancel reminder ──────────────────────────────────────────────────
c "Test 9: DELETE /donor/reminder"
RESP=$(curl -s -X DELETE "$BASE/donor/reminder" -H "Authorization: Bearer $TOKEN")
REM=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['reminderSet'])" 2>/dev/null)
[ "$REM" = "False" ] && ok "reminderSet=false after cancel" || fail "Expected false, got: $REM"

# ─── Test 10: Reactivate check ────────────────────────────────────────────────
c "Test 10: PUT /donor/reactivate (ACTIVE user)"
TOKEN=$(login "+919876543240")
RESP=$(curl -s -X PUT "$BASE/donor/reactivate" -H "Authorization: Bearer $TOKEN")
STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['donorStatus'])" 2>/dev/null)
[ "$STATUS" = "ACTIVE" ] && ok "ACTIVE user stays ACTIVE after reactivate" || fail "Expected ACTIVE, got: $STATUS"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ $FAIL -eq 0 ] && echo "✅ All tests passed!" || echo "❌ $FAIL test(s) failed"
