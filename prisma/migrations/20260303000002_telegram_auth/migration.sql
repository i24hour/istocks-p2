-- Add telegramId + telegramLinkedAt to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramId" BIGINT;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "telegramLinkedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramId_key" ON "User" ("telegramId");

-- CreateTable TelegramLinkToken
CREATE TABLE IF NOT EXISTS "TelegramLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLinkToken_token_key" ON "TelegramLinkToken" ("token");

CREATE INDEX IF NOT EXISTS "TelegramLinkToken_token_idx" ON "TelegramLinkToken" ("token");

CREATE INDEX IF NOT EXISTS "TelegramLinkToken_chatId_idx" ON "TelegramLinkToken" ("chatId");