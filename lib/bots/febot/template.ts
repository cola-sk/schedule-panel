import { FeishuMessagePayload } from "../../core/types";
import { getDocumentInfo } from "../../mcp/feishu-doc-engine";
import { MessageContext } from "../types";

export const DEFAULT_MEETING_DOCUMENT_URL =
  "https://segway-ninebot.feishu.cn/wiki/G0vTwWW0giLXfukeROWc7kfmntb";

async function getDocumentDisplayName(documentUrl: string): Promise<string> {
  try {
    const documentInfo = await getDocumentInfo(documentUrl);
    return documentInfo.title?.trim() || documentUrl;
  } catch (error) {
    console.warn("读取技术周会文档标题失败，将使用文档地址作为链接文本:", error);
    return documentUrl;
  }
}

/**
 * FEBot 周会主持提醒专属消息模版（卡片交互格式，与工作周报风格统一）
 */
export async function buildWeeklyMeetingReminder(context: MessageContext): Promise<FeishuMessagePayload> {
  const { host, schedule } = context;
  const documentUrl = schedule?.meetingDocumentUrl?.trim() || DEFAULT_MEETING_DOCUMENT_URL;
  const documentDisplayName = await getDocumentDisplayName(documentUrl);
  const atAllPrefix = schedule?.atAll ? "<at id=all></at>\n" : "";
  const hostAtText = host.openId
    ? `<at id=${host.openId}></at>`
    : `@${host.name}`;

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
          content: "📅 技术周会主持提醒",
        },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `${atAllPrefix}本周技术周会即将开始，请大家提前更新好技术进展，准时参加会议。`,
          },
        },
        {
          tag: "div",
          fields: [
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**本周主持人：**\n${hostAtText}`,
              },
            },
            {
              is_short: true,
              text: {
                tag: "lark_md",
                content: `**会议文档：**\n[${documentDisplayName}](${documentUrl})`,
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
                content: "👉 查看周会文档",
              },
              type: "primary",
              url: documentUrl,
            },
          ],
        },
      ],
    },
  };
}
