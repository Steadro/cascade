import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function SyncPage() {
  return (
    <s-page heading="Sync">
      <s-section>
        <s-paragraph>
          Select a target store, choose resource types, preview changes, and
          execute syncs.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
