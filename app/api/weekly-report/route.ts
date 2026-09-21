import { NextRequest, NextResponse } from "next/server";
import { getPublicBots, getRecentTasks, getSchedules, updateSchedule } from "@/lib/core/store";
import { upcomingTasksForSchedule, yearsForScheduling } from "@/lib/core/scheduler";
import { getChineseHolidayDates } from "@/lib/core/holidays";

export async function GET() {
  const schedules = getSchedules();
  const schedule = schedules.find(
    (s) => s.id === "weekly-report-schedule" || s.type === "weekly_report" || s.botId === "weekly-report"
  );

  const bots = getPublicBots();
  const recentHistory = schedule
    ? getRecentTasks().filter((t) => t.scheduleId === schedule.id || t.id.includes("weekly-report"))
    : [];

  let upcoming: any[] = [];
  if (schedule) {
    const holidays = await getChineseHolidayDates(yearsForScheduling(new Date(), 20));
    upcoming = await upcomingTasksForSchedule(schedule, 10, new Date(), holidays);
  }

  return NextResponse.json({
    schedule: schedule || null,
    bots,
    upcoming,
    history: recentHistory,
  });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const schedules = getSchedules();
    const targetSchedule = schedules.find(
      (s) => s.id === "weekly-report-schedule" || s.type === "weekly_report" || s.botId === "weekly-report"
    );

    if (!targetSchedule) {
      return NextResponse.json({ error: "未找到周报归档任务配置" }, { status: 404 });
    }

    const {
      name,
      dayOfWeek,
      time,
      sourceDocumentId,
      targetFolderId,
      botId,
      enabled,
    } = body;

    const changes: Record<string, any> = {};
    if (typeof name === "string") changes.name = name.trim();
    if (dayOfWeek !== undefined) changes.dayOfWeek = Number(dayOfWeek);
    if (typeof time === "string") changes.time = time.trim();
    if (sourceDocumentId !== undefined) changes.sourceDocumentId = String(sourceDocumentId).trim();
    if (targetFolderId !== undefined) changes.targetFolderId = String(targetFolderId).trim();
    if (botId !== undefined) changes.botId = String(botId).trim();
    if (typeof enabled === "boolean") changes.enabled = enabled;

    const updated = updateSchedule(targetSchedule.id, changes);
    return NextResponse.json({ ok: true, schedule: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "更新周报配置失败" }, { status: 500 });
  }
}
