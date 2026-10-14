import type { FeishuMessagePayload } from "@/lib/core/types";
import type { MeetingAnalysis } from "./types";
import { DEFAULT_FEISHU_BITABLE_URL } from "./types";

export interface BuildCardOptions {
  introText?: string;
  tableUrl?: string;
  tableName?: string;
  cardMode?: "table_link_only" | "full";
  includeDecisions?: boolean;
  includeActionItems?: boolean;
  includeRisks?: boolean;
}

function formatDate(value?: string) {
  if (!value) return "未指定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function buildMeetingInteractiveCard(
  meeting: MeetingAnalysis,
  options?: BuildCardOptions,
): FeishuMessagePayload {
  const cardMode = options?.cardMode ?? "table_link_only";
  const finalTableUrl =
    options?.tableUrl?.trim() || meeting.exports?.[0]?.targetUrl || DEFAULT_FEISHU_BITABLE_URL;
  const finalTableName =
    options?.tableName?.trim() || meeting.exports?.[0]?.tableName || "会议行动与风险跟踪总表";

  const meetingDateStr = meeting.meetingDate
    ? meeting.meetingDate.slice(0, 10)
    : formatDate(meeting.createdAt);

  const defaultIntro = `各位同学，${meetingDateStr}「${meeting.title}」的会议结论与行动项已汇总更新至飞书多维表格。请相关责任人及时跟进并按时闭环，点击下方表格链接即可查阅详情与最新进展。`;
  const textDescription = options?.introText?.trim() || defaultIntro;

  const elements: any[] = [];

  // 1. 自定义文字描述 (置顶醒目展示)
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: textDescription,
    },
  });

  elements.push({ tag: "hr" });

  // 2. 结论对应的飞书表格文档与会议信息
  const fields: Array<{ is_short: boolean; text: { tag: "lark_md"; content: string } }> = [
    {
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**📅 开会日期：**\n${meetingDateStr}`,
      },
    },
    {
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**📊 飞书表格：**\n[${finalTableName}](${finalTableUrl})`,
      },
    },
  ];

  if (meeting.sourceUrl) {
    fields.push({
      is_short: false,
      text: {
        tag: "lark_md",
        content: `**📄 纪要文档：**\n[${meeting.title}](${meeting.sourceUrl})`,
      },
    });
  }

  elements.push({
    tag: "div",
    fields,
  });

  // 3. 如果是完整展开模式 (full)，则追加具体结论/TODO/风险明细
  if (cardMode === "full") {
    const includeDecisions = options?.includeDecisions !== false;
    const includeActionItems = options?.includeActionItems !== false;
    const includeRisks = options?.includeRisks !== false;

    const decisions = includeDecisions ? meeting.decisions || [] : [];
    const actionItems = includeActionItems ? meeting.actionItems || [] : [];
    const risks = includeRisks ? meeting.risks || [] : [];

    if (decisions.length > 0) {
      elements.push({ tag: "hr" });
      const decisionLines = decisions.map((item, idx) => `${idx + 1}. **${item.title}**\n   ${item.detail}`);
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**💡 核心结论 (${decisions.length})**\n${decisionLines.join("\n\n")}`,
        },
      });
    }

    if (actionItems.length > 0) {
      elements.push({ tag: "hr" });
      const actionLines = actionItems.map((item, idx) => {
        const owner = item.who.name || "未指定";
        const due = item.dueAt ? ` (截止: ${item.dueAt.slice(0, 10)})` : "";
        const deliverable = item.deliverable ? ` · 交付物: ${item.deliverable}` : "";
        return `${idx + 1}. **${owner}**：${item.what}${due}${deliverable}`;
      });
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**📌 行动项 TODO (${actionItems.length})**\n${actionLines.join("\n")}`,
        },
      });
    }

    if (risks.length > 0) {
      elements.push({ tag: "hr" });
      const riskLevelEmoji = { high: "🔴 [高危]", medium: "🟡 [中度]", low: "🟢 [低]" };
      const riskLines = risks.map((item, idx) => {
        const badge = riskLevelEmoji[item.level] || `[${item.level}]`;
        const owner = item.owner ? ` (责任人: ${item.owner})` : "";
        return `${idx + 1}. ${badge} **${item.title}**${owner}\n   • **应对**：${item.mitigation}`;
      });
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**⚠️ 潜在风险 (${risks.length})**\n${riskLines.join("\n\n")}`,
        },
      });
    }
  }

  // 4. 底部跳转按钮
  const actionButtons: any[] = [
    {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📊 查看飞书多维表格",
      },
      type: "primary",
      url: finalTableUrl,
    },
  ];

  if (meeting.sourceUrl) {
    actionButtons.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📄 查看会议纪要",
      },
      type: "default",
      url: meeting.sourceUrl,
    });
  }

  elements.push({ tag: "hr" });
  elements.push({
    tag: "action",
    actions: actionButtons,
  });

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
          content: `📋 会议结论已同步 · ${meeting.title}`,
        },
      },
      elements,
    },
  };
}
