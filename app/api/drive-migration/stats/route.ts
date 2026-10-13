import { NextResponse } from "next/server";
import { getDriveMigrationStats } from "@/lib/drive-migration/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getDriveMigrationStats();
    return NextResponse.json({ stats });
  } catch (error: any) {
    console.error("获取网盘迁移统计失败:", error);
    return NextResponse.json(
      { error: error?.message || "获取网盘迁移统计失败" },
      { status: 500 },
    );
  }
}
