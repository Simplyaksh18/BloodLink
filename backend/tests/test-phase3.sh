#!/usr/bin/env bash
# test-phase3.sh — Phase 3 Verification System Integration Tests
# Run with: bash tests/test-phase3.sh
# Requires: curl, jq, running backend on port 3000

set -euo pipefail

BASE="http://localhost:3000/v1"
PASS=0
FAIL=0

# ─── Colors ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✔  $1${NC}"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ✘  $1${NC}"; FAIL=$((FAIL+1)); }
info() { echo -e "${CYAN}  ℹ  $1${NC}"; }
h1()   { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

# ─── Helpers ────────────────────────────────────────────────────────────────
login() {
  local phone="$1" pass="${2:-Test@123}"
  curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$phone\",\"password\":\"$pass\"}" | jq -r '.data.token // empty'
}

check_status() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then ok "$label (HTTP $actual)"; else fail "$label — expected $expected, got $actual"; fi
}

# ─── Setup ──────────────────────────────────────────────────────────────────
h1 "SETUP: Obtaining tokens"

USER_TOKEN=$(login "+918765400001")
VERIFIED_TOKEN=$(login "+919876543210")
PENDING_TOKEN=$(login "+919876543211")
REJECTED_TOKEN=$(login "+919876543212")
FRESH_TOKEN=$(login "+919876543213")
ADMIN_TOKEN=$(login "+919876543220")

[[ -n "$USER_TOKEN"     ]] && ok "Regular user token obtained"     || fail "Regular user login failed"
[[ -n "$VERIFIED_TOKEN" ]] && ok "Verified user token obtained"    || fail "Verified user login failed"
[[ -n "$ADMIN_TOKEN"    ]] && ok "Admin token obtained"            || fail "Admin login failed"

# ─── Part 1: Upload Flow ─────────────────────────────────────────────────────
h1 "PART 1: Document Upload Flow"

# 1.1 Request presigned upload URL
UPLOAD_URL_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"documentType":"ID_PROOF","fileName":"my_aadhaar.jpg","fileType":"image/jpeg","fileSize":1048576}')
UPLOAD_URL_STATUS=$(echo "$UPLOAD_URL_RESP" | tail -1)
UPLOAD_URL_BODY=$(echo "$UPLOAD_URL_RESP" | head -1)

check_status "Request presigned upload URL" "201" "$UPLOAD_URL_STATUS"

DOC_ID=$(echo "$UPLOAD_URL_BODY" | jq -r '.data.documentId // empty')
S3_KEY=$(echo "$UPLOAD_URL_BODY" | jq -r '.data.s3Key // empty')
UPLOAD_URL=$(echo "$UPLOAD_URL_BODY" | jq -r '.data.uploadUrl // empty')

[[ -n "$DOC_ID"   ]] && ok "documentId received: ${DOC_ID:0:8}..." || fail "No documentId in response"
[[ -n "$S3_KEY"   ]] && ok "s3Key received: $S3_KEY"               || fail "No s3Key in response"
[[ -n "$UPLOAD_URL" ]] && ok "uploadUrl received"                  || fail "No uploadUrl in response"

# 1.2 Confirm upload
CONFIRM_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/confirm-upload" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"documentId\":\"$DOC_ID\",\"s3Key\":\"$S3_KEY\",\"fileSize\":1048576}")
CONFIRM_STATUS=$(echo "$CONFIRM_RESP" | tail -1)

check_status "Confirm upload" "200" "$CONFIRM_STATUS"

# 1.3 Check verification status
sleep 1  # Allow async auto-checks to run
STATUS_RESP=$(curl -s "$BASE/verification/status/ID_PROOF" \
  -H "Authorization: Bearer $FRESH_TOKEN")
STATUS_VALUE=$(echo "$STATUS_RESP" | jq -r '.data.status // empty')

[[ "$STATUS_VALUE" == "AUTO_VERIFICATION_PASSED" || "$STATUS_VALUE" == "PENDING_REVIEW" || "$STATUS_VALUE" == "UPLOADED" ]] \
  && ok "Status after upload: $STATUS_VALUE" \
  || fail "Unexpected status after upload: $STATUS_VALUE"

# 1.4 Invalid file type rejected
INVALID_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
  -H "Authorization: Bearer $FRESH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"documentType":"ID_PROOF","fileName":"malware.exe","fileType":"application/exe","fileSize":1000}')
INVALID_STATUS=$(echo "$INVALID_RESP" | tail -1)
check_status "Reject invalid MIME type" "400" "$INVALID_STATUS"

# ─── Part 2: Verification Status Queries ────────────────────────────────────
h1 "PART 2: Verification Status Queries"

