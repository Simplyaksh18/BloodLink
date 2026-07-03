import { PrismaClient, VerificationType, VerificationStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─── Universal test password for ALL seeded users ────────────────────────────
const TEST_PASSWORD = 'Test@123';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { city: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
];

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomOffset(base: number, range = 0.3): number {
  return base + (Math.random() - 0.5) * range;
}

function randomDate(daysAgo: number): Date {
  return new Date(Date.now() - Math.floor(Math.random() * daysAgo) * 24 * 60 * 60 * 1000);
}

// Predictable phone numbers so testers can always remember them
// Format: +9187654XXXXX where XXXXX = zero-padded index
function testPhone(index: number): string {
  return `+9187654${String(index).padStart(5, '0')}`;
}

function printTestCredentials(phones: string[]): void {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 TEST CREDENTIALS  (use these to login/test)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔑 Password for ALL users: ${TEST_PASSWORD}`);
  console.log('');
  console.log('👤 Staff accounts:');
  console.log('   Phone: +919000000001  (Super Admin)');
  console.log('   Phone: +919000000002  (Admin - Ravi Kumar)');
  console.log('   Phone: +919000000003  (Admin - Priya Singh)');
  console.log('   Phone: +919000000004  (Moderator - Arjun Modi)');
  console.log('   Phone: +919000000005  (Blood Bank - National Blood Bank)');
  console.log('');
  console.log('🩸 Sample donor accounts:');
  phones.slice(0, 10).forEach((p, i) => console.log(`   Phone: ${p}  (Donor ${i + 1})`));
  console.log('');
  console.log('💡 In development mode (USE_DUMMY_DATA=true):');
  console.log('   OTP is returned in the API response for easy testing');
  console.log('   Check server console logs for OTP values');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('🔍 Phase 3 — Verification test accounts:');
  console.log('┌─────────────────────┬──────────────┬───────────────────┬──────────┐');
  console.log('│ Phone               │ Password     │ Verification      │ Role     │');
  console.log('├─────────────────────┼──────────────┼───────────────────┼──────────┤');
  console.log('│ +919876543210       │ Test@123     │ VERIFIED (All)    │ USER     │');
  console.log('│ +919876543211       │ Test@123     │ PENDING_REVIEW    │ USER     │');
  console.log('│ +919876543212       │ Test@123     │ REJECTED (ID)     │ USER     │');
  console.log('│ +919876543213       │ Test@123     │ NOT_SUBMITTED     │ USER     │');
  console.log('│ +919876543220       │ Test@123     │ VERIFIED (All)    │ ADMIN    │');
  console.log('└─────────────────────┴──────────────┴───────────────────┴──────────┘');
  console.log('');
}

async function seedAdmins(passwordHash: string) {
  await prisma.user.createMany({
    data: [
      {
        phone: '+919000000001',
        email: 'admin@bloodlink.app',
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        passwordHash,
        emailVerified: true,
      },
      {
        phone: '+919000000002',
        email: 'staff1@bloodlink.app',
        name: 'Ravi Kumar',
        role: 'ADMIN',
        passwordHash,
        emailVerified: true,
      },
      {
        phone: '+919000000003',
        email: 'staff2@bloodlink.app',
        name: 'Priya Singh',
        role: 'ADMIN',
        passwordHash,
        emailVerified: true,
      },
      {
        phone: '+919000000004',
        email: 'moderator@bloodlink.app',
        name: 'Arjun Modi',
        role: 'MODERATOR',
        passwordHash,
        emailVerified: true,
      },
      {
        phone: '+919000000005',
        email: 'bloodbank@bloodlink.app',
        name: 'National Blood Bank',
        role: 'BLOOD_BANK',
        passwordHash,
        emailVerified: true,
      },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Admins/staff seeded (5 users: SUPER_ADMIN, 2×ADMIN, MODERATOR, BLOOD_BANK)');
}

async function seedDonors(passwordHash: string): Promise<string[]> {
  const names = [
    'Amit Sharma',
    'Priya Patel',
    'Rahul Gupta',
    'Sneha Reddy',
    'Vijay Kumar',
    'Ananya Iyer',
    'Rohan Mehta',
    'Kavita Singh',
    'Suresh Nair',
    'Deepika Joshi',
    'Arjun Verma',
    'Meera Pillai',
    'Kiran Rao',
    'Pooja Agarwal',
    'Nikhil Bose',
    'Shreya Kulkarni',
    'Aakash Pandey',
    'Divya Shetty',
    'Mohit Jain',
    'Riya Kapoor',
    'Saurabh Tiwari',
    'Nisha Chaudhary',
    'Vikram Malhotra',
    'Sunita Desai',
    'Gaurav Mishra',
    'Pallavi Hegde',
    'Santosh Murthy',
    'Anjali Shah',
    'Varun Saxena',
    'Manisha Dubey',
    'Rohit Ghosh',
    'Swathi Venkat',
    'Arun Krishnan',
    'Lakshmi Rajan',
    'Harsh Bajaj',
    'Tanya Bhatt',
    'Naveen Gowda',
    'Shalini Thakur',
    'Rakesh Yadav',
    'Preeti Choudhury',
    'Sameer Ali',
    'Madhuri Patil',
    'Dinesh Rawat',
    'Usha Naik',
    'Pawan Sharma',
    'Girish Nayak',
    'Rekha Menon',
    'Sachin Bansal',
    'Komal Joshi',
    'Rajesh Pillai',
  ];

  const statusOptions = [
    'PENDING',
    'ELIGIBLE',
    'ELIGIBLE',
    'ELIGIBLE',
    'ELIGIBLE',
    'ELIGIBLE',
    'ELIGIBLE',
    'UNDER_REVIEW',
    'UNDER_REVIEW',
    'NOT_ELIGIBLE',
  ] as const;

  const phones: string[] = [];

  for (let i = 0; i < 50; i++) {
    const phone = testPhone(i + 1);
    phones.push(phone);
    const loc = randomElement(CITIES);
    const bloodGroup = randomElement(BLOOD_GROUPS);
    const status = randomElement(statusOptions);
    const lastDonation = Math.random() > 0.4 ? randomDate(365) : null;
    const totalDonations = lastDonation ? Math.floor(Math.random() * 8) + 1 : 0;

    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        email: `donor${i + 1}@bloodlink.test`,
        name: names[i] ?? `Donor ${i + 1}`,
        passwordHash,
        gender: i % 3 === 0 ? 'female' : 'male',
        isDonor: true,
        bloodGroup,
        willingToDonate: Math.random() > 0.4,
        donorVerificationStatus: status,
        lastDonationDate: lastDonation,
        totalDonations,
        latitude: randomOffset(loc.lat),
        longitude: randomOffset(loc.lng),
        city: loc.city,
        state: loc.state,
        address: `${Math.floor(Math.random() * 999) + 1}, Sample Street, ${loc.city}`,
        pincode: `${Math.floor(Math.random() * 900000) + 100000}`,
        lastLoginAt: randomDate(30),
        lastActiveAt: randomDate(7),
      },
    });
  }

  console.log('✅ 50 donors seeded');
  return phones;
}

async function seedBloodBanks() {
  const banks = [
    {
      name: 'National Blood Services - Mumbai',
      city: 'Mumbai',
      state: 'Maharashtra',
      lat: 19.076,
      lng: 72.877,
    },
    { name: 'Red Cross Blood Bank Delhi', city: 'Delhi', state: 'Delhi', lat: 28.614, lng: 77.209 },
    { name: 'Apollo Blood Bank Bengaluru', city: 'Bengaluru', state: 'Karnataka', lat: 12.972, lng: 77.595 },
    { name: 'KIMS Blood Center Hyderabad', city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.487 },
    { name: 'Fortis Blood Bank Chennai', city: 'Chennai', state: 'Tamil Nadu', lat: 13.083, lng: 80.271 },
    { name: 'Kolkata Blood Bank', city: 'Kolkata', state: 'West Bengal', lat: 22.573, lng: 88.364 },
    { name: 'Ruby Hall Blood Bank Pune', city: 'Pune', state: 'Maharashtra', lat: 18.52, lng: 73.857 },
    {
      name: 'Civil Hospital Blood Bank Ahmedabad',
      city: 'Ahmedabad',
      state: 'Gujarat',
      lat: 23.023,
      lng: 72.571,
    },
    { name: 'Lifeblood Centre Mumbai', city: 'Mumbai', state: 'Maharashtra', lat: 19.089, lng: 72.861 },
    {
      name: 'RotaryTTK Blood Bank Bengaluru',
      city: 'Bengaluru',
      state: 'Karnataka',
      lat: 12.958,
      lng: 77.607,
    },
  ];

  function makeStock(): Record<string, number> {
    const stock: Record<string, number> = {};
    for (const bg of BLOOD_GROUPS) stock[bg] = Math.floor(Math.random() * 50);
    return stock;
  }

  for (let i = 0; i < banks.length; i++) {
    const b = banks[i];
    await prisma.bloodBank.upsert({
      where: { registrationNumber: `BB-${String(i + 1).padStart(4, '0')}` },
      update: {},
      create: {
        name: b.name,
        registrationNumber: `BB-${String(i + 1).padStart(4, '0')}`,
        contactPhone: `+9122${String(i).padStart(8, '0')}`,
        email: `bank${i + 1}@bloodlink.test`,
        operatingHoursStart: '08:00',
        operatingHoursEnd: '20:00',
        is24x7: i < 3,
        stockJson: JSON.stringify(makeStock()),
        latitude: randomOffset(b.lat, 0.05),
        longitude: randomOffset(b.lng, 0.05),
        address: `${i + 1} Medical Complex, ${b.city}`,
        city: b.city,
        state: b.state,
        pincode: `${Math.floor(Math.random() * 900000) + 100000}`,
        isVerified: i < 8,
        isActive: true,
      },
    });
  }
  console.log('✅ 10 blood banks seeded');
}

async function seedRequests() {
  const users = await prisma.user.findMany({
    where: { role: 'USER', isDeleted: false },
    take: 30,
    select: { id: true },
  });
  if (users.length === 0) {
    console.log('⚠️  No users found — skipping requests');
    return;
  }

  const hospitals = [
    { name: 'AIIMS Delhi', address: 'Ansari Nagar', city: 'Delhi', lat: 28.567, lng: 77.209 },
    { name: 'KEM Hospital Mumbai', address: 'Acharya Donde Marg', city: 'Mumbai', lat: 19.004, lng: 72.842 },
    { name: 'Nimhans Bengaluru', address: 'Hosur Road', city: 'Bengaluru', lat: 12.944, lng: 77.596 },
    { name: 'Nizam Institute Hyderabad', address: 'Punjagutta', city: 'Hyderabad', lat: 17.426, lng: 78.449 },
    { name: 'PGIMER Chandigarh', address: 'Sector 12', city: 'Chandigarh', lat: 30.764, lng: 76.778 },
  ];

  const priorities = [
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'RED',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'YELLOW',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
    'GREEN',
  ] as const;

  const statuses = [
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'OPEN',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'FULFILLED',
    'CANCELLED',
    'CANCELLED',
    'CANCELLED',
    'CANCELLED',
    'CANCELLED',
  ] as const;

  for (let i = 0; i < 30; i++) {
    const user = users[i % users.length];
    const hospital = randomElement(hospitals);
    const bloodGroup = randomElement(BLOOD_GROUPS);

    await prisma.bloodRequest.create({
      data: {
        requesterId: user.id,
        bloodGroup,
        units: Math.floor(Math.random() * 4) + 1,
        patientName: `Patient ${i + 1}`,
        patientAge: Math.floor(Math.random() * 70) + 5,
        patientGender: i % 2 === 0 ? 'Male' : 'Female',
        hospitalName: hospital.name,
        hospitalAddress: hospital.address,
        hospitalCity: hospital.city,
        hospitalLatitude: randomOffset(hospital.lat, 0.02),
        hospitalLongitude: randomOffset(hospital.lng, 0.02),
        emergencyLevel: priorities[i],
        status: statuses[i],
        verificationStatus: i % 5 === 0 ? 'APPROVED' : 'PENDING',
        notes: i % 3 === 0 ? 'Urgent — post-surgery' : undefined,
        requiredBy: new Date(Date.now() + (i % 3 === 0 ? 2 : i % 2 === 0 ? 12 : 48) * 60 * 60 * 1000),
        createdAt: randomDate(14),
      },
    });
  }
  console.log('✅ 30 blood requests seeded');
}

async function seedNotifications() {
  const users = await prisma.user.findMany({ where: { role: 'USER' }, take: 20, select: { id: true } });
  const types = ['REQUEST_CREATED', 'DONOR_FOUND', 'EMERGENCY', 'VERIFICATION', 'REMINDER', 'SYSTEM'];

  for (const user of users) {
    for (let i = 0; i < Math.floor(Math.random() * 5) + 1; i++) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title: i === 0 ? 'Emergency Blood Needed!' : 'BloodLink Update',
          body:
            i === 0
              ? 'Urgent: O+ blood needed at AIIMS Delhi within 2 hours'
              : 'Your donor profile has been reviewed',
          notificationType: randomElement(types),
          isRead: Math.random() > 0.4,
        },
      });
    }
  }
  console.log('✅ Notifications seeded');
}

async function seedVerifications(passwordHash: string) {
  // Verification test users — predictable phones for easy testing
  const verificationTestUsers = [
    { phone: '+919876543210', name: 'Deepa Sharma', note: 'VERIFIED (All)', role: 'USER' as const },
    { phone: '+919876543211', name: 'Arjun Mehta', note: 'PENDING_REVIEW', role: 'USER' as const },
    { phone: '+919876543212', name: 'Kavitha Nair', note: 'REJECTED (ID)', role: 'USER' as const },
    { phone: '+919876543213', name: 'Rohit Bansal', note: 'NOT_SUBMITTED', role: 'USER' as const },
    { phone: '+919876543220', name: 'Admin Verifier', note: 'VERIFIED (All)', role: 'ADMIN' as const },
  ];

  const createdUsers: Array<{ id: string; phone: string }> = [];
  for (const u of verificationTestUsers) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {},
      create: {
        phone: u.phone,
        email: `${u.phone.replace('+91', '')}@bloodlink.test`,
        name: u.name,
        passwordHash,
        role: u.role,
        isDonor: true,
        bloodGroup: 'O+',
        willingToDonate: true,
        city: 'Delhi',
        state: 'Delhi',
        emailVerified: true,
        // Pre-set verification flags for VERIFIED users
        idVerified: u.note.includes('VERIFIED'),
        bloodGroupVerified: u.note.includes('VERIFIED'),
        medicalVerified: u.note.includes('VERIFIED'),
      },
    });
    createdUsers.push({ id: user.id, phone: u.phone });
  }

  const allTypes: VerificationType[] = [
    VerificationType.ID_PROOF,
    VerificationType.BLOOD_GROUP_PROOF,
    VerificationType.MEDICAL_SCREENING,
  ];

  // Get admin user for reviewer
  const adminUser = createdUsers.find((u) => u.phone === '+919876543220')!;

  // User 0 (+919876543210): ALL VERIFIED
  const user0 = createdUsers[0];
  for (const type of allTypes) {
    await prisma.verification.upsert({
      where: { id: `seed-v-${user0.id}-${type}` },
      update: {},
      create: {
        id: `seed-v-${user0.id}-${type}`,
        userId: user0.id,
        verificationType: type,
        status: VerificationStatus.VERIFIED,
        s3Key: `verification/${user0.id}/${type}/sample.jpg`,
        fileName: 'identity_document.jpg',
        fileType: 'image/jpeg',
        fileSize: 1200000,
        uploadedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        autoCheckPassed: true,
        fraudScore: 0,
        reviewerId: adminUser.id,
        reviewedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        reviewNotes: 'Document looks authentic',
      },
    });
  }

  // User 1 (+919876543211): PENDING_REVIEW
  const user1 = createdUsers[1];
  for (const type of allTypes) {
    await prisma.verification.upsert({
      where: { id: `seed-v-${user1.id}-${type}` },
      update: {},
      create: {
        id: `seed-v-${user1.id}-${type}`,
        userId: user1.id,
        verificationType: type,
        status: VerificationStatus.PENDING_REVIEW,
        s3Key: `verification/${user1.id}/${type}/sample.pdf`,
        fileName: 'document.pdf',
        fileType: 'application/pdf',
        fileSize: 2500000,
        uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        autoCheckPassed: true,
        fraudScore: 0,
      },
    });
  }

  // User 2 (+919876543212): REJECTED (ID), others NOT_SUBMITTED
  const user2 = createdUsers[2];
  await prisma.verification.upsert({
    where: { id: `seed-v-${user2.id}-ID_PROOF` },
    update: {},
    create: {
      id: `seed-v-${user2.id}-ID_PROOF`,
      userId: user2.id,
      verificationType: VerificationType.ID_PROOF,
      status: VerificationStatus.REJECTED,
      s3Key: `verification/${user2.id}/ID_PROOF/blurry_id.jpg`,
      fileName: 'id_photo.jpg',
      fileType: 'image/jpeg',
      fileSize: 800000,
      uploadedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      autoCheckPassed: true,
      fraudScore: 0,
      reviewerId: adminUser.id,
      reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      rejectionReason: 'Document image is blurry and unreadable. Please resubmit a clear photo.',
      resubmissionCount: 1,
    },
  });

  // User 2: add a fraud alert for demonstration
  const rejectedVerif = await prisma.verification.findFirst({
    where: { userId: user2.id, verificationType: VerificationType.ID_PROOF },
  });
  if (rejectedVerif) {
    const existingAlert = await prisma.fraudAlert.findFirst({ where: { verificationId: rejectedVerif.id } });
    if (!existingAlert) {
      await prisma.fraudAlert.create({
        data: {
          verificationId: rejectedVerif.id,
          userId: user2.id,
          alertType: 'HIGH_RESUBMISSION_COUNT',
          severity: 20,
          description: 'Document resubmitted 1 time after rejection',
          isResolved: false,
        },
      });
    }
  }

  // Seed verifications for 40% of regular donors — fully verified
  const regularUsers = await prisma.user.findMany({
    where: { role: 'USER', phone: { not: { in: verificationTestUsers.map((u) => u.phone) } } },
    take: 50,
    select: { id: true },
  });

  let fullyVerified = 0,
    partialVerif = 0;

  for (let i = 0; i < regularUsers.length; i++) {
    const userId = regularUsers[i].id;
    const bucket = i % 10;

    if (bucket < 4) {
      // 40%: Fully verified
      for (const type of allTypes) {
        const exists = await prisma.verification.findFirst({ where: { userId, verificationType: type } });
        if (!exists) {
          await prisma.verification.create({
            data: {
              userId,
              verificationType: type,
              status: VerificationStatus.VERIFIED,
              s3Key: `verification/${userId}/${type}/doc.jpg`,
              fileName: 'document.jpg',
              fileType: 'image/jpeg',
              fileSize: 1000000,
              uploadedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
              autoCheckPassed: true,
              fraudScore: 0,
              reviewerId: adminUser.id,
              reviewedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }
      await prisma.user.update({
        where: { id: userId },
        data: { idVerified: true, bloodGroupVerified: true, medicalVerified: true },
      });
      fullyVerified++;
    } else if (bucket < 6) {
      // 20%: Partially verified — ID proof only
      const exists = await prisma.verification.findFirst({
        where: { userId, verificationType: VerificationType.ID_PROOF },
      });
      if (!exists) {
        await prisma.verification.create({
          data: {
            userId,
            verificationType: VerificationType.ID_PROOF,
            status: VerificationStatus.VERIFIED,
            s3Key: `verification/${userId}/ID_PROOF/id.jpg`,
            fileName: 'id.jpg',
            fileType: 'image/jpeg',
            fileSize: 900000,
            uploadedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            autoCheckPassed: true,
            fraudScore: 0,
            reviewerId: adminUser.id,
            reviewedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.user.update({ where: { id: userId }, data: { idVerified: true } });
      }
      partialVerif++;
    }
    // bucket 6–9 (60%): no verification records — leaves status as NOT_SUBMITTED
  }

  console.log(`✅ Verification data seeded (${fullyVerified} fully verified, ${partialVerif} partial)`);
}

async function seedEligibilityTestUsers(passwordHash: string) {
  // Admin verifier — reuse from Phase 3 if it exists
  const adminVerifier = await prisma.user.findUnique({ where: { phone: '+919876543220' } });

  const eligibilityUsers = [
    {
      phone: '+919876543230',
      name: 'Ananya Singh',
      note: 'USER_A: donated 10 days ago → on cooldown',
      bloodGroup: 'A+',
    },
    {
      phone: '+919876543231',
      name: 'Bharat Kumar',
      note: 'USER_B: all docs verified, no health screening',
      bloodGroup: 'B+',
    },
    {
      phone: '+919876543232',
      name: 'Chitra Reddy',
      note: 'USER_C: hasHiv → permanently disqualified',
      bloodGroup: 'O-',
    },
    {
      phone: '+919876543233',
      name: 'Dinesh Patil',
      note: 'USER_D: fully eligible (all checks pass)',
      bloodGroup: 'O+',
    },
    {
      phone: '+919876543234',
      name: 'Esha Joshi',
      note: 'USER_E: existing verified documents, document sync test',
      bloodGroup: 'AB+',
    },
  ];

  const created: Array<{ id: string; phone: string; name: string; note: string }> = [];

  for (const u of eligibilityUsers) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {},
      create: {
        phone: u.phone,
        email: `${u.phone.replace('+91', '')}@bloodlink.test`,
        name: u.name,
        passwordHash,
        isDonor: true,
        bloodGroup: u.bloodGroup,
        willingToDonate: true,
        city: 'Mumbai',
        state: 'Maharashtra',
        emailVerified: true,
        idVerified: true,
        bloodGroupVerified: true,
        medicalVerified: true,
        latitude: 19.076,
        longitude: 72.8777,
      },
    });
    created.push({ id: user.id, phone: u.phone, name: u.name, note: u.note });
  }

  const reviewerId = adminVerifier?.id ?? created[3]?.id;

  const verifTypes = [
    VerificationType.ID_PROOF,
    VerificationType.BLOOD_GROUP_PROOF,
    VerificationType.MEDICAL_SCREENING,
  ] as const;

  // Helper: create all three VERIFIED verification records for a user
  async function createVerifiedDocs(userId: string) {
    for (const type of verifTypes) {
      await prisma.verification.upsert({
        where: { id: `seed-p4-${userId}-${type}` },
        update: {},
        create: {
          id: `seed-p4-${userId}-${type}`,
          userId,
          verificationType: type,
          status: VerificationStatus.VERIFIED,
          s3Key: `verification/${userId}/${type}/doc.jpg`,
          fileName: 'document.jpg',
          fileType: 'image/jpeg',
          fileSize: 1200000,
          uploadedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          autoCheckPassed: true,
          fraudScore: 0,
          reviewerId: reviewerId ?? undefined,
          reviewedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  // ── User A (+919876543230): donated 10 days ago → cooldown (80 days left) ──
  const userA = created.find((u) => u.phone === '+919876543230')!;
  await createVerifiedDocs(userA.id);
  const donationDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await prisma.donation.upsert({
    where: { id: `seed-p4-donation-${userA.id}` },
    update: {},
    create: {
      id: `seed-p4-donation-${userA.id}`,
      donorId: userA.id,
      donationDate,
      isVerified: true,
      bloodGroup: 'A+',
    },
  });

  // ── User B (+919876543231): all docs verified, no health screening ──────────
  const userB = created.find((u) => u.phone === '+919876543231')!;
  await createVerifiedDocs(userB.id);
  // No HealthScreening record → needsHealthScreening

  // ── User C (+919876543232): HIV positive → permanent disqualification ───────
  const userC = created.find((u) => u.phone === '+919876543232')!;
  await createVerifiedDocs(userC.id);
  await prisma.healthScreening.upsert({
    where: { userId: userC.id },
    update: {},
    create: {
      userId: userC.id,
      hasHiv: true,
      hasHeartDisease: false,
      hasDiabetes: false,
      hasHepatitis: false,
      hasTuberculosis: false,
      hasCancer: false,
      hasBleedingDisorder: false,
      hasSeizureDisorder: false,
      hasKidneyDisease: false,
      hasLiverDisease: false,
      hasRespiratoryDisease: false,
      hasAutoimmuneDisease: false,
      hasRecentSurgery: false,
      hasRecentTattoo: false,
      hasRecentPiercing: false,
      hasRecentTravel: false,
      hasRecentVaccination: false,
      hasDonatedBefore: false,
      hasAdverseReaction: false,
      isOnMedication: false,
      isPregnant: false,
      isBreastfeeding: false,
      hasConsumedAlcohol24h: false,
      hasFever: false,
      weight: 65,
      height: 170,
      bmi: 22.5,
      bloodPressure: '120/80',
      hemoglobinLevel: 14.0,
      weightMeetsMinimum: true,
      screeningPassed: false,
      disqualifyingFactors: JSON.stringify(['HIV/AIDS']),
    },
  });

  // ── User D (+919876543233): fully eligible, all checks pass ─────────────────
  const userD = created.find((u) => u.phone === '+919876543233')!;
  await createVerifiedDocs(userD.id);
  const hsD = await prisma.healthScreening.upsert({
    where: { userId: userD.id },
    update: {},
    create: {
      userId: userD.id,
      weight: 72,
      height: 175,
      bmi: 23.5,
      bloodPressure: '118/76',
      hemoglobinLevel: 15.2,
      pulseRate: 72,
      temperature: 37.0,
      hasHeartDisease: false,
      hasDiabetes: false,
      hasHepatitis: false,
      hasHiv: false,
      hasTuberculosis: false,
      hasCancer: false,
      hasBleedingDisorder: false,
      hasSeizureDisorder: false,
      hasKidneyDisease: false,
      hasLiverDisease: false,
      hasRespiratoryDisease: false,
      hasAutoimmuneDisease: false,
      hasRecentSurgery: false,
      hasRecentTattoo: false,
      hasRecentPiercing: false,
      hasRecentTravel: false,
      hasRecentVaccination: false,
      hasDonatedBefore: true,
      hasAdverseReaction: false,
      isOnMedication: false,
      isPregnant: false,
      isBreastfeeding: false,
      hasConsumedAlcohol24h: false,
      hasFever: false,
      weightMeetsMinimum: true,
      screeningPassed: true,
    },
  });
  if (hsD.screeningPassed) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 6);
    await prisma.user.update({
      where: { id: userD.id },
      data: {
        isDonorEligible: true,
        donorEligibleSince: new Date(),
        donorEligibilityExpiry: expiry,
        donorVerificationStatus: 'ELIGIBLE',
      },
    });
  }

  // ── User E (+919876543234): verified docs only, document sync test ───────────
  const userE = created.find((u) => u.phone === '+919876543234')!;
  await createVerifiedDocs(userE.id);

  console.log('✅ Phase 4 eligibility test users seeded:');
  for (const u of created) {
    console.log(`   ${u.phone}  ${u.name.padEnd(16)}  ${u.note}`);
  }
}

async function seedDonorStatusTestUsers(passwordHash: string) {
  const adminVerifier = await prisma.user.findUnique({ where: { phone: '+919876543220' } });

  const donorStatusUsers = [
    {
      phone: '+919876543240',
      name: 'Farhan Ali',
      status: 'ACTIVE' as const,
      bg: 'A+',
      note: 'ACTIVE — registered eligible donor',
    },
    {
      phone: '+919876543241',
      name: 'Geeta Pillai',
      status: 'DEFERRED' as const,
      bg: 'B-',
      note: 'DEFERRED — donated 45 days ago (45 days left)',
    },
    {
      phone: '+919876543242',
      name: 'Harish Sethi',
      status: 'DEFERRED' as const,
      bg: 'O+',
      note: 'DEFERRED — donated 88 days ago (2 days left)',
    },
    {
      phone: '+919876543243',
      name: 'Indira Menon',
      status: 'INELIGIBLE' as const,
      bg: 'AB-',
      note: 'INELIGIBLE — HIV positive (permanent)',
    },
    {
      phone: '+919876543244',
      name: 'Jagdish Tiwari',
      status: 'NEVER_DONATED' as const,
      bg: 'O-',
      note: 'NEVER_DONATED — new user, no docs',
    },
    {
      phone: '+919876543245',
      name: 'Kamla Reddy',
      status: 'PENDING_REVIEW' as const,
      bg: 'B+',
      note: 'PENDING_REVIEW — eligible, awaiting register click',
    },
  ];

  const verifTypes = [
    VerificationType.ID_PROOF,
    VerificationType.BLOOD_GROUP_PROOF,
    VerificationType.MEDICAL_SCREENING,
  ] as const;

  async function createAllVerifiedDocs(userId: string) {
    for (const type of verifTypes) {
      await prisma.verification.upsert({
        where: { id: `seed-p5-${userId}-${type}` },
        update: {},
        create: {
          id: `seed-p5-${userId}-${type}`,
          userId,
          verificationType: type,
          status: VerificationStatus.VERIFIED,
          s3Key: `verification/${userId}/${type}/doc.jpg`,
          fileName: 'document.jpg',
          fileType: 'image/jpeg',
          fileSize: 1200000,
          uploadedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          autoCheckPassed: true,
          fraudScore: 0,
          reviewerId: adminVerifier?.id,
          reviewedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  const created: Array<{ id: string; phone: string; name: string; note: string; status: string }> = [];

  for (const u of donorStatusUsers) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {},
      create: {
        phone: u.phone,
        email: `${u.phone.replace('+91', '')}@bloodlink.test`,
        name: u.name,
        passwordHash,
        bloodGroup: u.bg,
        willingToDonate: true,
        city: 'Delhi',
        state: 'Delhi',
        emailVerified: true,
        idVerified: true,
        bloodGroupVerified: true,
        medicalVerified: true,
        latitude: 28.6139,
        longitude: 77.209,
        donorStatus: u.status,
      },
    });
    created.push({ id: user.id, phone: u.phone, name: u.name, note: u.note, status: u.status });
  }

  // ── ACTIVE (+919876543240): fully registered donor ──────────────────────────
  const u240 = created.find((u) => u.phone === '+919876543240')!;
  await createAllVerifiedDocs(u240.id);
  const eligExpiry = new Date();
  eligExpiry.setMonth(eligExpiry.getMonth() + 6);
  await prisma.healthScreening.upsert({
    where: { userId: u240.id },
    update: {},
    create: {
      userId: u240.id,
      weight: 70,
      height: 172,
      bmi: 23.6,
      bloodPressure: '120/78',
      hemoglobinLevel: 14.5,
      hasHeartDisease: false,
      hasDiabetes: false,
      hasHepatitis: false,
      hasHiv: false,
      hasTuberculosis: false,
      hasCancer: false,
      hasBleedingDisorder: false,
      hasSeizureDisorder: false,
      hasKidneyDisease: false,
      hasLiverDisease: false,
      hasRespiratoryDisease: false,
      hasAutoimmuneDisease: false,
      hasRecentSurgery: false,
      hasRecentTattoo: false,
      hasRecentPiercing: false,
      hasRecentTravel: false,
      hasRecentVaccination: false,
      hasDonatedBefore: true,
      hasAdverseReaction: false,
      isOnMedication: false,
      isPregnant: false,
      isBreastfeeding: false,
      hasConsumedAlcohol24h: false,
      hasFever: false,
      weightMeetsMinimum: true,
      screeningPassed: true,
    },
  });
  await prisma.user.update({
    where: { id: u240.id },
    data: {
      isDonor: true,
      willingToDonate: true,
      isDonorEligible: true,
      donorEligibleSince: new Date(),
      donorEligibilityExpiry: eligExpiry,
      donorVerificationStatus: 'ELIGIBLE',
      donorStatus: 'ACTIVE',
      eligibilityCheckedAt: new Date(),
    },
  });

  // ── DEFERRED 45 days (+919876543241): donated 45 days ago ────────────────────
  const u241 = created.find((u) => u.phone === '+919876543241')!;
  await createAllVerifiedDocs(u241.id);
  const donation241Date = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const next241 = new Date(donation241Date.getTime() + 90 * 24 * 60 * 60 * 1000);
  await prisma.donation.upsert({
    where: { id: `seed-p5-donation-${u241.id}` },
    update: {},
    create: {
      id: `seed-p5-donation-${u241.id}`,
      donorId: u241.id,
      donationDate: donation241Date,
      isVerified: true,
      bloodGroup: 'B-',
    },
  });
  await prisma.user.update({
    where: { id: u241.id },
    data: {
      donorStatus: 'DEFERRED',
      deferralDate: donation241Date,
      deferralReason: 'Must wait 90 days between blood donations (45 days remaining).',
      nextEligibleDate: next241,
      eligibilityCheckedAt: new Date(),
    },
  });

  // ── DEFERRED 2 days (+919876543242): donated 88 days ago ─────────────────────
  const u242 = created.find((u) => u.phone === '+919876543242')!;
  await createAllVerifiedDocs(u242.id);
  const donation242Date = new Date(Date.now() - 88 * 24 * 60 * 60 * 1000);
  const next242 = new Date(donation242Date.getTime() + 90 * 24 * 60 * 60 * 1000);
  await prisma.donation.upsert({
    where: { id: `seed-p5-donation-${u242.id}` },
    update: {},
    create: {
      id: `seed-p5-donation-${u242.id}`,
      donorId: u242.id,
      donationDate: donation242Date,
      isVerified: true,
      bloodGroup: 'O+',
    },
  });
  await prisma.user.update({
    where: { id: u242.id },
    data: {
      donorStatus: 'DEFERRED',
      deferralDate: donation242Date,
      deferralReason: 'Must wait 90 days between blood donations (2 days remaining).',
      nextEligibleDate: next242,
      eligibilityCheckedAt: new Date(),
    },
  });

  // ── INELIGIBLE (+919876543243): HIV ──────────────────────────────────────────
  const u243 = created.find((u) => u.phone === '+919876543243')!;
  await createAllVerifiedDocs(u243.id);
  await prisma.healthScreening.upsert({
    where: { userId: u243.id },
    update: {},
    create: {
      userId: u243.id,
      hasHiv: true,
      hasHeartDisease: false,
      hasDiabetes: false,
      hasHepatitis: false,
      hasTuberculosis: false,
      hasCancer: false,
      hasBleedingDisorder: false,
      hasSeizureDisorder: false,
      hasKidneyDisease: false,
      hasLiverDisease: false,
      hasRespiratoryDisease: false,
      hasAutoimmuneDisease: false,
      hasRecentSurgery: false,
      hasRecentTattoo: false,
      hasRecentPiercing: false,
      hasRecentTravel: false,
      hasRecentVaccination: false,
      hasDonatedBefore: false,
      hasAdverseReaction: false,
      isOnMedication: false,
      isPregnant: false,
      isBreastfeeding: false,
      hasConsumedAlcohol24h: false,
      hasFever: false,
      weight: 60,
      height: 165,
      bmi: 22.0,
      bloodPressure: '118/76',
      hemoglobinLevel: 13.0,
      weightMeetsMinimum: true,
      screeningPassed: false,
      disqualifyingFactors: JSON.stringify(['HIV/AIDS']),
    },
  });
  await prisma.user.update({
    where: { id: u243.id },
    data: {
      donorStatus: 'INELIGIBLE',
      deferralDate: new Date(),
      deferralReason: 'HIV/AIDS',
      nextEligibleDate: null,
      eligibilityCheckedAt: new Date(),
    },
  });

  // ── NEVER_DONATED (+919876543244): no docs, no screening ─────────────────────
  // No extra data needed — donorStatus=NEVER_DONATED already set at creation

  // ── PENDING_REVIEW (+919876543245): docs + health screening passed, not registered ──
  const u245 = created.find((u) => u.phone === '+919876543245')!;
  await createAllVerifiedDocs(u245.id);
  await prisma.healthScreening.upsert({
    where: { userId: u245.id },
    update: {},
    create: {
      userId: u245.id,
      weight: 68,
      height: 168,
      bmi: 24.1,
      bloodPressure: '116/74',
      hemoglobinLevel: 14.8,
      hasHeartDisease: false,
      hasDiabetes: false,
      hasHepatitis: false,
      hasHiv: false,
      hasTuberculosis: false,
      hasCancer: false,
      hasBleedingDisorder: false,
      hasSeizureDisorder: false,
      hasKidneyDisease: false,
      hasLiverDisease: false,
      hasRespiratoryDisease: false,
      hasAutoimmuneDisease: false,
      hasRecentSurgery: false,
      hasRecentTattoo: false,
      hasRecentPiercing: false,
      hasRecentTravel: false,
      hasRecentVaccination: false,
      hasDonatedBefore: false,
      hasAdverseReaction: false,
      isOnMedication: false,
      isPregnant: false,
      isBreastfeeding: false,
      hasConsumedAlcohol24h: false,
      hasFever: false,
      weightMeetsMinimum: true,
      screeningPassed: true,
    },
  });
  await prisma.user.update({
    where: { id: u245.id },
    data: {
      donorStatus: 'PENDING_REVIEW',
      eligibilityCheckedAt: new Date(),
    },
  });

  console.log('');
  console.log('🔍 Phase 5 — Donor Status test accounts:');
  console.log('┌─────────────────────┬──────────────┬─────────────────┬────────────────────────┐');
  console.log('│ Phone               │ Password     │ Donor Status    │ Note                   │');
  console.log('├─────────────────────┼──────────────┼─────────────────┼────────────────────────┤');
  for (const u of created) {
    const status = u.status.padEnd(15);
    const note = u.note.substring(0, 22).padEnd(22);
    console.log(`│ ${u.phone}  │ Test@123     │ ${status} │ ${note} │`);
  }
  console.log('└─────────────────────┴──────────────┴─────────────────┴────────────────────────┘');
}

async function seedSessions() {
  const users = await prisma.user.findMany({ take: 10, select: { id: true } });

  for (const user of users) {
    await prisma.session.upsert({
      where: { refreshToken: `seed-refresh-${user.id}` },
      update: {},
      create: {
        userId: user.id,
        refreshToken: `seed-refresh-${user.id}`,
        deviceInfo: { platform: 'android', version: '1.0.0' },
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
    });
  }
  console.log('✅ Sample sessions seeded');
}

async function main() {
  console.log('🌱 Starting database seed...');
  console.log('🔐 Hashing passwords (this may take a moment)...');

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  await seedAdmins(passwordHash);
  const donorPhones = await seedDonors(passwordHash);
  await seedBloodBanks();
  await seedRequests();
  await seedNotifications();
  await seedSessions();
  await seedVerifications(passwordHash);
  await seedEligibilityTestUsers(passwordHash);
  await seedDonorStatusTestUsers(passwordHash);

  printTestCredentials(donorPhones);
  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
