import { FeishuMessagePayload } from "../../core/types";

export interface WeeklyReportNotificationContext {
  title: string;
  documentUrl: string;
}

/**
 * 提醒成员更新周报的飞书群卡片
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
          content: "📣 请及时更新本周周报",
        },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "本周周报已准备好，请大家及时补充本周工作进展、风险事项和下周计划。",
          },
        },
        {
          tag: "div",
          fields: [
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**本周周报：**\n${context.title}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: "**请完成：**\n更新个人工作进展",
              },
            },
          ],
        },
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
                content: "👉 去更新周报",
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
