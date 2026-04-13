import db from "../db.server";
import { getSubscriptionStatus } from "./subscription.server";

interface PairingWithMeta {
  id: string;
  primaryShop: string;
  pairedShop: string;
  label: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  role: "primary" | "paired";
  lastSyncedAt: Date | null;
}

interface DashboardData {
  pairings: PairingWithMeta[];
  recentJobs: Array<{
    id: string;
    sourceShop: string;
    targetShop: string;
    resourceTypes: string;
    status: string;
    processedItems: number;
    totalItems: number;
    createdAt: Date;
    completedAt: Date | null;
  }>;
  hasPairings: boolean;
}

type ValidationResult =
  | { ok: true; reactivateId?: string }
  | { ok: false; error: string };

const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();

  if (!domain) {
    throw new Error("Store domain is required");
  }

  domain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  if (!domain.endsWith(".myshopify.com")) {
    domain = `${domain}.myshopify.com`;
  }

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error(
      `Invalid store domain: "${domain}". Must be a valid myshopify.com domain.`,
    );
  }

  return domain;
}

export async function validatePairingRequest(
  shop: string,
  targetDomain: string,
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<ValidationResult> {
  let normalizedTarget: string;
  try {
    normalizedTarget = normalizeDomain(targetDomain);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid domain",
    };
  }

  if (normalizedTarget === shop) {
    return { ok: false, error: "Cannot pair a store with itself" };
  }

  const targetSession = await db.session.findFirst({
    where: { shop: normalizedTarget, isOnline: false },
    select: { id: true },
  });

  if (!targetSession) {
    return {
      ok: false,
      error:
        "Cascade must be installed on that store first. Install it there, then try again.",
    };
  }

  const subscription = await getSubscriptionStatus(admin);
  const activeCount = await db.storePairing.count({
    where: { primaryShop: shop, status: { in: ["active", "pending"] } },
  });

  if (activeCount >= subscription.pairingLimit) {
    return {
      ok: false,
      error:
        subscription.pairingLimit === 0
          ? "Upgrade to a paid plan to pair stores."
          : `Your ${subscription.subscriptionName ?? "current"} plan allows ${subscription.pairingLimit} paired store(s). Upgrade to add more.`,
    };
  }

  const existing = await db.storePairing.findFirst({
    where: { primaryShop: shop, pairedShop: normalizedTarget },
  });

  if (existing && existing.status === "active") {
    return { ok: false, error: "Already paired with this store" };
  }

  if (existing && existing.status === "pending") {
    return { ok: false, error: "A pairing request is already pending for this store" };
  }

  if (existing && existing.status === "disconnected") {
    return { ok: true, reactivateId: existing.id };
  }

  return { ok: true };
}

export async function createPairing(
  shop: string,
  targetDomain: string,
  label: string,
): Promise<{ id: string; primaryShop: string; pairedShop: string; label: string | null; status: string }> {
  const normalizedTarget = normalizeDomain(targetDomain);

  const existing = await db.storePairing.findFirst({
    where: {
      primaryShop: shop,
      pairedShop: normalizedTarget,
      status: "disconnected",
    },
  });

  if (existing) {
    return db.storePairing.update({
      where: { id: existing.id },
      data: { status: "active", label },
    });
  }

  return db.storePairing.create({
    data: {
      primaryShop: shop,
      pairedShop: normalizedTarget,
      label,
      status: "pending",
    },
  });
}

export async function removePairing(
  shop: string,
  pairingId: string,
): Promise<void> {
  const pairing = await db.storePairing.findUnique({
    where: { id: pairingId },
  });

  if (!pairing) {
    throw new Error("Pairing not found");
  }

  if (pairing.primaryShop !== shop) {
    throw new Error("Only the primary store can remove pairings");
  }

  await db.storePairing.update({
    where: { id: pairingId },
    data: { status: "disconnected" },
  });
}

export async function approvePairing(
  shop: string,
  pairingId: string,
): Promise<void> {
  const pairing = await db.storePairing.findUnique({
    where: { id: pairingId },
  });

  if (!pairing) {
    throw new Error("Pairing not found");
  }

  if (pairing.pairedShop !== shop) {
    throw new Error("Only the paired store can approve a pairing request");
  }

  if (pairing.status !== "pending") {
    throw new Error("Pairing is not pending approval");
  }

  await db.storePairing.update({
    where: { id: pairingId },
    data: { status: "active" },
  });
}

export async function rejectPairing(
  shop: string,
  pairingId: string,
): Promise<void> {
  const pairing = await db.storePairing.findUnique({
    where: { id: pairingId },
  });

  if (!pairing) {
    throw new Error("Pairing not found");
  }

  if (pairing.pairedShop !== shop) {
    throw new Error("Only the paired store can reject a pairing request");
  }

  if (pairing.status !== "pending") {
    throw new Error("Pairing is not pending approval");
  }

  await db.storePairing.update({
    where: { id: pairingId },
    data: { status: "rejected" },
  });
}

export async function getPairingsForShop(
  shop: string,
): Promise<PairingWithMeta[]> {
  const pairings = await db.storePairing.findMany({
    where: {
      status: { in: ["active", "pending"] },
      OR: [{ primaryShop: shop }, { pairedShop: shop }],
    },
    include: {
      syncJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { completedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return pairings.map((p) => ({
    id: p.id,
    primaryShop: p.primaryShop,
    pairedShop: p.pairedShop,
    label: p.label,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    role: p.primaryShop === shop ? ("primary" as const) : ("paired" as const),
    lastSyncedAt: p.syncJobs[0]?.completedAt ?? null,
  }));
}

export async function getDashboardData(shop: string): Promise<DashboardData> {
  const pairings = await getPairingsForShop(shop);

  const pairingIds = pairings.map((p) => p.id);

  const recentJobs =
    pairingIds.length > 0
      ? await db.syncJob.findMany({
          where: { pairingId: { in: pairingIds } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            sourceShop: true,
            targetShop: true,
            resourceTypes: true,
            status: true,
            processedItems: true,
            totalItems: true,
            createdAt: true,
            completedAt: true,
          },
        })
      : [];

  return {
    pairings,
    recentJobs,
    hasPairings: pairings.length > 0,
  };
}
