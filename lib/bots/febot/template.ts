import { FeishuMessagePayload } from "../../core/types";
import { MessageContext } from "../types";

const UPDATED_DOCUMENT_URL =
  "https://doc.weixin.qq.com/smartsheet/s3_AagA0gYzAMICNWoREEa5WTyiK1TLJ?scode=AHwAVAcbAAgnUhodeTAagA0gYzAMI&is_external=0&commentVersion=1788227536000&wxworkQt=1&qt_source=Conv&qt_report_identifier=1788246838457&open_source=timeline&tab=agBUkq&viewId=vHxLgf";

/**
 * FEBot 周会主持提醒专属消息模版
 */
export function buildWeeklyMeetingReminder(context: MessageContext): FeishuMessagePayload {
  const { host } = context;
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
              { tag: "a", text: "点击查看", href: UPDATED_DOCUMENT_URL },
            ],
          ],
        },
      },
    },
  };
}
