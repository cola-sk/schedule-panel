import "server-only";
import fs from "fs";
import { sendWebhookMessage } from "@/lib/core/feishu-client";
import { atShanghaiLocal, chinaDateKey, chinaWeekday } from "@/lib/core/scheduler";
import { generateMigrationWeeklyStats, computeCycleStats, computeSubdirectoryStats } from "./stats";
import { getBot, recordTask } from "@/lib/core/store";
import { getFeishuClient } from "@/lib/mcp/feishu-doc-engine";
import { renderStatsDashboardImage } from "./image-generator";
import {
  addTaskAuditLog,
  getTask,
  getTasks,
  persistMigrationState,
  saveTaskNotifyConfig,
} from "./store";
import type { TaskMigrationStats, TaskNotifyConfig, StatCycleType, CycleStatsResult } from "./types";
import type { FeishuMessagePayload, ReminderTask } from "@/lib/core/types";

/**
 * 计算统计通知下一次应执行的时间。该结果与定时派发器的每日/每周、按北京时间规则一致，
 * 仅用于向页面展示计划；真正的发送仍由 Cron 派发入口负责。
 */
export function getNextMigrationStatsRunAt(config?: TaskNotifyConfig, now = new Date()): string | undefined {
  if (!config?.enabled) return undefined;

  const frequency = config.frequency || "weekly";
  const dayOfWeek = Number(config.dayOfWeek);
  const time = config.time || "18:00";
  if ((frequency === "weekly" && (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return undefined;
  }

  const todayAtScheduledTime = atShanghaiLocal(now, time);
  const intervalDays = frequency === "daily" ? 1 : 7;
  let daysUntilRun = dayOfWeek - chinaWeekday(now);
  if (frequency === "daily") daysUntilRun = 0;
  if (daysUntilRun < 0 || (daysUntilRun === 0 && todayAtScheduledTime.getTime() <= now.getTime())) {
    daysUntilRun += intervalDays;
  }

  let nextRun = new Date(todayAtScheduledTime.getTime() + daysUntilRun * 24 * 60 * 60 * 1000);
  if (hasSentScheduledOccurrence(config, nextRun)) {
    nextRun = new Date(nextRun.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  }

  return nextRun.toISOString();
}

/**
 * 判断某个计划执行点是否已经完成。
 *
 * 测试发送也会保留 lastSentAt 以便展示发送历史，但它不应消耗尚未到点的定时执行。
 * 因此只有发送时间达到该执行点后，才认为该执行点已完成。
 */
function hasSentScheduledOccurrence(config: TaskNotifyConfig, scheduledAt: Date): boolean {
  if (!config.lastSentAt) return false;

  const lastSentAt = new Date(config.lastSentAt);
  if (Number.isNaN(lastSentAt.getTime())) return false;

  return (
    chinaDateKey(lastSentAt) === chinaDateKey(scheduledAt) &&
    lastSentAt.getTime() >= scheduledAt.getTime()
  );
}

/**
 * 生成指定区间内的知识库统计通知日历项（包含已发送的历史事件与未来的排期计划）。
 */
export function migrationStatsTasksBetween(start: Date, end: Date, now = new Date()): ReminderTask[] {
  if (start.getTime() > end.getTime()) return [];

  const startKey = chinaDateKey(start);
  const endKey = chinaDateKey(end);
  const calendarTasks: ReminderTask[] = [];

  for (const task of getTasks()) {
    if (!task.notifyConfig?.enabled && (!task.auditLogs || task.auditLogs.length === 0)) continue;

    const sentKeyMap = new Map<string, ReminderTask>();

    // 1. 提取历史已发生的通知推送记录（从 auditLogs 中解析成功推送到飞书群的记录）
    for (const log of task.auditLogs || []) {
      if (!log.detail || !log.detail.includes("推送到飞书群")) continue;
      // 日历仅展示定时任务发送，不展示手动发送/测试发送的记录
      if (log.detail.includes("手动") || log.detail.includes("测试")) continue;
      const logDate = new Date(log.createdAt);
      if (Number.isNaN(logDate.getTime())) continue;
      const dateKey = chinaDateKey(logDate);
      const triggerType: "scheduled" | "manual" = "scheduled";
      if (dateKey >= startKey && dateKey <= endKey) {
        // 同一自然日若有多次推送，保留最新一条展示
        if (!sentKeyMap.has(dateKey)) {
          sentKeyMap.set(dateKey, {
            id: `knowledge-migration:${task.id}:${log.id || log.createdAt}`,
            scheduleId: `knowledge-migration:${task.id}`,
            scheduleName: `知识库统计 · ${task.name}`,
            host: { name: "定时任务" },
            scheduledAt: log.createdAt,
            sentAt: log.createdAt,
            status: "sent",
            triggerType,
            content: log.detail,
          });
        } else {
          const prev = sentKeyMap.get(dateKey)!;
          if (new Date(log.createdAt).getTime() > new Date(prev.sentAt || prev.scheduledAt).getTime()) {
            sentKeyMap.set(dateKey, {
              id: `knowledge-migration:${task.id}:${log.id || log.createdAt}`,
              scheduleId: `knowledge-migration:${task.id}`,
              scheduleName: `知识库统计 · ${task.name}`,
              host: { name: "定时任务" },
              scheduledAt: log.createdAt,
              sentAt: log.createdAt,
              status: "sent",
              triggerType,
              content: log.detail,
            });
          }
        }
      }
    }

    for (const sentTask of sentKeyMap.values()) {
      calendarTasks.push(sentTask);
    }

    // 2. 推算未来的待执行排期（已发生历史推送的自然日不再重复显示待办排期）
    if (task.notifyConfig?.enabled && end.getTime() >= now.getTime()) {
      const baseline = new Date(Math.max(now.getTime(), start.getTime() - 1));
      const firstRunAt = getNextMigrationStatsRunAt(task.notifyConfig, baseline);
      if (firstRunAt) {
        const intervalDays = task.notifyConfig.frequency === "daily" ? 1 : 7;
        let occurrence = new Date(firstRunAt);
        let guard = 0;
        while (occurrence.getTime() <= end.getTime() && guard < 400) {
          guard += 1;
          const occDateKey = chinaDateKey(occurrence);
          if (occurrence.getTime() >= start.getTime() && !sentKeyMap.has(occDateKey)) {
            calendarTasks.push({
              id: `knowledge-migration:${task.id}:${occurrence.toISOString()}`,
              scheduleId: `knowledge-migration:${task.id}`,
              scheduleName: `知识库统计 · ${task.name}`,
              host: { name: "定时任务" },
              scheduledAt: occurrence.toISOString(),
              status: "pending",
              triggerType: "scheduled",
              content: `按计划将基于所选周期生成知识库全量与重点子目录统计，并推送到关联飞书群`,
            });
          }
          occurrence = new Date(occurrence.getTime() + intervalDays * 24 * 60 * 60 * 1000);
        }
      }
    }
  }

  return calendarTasks.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

/**
 * 构造知识库归档与文档贡献统计飞书卡片
 */
export function buildMigrationStatsCard(
  stats: TaskMigrationStats,
  taskName: string,
  targetWikiUrl?: string,
  webAppUrl?: string,
  imageKey?: string,
  cycleStats?: CycleStatsResult,
  atAll?: boolean,
): FeishuMessagePayload {
  const effectiveCycle = cycleStats || computeCycleStats(stats, "this_week");
  const cycleLabel = effectiveCycle.cycleLabel;
  const cycleShort = effectiveCycle.cycleShortLabel;
  const cycleTitle = effectiveCycle.cycleTitle;

  // 1. 周期贡献榜明细文本
  let periodText = `${cycleTitle}暂无文档贡献，各模块文档平稳沉淀中。`;
  const contributorPersons = effectiveCycle.persons.filter((p) => p.nonWikiCount > 0);
  if (contributorPersons.length > 0) {
    const medalIcons = ["🥇", "🥈", "🥉"];
    const personLines = contributorPersons.map((p, idx) => {
      const medal = medalIcons[idx] || "•";
      const catDesc =
        p.categories && p.categories.length > 0
          ? `（分类: ${p.categories.map((c) => `${c.category} ${c.count}篇`).join("、")}）`
          : "";
      return `${medal} 👤 **${p.personName}**：${cycleShort}贡献 **${p.nonWikiCount}** 篇 ${catDesc}`;
    });

    periodText = personLines.join("\n");
  }

  // 2. 全局累计人员贡献排行榜 (Top 8)
  const topPersons = stats.personsRank.slice(0, 8);
  const medalIcons = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];
  const rankLines = topPersons.map((p, idx) => {
    const icon = medalIcons[idx] || "•";
    // 计算该成员在此周期的新增数
    const cycleCount = effectiveCycle.persons.find((cp) => cp.personName === p.personName)?.nonWikiCount || 0;
    const cycleAddDesc = cycleCount > 0 ? ` (+${cycleCount} ${cycleShort})` : "";
    const catDesc =
      p.categories && p.categories.length > 0
        ? ` ｜ 涉及: ${p.categories.slice(0, 2).map((c) => `${c.category}(${c.count})`).join(", ")}`
        : "";
    return `${icon} **${p.personName}**：累计贡献 **${p.nonWikiCount}** 篇${cycleAddDesc}${catDesc}`;
  });

  const rankText = rankLines.length > 0 ? rankLines.join("\n") : "暂无成员统计数据";

  // 操作按钮
  const actions: Array<{ tag: "button"; text: { tag: "plain_text"; content: string }; type: "primary" | "default"; url: string }> = [];
  if (targetWikiUrl) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📚 前往飞书知识库",
      },
      type: "primary",
      url: targetWikiUrl.startsWith("http") ? targetWikiUrl : `https://${targetWikiUrl}`,
    });
  }

  return {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: "blue",
        title: {
          tag: "plain_text",
          content: "知识库迁移/贡献统计定时任务发送",
        },
      },
      elements: [
        ...(atAll
          ? [
              {
                tag: "div",
                text: {
                  tag: "lark_md",
                  content: "<at id=all></at>",
                },
              },
            ]
          : []),
        {
          tag: "div",
          fields: [
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**Wiki完成迁移：**\n共 **${stats.totalWikiDocs}** 篇`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**非Wiki文档贡献：**\n共 **${stats.totalNonWikiDocs}** 篇`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**当前统计周期：**\n${cycleLabel}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**${cycleShort}贡献数量：**\n**${effectiveCycle.nonWikiCount}** 篇`,
              },
            },
          ],
        },
        {
          tag: "hr",
        },
        // 若附带长图，在卡片中嵌入看板长图
        ...(imageKey
          ? [
              {
                tag: "img",
                img_key: imageKey,
                alt: {
                  tag: "plain_text",
                  content: "📊 知识库总量与重点子目录贡献统计",
                },
                mode: "fit_horizontal",
                preview: true,
              },
              {
                tag: "hr",
              },
            ]
          : []),
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `✨ **${cycleTitle}贡献榜：**\n${periodText}`,
          },
        },
        {
          tag: "hr",
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `🏆 **累计总贡献榜：**\n${rankText}`,
          },
        },
        ...(actions.length > 0
          ? [
              {
                tag: "hr",
              },
              {
                tag: "action",
                actions,
              },
            ]
          : []),
      ],
    },
  };
}

/**
 * 为指定任务生成统计并发送群消息通知
 */
export async function sendTaskStatsNotification(
  taskId: string,
  webhookUrlOverride?: string,
  sendModeOverride?: "both" | "image_only" | "text_only",
  cycleTypeOverride?: StatCycleType,
  atAllOverride?: boolean,
  triggerType: "scheduled" | "manual" = "scheduled",
): Promise<{ ok: boolean; message: string; stats?: TaskMigrationStats; imageKey?: string }> {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");

  let targetWebhook = webhookUrlOverride?.trim();
  if (targetWebhook && !targetWebhook.startsWith("http")) {
    const bot = getBot(targetWebhook);
    targetWebhook = bot?.webhookUrl;
  }
  if (!targetWebhook && task.notifyConfig?.botId) {
    const bot = getBot(task.notifyConfig.botId);
    targetWebhook = bot?.webhookUrl;
  }
  if (!targetWebhook) {
    targetWebhook = task.notifyConfig?.webhookUrl?.trim();
  }
  if (!targetWebhook) {
    throw new Error("请先选择已配置有效 Webhook 的飞书机器人");
  }

  const sendMode = sendModeOverride || task.notifyConfig?.sendMode || "both";
  const cycleType = cycleTypeOverride || task.notifyConfig?.cycleType || (task.notifyConfig?.frequency === "daily" ? "yesterday" : "this_week");
  const atAll = atAllOverride !== undefined ? atAllOverride : Boolean(task.notifyConfig?.atAll);

  // 1. 生成最新全量统计数据与选定周期的贡献榜统计
  const stats = await generateMigrationWeeklyStats(taskId);
  const cycleStats = computeCycleStats(stats, cycleType);

  let imageKey: string | undefined;

  // 2. 生成并上传总量与重点目录子目录统计图
  if (sendMode === "both" || sendMode === "image_only") {
    const uploadImage = async (imagePath: string): Promise<string> => {
      try {
        const client = getFeishuClient();
        const fileStream = fs.createReadStream(imagePath);
        const uploadRes = await client.im.image.create({
          data: {
            image_type: "message",
            image: fileStream,
          },
        });
        if (!uploadRes?.image_key) throw new Error("飞书图片上传未返回 image_key");
        return uploadRes.image_key;
      } finally {
        fs.rmSync(imagePath, { force: true });
      }
    };
    const directoryStats = computeSubdirectoryStats(stats, task.targetDirectories || [], cycleStats);
    imageKey = await uploadImage(await renderStatsDashboardImage(stats, task.name, cycleStats, directoryStats));
  }

  // 3. 根据发送模式派发群 Webhook 消息
  if (sendMode === "image_only") {
    if (!imageKey) {
      throw new Error("未能生成并获取飞书图片凭据");
    }
    if (atAll) {
      await sendWebhookMessage(targetWebhook, {
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          header: {
            template: "blue",
            title: {
              tag: "plain_text",
              content: `${task.name} 知识库迁移/贡献统计`,
            },
          },
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: "<at id=all></at>",
              },
            },
            {
              tag: "img",
              img_key: imageKey,
              alt: {
                tag: "plain_text",
                content: "📊 知识库总量与重点子目录贡献统计",
              },
              mode: "fit_horizontal",
              preview: true,
            },
          ],
        },
      });
    } else {
      await sendWebhookMessage(targetWebhook, {
        msg_type: "image",
        content: {
          image_key: imageKey,
        },
      });
    }
  } else {
    const cardPayload = buildMigrationStatsCard(
      stats,
      task.name,
      task.config.targetWikiRoot,
      undefined,
      imageKey,
      cycleStats,
      atAll,
    );
    await sendWebhookMessage(targetWebhook, cardPayload);
  }

  // 4. 更新上次发送时间与记录审计日志
  const sendTime = new Date().toISOString();
  if (task.notifyConfig) {
    saveTaskNotifyConfig(taskId, {
      ...task.notifyConfig,
      lastSentAt: sendTime,
    });
  }

  const modeDesc =
    sendMode === "image_only"
      ? "仅发送统计图"
      : sendMode === "both"
      ? "图文卡片（含统计图）"
      : "仅发送文字卡片";

  const triggerPrefix = triggerType === "manual" ? "手动测试" : "定时任务";
  const pushDetail = `[${triggerPrefix}] 已成功将归档统计与贡献榜推送到飞书群（模式：${modeDesc}，周期：${cycleStats.cycleLabel}）：Wiki 完成迁移 ${stats.totalWikiDocs} 篇，非Wiki文档贡献 ${stats.totalNonWikiDocs} 篇（${cycleStats.cycleShortLabel}贡献 ${cycleStats.nonWikiCount} 篇）`;
  addTaskAuditLog(taskId, {
    action: "stats_generated" as any,
    detail: pushDetail,
  });
  try {
    recordTask({
      id: `knowledge-migration:${task.id}:${sendTime}`,
      scheduleId: `knowledge-migration:${task.id}`,
      scheduleName: `知识库统计 · ${task.name}`,
      host: { name: triggerType === "manual" ? "手动触发" : "定时任务" },
      scheduledAt: sendTime,
      sentAt: sendTime,
      status: "sent",
      triggerType,
      botId: task.notifyConfig?.botId,
      content: pushDetail,
    });
  } catch {
    // ignore
  }
  persistMigrationState();

  return {
    ok: true,
    message: `知识库统计与贡献榜已成功发送至飞书群（${modeDesc} · ${cycleStats.cycleTitle}）！`,
    stats,
    imageKey,
  };
}

/**
 * 定时轮询检查并派发所有到期的知识库统计通知（供全局 Cron 调用）
 */
export async function dispatchDueMigrationStats(): Promise<Array<{ taskId: string; status: "sent" | "failed"; error?: string }>> {
  const results: Array<{ taskId: string; status: "sent" | "failed"; error?: string }> = [];
  const tasks = getTasks();
  const now = new Date();
  const currentWeekday = chinaWeekday(now); // 1: Mon ... 7: Sun

  for (const task of tasks) {
    const notifyConfig = task.notifyConfig;
    if (!notifyConfig || !notifyConfig.enabled) {
      continue;
    }

    let webhook = notifyConfig.webhookUrl;
    if (!webhook && notifyConfig.botId) {
      const bot = getBot(notifyConfig.botId);
      if (bot?.enabled) webhook = bot.webhookUrl;
    }
    if (!webhook) {
      continue;
    }

    // 检查星期几
    if (notifyConfig.frequency !== "daily" && notifyConfig.dayOfWeek !== currentWeekday) {
      continue;
    }

    // 检查今天是否已经发送过
    // 检查执行时间与 1 小时窗口
    const scheduledTime = atShanghaiLocal(now, notifyConfig.time || "18:00");
    if (hasSentScheduledOccurrence(notifyConfig, scheduledTime)) {
      continue;
    }

    const diffMs = now.getTime() - scheduledTime.getTime();
    if (diffMs < 0 || diffMs > 3600_000) {
      continue;
    }

    // 到期触发发送
    try {
      await sendTaskStatsNotification(task.id);
      results.push({ taskId: task.id, status: "sent" });
    } catch (err: any) {
      console.error(`[知识库归档] 任务 ${task.name}(${task.id}) 发送定时统计失败:`, err);
      results.push({ taskId: task.id, status: "failed", error: err?.message || "发送失败" });
    }
  }

  return results;
}
