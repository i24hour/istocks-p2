-- Make stockId optional on ChatSession (Trading Agent is a general chat, not stock-specific)
ALTER TABLE "ChatSession" ALTER COLUMN "stockId" DROP NOT NULL;
