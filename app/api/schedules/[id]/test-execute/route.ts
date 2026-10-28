import { NextRequest, NextResponse } from "next/server";
import { getBot, getSchedule, recordTask } from "@/lib/core/store";
import { sendTaskReminder, upcomingTasksForSchedule } from "@/lib/core/scheduler";
import { getChineseHolidayDates } from "@/lib/core/holidays";
import { fetchRotationFromSource } from "@/lib/core/feishu-client";
import { getBotDefinition } from "@/lib/bots";
import type { ReminderSchedule, RotationMember } from "@/lib/core/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "未找到定时任务配置" }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // 允许空 body
  }

  const effectiveSchedule: ReminderSchedule = {
    ...schedule,
    ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
    ...(body.botId !== undefined ? { botId: String(body.botId).trim() } : {}),
    ...(body.documentId !== undefined ? { documentId: String(body.documentId).trim() } : {}),
    ...(body.meetingDocumentUrl !== undefined ? { meetingDocumentUrl: String(body.meetingDocumentUrl).trim() } : {}),
    ...(body.sourceDocumentId !== undefined ? { sourceDocumentId: String(body.sourceDocumentId).trim() } : {}),
    ...(body.targetFolderId !== undefined ? { targetFolderId: String(body.targetFolderId).trim() } : {}),
    ...(body.atAll !== undefined ? { atAll: Boolean(body.atAll) } : {}),
  };

  // 如果前端修改了名单数据源地址且与原地址不同，尝试拉取新数据源的人员名单
  if (body.documentId && body.documentId.trim() !== schedule.documentId) {
    try {
      const botDef = getBotDefinition(effectiveSchedule.botId);
      let newRotation: RotationMember[];
      if (botDef?.customFetchRotation) {
        newRotation = await botDef.customFetchRotation(effectiveSchedule.documentId!);
      } else {
        newRotation = await fetchRotationFromSource(effectiveSchedule.documentId!);
      }
      if (newRotation.length > 0) {
        effectiveSchedule.rotation = newRotation;
        effectiveSchedule.currentIndex = 0;
      }
    } catch (e) {
      console.warn("测试执行时拉取临时名单失败，将沿用原有名单:", e);
    }
  }

  try {
    const now = new Date();
    const holidays = await getChineseHolidayDates([now.getFullYear(), now.getFullYear() + 1]);
    const upcoming = await upcomingTasksForSchedule({ ...effectiveSchedule, enabled: true }, 1, now, holidays);
    const task = upcoming[0] || {
      id: `${effectiveSchedule.id}-test-${Date.now()}`,
      scheduleId: effectiveSchedule.id,
      scheduleName: effectiveSchedule.name,
      host: effectiveSchedule.rotation?.[effectiveSchedule.currentIndex] || { name: "测试执行" },
      scheduledAt: now.toISOString(),
      status: "pending" as const,
    };

    const result = await sendTaskReminder(task, effectiveSchedule);
    const recorded = recordTask({
      ...task,
      id: `${effectiveSchedule.id}-test-${Date.now()}`,
      scheduleName: effectiveSchedule.name,
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
