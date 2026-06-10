-- Add shareId column for public chat sharing
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "shareId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ChatSession_shareId_key" ON "ChatSession"("shareId");
