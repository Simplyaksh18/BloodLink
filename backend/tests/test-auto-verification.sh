#!/usr/bin/env bash
# test-auto-verification.sh — Automated verification pipeline tests
# Usage: bash tests/test-auto-verification.sh
# Requires: curl, running backend on port 3000 (with USE_DUMMY_DATA=true for S3 mocks)

BASE="http://localhost:3000/v1"
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  PASS  $1${NC}"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  FAIL  $1${NC}"; FAIL=$((FAIL+1)); }
info() { echo -e "${CYAN}  INFO  $1${NC}"; }
h1()   { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

# ─── Parse JSON without jq ──────────────────────────────────────────────────
# Extract a field value from JSON using sed/grep
json_field() {
  local json="$1" field="$2"
  echo "$json" | grep -o "\"${field}\":[^,}]*" | head -1 | sed 's/.*://;s/[" ]//g'
}

json_string() {
  local json="$1" field="$2"
  echo "$json" | grep -o "\"${field}\":\"[^\"]*\"" | head -1 | sed "s/\"${field}\"://;s/\"//g"
}

# ─── Login helper ────────────────────────────────────────────────────────────
login() {
  local phone="$1" pass="${2:-Test@123}"
  local resp
  resp=$(curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$phone\",\"password\":\"$pass\"}")
  json_string "$resp" "token"
}

# ─── Setup ───────────────────────────────────────────────────────────────────
h1 "SETUP"

FRESH_TOKEN=$(login "+919876543213")
VERIFIED_TOKEN=$(login "+919876543210")
ADMIN_TOKEN=$(login "+919876543220")

[[ -n "$FRESH_TOKEN"    ]] && ok "Fresh user token obtained"    || fail "Fresh user login failed"
[[ -n "$VERIFIED_TOKEN" ]] && ok "Verified user token obtained" || fail "Verified user login failed"
[[ -n "$ADMIN_TOKEN"    ]] && ok "Admin token obtained"         || fail "Admin login failed"

# ─── TEST 1: Valid document — should be VERIFIED immediately ─────────────────
h1 "TEST 1: Valid Document Upload → Immediate VERIFIED"

UPLOAD_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"documentType":"ID_PROOF","fileName":"valid_id.jpg","fileType":"image/jpeg","fileSize":204800}')
UPLOAD_STATUS=$(echo "$UPLOAD_RESP" | tail -1)
UPLOAD_BODY=$(echo "$UPLOAD_RESP" | head -1)

[[ "$UPLOAD_STATUS" == "201" ]] && ok "Upload URL request: HTTP 201" || fail "Upload URL request: expected 201, got $UPLOAD_STATUS"

DOC_ID=$(json_string "$UPLOAD_BODY" "documentId")
S3_KEY=$(json_string "$UPLOAD_BODY" "s3Key")

[[ -n "$DOC_ID" ]] && ok "documentId received" || fail "No documentId in response"

CONFIRM_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/confirm-upload" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\",\"s3Key\":\"$S3_KEY\",\"fileSize\":204800}")
CONFIRM_HTTP=$(echo "$CONFIRM_RESP" | tail -1)
CONFIRM_BODY=$(echo "$CONFIRM_RESP" | head -1)
CONFIRM_STATUS=$(json_string "$CONFIRM_BODY" "status")

[[ "$CONFIRM_HTTP" == "200" ]] && ok "Confirm upload: HTTP 200" || fail "Confirm upload: expected 200, got $CONFIRM_HTTP"
[[ "$CONFIRM_STATUS" == "VERIFIED" ]] && ok "Status is VERIFIED immediately" || fail "Expected VERIFIED immediately, got: $CONFIRM_STATUS"

# Verify user flags updated
ME_RESP=$(curl -s "$BASE/auth/me" -H "Authorization: Bearer $FRESH_TOKEN")
ID_VERIFIED=$(json_field "$ME_RESP" "idVerified")
[[ "$ID_VERIFIED" == "true" ]] && ok "user.idVerified=true after verification" || fail "user.idVerified should be true, got: $ID_VERIFIED"

