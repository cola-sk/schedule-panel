import { NextRequest, NextResponse } from "next/server";
import { chinaDateKey } from "@/lib/core/scheduler";
import { getSchedule, updateScheduleHostOverrides } from "@/lib/core/store";
import { RotationMember } from "@/lib/core/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) {
    return NextResponse.json({ error: "未找到定时任务" }, { status: 404 });
  }

  const body = await request.json();
  let overrides: Record<string, RotationMember & { isSwapped?: boolean }> = {};

  const baseIndex = typeof schedule.currentIndex === "number" ? schedule.currentIndex : 0;
  const rotLen = schedule.rotation.length || 1;

  if (body.hostOverrides && typeof body.hostOverrides === "object") {
    overrides = body.hostOverrides;
  } else if (Array.isArray(body.tasks)) {
    body.tasks.forEach((item: { scheduledAt?: string; host?: RotationMember; isSwapped?: boolean }, idx: number) => {
      if (item.scheduledAt && item.host?.name) {
        const key = chinaDateKey(new Date(item.scheduledAt));
        const defaultMemberIndex = (((baseIndex + idx) % rotLen) + rotLen) % rotLen;
        const defaultHost = schedule.rotation[defaultMemberIndex];

        const isDifferent =
          item.host.name !== defaultHost?.name ||
          (Boolean(item.host.openId) && item.host.openId !== defaultHost?.openId);

        // 仅在与默认轮值人不同，或者显式标记了调换/覆盖时才记录为 override，避免全量固化未来日期
        if (isDifferent || item.isSwapped) {
          overrides[key] = {
            name: item.host.name,
            ...(item.host.openId ? { openId: item.host.openId } : {}),
            ...(item.isSwapped ? { isSwapped: true } : {}),
          };
        }
      }
    });
  } else {
    return NextResponse.json({ error: "请提供 hostOverrides 或 tasks 排期列表" }, { status: 400 });
  }

  const updated = updateScheduleHostOverrides(id, overrides);
  return NextResponse.json({ success: true, schedule: updated });
}
