import { FeishuMessagePayload } from "../../core/types";

export interface WeeklyReportNotificationContext {
  title: string;
  yearName: string;
  monthName: string;
  documentUrl: string;
  sourceTitle?: string;
  scheduledAt?: string;
}

/**
 * 周报自动生成后的飞书群通知卡片/消息
 */
export function buildWeeklyReportNotification(
  context: WeeklyReportNotificationContext,
): FeishuMessagePayload {
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
          content: "📋 本周周报模板已自动生成",
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
                content: `**周报标题：**\n${context.title}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**所属归档：**\n${context.yearName} / ${context.monthName}`,
              },
            },
          ],
        },
        ...(context.sourceTitle
          ? [
              {
                tag: "div",
                text: {
                  tag: "lark_md",
                  content: `**模板来源：** ${context.sourceTitle}`,
                },
              },
            ]
          : []),
        {
          tag: "hr",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "👉 点击前往查看 / 编辑周报",
              },
              type: "primary",
              url: context.documentUrl,
            },
          ],
        },
      ],
    },
  };
}
