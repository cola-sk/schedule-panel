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
 * FEBot 周会主持提醒专属消息模版
 */
export async function buildWeeklyMeetingReminder(context: MessageContext): Promise<FeishuMessagePayload> {
  const { host } = context;
  const documentDisplayName = await getDocumentDisplayName();
  const atElement = host.openId
    ? { tag: "at", user_id: host.openId }
    : { tag: "text", text: `@${host.name}` };

  return {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: "技术周会提醒",
          content: [
            [
              { tag: "text", text: "本周周会即将开始，请大家提前更新好技术进展;\n" },
              { tag: "text", text: "本周主持人：" },
              atElement,
              { tag: "text", text: " 请负责主持会议；" },
            ],
            [
              { tag: "text", text: "文档地址:" },
              { tag: "a", text: documentDisplayName, href: UPDATED_DOCUMENT_URL },
            ],
          ],
        },
      },
    },
  };
}
