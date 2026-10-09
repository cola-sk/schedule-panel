import { NextResponse } from "next/server";
import { getImageRepairProgress, startImageRepair } from "@/lib/knowledge-migration/image-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ progress: getImageRepairProgress() });
}

export async function POST() {
  return NextResponse.json({ progress: startImageRepair() });
}
