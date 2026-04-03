import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function HistoryPage() {
  return (
    <s-page heading="History">
      <s-section>
        <s-paragraph>
          View past sync jobs and their outcomes.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
