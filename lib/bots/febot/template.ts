import { FeishuMessagePayload } from "../../core/types";
import { getDocumentInfo } from "../../mcp/feishu-doc-engine";
import { MessageContext } from "../types";

const UPDATED_DOCUMENT_URL =
  "https://segway-ninebot.feishu.cn/wiki/G0vTwWW0giLXfukeROWc7kfmntb";

async function getDocumentDisplayName(): Promise<string> {
  try {
    const documentInfo = await getDocumentInfo(UPDATED_DOCUMENT_URL);
    return documentInfo.title?.trim() || UPDATED_DOCUMENT_URL;
  } catch (error) {
    console.warn("读取技术周会文档标题失败，将使用文档地址作为链接文本:", error);
    return UPDATED_DOCUMENT_URL;
  }
}

/**
 * FEBot 周会主持提醒专属消息模版（卡片交互格式，与工作周报风格统一）
 */
export async function buildWeeklyMeetingReminder(context: MessageContext): Promise<FeishuMessagePayload> {
  const { host, schedule } = context;
  const documentDisplayName = await getDocumentDisplayName();
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
                content: `**会议文档：**\n[${documentDisplayName}](${UPDATED_DOCUMENT_URL})`,
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
              url: UPDATED_DOCUMENT_URL,
            },
          ],
        },
      ],
    },
  };
}
