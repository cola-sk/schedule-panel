import { NextResponse } from "next/server";
import { chinaDateKey, sendTaskReminder, taskForScheduleAt, upcomingTasks } from "@/lib/core/scheduler";
import { getBot, getSchedule, recordTask, updateSchedule } from "@/lib/core/store";


export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    // fallback
  }

  let task = (await upcomingTasks(50)).find((item) => item.id === decodedId || item.id === rawId);
  if (!task) {
    for (const candidateId of [decodedId, rawId]) {
      const match = candidateId.match(/^(.*)-(\d{4}-\d{2}-\d{2}T.*)$/);
      if (match) {
        const schedule = getSchedule(match[1]);
        const dateStr = match[2].includes("%") ? decodeURIComponent(match[2]) : match[2];
        const scheduledAt = new Date(dateStr);
        if (schedule && !Number.isNaN(scheduledAt.getTime())) {
          task = taskForScheduleAt(schedule, scheduledAt);
          break;
        }
      }
    }
  }

  if (!task) return NextResponse.json({ error: "未找到指定任务" }, { status: 404 });
  const schedule = getSchedule(task.scheduleId);
  try {
    const result = await sendTaskReminder(task);
    const sent = recordTask({
      ...task,
      status: "sent",
      triggerType: "manual",
      sentAt: new Date().toISOString(),
      botId: result.botId,
      botName: result.botName,
      content: result.content,
    });
    if (schedule) {
      const nextIndex = (schedule.currentIndex + 1) % schedule.rotation.length;
      const targetDateKey = chinaDateKey(new Date(task.scheduledAt));
      let nextOverrides = schedule.hostOverrides;
      if (nextOverrides && nextOverrides[targetDateKey]) {
        const { [targetDateKey]: _removed, ...rest } = nextOverrides;
        nextOverrides = rest;
      }
      updateSchedule(schedule.id, {
        lastSentAt: sent.sentAt,
        currentIndex: nextIndex,
        hostOverrides: nextOverrides,
      });
    }
    return NextResponse.json({ task: sent, result });
  } catch (error) {
    const failed = recordTask({
      ...task,
      status: "failed",
      triggerType: "manual",
      sentAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "发送失败",
      botId: schedule?.botId,
      botName: schedule?.botId ? getBot(schedule.botId)?.name : undefined,
      content: `发送失败：${error instanceof Error ? error.message : "发送失败"}`,
    });
    return NextResponse.json({ task: failed, error: failed.error }, { status: 502 });
  }
}
