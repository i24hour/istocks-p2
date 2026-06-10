-- Add angelToken for TATASTEEL (NSE token: 3499) so the EC2 live feed subscribes to it
UPDATE "Stock"
SET "angelToken" = '3499', exchange = 'NSE', "updatedAt" = NOW()
WHERE UPPER(symbol) = 'TATASTEEL'
  AND ("angelToken" IS NULL OR "angelToken" = '');

-- If TATASTEEL doesn't exist in the Stock table at all, insert it
INSERT INTO "Stock" (id, symbol, name, exchange, "angelToken", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  'TATASTEEL',
  'Tata Steel Ltd',
  'NSE',
  '3499',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Stock" WHERE UPPER(symbol) = 'TATASTEEL'
);
