import { Prisma } from '@prisma/client';

/**
 * Serializes short hold-domain writes within one gym.
 * The lock is released automatically when the PostgreSQL transaction ends.
 */
export async function lockHoldOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
}
