import { createAdminApiClient } from "@shopify/admin-api-client";
import db from "../db.server";
import { apiVersion } from "../shopify.server";
import type { StoreClient, StoreClientResponse } from "../sync/types";

export async function createStoreClient(shop: string): Promise<StoreClient> {
  const session = await db.session.findFirst({
    where: { shop, isOnline: false },
    select: { accessToken: true, shop: true },
  });

  if (!session) {
    throw new Error(
      `No session found for ${shop}. Cascade must be installed on that store.`,
    );
  }

  const client = createAdminApiClient({
    storeDomain: session.shop,
    apiVersion,
    accessToken: session.accessToken,
  });

  return {
    request: async (query, options) => {
      const response = await client.request(query, {
        variables: options?.variables,
      });
      return response as StoreClientResponse;
    },
  };
}

export function wrapAuthAdmin(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): StoreClient {
  return {
    request: async (query, options) => {
      const response = await admin.graphql(query, {
        variables: options?.variables,
      });
      const json = await response.json();
      return json as StoreClientResponse;
    },
  };
}
