#!/usr/bin/env bash
# Phase 4 Eligibility Engine — manual test script
# Run: bash backend/tests/test-eligibility.sh
# Requires: curl, jq
# Backend must be running on the BASE_URL below.

BASE_URL="${BLOODLINK_API:-http://localhost:3000/v1}"
PASS="Test@123"

sep() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; echo "▶ $*"; echo; }
ok()  { echo "  ✅  $*"; }
fail(){ echo "  ❌  $*"; }

# ── Login helper ─────────────────────────────────────────────────────────────
login() {
  local phone="$1"
  local resp
  resp=$(curl -s -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$phone\",\"password\":\"$PASS\"}")
  echo "$resp" | jq -r '.data.tokens.accessToken // empty'
}

# ═══════════════════════════════════════════════════════════════════════
sep "Test 1 — User A (+919876543230): GET /donors/eligibility → on cooldown"
TOKEN_A=$(login "+919876543230")
curl -s "$BASE_URL/donors/eligibility" \
  -H "Authorization: Bearer $TOKEN_A" | jq '.data.donationCooldown'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 2 — User A: PUT /donors/become-donor → rejected (cooldown)"
curl -s -X PUT "$BASE_URL/donors/become-donor" \
  -H "Authorization: Bearer $TOKEN_A" | jq '{success:.success, message:.message, data:.data}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 3 — User B (+919876543231): GET /donors/eligibility → needs health screening"
TOKEN_B=$(login "+919876543231")
curl -s "$BASE_URL/donors/eligibility" \
  -H "Authorization: Bearer $TOKEN_B" | jq '.data.healthScreening'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 4 — User B: PUT /donors/become-donor → rejected (no health screening)"
curl -s -X PUT "$BASE_URL/donors/become-donor" \
  -H "Authorization: Bearer $TOKEN_B" | jq '{success:.success, message:.message}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 5 — User B: POST /donors/health-screening → submit (should fail: no weight)"
curl -s -X POST "$BASE_URL/donors/health-screening" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{
    "hasHeartDisease":false,"hasDiabetes":false,"hasHepatitis":false,"hasHiv":false,
    "hasTuberculosis":false,"hasCancer":false,"hasBleedingDisorder":false,
    "hasSeizureDisorder":false,"hasKidneyDisease":false,"hasLiverDisease":false,
    "hasRespiratoryDisease":false,"hasAutoimmuneDisease":false,
    "hasRecentSurgery":false,"hasRecentTattoo":false,"hasRecentPiercing":false,
    "hasRecentTravel":false,"hasRecentVaccination":false,
    "hasDonatedBefore":false,"hasAdverseReaction":false,
    "isOnMedication":false,"isPregnant":false,"isBreastfeeding":false,
    "hasConsumedAlcohol24h":false,"hasFever":false,
    "weight":45,
    "height":165,"bloodPressure":"118/76","hemoglobinLevel":14.0,"pulseRate":72,"temperature":36.8
  }' | jq '{success:.success, screeningPassed:.data.screeningPassed, factors:.data.disqualifyingFactors}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 6 — User B: POST /donors/health-screening → submit valid (weight >= 50)"
curl -s -X POST "$BASE_URL/donors/health-screening" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{
    "hasHeartDisease":false,"hasDiabetes":false,"hasHepatitis":false,"hasHiv":false,
    "hasTuberculosis":false,"hasCancer":false,"hasBleedingDisorder":false,
    "hasSeizureDisorder":false,"hasKidneyDisease":false,"hasLiverDisease":false,
    "hasRespiratoryDisease":false,"hasAutoimmuneDisease":false,
    "hasRecentSurgery":false,"hasRecentTattoo":false,"hasRecentPiercing":false,
    "hasRecentTravel":false,"hasRecentVaccination":false,
    "hasDonatedBefore":false,"hasAdverseReaction":false,
    "isOnMedication":false,"isPregnant":false,"isBreastfeeding":false,
    "hasConsumedAlcohol24h":false,"hasFever":false,
    "weight":65,"height":170,"bloodPressure":"120/80",
    "hemoglobinLevel":14.2,"pulseRate":70,"temperature":37.0
  }' | jq '{success:.success, screeningPassed:.data.screeningPassed, eligible:.data.eligibility.eligible, message:.message}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 7 — User B: PUT /donors/become-donor → now eligible"
