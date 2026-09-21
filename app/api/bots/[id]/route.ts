import { NextRequest, NextResponse } from "next/server";
import { deleteBot, getPublicBots, updateBot } from "@/lib/core/store";


function validWebhook(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(value);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  if (typeof body.name === "string" && !body.name.trim()) return NextResponse.json({ error: "请填写机器人名称" }, { status: 400 });
  if (body.webhookUrl !== undefined && !validWebhook(body.webhookUrl)) return NextResponse.json({ error: "请输入有效的飞书机器人 Webhook 地址" }, { status: 400 });
  const bot = updateBot(id, { name: typeof body.name === "string" ? body.name.trim() : undefined, webhookUrl: body.webhookUrl, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined });
  if (!bot) return NextResponse.json({ error: "机器人不存在" }, { status: 404 });
  return NextResponse.json({ bots: getPublicBots() });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteBot(id);
  if (result === "BOT_IN_USE") return NextResponse.json({ error: "该机器人正在被定时任务使用，无法删除" }, { status: 409 });
  if (!result) return NextResponse.json({ error: "机器人不存在" }, { status: 404 });
  return NextResponse.json({ bots: getPublicBots() });
}
