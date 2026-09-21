import { NextRequest, NextResponse } from "next/server";
import { getBot, getSchedule, updateSchedule } from "@/lib/core/store";
import { getNextHostIndex, setCurrentHost } from "@/lib/core/scheduler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = getSchedule(id);
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  const body = await request.json();
  const dayOfWeek = Number(body.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7 || !/^\d{2}:\d{2}$/.test(body.time ?? "")) {
    return NextResponse.json({ error: "周几或时间格式不正确" }, { status: 400 });
  }
  const botId = typeof body.botId === "string" ? body.botId.trim() : "";
  if (botId && !getBot(botId)) {
    return NextResponse.json({ error: "请选择存在的机器人" }, { status: 400 });
  }

  // 1. 获取变更前的当前下一个值班人索引，保证在修改执行日或时间后值班人员不发生非预期跳变
  const currentHostIndex = existing.rotation && existing.rotation.length > 0 ? await getNextHostIndex(id) : undefined;

  // 2. 更新基础配置
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : undefined;
  const sourceDocumentId = typeof body.sourceDocumentId === "string" ? body.sourceDocumentId.trim() : undefined;
  const targetFolderId = typeof body.targetFolderId === "string" ? body.targetFolderId.trim() : undefined;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;

  const changes: Record<string, any> = {
    dayOfWeek,
    time: body.time,
    botId,
    enabled: Boolean(body.enabled),
  };
  if (name) changes.name = name;
  if (documentId !== undefined) changes.documentId = documentId;
  if (sourceDocumentId !== undefined) changes.sourceDocumentId = sourceDocumentId;
  if (targetFolderId !== undefined) changes.targetFolderId = targetFolderId;

  updateSchedule(id, changes);

  // 3. 若存在有效轮值人员，重新以新时间对齐基准点
  let schedule = getSchedule(id);
  if (schedule && currentHostIndex !== undefined && schedule.rotation.length > 0) {
    try {
      schedule = await setCurrentHost(id, currentHostIndex);
    } catch (e) {
      console.error("重新对齐值班节点失败:", e);
    }
  }

  return NextResponse.json({ schedule });
}
