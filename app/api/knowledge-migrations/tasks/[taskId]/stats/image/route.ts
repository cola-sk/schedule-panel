import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getTask } from "@/lib/knowledge-migration/store";
import { generateMigrationWeeklyStats, computeCycleStats } from "@/lib/knowledge-migration/stats";
import { renderStatsDashboardImage } from "@/lib/knowledge-migration/image-generator";
import type { StatCycleType } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: 实时生成并返回当前任务看板的高清 PNG 长图
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const cycleParam = request.nextUrl.searchParams.get("cycle") as StatCycleType | null;
    const cycleType = cycleParam || task.notifyConfig?.cycleType || "this_week";

    const stats = task.stats || (await generateMigrationWeeklyStats(taskId));
    const cycleStats = computeCycleStats(stats, cycleType);
    const imagePath = await renderStatsDashboardImage(stats, task.name, cycleStats);

    const imageBuffer = fs.readFileSync(imagePath);
    try {
      fs.unlinkSync(imagePath);
    } catch {}

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="km-stats-${encodeURIComponent(task.name)}.png"`,
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成看板长图失败" },
      { status: 500 }
    );
  }
}
