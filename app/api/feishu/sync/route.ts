import { NextResponse } from "next/server";
import { syncScheduleRotation } from "@/lib/core/scheduler";
import { getSchedules } from "@/lib/core/store";
import { ReminderSchedule } from "@/lib/core/types";


export async function POST(request: Request) {
  let targetScheduleId: string | undefined;
  try {
    const body = (await request.json()) as { scheduleId?: string };
    targetScheduleId = body.scheduleId;
  } catch {
    // ignore
  }

  const schedules: ReminderSchedule[] = getSchedules();
  const schedule = targetScheduleId ? schedules.find((s) => s.id === targetScheduleId) : schedules[0];
  if (!schedule) return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });

  if (!schedule.documentId) return NextResponse.json({ error: "未配置飞书数据源链接 (FEISHU_DOCUMENT_ID)" }, { status: 400 });

  try {
    const rotation = await syncScheduleRotation(schedule.id);
    return NextResponse.json({
      rotation,
      count: rotation.length,
      missingOpenIdCount: rotation.filter((member) => !member.openId).length,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}