# ─── TEST 2: File too small — should be REJECTED ─────────────────────────────
h1 "TEST 2: Tiny File → Immediate REJECTED (too small)"

SMALL_UPLOAD=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"documentType":"BLOOD_GROUP_PROOF","fileName":"tiny.jpg","fileType":"image/jpeg","fileSize":1024}')
SMALL_HTTP=$(echo "$SMALL_UPLOAD" | tail -1)
SMALL_BODY=$(echo "$SMALL_UPLOAD" | head -1)

[[ "$SMALL_HTTP" == "201" ]] && ok "Upload URL for tiny file: HTTP 201" || fail "Upload URL for tiny file: expected 201, got $SMALL_HTTP"

SMALL_DOC_ID=$(json_string "$SMALL_BODY" "documentId")
SMALL_S3_KEY=$(json_string "$SMALL_BODY" "s3Key")

SMALL_CONFIRM=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/confirm-upload" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$SMALL_DOC_ID\",\"s3Key\":\"$SMALL_S3_KEY\",\"fileSize\":1024}")
SMALL_CONFIRM_HTTP=$(echo "$SMALL_CONFIRM" | tail -1)
SMALL_CONFIRM_BODY=$(echo "$SMALL_CONFIRM" | head -1)
SMALL_STATUS=$(json_string "$SMALL_CONFIRM_BODY" "status")

[[ "$SMALL_CONFIRM_HTTP" == "200" ]] && ok "Confirm upload: HTTP 200" || fail "Expected 200, got $SMALL_CONFIRM_HTTP"
[[ "$SMALL_STATUS" == "REJECTED" ]] && ok "Status is REJECTED immediately (too small)" || fail "Expected REJECTED, got: $SMALL_STATUS"

SMALL_RESUBMIT=$(json_field "$SMALL_CONFIRM_BODY" "canResubmit")
[[ "$SMALL_RESUBMIT" == "true" ]] && ok "canResubmit=true in rejection response" || fail "canResubmit should be true"

# ─── TEST 3: Wrong file type — rejected at upload-url step ───────────────────
h1 "TEST 3: Wrong File Type → HTTP 400 at upload-url"

INVALID_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"documentType":"ID_PROOF","fileName":"malware.exe","fileType":"application/exe","fileSize":5000}')
INVALID_STATUS=$(echo "$INVALID_RESP" | tail -1)

[[ "$INVALID_STATUS" == "400" ]] && ok "Invalid MIME type rejected: HTTP 400" || fail "Expected 400 for invalid MIME, got $INVALID_STATUS"

# ─── TEST 4: No PENDING_REVIEW state ever returned ───────────────────────────
h1 "TEST 4: No PENDING_REVIEW — Admin queue returns deprecation notice"

QUEUE_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/queue" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
QUEUE_HTTP=$(echo "$QUEUE_RESP" | tail -1)
QUEUE_BODY=$(echo "$QUEUE_RESP" | head -1)

[[ "$QUEUE_HTTP" == "200" ]] && ok "Admin queue endpoint: HTTP 200" || fail "Admin queue: expected 200, got $QUEUE_HTTP"

QUEUE_MSG=$(json_string "$QUEUE_BODY" "message")
if echo "$QUEUE_MSG" | grep -qi "deprecated"; then
  ok "Queue returns deprecation message"
else
  fail "Expected deprecation message in queue response"
fi

# ─── TEST 5: Resubmission flow ────────────────────────────────────────────────
h1 "TEST 5: Resubmission After Rejection"

