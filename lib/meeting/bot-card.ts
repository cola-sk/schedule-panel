import type { FeishuMessagePayload } from "@/lib/core/types";
import type { MeetingAnalysis } from "./types";
import { DEFAULT_FEISHU_BITABLE_URL } from "./types";

export interface BuildCardOptions {
  introText?: string;
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
  const includeDecisions = options?.includeDecisions !== false;
  const includeActionItems = options?.includeActionItems !== false;
  const includeRisks = options?.includeRisks !== false;

  const decisions = includeDecisions ? meeting.decisions || [] : [];
  const actionItems = includeActionItems ? meeting.actionItems || [] : [];
  const risks = includeRisks ? meeting.risks || [] : [];

  const hasHighRisk = risks.some((r) => r.level === "high");
  const headerTemplate = hasHighRisk ? "orange" : "blue";

  const elements: any[] = [];

  // 1. 播报前言 (如有)
  if (options?.introText?.trim()) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: options.introText.trim(),
      },
    });
    elements.push({ tag: "hr" });
  }

  // 2. 元信息分栏：开会日期、系列、参会人
  const meetingDateStr = meeting.meetingDate
    ? meeting.meetingDate.slice(0, 10)
    : formatDate(meeting.createdAt);

  const fields: Array<{ is_short: boolean; text: { tag: "lark_md"; content: string } }> = [
    {
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**📅 开会日期：**\n${meetingDateStr}`,
      },
    },
  ];

  if (meeting.seriesName) {
    fields.push({
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**🏷️ 会议系列：**\n${meeting.seriesName}`,
      },
    });
  }

  if (meeting.participants?.length) {
    fields.push({
      is_short: false,
      text: {
        tag: "lark_md",
        content: `**👥 参会人：**\n${meeting.participants.join("、")}`,
      },
    });
  }

  elements.push({
    tag: "div",
    fields,
  });

  // 3. 会议概述
  if (meeting.summary) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**📝 会议总结：**\n${meeting.summary}`,
      },
    });
  }

  // 4. 核心决议 / 结论 (Decisions)
  if (decisions.length > 0) {
    elements.push({ tag: "hr" });
    const decisionLines = decisions.map((item, idx) => {
      return `${idx + 1}. **${item.title}**\n   ${item.detail}`;
    });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**💡 核心结论 (${decisions.length})**\n${decisionLines.join("\n\n")}`,
      },
    });
  }

  // 5. 待办行动项 (TODOs)
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

  // 6. 潜在风险 / 阻塞 (Risks)
  if (risks.length > 0) {
    elements.push({ tag: "hr" });
    const riskLevelEmoji = { high: "🔴 [高危]", medium: "🟡 [中度]", low: "🟢 [低]" };
    const riskLines = risks.map((item, idx) => {
      const badge = riskLevelEmoji[item.level] || `[${item.level}]`;
      const owner = item.owner ? ` (责任人: ${item.owner})` : "";
      return `${idx + 1}. ${badge} **${item.title}**${owner}\n   • **影响**：${item.impact}\n   • **应对**：${item.mitigation}`;
    });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**⚠️ 潜在风险 (${risks.length})**\n${riskLines.join("\n\n")}`,
      },
    });
  }

  // 7. 底部跳转按钮
  const actionButtons: any[] = [];
  if (meeting.sourceUrl) {
    actionButtons.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "📄 查看飞书会议文档",
      },
      type: "primary",
      url: meeting.sourceUrl,
    });
  }

  const exportUrl = meeting.exports?.[0]?.targetUrl || DEFAULT_FEISHU_BITABLE_URL;
  actionButtons.push({
    tag: "button",
    text: {
      tag: "plain_text",
      content: "📊 查看多维表格跟踪",
    },
    type: "default",
    url: exportUrl,
  });

  if (actionButtons.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "action",
      actions: actionButtons,
    });
  }

  return {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: headerTemplate,
        title: {
          tag: "plain_text",
          content: `📋 会议行动闭环 · ${meeting.title}`,
        },
      },
      elements,
    },
  };
}
