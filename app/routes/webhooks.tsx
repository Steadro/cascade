import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  let topic = "unknown";
  let shop = "unknown";

  try {
    const webhookContext = await authenticate.webhook(request);
    shop = webhookContext.shop;
    topic = webhookContext.topic;
    const { session, payload } = webhookContext;

    console.log(`Received ${topic} webhook for ${shop}`);

    switch (topic) {
      case "APP_UNINSTALLED": {
        if (session) {
          await db.session.deleteMany({ where: { shop } });
        }
        break;
      }

      case "APP_SCOPES_UPDATE": {
        const current = (payload as { current?: string[] }).current;
        if (session && current) {
          await db.session.update({
            where: { id: session.id },
            data: { scope: current.toString() },
          });
        }
        break;
      }

      case "CUSTOMERS_DATA_REQUEST": {
        console.log(
          `Customer data request for ${shop} — no customer data stored`,
        );
        break;
      }

      case "CUSTOMERS_REDACT": {
        console.log(`Customer redact for ${shop} — no customer data stored`);
        break;
      }

      case "SHOP_REDACT": {
        console.log(`Shop redact for ${shop} — deleting all associated data`);

        const pairings = await db.storePairing.findMany({
          where: {
            OR: [{ primaryShop: shop }, { pairedShop: shop }],
          },
          select: { id: true },
        });
        const pairingIds = pairings.map((p) => p.id);

        if (pairingIds.length > 0) {
          await db.resourceMap.deleteMany({
            where: { pairingId: { in: pairingIds } },
          });
          await db.syncJob.deleteMany({
            where: { pairingId: { in: pairingIds } },
          });
          await db.storePairing.deleteMany({
            where: { id: { in: pairingIds } },
          });
        }

        await db.session.deleteMany({ where: { shop } });
        break;
      }

      default: {
        console.log(`Unhandled webhook topic: ${topic}`);
      }
    }
  } catch (error) {
    // Re-throw Response objects — these are auth failures (401/403) from
    // authenticate.webhook and must not be swallowed
    if (error instanceof Response) {
      throw error;
    }
    console.error(`Webhook error (${topic} for ${shop}):`, error);
  }

  return new Response();
};
