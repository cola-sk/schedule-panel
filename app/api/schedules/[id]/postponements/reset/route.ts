import { NextResponse } from "next/server";
import { getSchedule, resetSchedulePostponements } from "@/lib/core/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });

  const clearedCount = schedule.postponedDates?.length ?? 0;
  const updated = resetSchedulePostponements(id);
  return NextResponse.json({ schedule: updated, clearedCount });
}
