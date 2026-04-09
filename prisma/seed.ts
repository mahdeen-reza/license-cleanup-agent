/**
 * prisma/seed.ts
 *
 * Seeds the database with:
 *   1. One System record (Salesforce)
 *   2. Five InstanceConfig records (Instance A through E)
 *   3. IntegrationPattern records
 *   4. PriorException records (demo examples)
 *
 * Idempotent — safe to run multiple times. Uses upsert throughout.
 *
 * Run with:
 *   npx ts-node prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

/** Hash a password using scrypt — matches src/middleware/auth.ts */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('Seeding database…');

  // ─── 1. System ─────────────────────────────────────────────────────────────

  const system = await prisma.system.upsert({
    where: { name: 'Salesforce' },
    update: {},
    create: {
      name: 'Salesforce',
      description: 'Salesforce CRM instances',
      foundationalNote:
        'Primary GTM system. 5 instances across different product verticals.',
    },
  });

  console.log(`  System: ${system.name} (${system.id})`);

  // ─── 2. InstanceConfig records ─────────────────────────────────────────────

  const instances: {
    instanceName: string;
    defaultScope: string;
    productAlignment: { matchingProducts: string[] } | null;
  }[] = [
    { instanceName: 'Instance A', defaultScope: 'non_GTM', productAlignment: null },
    { instanceName: 'Instance B', defaultScope: 'non_GTM', productAlignment: { matchingProducts: ['Product B'] } },
    { instanceName: 'Instance C', defaultScope: 'non_GTM', productAlignment: { matchingProducts: ['Product C'] } },
    { instanceName: 'Instance D', defaultScope: 'non_GTM', productAlignment: { matchingProducts: ['Product D'] } },
    { instanceName: 'Instance E', defaultScope: 'non_GTM', productAlignment: { matchingProducts: ['Product E'] } },
  ];

  const instanceConfigIds: Record<string, string> = {};

  for (const inst of instances) {
    const existing = await prisma.instanceConfig.findFirst({
      where: { systemId: system.id, instanceName: inst.instanceName },
    });

    let config;
    if (existing) {
      config = existing;
      console.log(`  InstanceConfig: ${inst.instanceName} (existing — skipped)`);
    } else {
      config = await prisma.instanceConfig.create({
        data: {
          systemId: system.id,
          instanceName: inst.instanceName,
          defaultScope: inst.defaultScope,
          thresholds: { standardDays: 60, urgentDays: 30 },
          productAlignment: inst.productAlignment ?? undefined,
          gtmHandling: 'consult_required',
        },
      });
      console.log(`  InstanceConfig: ${inst.instanceName} created (${config.id})`);
    }

    instanceConfigIds[inst.instanceName] = config.id;
  }

  // ─── 3. IntegrationPattern records ─────────────────────────────────────────
  // Exact list from src/core/emailNormalizer.ts INTEGRATION_PATTERNS array.

  const integrationPatterns = [
    'integration',
    'api-user',
    'bot',
    'system',
    'service',
    'data.integrations',
    'connector',
    'automation',
  ];

  let patternsCreated = 0;
  let patternsSkipped = 0;

  for (const pattern of integrationPatterns) {
    const result = await prisma.integrationPattern.upsert({
      where: { pattern },
      update: {},
      create: { pattern },
    });
    if (result) patternsCreated++;
    else patternsSkipped++;
  }

  console.log(`  IntegrationPatterns: ${integrationPatterns.length} upserted (${patternsCreated} records)`);

  // ─── 4. PriorException records (demo examples) ────────────────────────────
  // These demonstrate the prior exception pattern with fictional data.

  const priorExceptions: {
    userEmail: string;
    userName: string;
    role: string;
    justification: string;
    action: 'keep_flag' | 'remove_with_confirmation';
  }[] = [
    {
      userEmail: 'jane.doe@company.com',
      userName: 'Jane Doe',
      role: 'Financial Analyst',
      justification: 'Accesses CRM data for quarterly financial reporting.',
      action: 'keep_flag',
    },
    {
      userEmail: 'bob.smith@company.com',
      userName: 'Bob Smith',
      role: 'Marketing Specialist',
      justification: 'Accesses CRM records for case study research.',
      action: 'keep_flag',
    },
    {
      userEmail: 'alice.chen@company.com',
      userName: 'Alice Chen',
      role: 'Support Specialist',
      justification: 'Weekend coverage — CRM access required during limited staffing windows.',
      action: 'remove_with_confirmation',
    },
  ];

  let exceptionsCreated = 0;
  let exceptionsSkipped = 0;

  for (const ex of priorExceptions) {
    await prisma.priorException.upsert({
      where: {
        systemId_userEmail: {
          systemId: system.id,
          userEmail: ex.userEmail,
        },
      },
      update: {
        // Keep justification and role current if the seed is re-run
        role: ex.role,
        justification: ex.justification,
        action: ex.action,
      },
      create: {
        systemId: system.id,
        userEmail: ex.userEmail,
        userName: ex.userName,
        role: ex.role,
        justification: ex.justification,
        action: ex.action,
      },
    });
    exceptionsCreated++;
  }

  console.log(`  PriorExceptions: ${exceptionsCreated} upserted`);

  // ─── 5. AppUser — initial admin ─────────────────────────────────────────────

  const adminUser = await prisma.appUser.upsert({
    where: { email: 'admin@company.com' },
    update: {},
    create: {
      email: 'admin@company.com',
      name: 'Admin User',
      passwordHash: hashPassword('changeme123'),
      role: 'admin',
      addedBy: 'system',
    },
  });

  console.log(`  AppUser (admin): ${adminUser.email} (${adminUser.id})`);

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
