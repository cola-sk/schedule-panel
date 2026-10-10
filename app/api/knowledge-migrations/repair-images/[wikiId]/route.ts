import { NextRequest, NextResponse } from "next/server";
import { repairOneDocument } from "@/lib/knowledge-migration/image-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ wikiId: string }> }) {
  try {
    const { wikiId } = await params;
    // `forceStoredTarget` is intentionally opt-in: it is only for an
    // explicitly selected target document whose manual paste removed the
    // provenance header used by the normal safety check.
    const forceStoredTarget = request.nextUrl.searchParams.get("forceStoredTarget") === "true";
    return NextResponse.json({ result: await repairOneDocument(wikiId, { forceStoredTarget }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片修复失败" }, { status: 400 });
  }
}
