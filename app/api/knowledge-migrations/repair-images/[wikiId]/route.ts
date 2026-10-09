import { NextRequest, NextResponse } from "next/server";
import { repairOneDocument } from "@/lib/knowledge-migration/image-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ wikiId: string }> }) {
  try {
    const { wikiId } = await params;
    return NextResponse.json({ result: await repairOneDocument(wikiId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片修复失败" }, { status: 400 });
  }
}
