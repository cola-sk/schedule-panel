import { NextRequest, NextResponse } from "next/server";
import { getTaskMigrationStats } from "@/lib/knowledge-migration/store";
import { generateMigrationWeeklyStats } from "@/lib/knowledge-migration/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const stats = getTaskMigrationStats(taskId);
    return NextResponse.json({ stats: stats || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取统计数据失败" },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const stats = await generateMigrationWeeklyStats(taskId);
    return NextResponse.json({ stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "扫描生成统计数据失败" },
      { status: 400 }
    );
  }
}
