import { NextRequest, NextResponse } from "next/server";
import { dispatchDueTasks } from "@/lib/core/scheduler";
import { dispatchDueMigrationStats, dispatchDueMigrationSilentScan } from "@/lib/knowledge-migration/notifier";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await dispatchDueTasks();
  const migrationTasks = await dispatchDueMigrationStats();
  const silentScanTasks = await dispatchDueMigrationSilentScan();
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    tasks,
    migrationTasks,
    silentScanTasks,
  });
}

