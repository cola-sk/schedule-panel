import { NextRequest, NextResponse } from "next/server";
import { getChineseHolidayDates } from "@/lib/core/holidays";
import { upcomingTasksForSchedule, yearsForScheduling } from "@/lib/core/scheduler";
import { getSchedule } from "@/lib/core/store";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit") || 20);
  const limit = Math.min(Math.max(limitParam || 20, 1), 100);

  const now = new Date();
  const holidays = await getChineseHolidayDates(yearsForScheduling(now, limit * 2 + 20));
  const tasks = await upcomingTasksForSchedule(schedule, limit, now, holidays);

  return NextResponse.json({ tasks, limit, schedule });
}
