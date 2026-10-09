import { NextResponse } from "next/server";
import { retryFailedImageRepairs } from "@/lib/knowledge-migration/image-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retry only the documents retained in the latest image-repair failure queue. */
export async function POST() {
  return NextResponse.json({ progress: retryFailedImageRepairs() });
}
