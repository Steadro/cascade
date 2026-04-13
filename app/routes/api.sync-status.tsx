import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return Response.json({ ok: false, error: "Missing jobId" }, { status: 400 });
  }

  const job = await db.syncJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      sourceShop: true,
      targetShop: true,
      status: true,
      progress: true,
      totalItems: true,
      processedItems: true,
      errors: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!job) {
    return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  if (job.sourceShop !== shop && job.targetShop !== shop) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  const errors = job.errors ? JSON.parse(job.errors) : [];

  return Response.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      errors,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
};
