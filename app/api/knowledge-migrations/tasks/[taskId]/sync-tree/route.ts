import { NextRequest, NextResponse } from "next/server";
import { syncTaskWikiTree } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const result = await syncTaskWikiTree(taskId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步 Wiki 目录树失败" }, { status: 400 });
  }
}
