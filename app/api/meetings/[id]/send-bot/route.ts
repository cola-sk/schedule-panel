import { NextResponse } from "next/server";
import { z } from "zod";
import { sendWebhookMessage } from "@/lib/core/feishu-client";
import { getBot } from "@/lib/core/store";
import { getMeeting } from "@/lib/meeting/store";
import { buildMeetingInteractiveCard, buildMeetingTextMessage } from "@/lib/meeting/bot-card";

const sendSchema = z.object({
  botId: z.string().optional(),
  customWebhook: z.string().trim().url().optional().or(z.literal("")),
  introText: z.string().trim().max(4000).optional(),
  tableUrl: z.string().trim().url().optional().or(z.literal("")),
  tableName: z.string().trim().max(100).optional(),
  msgType: z.enum(["text", "interactive"]).optional().default("text"),
  cardMode: z.enum(["table_link_only", "full"]).optional().default("table_link_only"),
  includeDecisions: z.boolean().optional().default(false),
  includeActionItems: z.boolean().optional().default(false),
  includeRisks: z.boolean().optional().default(false),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const meeting = getMeeting(id);
    if (!meeting) {
      return NextResponse.json({ error: "会议记录不存在" }, { status: 404 });
    }

    const body = await request.json();
    const input = sendSchema.parse(body);

    let targetWebhook = "";
    let botName = "自定义机器人";

    if (input.botId) {
      const bot = getBot(input.botId);
      if (!bot || !bot.webhookUrl) {
        return NextResponse.json({ error: "所选机器人不存在或未配置 Webhook" }, { status: 400 });
      }
      targetWebhook = bot.webhookUrl;
      botName = bot.name;
    } else if (input.customWebhook) {
      targetWebhook = input.customWebhook;
    } else {
      return NextResponse.json({ error: "请选择一个机器人或输入自定义 Webhook" }, { status: 400 });
    }

    const payload =
      input.msgType === "interactive"
        ? buildMeetingInteractiveCard(meeting, {
            introText: input.introText,
            tableUrl: input.tableUrl,
            tableName: input.tableName,
            cardMode: input.cardMode,
            includeDecisions: input.includeDecisions,
            includeActionItems: input.includeActionItems,
            includeRisks: input.includeRisks,
          })
        : buildMeetingTextMessage(meeting, {
            customText: input.introText,
            tableUrl: input.tableUrl,
          });

    await sendWebhookMessage(targetWebhook, payload);

    return NextResponse.json({
      ok: true,
      botName,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "机器人发送失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
