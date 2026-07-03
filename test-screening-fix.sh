#!/bin/bash
# test-screening-fix.sh
# Verifies health screening data persistence and Phase 5 status sync.
# Usage: ./test-screening-fix.sh [BASE_URL] [PHONE] [PASSWORD]
#   Defaults: localhost:3000, +919876543210, Test@123

set -euo pipefail

BASE="${1:-http://localhost:3000/v1}"
PHONE="${2:-+919876543210}"
PASSWORD="${3:-Test@123}"

hr() { echo "────────────────────────────────────────────────"; }

hr
echo "STEP 1: Login"
hr
LOGIN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null \
  || echo "$LOGIN" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Login failed. Response: $LOGIN"
  exit 1
fi
echo "Login OK. Token: ${TOKEN:0:20}..."

hr
echo "STEP 2: State BEFORE screening"
hr
BEFORE=$(curl -s "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")
echo "$BEFORE" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print('donorStatus     :', d.get('donorStatus','NOT FOUND'))
print('isEligible      :', d.get('isDonorEligible','NOT FOUND'))
print('deferralDate    :', d.get('deferralDate','null'))
print('deferralReason  :', d.get('deferralReason','null'))
print('nextEligibleDate:', d.get('nextEligibleDate','null'))
" 2>/dev/null || echo "$BEFORE"

hr
echo "STEP 3: Submit health screening (alcohol = true → DEFERRED)"
hr
SCREENING=$(curl -s -X POST "$BASE/donors/health-screening" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "hasHeartDisease":false,"hasDiabetes":false,"hasHepatitis":false,"hasHiv":false,
    "hasTuberculosis":false,"hasCancer":false,"hasBleedingDisorder":false,
    "hasSeizureDisorder":false,"hasKidneyDisease":false,"hasLiverDisease":false,
    "hasRespiratoryDisease":false,"hasAutoimmuneDisease":false,
    "hasRecentSurgery":false,"hasRecentTattoo":false,"hasRecentPiercing":false,
    "hasRecentTravel":false,"hasRecentVaccination":false,
    "hasDonatedBefore":false,"hasAdverseReaction":false,"isOnMedication":false,
    "isPregnant":false,"isBreastfeeding":false,
    "hasConsumedAlcohol24h":true,
    "hasFever":false
  }')
echo "Response: $(echo "$SCREENING" | python3 -c "import sys,json; d=json.load(sys.stdin); print('screeningPassed:', d['data']['screeningPassed'], '| eligible:', d['data']['eligibility']['eligible'], '| nextEligibleDate:', d['data']['eligibility']['nextEligibleDate'])" 2>/dev/null || echo "$SCREENING")"

hr
echo "STEP 4: State AFTER screening (should be DEFERRED)"
hr
AFTER=$(curl -s "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")
echo "$AFTER" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print('donorStatus     :', d.get('donorStatus','NOT FOUND'))
print('isEligible      :', d.get('isDonorEligible','NOT FOUND'))
print('deferralDate    :', d.get('deferralDate','null'))
print('deferralReason  :', d.get('deferralReason','null'))
print('nextEligibleDate:', d.get('nextEligibleDate','null'))
" 2>/dev/null || echo "$AFTER"

hr
echo "STEP 5: Phase 5 donor/status (should be DEFERRED with populated fields)"
hr
STATUS=$(curl -s "$BASE/donor/status" -H "Authorization: Bearer $TOKEN")
echo "$STATUS" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print('donorStatus     :', d.get('donorStatus','NOT FOUND'))
print('isEligible      :', d.get('isEligible','NOT FOUND'))
print('deferralReason  :', d.get('deferralReason','null'))
print('nextEligibleDate:', d.get('nextEligibleDate','null'))
print('daysRemaining   :', d.get('daysRemaining','null'))
" 2>/dev/null || echo "$STATUS"

hr
echo "STEP 6: RESULT VERIFICATION"
hr
DONOR_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['donorStatus'])" 2>/dev/null || echo "PARSE_ERROR")
DEFERRAL_REASON=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['deferralReason'])" 2>/dev/null || echo "PARSE_ERROR")

if [ "$DONOR_STATUS" = "DEFERRED" ]; then
  echo "✅ donorStatus is DEFERRED (not NEVER_DONATED)"
else
  echo "❌ FAIL: donorStatus is '$DONOR_STATUS' (expected DEFERRED)"
fi

if [ -n "$DEFERRAL_REASON" ] && [ "$DEFERRAL_REASON" != "None" ] && [ "$DEFERRAL_REASON" != "null" ] && [ "$DEFERRAL_REASON" != "PARSE_ERROR" ]; then
  echo "✅ deferralReason is populated: $DEFERRAL_REASON"
else
  echo "❌ FAIL: deferralReason is empty/null"
fi

hr
echo "Test complete."
