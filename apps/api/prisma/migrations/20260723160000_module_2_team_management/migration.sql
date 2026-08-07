-- 模块 2.2：员工邀请、组织级成员状态和成员级会话。
-- 回滚前必须先确认不存在仍需保留的员工邀请和成员资料；按依赖顺序逆向处理。
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

ALTER TABLE "Membership"
  ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "responsibility" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AuthSession" ADD COLUMN "membershipId" TEXT;

UPDATE "AuthSession" AS session
SET "membershipId" = membership."id"
FROM "Membership" AS membership
WHERE membership."accountId" = session."accountId"
  AND session."membershipId" IS NULL;

ALTER TABLE "AuthSession" ALTER COLUMN "membershipId" SET NOT NULL;

CREATE TABLE "StaffInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL DEFAULT 'L2_ADMIN',
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "pendingKey" TEXT,
  "invitedByAccountId" TEXT NOT NULL,
  "acceptedByAccountId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthSession_membershipId_expiresAt_idx" ON "AuthSession"("membershipId", "expiresAt");
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");
CREATE UNIQUE INDEX "StaffInvitation_pendingKey_key" ON "StaffInvitation"("pendingKey");
CREATE INDEX "StaffInvitation_organizationId_createdAt_idx" ON "StaffInvitation"("organizationId", "createdAt");
CREATE INDEX "StaffInvitation_email_idx" ON "StaffInvitation"("email");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_invitedByAccountId_fkey"
  FOREIGN KEY ("invitedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_acceptedByAccountId_fkey"
  FOREIGN KEY ("acceptedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
