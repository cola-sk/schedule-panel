import { NextRequest, NextResponse } from "next/server";
import { startTaskScan } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as { selectedWikiId?: string };
    const { searchParams } = new URL(request.url);
    const selectedWikiId = body.selectedWikiId || searchParams.get("selectedWikiId") || undefined;
    const job = await startTaskScan(taskId, { selectedWikiId });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建扫描任务失败" }, { status: 400 });
  }
}