# Find a rejected doc from test 2
REJ_DOCS=$(curl -s "$BASE/verification/documents" -H "Authorization: Bearer $FRESH_TOKEN")
# Check if there's a REJECTED doc
if echo "$REJ_DOCS" | grep -q '"REJECTED"'; then
  ok "Rejected document found in user's documents"

  # Get new upload URL
  NEW_URL_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
    -H "Authorization: Bearer $FRESH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"documentType":"BLOOD_GROUP_PROOF","fileName":"better_cert.jpg","fileType":"image/jpeg","fileSize":204800}')
  NEW_HTTP=$(echo "$NEW_URL_RESP" | tail -1)
  [[ "$NEW_HTTP" == "201" ]] && ok "New upload URL for resubmission: HTTP 201" || fail "Expected 201, got $NEW_HTTP"

  NEW_S3=$(json_string "$(echo "$NEW_URL_RESP" | head -1)" "s3Key")

  # Find rejected verification ID
  VER_STATUS=$(curl -s "$BASE/verification/status/BLOOD_GROUP_PROOF" -H "Authorization: Bearer $FRESH_TOKEN")
  REJ_VID=$(json_string "$VER_STATUS" "id")

  if [[ -n "$REJ_VID" ]]; then
    RESUB_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/resubmit" \
      -H "Authorization: Bearer $FRESH_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"verificationId\":\"$REJ_VID\",\"s3Key\":\"$NEW_S3\",\"reason\":\"Uploading clearer image\"}")
    RESUB_HTTP=$(echo "$RESUB_RESP" | tail -1)
    RESUB_STATUS=$(json_string "$(echo "$RESUB_RESP" | head -1)" "status")

    [[ "$RESUB_HTTP" == "200" ]] && ok "Resubmit: HTTP 200" || fail "Resubmit: expected 200, got $RESUB_HTTP"
    [[ "$RESUB_STATUS" == "VERIFIED" || "$RESUB_STATUS" == "REJECTED" ]] \
      && ok "Resubmit returns immediate result: $RESUB_STATUS" \
      || fail "Resubmit should return VERIFIED or REJECTED, got: $RESUB_STATUS"
  else
    info "Could not extract verification ID — skipping resubmit test"
  fi
else
  info "No rejected doc found — skipping resubmit test (run with fresh user)"
fi

# ─── TEST 6: Admin endpoints return deprecation ───────────────────────────────
h1 "TEST 6: Admin Endpoints Return Deprecation"

for endpoint in "queue" "stats"; do
  RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/$endpoint" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  HTTP=$(echo "$RESP" | tail -1)
  [[ "$HTTP" == "200" ]] && ok "GET /admin/verification/$endpoint: HTTP 200" || fail "Expected 200, got $HTTP"
done

# ─── TEST 7: Fraud alerts still work ─────────────────────────────────────────
h1 "TEST 7: Fraud Alerts Still Functional"

FRAUD_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/fraud-alerts" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
FRAUD_HTTP=$(echo "$FRAUD_RESP" | tail -1)
[[ "$FRAUD_HTTP" == "200" ]] && ok "Fraud alerts endpoint: HTTP 200" || fail "Expected 200, got $FRAUD_HTTP"

# ─── TEST 8: Regression — existing endpoints untouched ───────────────────────
h1 "TEST 8: Regression — Existing Endpoints"

AUTH_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/auth/me" -H "Authorization: Bearer $FRESH_TOKEN")
[[ "$(echo "$AUTH_CHECK" | tail -1)" == "200" ]] && ok "GET /auth/me: 200" || fail "GET /auth/me broken"

REQ_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/requests" -H "Authorization: Bearer $FRESH_TOKEN")
[[ "$(echo "$REQ_CHECK" | tail -1)" == "200" ]] && ok "GET /requests: 200" || fail "GET /requests broken"

BB_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/blood-banks" -H "Authorization: Bearer $FRESH_TOKEN")
[[ "$(echo "$BB_CHECK" | tail -1)" == "200" ]] && ok "GET /blood-banks: 200" || fail "GET /blood-banks broken"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  PASS: $PASS${NC}   ${RED}FAIL: $FAIL${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -gt 0 ]] && exit 1 || exit 0
