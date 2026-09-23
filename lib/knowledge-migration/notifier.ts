import "server-only";
import fs from "fs";
import { sendWebhookMessage } from "@/lib/core/feishu-client";
import { atShanghaiLocal, chinaDateKey, chinaWeekday } from "@/lib/core/scheduler";
import { generateMigrationWeeklyStats } from "./stats";
import { getBot } from "@/lib/core/store";
import { getFeishuClient } from "@/lib/mcp/feishu-doc-engine";
import { renderStatsDashboardImage } from "./image-generator";
import {
  addTaskAuditLog,
  getTask,
  getTasks,
  persistMigrationState,
  saveTaskNotifyConfig,
} from "./store";
import type { TaskMigrationStats } from "./types";
import type { FeishuMessagePayload } from "@/lib/core/types";

/**
 * 构造知识库归档与文档沉淀周报飞书卡片
 */
export function buildMigrationStatsCard(
  stats: TaskMigrationStats,
  taskName: string,
  targetWikiUrl?: string,
  webAppUrl?: string,
  imageKey?: string,
): FeishuMessagePayload {
  const currentWeek = stats.weeks[0]; // 最新的当前自然周
  const weekLabel = currentWeek ? currentWeek.weekLabel : "本周";

  // 1. 本周新增明细文本（已去掉最新沉淀文档）
  let currentWeekText = "本周暂无文档贡献，各模块文档平稳沉淀中。";
  if (currentWeek && currentWeek.persons.length > 0) {
    const contributorPersons = currentWeek.persons.filter((p) => p.nonWikiCount > 0);
    if (contributorPersons.length > 0) {
      const personLines = contributorPersons.map((p) => {
        const catDesc =
          p.categories && p.categories.length > 0
            ? `（分类: ${p.categories.map((c) => `${c.category} ${c.count}篇`).join("、")}）`
            : "";
        return `• 👤 **${p.personName}**：本周贡献 **${p.nonWikiCount}** 篇 ${catDesc}`;
      });

      currentWeekText = personLines.join("\n");
    }
  }

  // 2. 全局人员贡献排行榜 (Top 8)
  const topPersons = stats.personsRank.slice(0, 8);
  const medalIcons = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];
  const rankLines = topPersons.map((p, idx) => {
    const icon = medalIcons[idx] || "•";
    // 计算该成员本周新增数
    const weekCount = currentWeek?.persons.find((cp) => cp.personName === p.personName)?.nonWikiCount || 0;
    const weekAddDesc = weekCount > 0 ? ` (+${weekCount} 本周)` : "";
    const catDesc =
      p.categories && p.categories.length > 0
        ? ` ｜ 涉及: ${p.categories.slice(0, 2).map((c) => `${c.category}(${c.count})`).join(", ")}`
        : "";
    return `${icon} **${p.personName}**：累计贡献 **${p.nonWikiCount}** 篇${weekAddDesc}${catDesc}`;
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
          content: `📊 知识库归档与文档迁移周报 · ${taskName}`,
        },
      },
      elements: [
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
                content: `**非Wiki文档贡献数量：**\n共 **${stats.totalNonWikiDocs}** 篇`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**当前统计周期：**\n${weekLabel}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**本周贡献数量：**\n**${currentWeek?.nonWikiCount ?? 0}** 篇`,
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
                  content: "📊 知识库全景归档与周度迁移分析长图",
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
            content: `✨ **本周贡献人：**\n${currentWeekText}`,
          },
        },
        {
          tag: "hr",
        },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `🏆 **贡献人排行榜：**\n${rankText}`,
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

  // 1. 生成最新统计数据
  const stats = await generateMigrationWeeklyStats(taskId);

  let imageKey: string | undefined;

  // 2. 若需要发送图片 (both 或 image_only)，生成并上传高清看板长图
  if (sendMode === "both" || sendMode === "image_only") {
    try {
      const imagePath = await renderStatsDashboardImage(stats, task.name);
      const client = getFeishuClient();
      const fileStream = fs.createReadStream(imagePath);
      const uploadRes = await client.im.image.create({
        data: {
          image_type: "message",
          image: fileStream,
        },
      });
      imageKey = uploadRes?.image_key;
      try {
        fs.unlinkSync(imagePath);
      } catch {}
    } catch (imgError) {
      console.error("生成或上传长图失败:", imgError);
      if (sendMode === "image_only") {
        throw new Error(`生成长图失败: ${imgError instanceof Error ? imgError.message : String(imgError)}`);
      }
    }
  }

  // 3. 根据发送模式派发群 Webhook 消息
  if (sendMode === "image_only") {
    if (!imageKey) {
      throw new Error("未能生成并获取飞书图片凭据");
    }
    await sendWebhookMessage(targetWebhook, {
      msg_type: "image",
      content: {
        image_key: imageKey,
      },
    });
  } else {
    const cardPayload = buildMigrationStatsCard(
      stats,
      task.name,
      task.config.targetWikiRoot,
      undefined,
      imageKey,
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
      ? "仅发送看板长图"
      : sendMode === "both"
      ? (imageKey ? "图文并茂（内嵌高清长图）" : "图文卡片")
      : "仅发送文字卡片";

  addTaskAuditLog(taskId, {
    action: "stats_generated" as any,
    detail: `已成功将归档统计周报推送到飞书群（模式：${modeDesc}）：Wiki 完成迁移 ${stats.totalWikiDocs} 篇，非Wiki文档贡献数量 ${stats.totalNonWikiDocs} 篇（本周贡献 ${stats.weeks[0]?.nonWikiCount ?? 0} 篇）`,
  });
  persistMigrationState();

  return {
    ok: true,
    message: `统计周报已成功发送至飞书群（${modeDesc}）！`,
    stats,
    imageKey,
  };
}

/**
 * 定时轮询检查并派发所有到期的知识库归档周报通知（供全局 Cron 调用）
 */
export async function dispatchDueMigrationStats(): Promise<Array<{ taskId: string; status: "sent" | "failed"; error?: string }>> {
  const results: Array<{ taskId: string; status: "sent" | "failed"; error?: string }> = [];
  const tasks = getTasks();
  const now = new Date();
  const todayKey = chinaDateKey(now);
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
    if (notifyConfig.dayOfWeek !== currentWeekday) {
      continue;
    }

    // 检查今天是否已经发送过
    if (notifyConfig.lastSentAt && chinaDateKey(new Date(notifyConfig.lastSentAt)) === todayKey) {
      continue;
    }

    // 检查执行时间与 1 小时窗口
    const scheduledTime = atShanghaiLocal(now, notifyConfig.time || "18:00");
    const diffMs = now.getTime() - scheduledTime.getTime();
    if (diffMs < 0 || diffMs > 3600_000) {
      continue;
    }

    // 到期触发发送
    try {
      await sendTaskStatsNotification(task.id);
      results.push({ taskId: task.id, status: "sent" });
    } catch (err: any) {
      console.error(`[知识库归档] 任务 ${task.name}(${task.id}) 发送定时周报失败:`, err);
      results.push({ taskId: task.id, status: "failed", error: err?.message || "发送失败" });
    }
  }

  return results;
}
