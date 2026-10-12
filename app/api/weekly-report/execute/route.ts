import { NextRequest, NextResponse } from "next/server";
import { getBot, getSchedules, recordTask, updateSchedule } from "@/lib/core/store";
import { executeWeeklyReportTask } from "@/lib/bots/weekly-report/executor";
import { ReminderTask } from "@/lib/core/types";

export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // 允许空 body
    }

    const schedules = getSchedules();
    const scheduleId = body.scheduleId;
    const schedule = (scheduleId ? schedules.find((s) => s.id === scheduleId) : undefined) || schedules.find(
      (s) => s.id === "weekly-report-schedule" || s.type === "weekly_report" || s.botId === "weekly-report"
    );

    if (!schedule) {
      return NextResponse.json({ error: "未找到周报归档任务配置" }, { status: 404 });
    }

    const effectiveSchedule = {
      ...schedule,
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.sourceDocumentId !== undefined ? { sourceDocumentId: String(body.sourceDocumentId).trim() } : {}),
      ...(body.targetFolderId !== undefined ? { targetFolderId: String(body.targetFolderId).trim() } : {}),
      ...(body.botId !== undefined ? { botId: String(body.botId).trim() } : {}),
      ...(body.atAll !== undefined ? { atAll: Boolean(body.atAll) } : {}),
    };

    const bot = effectiveSchedule.botId ? getBot(effectiveSchedule.botId) : undefined;
    const nowIso = new Date().toISOString();

    const dummyTask: ReminderTask = {
      id: `manual-weekly-report-${Date.now()}`,
      scheduleId: effectiveSchedule.id,
      scheduleName: effectiveSchedule.name,
      host: { name: "系统自动" },
      scheduledAt: nowIso,
      status: "pending",
    };

    const result = await executeWeeklyReportTask({
      schedule: effectiveSchedule,
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

    updateSchedule(effectiveSchedule.id, {
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