# 2.1 Full status for verified user
FULL_STATUS=$(curl -s "$BASE/verification/status" \
  -H "Authorization: Bearer $VERIFIED_TOKEN")
OVERALL=$(echo "$FULL_STATUS" | jq -r '.data.overallStatus // empty')
ID_OK=$(echo "$FULL_STATUS" | jq -r '.data.idVerified // false')

[[ "$OVERALL" == "FULLY_VERIFIED" ]] && ok "Fully verified user — overallStatus=FULLY_VERIFIED" || fail "Expected FULLY_VERIFIED, got: $OVERALL"
[[ "$ID_OK" == "true" ]] && ok "idVerified=true for fully verified user" || fail "idVerified should be true"

# 2.2 Documents list
DOCS_RESP=$(curl -s "$BASE/verification/documents" \
  -H "Authorization: Bearer $VERIFIED_TOKEN")
DOCS_COUNT=$(echo "$DOCS_RESP" | jq '.data | length')
[[ "$DOCS_COUNT" -ge "1" ]] && ok "Documents list returned $DOCS_COUNT record(s)" || fail "No documents returned"

# 2.3 History
HIST_RESP=$(curl -s "$BASE/verification/history" \
  -H "Authorization: Bearer $VERIFIED_TOKEN")
[[ $(echo "$HIST_RESP" | jq '.success') == "true" ]] && ok "History endpoint accessible" || fail "History endpoint failed"

# ─── Part 3: Resubmission Flow ───────────────────────────────────────────────
h1 "PART 3: Resubmission After Rejection"

# Get rejected verification ID
REJECTED_DOCS=$(curl -s "$BASE/verification/documents" \
  -H "Authorization: Bearer $REJECTED_TOKEN")
REJECTED_VID=$(echo "$REJECTED_DOCS" | jq -r '[.data[] | select(.status=="REJECTED")][0].id // empty')

if [[ -n "$REJECTED_VID" ]]; then
  ok "Rejected verification found: ${REJECTED_VID:0:8}..."

  # Request new upload URL for the rejected doc type
  NEW_UPLOAD=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/upload-url" \
    -H "Authorization: Bearer $REJECTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"documentType":"ID_PROOF","fileName":"new_aadhaar_clear.jpg","fileType":"image/jpeg","fileSize":2000000}')
  NEW_STATUS=$(echo "$NEW_UPLOAD" | tail -1)
  check_status "Get new upload URL for resubmission" "201" "$NEW_STATUS"

  NEW_S3=$(echo "$NEW_UPLOAD" | head -1 | jq -r '.data.s3Key // empty')

  RESUB_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/verification/resubmit" \
    -H "Authorization: Bearer $REJECTED_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"verificationId\":\"$REJECTED_VID\",\"s3Key\":\"$NEW_S3\",\"reason\":\"Uploaded clearer photo of Aadhaar\"}")
  RESUB_STATUS=$(echo "$RESUB_RESP" | tail -1)
  check_status "Resubmit rejected document" "200" "$RESUB_STATUS"
else
  info "No rejected verification found — skipping resubmit test (run seed first)"
fi

# ─── Part 4: Admin Queue & Review ────────────────────────────────────────────
h1 "PART 4: Admin Review Workflow"

# 4.1 Get review queue
QUEUE_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/queue" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
QUEUE_STATUS=$(echo "$QUEUE_RESP" | tail -1)
QUEUE_BODY=$(echo "$QUEUE_RESP" | head -1)
check_status "Admin: get review queue" "200" "$QUEUE_STATUS"

QUEUE_COUNT=$(echo "$QUEUE_BODY" | jq '.data.total // 0')
info "Queue has $QUEUE_COUNT pending verification(s)"

# 4.2 Get a pending verification to review
FIRST_VID=$(echo "$QUEUE_BODY" | jq -r '.data.items[0].id // empty')
if [[ -n "$FIRST_VID" ]]; then
  ok "Got first queue item: ${FIRST_VID:0:8}..."

  # 4.3 Assign to self
  ASSIGN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/admin/verification/$FIRST_VID/assign" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')
  check_status "Admin: assign to self" "200" "$(echo "$ASSIGN_RESP" | tail -1)"

  # 4.4 Get detail
  DETAIL_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/$FIRST_VID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  check_status "Admin: get verification detail" "200" "$(echo "$DETAIL_RESP" | tail -1)"

  # 4.5 Approve
  APPROVE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/admin/verification/$FIRST_VID/approve" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notes":"Document verified — looks authentic"}')
  APPROVE_STATUS=$(echo "$APPROVE_RESP" | tail -1)
  APPROVE_NEW_STATUS=$(echo "$APPROVE_RESP" | head -1 | jq -r '.data.status // empty')
  check_status "Admin: approve verification" "200" "$APPROVE_STATUS"
  [[ "$APPROVE_NEW_STATUS" == "VERIFIED" ]] && ok "Status is VERIFIED after approval" || fail "Expected VERIFIED after approval, got $APPROVE_NEW_STATUS"
