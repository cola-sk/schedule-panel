import { NextRequest, NextResponse } from "next/server";
import { getBot, getSchedule, recordTask } from "@/lib/core/store";
import { sendTaskReminder, upcomingTasksForSchedule } from "@/lib/core/scheduler";
import { getChineseHolidayDates } from "@/lib/core/holidays";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "未找到定时任务配置" }, { status: 404 });
  }

  try {
    const now = new Date();
    const holidays = await getChineseHolidayDates([now.getFullYear(), now.getFullYear() + 1]);
    const upcoming = await upcomingTasksForSchedule(schedule, 1, now, holidays);
    const task = upcoming[0] || {
      id: `${schedule.id}-test-${Date.now()}`,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      host: schedule.rotation?.[schedule.currentIndex] || { name: "测试执行" },
      scheduledAt: now.toISOString(),
      status: "pending" as const,
    };

    const result = await sendTaskReminder(task);
    const recorded = recordTask({
      ...task,
      id: `${schedule.id}-test-${Date.now()}`,
      status: "sent",
      triggerType: "manual",
      sentAt: now.toISOString(),
      botId: result.botId,
      botName: result.botName,
      content: result.content,
    });

    // 关键：测试执行绝对不推进 currentIndex，不影响主持人轮替！
    return NextResponse.json({
      ok: true,
      result,
      task: recorded,
      message: result.mocked ? "未配置机器人 Webhook，已在本地模拟执行。" : "已成功向飞书群发送测试执行消息，且未推进轮值主持人。",
    });
  } catch (error: any) {
    const errMsg = error?.message || "测试执行失败";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
