/**
 * BloodLink — Live CSV Donor Import
 * -----------------------------------
 * Imports the client's real donor registration CSV into the backend.
 *
 * Usage (run from repo root):
 *   node scripts/importLiveDonors.js <csv-path> <admin-jwt> [--delay=600]
 *
 * Example (Windows):
 *   node scripts/importLiveDonors.js "C:\Users\akshi\Downloads\BloodLink – Blood Donor Registration Form.csv" eyJhbGciOi... --delay=1000
 *
 * Env:
 *   BACKEND_URL — defaults to http://localhost:3000/v1
 *
 * Fields used:
 *   Full Name, Age, Gender, Blood Group, Mobile Number(Whatsapp Number),
 *   Area/Locality, City, State,
 *   "Are you willing to donate blood in case of an emergency?"
 *   "Are you currently healthy and willing to donate blood according to medical guidelines?"
 *
 * Known CSV quirks handled:
 *   - Scientific notation phones (e.g. 9.19346E+11) → skipped (unrecoverable precision)
 *   - Unicode garbage in "Don't know" (Donâ€™t know) → treated as unknown → skipped
 *   - Spaces inside phone numbers (e.g. "90800 25695") → stripped
 *   - Duplicate rows (same phone) → upsert via PUT
 *   - Phone number in Age column → clamped (prevents INT4 overflow)
 *   - HTTP 429 rate limit → exponential backoff retry (up to 5 attempts)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── tiny CSV parser (handles quoted fields with embedded commas) ─────────────
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
  const clean = raw
    .replace(/â/g, "'")
    .replace(/â€™/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s/g, '');
  if (clean.includes('don') || clean.includes('know') || clean.includes('unknown') || clean === '') {
    return null;
  }
  return BG_MAP[clean] ?? null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  if (/[eE]\+/.test(raw)) return null;
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

function normalizeName(raw) {
  return (raw || '').trim().replace(/\s+/g, ' ');
}

function normalizeCity(raw) {
  return (raw || '').trim()
    .replace(/^CHENNAI$/i, 'Chennai')
    .replace(/^Chennnai$/i, 'Chennai')
    .replace(/^Koyambedy$/i, 'Koyambedu');
}

function normalizeState(raw) {
  const s = (raw || '').trim();
  if (/^tami/i.test(s)) return 'Tamil Nadu';
  return s;
}

function isYes(val) {
  return (val || '').trim().toLowerCase() === 'yes';
}

// ─── HTTP with retry (handles 429 / rate limit) ──────────────────────────────
const BACKOFFS_MS = [3000, 6000, 12000, 24000, 30000];

async function fetchWithRetry(url, options, label, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[LiveDonorImport] attempt: ${attempt}/${maxRetries} — ${label}`);
    const resp = await fetch(url, options);
    if (resp.status !== 429) return resp;

    const wait = BACKOFFS_MS[Math.min(attempt - 1, BACKOFFS_MS.length - 1)];
    console.log(`[LiveDonorImport] 429 retrying: attempt ${attempt}/${maxRetries}, waiting ${wait}ms — ${label}`);
    await new Promise(r => setTimeout(r, wait));
  }
  // Exhausted all retries — return a synthetic 429 object so caller can count it as failed
  return { status: 429, ok: false, json: async () => ({ success: false, message: 'Rate limited after retries' }) };
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Separate flag args from positional args
  const allArgs   = process.argv.slice(2);
  const flagArgs  = allArgs.filter(a => a.startsWith('--'));
  const posArgs   = allArgs.filter(a => !a.startsWith('--'));

  if (posArgs.length < 2) {
    console.error('Usage: node scripts/importLiveDonors.js <csv-file> <admin-jwt> [--delay=600]');
    console.error('       BACKEND_URL env var defaults to http://localhost:3000/v1');
    process.exit(1);
  }

  const csvPath  = path.resolve(posArgs[0]);
  const adminJwt = posArgs[1];
  const baseUrl  = process.env.BACKEND_URL ?? 'http://localhost:3000/v1';

  const delayArg = flagArgs.find(a => a.startsWith('--delay='));
  const delayMs  = delayArg ? Math.max(0, parseInt(delayArg.split('=')[1], 10) || 600) : 600;

  console.log('[LiveDonorImport] csv path:', csvPath);
  console.log('[LiveDonorImport] delayMs:', delayMs);

  if (!fs.existsSync(csvPath)) {
    console.error(`[LiveDonorImport] ERROR — CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const raw  = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(raw);
  console.log('[LiveDonorImport] total csv rows:', rows.length);

  const first10CsvNames = rows.slice(0, 10).map(r => normalizeName(r['Full Name'] ?? r['Full name'] ?? '(blank)'));
  console.log('[LiveDonorImport] first 10 CSV names:', first10CsvNames);

  // Counters — only incremented when backend confirms success
  let created     = 0;
  let updated     = 0;
  let failedRetry = 0;
  let skipped     = 0;
  let invalidBg   = 0;
  let badPhone    = 0;
  let importedTrue = 0;

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminJwt}`,
    'X-Admin-Import': 'true',
  };

  for (const row of rows) {
    const name     = normalizeName(row['Full Name'] ?? row['Full name'] ?? '');
    const rawPhone = row['Mobile Number(Whatsapp Number)'] ?? row['Mobile Number'] ?? '';
    const phone    = normalizePhone(rawPhone);
    const bg       = normalizeBloodGroup(row['Blood Group'] ?? '');
    const city     = normalizeCity(row['City'] ?? '');
    const state    = normalizeState(row['State'] ?? '');
    const area     = (row['Area/Locality'] ?? '').trim();
    const ageRaw   = parseInt(row['Age'] ?? '0', 10);
    // Clamp to a sane human age range — prevents a phone number that ends up in
    // the Age column from overflowing the Int4 (32-bit) database column.
    const age      = (!isNaN(ageRaw) && ageRaw > 0 && ageRaw < 150) ? ageRaw : null;
    const gender   = normalizeGender(row['Gender'] ?? '');
    const willing  = isYes(
      row['Are you willing to donate blood in case of an emergency? '] ??
      row['Are you willing to donate blood in case of an emergency?'] ??
      row['willing'] ?? ''
    );
    const healthy  = isYes(
      row['Are you currently healthy and willing to donate blood according to medical guidelines? '] ??
      row['Are you currently healthy and willing to donate blood according to medical guidelines?'] ??
      row['healthy'] ?? ''
    );

    if (!name || name.length < 2) {
      skipped++;
      continue;
    }
    if (!phone) {
      if (/[eE]\+/.test(rawPhone)) {
        console.log(`[LiveDonorImport] skipped bad phone (scientific notation): ${name} — ${rawPhone}`);
      } else {
        console.log(`[LiveDonorImport] skipped bad phone: ${name} — "${rawPhone}"`);
      }
      badPhone++;
      skipped++;
      continue;
    }
    if (!bg) {
      console.log(`[LiveDonorImport] skipped invalid blood group: ${name} — "${row['Blood Group'] ?? ''}"`);
      invalidBg++;
      skipped++;
      continue;
    }

    const donorStatus     = (willing && healthy) ? 'ACTIVE' : 'NEVER_DONATED';
    const isDonorEligible = willing && healthy;
    const importedAt      = new Date().toISOString();

    // importedDonor: true marks this as a CSV-imported donor so discovery
    // endpoint filters exclusively to real imported donors (not seeded/test users).
    const payload = {
      name,
      phone,
      bloodGroup: bg,
      gender,
      age,
      address: area || city,
      city,
      state,
      pincode: '',
      latitude: 0,
      longitude: 0,
      isDonor: true,
      isActive: true,
      isDonorEligible,
      donorStatus,
      willingToDonate: isDonorEligible,
      idVerified: true,
      bloodGroupVerified: true,
      medicalVerified: false,
      importedDonor: true,
      importedAt,
    };
    importedTrue++;

    const label = `${name} (${phone})`;

    try {
      // Step 1 — try POST (create)
      const resp = await fetchWithRetry(
        `${baseUrl}/admin/donors`,
        { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) },
        `POST ${label}`
      );

      if (resp.status === 429) {
        // Still 429 after all retries
        console.log(`[LiveDonorImport] failed after retries: ${label}`);
        failedRetry++;
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      const data = await resp.json().catch(() => ({ success: false, message: `HTTP ${resp.status}` }));
      const msg  = (data?.message ?? '').toLowerCase();
      const isDuplicate = resp.status === 409
        || msg.includes('already exists')
        || msg.includes('unique constraint')
        || msg.includes('unique');

      if (isDuplicate) {
        // Step 2 — duplicate: upsert via PUT
        const upResp = await fetchWithRetry(
          `${baseUrl}/admin/donors/upsert`,
          { method: 'PUT', headers: authHeaders, body: JSON.stringify(payload) },
          `PUT upsert ${label}`
        );

        if (upResp.status === 429) {
          console.log(`[LiveDonorImport] failed after retries (upsert): ${label}`);
          failedRetry++;
        } else {
          const upData = await upResp.json().catch(() => ({}));
          if (upResp.ok || upData.success) {
            console.log(`[LiveDonorImport] update success: ${label}`);
            updated++;
          } else {
            console.log(`[LiveDonorImport] upsert failed: ${label} — ${upData.message ?? upResp.status}`);
            failedRetry++;
          }
        }
      } else if (resp.ok || data.success) {
        console.log(`[LiveDonorImport] create success: ${label}`);
        created++;
      } else {
        console.log(`[LiveDonorImport] error: ${label} — ${data.message ?? resp.status}`);
        failedRetry++;
      }
    } catch (err) {
      console.log(`[LiveDonorImport] error: ${label} — ${err.message}`);
      failedRetry++;
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  const validRows = rows.length - skipped;
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('[LiveDonorImport] total csv rows:              ', rows.length);
  console.log('[LiveDonorImport] valid rows:                  ', validRows, 'of', rows.length);
  console.log('[LiveDonorImport] skipped bad phone:           ', badPhone);
  console.log('[LiveDonorImport] skipped invalid blood group: ', invalidBg);
  console.log('[LiveDonorImport] importedDonor true sent:     ', importedTrue);
  console.log('[LiveDonorImport] created:                     ', created);
  console.log('[LiveDonorImport] updated:                     ', updated);
  console.log('[LiveDonorImport] failed after retries:        ', failedRetry);
  console.log('══════════════════════════════════════');

  // ─── Verify call ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('[LiveDonorImport] calling verify endpoint...');
  try {
    const vResp = await fetch(`${baseUrl}/admin/donors/imported/verify`, {
      headers: { Authorization: `Bearer ${adminJwt}`, 'X-Admin-Import': 'true' },
    });
    if (!vResp.ok) {
      console.log('[LiveDonorImport] verify endpoint returned', vResp.status, '— skipping');
    } else {
      const vData = await vResp.json();
      const v = vData?.data ?? vData;
      console.log('[LiveDonorImport] verify totalImported: ', v.totalImported ?? '?');
      console.log('[LiveDonorImport] verify activeImported:', v.activeImported ?? '?');
      console.log('[LiveDonorImport] verify first10Names:  ', v.first10Names ?? []);
      if (v.bloodGroupCounts) {
        console.log('[LiveDonorImport] verify bloodGroupCounts:', JSON.stringify(v.bloodGroupCounts));
      }
      if (v.cityCounts) {
        const topCities = Object.entries(v.cityCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        console.log('[LiveDonorImport] verify top cities:  ', topCities.map(([c, n]) => `${c}:${n}`).join(', '));
      }
    }
  } catch (err) {
    console.log('[LiveDonorImport] verify call failed (non-fatal):', err.message);
  }

  console.log('');
  console.log('[LiveDonorImport] done.');
}

main().catch(err => { console.error(err); process.exit(1); });
