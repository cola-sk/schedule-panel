import { NextResponse } from "next/server";
import { getPublicBots, getRecentTasks, getSchedules } from "@/lib/core/store";
import { upcomingTasks } from "@/lib/core/scheduler";
import { upcomingMigrationStatsTasks } from "@/lib/knowledge-migration/notifier";

export async function GET() {
  const schedules = getSchedules();
  const scheduledTasks = await upcomingTasks(50);
  const now = new Date();
  const migrationTasks = upcomingMigrationStatsTasks(50, now);
  const tasks = [...scheduledTasks, ...migrationTasks].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt)
  );

  return NextResponse.json({
    schedules,
    bots: getPublicBots(),
    tasks,
    history: getRecentTasks(),
    configured: getPublicBots().some((bot) => bot.configured && bot.enabled),
  });
}
