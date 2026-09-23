import { NextRequest, NextResponse } from "next/server";
import { createBot, getPublicBots } from "@/lib/core/store";


function validWebhook(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(value);
}

export async function GET() {
  return NextResponse.json({ bots: getPublicBots() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "请填写机器人名称" }, { status: 400 });
  if (!validWebhook(body.webhookUrl)) return NextResponse.json({ error: "请输入有效的飞书机器人 Webhook 地址" }, { status: 400 });
  createBot({ name: body.name, webhookUrl: body.webhookUrl });
  return NextResponse.json({ bots: getPublicBots() }, { status: 201 });
}
