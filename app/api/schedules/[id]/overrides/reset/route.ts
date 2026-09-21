import { NextResponse } from "next/server";
import { getSchedule, resetScheduleHostOverrides } from "@/lib/core/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });
  }

  const clearedCount = Object.keys(schedule.hostOverrides ?? {}).length;
  const updated = resetScheduleHostOverrides(id);
  return NextResponse.json({ schedule: updated, clearedCount });
}
