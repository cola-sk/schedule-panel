import { NextResponse } from "next/server";
import { chinaDateKey, upcomingTasks } from "@/lib/core/scheduler";
import { postponeScheduleDate } from "@/lib/core/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let decodedId = rawId;
  try {
    decodedId = decodeURIComponent(rawId);
  } catch {
    // fallback
  }

  let task = (await upcomingTasks(50)).find((item) => item.id === decodedId || item.id === rawId);
  let dateKey: string | undefined;
  let scheduleId: string | undefined;

  if (task) {
    dateKey = chinaDateKey(new Date(task.scheduledAt));
    scheduleId = task.scheduleId;
  } else {
    for (const candidateId of [decodedId, rawId]) {
      const match = candidateId.match(/^(.*)-(\d{4}-\d{2}-\d{2}T.*)$/);
      if (match) {
        scheduleId = match[1];
        const dateStr = match[2].includes("%") ? decodeURIComponent(match[2]) : match[2];
        const date = new Date(dateStr);
        if (!Number.isNaN(date.getTime())) {
          dateKey = chinaDateKey(date);
          break;
        }
      }
    }
  }

  if (!scheduleId || !dateKey) {
    return NextResponse.json({ error: "未找到指定任务，可能已被延期或已执行" }, { status: 404 });
  }

  const schedule = postponeScheduleDate(scheduleId, dateKey);
  if (!schedule) return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });

  return NextResponse.json({ schedule, postponedDate: dateKey });
}
