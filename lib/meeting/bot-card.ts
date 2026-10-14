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

/**
 * 构建纯文本群消息（仅包含文字描述与飞书表格文档链接）
 */
export function buildMeetingTextMessage(
  meeting: MeetingAnalysis,
  options?: {
    customText?: string;
    tableUrl?: string;
  },
): FeishuMessagePayload {
  const finalTableUrl =
    options?.tableUrl?.trim() || meeting.exports?.[0]?.targetUrl || DEFAULT_FEISHU_BITABLE_URL;
  const meetingDateStr = meeting.meetingDate
    ? meeting.meetingDate.slice(0, 10)
    : formatDate(meeting.createdAt);

  const defaultText = `各位同学，${meetingDateStr}「${meeting.title}」的会议纪要与TODO已汇总更新。请相关责任人关注并及时跟进，点击下方链接查看（内容是结合纪要和AI总结会议总结，如有遗漏或问题可编辑修改或评论）`;
  const textBody = options?.customText?.trim() || defaultText;

  // 纯文本消息：附带多维表格文档链接（若用户文案中未包含，则换行附带）
  const contentText = textBody.includes(finalTableUrl)
    ? textBody
    : `${textBody}\n${finalTableUrl}`;

  return {
    msg_type: "text",
    content: {
      text: contentText,
    },
  };
}

/**
 * 备用：构建飞书交互卡片消息
 */
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

  const defaultIntro = `各位同学，${meetingDateStr}「${meeting.title}」的会议纪要与TODO已汇总更新。请相关责任人关注并及时跟进，点击下方链接查看（内容是结合纪要和AI总结会议总结，如有遗漏或问题可编辑修改或评论）`;
  const textDescription = options?.introText?.trim() || defaultIntro;

  const elements: any[] = [];

  // 1. 自定义文字描述
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: textDescription,
    },
  });

  elements.push({ tag: "hr" });

  // 2. 纪要对应的飞书表格文档与会议信息
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

  elements.push({
    tag: "div",
    fields,
  });

  // 3. 如果是完整展开模式 (full)，则追加具体纪要/TODO/风险明细
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
          content: `**💡 核心会议纪要 (${decisions.length})**\n${decisionLines.join("\n\n")}`,
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

  // 4. 底部跳转按钮（仅附带多维表格）
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
          content: `📋 会议纪要已同步 · ${meeting.title}`,
        },
      },
      elements,
    },
  };
}
