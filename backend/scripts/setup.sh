#!/bin/bash
set -e

echo "🩸 BloodLink Backend Setup"
echo "=========================="

# Check Node.js version
NODE_VERSION=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required. Current: $(node -v)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Copy env file
if [ ! -f .env.development ]; then
  cp .env.example .env.development
  echo "📝 Created .env.development — please fill in your credentials"
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run migrations
echo "🗄️  Running database migrations..."
npx prisma migrate dev --name init

# Seed database
echo "🌱 Seeding database..."
npm run seed

echo ""
echo "✅ Setup complete!"
echo "🚀 Start the server: npm run dev"
echo "📊 pgAdmin: http://localhost:5050 (admin@bloodlink.app / admin)"
echo "🔍 Prisma Studio: npm run prisma:studio"
