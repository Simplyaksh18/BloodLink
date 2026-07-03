/**
 * BloodLink — CSV Donor Import Script
 * ------------------------------------
 * Reads the client registration CSV and upserts donors via the backend API.
 *
 * Usage (run from repo root):
 *   node scripts/importDonors.js <csv-path> <admin-token>
 *
 * Example:
 *   node scripts/importDonors.js "BloodLink – Blood Donor Registration Form.csv" eyJhbGciOi...
 *
 * Required env or CLI args:
 *   BACKEND_URL  — e.g. http://localhost:3000/v1  (or set as second-to-last arg)
 *   ADMIN_TOKEN  — JWT of an ADMIN/SUPER_ADMIN user (or pass as last arg)
 *
 * Fields used from CSV (only):
 *   Full Name, Age, Gender, Blood Group, Mobile Number,
 *   Area/Locality, City, State,
 *   "Are you willing to donate blood in case of an emergency?"
 *   "Are you currently healthy and willing to donate blood according to medical guidelines?"
 *
 * Blood group normalisation:
 *   A+, A-, B+, B-, AB+, AB-, O+, O-  — any case/spacing accepted
 *   "Don't know" / blank → skipped (cannot register without valid blood group)
 *
 * Phone normalisation:
 *   Strip all non-digits, prepend +91 if 10 digits, keep +91 prefix if 12 digits.
 *   Skip row if result is not exactly 13 chars (+91XXXXXXXXXX).
 *
 * donorStatus logic:
 *   willing=Yes AND healthy=Yes  → ACTIVE (isDonorEligible=true)
 *   otherwise                    → NEVER_DONATED (isDonorEligible=false)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── tiny CSV parser (handles quoted fields with commas) ──────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim(); });
    return row;
  });
}

function parseLine(line) {
  const cols = [];
  let cur = '';
  let inQ  = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

// ─── normalisation helpers ────────────────────────────────────────────────────
const BG_MAP = {
  'a+': 'A+', 'a-': 'A-', 'b+': 'B+', 'b-': 'B-',
  'ab+': 'AB+', 'ab-': 'AB-', 'o+': 'O+', 'o-': 'O-',
};

function normalizeBloodGroup(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s/g, '');
  return BG_MAP[key] ?? null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('091')) return `+${digits.slice(1)}`;
  return null;
}

function normalizeGender(raw) {
  const g = (raw || '').trim().toLowerCase();
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  return 'other';
}

function isYes(val) {
  return (val || '').trim().toLowerCase() === 'yes';
}

function normalizeName(raw) {
  return (raw || '').trim().replace(/\s+/g, ' ');
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/importDonors.js <csv-file> <admin-jwt>');
    console.error('       BACKEND_URL env var defaults to http://localhost:3000/v1');
    process.exit(1);
  }

  const csvPath   = path.resolve(args[0]);
  const adminJwt  = args[1];
  const baseUrl   = process.env.BACKEND_URL ?? 'http://localhost:3000/v1';

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const raw  = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(raw);
  console.log(`Parsed ${rows.length} rows from CSV.`);

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    const name  = normalizeName(row['Full Name'] ?? row['Full name'] ?? '');
    const phone = normalizePhone(row['Mobile Number(Whatsapp Number)'] ?? row['Mobile Number'] ?? '');
    const bg    = normalizeBloodGroup(row['Blood Group'] ?? '');
    const city  = (row['City'] ?? '').trim();
    const state = (row['State'] ?? '').trim();
    const area  = (row['Area/Locality'] ?? '').trim();
    const age   = parseInt(row['Age'] ?? '0', 10);
    const gender = normalizeGender(row['Gender'] ?? '');
    const willing = isYes(row['Are you willing to donate blood in case of an emergency? '] ?? row['willing'] ?? '');
    const healthy = isYes(row['Are you currently healthy and willing to donate blood according to medical guidelines? '] ?? row['healthy'] ?? '');

    // Skip rows missing critical fields
    if (!name || name.length < 2) { console.log(`[SKIP] no name: ${JSON.stringify(row).slice(0, 80)}`); skipped++; continue; }
    if (!phone) { console.log(`[SKIP] bad phone: ${row['Mobile Number(Whatsapp Number)'] ?? '?'} (${name})`); skipped++; continue; }
    if (!bg) { console.log(`[SKIP] unknown blood group: ${row['Blood Group'] ?? '?'} (${name})`); skipped++; continue; }

    const donorStatus    = (willing && healthy) ? 'ACTIVE' : 'NEVER_DONATED';
    const isDonorEligible = willing && healthy;

    // Flat fields only — admin.controller sanitizeForUser strips nested objects.
    // importedDonor: true marks this as a CSV-imported donor so discovery
    // endpoint can filter exclusively to real donors (not seeded/test users).
    const payload = {
      name,
      phone,
      bloodGroup: bg,
      gender,
      address: area || city,
      city,
      state,
      pincode: '',
      latitude: 0,
      longitude: 0,
      isDonor: true,
      isDonorEligible,
      donorStatus,
      willingToDonate: isDonorEligible,
      idVerified: true,
      bloodGroupVerified: true,
      medicalVerified: false,
      importedDonor: true,
    };

    try {
      const resp = await fetch(`${baseUrl}/admin/donors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({ success: false, message: `HTTP ${resp.status}` }));

      if (resp.status === 409 || data?.message?.includes('already exists')) {
        // Duplicate — try update
        const upResp = await fetch(`${baseUrl}/admin/donors/upsert`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminJwt}`,
          },
          body: JSON.stringify(payload),
        });
        const upData = await upResp.json().catch(() => ({}));
        if (upResp.ok || upData.success) {
          console.log(`[UPDATE] ${name} (${phone})`);
          updated++;
        } else {
          console.log(`[SKIP-DUP] ${name} (${phone}) — ${upData.message ?? 'already exists'}`);
          skipped++;
        }
      } else if (resp.ok || data.success) {
        console.log(`[CREATE] ${name} (${phone}) — ${bg} — ${city}`);
        created++;
      } else {
        console.error(`[ERROR] ${name} (${phone}) — ${data.message ?? resp.status}`);
        errors++;
      }
    } catch (err) {
      console.error(`[ERROR] ${name} (${phone}) — ${err.message}`);
      errors++;
    }

    // Small delay to avoid overwhelming the backend
    await new Promise(r => setTimeout(r, 80));
  }

  console.log('\n─── Import Summary ───────────────────────────────');
  console.log(`  Created : ${created}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  console.log(`  Errors  : ${errors}`);
  console.log(`  Total   : ${rows.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
