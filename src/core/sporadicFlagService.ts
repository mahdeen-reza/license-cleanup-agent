/**
 * sporadicFlagService.ts
 *
 * CRUD operations for the SporadicFlag model — tracks users with
 * project-based or temporary access patterns. Separate from Prior
 * Exceptions: sporadic flags provide context but do NOT protect
 * users from removal.
 */

import { prisma } from '../lib/prisma';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateFlagInput {
  systemId: string;
  instanceName: string;
  userEmail: string;
  userName: string;
  note: string;
  flaggedBy: string;
}

export interface FlagResponse {
  id: string;
  userEmail: string;
  userName: string;
  instanceName: string;
  note: string;
  active: boolean;
  removalCount: number;
  lastRemovedAt: string | null;
  lastReappearedAt: string | null;
  flaggedBy: string;
  flaggedAt: string;
}

function toResponse(flag: {
  id: string;
  userEmail: string;
  userName: string;
  instanceName: string;
  note: string;
  active: boolean;
  removalCount: number;
  lastRemovedAt: Date | null;
  lastReappearedAt: Date | null;
  flaggedBy: string;
  flaggedAt: Date;
}): FlagResponse {
  return {
    id: flag.id,
    userEmail: flag.userEmail,
    userName: flag.userName,
    instanceName: flag.instanceName,
    note: flag.note,
    active: flag.active,
    removalCount: flag.removalCount,
    lastRemovedAt: flag.lastRemovedAt?.toISOString() ?? null,
    lastReappearedAt: flag.lastReappearedAt?.toISOString() ?? null,
    flaggedBy: flag.flaggedBy,
    flaggedAt: flag.flaggedAt.toISOString(),
  };
}

// ─── Create / reactivate ────────────────────────────────────────────────────

export async function createSporadicFlag(input: CreateFlagInput): Promise<FlagResponse> {
  const now = new Date();

  const flag = await prisma.sporadicFlag.upsert({
    where: {
      userEmail_instanceName: {
        userEmail: input.userEmail,
        instanceName: input.instanceName,
      },
    },
    update: {
      active: true,
      note: input.note,
      flaggedBy: input.flaggedBy,
      flaggedAt: now,
      userName: input.userName,
      systemId: input.systemId,
    },
    create: {
      systemId: input.systemId,
      instanceName: input.instanceName,
      userEmail: input.userEmail,
      userName: input.userName,
      flaggedBy: input.flaggedBy,
      flaggedAt: now,
      note: input.note,
    },
  });

  // Write history event
  await prisma.userInstanceHistory.create({
    data: {
      userEmail: input.userEmail,
      instanceName: input.instanceName,
      eventType: 'sporadic_flagged',
      eventDate: now,
      note: input.note,
      actorEmail: input.flaggedBy,
    },
  });

  return toResponse(flag);
}

// ─── List active flags for an instance ──────────────────────────────────────

export async function listSporadicFlags(instanceName: string): Promise<FlagResponse[]> {
  const flags = await prisma.sporadicFlag.findMany({
    where: { instanceName, active: true },
    orderBy: { flaggedAt: 'desc' },
  });
  return flags.map(toResponse);
}

// ─── Get single flag by user + instance ─────────────────────────────────────

export async function getSporadicFlag(
  userEmail: string,
  instanceName: string,
): Promise<FlagResponse | null> {
  const flag = await prisma.sporadicFlag.findUnique({
    where: {
      userEmail_instanceName: { userEmail, instanceName },
    },
  });
  return flag ? toResponse(flag) : null;
}

// ─── Batch lookup for pipeline enrichment ───────────────────────────────────

export async function getSporadicFlagsBatch(
  emails: string[],
  instanceName: string,
): Promise<Map<string, FlagResponse>> {
  if (emails.length === 0) return new Map();

  const flags = await prisma.sporadicFlag.findMany({
    where: {
      userEmail: { in: emails },
      instanceName,
      active: true,
    },
  });

  return new Map(flags.map((f) => [f.userEmail, toResponse(f)]));
}

// ─── Deactivate (soft delete) ───────────────────────────────────────────────

export async function deactivateSporadicFlag(
  flagId: string,
  actorEmail: string,
): Promise<FlagResponse> {
  const flag = await prisma.sporadicFlag.update({
    where: { id: flagId },
    data: { active: false },
  });

  await prisma.userInstanceHistory.create({
    data: {
      userEmail: flag.userEmail,
      instanceName: flag.instanceName,
      eventType: 'sporadic_unflagged',
      eventDate: new Date(),
      note: `Deactivated by ${actorEmail}`,
      actorEmail,
    },
  });

  return toResponse(flag);
}

// ─── Update note ────────────────────────────────────────────────────────────

export async function updateSporadicFlag(
  flagId: string,
  note: string,
  actorEmail: string,
): Promise<FlagResponse> {
  const flag = await prisma.sporadicFlag.update({
    where: { id: flagId },
    data: { note },
  });

  return toResponse(flag);
}
