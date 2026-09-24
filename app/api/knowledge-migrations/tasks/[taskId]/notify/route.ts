import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTaskNotifyConfig } from "@/lib/knowledge-migration/store";
import { sendTaskStatsNotification } from "@/lib/knowledge-migration/notifier";
import { getPublicBots } from "@/lib/core/store";
import type { TaskNotifyConfig } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: 获取任务当前的通知配置及可用机器人列表
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const availableBots = getPublicBots().filter((b) => b.configured);
    const defaultBotId = availableBots[0]?.id || "";

    const defaultConfig: TaskNotifyConfig = {
      enabled: false,
      botId: defaultBotId,
      webhookUrl: "",
      dayOfWeek: 5, // 默认周五
      time: "18:00", // 默认下午6点
      sendMode: "both",
      cycleType: "this_week",
    };

    return NextResponse.json({
      notifyConfig: task.notifyConfig || defaultConfig,
      availableBots,
      taskName: task.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取通知配置失败" },
      { status: 500 }
    );
  }
}

/**
 * PATCH: 保存或更新任务的群通知配置
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const body = (await request.json()) as Partial<TaskNotifyConfig>;

    const prevConfig = task.notifyConfig || {
      enabled: false,
      botId: "",
      webhookUrl: "",
      dayOfWeek: 5,
      time: "18:00",
      sendMode: "both",
      cycleType: "this_week",
    };

    const nextConfig: TaskNotifyConfig = {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : prevConfig.enabled,
      botId: body.botId !== undefined ? body.botId.trim() : prevConfig.botId,
      webhookUrl: body.webhookUrl !== undefined ? body.webhookUrl.trim() : prevConfig.webhookUrl,
      dayOfWeek: body.dayOfWeek !== undefined ? Number(body.dayOfWeek) : prevConfig.dayOfWeek,
      time: body.time !== undefined ? body.time.trim() : prevConfig.time,
      cycleType: body.cycleType || prevConfig.cycleType || "this_week",
      sendMode: body.sendMode || prevConfig.sendMode || "both",
      lastSentAt: prevConfig.lastSentAt,
    };

    const saved = saveTaskNotifyConfig(taskId, nextConfig);
    return NextResponse.json({ notifyConfig: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存通知配置失败" },
      { status: 400 }
    );
  }
}

/**
 * POST: 立即触发“测试发送到群”
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    let targetOverride: string | undefined;
    let sendModeOverride: "both" | "image_only" | "text_only" | undefined;
    let cycleTypeOverride: TaskNotifyConfig["cycleType"] | undefined;
    try {
      const body = await request.json();
      targetOverride = body?.botId || body?.webhookUrl;
      sendModeOverride = body?.sendMode;
      cycleTypeOverride = body?.cycleType;
    } catch {
      // ignore empty body
    }

    const result = await sendTaskStatsNotification(taskId, targetOverride, sendModeOverride, cycleTypeOverride);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "发送统计通知失败" },
      { status: 400 }
    );
  }
}
