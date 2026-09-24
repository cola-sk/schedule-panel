import { NextResponse } from "next/server";
import { resetMeetingPrompt } from "@/lib/meeting/prompt-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const prompt = resetMeetingPrompt(id);
  if (!prompt) return NextResponse.json({ error: "只有内置 Prompt 可以恢复默认内容" }, { status: 400 });
  return NextResponse.json({ prompt });
}