curl -s -X PUT "$BASE_URL/donors/become-donor" \
  -H "Authorization: Bearer $TOKEN_B" | jq '{success:.success, eligible:.data.isDonorEligible, expiry:.data.donorEligibilityExpiry}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 8 — User C (+919876543232): POST /donors/health-screening → HIV disqualification"
TOKEN_C=$(login "+919876543232")
curl -s -X POST "$BASE_URL/donors/health-screening" \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{
    "hasHeartDisease":false,"hasDiabetes":false,"hasHepatitis":false,"hasHiv":true,
    "hasTuberculosis":false,"hasCancer":false,"hasBleedingDisorder":false,
    "hasSeizureDisorder":false,"hasKidneyDisease":false,"hasLiverDisease":false,
    "hasRespiratoryDisease":false,"hasAutoimmuneDisease":false,
    "hasRecentSurgery":false,"hasRecentTattoo":false,"hasRecentPiercing":false,
    "hasRecentTravel":false,"hasRecentVaccination":false,
    "hasDonatedBefore":false,"hasAdverseReaction":false,
    "isOnMedication":false,"isPregnant":false,"isBreastfeeding":false,
    "hasConsumedAlcohol24h":false,"hasFever":false,
    "weight":65,"height":170,"bloodPressure":"120/80","hemoglobinLevel":14.0
  }' | jq '{success:.success, screeningPassed:.data.screeningPassed, factors:.data.disqualifyingFactors, eligible:.data.eligibility.eligible}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 9 — User D (+919876543233): GET /donors/eligibility → fully eligible"
TOKEN_D=$(login "+919876543233")
curl -s "$BASE_URL/donors/eligibility" \
  -H "Authorization: Bearer $TOKEN_D" | jq '{eligible:.data.eligible, expiry:.data.eligibilityExpiry, screening:.data.healthScreening}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 10 — User D: GET /donors/document-status"
curl -s "$BASE_URL/donors/document-status" \
  -H "Authorization: Bearer $TOKEN_D" | jq '{canProceed:.data.canProceed, needs:.data.needsDocuments, existing:(.data.existingDocuments | keys)}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 11 — User D: PUT /donors/become-donor → success"
curl -s -X PUT "$BASE_URL/donors/become-donor" \
  -H "Authorization: Bearer $TOKEN_D" | jq '{success:.success, eligible:.data.isDonorEligible, expiry:.data.donorEligibilityExpiry, message:.message}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 12 — User D: POST /donors/set-reminder"
FUTURE_DATE=$(date -u -v+30d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+30 days" +"%Y-%m-%dT%H:%M:%SZ")
curl -s -X POST "$BASE_URL/donors/set-reminder" \
  -H "Authorization: Bearer $TOKEN_D" \
  -H "Content-Type: application/json" \
  -d "{\"reminderDate\":\"$FUTURE_DATE\"}" | jq '{success:.success, reminderDate:.data.reminderDate}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 13 — User E (+919876543234): GET /donors/document-status"
TOKEN_E=$(login "+919876543234")
curl -s "$BASE_URL/donors/document-status" \
  -H "Authorization: Bearer $TOKEN_E" | jq '{canProceed:.data.canProceed, needs:.data.needsDocuments}'

# ═══════════════════════════════════════════════════════════════════════
sep "Test 14 — Validation: POST health-screening with bad BP format"
curl -s -X POST "$BASE_URL/donors/health-screening" \
  -H "Authorization: Bearer $TOKEN_D" \
  -H "Content-Type: application/json" \
  -d '{
    "hasHeartDisease":false,"hasDiabetes":false,"hasHepatitis":false,"hasHiv":false,
    "hasTuberculosis":false,"hasCancer":false,"hasBleedingDisorder":false,
    "hasSeizureDisorder":false,"hasKidneyDisease":false,"hasLiverDisease":false,
    "hasRespiratoryDisease":false,"hasAutoimmuneDisease":false,
    "hasRecentSurgery":false,"hasRecentTattoo":false,"hasRecentPiercing":false,
    "hasRecentTravel":false,"hasRecentVaccination":false,
    "hasDonatedBefore":false,"hasAdverseReaction":false,
    "isOnMedication":false,"isPregnant":false,"isBreastfeeding":false,
    "hasConsumedAlcohol24h":false,"hasFever":false,
    "bloodPressure":"120-80"
  }' | jq '{success:.success, errors:.data.errors.bloodPressure}'

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All Phase 4 tests complete"
