import db from "../db.server";

export interface PairingGuardResult {
  readonly pairingId: string;
  readonly primaryShop: string;
  readonly pairedShop: string;
  readonly label: string | null;
}

/**
 * Validates that an active pairing exists between the authenticated shop
 * and the target store. Throws if no active pairing is found.
 */
export async function assertShopIsPaired(
  authenticatedShop: string,
  pairingId: string,
): Promise<PairingGuardResult> {
  const pairing = await db.storePairing.findFirst({
    where: {
      id: pairingId,
      status: "active",
      OR: [
        { primaryShop: authenticatedShop },
        { pairedShop: authenticatedShop },
      ],
    },
    select: {
      id: true,
      primaryShop: true,
      pairedShop: true,
      label: true,
    },
  });

  if (!pairing) {
    throw new Error(
      `No active pairing found for shop "${authenticatedShop}" with pairing ID "${pairingId}".`,
    );
  }

  return {
    pairingId: pairing.id,
    primaryShop: pairing.primaryShop,
    pairedShop: pairing.pairedShop,
    label: pairing.label,
  };
}
