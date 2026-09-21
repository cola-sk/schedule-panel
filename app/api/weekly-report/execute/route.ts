import { NextRequest, NextResponse } from "next/server";
import { getBot, getSchedules, recordTask, updateSchedule } from "@/lib/core/store";
import { executeWeeklyReportTask } from "@/lib/bots/weekly-report/executor";
import { ReminderTask } from "@/lib/core/types";

export async function POST(request: NextRequest) {
  try {
    const schedules = getSchedules();
    const schedule = schedules.find(
      (s) => s.id === "weekly-report-schedule" || s.type === "weekly_report" || s.botId === "weekly-report"
    );

    if (!schedule) {
      return NextResponse.json({ error: "未找到周报归档任务配置" }, { status: 404 });
    }

    const bot = getBot(schedule.botId);
    const nowIso = new Date().toISOString();

    const dummyTask: ReminderTask = {
      id: `manual-weekly-report-${Date.now()}`,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      host: { name: "系统自动" },
      scheduledAt: nowIso,
      status: "pending",
    };

    const result = await executeWeeklyReportTask({
      schedule,
      task: dummyTask,
      bot,
      scheduledAt: nowIso,
    });

    const recorded = recordTask({
      ...dummyTask,
      status: "sent",
      triggerType: "manual",
      sentAt: nowIso,
      botId: result.botId,
      botName: result.botName,
      content: result.content,
    });

    updateSchedule(schedule.id, {
      lastSentAt: nowIso,
    });

    return NextResponse.json({
      ok: true,
      result,
      task: recorded,
    });
  } catch (error: any) {
    const errMsg = error?.message || "周报生成执行失败";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
