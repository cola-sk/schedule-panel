import { BotConfig, RotationMember } from "./core/types";
import { fetchRotationFromSource } from "./core/feishu-client";
import { sendTaskReminder } from "./core/scheduler";

export function isFeishuConfigured() {
  return Boolean(process.env.FEISHU_BOT_WEBHOOK);
}

export async function sendHostReminder(bot: BotConfig | undefined, host: RotationMember) {
  if (!bot?.enabled || !bot.webhookUrl) {
    return { mocked: true, message: "未配置飞书凭据，已在本地模拟发送。" };
  }
  return sendTaskReminder({
    id: "manual-reminder",
    scheduleId: "febot-schedule",
    scheduleName: "前端技术周会主持提醒",
    host,
    scheduledAt: new Date().toISOString(),
    status: "pending",
  });
}

export async function fetchDocRotation(sourceIdOrUrl: string): Promise<RotationMember[]> {
  return fetchRotationFromSource(sourceIdOrUrl);
}

export * from "./core/feishu-client";