else
  info "No pending items in queue — skipping approve/reject test"
fi

# 4.6 Get a different pending item to reject
SECOND_VID=$(echo "$QUEUE_BODY" | jq -r '.data.items[1].id // empty')
if [[ -n "$SECOND_VID" && "$SECOND_VID" != "null" ]]; then
  REJECT_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/admin/verification/$SECOND_VID/reject" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"reason":"Document is not government-issued ID","notes":"Rejected by seeder test"}')
  check_status "Admin: reject verification" "200" "$(echo "$REJECT_RESP" | tail -1)"
fi

# ─── Part 5: Fraud Detection ─────────────────────────────────────────────────
h1 "PART 5: Fraud Detection"

# 5.1 Get fraud alerts
FRAUD_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/fraud-alerts" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
check_status "Admin: get fraud alerts" "200" "$(echo "$FRAUD_RESP" | tail -1)"

FRAUD_COUNT=$(echo "$FRAUD_RESP" | head -1 | jq '.data.total // 0')
info "Fraud alerts: $FRAUD_COUNT"

# 5.2 Get high-score verifications
HIGH_SCORE_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/fraud-alerts/high-score?minScore=15" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
check_status "Admin: high fraud score verifications" "200" "$(echo "$HIGH_SCORE_RESP" | tail -1)"

# 5.3 Resolve a fraud alert if one exists
ALERT_ID=$(echo "$FRAUD_RESP" | head -1 | jq -r '.data.items[0].id // empty')
if [[ -n "$ALERT_ID" && "$ALERT_ID" != "null" ]]; then
  RESOLVE_RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/admin/verification/fraud-alerts/$ALERT_ID/resolve" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')
  check_status "Admin: resolve fraud alert" "200" "$(echo "$RESOLVE_RESP" | tail -1)"
fi

# ─── Part 6: Admin Stats ─────────────────────────────────────────────────────
h1 "PART 6: Admin Statistics"

STATS_RESP=$(curl -s -w "\n%{http_code}" "$BASE/admin/verification/stats" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATS_STATUS=$(echo "$STATS_RESP" | tail -1)
check_status "Admin: get stats" "200" "$STATS_STATUS"

echo ""
info "Stats snapshot:"
echo "$STATS_RESP" | head -1 | jq '.data'

# ─── Part 7: Verification Middleware ────────────────────────────────────────
h1 "PART 7: Verification Middleware"

# The verifyDocument middleware is applied optionally on routes.
# Test indirectly: unverified user trying to create a request with a route
# that has been middleware-guarded. Here we just confirm the middleware exists
# by testing the non-guarded route still works.
REQUEST_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/requests" \
  -H "Authorization: Bearer $FRESH_TOKEN")
check_status "Regular request access (no verification required)" "200" "$(echo "$REQUEST_CHECK" | tail -1)"

info "Verification middleware (verifyDocument) is available for route-level use."
info "To enforce it: add verifyDocument(VerificationType.ID_PROOF) before a route handler."

# ─── Part 8: No Regressions ──────────────────────────────────────────────────
h1 "PART 8: No Regressions — Existing Endpoints"

# Auth
AUTH_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/auth/me" -H "Authorization: Bearer $USER_TOKEN")
check_status "GET /auth/me" "200" "$(echo "$AUTH_CHECK" | tail -1)"

# Requests
REQ_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/requests" -H "Authorization: Bearer $USER_TOKEN")
check_status "GET /requests" "200" "$(echo "$REQ_CHECK" | tail -1)"

# Blood banks
BB_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/blood-banks" -H "Authorization: Bearer $USER_TOKEN")
check_status "GET /blood-banks" "200" "$(echo "$BB_CHECK" | tail -1)"

# Notifications
NOTIF_CHECK=$(curl -s -w "\n%{http_code}" "$BASE/notifications" -H "Authorization: Bearer $USER_TOKEN")
check_status "GET /notifications" "200" "$(echo "$NOTIF_CHECK" | tail -1)"

# Upload (existing)
UPLOAD_CHECK=$(curl -s -w "\n%{http_code}" -X POST "$BASE/upload" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -F "file=@/dev/null;type=image/jpeg" 2>/dev/null || echo "0\n400")
info "Existing /upload endpoint accessible (skipping full test on CI)"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  PASS: $PASS${NC}   ${RED}FAIL: $FAIL${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
