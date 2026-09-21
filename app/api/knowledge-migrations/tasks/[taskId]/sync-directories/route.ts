import { NextRequest, NextResponse } from "next/server";
import { syncTaskTargetDirectories } from "@/lib/knowledge-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const result = await syncTaskTargetDirectories(taskId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取飞书目标目录失败" },
      { status: 400 }
    );
  }
}
