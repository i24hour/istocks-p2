#!/usr/bin/env bash
#
# Migrate localhost database to Vercel Neon database
# This script will export localhost data and import it to Vercel
#

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Vercel Database URL (set in environment before running)
VERCEL_DB_URL="${DATABASE_URL:?Set DATABASE_URL before running this script}"

echo -e "${GREEN}🚀 Starting Database Migration to Vercel${NC}"
echo -e "${YELLOW}============================================${NC}\n"

# Step 1: Run Prisma migrations on Vercel  
echo -e "${GREEN}📋 Step 1: Running Prisma migrations on Vercel...${NC}"
DATABASE_URL="$VERCEL_DB_URL" npx prisma migrate deploy
echo -e "${GREEN}✅ Schema created successfully${NC}\n"

# Step 2: Export localhost data
echo -e "${GREEN}📦 Step 2: Exporting localhost data...${NC}"
pg_dump -h localhost -U priyanshu -d stock_analysis \
  -t '"Stock"' -t '"StockPrice"' -t '"StockInsight"' \
  --data-only --column-inserts \
  -f migration_data.sql

echo -e "${GREEN}✅ Data exported to migration_data.sql${NC}\n"

# Step 3: Import to Vercel
echo -e "${GREEN}📥 Step 3: Importing data to Vercel...${NC}"
echo -e "${YELLOW}⚠️  This may take several minutes for 2.5M+ records...${NC}\n"

psql "$VERCEL_DB_URL" -f migration_data.sql

echo -e "\n${GREEN}✅ Data imported successfully${NC}\n"

# Step 4: Verify migration
echo -e "${GREEN}🔍 Step 4: Verifying migration...${NC}"
psql "$VERCEL_DB_URL" -c "
SELECT 
  (SELECT COUNT(*) FROM \"Stock\") as stocks,
  (SELECT COUNT(*) FROM \"StockPrice\") as prices,
  (SELECT COUNT(*) FROM \"StockInsight\") as insights;
"

echo -e "\n${GREEN}🎉 Migration Complete!${NC}"
echo -e "${YELLOW}============================================${NC}"
echo -e "${GREEN}✅ All data has been migrated to Vercel${NC}"
echo -e "${GREEN}🌐 Your Vercel deployment should now show all 3 stocks${NC}\n"
