#!/bin/bash
# Auto-confirm Prisma migration for SqlErrorLog table

echo "Running Prisma migration to add SqlErrorLog table..."
echo ""
echo "This will reset your LOCAL database (localhost:5432/stock_analysis)."
echo "Your Azure production DB is NOT affected."
echo ""

# Run migration with auto-confirm
npx prisma migrate dev --name add-sql-error-log <<EOF
y
EOF

echo ""
echo "Migration complete! Generating Prisma client..."
npx prisma generate

echo ""
echo "✅ SqlErrorLog table is now ready for use!"
